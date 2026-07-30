import { describe, expect, it } from "vitest";
import {
  buildJobRequestPatch,
  canRequestJobCancel,
  canRequestJobRetry,
  clampJobProgress,
  isTerminalJobStatus,
} from "./jobsDb";

describe("jobs database helpers", () => {
  it("normalizes progress into a whole percentage", () => {
    expect(clampJobProgress(-8)).toBe(0);
    expect(clampJobProgress(42.6)).toBe(43);
    expect(clampJobProgress(140)).toBe(100);
    expect(clampJobProgress(Number.NaN)).toBe(0);
  });

  it("only permits retry requests for retryable terminal jobs", () => {
    expect(canRequestJobRetry("failed")).toBe(true);
    expect(canRequestJobRetry("cancelled")).toBe(true);
    expect(canRequestJobRetry("running")).toBe(false);
    expect(buildJobRequestPatch("failed", "retry", 123)).toEqual({
      status: "retry-requested",
      progress: 0,
      updatedAt: 123,
      finishedAt: undefined,
    });
  });

  it("records cancellation as a request without claiming completion", () => {
    expect(canRequestJobCancel("queued")).toBe(true);
    expect(canRequestJobCancel("running")).toBe(true);
    expect(canRequestJobCancel("succeeded")).toBe(false);
    expect(buildJobRequestPatch("running", "cancel", 456)).toEqual({
      status: "cancel-requested",
      updatedAt: 456,
    });
  });

  it("identifies only settled outcomes as terminal", () => {
    expect(isTerminalJobStatus("succeeded")).toBe(true);
    expect(isTerminalJobStatus("failed")).toBe(true);
    expect(isTerminalJobStatus("cancelled")).toBe(true);
    expect(isTerminalJobStatus("cancel-requested")).toBe(false);
    expect(buildJobRequestPatch("succeeded", "cancel")).toBeNull();
  });
});
