import type { AiProvider } from "../states/settingsState";

export const AI_DATA_CONSENT_VERSION = 1;
export const AI_DATA_CONSENT_STORAGE_KEY =
  "magic_netsuite_ai_data_consent";

export interface AiDataConsentRecord {
  version: number;
  acceptedAt: string;
}

export interface AiTransmissionTarget {
  provider: AiProvider;
  endpoint?: string;
}

interface ConsentStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

type ConsentPrompt = (message: string) => boolean | Promise<boolean>;

let pendingConsentRequest: Promise<boolean> | null = null;

const defaultConsentPrompt: ConsentPrompt = (message) =>
  window.confirm(message);

const isIpv4Loopback = (hostname: string) => {
  const segments = hostname.split(".");
  if (segments.length !== 4 || segments[0] !== "127") return false;
  return segments.every((segment) => {
    if (!/^\d+$/.test(segment)) return false;
    const value = Number(segment);
    return value >= 0 && value <= 255;
  });
};

export const isLoopbackEndpoint = (endpoint: string): boolean => {
  try {
    const hostname = new URL(endpoint).hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "::1" ||
      hostname === "0:0:0:0:0:0:0:1" ||
      isIpv4Loopback(hostname)
    );
  } catch {
    // Invalid or relative URLs are treated as external so a malformed custom
    // endpoint can never bypass the disclosure.
    return false;
  }
};

export const requiresExternalAiConsent = ({
  provider,
  endpoint
}: AiTransmissionTarget): boolean => {
  if (provider === "openrouter" || provider === "copilot") return true;
  if (provider === "ollama" || provider === "opencode") {
    return !endpoint || !isLoopbackEndpoint(endpoint);
  }
  return true;
};

export const buildAiDataDisclosure = ({
  provider,
  endpoint
}: AiTransmissionTarget): string => {
  const providerLabel: Record<AiProvider, string> = {
    openrouter: "OpenRouter",
    copilot: "GitHub Copilot",
    ollama: "the configured Ollama server",
    opencode: "the configured OpenCode server"
  };
  const destination = endpoint
    ? `${providerLabel[provider]} (${endpoint})`
    : providerLabel[provider];

  return [
    "Allow external AI data sharing?",
    "",
    `Magic NetSuite Extension is about to contact ${destination}.`,
    "Your prompts, conversation context, selected NetSuite data, and tool outputs may be transmitted to and processed by that service.",
    "",
    "Only continue if you are permitted to share this data. You can revoke this permission in Settings at any time."
  ].join("\n");
};

export const hasCurrentAiDataConsent = async (
  storage: ConsentStorage = chrome.storage.local
): Promise<boolean> => {
  const result = await storage.get(AI_DATA_CONSENT_STORAGE_KEY);
  const record = result[
    AI_DATA_CONSENT_STORAGE_KEY
  ] as Partial<AiDataConsentRecord> | undefined;
  return (
    record?.version === AI_DATA_CONSENT_VERSION &&
    typeof record.acceptedAt === "string" &&
    record.acceptedAt.length > 0
  );
};

export const grantAiDataConsent = async (
  storage: ConsentStorage = chrome.storage.local
): Promise<void> => {
  const record: AiDataConsentRecord = {
    version: AI_DATA_CONSENT_VERSION,
    acceptedAt: new Date().toISOString()
  };
  await storage.set({ [AI_DATA_CONSENT_STORAGE_KEY]: record });
};

export const revokeAiDataConsent = async (
  storage: ConsentStorage = chrome.storage.local
): Promise<void> => {
  await storage.remove(AI_DATA_CONSENT_STORAGE_KEY);
};

export const ensureAiDataConsent = async (
  target: AiTransmissionTarget,
  {
    storage = chrome.storage.local,
    prompt = defaultConsentPrompt
  }: { storage?: ConsentStorage; prompt?: ConsentPrompt } = {}
): Promise<boolean> => {
  if (!requiresExternalAiConsent(target)) return true;
  if (await hasCurrentAiDataConsent(storage)) return true;

  if (!pendingConsentRequest) {
    pendingConsentRequest = (async () => {
      const accepted = await prompt(buildAiDataDisclosure(target));
      if (accepted) await grantAiDataConsent(storage);
      return accepted;
    })().finally(() => {
      pendingConsentRequest = null;
    });
  }

  return pendingConsentRequest;
};
