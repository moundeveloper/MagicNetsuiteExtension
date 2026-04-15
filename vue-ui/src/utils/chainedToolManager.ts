// chainedToolManager.ts — Chained tools: deterministic multi-step pipelines
// that compose real registered tools, calling them one after another while
// threading outputs between steps.
//
// KEY DESIGN PRINCIPLE:
//   Each step references a *real* registered tool by name.
//   The chain executor looks up that tool in the registry and calls its
//   actual execute() function — so every step fires the same onToolStart /
//   onToolResult / approval-gate hooks as a regular standalone tool call.
//   The UI therefore shows each step as a real tool call, not a black box.

import type { ToolDefinition } from "../composables/useAgent";

// ─────────────────────────────────────────────
// Context bag
// ─────────────────────────────────────────────

/**
 * Accumulated state threaded through all chain steps.
 * Step N's output is merged into this bag before step N+1 runs.
 */
export type ChainContext = Record<string, unknown>;

// ─────────────────────────────────────────────
// Chain step
// ─────────────────────────────────────────────

/**
 * A single step in a chained pipeline.
 *
 * Instead of containing its own implementation, a step *names a real
 * registered tool* and provides a mapper that converts the accumulated
 * chain context + original user input into that tool's parameter object.
 *
 * The chain executor will:
 *   1. Call `inputMapper(userInput, context)` to build the tool's parameters.
 *   2. Look up the tool in the registry.
 *   3. Call `tool.execute(mappedInput)` — firing onToolStart / onToolResult.
 *   4. Call `outputMapper(result, context)` to decide what to merge into context.
 */
export interface ChainStep {
  /** Human-readable label shown in the UI (e.g. "Create folder") */
  label: string;

  /**
   * The name of the real registered tool this step delegates to.
   * Must match a key in the agent's tool registry exactly.
   */
  toolName: string;

  /**
   * Maps the original user input + accumulated context → the tool's input object.
   * Called just before the tool executes.
   */
  inputMapper: (
    userInput: Record<string, unknown>,
    context: ChainContext
  ) => Record<string, unknown>;

  /**
   * Maps the tool's raw result → what to merge into the context for subsequent steps.
   * Return `{ _error: "..." }` to abort the chain.
   *
   * @param result  Raw return value from tool.execute()
   * @param context Accumulated context so far (before this step's output)
   */
  outputMapper?: (
    result: unknown,
    context: ChainContext
  ) => Record<string, unknown>;
}

// ─────────────────────────────────────────────
// Chain progress event
// ─────────────────────────────────────────────

export interface ChainProgressEvent {
  chainName: string;
  /** 1-based */
  stepIndex: number;
  totalSteps: number;
  stepLabel: string;
  toolName: string;
  context: ChainContext;
}

// ─────────────────────────────────────────────
// Chained tool definition
// ─────────────────────────────────────────────

/**
 * A chained tool definition.
 *
 * From the AI's perspective this is a single callable tool.
 * Internally the chain executor runs each step by calling a real registered
 * tool, so the full hook lifecycle fires for every step.
 */
export interface ChainedToolDefinition {
  /** Unique tool name exposed to the AI */
  name: string;
  /** Description shown to the AI — should explain the full pipeline clearly */
  description: string;
  /** Top-level parameter schema the AI must satisfy to invoke the chain */
  parameters: ToolDefinition["parameters"];
  /** Whether user approval is needed before the chain starts */
  destructive?: boolean;
  /** Ordered list of steps; each delegates to a real registered tool */
  steps: ChainStep[];
  /**
   * Regex patterns matched against the user prompt.
   * When a pattern matches, this chain is prioritised over individual tools.
   */
  intentPatterns: RegExp[];
}

// ─────────────────────────────────────────────
// Intent matching
// ─────────────────────────────────────────────

/**
 * Returns the name of the first chained tool whose intent patterns match
 * the given prompt, or null if none match.
 */
export const matchChainedToolIntent = (
  prompt: string,
  chains: ChainedToolDefinition[]
): string | null => {
  for (const chain of chains) {
    for (const pattern of chain.intentPatterns) {
      if (pattern.test(prompt)) {
        return chain.name;
      }
    }
  }
  return null;
};

// ─────────────────────────────────────────────
// Chain → ToolDefinition converter
// ─────────────────────────────────────────────

/**
 * Wraps a ChainedToolDefinition into a standard ToolDefinition that the
 * agent can register and call like any other tool.
 *
 * The execute function:
 *   - Iterates steps in order
 *   - For each step: maps input, looks up the real tool, calls it, maps output
 *   - Fires onToolStart / onToolResult per step so the UI gets full visibility
 *   - Short-circuits on any step error / abort
 *
 * @param chain     The chain to wrap
 * @param getRegistry  Getter that returns the current tool registry Map
 * @param hooks        Lifecycle hooks (same as the agent's own hooks)
 * @param onProgress   Optional per-step progress callback
 */
export const toToolDefinition = (
  chain: ChainedToolDefinition,
  getRegistry: () => Map<string, ToolDefinition>,
  hooks: {
    onToolStart?: (name: string, input: unknown) => void;
    onToolResult?: (name: string, result: unknown) => void;
    onToolApprovalRequest?: (name: string, input: unknown) => Promise<boolean>;
  },
  onProgress?: (event: ChainProgressEvent) => void
): ToolDefinition => ({
  name: chain.name,
  description: chain.description,
  parameters: chain.parameters,
  destructive: chain.destructive,

  execute: async (userInput: Record<string, unknown>) => {
    const context: ChainContext = {};
    const completedSteps: Array<{
      step: string;
      tool: string;
      result: unknown;
    }> = [];

    for (let i = 0; i < chain.steps.length; i++) {
      const step = chain.steps[i]!;
      const registry = getRegistry();
      const tool = registry.get(step.toolName);

      if (!tool) {
        return {
          success: false,
          abortedAtStep: step.label,
          error: `Chain step "${step.label}" references unknown tool "${step.toolName}". ` +
                 `Is it registered in the tool registry?`,
          completedSteps
        };
      }

      // Build the tool's input from the user input + accumulated context
      const toolInput = step.inputMapper(userInput, context);

      // Fire progress callback
      onProgress?.({
        chainName: chain.name,
        stepIndex: i + 1,
        totalSteps: chain.steps.length,
        stepLabel: step.label,
        toolName: step.toolName,
        context: { ...context }
      });

      console.log(
        `[Chain:${chain.name}] Step ${i + 1}/${chain.steps.length}: "${step.label}" → ${step.toolName}`,
        toolInput
      );

      // Fire onToolStart so the UI shows this tool as running
      hooks.onToolStart?.(step.toolName, toolInput);

      let result: unknown;
      try {
        result = await tool.execute(toolInput);
      } catch (err) {
        hooks.onToolResult?.(step.toolName, { error: String(err) });
        return {
          success: false,
          abortedAtStep: step.label,
          error: String(err),
          completedSteps
        };
      }

      // Fire onToolResult so the UI removes the spinner
      hooks.onToolResult?.(step.toolName, result);

      console.log(
        `[Chain:${chain.name}] Step ${i + 1} result:`,
        result
      );

      // Map the result into context for the next step
      if (step.outputMapper) {
        const contextUpdate = step.outputMapper(result, context);

        if (contextUpdate._error) {
          return {
            success: false,
            abortedAtStep: step.label,
            error: contextUpdate._error,
            completedSteps
          };
        }

        Object.assign(context, contextUpdate);
      }

      completedSteps.push({ step: step.label, tool: step.toolName, result });
    }

    return {
      success: true,
      completedSteps,
      summary: context
    };
  }
});
