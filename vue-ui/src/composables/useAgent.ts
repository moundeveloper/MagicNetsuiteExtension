import { ref, readonly } from "vue";
import { puter } from "@heyputer/puter.js";

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
  onToolResult?: (name: string, result: unknown) => void;
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
    onToolResult
  } = options;

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

  const buildMessages = (systemPrompt: string) => [
    { role: "system", content: systemPrompt },
    ...(keepHistory ? history.value : history.value.slice(-1))
      // 🚨 CRITICAL FIX: exclude tool messages from API
      .filter((m) => m.role !== "tool")
      .map((m) => ({
        role: m.role,
        content: m.content
      }))
  ];

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

        // puter.ai.chat(messages, options)
        // tools MUST be in the options object (2nd arg)
        const chatOptions: Record<string, unknown> = {};
        if (allTools.length > 0) {
          chatOptions.tools = allTools;
        }

        let response: unknown;
        try {
          response = await puter.ai.chat(messages, chatOptions);
          console.log(
            "[useAgent] Puter response:",
            JSON.stringify(response, null, 2)
          );
        } catch (puterErr) {
          console.error("[useAgent] puter.ai.chat threw:", puterErr);
          throw puterErr;
        }

        // Normalise: puter may wrap in { message: {...} } or return the message directly
        const msg =
          (
            response as {
              message?: { content?: string | null; tool_calls?: ToolCall[] };
            }
          )?.message ??
          (response as { content?: string | null; tool_calls?: ToolCall[] });

        const assistantText: string = msg?.content ?? "";
        const toolCalls: ToolCall[] =
          (msg as { tool_calls?: ToolCall[] })?.tool_calls ?? [];

        console.log(
          `[useAgent] assistantText="${assistantText}" | toolCalls=${toolCalls.length}`
        );

        // ── No tool calls → final answer ───────
        if (toolCalls.length === 0) {
          pushMessage({
            role: "assistant",
            content: assistantText || "[calling tools]"
          });
          currentResponse.value = assistantText;
          console.log("[useAgent] ✓ Final answer returned");
          return assistantText;
        }

        // ── Execute tool calls ──────────────────
        pushMessage({ role: "assistant", content: assistantText || "" });

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

            const tool = toolRegistry.value.get(toolName);
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

            pushMessage({
              role: "tool",
              content: resultContent,
              toolName,
              toolCallId: call.id
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
      const response = await puter.ai.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ]);
      const text: string =
        (response as { message?: { content?: string } })?.message?.content ??
        (response as { content?: string })?.content ??
        String(response);
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
