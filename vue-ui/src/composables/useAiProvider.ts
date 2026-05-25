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
  /** When provided, the response is streamed and each text delta is forwarded here. */
  onChunk?: (text: string) => void;
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

// ─────────────────────────────────────────────
// Shared OpenAI-compatible SSE streaming helper
// ─────────────────────────────────────────────

/**
 * Consumes an OpenAI-compatible SSE response stream.
 * Calls `onChunk` for each visible text delta (think-block content is suppressed).
 * Accumulates and returns the full NormalisedResponse when the stream ends.
 */
const streamOpenAICompatible = async (
  res: Response,
  onChunk: (text: string) => void
): Promise<NormalisedResponse> => {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let rawContent = "";
  const toolCallsAccum = new Map<number, { id: string; name: string; arguments: string }>();

  // <think> block streaming filter — suppress reasoning tokens from the live display
  let inThink = false;

  const emitVisible = (text: string) => {
    let remaining = text;
    while (remaining.length > 0) {
      if (inThink) {
        const closeIdx = remaining.indexOf("</think>");
        if (closeIdx === -1) return; // still inside think block, discard
        inThink = false;
        remaining = remaining.slice(closeIdx + "</think>".length);
      } else {
        const openIdx = remaining.indexOf("<think>");
        if (openIdx === -1) { onChunk(remaining); return; }
        if (openIdx > 0) onChunk(remaining.slice(0, openIdx));
        inThink = true;
        remaining = remaining.slice(openIdx + "<think>".length);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop()!;

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      let chunk: {
        choices?: Array<{
          delta?: {
            content?: string | null;
            tool_calls?: Array<{
              index: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      try { chunk = JSON.parse(data); } catch { continue; }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        rawContent += delta.content;
        emitVisible(delta.content);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallsAccum.get(tc.index) ?? { id: "", name: "", arguments: "" };
          if (tc.id) existing.id += tc.id;
          if (tc.function?.name) existing.name += tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          toolCallsAccum.set(tc.index, existing);
        }
      }
    }
  }

  const { thinking, content } = extractThinkTags(rawContent);
  const toolCalls = Array.from(toolCallsAccum.entries())
    .sort(([a], [b]) => a - b)
    .map(([, tc]) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments }
    }));

  return { content: content || null, tool_calls: toolCalls, thinking };
};


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
    stream: !!options.onChunk
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

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

  // ── Streaming path ──────────────────────────────────────────────────────
  if (options.onChunk) {
    return streamOpenAICompatible(res, options.onChunk);
  }

  // ── Non-streaming path ──────────────────────────────────────────────────
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

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_FREE_MODEL = "openrouter/free";
const OPENROUTER_MAX_RECOVERY_ATTEMPTS = 6;

const STATIC_OPENROUTER_FREE_FALLBACKS = [
  OPENROUTER_FREE_MODEL,
  "deepseek/deepseek-chat-v3-0324:free",
  "deepseek/deepseek-r1-0528:free",
  "qwen/qwen3-235b-a22b:free",
  "qwen/qwen3-30b-a3b:free",
  "mistralai/mistral-small-3.2-24b-instruct:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-27b-it:free"
];

interface OpenRouterErrorPayload {
  error?: {
    message?: string;
    code?: number | string;
    metadata?: {
      raw?: string;
      provider_name?: string;
      retry_after_seconds?: number;
      retry_after_seconds_raw?: number;
      is_byok?: boolean;
    };
  };
}

interface OpenRouterModelInfo {
  id?: string;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
  supported_parameters?: string[];
}

class OpenRouterChatError extends Error {
  status: number;
  bodyText: string;
  model: string;
  retryAfterSeconds?: number;
  recoverable: boolean;

  constructor(params: {
    status: number;
    bodyText: string;
    model: string;
    retryAfterSeconds?: number;
    recoverable: boolean;
  }) {
    super(`OpenRouter chat failed (${params.status}) for ${params.model}: ${params.bodyText}`);
    this.name = "OpenRouterChatError";
    this.status = params.status;
    this.bodyText = params.bodyText;
    this.model = params.model;
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.recoverable = params.recoverable;
  }
}

let openRouterFreeModelsCache: Partial<
  Record<"all" | "tools", { fetchedAt: number; models: string[] }>
