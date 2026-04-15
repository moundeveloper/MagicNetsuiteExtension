// chainedToolManager.ts — Chained tools: deterministic multi-step pipelines
// that compose real registered tools, calling them one after another while
// threading outputs between steps.
//
// KEY DESIGN PRINCIPLE:
//   Each step references a *real* registered tool by name (type: 'tool'),
//   OR declares an AI-driven step (type: 'ai') that runs a mini agent loop
//   with a curated set of tools exposed, then feeds the result back into
//   the chain context for subsequent steps.
//
//   Tool steps:  deterministic, call tool.execute() directly
//   AI steps:    run chatCompletion in a loop until no tool_calls remain,
//                then pass the final assistant content + tool results to
//                the step's outputMapper.

import type { ToolDefinition } from "../composables/useAgent";
import type { ChatMessage, NormalisedResponse } from "../composables/useAiProvider";

// ─────────────────────────────────────────────
// Context bag
// ─────────────────────────────────────────────

/**
 * Accumulated state threaded through all chain steps.
 * Step N's output is merged into this bag before step N+1 runs.
 */
export type ChainContext = Record<string, unknown>;

// ─────────────────────────────────────────────
// Chain step — tool variant
// ─────────────────────────────────────────────

/**
 * A deterministic step that delegates to a real registered tool.
 */
export interface ChainToolStep {
  type?: "tool"; // default when omitted
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
   */
  outputMapper?: (
    result: unknown,
    context: ChainContext
  ) => Record<string, unknown>;
}

// ─────────────────────────────────────────────
// Chain step — AI variant
// ─────────────────────────────────────────────

/**
 * Result fed into an AI step's outputMapper.
 * Contains everything the step produced during its mini agent loop.
 */
export interface AiStepResult {
  /** Final text content from the assistant (last non-tool-call message) */
  assistantContent: string;
  /**
   * Map of toolName → last result for every tool the mini loop called.
   * Useful so outputMapper can extract structured data produced by the AI.
   */
  toolResults: Record<string, unknown>;
}

/**
 * An AI-driven step that breaks out of the deterministic executor and runs a
 * mini agent loop with a curated set of tools. The loop iterates until the AI
 * produces a message with no tool calls, then feeds the final content + tool
 * results into outputMapper for context threading.
 */
export interface ChainAiStep {
  type: "ai";
  /** Human-readable label shown in the UI (e.g. "Generate Suitelet code") */
  label: string;
  /**
   * Tool name used for UI tracking (onToolStart / onToolResult hooks).
   * Can be a descriptive virtual name — it does NOT need to exist in the registry.
   */
  toolName: string;
  /**
   * Names of real registered tools the mini agent loop is allowed to call.
   * The tools must exist in the chain's registry at execution time.
   */
  allowedTools: string[];
  /**
   * Builds the initial user message sent to the AI for this step.
   * Receives the original user input + accumulated context.
   */
  promptBuilder: (
    userInput: Record<string, unknown>,
    context: ChainContext
  ) => string;
  /**
   * Optional system prompt for the mini agent loop.
   * Defaults to a generic "you are a helpful assistant" if omitted.
   */
  systemPrompt?: string;
  /**
   * Maps the AI step result → what to merge into the context for subsequent steps.
   * Return `{ _error: "..." }` to abort the chain.
   */
  outputMapper?: (
    result: AiStepResult,
    context: ChainContext
  ) => Record<string, unknown>;
  /** Max iterations for the mini agent loop. Defaults to 8. */
  maxIterations?: number;
}

/**
 * Union of all chain step variants.
 */
export type ChainStep = ChainToolStep | ChainAiStep;

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
// Per-step message push payload
// ─────────────────────────────────────────────

/**
 * Passed to onStepMessage so the agent can push a real history entry
 * for each chain step, making them visible in real-time in the UI.
 */
