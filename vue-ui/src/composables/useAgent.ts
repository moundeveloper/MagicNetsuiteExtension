import { ref, readonly } from "vue";
import { useAiProvider } from "./useAiProvider";
import type { ChainedToolDefinition, ChainProgressEvent, ChainStepMessage } from "../utils/chainedToolManager";
import { toToolDefinition, matchChainedToolIntent } from "../utils/chainedToolManager";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type ToolParameterType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array";

export interface ToolParameter {
  type: ToolParameterType;
  description: string;
  enum?: string[];
  items?: { type: ToolParameterType };
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
  /** When true, the agent will pause and request user approval before executing */
  destructive?: boolean;
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface MCPServer {
  name: string;
  url: string;
  authToken?: string;
  headers?: Record<string, string>;
}

export interface AgentMessage {
  role: "user" | "assistant" | "tool" | "compaction";
  content: string;
  toolName?: string;
  toolCallId?: string;
  // Stored so we can replay them in the next API call
  toolCalls?: ToolCall[];
  /** Number of messages that were compacted into this summary */
  compactedCount?: number;
  /** Topic tags for relevance filtering (Strategy 2) */
  tags?: string[];
  /** Set when this tool message was produced by a chain step */
  chainContext?: {
    chainName: string;
    stepIndex: number;
    totalSteps: number;
    stepLabel: string;
  };
  timestamp: Date;
}

export interface AgentRunOptions {
  systemPrompt?: string;
  maxIterations?: number;
}

export interface AgentOptions {
  tools?: ToolDefinition[];
  /**
   * Chained tools: deterministic multi-step pipelines that take priority
   * over ad-hoc tool selection when the user's intent matches.
   * Each chain is exposed to the AI as a single callable tool.
   */
  chainedTools?: ChainedToolDefinition[];
  mcpServers?: MCPServer[];
  systemPrompt?: string;
  keepHistory?: boolean;
  /**
   * Estimated token threshold before compaction triggers.
   * Can be a static number OR a getter function for reactive settings.
   * Default: 80000
   */
  compactionThreshold?: number | (() => number);
  onToolCall?: (name: string, input: unknown) => void;
  onToolStart?: (name: string, input: unknown) => void;
  onToolResult?: (name: string, result: unknown) => void;
  /**
   * Called before executing any tool marked as `destructive: true`.
   * Must return a Promise<boolean> — true to approve, false to reject.
   * If rejected, the agent run stops immediately.
   */
  onToolApprovalRequest?: (name: string, input: unknown) => Promise<boolean>;
  /** Called when the agent compacts older context to stay within token limits */
  onCompaction?: (summary: string, compactedCount: number) => void;
  /**
   * Called before compaction runs when compaction mode is "ask".
   * Must return Promise<boolean> — true to proceed, false to skip this compaction.
   * If not provided, compaction always proceeds automatically.
   */
  onCompactionRequest?: (tokenEstimate: number, threshold: number) => Promise<boolean>;
  /**
   * Tool names whose history entries (assistant tool_calls + tool results) are
   * pruned from history after each final answer is delivered.
   * Use for tools whose output is only needed for the current turn (e.g. skill loaders).
   */
  ephemeralTools?: string[];
  /** Called during chained tool execution to report step progress */
  onChainProgress?: (event: ChainProgressEvent) => void;
  /**
   * Called after each chain step completes with the step's tool message payload.
   * The agent uses this to push a real history entry per step so the UI
   * shows each step live as it executes (not only after the whole chain finishes).
   */
  onChainStepMessage?: (msg: ChainStepMessage) => void;
}

// ─────────────────────────────────────────────
// MCP helpers
// ─────────────────────────────────────────────

async function fetchMCPTools(server: MCPServer): Promise<ToolDefinition[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(server.headers ?? {}),
    ...(server.authToken ? { Authorization: `Bearer ${server.authToken}` } : {})
  };

  const res = await fetch(`${server.url}/tools/list`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  if (!res.ok) {
    throw new Error(`MCP ${server.name}: tools/list failed (${res.status})`);
  }

  const { tools } = (await res.json()) as {
    tools: Array<{
      name: string;
      description: string;
      inputSchema: ToolDefinition["parameters"];
    }>;
  };

  return tools.map((t) => ({
    name: `${server.name}__${t.name}`,
    description: `[MCP: ${server.name}] ${t.description}`,
    parameters: t.inputSchema,
    execute: async (input: Record<string, unknown>) => {
      const callRes = await fetch(`${server.url}/tools/call`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: t.name, arguments: input })
      });
      if (!callRes.ok) {
        throw new Error(
          `MCP ${server.name}/${t.name} failed (${callRes.status})`
        );
      }
      const { content } = (await callRes.json()) as {
        content: Array<{ type: string; text?: string }>;
      };
      return content.map((c) => c.text ?? "").join("\n");
    }
  }));
}

// ─────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────

/** Thrown when the user rejects a destructive tool call — stops the agent run */
export class ToolRejectedError extends Error {
  readonly toolName: string;
  constructor(toolName: string) {
    super(`Tool "${toolName}" was rejected by the user.`);
    this.name = "ToolRejectedError";
    this.toolName = toolName;
  }
}

// ─────────────────────────────────────────────
// Puter tool format
// ─────────────────────────────────────────────

function toExternalTool(t: ToolDefinition) {
  return {
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }
  };
}

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
}

// ─────────────────────────────────────────────
// Token estimation & context compaction
// ─────────────────────────────────────────────