> = {};

const isAbortError = (err: unknown): boolean =>
  err instanceof DOMException && err.name === "AbortError";

const isOpenRouterFreeModel = (model: string): boolean =>
  model === OPENROUTER_FREE_MODEL || model.endsWith(":free");

const openRouterHeaders = (apiKey: string): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "HTTP-Referer": "https://magic-netsuite-extension",
    "X-OpenRouter-Title": "MagicNetsuiteExtension"
  };

  if (apiKey.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }

  return headers;
};

const parseOpenRouterError = (
  status: number,
  bodyText: string
): {
  retryAfterSeconds?: number;
  recoverable: boolean;
} => {
  let payload: OpenRouterErrorPayload | null = null;
  try {
    payload = JSON.parse(bodyText) as OpenRouterErrorPayload;
  } catch {
    payload = null;
  }

  const metadata = payload?.error?.metadata;
  const retryAfterSeconds =
    typeof metadata?.retry_after_seconds === "number"
      ? metadata.retry_after_seconds
      : typeof metadata?.retry_after_seconds_raw === "number"
        ? metadata.retry_after_seconds_raw
        : undefined;

  const errorText = [
    payload?.error?.message,
    payload?.error?.code,
    metadata?.raw,
    bodyText
  ]
    .filter((part) => part !== undefined && part !== null)
    .join(" ");

  const recoverable =
    status === 429 ||
    status === 408 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /temporar|rate.?limit|too many requests|provider returned error|upstream/i.test(
      errorText
    );

  return { retryAfterSeconds, recoverable };
};

const signalAwareSleep = async (
  ms: number,
  signal?: AbortSignal
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    let timeout = 0;

    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };

    timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });

const numericPriceIsZero = (value: string | number | undefined): boolean => {
  if (value === undefined) return true;
  const asNumber = typeof value === "number" ? value : Number(value);
  return Number.isFinite(asNumber) && asNumber === 0;
};

const supportsOpenRouterTools = (
  model: OpenRouterModelInfo,
  needsTools: boolean
): boolean => {
  if (!needsTools) return true;
  if (!Array.isArray(model.supported_parameters)) return true;
  return (
    model.supported_parameters.includes("tools") ||
    model.supported_parameters.includes("tool_choice")
  );
};

const fetchOpenRouterFreeFallbackModels = async (
  apiKey: string,
  needsTools: boolean,
  signal?: AbortSignal
): Promise<string[]> => {
  const cacheKey = needsTools ? "tools" : "all";
  const cached = openRouterFreeModelsCache[cacheKey];
  if (
    cached &&
    Date.now() - cached.fetchedAt < 10 * 60 * 1000
  ) {
    return cached.models;
  }

  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: openRouterHeaders(apiKey),
    signal
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { data?: OpenRouterModelInfo[] };
  const models = (data.data ?? [])
    .filter((modelInfo) => {
      const id = modelInfo.id ?? "";
      const isFreeById = id.endsWith(":free");
      const isFreeByPrice =
        numericPriceIsZero(modelInfo.pricing?.prompt) &&
        numericPriceIsZero(modelInfo.pricing?.completion);
      return (
        id &&
        (isFreeById || isFreeByPrice) &&
        supportsOpenRouterTools(modelInfo, needsTools)
      );
    })
    .map((modelInfo) => modelInfo.id!)
    .filter(Boolean);

  const offset = models.length
    ? Math.floor(Date.now() / 60000) % models.length
    : 0;
  const rotated = models.slice(offset).concat(models.slice(0, offset));

  openRouterFreeModelsCache[cacheKey] = {
    fetchedAt: Date.now(),
    models: rotated
  };
  return rotated;
};

const uniqueModels = (models: string[]): string[] =>
  Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));

