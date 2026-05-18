/**
 * useAiProvider
 *
 * Thin adapter layer that normalises calls to different AI backends
 * (Ollama, OpenCode, GitHub Copilot, OpenRouter) into a single `chatCompletion`
 * function that returns an OpenAI-compatible message object.
 *
 * Consumers only need to call `chatCompletion(messages, options)` —
 * the active provider is read from chrome.storage.sync via settingsState.
 */

import { Ollama } from "ollama/browser";
import { useSettings } from "../states/settingsState";

// ─────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

export interface ChatCompletionOptions {
  tools?: unknown[];
  model?: string;
  signal?: AbortSignal;
}

export interface NormalisedResponse {
  content: string | null;
  tool_calls: ToolCall[];
  /** Extracted reasoning/thinking content — display-only, never sent back to the model */
  thinking?: string;
}

// ─────────────────────────────────────────────
// Thinking / Reasoning helpers
// ─────────────────────────────────────────────

/**
 * Strips `<think>...</think>` tags that reasoning models (deepseek-r1, qwq, etc.)
 * emit inline. Also handles models that emit the tag mid-string rather than at
 * position 0 (some models write a brief preamble before the think block).
 * Always applied to Ollama responses — models that don't use thinking
 * simply won't produce the tags, so this is a safe no-op for them.
 */
const extractThinkTags = (
  content: string
): { thinking?: string; content: string } => {
  // Match <think>...</think> anywhere in the string (not just at ^)
  const thinkRegex = /<think>([\s\S]*?)<\/think>\s*/g;
  const thinkBlocks: string[] = [];
  const stripped = content.replace(thinkRegex, (_, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed) thinkBlocks.push(trimmed);
    return "";
  });
  const cleaned = stripped.trim();
  if (thinkBlocks.length > 0) {
    return { thinking: thinkBlocks.join("\n\n"), content: cleaned };
  }
  return { content: cleaned || content };
};

/**
 * Parse Claude extended-thinking response content, which may be either:
 *   - a plain string (Copilot hides thinking blocks)
 *   - an array of `{ type: "thinking", thinking: "..." }` and `{ type: "text", text: "..." }` blocks
 */
const extractClaudeThinking = (
  content: unknown
): { text: string; thinking?: string } => {
  if (typeof content === "string") {
    // Some providers surface thinking inside the string using <think> tags
    const parsed = extractThinkTags(content);
    return { text: parsed.content, thinking: parsed.thinking };
  }
  if (!Array.isArray(content)) {
    return { text: content !== null && content !== undefined ? String(content) : "" };
  }
  let text = "";
  let thinking = "";
  for (const block of content as Array<{
    type?: string;
    text?: string;
    thinking?: string;
  }>) {
    if (block?.type === "thinking" && block.thinking) {
      thinking += (thinking ? "\n" : "") + block.thinking;
    } else if (block?.type === "text" && block.text) {
      text += block.text;
    }
  }
  return { text: text || "", thinking: thinking || undefined };
};

/** Returns true for Claude model IDs (matches "claude" case-insensitively). */
const isClaudeModel = (model: string): boolean => /claude/i.test(model);

/**
 * Returns true for OpenAI reasoning models (o1, o3, o4 with optional suffix).
 * Used to add `reasoning_effort` instead of the Anthropic thinking param.
 */
const isReasoningModel = (model: string): boolean =>
  /\bo[1-4](-mini|-preview|-high)?\b/i.test(model);

// ─────────────────────────────────────────────
// Ollama adapter (using ollama/browser library)
// ─────────────────────────────────────────────

const ollamaChat = async (
  messages: ChatMessage[],
  options: ChatCompletionOptions,
  baseUrl: string,
  model: string
): Promise<NormalisedResponse> => {
  const client = new Ollama({ host: baseUrl });

  const response = await client.chat({
    model,
    messages: messages as Parameters<typeof client.chat>[0]["messages"],
    stream: false,
    ...(options.tools && options.tools.length > 0
      ? { tools: options.tools as Parameters<typeof client.chat>[0]["tools"] }
      : {}),
    ...(options.signal ? { signal: options.signal } : {})
  });

  const rawMsg = response.message;

  // Ollama ToolCall has no `id` — generate one; arguments is already an object
  const toolCalls: ToolCall[] =
    rawMsg?.tool_calls?.map((tc, idx) => ({
      id: `ollama-tc-${idx}-${Date.now()}`,
      type: "function" as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments as Record<string, unknown>
      }
    })) ?? [];

  // Always parse <think>...</think> — reasoning models emit them regardless of any flag.
  // For non-thinking models this is a safe no-op.
  const { thinking, content } = extractThinkTags(rawMsg?.content ?? "");

  return {
    content: content || null,
    tool_calls: toolCalls,
    thinking
  };
};

