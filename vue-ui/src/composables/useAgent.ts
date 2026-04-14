import { ref, readonly } from "vue";
import { useAiProvider } from "./useAiProvider";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type ToolParameterType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array";

export interface ToolParameter {
  type: ToolParameterType;
  description: string;
  enum?: string[];
  items?: { type: ToolParameterType };
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
  /** When true, the agent will pause and request user approval before executing */
  destructive?: boolean;
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface MCPServer {
  name: string;
  url: string;
  authToken?: string;
  headers?: Record<string, string>;
}

export interface AgentMessage {
  role: "user" | "assistant" | "tool" | "compaction";
  content: string;
  toolName?: string;
  toolCallId?: string;
  // Stored so we can replay them in the next API call
  toolCalls?: ToolCall[];
  /** Number of messages that were compacted into this summary */
  compactedCount?: number;
  timestamp: Date;
}

export interface AgentRunOptions {
  systemPrompt?: string;
  maxIterations?: number;
}

export interface AgentOptions {
  tools?: ToolDefinition[];
  mcpServers?: MCPServer[];
  systemPrompt?: string;
  keepHistory?: boolean;
  /**
   * Estimated token threshold before compaction triggers.
   * Can be a static number OR a getter function for reactive settings.
   * Default: 80000
   */
  compactionThreshold?: number | (() => number);
  onToolCall?: (name: string, input: unknown) => void;
  onToolStart?: (name: string, input: unknown) => void;
  onToolResult?: (name: string, result: unknown) => void;
  /**
   * Called before executing any tool marked as `destructive: true`.
   * Must return a Promise<boolean> — true to approve, false to reject.
   * If rejected, the agent run stops immediately.
   */
  onToolApprovalRequest?: (name: string, input: unknown) => Promise<boolean>;
  /** Called when the agent compacts older context to stay within token limits */
  onCompaction?: (summary: string, compactedCount: number) => void;
  /**
   * Called before compaction runs when compaction mode is "ask".
   * Must return Promise<boolean> — true to proceed, false to skip this compaction.
   * If not provided, compaction always proceeds automatically.
   */
  onCompactionRequest?: (tokenEstimate: number, threshold: number) => Promise<boolean>;
  /**
   * Tool names whose history entries (assistant tool_calls + tool results) are
   * pruned from history after each final answer is delivered.
   * Use for tools whose output is only needed for the current turn (e.g. skill loaders).
   */
  ephemeralTools?: string[];
}

// ─────────────────────────────────────────────
// MCP helpers
// ─────────────────────────────────────────────

async function fetchMCPTools(server: MCPServer): Promise<ToolDefinition[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(server.headers ?? {}),
    ...(server.authToken ? { Authorization: `Bearer ${server.authToken}` } : {})
  };

  const res = await fetch(`${server.url}/tools/list`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  if (!res.ok) {
    throw new Error(`MCP ${server.name}: tools/list failed (${res.status})`);
  }

  const { tools } = (await res.json()) as {
    tools: Array<{
      name: string;
      description: string;
      inputSchema: ToolDefinition["parameters"];
    }>;
  };

  return tools.map((t) => ({
    name: `${server.name}__${t.name}`,
    description: `[MCP: ${server.name}] ${t.description}`,
    parameters: t.inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const callRes = await fetch(`${server.url}/tools/call`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: t.name, arguments: input })
      });
      if (!callRes.ok) {
        throw new Error(
          `MCP ${server.name}/${t.name} failed (${callRes.status})`
        );
      }
      const { content } = (await callRes.json()) as {
        content: Array<{ type: string; text?: string }>;
      };
      return content.map((c) => c.text ?? "").join("\n");
    }
  }));
}

// ─────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────

/** Thrown when the user rejects a destructive tool call — stops the agent run */
export class ToolRejectedError extends Error {
  readonly toolName: string;
  constructor(toolName: string) {
    super(`Tool "${toolName}" was rejected by the user.`);
    this.name = "ToolRejectedError";
    this.toolName = toolName;
  }
}

// ─────────────────────────────────────────────
// Puter tool format
// ─────────────────────────────────────────────

function toExternalTool(t: ToolDefinition) {
  return {
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  };
}

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

// ─────────────────────────────────────────────
// Token estimation & context compaction
// ─────────────────────────────────────────────

