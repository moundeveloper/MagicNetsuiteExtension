/**
 * useAiProvider
 *
 * Thin adapter layer that normalises calls to different AI backends
 * (Puter, Ollama, OpenCode, GitHub Copilot) into a single `chatCompletion`
 * function that returns an OpenAI-compatible message object.
 *
 * Consumers only need to call `chatCompletion(messages, options)` —
 * the active provider is read from chrome.storage.sync via settingsState.
 */

import { puter } from "@heyputer/puter.js";
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
}

// ─────────────────────────────────────────────
// Puter adapter
// ─────────────────────────────────────────────

const puterChat = async (
  messages: ChatMessage[],
  options: ChatCompletionOptions
): Promise<NormalisedResponse> => {
  const chatOptions: Record<string, unknown> = {};
  if (options.tools && options.tools.length > 0) {
    chatOptions.tools = options.tools;
  }

  const response = await puter.ai.chat(
    messages as Parameters<typeof puter.ai.chat>[0],
    chatOptions
  );

  // Puter may wrap in { message: {...} } or return the message directly
  const msg =
    (
      response as {
        message?: { content?: string | null; tool_calls?: ToolCall[] };
      }
    )?.message ??
    (response as { content?: string | null; tool_calls?: ToolCall[] });

  const normalizeContent = (content: unknown): string | null => {
    if (content === null || content === undefined) return null;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((c: { type?: string; text?: string }) =>
          c?.type === "text" ? (c.text ?? "") : ""
        )
        .join("\n");
    }
    return JSON.stringify(content, null, 2);
  };

  return {
    content: normalizeContent(msg?.content),
    tool_calls: (msg as { tool_calls?: ToolCall[] })?.tool_calls ?? []
  };
};

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

  return {
    content: rawMsg?.content ?? null,
    tool_calls: toolCalls
  };
};

// ─────────────────────────────────────────────
// GitHub Copilot adapter
// ─────────────────────────────────────────────

/** VS Code's public GitHub OAuth client ID — used by many open-source tools. */
export const COPILOT_CLIENT_ID = "01ab8ac9400c4e429b23";

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
  model: string
): Promise<NormalisedResponse> => {
  const copilotToken = await getCopilotApiToken(githubToken);

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }

  const res = await fetch("https://api.githubcopilot.com/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${copilotToken}`,
      "Content-Type": "application/json",
      "Editor-Version": "vscode/1.95.3",
      "Editor-Plugin-Version": "copilot-chat/0.22.4",
      "Copilot-Integration-Id": "vscode-chat",
      "OpenAI-Intent": "conversation-panel",
      "User-Agent": "MagicNetsuiteExtension"
    },
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
  return {
    content: msg?.content ?? null,
    tool_calls:
      msg?.tool_calls?.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.function.name, arguments: tc.function.arguments }
      })) ?? []
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
// Public composable
// ─────────────────────────────────────────────

export const useAiProvider = () => {
  const { settings } = useSettings();

  /**
   * Send a chat completion request using whichever provider is active in settings.
   */
  const chatCompletion = async (
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<NormalisedResponse> => {
    const provider = settings.aiProvider;

    if (provider === "ollama") {
      return ollamaChat(
        messages,
        options,
        settings.ollamaBaseUrl || "http://localhost:11434",
        options.model || settings.ollamaModel || "llama3.2"
      );
    }

    if (provider === "opencode") {
      return opencodeChat(
        messages,
        options,
        settings.opencodeBaseUrl || "http://localhost:4096",
        settings.opencodeModel || undefined
      );
    }

    if (provider === "copilot") {
      if (!settings.githubToken) {
        throw new Error(
          "GitHub Copilot: not authenticated. Go to Settings → AI Provider to connect."
        );
      }
      return copilotChat(
        messages,
        options,
        settings.githubToken,
        settings.copilotModel || "gpt-4o"
      );
    }

    // Default: puter
    return puterChat(messages, options);
  };

  return { chatCompletion, settings };
};