// ─────────────────────────────────────────────
// GitHub Copilot adapter
// ─────────────────────────────────────────────

/** VS Code's public GitHub OAuth client ID — used by many open-source tools. */
export const COPILOT_CLIENT_ID = "01ab8ac9400c4e429b23";

// ─────────────────────────────────────────────
// Chain-of-thought injection
// ─────────────────────────────────────────────

/**
 * Returns true when the provider/model combination does NOT have native thinking
 * support (Claude extended thinking or Ollama <think> tags).
 * For these providers we inject an explicit CoT instruction into the system prompt
 * so the model writes its reasoning inside <think>...</think> tags, which we then
 * parse and surface in the UI.
 */
const needsCoTInjection = (provider: string, copilotModel: string): boolean => {
  if (provider === "copilot") {
    // Claude and o1/o3/o4 handle reasoning natively — no injection needed
    return !isClaudeModel(copilotModel) && !isReasoningModel(copilotModel);
  }
  if (provider === "openrouter") {
    // Inject CoT for non-reasoning, non-Claude models
    return !isClaudeModel(copilotModel) && !isReasoningModel(copilotModel);
  }
  return false; // ollama parses <think> natively; opencode is server-managed
};

const COT_SYSTEM_INSTRUCTION =
  "\n\n--- Thinking Mode ---\n" +
  "Reason step by step inside <think>...</think> tags before your final answer. " +
  "Keep the reasoning block focused and concise — cover only what is needed to reach a correct answer. " +
  "Your response after the closing </think> tag should be clean and concise, with no repeated reasoning.";

/**
 * Prepend a CoT instruction to the first system message so the model knows
 * to output its reasoning in <think> tags, which we then strip and display
 * separately (token-efficient: reasoning never gets sent back to the model).
 */
const injectCoTSystemPrompt = (messages: ChatMessage[]): ChatMessage[] =>
  messages.map((m, i) =>
    i === 0 && m.role === "system"
      ? { ...m, content: (m.content ?? "") + COT_SYSTEM_INSTRUCTION }
      : m
  );
/** In-memory Copilot API token cache (expires ~30 min). */
let cachedCopilotApiToken: { token: string; expiresAt: number } | null = null;

/**
 * Exchange the stored GitHub OAuth token for a short-lived Copilot API token.
 * Refreshes automatically when within 60 s of expiry.
 */
