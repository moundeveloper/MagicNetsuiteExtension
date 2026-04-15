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
      : {})
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
