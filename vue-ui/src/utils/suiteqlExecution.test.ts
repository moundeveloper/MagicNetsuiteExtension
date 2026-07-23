import { describe, expect, test, vi } from "vitest";
import { runSuiteQLExecution } from "./suiteqlExecution";

describe("runSuiteQLExecution", () => {
  test("locks synchronously, validates once, and executes once", async () => {
    let busy = false;
    let releaseValidation!: (valid: boolean) => void;
    const validation = new Promise<boolean>((resolve) => {
      releaseValidation = resolve;
    });
    const validate = vi.fn(() => validation);
    const execute = vi.fn();

    const firstRun = runSuiteQLExecution({
      isBusy: () => busy,
      setBusy: (value) => {
        busy = value;
      },
      validate,
      execute,
    });

    expect(busy).toBe(true);
    expect(validate).toHaveBeenCalledTimes(1);

    const duplicateRun = await runSuiteQLExecution({
      isBusy: () => busy,
      setBusy: (value) => {
        busy = value;
      },
      validate,
      execute,
    });
    expect(duplicateRun).toBe("busy");

    releaseValidation(true);
    await expect(firstRun).resolves.toBe("executed");
    expect(validate).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(busy).toBe(false);
  });

  test("does not execute invalid queries and always releases the lock", async () => {
    let busy = false;
    const execute = vi.fn();

    await expect(
      runSuiteQLExecution({
        isBusy: () => busy,
        setBusy: (value) => {
          busy = value;
        },
        validate: () => false,
        execute,
      }),
    ).resolves.toBe("invalid");

    expect(execute).not.toHaveBeenCalled();
    expect(busy).toBe(false);
  });

  test("requests confirmation without executing an unlimited query", async () => {
    let busy = false;
    const execute = vi.fn();
    const onConfirmationRequired = vi.fn();

    await expect(
      runSuiteQLExecution({
        isBusy: () => busy,
        setBusy: (value) => {
          busy = value;
        },
        validate: () => true,
        countRows: () => 4001,
        confirmationThreshold: 4000,
        onConfirmationRequired,
        execute,
      }),
    ).resolves.toBe("confirmation-required");

    expect(onConfirmationRequired).toHaveBeenCalledWith(4001);
    expect(execute).not.toHaveBeenCalled();
    expect(busy).toBe(false);
  });

  test("releases the lock when execution throws", async () => {
    let busy = false;

    await expect(
      runSuiteQLExecution({
        isBusy: () => busy,
        setBusy: (value) => {
          busy = value;
        },
        validate: () => true,
        execute: () => {
          throw new Error("query failed");
        },
      }),
    ).rejects.toThrow("query failed");

    expect(busy).toBe(false);
  });
});