export interface ChainStepMessage {
  toolName: string;
  toolCallId: string;
  content: string;
  chainContext: {
    chainName: string;
    stepIndex: number;
    totalSteps: number;
    stepLabel: string;
  };
}

// ─────────────────────────────────────────────
// Chained tool definition
// ─────────────────────────────────────────────

/**
 * A chained tool definition.
 *
 * From the AI's perspective this is a single callable tool.
 * Internally the chain executor runs each step — either by calling a real
 * registered tool directly (tool step) or by running a mini agent loop with
 * a curated tool set (AI step).
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
  /** Ordered list of steps */
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
// chatCompletion type (mirrors useAiProvider)
// ─────────────────────────────────────────────

export type ChatCompletionFn = (
  messages: ChatMessage[],
  options?: { tools?: unknown[] }
) => Promise<NormalisedResponse>;

// ─────────────────────────────────────────────
// Chain → ToolDefinition converter
// ─────────────────────────────────────────────

let _stepIdCounter = 0;
const nextStepId = () => `chain_step_${++_stepIdCounter}_${Date.now()}`;

/**
 * Wraps a ChainedToolDefinition into a standard ToolDefinition that the
 * agent can register and call like any other tool.
 *
 * The execute function:
 *   - Iterates steps in order
 *   - Tool steps: maps input, requests approval (if destructive), calls the tool
 *   - AI steps: runs a mini agent loop with allowed tools, then feeds result to outputMapper
 *   - Fires onToolStart / onToolResult per step so the UI gets live visibility
 *   - Calls onStepMessage per step so the agent pushes a real history entry
 *   - Short-circuits on any step error / abort
 *
 * @param chain             The chain to wrap
 * @param getRegistry       Getter that returns the current tool registry Map
 * @param hooks             Lifecycle hooks (same as the agent's own hooks)
 * @param chatCompletion    AI provider's chatCompletion — required for AI steps
 * @param onProgress        Optional per-step progress callback
 * @param onStepMessage     Called after each step completes — agent should pushMessage
 */