/** Rough token estimate: ~4 characters per token (GPT-family heuristic) */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/** Estimate total tokens for an array of chat messages */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const estimateMessagesTokens = (messages: any[]): number => {
  let total = 0;
  for (const m of messages) {
    total += estimateTokens(m.content ?? "");
    if (m.tool_calls) {
      total += estimateTokens(JSON.stringify(m.tool_calls));
    }
  }
  return total;
};

const COMPACTION_SYSTEM_PROMPT = `You are a context compactor. Summarize the following conversation history into a concise but complete summary that preserves:
- The user's original request and intent
- Key decisions, findings, and results from tool calls
- Important data points (IDs, names, values) that may be needed for follow-up
- Any errors or issues encountered
- The current state of the task

Be thorough with facts but extremely concise with prose. Use bullet points. Do NOT include raw tool output — summarize the relevant results only. Output ONLY the summary, no preamble.`;

// ─────────────────────────────────────────────
// Relevance scoring (Strategy 1)
// ─────────────────────────────────────────────

/** A logical turn: user prompt + assistant response + any tool messages in between */
interface ConversationTurn {
  messages: AgentMessage[];
  /** Combined text content for scoring */
  text: string;
  /** Index of first message in original history */
  startIdx: number;
  /** Estimated token count for this turn */
  tokens: number;
}

/**
 * Extract keywords from text for relevance matching.
 * Strips common stop words and returns lowercase unique terms.
 */
const extractKeywords = (text: string): Set<string> => {
  const STOP_WORDS = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above",
    "below", "between", "out", "off", "over", "under", "again", "further",
    "then", "once", "here", "there", "when", "where", "why", "how", "all",
    "both", "each", "few", "more", "most", "other", "some", "such", "no",
    "nor", "not", "only", "own", "same", "so", "than", "too", "very",
    "just", "because", "but", "and", "or", "if", "while", "about", "up",
    "that", "this", "it", "its", "i", "me", "my", "we", "our", "you",
    "your", "he", "him", "his", "she", "her", "they", "them", "their",
    "what", "which", "who", "whom", "these", "those", "am", "been",
    "also", "like", "get", "got", "make", "made", "know", "think",
    "want", "let", "use", "using", "used", "please", "help", "thanks",
    "thank", "sure", "yes", "no", "ok", "okay"
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9_\-./]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  return new Set(words);
};

/**
 * Compute TF-IDF-like relevance score between a prompt and a turn.
 * Uses keyword overlap with inverse document frequency weighting.
 * Boosts score when topic tags match between prompt and turn (Strategy 2).
 */
const computeRelevanceScore = (
  promptKeywords: Set<string>,
  turnKeywords: Set<string>,
  allTurnKeywordSets: Set<string>[],
  promptTopics?: string[],
  turnMessages?: AgentMessage[]
): number => {
  if (promptKeywords.size === 0 || turnKeywords.size === 0) return 0;

  let score = 0;
  const totalDocs = allTurnKeywordSets.length;

  for (const word of promptKeywords) {
    if (!turnKeywords.has(word)) continue;

    // IDF: how rare is this term across all turns?
    const docFreq = allTurnKeywordSets.filter((s) => s.has(word)).length;
    const idf = Math.log((totalDocs + 1) / (docFreq + 1)) + 1;

    score += idf;
  }

  // Normalize by prompt keyword count to get 0-1 range
  score = score / (promptKeywords.size * 3); // 3 is a rough max IDF

  // ── Topic tag boost (Strategy 2) ──
  if (promptTopics && promptTopics.length > 0 && turnMessages) {
    const turnTags = new Set(turnMessages.flatMap((m) => m.tags ?? []));
    const matchingTopics = promptTopics.filter((t) => turnTags.has(t));
    if (matchingTopics.length > 0) {
      // Boost: 0.2 per matching topic, up to 0.6 total
      score += Math.min(matchingTopics.length * 0.2, 0.6);
    }
  }

  return score;
};

/**
 * Segment flat history into logical conversation turns.
 * Each turn starts with a user message and includes the following
 * assistant + tool messages until the next user message.
 */
const segmentIntoTurns = (messages: AgentMessage[]): ConversationTurn[] => {
  const turns: ConversationTurn[] = [];
  let current: AgentMessage[] = [];
  let startIdx = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    // Compaction messages are standalone -- not part of a turn
    if (msg.role === "compaction") {
      if (current.length > 0) {
        const text = current.map((m) => m.content).join(" ");
        turns.push({
          messages: current,
          text,
          startIdx,
          tokens: estimateTokens(text)
        });
        current = [];
      }
      turns.push({
        messages: [msg],
        text: msg.content,
        startIdx: i,
        tokens: estimateTokens(msg.content)
      });
      startIdx = i + 1;
      continue;
    }

    if (msg.role === "user" && current.length > 0) {
      const text = current.map((m) => m.content).join(" ");
      turns.push({
        messages: current,
        text,
        startIdx,
        tokens: estimateTokens(text)
      });
      current = [];
      startIdx = i;
    }
    current.push(msg);
  }

  if (current.length > 0) {
    const text = current.map((m) => m.content).join(" ");
    turns.push({
      messages: current,
      text,
      startIdx,
      tokens: estimateTokens(text)
    });
  }

  return turns;
};

// ─────────────────────────────────────────────
// Tiered context helpers (Strategy 3)
// ─────────────────────────────────────────────

