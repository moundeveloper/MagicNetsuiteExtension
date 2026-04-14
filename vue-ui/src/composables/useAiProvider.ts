/**
 * useAiProvider
 *
 * Thin adapter layer that normalises calls to different AI backends
 * (Puter, Ollama) into a single `chatCompletion` function that returns
 * an OpenAI-compatible message object.
 *
 * Consumers only need to call `chatCompletion(messages, options)` —
 * the active provider is read from chrome.storage.sync via settingsState.
 */

import { puter } from "@heyputer/puter.js";
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

  const response = await puter.ai.chat(messages as Parameters<typeof puter.ai.chat>[0], chatOptions);

  // Puter may wrap in { message: {...} } or return the message directly
  const msg =
    (response as { message?: { content?: string | null; tool_calls?: ToolCall[] } })?.message ??
    (response as { content?: string | null; tool_calls?: ToolCall[] });

  const normalizeContent = (content: unknown): string | null => {
    if (content === null || content === undefined) return null;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((c: { type?: string; text?: string }) => (c?.type === "text" ? (c.text ?? "") : ""))
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
// Ollama adapter (OpenAI-compatible /api/chat)
// ─────────────────────────────────────────────

const ollamaChat = async (
  messages: ChatMessage[],
  options: ChatCompletionOptions,
  baseUrl: string,
  model: string
): Promise<NormalisedResponse> => {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Ollama request failed (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        function: { name: string; arguments: Record<string, unknown> };
      }>;
    };
  };

  const rawMsg = data.message;

  // Ollama tool_calls have no `id` field — generate a stable one
  const toolCalls: ToolCall[] =
    rawMsg?.tool_calls?.map((tc, idx) => ({
      id: `ollama-tc-${idx}-${Date.now()}`,
      type: "function" as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments
      }
    })) ?? [];

  return {
    content: rawMsg?.content ?? null,
    tool_calls: toolCalls
  };
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

    // Default: puter
    return puterChat(messages, options);
  };

  return { chatCompletion, settings };
};