export const toToolDefinition = (
  chain: ChainedToolDefinition,
  getRegistry: () => Map<string, ToolDefinition>,
  hooks: {
    onToolStart?: (name: string, input: unknown) => void;
    onToolResult?: (name: string, result: unknown) => void;
    onToolApprovalRequest?: (name: string, input: unknown) => Promise<boolean>;
  },
  chatCompletion: ChatCompletionFn,
  onProgress?: (event: ChainProgressEvent) => void,
  onStepMessage?: (msg: ChainStepMessage) => void
): ToolDefinition => ({
  name: chain.name,
  description: chain.description,
  parameters: chain.parameters,
  // Chain itself is NOT destructive at the wrapper level —
  // each step handles its own approval gate below.
  destructive: false,

  execute: async (userInput: Record<string, unknown>) => {
    const context: ChainContext = {};
    const completedSteps: Array<{
      step: string;
      tool: string;
      result: unknown;
    }> = [];

    for (let i = 0; i < chain.steps.length; i++) {
      const step = chain.steps[i]!;
      const stepType: "tool" | "ai" =
        step.type === "ai" ? "ai" : "tool";

      // ── Fire progress callback ──────────────────────────────────────────
      onProgress?.({
        chainName: chain.name,
        stepIndex: i + 1,
        totalSteps: chain.steps.length,
        stepLabel: step.label,
        toolName: step.toolName,
        context: { ...context }
      });

      console.log(
        `[Chain:${chain.name}] Step ${i + 1}/${chain.steps.length} (${stepType}): "${step.label}" → ${step.toolName}`,
      );

      // ── onToolStart so UI shows spinner ─────────────────────────────────
      hooks.onToolStart?.(step.toolName, {});

      // ════════════════════════════════════════════════════════════════════
      // TOOL STEP
      // ════════════════════════════════════════════════════════════════════
      if (stepType === "tool") {
        const toolStep = step as ChainToolStep;
        const registry = getRegistry();
        const tool = registry.get(toolStep.toolName);

        if (!tool) {
          const errResult = {
            error: `Chain step "${toolStep.label}" references unknown tool "${toolStep.toolName}". ` +
                   `Is it registered in the tool registry?`
          };
          hooks.onToolResult?.(toolStep.toolName, errResult);
          onStepMessage?.({
            toolName: toolStep.toolName,
            toolCallId: nextStepId(),
            content: JSON.stringify(errResult),
            chainContext: {
              chainName: chain.name,
              stepIndex: i + 1,
              totalSteps: chain.steps.length,
              stepLabel: toolStep.label
            }
          });
          return {
            success: false,
            abortedAtStep: toolStep.label,
            error: errResult.error,
            completedSteps
          };
        }

        // Build the tool's input from the user input + accumulated context
        const toolInput = toolStep.inputMapper(userInput, context);

        // ── Approval gate: ask per-step if destructive ──
        if (tool.destructive && hooks.onToolApprovalRequest) {
          const approved = await hooks.onToolApprovalRequest(toolStep.toolName, toolInput);
          if (!approved) {
            const errResult = { error: `Step "${toolStep.label}" (${toolStep.toolName}) was rejected by the user.` };
            hooks.onToolResult?.(toolStep.toolName, errResult);
            onStepMessage?.({
              toolName: toolStep.toolName,
              toolCallId: nextStepId(),
              content: JSON.stringify(errResult),
              chainContext: {
                chainName: chain.name,
                stepIndex: i + 1,
                totalSteps: chain.steps.length,
                stepLabel: toolStep.label
              }
            });
            return {
              success: false,
              abortedAtStep: toolStep.label,
              error: errResult.error,
              completedSteps
            };
          }
        }

        let result: unknown;
        try {
          result = await tool.execute(toolInput);
        } catch (err) {
          const errResult = { error: String(err) };
          hooks.onToolResult?.(toolStep.toolName, errResult);
          onStepMessage?.({
            toolName: toolStep.toolName,
            toolCallId: nextStepId(),
            content: JSON.stringify(errResult),
            chainContext: {
              chainName: chain.name,
              stepIndex: i + 1,
              totalSteps: chain.steps.length,
              stepLabel: toolStep.label
            }
          });
          return {
            success: false,
            abortedAtStep: toolStep.label,
            error: String(err),
            completedSteps
          };
        }

        hooks.onToolResult?.(toolStep.toolName, result);

        const stepId = nextStepId();
        onStepMessage?.({
          toolName: toolStep.toolName,
          toolCallId: stepId,
          content: typeof result === "string" ? result : JSON.stringify(result),
          chainContext: {
            chainName: chain.name,
            stepIndex: i + 1,
            totalSteps: chain.steps.length,
            stepLabel: toolStep.label
          }
        });

        console.log(`[Chain:${chain.name}] Step ${i + 1} (tool) result:`, result);

        if (toolStep.outputMapper) {
          const contextUpdate = toolStep.outputMapper(result, context);
          if (contextUpdate._error) {
            return {
              success: false,
              abortedAtStep: toolStep.label,
              error: contextUpdate._error as string,
              completedSteps
            };
          }
          Object.assign(context, contextUpdate);
        }

        completedSteps.push({ step: toolStep.label, tool: toolStep.toolName, result });
        continue;
      }

      // ════════════════════════════════════════════════════════════════════
      // AI STEP — mini agent loop
      // ════════════════════════════════════════════════════════════════════
      const aiStep = step as ChainAiStep;
      const registry = getRegistry();
      const maxIter = aiStep.maxIterations ?? 8;

      // Build the external tool schemas for allowed tools
      const allowedToolDefs = aiStep.allowedTools
        .map((name) => registry.get(name))
        .filter((t): t is ToolDefinition => !!t);

      const externalTools = allowedToolDefs.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }));

      // Build initial message list for the mini loop
      const systemPrompt =
        aiStep.systemPrompt ??
        "You are a helpful assistant. Use the tools provided to complete the task.";

      const loopMessages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: aiStep.promptBuilder(userInput, context) }
      ];

      const toolResults: Record<string, unknown> = {};
      let assistantContent = "";
      let loopError: string | null = null;

      for (let iter = 0; iter < maxIter; iter++) {
        let response: NormalisedResponse;
        try {
          response = await chatCompletion(loopMessages, {
            tools: externalTools.length > 0 ? externalTools : undefined
          });
        } catch (err) {
          loopError = `AI step "${aiStep.label}" chatCompletion error: ${String(err)}`;
          break;
        }

        const { content, tool_calls } = response;
        assistantContent = content ?? "";

        // Push assistant message to the loop's local history
        if (tool_calls.length > 0) {
          loopMessages.push({
            role: "assistant",
            content: assistantContent,
            tool_calls
          });
        } else {
          loopMessages.push({ role: "assistant", content: assistantContent });
        }

        // No more tool calls → done
        if (tool_calls.length === 0) {
          console.log(`[Chain:${chain.name}] AI step "${aiStep.label}" done after ${iter + 1} iteration(s)`);
          break;
        }

        // Execute each tool call
        for (const tc of tool_calls) {
          const tcName = tc.function.name;
          const tcInput = (() => {
            try {
              return typeof tc.function.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : (tc.function.arguments as Record<string, unknown>);
            } catch {
              return {};
            }
          })();

          const tcTool = registry.get(tcName);
          let tcResult: unknown;

          if (!tcTool) {
            tcResult = { error: `Unknown tool: ${tcName}` };
          } else {
            try {
              tcResult = await tcTool.execute(tcInput);
            } catch (err) {
              tcResult = { error: String(err) };
            }
          }

          toolResults[tcName] = tcResult;

          const tcContent =
            typeof tcResult === "string" ? tcResult : JSON.stringify(tcResult);

          loopMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: tcContent
          });

          console.log(
            `[Chain:${chain.name}] AI step "${aiStep.label}" sub-tool "${tcName}" result:`,
            tcResult
          );
        }
      }

      if (loopError) {
        const errResult = { error: loopError };
        hooks.onToolResult?.(aiStep.toolName, errResult);
        onStepMessage?.({
          toolName: aiStep.toolName,
          toolCallId: nextStepId(),
          content: JSON.stringify(errResult),
          chainContext: {
            chainName: chain.name,
            stepIndex: i + 1,
            totalSteps: chain.steps.length,
            stepLabel: aiStep.label
          }
        });
        return {
          success: false,
          abortedAtStep: aiStep.label,
          error: loopError,
          completedSteps
        };
      }

      const aiResult: AiStepResult = { assistantContent, toolResults };

      hooks.onToolResult?.(aiStep.toolName, { assistantContent: assistantContent.slice(0, 200) });

      const stepId = nextStepId();
      onStepMessage?.({
        toolName: aiStep.toolName,
        toolCallId: stepId,
        content: assistantContent.slice(0, 1000) || JSON.stringify(toolResults).slice(0, 1000),
        chainContext: {
          chainName: chain.name,
          stepIndex: i + 1,
          totalSteps: chain.steps.length,
          stepLabel: aiStep.label
        }
      });

      console.log(`[Chain:${chain.name}] Step ${i + 1} (ai) done. assistantContent length: ${assistantContent.length}`);

      if (aiStep.outputMapper) {
        const contextUpdate = aiStep.outputMapper(aiResult, context);
        if (contextUpdate._error) {
          return {
            success: false,
            abortedAtStep: aiStep.label,
            error: contextUpdate._error as string,
            completedSteps
          };
        }
        Object.assign(context, contextUpdate);
      }

      completedSteps.push({ step: aiStep.label, tool: aiStep.toolName, result: aiResult });
    }

    return {
      success: true,
      completedSteps,
      summary: context
    };
  }
});
