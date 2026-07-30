import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_DATA_CONSENT_STORAGE_KEY,
  AI_DATA_CONSENT_VERSION,
  buildAiDataDisclosure,
  ensureAiDataConsent,
  hasCurrentAiDataConsent,
  isLoopbackEndpoint,
  requiresExternalAiConsent,
  revokeAiDataConsent
} from "./aiDataConsent";

const createStorage = (initial: Record<string, unknown> = {}) => {
  const values = { ...initial };
  return {
    values,
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, items);
    }),
    remove: vi.fn(async (key: string) => {
      delete values[key];
    })
  };
};

describe("AI data consent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    "http://localhost:11434",
    "http://models.localhost:4096",
    "http://127.0.0.1:11434",
    "http://127.21.4.8:4096",
    "http://[::1]:11434",
    "http://[0:0:0:0:0:0:0:1]:4096"
  ])("recognises loopback endpoint %s", (endpoint) => {
    expect(isLoopbackEndpoint(endpoint)).toBe(true);
  });

  it.each([
    "https://ollama.example.com",
    "http://192.168.1.20:11434",
    "http://host.docker.internal:4096",
    "/relative/api",
    "not a url"
  ])("treats non-loopback or invalid endpoint %s as external", (endpoint) => {
    expect(isLoopbackEndpoint(endpoint)).toBe(false);
  });

  it("requires consent for hosted providers and remote custom endpoints", () => {
    expect(requiresExternalAiConsent({ provider: "openrouter" })).toBe(true);
    expect(requiresExternalAiConsent({ provider: "copilot" })).toBe(true);
    expect(
      requiresExternalAiConsent({
        provider: "ollama",
        endpoint: "https://models.example.com"
      })
    ).toBe(true);
    expect(
      requiresExternalAiConsent({
        provider: "opencode",
        endpoint: "http://localhost:4096"
      })
    ).toBe(false);
  });

  it("discloses every sensitive payload category", () => {
    const disclosure = buildAiDataDisclosure({ provider: "openrouter" });
    expect(disclosure).toContain("prompts");
    expect(disclosure).toContain("conversation context");
    expect(disclosure).toContain("NetSuite data");
    expect(disclosure).toContain("tool outputs");
    expect(disclosure).toContain("revoke");
  });

  it("does not prompt or persist for a loopback endpoint", async () => {
    const storage = createStorage();
    const prompt = vi.fn(() => true);

    await expect(
      ensureAiDataConsent(
        { provider: "ollama", endpoint: "http://localhost:11434" },
        { storage, prompt }
      )
    ).resolves.toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("persists accepted consent locally with the current version", async () => {
    const storage = createStorage();
    const prompt = vi.fn(() => true);

    await expect(
      ensureAiDataConsent({ provider: "copilot" }, { storage, prompt })
    ).resolves.toBe(true);
    expect(prompt).toHaveBeenCalledOnce();
    expect(storage.values[AI_DATA_CONSENT_STORAGE_KEY]).toMatchObject({
      version: AI_DATA_CONSENT_VERSION
    });
    await expect(hasCurrentAiDataConsent(storage)).resolves.toBe(true);
  });

  it("does not persist declined consent", async () => {
    const storage = createStorage();
    const prompt = vi.fn(() => false);

    await expect(
      ensureAiDataConsent({ provider: "openrouter" }, { storage, prompt })
    ).resolves.toBe(false);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("requires renewed consent after a disclosure version change", async () => {
    const storage = createStorage({
      [AI_DATA_CONSENT_STORAGE_KEY]: {
        version: AI_DATA_CONSENT_VERSION - 1,
        acceptedAt: "2025-01-01T00:00:00.000Z"
      }
    });
    const prompt = vi.fn(() => true);

    await ensureAiDataConsent({ provider: "openrouter" }, { storage, prompt });
    expect(prompt).toHaveBeenCalledOnce();
  });

  it("can be revoked", async () => {
    const storage = createStorage({
      [AI_DATA_CONSENT_STORAGE_KEY]: {
        version: AI_DATA_CONSENT_VERSION,
        acceptedAt: "2026-01-01T00:00:00.000Z"
      }
    });

    await revokeAiDataConsent(storage);
    await expect(hasCurrentAiDataConsent(storage)).resolves.toBe(false);
  });
});

