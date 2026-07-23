export type SuiteQLExecutionOutcome =
  "busy" | "invalid" | "confirmation-required" | "executed";

export interface SuiteQLExecutionOptions {
  isBusy: () => boolean;
  setBusy: (busy: boolean) => void;
  validate: () => boolean | Promise<boolean>;
  execute: () => void | Promise<void>;
  countRows?: () => number | null | Promise<number | null>;
  confirmationThreshold?: number;
  onConfirmationRequired?: (count: number) => void;
}

/**
 * Owns the complete preflight/execution lifecycle for one SuiteQL run.
 *
 * The busy flag is acquired synchronously before the first await, which makes
 * button clicks, editor shortcuts, and global shortcuts share one single-flight
 * lock. Validation is deliberately called exactly once per invocation.
 */
export const runSuiteQLExecution = async (
  options: SuiteQLExecutionOptions,
): Promise<SuiteQLExecutionOutcome> => {
  if (options.isBusy()) return "busy";

  options.setBusy(true);
  try {
    if (!(await options.validate())) return "invalid";

    if (options.countRows) {
      const count = await options.countRows();
      const threshold = options.confirmationThreshold ?? 4000;
      if (typeof count === "number" && count > threshold) {
        options.onConfirmationRequired?.(count);
        return "confirmation-required";
      }
    }

    await options.execute();
    return "executed";
  } finally {
    options.setBusy(false);
  }
};