const getCopilotApiToken = async (githubToken: string): Promise<string> => {
  const now = Date.now();
  if (cachedCopilotApiToken && cachedCopilotApiToken.expiresAt > now + 60_000) {
    return cachedCopilotApiToken.token;
  }

  const res = await fetch("https://api.github.com/copilot_internal/v2/token", {
    headers: {
      Authorization: `token ${githubToken}`,
      "User-Agent": "MagicNetsuiteExtension"
    }
  });

  if (!res.ok) {
    throw new Error(`Copilot token refresh failed (${res.status})`);
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  cachedCopilotApiToken = {
    token: data.token,
    expiresAt: new Date(data.expires_at).getTime()
  };
  return cachedCopilotApiToken.token;
};

/**
 * Fetch available GitHub Copilot chat models.
 * Exported so SettingsView can call it after authentication.
 */
export const fetchCopilotModels = async (
  githubToken: string
): Promise<Array<{ id: string; name: string }>> => {
  const copilotToken = await getCopilotApiToken(githubToken);
  const res = await fetch("https://api.githubcopilot.com/models", {
    headers: {
      Authorization: `Bearer ${copilotToken}`,
      "Editor-Version": "vscode/1.95.3",
      "Copilot-Integration-Id": "vscode-chat",
      "User-Agent": "MagicNetsuiteExtension"
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Copilot models (${res.status})`);
  }

  const data = (await res.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      capabilities?: { type?: string };
    }>;
  };

  // Keep only chat-capable models; fall back to all if no type info
  const all = data.data ?? [];
  const chatModels = all.filter(
    (m) => !m.capabilities?.type || m.capabilities.type === "chat"
  );
  return (chatModels.length > 0 ? chatModels : all).map((m) => ({
    id: m.id,
    name: m.name ?? m.id
  }));
};

const copilotChat = async (
  messages: ChatMessage[],
  options: ChatCompletionOptions,
  githubToken: string,
  model: string,
  thinkingMode = false,
  thinkingBudget = 8000
): Promise<NormalisedResponse> => {
  const copilotToken = await getCopilotApiToken(githubToken);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${copilotToken}`,
    "Content-Type": "application/json",
    "Editor-Version": "vscode/1.95.3",
    "Editor-Plugin-Version": "copilot-chat/0.22.4",
    "Copilot-Integration-Id": "vscode-chat",
    "OpenAI-Intent": "conversation-panel",
    "User-Agent": "MagicNetsuiteExtension"
  };

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  // ── Thinking / Reasoning mode ──────────────────────────────────────────
  if (thinkingMode) {
    if (isClaudeModel(model)) {
      // Claude extended thinking: requires the interleaved-thinking beta header
      body.thinking = { type: "enabled", budget_tokens: thinkingBudget };
      headers["anthropic-beta"] = "interleaved-thinking-2025-05-14";
    } else if (isReasoningModel(model)) {
      // o1/o3/o4 models: map budget to a reasoning effort tier
      const effort =
        thinkingBudget >= 16000 ? "high" : thinkingBudget >= 4000 ? "medium" : "low";
      body.reasoning_effort = effort;
    }
    // For all other models (e.g. gpt-4o) there is no standard thinking param —
    // thinking mode has no API effect but the toggle still shows as active.
  }

  const res = await fetch("https://api.githubcopilot.com/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options.signal
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Copilot chat failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as {
    choices: Array<{
      message: {
        content: string | Array<{ type?: string; text?: string; thinking?: string }> | null;
        tool_calls?: Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };

  const msg = data.choices[0]?.message;

  // Content may be a string or a Claude content-block array (extended thinking)
  const { text: parsedText, thinking } = extractClaudeThinking(msg?.content);

  return {
    content: parsedText || null,
    tool_calls:
      msg?.tool_calls?.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.function.name, arguments: tc.function.arguments }
      })) ?? [],
    thinking
  };
};

// ─────────────────────────────────────────────
// OpenCode adapter (talks to `opencode serve`)
// ─────────────────────────────────────────────

/** Session ID reused for the lifetime of the page/extension context. */
let opencodeSessionId: string | null = null;

const opencodeChat = async (
  messages: ChatMessage[],
  options: ChatCompletionOptions,
  baseUrl: string,
  model?: string
): Promise<NormalisedResponse> => {
  // Ensure we have an active session
  if (!opencodeSessionId) {
    const sessionRes = await fetch(`${baseUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: options.signal
    });

    if (!sessionRes.ok) {
      throw new Error(
        `OpenCode: failed to create session (${sessionRes.status})`
      );
    }

    const session = (await sessionRes.json()) as { id: string };
    opencodeSessionId = session.id;
  }

  // Send only the latest user message — OpenCode maintains history in the session
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === "user");
  const text =
    typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : (lastUserMessage?.content ?? "");

  const msgRes = await fetch(
    `${baseUrl}/session/${opencodeSessionId}/message`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text }],
        tools: {},
        ...(model
          ? (() => {
              const sep = model.indexOf("/");
              if (sep === -1)
                return { model: { providerID: model, modelID: model } };
              return {
                model: {
                  providerID: model.slice(0, sep),
                  modelID: model.slice(sep + 1)
                }
              };
            })()
          : {})
      }),
      signal: options.signal
    }
  );

  if (!msgRes.ok) {
    // Session may have expired — reset and surface the error
    opencodeSessionId = null;
    const errText = await msgRes.text();
    throw new Error(`OpenCode: message failed (${msgRes.status}): ${errText}`);
  }

  const data = (await msgRes.json()) as {
    parts: Array<{ type: string; text?: string }>;
  };

  const textContent =
    data.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("\n") || null;

  return { content: textContent, tool_calls: [] };
};

// ─────────────────────────────────────────────
// OpenRouter adapter (OpenAI-compatible)
// ─────────────────────────────────────────────

/**
 * OpenRouter is a unified OpenAI-compatible API gateway.
 * Endpoint: https://openrouter.ai/api/v1/chat/completions
 * Default model: "openrouter/free" — randomly selects a free model that
 * supports the requested features (tool calling, etc.).
 */
const openrouterChat = async (
  messages: ChatMessage[],
  options: ChatCompletionOptions,
  apiKey: string,
  model: string,
  thinkingMode = false
): Promise<NormalisedResponse> => {
  const body: Record<string, unknown> = {
    model: model || "openrouter/free",
    messages,
    stream: false
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  // Thinking: map to :thinking variant suffix for supported models; otherwise
  // CoT injection handles it via the system prompt (already done upstream).
  if (thinkingMode && isReasoningModel(model)) {
    body.reasoning = { effort: "high" };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "HTTP-Referer": "https://magic-netsuite-extension",
    "X-OpenRouter-Title": "MagicNetsuiteExtension"
  };

  if (apiKey.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options.signal
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter chat failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as {
    choices: Array<{
      message: {
        content: string | null;
        tool_calls?: Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };

  const msg = data.choices[0]?.message;

  // Some free models (DeepSeek R1, etc.) emit <think> tags — parse them out.
  const { thinking, content } = extractThinkTags(msg?.content ?? "");

  return {
    content: content || null,
    tool_calls:
      msg?.tool_calls?.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.function.name, arguments: tc.function.arguments }
      })) ?? [],
    thinking
  };
};

// ─────────────────────────────────────────────
// Public composable
// ─────────────────────────────────────────────

/**
 * Returns a user-facing error string if the active provider is not properly
 * configured, or `null` if everything looks good.
 * Called before every chatCompletion so callers get a clear message instead
 * of a confusing network error.
 */
const getProviderConfigError = (settings: ReturnType<typeof useSettings>["settings"]): string | null => {
  const provider = settings.aiProvider;

  if (!provider) {
    return "No AI provider is selected. Please go to Settings → AI Provider to configure one.";
  }

  if (provider === "ollama") {
    if (!settings.ollamaBaseUrl?.trim()) {
      return "Ollama is not configured: Base URL is missing. Please go to Settings → AI Provider.";
    }
    if (!settings.ollamaModel?.trim()) {
      return "Ollama is not configured: no model selected. Please go to Settings → AI Provider.";
    }
    return null;
  }

  if (provider === "opencode") {
    if (!settings.opencodeBaseUrl?.trim()) {
      return "OpenCode is not configured: Base URL is missing. Please go to Settings → AI Provider.";
    }
    if (!settings.opencodeModel?.trim()) {
      return "OpenCode is not configured: no model selected. Please go to Settings → AI Provider and pick a model.";
    }
    return null;
  }

  if (provider === "copilot") {
    if (!settings.githubToken?.trim()) {
      return "GitHub Copilot is not authenticated. Please go to Settings → AI Provider to connect your GitHub account.";
    }
    return null;
  }

  if (provider === "openrouter") {
    // API key is optional for free models but strongly recommended for reliability
    return null;
  }

  // "puter" — always available, no auth needed
  return null;
};

export const useAiProvider = () => {
  const { settings } = useSettings();

  /**
   * Send a chat completion request using whichever provider is active in settings.
   * Throws a descriptive Error immediately if the provider is not configured,
   * rather than letting a confusing network failure surface later.
   */
  const chatCompletion = async (
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<NormalisedResponse> => {
    const configError = getProviderConfigError(settings);
    if (configError) {
      throw new Error(configError);
    }

    const provider = settings.aiProvider;

    // ── Chain-of-thought injection for providers without native thinking ──
    // When thinking mode is on but the provider can't natively surface reasoning
    // tokens, we inject a system-level instruction so the model writes its thinking
    // inside <think>...</think> tags. Those are then parsed out of the response and
    // shown as a collapsible "Reasoning" block — never fed back to the model.
    const effectiveMessages =
      settings.thinkingMode &&
      needsCoTInjection(
        provider,
        provider === "openrouter" ? (settings.openrouterModel || "openrouter/free") : (settings.copilotModel || "gpt-4o")
      )
        ? injectCoTSystemPrompt(messages)
        : messages;

    if (provider === "ollama") {
      return ollamaChat(
        effectiveMessages,
        options,
        settings.ollamaBaseUrl || "http://localhost:11434",
        options.model || settings.ollamaModel || "llama3.2"
      );
    }

    if (provider === "opencode") {
      return opencodeChat(
        effectiveMessages,
        options,
        settings.opencodeBaseUrl || "http://localhost:4096",
        settings.opencodeModel || undefined
      );
    }

    if (provider === "copilot") {
      return copilotChat(
        effectiveMessages,
        options,
        settings.githubToken,
        settings.copilotModel || "gpt-4o",
        settings.thinkingMode,
        settings.thinkingBudget
      );
    }

    if (provider === "openrouter") {
      return openrouterChat(
        effectiveMessages,
        options,
        settings.openrouterApiKey || "",
        settings.openrouterModel || "openrouter/free",
        settings.thinkingMode
      );
    }

    throw new Error(`Unknown AI provider: "${provider}". Please select a provider in Settings.`);
  };

  return { chatCompletion, settings };
};
