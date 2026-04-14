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
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  toolCallId?: string;
  // Stored so we can replay them in the next API call
  toolCalls?: ToolCall[];
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
  onToolCall?: (name: string, input: unknown) => void;
  onToolStart?: (name: string, input: unknown) => void;
  onToolResult?: (name: string, result: unknown) => void;
  /**
   * Called before executing any tool marked as `destructive: true`.
   * Must return a Promise<boolean> — true to approve, false to reject.
   * If rejected, the agent run stops immediately.
   */
  onToolApprovalRequest?: (name: string, input: unknown) => Promise<boolean>;
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
// Composable
// ─────────────────────────────────────────────

export const useAgent = (options: AgentOptions = {}) => {
  const {
    tools: localTools = [],
    mcpServers = [],
    systemPrompt: defaultSystemPrompt = "You are a helpful AI assistant.",
    keepHistory = true,
    onToolCall,
    onToolStart,
    onToolResult,
    onToolApprovalRequest
  } = options;

  const { chatCompletion } = useAiProvider();

  const loading = ref(false);
  const error = ref<unknown>(null);
  const history = ref<AgentMessage[]>([]);
  const currentResponse = ref("");
  const mcpToolsLoaded = ref(false);

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
  };

  /**
   * Build the messages array for the API call.
   *
   * The OpenAI-compatible format requires:
   *   1. An assistant message that includes `tool_calls` when it requested tools.
   *   2. Immediately after, one `tool` message per call, each with a matching
   *      `tool_call_id` and the result in `content`.
   *
   * Previously this function filtered out role:"tool" messages entirely, which
   * meant the model never saw its own tool results and kept looping.
   */
  const buildMessages = (systemPrompt: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgs: any[] = [{ role: "system", content: systemPrompt }];

    const source = keepHistory ? history.value : history.value.slice(-20);

    for (const m of source) {
      if (m.role === "assistant") {
        // If this assistant turn requested tool calls, include them so the
        // model knows what it asked for when it reads the tool results below.
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
        // Pass the tool result back with the matching id so the model can
        // correlate it with the tool_call it emitted.
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
        const messages = buildMessages(systemPrompt);

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
    history: readonly(history),
    clearHistory,
    loading: readonly(loading),
    error: readonly(error),
    currentResponse: readonly(currentResponse),
    mcpToolsLoaded: readonly(mcpToolsLoaded)
  };
};