/**
 * Condense a turn for the "warm" tier:
 * - Keep user messages verbatim
 * - Keep assistant text but strip tool_calls details
 * - Truncate tool results to a short summary
 */
const condenseTurn = (turn: ConversationTurn): AgentMessage[] => {
  const TOOL_RESULT_MAX = 500;
  return turn.messages.map((m) => {
    if (m.role === "tool") {
      const truncated =
        m.content.length > TOOL_RESULT_MAX
          ? m.content.slice(0, TOOL_RESULT_MAX) + "... [truncated]"
          : m.content;
      return { ...m, content: truncated };
    }
    return m;
  });
};

// ─────────────────────────────────────────────
// Context budget allocation (Strategy 5)
// ─────────────────────────────────────────────

interface ContextBudget {
  /** Tokens reserved for system prompt */
  systemPrompt: number;
  /** Tokens reserved for cold tier (compaction summaries) */
  cold: number;
  /** Tokens for relevant older turns (warm, condensed) */
  warm: number;
  /** Tokens for most recent turns (hot, verbatim) */
  hot: number;
  /** Tokens reserved for tool definitions */
  tools: number;
  /** Tokens reserved for model response */
  response: number;
}

const allocateContextBudget = (
  totalBudget: number,
  systemPromptTokens: number,
  toolTokens: number
): ContextBudget => {
  const responseReserve = Math.min(4000, totalBudget * 0.15);
  const remaining = totalBudget - systemPromptTokens - toolTokens - responseReserve;

  return {
    systemPrompt: systemPromptTokens,
    cold: Math.floor(remaining * 0.10),  // 10% for compaction summaries
    warm: Math.floor(remaining * 0.40),  // 40% for relevant older turns
    hot: Math.floor(remaining * 0.45),   // 45% for recent turns
    tools: toolTokens,
    response: responseReserve
  };
};

// ─────────────────────────────────────────────
// Topic tagging (Strategy 2)
// ─────────────────────────────────────────────

/**
 * Heuristic topic tagger for NetSuite conversations.
 * Scans text content and assigns 1-3 topic labels based on keyword patterns.
 * Fast (no API call), runs synchronously after each turn.
 */