/** Rough token estimate: ~4 characters per token (GPT-family heuristic) */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/** Estimate total tokens for an array of chat messages */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const estimateMessagesTokens = (messages: any[]): number => {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content ?? "");
    if (m.tool_calls) {
      total += estimateTokens(JSON.stringify(m.tool_calls));
    }
  }
  return total;
};

const COMPACTION_SYSTEM_PROMPT = `You are a context compactor. Summarize the following conversation history into a concise but complete summary that preserves:
- The user's original request and intent
- Key decisions, findings, and results from tool calls
- Important data points (IDs, names, values) that may be needed for follow-up
- Any errors or issues encountered
- The current state of the task

Be thorough with facts but extremely concise with prose. Use bullet points. Do NOT include raw tool output — summarize the relevant results only. Output ONLY the summary, no preamble.`;

// ─────────────────────────────────────────────
// Composable
// ─────────────────────────────────────────────

export const useAgent = (options: AgentOptions = {}) => {
  const {
    tools: localTools = [],
    mcpServers = [],
    systemPrompt: defaultSystemPrompt = "You are a helpful AI assistant.",
    keepHistory = true,
    compactionThreshold: rawThreshold = 80000,
    onToolCall,
    onToolStart,
    onToolResult,
    onToolApprovalRequest,
    onCompaction,
    onCompactionRequest,
    ephemeralTools = []
  } = options;

  /** Resolve threshold — supports both static number and getter for reactive settings */
  const getCompactionThreshold = (): number =>
    typeof rawThreshold === "function" ? rawThreshold() : rawThreshold;

  const { chatCompletion } = useAiProvider();

  const loading = ref(false);
  const error = ref<unknown>(null);
  const history = ref<AgentMessage[]>([]);
  const currentResponse = ref("");
  const mcpToolsLoaded = ref(false);
  /** Tracks the most recent compaction event for UI display */
  const lastCompaction = ref<{ summary: string; compactedCount: number } | null>(null);
  /** Estimated token count of the current context (updated each run iteration) */
  const contextTokens = ref(0);

  const toolRegistry = ref<Map<string, ToolDefinition>>(
    new Map(localTools.map((t) => [t.name, t]))
  );

  // ── MCP bootstrap ───────────────────────────
  const loadMCPTools = async () => {
    if (mcpToolsLoaded.value || mcpServers.length === 0) return;
    console.log(
      "[useAgent] Loading MCP tools from",
      mcpServers.length,
      "server(s)…"
    );

    const results = await Promise.allSettled(mcpServers.map(fetchMCPTools));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        r.value.forEach((t) => toolRegistry.value.set(t.name, t));
        console.log(
          `[useAgent] MCP "${mcpServers[i]!.name}" — ${r.value.length} tool(s) loaded`
        );
      } else {
        console.warn(
          `[useAgent] MCP "${mcpServers[i]!.name}" failed:`,
          r.reason
        );
      }
    });

    mcpToolsLoaded.value = true;
  };

  // ── History helpers ─────────────────────────
  const pushMessage = (msg: Omit<AgentMessage, "timestamp">) => {
    const full: AgentMessage = { ...msg, timestamp: new Date() };
    history.value.push(full);
    return full;
  };

  const clearHistory = () => {
    history.value = [];
    lastCompaction.value = null;
    contextTokens.value = 0;
  };

  /**
   * Build the messages array for the API call.
   *
   * The OpenAI-compatible format requires:
   *   1. An assistant message that includes `tool_calls` when it requested tools.
   *   2. Immediately after, one `tool` message per call, each with a matching
   *      `tool_call_id` and the result in `content`.
   *
   * Compaction messages are included as system reminders so the model sees
   * the summarized context without breaking the message format.
   */
  const buildMessages = (systemPrompt: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgs: any[] = [{ role: "system", content: systemPrompt }];

    const source = keepHistory ? history.value : history.value.slice(-20);

    for (const m of source) {
      if (m.role === "compaction") {
        // Inject compacted context as a system message so the model
        // treats it as authoritative prior context
        msgs.push({
          role: "system",
          content: `[Context Summary — the following summarizes earlier conversation that was compacted to save context space]\n\n${m.content}`
        });
      } else if (m.role === "assistant") {
        if (m.toolCalls && m.toolCalls.length > 0) {
          msgs.push({
            role: "assistant",
            content: m.content ?? "",
            tool_calls: m.toolCalls
          });
        } else {
          msgs.push({ role: "assistant", content: m.content });
        }
      } else if (m.role === "tool") {
        msgs.push({
          role: "tool",
          tool_call_id: m.toolCallId,
          content: m.content
        });
      } else {
        msgs.push({ role: m.role, content: m.content });
      }
    }

    return msgs;
  };

  /** Recompute contextTokens from current history (call after any history mutation outside run()) */
  const updateContextTokens = () => {
    const msgs = buildMessages(defaultSystemPrompt);
    contextTokens.value = estimateMessagesTokens(msgs);
  };

  // ── Context compaction ──────────────────────

  /**
   * Compacts older history messages into a summary when the estimated
   * token count exceeds the threshold. Keeps the most recent messages
   * intact to preserve the active tool-calling context.
   *
   * Returns true if compaction was performed.
   */
  const compactIfNeeded = async (systemPrompt: string): Promise<boolean> => {
    const messages = buildMessages(systemPrompt);
    const tokenEstimate = estimateMessagesTokens(messages);
    const threshold = getCompactionThreshold();

    if (tokenEstimate < threshold) {
      return false;
    }

    // If caller wants to ask user before compacting, await their decision
    if (onCompactionRequest) {
      const approved = await onCompactionRequest(tokenEstimate, threshold);
      if (!approved) {
        console.log("[useAgent] Compaction skipped by user.");
        return false;
      }
    }

    console.log(
      `[useAgent] Context at ~${tokenEstimate} tokens (threshold: ${threshold}). Compacting…`
    );

    // Find a safe split point: keep the last few complete turns
    // (a "turn" = user + assistant + any tool messages in between).
    // We keep at least the last 6 messages to preserve active context.
    const KEEP_RECENT = 6;
    const historyLen = history.value.length;

    if (historyLen <= KEEP_RECENT) {
      // Not enough messages to compact meaningfully
      return false;
    }

    // Walk backwards to find a clean split point (before a user message)
    let splitIdx = historyLen - KEEP_RECENT;
    while (splitIdx > 0 && history.value[splitIdx]!.role !== "user") {
      splitIdx--;
    }

    if (splitIdx <= 0) {
      return false;
    }

    const toCompact = history.value.slice(0, splitIdx);
    const toKeep = history.value.slice(splitIdx);

    // Build a text representation of the messages to compact
    const compactionInput = toCompact
      .filter((m) => m.role !== "compaction")
      .map((m) => {
        if (m.role === "user") return `User: ${m.content}`;
        if (m.role === "assistant") {
          const toolInfo = m.toolCalls?.length
            ? ` [called tools: ${m.toolCalls.map((tc) => tc.function.name).join(", ")}]`
            : "";
          return `Assistant${toolInfo}: ${m.content}`;
        }
        if (m.role === "tool") return `Tool (${m.toolName ?? "unknown"}): ${m.content.slice(0, 2000)}`;
        return `${m.role}: ${m.content}`;
      })
      .join("\n\n");

    // Include any existing compaction summaries so they are re-summarized too
    const existingCompactions = toCompact
      .filter((m) => m.role === "compaction")
      .map((m) => `Previous summary: ${m.content}`)
      .join("\n\n");

    const fullInput = existingCompactions
      ? `${existingCompactions}\n\n---\n\n${compactionInput}`
      : compactionInput;

    try {
      const summaryResponse = await chatCompletion([
        { role: "system", content: COMPACTION_SYSTEM_PROMPT },
        { role: "user", content: fullInput }
      ]);

      const summary = summaryResponse.content ?? "[compaction failed]";
      const compactedCount = toCompact.filter((m) => m.role !== "compaction").length;

      console.log(
        `[useAgent] Compacted ${compactedCount} messages into summary (${summary.length} chars)`
      );

      // Replace history: compaction summary + recent messages
      history.value = [
        {
          role: "compaction" as const,
          content: summary,
          compactedCount,
          timestamp: new Date()
        },
        ...toKeep
      ];

      lastCompaction.value = { summary, compactedCount };
      onCompaction?.(summary, compactedCount);
      return true;
    } catch (compactionErr) {
      console.error("[useAgent] Compaction failed:", compactionErr);
      return false;
    }
  };

  // ── Ephemeral tool pruning ───────────────────
  /**
   * After a final answer is delivered, strip assistant messages whose
   * toolCalls are exclusively ephemeral tools, and the matching tool result
   * messages. This prevents skill-loader content from accumulating in context
   * across unrelated follow-up turns.
   */
  const pruneEphemeralTools = (toolNames: string[]) => {
    const ephemeralSet = new Set(toolNames);

    // Collect IDs of tool result messages that are ephemeral
    const ephemeralToolCallIds = new Set<string>();

    for (const msg of history.value) {
      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        const allEphemeral = msg.toolCalls.every((tc) =>
          ephemeralSet.has(tc.function.name)
        );
        if (allEphemeral) {
          msg.toolCalls.forEach((tc) => ephemeralToolCallIds.add(tc.id));
        }
      }
    }

    if (ephemeralToolCallIds.size === 0) return;

    // Remove tool result messages with matching toolCallIds
    // and assistant messages whose ALL tool_calls were ephemeral
    history.value = history.value.filter((msg) => {
      if (msg.role === "tool" && msg.toolCallId && ephemeralToolCallIds.has(msg.toolCallId)) {
        return false;
      }
      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        const allEphemeral = msg.toolCalls.every((tc) =>
          ephemeralSet.has(tc.function.name)
        );
        if (allEphemeral) return false;
      }
      return true;
    });

    console.log(
      `[useAgent] Pruned ephemeral tool messages (${toolNames.join(", ")}). History now ${history.value.length} messages.`
    );

    // Recompute token count after pruning
    updateContextTokens();
  };

  // ── Agentic run loop ────────────────────────
  const run = async (
    prompt: string,
    runOptions: AgentRunOptions = {}
  ): Promise<string> => {
    const { systemPrompt = defaultSystemPrompt, maxIterations = 10 } =
      runOptions;

    loading.value = true;
    error.value = null;
    currentResponse.value = "";

    console.log("[useAgent] run() →", prompt);

    try {
      await loadMCPTools();

      pushMessage({ role: "user", content: prompt });

      const allTools = Array.from(toolRegistry.value.values()).map(
        toExternalTool
      );
      console.log(
        `[useAgent] Registry: [${allTools.map((t) => t.function.name).join(", ") || "no tools"}]`
      );

      let iterations = 0;

      while (iterations < maxIterations) {
        iterations++;

        // ── Check if context needs compaction ──
        await compactIfNeeded(systemPrompt);

        const messages = buildMessages(systemPrompt);
        contextTokens.value = estimateMessagesTokens(messages);

        console.log(`[useAgent] ── Iteration ${iterations} ──`);
        console.log(
          "[useAgent] Messages being sent:",
          JSON.stringify(messages, null, 2)
        );

        const chatOptions: Record<string, unknown> = {};
        if (allTools.length > 0) {
          chatOptions.tools = allTools;
        }

        let response: { content: string | null; tool_calls: ToolCall[] };
        try {
          response = await chatCompletion(messages, { tools: allTools.length > 0 ? allTools : undefined });
          console.log(
            "[useAgent] Provider response:",
            JSON.stringify(response, null, 2)
          );
        } catch (providerErr) {
          console.error("[useAgent] chatCompletion threw:", providerErr);
          throw providerErr;
        }

        // Response is already normalised by the provider adapter
        const assistantText = response.content ?? "";
        const toolCalls: ToolCall[] = response.tool_calls;

        console.log(
          `[useAgent] assistantText="${assistantText}" | toolCalls=${toolCalls.length}`
        );

        // ── No tool calls → final answer ───────
        if (toolCalls.length === 0) {
          pushMessage({
            role: "assistant",
            content: assistantText || "[no response]"
          });
          currentResponse.value = assistantText;
          // Prune ephemeral tool messages so they don't bloat future context
          if (ephemeralTools.length > 0) {
            pruneEphemeralTools(ephemeralTools);
          }
          console.log("[useAgent] ✓ Final answer returned");
          return assistantText;
        }

        // ── Push assistant message WITH tool_calls so buildMessages can
        //    replay them correctly on the next iteration. ─────────────
        history.value.push({
          role: "assistant",
          content: assistantText || "",
          toolCalls, // ← key fix: stored for replay
          timestamp: new Date()
        });

        // ── Execute tool calls ──────────────────
        await Promise.all(
          toolCalls.map(async (call) => {
            const toolName = call.function.name;
            const toolInput = (() => {
              try {
                return typeof call.function.arguments === "string"
                  ? JSON.parse(call.function.arguments)
                  : (call.function.arguments as Record<string, unknown>);
              } catch {
                return {};
              }
            })();

            console.log(`[useAgent] → Calling tool "${toolName}"`, toolInput);
            onToolCall?.(toolName, toolInput);

            // ── Approval gate for destructive tools ──
            const tool = toolRegistry.value.get(toolName);

            if (tool?.destructive && onToolApprovalRequest) {
              const approved = await onToolApprovalRequest(toolName, toolInput);
              if (!approved) {
                throw new ToolRejectedError(toolName);
              }
            }

            onToolStart?.(toolName, toolInput);

            let resultContent: string;

            if (!tool) {
              resultContent = JSON.stringify({
                error: `Unknown tool: ${toolName}`
              });
              console.warn(
                `[useAgent] Tool "${toolName}" not found in registry!`
              );
            } else {
              try {
                const result = await tool.execute(toolInput);
                resultContent =
                  typeof result === "string" ? result : JSON.stringify(result);
                console.log(
                  `[useAgent] ← Tool "${toolName}" result:`,
                  resultContent
                );
                onToolResult?.(toolName, result);
              } catch (execErr) {
                resultContent = JSON.stringify({ error: String(execErr) });
                console.error(`[useAgent] Tool "${toolName}" threw:`, execErr);
                onToolResult?.(toolName, { error: String(execErr) });
              }
            }

            // Push with toolCallId so buildMessages can match it to the
            // tool_call that requested it.
            pushMessage({
              role: "tool",
              content: resultContent,
              toolName,
              toolCallId: call.id // ← key fix: was already stored, now actually used
            });
          })
        );
        // Loop — tool results now in history, re-query model
      }

      const fallback = "[Max iterations reached without a final answer.]";
      console.warn("[useAgent]", fallback);
      pushMessage({ role: "assistant", content: fallback });
      currentResponse.value = fallback;
      return fallback;
    } catch (err) {
      error.value = err;
      console.error("[useAgent] run() fatal error:", err);
      // Re-throw ToolRejectedError so callers can detect rejection vs other errors
      if (err instanceof ToolRejectedError) {
        throw err;
      }
      return "";
    } finally {
      loading.value = false;
    }
  };

  // ── Simple one-shot chat ─────────────────────
  const chat = async (
    prompt: string,
    systemPrompt = defaultSystemPrompt
  ): Promise<string> => {
    loading.value = true;
    error.value = null;
    console.log("[useAgent] chat() →", prompt);
    try {
      const response = await chatCompletion([
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ]);
      const text = response.content ?? "";
      console.log("[useAgent] chat() ←", text);
      return text;
    } catch (err) {
      error.value = err;
      console.error("[useAgent] chat() error:", err);
      return "";
    } finally {
      loading.value = false;
    }
  };

  // ── Tool management ──────────────────────────
  const registerTool = (tool: ToolDefinition) => {
    toolRegistry.value.set(tool.name, tool);
    console.log(`[useAgent] Registered tool: ${tool.name}`);
  };

  const unregisterTool = (name: string) => {
    toolRegistry.value.delete(name);
  };

  const getTools = () => Array.from(toolRegistry.value.values());

  const addMCPServer = async (server: MCPServer) => {
    try {
      const tools = await fetchMCPTools(server);
      tools.forEach((t) => toolRegistry.value.set(t.name, t));
      console.log(
        `[useAgent] addMCPServer "${server.name}": ${tools.length} tool(s)`
      );
    } catch (err) {
      console.error(`[useAgent] addMCPServer "${server.name}" failed:`, err);
      throw err;
    }
  };

  return {
    run,
    chat,
    registerTool,
    unregisterTool,
    getTools,
    addMCPServer,
    loadMCPTools,
    updateContextTokens,
    getCompactionThreshold,
    history: readonly(history),
    clearHistory,
    loading: readonly(loading),
    error: readonly(error),
    currentResponse: readonly(currentResponse),
    mcpToolsLoaded: readonly(mcpToolsLoaded),
    lastCompaction: readonly(lastCompaction),
    contextTokens: readonly(contextTokens)
  };
};