const buildOpenRouterRecoveryModels = async (
  preferredModel: string,
  apiKey: string,
  needsTools: boolean,
  signal?: AbortSignal
): Promise<string[]> => {
  const model = preferredModel || OPENROUTER_FREE_MODEL;
  const canUseFreeFallbacks = isOpenRouterFreeModel(model) || !apiKey.trim();

  if (!canUseFreeFallbacks) return [model];

  let dynamicFallbacks: string[] = [];
  try {
    dynamicFallbacks = await fetchOpenRouterFreeFallbackModels(
      apiKey,
      needsTools,
      signal
    );
  } catch (err) {
    if (isAbortError(err)) throw err;
  }

  return uniqueModels([
    model,
    model === OPENROUTER_FREE_MODEL ? "" : OPENROUTER_FREE_MODEL,
    ...dynamicFallbacks,
    ...(needsTools
      ? [OPENROUTER_FREE_MODEL]
      : STATIC_OPENROUTER_FREE_FALLBACKS)
  ]).slice(0, OPENROUTER_MAX_RECOVERY_ATTEMPTS);
};

const openrouterChatOnce = async (
  messages: ChatMessage[],
  options: ChatCompletionOptions,
  apiKey: string,
  model: string,
  thinkingMode = false
): Promise<NormalisedResponse> => {
  const body: Record<string, unknown> = {
    model: model || OPENROUTER_FREE_MODEL,
    messages,
    stream: !!options.onChunk
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

  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify(body),
    signal: options.signal
  });

  if (!res.ok) {
    const bodyText = await res.text();
    const parsed = parseOpenRouterError(res.status, bodyText);
    throw new OpenRouterChatError({
      status: res.status,
      bodyText,
      model,
      retryAfterSeconds: parsed.retryAfterSeconds,
      recoverable: parsed.recoverable
    });
  }

  // ── Streaming path ──────────────────────────────────────────────────────
  if (options.onChunk) {
    return streamOpenAICompatible(res, options.onChunk);
  }

  // ── Non-streaming path ──────────────────────────────────────────────────
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
  const selectedModel = model || OPENROUTER_FREE_MODEL;
  const needsTools = Boolean(options.tools?.length);
  let lastError: unknown = null;
  let attemptsUsed = 0;

  const runCandidate = async (candidate: string) => {
    attemptsUsed++;
    return openrouterChatOnce(
      messages,
      options,
      apiKey,
      candidate,
      thinkingMode
    );
  };

  const handleRecoverableError = async (
    candidate: string,
    err: OpenRouterChatError
  ) => {
    console.warn(
      `[OpenRouter] Recoverable error from ${candidate}; retrying or trying another free model if available.`,
      err.message
    );

    const delayMs = err.retryAfterSeconds
      ? Math.min(Math.max(err.retryAfterSeconds * 1000, 500), 2500)
      : 500;
    await signalAwareSleep(delayMs, options.signal);
  };

  try {
    return await runCandidate(selectedModel);
  } catch (err) {
    if (isAbortError(err)) throw err;
    lastError = err;

    if (!(err instanceof OpenRouterChatError) || !err.recoverable) {
      throw err;
    }

    if (attemptsUsed >= OPENROUTER_MAX_RECOVERY_ATTEMPTS) {
      throw err;
    }

    await handleRecoverableError(selectedModel, err);
  }

  const candidateModels = await buildOpenRouterRecoveryModels(
    selectedModel,
    apiKey,
    needsTools,
    options.signal
  );

  for (const candidate of candidateModels) {
    const candidateAttempts = candidate === OPENROUTER_FREE_MODEL ? 3 : 1;
    for (
      let candidateAttempt = candidate === selectedModel ? 1 : 0;
      candidateAttempt < candidateAttempts &&
      attemptsUsed < OPENROUTER_MAX_RECOVERY_ATTEMPTS;
      candidateAttempt++
    ) {
      try {
        return await runCandidate(candidate);
      } catch (err) {
        if (isAbortError(err)) throw err;
        lastError = err;

        if (!(err instanceof OpenRouterChatError) || !err.recoverable) {
          throw err;
        }

        if (attemptsUsed >= OPENROUTER_MAX_RECOVERY_ATTEMPTS) break;
        await handleRecoverableError(candidate, err);
      }
    }
  }

  if (lastError instanceof OpenRouterChatError) {
    throw new Error(
      `OpenRouter chat failed after ${attemptsUsed} recovery attempt(s) across ` +
        `${candidateModels.length} model(s): ` +
        `${candidateModels.join(", ")}. Last error: ${lastError.bodyText}`
    );
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("OpenRouter chat failed after retrying free model fallbacks.");
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