const TOPIC_PATTERNS: Array<{ topic: string; patterns: RegExp }> = [
  { topic: "saved-search", patterns: /\b(saved.?search|search\.create|search\.load|n\/search|search\.Type)\b/i },
  { topic: "record-ops", patterns: /\b(record\.(load|create|copy|delete|transform|submitFields)|n\/record|currentRecord)\b/i },
  { topic: "suitelet", patterns: /\b(suitelet|serverWidget|n\/ui\/serverWidget|NScriptType\s+Suitelet)\b/i },
  { topic: "user-event", patterns: /\b(user.?event|beforeSubmit|afterSubmit|beforeLoad|NScriptType\s+UserEvent)\b/i },
  { topic: "client-script", patterns: /\b(client.?script|pageInit|fieldChanged|saveRecord|validateLine|NScriptType\s+Client)\b/i },
  { topic: "map-reduce", patterns: /\b(map.?reduce|getInputData|reduce\s*\(|summarize|NScriptType\s+MapReduce)\b/i },
  { topic: "scheduled-script", patterns: /\b(scheduled.?script|NScriptType\s+Scheduled)\b/i },
  { topic: "restlet", patterns: /\b(restlet|NScriptType\s+Restlet)\b/i },
  { topic: "workflow", patterns: /\b(workflow|n\/workflow|workflowAction)\b/i },
  { topic: "customer", patterns: /\b(customer|entity|contact|lead|prospect)\b/i },
  { topic: "sales-order", patterns: /\b(sales.?order|salesorder)\b/i },
  { topic: "invoice", patterns: /\b(invoice|billing|payment)\b/i },
  { topic: "inventory", patterns: /\b(inventory|item.?receipt|item.?fulfillment|transfer.?order|warehouse)\b/i },
  { topic: "deployment", patterns: /\b(deploy|deployment|script.?record|script.?id|scriptdeployment)\b/i },
  { topic: "suiteql", patterns: /\b(suiteql|n\/query|query\.runSuiteQL|query\.create)\b/i },
  { topic: "file-ops", patterns: /\b(file\.(load|create|delete)|n\/file|file.?cabinet)\b/i },
  { topic: "email", patterns: /\b(email\.send|n\/email|email\.sendBulk)\b/i },
  { topic: "http-request", patterns: /\b(https?\.(get|post|put|delete|request)|n\/https?)\b/i },
  { topic: "error-handling", patterns: /\b(try|catch|error|throw|n\/error|SuiteScriptError)\b/i },
  { topic: "sublist", patterns: /\b(sublist|line|getLineCount|setSublistValue|insertLine|removeLine)\b/i },
  { topic: "permissions", patterns: /\b(permission|role|access|restrict|authorize)\b/i },
  { topic: "csv-import", patterns: /\b(csv|import|n\/task.*csvImport|CsvImportTask)\b/i },
];

const detectTopics = (text: string): string[] => {
  const matched: string[] = [];
  for (const { topic, patterns } of TOPIC_PATTERNS) {
    if (patterns.test(text)) {
      matched.push(topic);
    }
  }
  return matched.slice(0, 3); // Max 3 topics
};

/**
 * Tag recent untagged messages in history with detected topics.
 * Called after each agent turn completes.
 */
const tagRecentMessages = (historyRef: AgentMessage[]) => {
  // Walk backwards from the end, tag any untagged user/assistant messages
  for (let i = historyRef.length - 1; i >= 0; i--) {
    const msg = historyRef[i]!;

    // Stop at the first already-tagged message or compaction boundary
    if (msg.tags && msg.tags.length > 0) break;
    if (msg.role === "compaction") break;

    if (msg.role === "user" || msg.role === "assistant") {
      const topics = detectTopics(msg.content);
      if (topics.length > 0) {
        msg.tags = topics;
      }
    }
    // Also tag tool results based on their content
    if (msg.role === "tool") {
      const topics = detectTopics(msg.content);
      if (topics.length > 0) {
        msg.tags = topics;
      }
    }
  }
};

// ─────────────────────────────────────────────
// Composable
// ─────────────────────────────────────────────

export const useAgent = (options: AgentOptions = {}) => {
  const {
    tools: localTools = [],
    chainedTools: chainedToolDefs = [],
    mcpServers = [],
    systemPrompt: defaultSystemPrompt = "You are a helpful AI assistant.",
    keepHistory = true,
    compactionThreshold: rawThreshold = 80000,
    onToolCall,
    onToolStart,
    onToolResult,
    onToolApprovalRequest,
    onCompaction,
    onCompactionRequest,
    ephemeralTools = [],
    onChainProgress,
    onChainStepMessage
  } = options;

  /** Resolve threshold — supports both static number and getter for reactive settings */
  const getCompactionThreshold = (): number =>
    typeof rawThreshold === "function" ? rawThreshold() : rawThreshold;

  const { chatCompletion } = useAiProvider();

  const loading = ref(false);
  const error = ref<unknown>(null);
  const history = ref<AgentMessage[]>([]);
  const currentResponse = ref("");
  const mcpToolsLoaded = ref(false);
  /** Tracks the most recent compaction event for UI display */
  const lastCompaction = ref<{ summary: string; compactedCount: number } | null>(null);
  /** Estimated token count of the current context (updated each run iteration) */
  const contextTokens = ref(0);

  // ── Build tool registry from local tools first ──
  const toolRegistry = ref<Map<string, ToolDefinition>>(
    new Map(localTools.map((t) => [t.name, t]))
  );

  /** Set of chained tool names for priority routing */
  const chainedToolNames = new Set(chainedToolDefs.map((c) => c.name));

  // ── Register chained tools *after* the registry exists ──
  // toToolDefinition needs a live getter for the registry (to resolve step tools
  // at execution time, not at definition time) and references to the agent hooks
  // so each chain step fires onToolStart/onToolResult/approval exactly like a plain call.
  // chatCompletion is passed so AI steps can run a mini agent loop internally.
  // onStepMessage lets each step push its own real history entry in real-time.
  chainedToolDefs.forEach((chain) => {
    const chainTool = toToolDefinition(
      chain,
      () => toolRegistry.value,
      {
        onToolStart,
        onToolResult,
        onToolApprovalRequest
      },
      chatCompletion,
      onChainProgress,
      onChainStepMessage
        ? (stepMsg) => onChainStepMessage(stepMsg)
        : undefined
    );
    toolRegistry.value.set(chain.name, chainTool);
  });

  // ── MCP bootstrap ───────────────────────────
  const loadMCPTools = async () => {
    if (mcpToolsLoaded.value || mcpServers.length === 0) return;
    console.log(
      "[useAgent] Loading MCP tools from",
      mcpServers.length,
      "server(s)…"
    );

    const results = await Promise.allSettled(mcpServers.map(fetchMCPTools));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        r.value.forEach((t) => toolRegistry.value.set(t.name, t));
        console.log(
          `[useAgent] MCP "${mcpServers[i]!.name}" — ${r.value.length} tool(s) loaded`
        );
      } else {
        console.warn(
          `[useAgent] MCP "${mcpServers[i]!.name}" failed:`,
          r.reason
        );
      }
    });

    mcpToolsLoaded.value = true;
  };

  // ── History helpers ─────────────────────────
  const pushMessage = (msg: Omit<AgentMessage, "timestamp">) => {
    const full: AgentMessage = { ...msg, timestamp: new Date() };
    history.value.push(full);
    return full;
  };

  const clearHistory = () => {
    history.value = [];
    lastCompaction.value = null;
    contextTokens.value = 0;
  };

  /**
   * Replace agent history with the given messages.
   * Used to restore context when loading a saved chat.
   */
  const setHistory = (msgs: AgentMessage[]) => {
    history.value = [...msgs];
    lastCompaction.value = null;
    const compaction = msgs.find((m) => m.role === "compaction");
    if (compaction) {
      lastCompaction.value = {
        summary: compaction.content,
        compactedCount: compaction.compactedCount ?? 0
      };
    }
    updateContextTokens();
  };

  /**
   * Build the messages array for the API call.
   *
   * Uses a three-tier context system:
   *   - **Hot** (last 3-4 turns): full verbatim messages
   *   - **Warm** (older relevant turns): condensed (tool results truncated)
   *   - **Cold** (compaction summaries): injected as system context
   *
   * Within the warm tier, turns are selected by relevance to the current
   * prompt using TF-IDF keyword scoring (Strategy 1), respecting a token
   * budget (Strategy 5).
   *
   * The OpenAI-compatible format requires:
   *   1. An assistant message that includes `tool_calls` when it requested tools.
   *   2. Immediately after, one `tool` message per call, each with a matching
   *      `tool_call_id` and the result in `content`.
   *
   * Compaction messages are included as system reminders so the model sees
   * the summarized context without breaking the message format.
   */
  const buildMessages = (systemPrompt: string, currentPrompt?: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgs: any[] = [{ role: "system", content: systemPrompt }];

    const source = keepHistory ? history.value : history.value.slice(-20);

    // If history is small (< 12 messages), skip smart selection -- send everything
    if (source.length < 12 || !currentPrompt) {
      for (const m of source) {
        msgs.push(formatMessageForApi(m));
      }
      return msgs;
    }

    // ── Segment history into turns ──
    const turns = segmentIntoTurns(source);

    if (turns.length <= 3) {
      // Too few turns to bother with tiered selection
      for (const m of source) {
        msgs.push(formatMessageForApi(m));
      }
      return msgs;
    }

    // ── Allocate budget ──
    const totalBudget = getCompactionThreshold();
    const systemTokens = estimateTokens(systemPrompt);
    const toolTokenEstimate = Math.floor(totalBudget * 0.12); // rough estimate for tool defs
    const budget = allocateContextBudget(totalBudget, systemTokens, toolTokenEstimate);

    // ── Separate tiers ──
    const HOT_TURN_COUNT = Math.min(3, turns.length);
    const hotTurns = turns.slice(-HOT_TURN_COUNT);
    const olderTurns = turns.slice(0, -HOT_TURN_COUNT);

    // ── Cold tier: compaction messages (always included) ──
    const coldTurns = olderTurns.filter(
      (t) => t.messages.length === 1 && t.messages[0]!.role === "compaction"
    );
    const warmCandidates = olderTurns.filter(
      (t) => !(t.messages.length === 1 && t.messages[0]!.role === "compaction")
    );

    // ── Score warm candidates by relevance ──
    const promptKeywords = extractKeywords(currentPrompt);
    const promptTopics = detectTopics(currentPrompt);
    const allKeywordSets = warmCandidates.map((t) => extractKeywords(t.text));

    const scoredWarm = warmCandidates.map((turn, i) => ({
      turn,
      score: computeRelevanceScore(
        promptKeywords,
        allKeywordSets[i]!,
        allKeywordSets,
        promptTopics,
        turn.messages
      ),
      keywords: allKeywordSets[i]!
    }));

    // Sort by relevance score descending
    scoredWarm.sort((a, b) => b.score - a.score);

    // ── Select warm turns within budget ──
    const selectedWarm: ConversationTurn[] = [];
    let warmTokensUsed = 0;

    for (const { turn, score } of scoredWarm) {
      // Skip turns with zero relevance unless we have plenty of budget
      if (score === 0 && warmTokensUsed > budget.warm * 0.5) continue;

      const condensed = condenseTurn(turn);
      const turnTokens = condensed.reduce(
        (sum, m) => sum + estimateTokens(m.content),
        0
      );

      if (warmTokensUsed + turnTokens > budget.warm) continue;

      selectedWarm.push({ ...turn, messages: condensed, tokens: turnTokens });
      warmTokensUsed += turnTokens;
    }

    // Re-sort selected warm turns by original position (chronological)
    selectedWarm.sort((a, b) => a.startIdx - b.startIdx);

    // ── Assemble final message array ──

    // Cold tier (compaction summaries)
    for (const turn of coldTurns) {
      for (const m of turn.messages) {
        msgs.push(formatMessageForApi(m));
      }
    }

    // Warm tier (relevant older turns, condensed)
    if (selectedWarm.length > 0) {
      msgs.push({
        role: "system",
        content: `[Relevant earlier context — ${selectedWarm.length} turn(s) selected by relevance from ${warmCandidates.length} older turns]`
      });
      for (const turn of selectedWarm) {
        for (const m of turn.messages) {
          msgs.push(formatMessageForApi(m));
        }
      }
    }

    // Hot tier (recent turns, verbatim)
    for (const turn of hotTurns) {
      for (const m of turn.messages) {
        msgs.push(formatMessageForApi(m));
      }
    }

    return msgs;
  };

  /**
   * Format a single AgentMessage into the API-compatible shape.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formatMessageForApi = (m: AgentMessage): any => {
    if (m.role === "compaction") {
      return {
        role: "system",
        content: `[Context Summary — the following summarizes earlier conversation that was compacted to save context space]\n\n${m.content}`
      };
    }
    if (m.role === "assistant") {
      if (m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: m.content ?? "",
          tool_calls: m.toolCalls
        };
      }
      return { role: "assistant", content: m.content };
    }
    if (m.role === "tool") {
      return {
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content
      };
    }
    return { role: m.role, content: m.content };
  };

  /** Recompute contextTokens from current history (call after any history mutation outside run()) */
  const updateContextTokens = () => {
    const msgs = buildMessages(defaultSystemPrompt);
    contextTokens.value = estimateMessagesTokens(msgs);
  };

  // ── Context compaction ──────────────────────

  /**
   * Compacts older history messages into a summary when the estimated
   * token count exceeds the threshold. Keeps the most recent messages
   * intact to preserve the active tool-calling context.
   *
   * Returns true if compaction was performed.
   */
  const compactIfNeeded = async (systemPrompt: string): Promise<boolean> => {
    const messages = buildMessages(systemPrompt);
    const tokenEstimate = estimateMessagesTokens(messages);
    const threshold = getCompactionThreshold();

    if (tokenEstimate < threshold) {
      return false;
    }

    // If caller wants to ask user before compacting, await their decision
    if (onCompactionRequest) {
      const approved = await onCompactionRequest(tokenEstimate, threshold);
      if (!approved) {
        console.log("[useAgent] Compaction skipped by user.");
        return false;
      }
    }

    console.log(
      `[useAgent] Context at ~${tokenEstimate} tokens (threshold: ${threshold}). Compacting…`
    );

    // Find a safe split point: keep the last few complete turns
    // (a "turn" = user + assistant + any tool messages in between).
    // We keep at least the last 6 messages to preserve active context.
    const KEEP_RECENT = 6;
    const historyLen = history.value.length;

    if (historyLen <= KEEP_RECENT) {
      // Not enough messages to compact meaningfully
      return false;
    }

    // Walk backwards to find a clean split point (before a user message)
    let splitIdx = historyLen - KEEP_RECENT;
    while (splitIdx > 0 && history.value[splitIdx]!.role !== "user") {
      splitIdx--;
    }

    if (splitIdx <= 0) {
      return false;
    }

    const toCompact = history.value.slice(0, splitIdx);
    const toKeep = history.value.slice(splitIdx);

    // Build a text representation of the messages to compact
    const compactionInput = toCompact
      .filter((m) => m.role !== "compaction")
      .map((m) => {
        if (m.role === "user") return `User: ${m.content}`;
        if (m.role === "assistant") {
          const toolInfo = m.toolCalls?.length
            ? ` [called tools: ${m.toolCalls.map((tc) => tc.function.name).join(", ")}]`
            : "";
          return `Assistant${toolInfo}: ${m.content}`;
        }
        if (m.role === "tool") return `Tool (${m.toolName ?? "unknown"}): ${m.content.slice(0, 2000)}`;
        return `${m.role}: ${m.content}`;
      })
      .join("\n\n");

    // Include any existing compaction summaries so they are re-summarized too
    const existingCompactions = toCompact
      .filter((m) => m.role === "compaction")
      .map((m) => `Previous summary: ${m.content}`)
      .join("\n\n");

    const fullInput = existingCompactions
      ? `${existingCompactions}\n\n---\n\n${compactionInput}`
      : compactionInput;

    try {
      const summaryResponse = await chatCompletion([
        { role: "system", content: COMPACTION_SYSTEM_PROMPT },
        { role: "user", content: fullInput }
      ]);

      const summary = summaryResponse.content ?? "[compaction failed]";
      const compactedCount = toCompact.filter((m) => m.role !== "compaction").length;

      console.log(
        `[useAgent] Compacted ${compactedCount} messages into summary (${summary.length} chars)`
      );

      // Replace history: compaction summary + recent messages
      history.value = [
        {
          role: "compaction" as const,
          content: summary,
          compactedCount,
          timestamp: new Date()
        },
        ...toKeep
      ];

      lastCompaction.value = { summary, compactedCount };
      onCompaction?.(summary, compactedCount);
      return true;
    } catch (compactionErr) {
      console.error("[useAgent] Compaction failed:", compactionErr);
      return false;
    }
  };

  // ── Ephemeral tool pruning ───────────────────
  /**
   * After a final answer is delivered, strip assistant messages whose
   * toolCalls are exclusively ephemeral tools, and the matching tool result
   * messages. This prevents skill-loader content from accumulating in context
   * across unrelated follow-up turns.
   */
  const pruneEphemeralTools = (toolNames: string[]) => {
    const ephemeralSet = new Set(toolNames);

    // Collect IDs of tool result messages that are ephemeral
    const ephemeralToolCallIds = new Set<string>();

    for (const msg of history.value) {
      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        const allEphemeral = msg.toolCalls.every((tc) =>
          ephemeralSet.has(tc.function.name)
        );
        if (allEphemeral) {
          msg.toolCalls.forEach((tc) => ephemeralToolCallIds.add(tc.id));
        }
      }
    }

    if (ephemeralToolCallIds.size === 0) return;

    // Remove tool result messages with matching toolCallIds
    // and assistant messages whose ALL tool_calls were ephemeral
    history.value = history.value.filter((msg) => {
      if (msg.role === "tool" && msg.toolCallId && ephemeralToolCallIds.has(msg.toolCallId)) {
        return false;
      }
      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
        const allEphemeral = msg.toolCalls.every((tc) =>
          ephemeralSet.has(tc.function.name)
        );
        if (allEphemeral) return false;
      }
      return true;
    });

    console.log(
      `[useAgent] Pruned ephemeral tool messages (${toolNames.join(", ")}). History now ${history.value.length} messages.`
    );

    // Recompute token count after pruning
    updateContextTokens();
  };

  // ── Smart tool selection ────────────────────

  /**
   * Patterns that indicate the prompt is purely general-purpose
   * (math, time, greetings) and NetSuite tools can be excluded.
   * Only excludes NetSuite tools when the prompt is SHORT and
   * clearly non-NetSuite — avoids false negatives.
   */
  const GENERAL_ONLY_PATTERNS = /^(what\s+(is|are)\s+\d|calculate|how\s+much\s+is|what\s+time|hello|hi|hey|good\s+(morning|afternoon|evening)|thanks?|thank\s+you)\b/i;

  // Patterns that indicate code generation / writing intent
  const CODE_GEN_PATTERNS = /\b(generate|create|write|build|make|code|script|implement|develop|fix|debug|refactor|modify|update|add|change|edit|scaffold|example|snippet|template|suitelet|restlet|user.?event|client.?script|map.?reduce|scheduled|suitescript)\b/i;

  /**
   * Select tools relevant to the current prompt.
   *
   * **Chained tool priority**: When the prompt matches a chained tool's
   * intent patterns, that chained tool is placed FIRST in the list and
   * the individual tools it replaces are still included (as fallback),
   * but the AI description guides it to prefer the chained tool.
   *
   * This is a **NetSuite extension**, so NetSuite tools are included by
   * default. They are only excluded when the prompt is short and clearly
   * general-purpose (e.g. "what is 2+2", "hello").
   *
   * Categories:
   *   - Chained tools: prioritized when intent matches
   *   - General tools (calculate, get_current_time, fetch_url): always included
   *   - NetSuite tools (netsuite_*): included by default, excluded only for
   *     clearly non-NetSuite prompts
   *   - Skill tools (search_skills, load_skill): included when code generation detected
   *   - MCP tools (contain "__"): always included (user explicitly configured them)
   */
  const selectRelevantTools = (prompt: string): ReturnType<typeof toExternalTool>[] => {
    const allTools = Array.from(toolRegistry.value.values());
    const isCodeGen = CODE_GEN_PATTERNS.test(prompt);
    const ephemeralSet = new Set(ephemeralTools);

    // Only exclude NetSuite tools for short, clearly non-NetSuite prompts
    const isGeneralOnly = prompt.length < 60 && GENERAL_ONLY_PATTERNS.test(prompt.trim());

    // Check if a chained tool matches the prompt intent
    const matchedChain = matchChainedToolIntent(prompt, chainedToolDefs);

    // When a chain matches, collect all step tool names it owns so we can exclude
    // them from the tool list — the chain handles them internally.
    const excludedStepTools = new Set<string>();
    if (matchedChain) {
      const matchedChainDef = chainedToolDefs.find((c) => c.name === matchedChain);
      matchedChainDef?.steps.forEach((s) => excludedStepTools.add(s.toolName));
    }

    const selected = allTools.filter((tool) => {
      // Chained tools: include when intent matches, otherwise exclude
      if (chainedToolNames.has(tool.name)) {
        return tool.name === matchedChain;
      }

      // Step tools owned by the matched chain: always exclude them — the chain
      // calls them internally with the correct data flow.
      if (excludedStepTools.has(tool.name)) return false;

      // MCP tools (namespaced with "__") are always included
      if (tool.name.includes("__")) return true;

      // NetSuite tools: included by default, excluded only for general-only prompts
      if (tool.name.startsWith("netsuite_")) return !isGeneralOnly;

      // Skill tools: only when code generation is detected
      if (ephemeralSet.has(tool.name)) return isCodeGen;

      // General tools: always included
      return true;
    });

    // If a chained tool matched, move it to the front so the AI sees it first
    if (matchedChain) {
      const chainIdx = selected.findIndex((t) => t.name === matchedChain);
      if (chainIdx > 0) {
        const [chainTool] = selected.splice(chainIdx, 1);
        selected.unshift(chainTool!);
      }
      console.log(
        `[useAgent] Chained tool "${matchedChain}" matched prompt intent — prioritized`
      );
    }

    return selected.map(toExternalTool);
  };

  // ── Agentic run loop ────────────────────────
  const run = async (
    prompt: string,
    runOptions: AgentRunOptions = {}
  ): Promise<string> => {
    const { systemPrompt = defaultSystemPrompt, maxIterations = 10 } =
      runOptions;

    loading.value = true;
    error.value = null;
    currentResponse.value = "";

    console.log("[useAgent] run() →", prompt);

    try {
      await loadMCPTools();

      pushMessage({ role: "user", content: prompt });

      const allTools = selectRelevantTools(prompt);
      console.log(
        `[useAgent] Registry: [${Array.from(toolRegistry.value.values()).map((t) => t.name).join(", ") || "no tools"}]`
      );
      console.log(
        `[useAgent] Selected tools for this run: [${allTools.map((t) => t.function.name).join(", ") || "none"}]`
      );

      let iterations = 0;

      while (iterations < maxIterations) {
        iterations++;

        // ── Check if context needs compaction ──
        await compactIfNeeded(systemPrompt);

        const messages = buildMessages(systemPrompt, prompt);
        contextTokens.value = estimateMessagesTokens(messages);

        console.log(`[useAgent] ── Iteration ${iterations} ──`);
        console.log(
          "[useAgent] Messages being sent:",
          JSON.stringify(messages, null, 2)
        );

        let response: { content: string | null; tool_calls: ToolCall[] };
        try {
          response = await chatCompletion(messages, { tools: allTools.length > 0 ? allTools : undefined });
          console.log(
            "[useAgent] Provider response:",
            JSON.stringify(response, null, 2)
          );
        } catch (providerErr) {
          console.error("[useAgent] chatCompletion threw:", providerErr);
          throw providerErr;
        }

        // Response is already normalised by the provider adapter
        const assistantText = response.content ?? "";
        const toolCalls: ToolCall[] = response.tool_calls;

        console.log(
          `[useAgent] assistantText="${assistantText}" | toolCalls=${toolCalls.length}`
        );

        // ── No tool calls → final answer ───────
        if (toolCalls.length === 0) {
          pushMessage({
            role: "assistant",
            content: assistantText || "[no response]"
          });
          currentResponse.value = assistantText;
          // Tag recent messages with topics for future relevance scoring
          tagRecentMessages(history.value);
          // Prune ephemeral tool messages so they don't bloat future context
          if (ephemeralTools.length > 0) {
            pruneEphemeralTools(ephemeralTools);
          }
          console.log("[useAgent] ✓ Final answer returned");
          return assistantText;
        }

        // ── Push assistant message WITH tool_calls so buildMessages can
        //    replay them correctly on the next iteration. ─────────────
        history.value.push({
          role: "assistant",
          content: assistantText || "",
          toolCalls, // ← key fix: stored for replay
          timestamp: new Date()
        });

        // ── Execute tool calls ──────────────────
        await Promise.all(
          toolCalls.map(async (call) => {
            const toolName = call.function.name;
            const toolInput = (() => {
              try {
                return typeof call.function.arguments === "string"
                  ? JSON.parse(call.function.arguments)
                  : (call.function.arguments as Record<string, unknown>);
              } catch {
                return {};
              }
            })();

            const isChain = chainedToolNames.has(toolName);
            const tool = toolRegistry.value.get(toolName);

            console.log(`[useAgent] → Calling tool "${toolName}"`, toolInput);

            // For chained tools: do NOT fire onToolCall (prevents chain appearing
            // in "Used tools" section — steps will show individually instead)
            if (!isChain) {
              onToolCall?.(toolName, toolInput);
            }

            // ── Approval gate: only for non-chain destructive tools ──
            // Chain steps handle their own approval gate inside the executor.
            if (!isChain && tool?.destructive && onToolApprovalRequest) {
              const approved = await onToolApprovalRequest(toolName, toolInput);
              if (!approved) {
                throw new ToolRejectedError(toolName);
              }
            }

            // ── For chained tools, skip outer onToolStart/onToolResult ──
            // The chain executor calls those hooks internally per-step.
            if (!isChain) {
              onToolStart?.(toolName, toolInput);
            }

            let resultContent: string;

            if (!tool) {
              resultContent = JSON.stringify({
                error: `Unknown tool: ${toolName}`
              });
              console.warn(
                `[useAgent] Tool "${toolName}" not found in registry!`
              );
            } else {
              try {
                const result = await tool.execute(toolInput);
                resultContent =
                  typeof result === "string" ? result : JSON.stringify(result);
                console.log(
                  `[useAgent] ← Tool "${toolName}" result:`,
                  resultContent
                );
                if (!isChain) {
                  onToolResult?.(toolName, result);
                }
              } catch (execErr) {
                resultContent = JSON.stringify({ error: String(execErr) });
                console.error(`[useAgent] Tool "${toolName}" threw:`, execErr);
                if (!isChain) {
                  onToolResult?.(toolName, { error: String(execErr) });
                }
              }
            }

            // For chains: skip the outer pushMessage — each step already pushed
            // its own history entry via onStepMessage. Push only a thin wrapper
            // message so the AI gets the final summary in context.
            pushMessage({
              role: "tool",
              content: resultContent,
              toolName,
              toolCallId: call.id
            });
          })
        );
        // Loop — tool results now in history, re-query model
      }

      const fallback = "[Max iterations reached without a final answer.]";
      console.warn("[useAgent]", fallback);
      pushMessage({ role: "assistant", content: fallback });
      currentResponse.value = fallback;
      return fallback;
    } catch (err) {
      error.value = err;
      console.error("[useAgent] run() fatal error:", err);
      // Re-throw ToolRejectedError so callers can detect rejection vs other errors
      if (err instanceof ToolRejectedError) {
        throw err;
      }
      return "";
    } finally {
      loading.value = false;
    }
  };

  // ── Simple one-shot chat ─────────────────────
  const chat = async (
    prompt: string,
    systemPrompt = defaultSystemPrompt
  ): Promise<string> => {
    loading.value = true;
    error.value = null;
    console.log("[useAgent] chat() →", prompt);
    try {
      const response = await chatCompletion([
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ]);
      const text = response.content ?? "";
      console.log("[useAgent] chat() ←", text);
      return text;
    } catch (err) {
      error.value = err;
      console.error("[useAgent] chat() error:", err);
      return "";
    } finally {
      loading.value = false;
    }
  };

  // ── Tool management ──────────────────────────
  const registerTool = (tool: ToolDefinition) => {
    toolRegistry.value.set(tool.name, tool);
    console.log(`[useAgent] Registered tool: ${tool.name}`);
  };

  const unregisterTool = (name: string) => {
    toolRegistry.value.delete(name);
  };

  const getTools = () => Array.from(toolRegistry.value.values());

  const addMCPServer = async (server: MCPServer) => {
    try {
      const tools = await fetchMCPTools(server);
      tools.forEach((t) => toolRegistry.value.set(t.name, t));
      console.log(
        `[useAgent] addMCPServer "${server.name}": ${tools.length} tool(s)`
      );
    } catch (err) {
      console.error(`[useAgent] addMCPServer "${server.name}" failed:`, err);
      throw err;
    }
  };

  return {
    run,
    chat,
    registerTool,
    unregisterTool,
    getTools,
    addMCPServer,
    loadMCPTools,
    updateContextTokens,
    getCompactionThreshold,
    history: readonly(history),
    clearHistory,
    setHistory,
    loading: readonly(loading),
    error: readonly(error),
    currentResponse: readonly(currentResponse),
    mcpToolsLoaded: readonly(mcpToolsLoaded),
    lastCompaction: readonly(lastCompaction),
    contextTokens: readonly(contextTokens)
  };
};
