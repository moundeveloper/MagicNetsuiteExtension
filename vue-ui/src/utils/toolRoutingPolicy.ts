/**
 * toolRoutingPolicy.ts
 *
 * Policy-driven tool router and evaluator.
 *
 * Implements the proposal:
 *   1.  Tool registry metadata (cost, latency, risk, failure modes)
 *   2.  Decision policy rules (explicit routing axioms)
 *   3.  Planning step prompt (goal → needed info → candidate tools → chosen → why)
 *   4.  Cost-aware tool ranking (accuracy gain / latency / price / risk / reversibility)
 *   5.  Post-result evaluation prompt (satisfied? follow-up? conflicts?)
 *   6.  Few-shot examples injected into the harness
 *   7.  Telemetry store (tool choice, latency, outcome, validation failures)
 */

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

/** Cost tier for a tool call */
export type CostTier = "free" | "cheap" | "moderate" | "expensive";

/** Risk level for a tool execution */
export type RiskLevel = "none" | "low" | "medium" | "high";

/** Enriched metadata stored alongside each tool definition */
export interface ToolMetadata {
  /** What this tool does in one sentence */
  purpose: string;
  /**
   * Relative cost of calling this tool.
   * free   → pure computation, no external calls
   * cheap  → fast NetSuite read or simple API call
   * moderate → multi-round NetSuite read or external fetch
   * expensive → destructive write, upload, or multi-hop query
   */
  costTier: CostTier;
  /** Rough expected latency in milliseconds */
  expectedLatencyMs: number;
  /** Risk of calling this tool */
  riskLevel: RiskLevel;
  /** True when the action can be undone without side effects */
  reversible: boolean;
  /** Known failure modes — returned as hints when the tool fails */
  failureModes: string[];
  /** Conditions under which this tool should be preferred */
  preferWhen?: string;
  /** Conditions under which this tool must not be used */
  avoidWhen?: string;
}

/** A named routing rule with a human-readable description */
export interface RoutingRule {
  id: string;
  description: string;
  rationale: string;
}

/**
 * Represents the model's pre-call plan.
 * Parsed from the model's inline <plan> block when present.
 */
export interface ToolPlan {
  goal: string;
  neededInfo: string;
  candidateTools: string[];
  chosenTool: string;
  rationale: string;
}

/**
 * Post-call evaluation — did the tool result satisfy the need?
 * Injected as a structured prompt after each tool result batch.
 */
export interface ToolEvaluation {
  toolName: string;
  satisfied: boolean;
  followUpRequired: boolean;
  conflictsDetected: boolean;
  notes?: string;
}

/** One telemetry record per tool execution */
export interface ToolTelemetryEntry {
  timestamp: Date;
  toolName: string;
  /** JSON-serialised subset of input args (first 200 chars) */
  inputSummary: string;
  /** First 300 chars of the result */
  resultSummary: string;
  latencyMs: number;
  /** null = not evaluated yet */
  satisfied: boolean | null;
  followUpRequired: boolean | null;
  validationFailed: boolean;
  wasBlocked: boolean;
  iterationNumber: number;
}

// ─────────────────────────────────────────────
// Tool Metadata Registry
// ─────────────────────────────────────────────

/**
 * Metadata for every registered tool.
 * Keys are tool names; tools not listed here get default "moderate/unknown" metadata.
 */
export const TOOL_METADATA: Record<string, ToolMetadata> = {
  // ── General utility ────────────────────────
  calculate: {
    purpose: "Evaluate a safe mathematical expression",
    costTier: "free",
    expectedLatencyMs: 1,
    riskLevel: "none",
    reversible: true,
    failureModes: ["invalid expression syntax"],
    preferWhen: "user asks for arithmetic or numeric computation",
    avoidWhen: "question can be answered by the model without calculation",
  },
  get_current_time: {
    purpose: "Return the current date and time",
    costTier: "free",
    expectedLatencyMs: 1,
    riskLevel: "none",
    reversible: true,
    failureModes: ["invalid timezone identifier"],
    preferWhen: "user explicitly asks for the current time or date",
    avoidWhen: "time/date is not relevant to the task",
  },
  fetch_url: {
    purpose: "Fetch the text content of a public web URL",
    costTier: "moderate",
    expectedLatencyMs: 3000,
    riskLevel: "low",
    reversible: true,
    failureModes: [
      "network timeout",
      "page requires authentication",
      "robot detection",
      "NetSuite URLs always fail — use netsuite_* tools instead",
    ],
    preferWhen: "user needs content from a public documentation or web page",
    avoidWhen:
      "URL is on *.netsuite.com or /core/media/* — use netsuite_get_file_content",
  },
  // ── SuiteQL / query ────────────────────────
  sql_search_tables: {
    purpose: "Discover which NetSuite SuiteQL tables match a keyword",
    costTier: "cheap",
    expectedLatencyMs: 500,
    riskLevel: "none",
    reversible: true,
    failureModes: ["no tables found for keyword"],
    preferWhen:
      "you need to find which table holds a specific NetSuite record type before writing a query",
    avoidWhen:
      "you already know the exact table name (e.g. 'transaction', 'customer')",
  },
  sql_get_table_fields: {
    purpose: "List all fields available in a given SuiteQL table",
    costTier: "cheap",
    expectedLatencyMs: 500,
    riskLevel: "none",
    reversible: true,
    failureModes: ["unknown table name"],
    preferWhen: "you know the table but need to discover the correct field names",
    avoidWhen: "field names are already known from prior context",
  },
  sql_get_table_joins: {
    purpose: "Discover foreign-key joins between SuiteQL tables",
    costTier: "cheap",
    expectedLatencyMs: 500,
    riskLevel: "none",
    reversible: true,
    failureModes: ["table has no registered joins"],
    preferWhen:
      "you need to relate two tables (e.g. transaction → transactionline)",
  },
  sql_execute_query: {
    purpose: "Execute a SuiteQL SELECT query against the live NetSuite database",
    costTier: "moderate",
    expectedLatencyMs: 2000,
    riskLevel: "low",
    reversible: true,
    failureModes: [
      "syntax error in SQL",
      "table or field name incorrect",
      "governance limit exceeded",
      "zero rows — consider relaxing filters or checking field values",
    ],
    preferWhen:
      "you need exact data from NetSuite and have confirmed the table/field names",
    avoidWhen:
      "table or field names are still unknown — discover them with sql_search_tables first",
  },
  sql_discover_field_values: {
    purpose: "Sample distinct values for a field to calibrate filters",
    costTier: "cheap",
    expectedLatencyMs: 800,
    riskLevel: "none",
    reversible: true,
    failureModes: ["field has too many distinct values", "field does not exist"],
    preferWhen: "query returned 0 rows and you need to understand valid field values",
  },
  sql_get_editor_query: {
    purpose: "Load and inspect a saved SuiteQL query from the query editor",
    costTier: "cheap",
    expectedLatencyMs: 600,
    riskLevel: "none",
    reversible: true,
    failureModes: ["query not found"],
  },

  // ── File Cabinet ───────────────────────────
  netsuite_get_file_content: {
    purpose: "Read the text content of a file from the NetSuite File Cabinet",
    costTier: "cheap",
    expectedLatencyMs: 800,
    riskLevel: "low",
    reversible: true,
    failureModes: [
      "file ID incorrect — use sql_execute_query to look up the real file ID first",
      "file is binary and cannot be read as text",
      "permission denied",
    ],
    preferWhen: "you have a verified File Cabinet file ID",
    avoidWhen:
      "you only have an entity/record ID — that is NOT a file ID; query the relationship first",
  },
  netsuite_find_file: {
    purpose: "Search for files in the File Cabinet by name or extension",
    costTier: "cheap",
    expectedLatencyMs: 1000,
    riskLevel: "none",
    reversible: true,
    failureModes: ["no files match the search pattern"],
    preferWhen: "user asks to find a file by name",
    avoidWhen:
      "the user asks for a file/report related to a record/entity ID — use SuiteQL relationship discovery first because record IDs are not file IDs",
  },
  netsuite_find_record_related_file: {
    purpose: "Resolve a record/entity ID to a linked File Cabinet report, file, document, or attachment",
    costTier: "moderate",
    expectedLatencyMs: 2500,
    riskLevel: "low",
    reversible: true,
    failureModes: [
      "no relationship table matches the record and file purpose",
      "relationship rows exist but do not contain a populated file field",
      "file ID is not accessible in the File Cabinet",
    ],
    preferWhen:
      "the user asks for a report/file/PDF/document/attachment associated with a lead/customer/entity/transaction ID",
    avoidWhen:
      "the user explicitly supplied a File Cabinet file ID or only wants a generic file-name search",
  },
  netsuite_list_folder: {
    purpose: "List files inside a specific File Cabinet folder",
    costTier: "cheap",
    expectedLatencyMs: 800,
    riskLevel: "none",
    reversible: true,
    failureModes: ["folder ID incorrect", "empty folder"],
  },
  netsuite_find_folder: {
    purpose: "Find a folder by name in the File Cabinet",
    costTier: "cheap",
    expectedLatencyMs: 800,
    riskLevel: "none",
    reversible: true,
    failureModes: ["folder not found"],
  },
  netsuite_upload_file: {
    purpose: "Upload a new file to the File Cabinet",
    costTier: "expensive",
    expectedLatencyMs: 3000,
    riskLevel: "medium",
    reversible: false,
    failureModes: ["folder ID incorrect", "file already exists", "governance limit"],
    avoidWhen: "user has not explicitly requested a file upload",
  },
  netsuite_create_folder: {
    purpose: "Create a new folder in the File Cabinet",
    costTier: "moderate",
    expectedLatencyMs: 1500,
    riskLevel: "low",
    reversible: false,
    failureModes: ["parent folder not found"],
  },

  // ── Scripts & deployment ───────────────────
  netsuite_get_scripts: {
    purpose: "Search for SuiteScript records by name or type",
    costTier: "cheap",
    expectedLatencyMs: 1000,
    riskLevel: "none",
    reversible: true,
    failureModes: ["no scripts match the filter"],
    preferWhen: "user asks about existing scripts or needs a script ID",
  },
  netsuite_get_script_files: {
    purpose: "Get the file IDs for a script's source files",
    costTier: "cheap",
    expectedLatencyMs: 800,
    riskLevel: "none",
    reversible: true,
    failureModes: ["script ID not found"],
  },
  netsuite_run_script: {
    purpose: "Trigger execution of a SuiteScript via its deployment",
    costTier: "expensive",
    expectedLatencyMs: 5000,
    riskLevel: "high",
    reversible: false,
    failureModes: [
      "deployment not found",
      "script fails at runtime",
      "governance limit exceeded",
    ],
    avoidWhen: "user has not explicitly requested script execution",
  },
  netsuite_get_logs: {
    purpose: "Retrieve script execution logs for debugging",
    costTier: "cheap",
    expectedLatencyMs: 1200,
    riskLevel: "none",
    reversible: true,
    failureModes: [
      "no logs found — script may not have run or log level too high",
      "time range too broad",
    ],
    avoidWhen: "logs were already fetched and returned 0 results — read the source code instead",
  },
  netsuite_create_script: {
    purpose: "Create a new SuiteScript record and deploy it",
    costTier: "expensive",
    expectedLatencyMs: 4000,
    riskLevel: "medium",
    reversible: false,
    failureModes: ["file not yet uploaded", "script type mismatch"],
    avoidWhen: "user has not explicitly asked to deploy a new script",
  },
  netsuite_get_deployed_scripts: {
    purpose: "Get deployed script source files for a NetSuite record type",
    costTier: "cheap",
    expectedLatencyMs: 1600,
    riskLevel: "none",
    reversible: true,
    failureModes: ["record type has no deployed scripts", "script file content could not be fetched"],
    preferWhen: "user asks what scripts run on a record type or wants code analysis for a record page",
  },
  netsuite_get_script_deployments: {
    purpose: "Get deployment records including status and parameters",
    costTier: "cheap",
    expectedLatencyMs: 800,
    riskLevel: "none",
    reversible: true,
    failureModes: [],
  },

  // ── Records ────────────────────────────────
  netsuite_load_record: {
    purpose: "Load a specific NetSuite record by type and ID",
    costTier: "moderate",
    expectedLatencyMs: 1500,
    riskLevel: "low",
    reversible: true,
    failureModes: [
      "record not found",
      "wrong record type",
      "permission denied",
    ],
    preferWhen: "user needs to read fields from a known record ID",
  },
  netsuite_get_record_fields: {
    purpose: "Discover field IDs and values for a loaded record",
    costTier: "cheap",
    expectedLatencyMs: 600,
    riskLevel: "none",
    reversible: true,
    failureModes: ["record not loaded yet"],
  },
  netsuite_export_record: {
    purpose: "Export a NetSuite record as structured JSON",
    costTier: "moderate",
    expectedLatencyMs: 2000,
    riskLevel: "none",
    reversible: true,
    failureModes: ["record not found", "permission denied"],
  },

  // ── Docs ───────────────────────────────────
  search_netsuite_docs: {
    purpose: "Search the NetSuite Help Center documentation index for articles about behavior, limits, best practices, and how-to guides",
    costTier: "cheap",
    expectedLatencyMs: 500,
    riskLevel: "none",
    reversible: true,
    failureModes: ["no results found"],
    preferWhen:
      "user asks about NetSuite behavior, script type limits, governance quotas, " +
      "execution boundaries, best practices, how-to guides, or any conceptual topic " +
      "(e.g. 'what are the map reduce limits?', 'how does a user event work?', " +
      "'what is the governance unit budget for scheduled scripts?')",
    avoidWhen:
      "question needs a specific N/module API signature — use netsuite_search_module_docs for that",
  },
  read_netsuite_doc_page: {
    purpose: "Read the full content of a NetSuite Help Center documentation page",
    costTier: "cheap",
    expectedLatencyMs: 600,
    riskLevel: "none",
    reversible: true,
    failureModes: ["page not found"],
    preferWhen: "you need the full text of a specific help article found by search_netsuite_docs",
  },
  netsuite_search_module_docs: {
    purpose:
      "Search the local SuiteScript N/* module documentation database for method signatures, " +
      "parameter types, return values, and enum members. " +
      "This is an API REFERENCE tool — it returns function/property/enum definitions only. " +
      "It does NOT contain help-center articles about limits, governance, best practices, or how-to topics.",
    costTier: "free",
    expectedLatencyMs: 50,
    riskLevel: "none",
    reversible: true,
    failureModes: ["no modules match"],
    preferWhen:
      "user references a specific N/module (e.g. N/record, N/task) and needs to know " +
      "method names, parameter names, or return types",
    avoidWhen:
      "question is about limits, governance, quotas, best practices, or conceptual how-to topics — " +
      "use search_netsuite_docs for those",
  },
  netsuite_get_module_member_details: {
    purpose: "Get detailed API docs for a specific N/module member (method, property, or enum value)",
    costTier: "free",
    expectedLatencyMs: 50,
    riskLevel: "none",
    reversible: true,
    failureModes: ["member not found"],
    preferWhen: "you already know the module and member name and need exact parameter/return type details",
    avoidWhen: "question is about limits, governance, or help-center topics",
  },

  // ── Bundles ────────────────────────────────
  list_bundles: {
    purpose: "List installed SuiteApp bundles",
    costTier: "cheap",
    expectedLatencyMs: 1000,
    riskLevel: "none",
    reversible: true,
    failureModes: [],
    preferWhen: "user asks about installed SuiteApps or bundles",
  },
  get_bundle_components: {
    purpose: "Inspect the components of a specific bundle",
    costTier: "cheap",
    expectedLatencyMs: 1000,
    riskLevel: "none",
    reversible: true,
    failureModes: ["bundle ID not found"],
  },
  netsuite_list_bundles: {
    purpose: "List SuiteApp bundles through the MCP bridge",
    costTier: "cheap",
    expectedLatencyMs: 1000,
    riskLevel: "none",
    reversible: true,
    failureModes: [],
    preferWhen: "MCP client asks about installed SuiteApps or bundles",
  },
  netsuite_get_bundle_components: {
    purpose: "Inspect bundle components through the MCP bridge",
    costTier: "cheap",
    expectedLatencyMs: 1000,
    riskLevel: "none",
    reversible: true,
    failureModes: ["bundle ID not found"],
  },
};

/** Get metadata for a tool, returning sensible defaults if not registered */
export const getToolMetadata = (toolName: string): ToolMetadata =>
  TOOL_METADATA[toolName] ?? {
    purpose: `Execute the ${toolName} operation`,
    costTier: "moderate",
    expectedLatencyMs: 2000,
    riskLevel: "low",
    reversible: true,
    failureModes: ["unknown failure"],
  };

// ─────────────────────────────────────────────
// Cost tier weights (lower = prefer)
// ─────────────────────────────────────────────

const COST_WEIGHTS: Record<CostTier, number> = {
  free: 0,
  cheap: 1,
  moderate: 2,
  expensive: 3,
};

const RISK_WEIGHTS: Record<RiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Score a tool for cost-aware ranking.
 * Lower score → prefer (cheaper / safer / faster).
 */
export const toolRoutingScore = (toolName: string): number => {
  const meta = getToolMetadata(toolName);
  const costW = COST_WEIGHTS[meta.costTier];
  const riskW = RISK_WEIGHTS[meta.riskLevel];
  const latencyW = Math.log10(Math.max(meta.expectedLatencyMs, 1));
  const reversibilityBonus = meta.reversible ? 0 : 2;
  return costW + riskW + latencyW + reversibilityBonus;
};

/**
 * Sort a list of OpenAI-format tool objects by cost-adjusted priority.
 * Cheaper, safer, faster tools appear first — this biases LLM selection
 * toward the lowest-cost reliable option without excluding any tool.
 */
export const rankToolsByCost = <T extends { type: string; function: { name: string } }>(
  tools: T[]
): T[] =>
  [...tools].sort(
    (a, b) =>
      toolRoutingScore(a.function.name) - toolRoutingScore(b.function.name)
  );

// ─────────────────────────────────────────────
// Decision policy rules
// ─────────────────────────────────────────────

/**
 * Named routing axioms referenced in the harness prompt.
 * These are injected into the system prompt so the model reasons under
 * explicit policy constraints rather than free-form selection.
 */
export const ROUTING_RULES: RoutingRule[] = [
  {
    id: "R1",
    description: "Use tools only when external information is required",
    rationale:
      "Pure linguistic, creative, summarization, or rewrite tasks need no tool. Do not call a tool when the information is already in context.",
  },
  {
    id: "R2",
    description: "Prefer the lowest-cost reliable tool",
    rationale:
      "Free/cheap tools (calculate, sql_search_tables, netsuite_search_module_docs) cost nothing. Use them before escalating to expensive ones (netsuite_run_script, netsuite_upload_file).",
  },
  {
    id: "R3",
    description: "Use database lookup before guessing field/table names",
    rationale:
      "Call sql_search_tables or sql_get_table_fields before writing a SuiteQL query. Never invent table or field names.",
  },
  {
    id: "R4",
    description: "Use calculator for arithmetic; never compute in prose",
    rationale:
      "Any numeric expression that could be mis-computed by prose generation must go through the calculate tool.",
  },
  {
    id: "R5",
    description: "Never use File Cabinet ID tools with a record/entity ID",
    rationale:
      "File Cabinet IDs differ from record IDs. Run a SuiteQL relationship query first when the user mentions 'file/report for customer or lead 1234' — 1234 is the record ID, not a file ID.",
  },
  {
    id: "R6",
    description: "Ask for clarification only when missing inputs block execution",
    rationale:
      "Do not ask the user for information you can discover with a tool. Only surface a question when a required parameter truly cannot be inferred or looked up.",
  },
  {
    id: "R7",
    description: "Never perform irreversible actions without explicit user authorization",
    rationale:
      "Tools marked high-risk or non-reversible (uploads, script creation, script execution) require the user to have explicitly requested the action in this message.",
  },
  {
    id: "R8",
    description: "Stop calling a tool when it returned no useful result twice",
    rationale:
      "If two identical or near-identical calls to the same tool returned empty or error results, switch strategy: discover different inputs, use a different tool, or ask the user.",
  },
  {
    id: "R9",
    description: "Use search tools for fresh facts, not for information already in context",
    rationale:
      "If the answer is already present in the conversation history or in a tool result you already have, do NOT call another tool — synthesize from what you have.",
  },
  {
    id: "R10",
    description: "Validate all required arguments before calling",
    rationale:
      "Check that every required parameter is available before issuing a tool call. An empty or placeholder argument will cause a validation error and waste a tool slot.",
  },
  {
    id: "R11",
    description: "Use search_netsuite_docs for limits/governance/how-to; use netsuite_search_module_docs only for N/module API signatures",
    rationale:
      "search_netsuite_docs searches the Help Center (articles about execution limits, governance " +
      "units, best practices, script type comparisons). netsuite_search_module_docs searches a local " +
      "API reference database (method names, parameter types, return values). Never use the module " +
      "docs tool for conceptual or limits questions — it has no such data and will loop uselessly.",
  },
];

// ─────────────────────────────────────────────
// Few-shot examples
// ─────────────────────────────────────────────

const FEW_SHOT_EXAMPLES = `
ROUTING EXAMPLES (study these before each decision):

✓ GOOD — user asks "what is the current price of AAPL?"
  → external real-time fact needed → use fetch_url (finance page) or search tool

✓ GOOD — user asks "rewrite this email more formally"
  → purely linguistic → NO tool needed → answer directly

✓ GOOD — user asks "summarize the uploaded file"
  → content already in context (attachment) → NO tool needed → summarize from context

✓ GOOD — user asks "what is 847 * 23?"
  → arithmetic → use calculate, do not compute in prose

✓ GOOD — user asks "show me scripts named 'invoice'"
  → NetSuite data → use netsuite_get_scripts

✓ GOOD — user asks "run the deploy script"
  → destructive (script execution) → first confirm with user before calling netsuite_run_script

✓ GOOD — user asks "find files for customer 4521"
  → relationship lookup needed → run sql_execute_query to find file IDs linked to customer 4521
  → then call netsuite_get_file_content with the FILE ID returned by the query

✓ GOOD — user asks "find the report file with lead id 181"
  → 181 is the lead/customer record ID, not a File Cabinet ID
  → call netsuite_find_record_related_file({ recordType: "lead", recordId: "181", purpose: "report" }) when available
  → otherwise use sql_search_tables/sql_get_table_fields/sql_get_table_joins to find the lead/report relationship
  → query the related table by lead ID, then read/search only the returned file ID

✗ BAD — user asks "find files for customer 4521"
  → calling netsuite_get_file_content(fileId: 4521)
  → WRONG: 4521 is the customer ID, not a file ID

✗ BAD — user asks "find the report file with lead id 181"
  → calling netsuite_find_file(fileId: 181) or netsuite_find_file(name: "report") first
  → WRONG: this searches File Cabinet identity/name, not the lead-to-report relationship

✗ BAD — user asks "what is the N/record module?"
  → calling sql_execute_query to look up record types
  → WRONG: this is a documentation question → use netsuite_search_module_docs

✗ BAD — user asks "what are the map reduce limits?"
  → calling netsuite_search_module_docs repeatedly
  → WRONG: module docs only has API signatures, not execution limits
  → CORRECT: use search_netsuite_docs to find the Help Center article on map reduce limits

✗ BAD — user says "hello, how are you?"
  → calling get_current_time or any NetSuite tool
  → WRONG: greeting needs no tool
`.trim();

// ─────────────────────────────────────────────
// Tool router harness prompt
// ─────────────────────────────────────────────

/**
 * Build the tool router harness section to inject into the system prompt.
 *
 * This implements the "separate should-I-use-a-tool from what-should-I-answer"
 * pattern. The model must reason about tool choice under tight policy rules
 * BEFORE calling any tool, and must evaluate results after each call.
 *
 * All internal reasoning (planning, evaluation) is wrapped in <think> tags so
 * it is suppressed by the stream filter and never appears in the visible output.
 */
export const buildToolRouterHarness = (): string => {
  const rulesText = ROUTING_RULES.map(
    (r) => `  [${r.id}] ${r.description}\n        Rationale: ${r.rationale}`
  ).join("\n");

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL ROUTING POLICY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are a tool router. Choose the MINIMUM set of tools needed to answer correctly.

DECISION RULES (apply in order):
${rulesText}

PLANNING STEP (required before every tool call):
Before selecting a tool, write your plan inside <think> tags so it stays hidden:
  <think>
  GOAL: what does the user need?
  NEEDED INFO: what is missing that I cannot infer from context?
  CANDIDATE TOOLS: 1-3 tools that could supply it
  CHOSEN TOOL: the cheapest and most reliable option
  WHY: one sentence citing the rule above
  </think>
Do NOT output the plan as visible text — keep it inside <think>…</think> only.

POST-RESULT EVALUATION (required after every tool result):
After receiving a tool result, write your evaluation inside <think> tags:
  <think>
  SATISFIED: did this FULLY answer the user's need? (yes → answer now, stop calling tools)
  FOLLOW-UP: is another tool call strictly necessary?
  CONFLICTS: does this contradict anything already known?
  </think>
Only proceed to another tool call if SATISFIED is "no" AND FOLLOW-UP is "yes".
Never expose this reasoning in your visible answer — keep it inside <think>…</think>.

${FEW_SHOT_EXAMPLES}

COST PRIORITY (when multiple tools could work, prefer in this order):
  free → cheap → moderate → expensive
  Safe/reversible → risky/irreversible (requires explicit user authorization)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`.trim();
};

// ─────────────────────────────────────────────
// Post-result evaluation prompt
// ─────────────────────────────────────────────

/**
 * Build a lightweight evaluation nudge to inject after a batch of tool results.
 *
 * Wrapped in <think> tags so the existing stream filter (emitVisible) suppresses
 * it from the live display — the model reasons silently, never streaming this
 * evaluation text to the user.
 */
export const buildPostResultEvaluation = (toolNames: string[]): string => {
  const toolList = toolNames.join(", ");
  return (
    `<think>\n` +
    `[TOOL RESULT EVALUATION — ${toolList}]\n` +
    `Before your next action, answer these internally (stay inside this think block):\n` +
    `  1. Did these results FULLY answer the user's request? (yes → answer now, no more tools)\n` +
    `  2. Is one more tool call NECESSARY — not optional, but required? (if yes → call it)\n` +
    `  3. Are there ANY conflicts or unexpected results in the data? (if yes → flag them)\n` +
    `Rule: if (1) is yes, stop calling tools and write your final answer outside these tags.\n` +
    `</think>`
  );
};

// ─────────────────────────────────────────────
// Telemetry store
// ─────────────────────────────────────────────

/**
 * In-memory telemetry log.
 * Capped at 500 entries to prevent unbounded growth.
 * Consumer code (harness/debug panels) can read and export this.
 */
const MAX_TELEMETRY_ENTRIES = 500;

class TelemetryStore {
  private entries: ToolTelemetryEntry[] = [];

  record(entry: ToolTelemetryEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_TELEMETRY_ENTRIES) {
      this.entries.shift();
    }
  }

  /** Mark the last entry for a given tool with evaluation results */
  updateEvaluation(
    toolName: string,
    satisfied: boolean,
    followUpRequired: boolean
  ): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]!;
      if (entry.toolName === toolName && entry.satisfied === null) {
        entry.satisfied = satisfied;
        entry.followUpRequired = followUpRequired;
        break;
      }
    }
  }

  /** Get all entries, most recent first */
  getAll(): readonly ToolTelemetryEntry[] {
    return [...this.entries].reverse();
  }

  /** Get entries for a specific tool */
  getForTool(toolName: string): readonly ToolTelemetryEntry[] {
    return this.entries.filter((e) => e.toolName === toolName).reverse();
  }

  /**
   * Summarize routing quality for a session.
   * Returns counts of: total calls, blocked, validation failures,
   * satisfied results, and the most-used tools.
   */
  summarize(): {
    totalCalls: number;
    blocked: number;
    validationFailures: number;
    satisfied: number;
    unsatisfied: number;
    unevaluated: number;
    topTools: Array<{ name: string; count: number }>;
    averageLatencyMs: number;
  } {
    const total = this.entries.length;
    const toolCounts = new Map<string, number>();
    let blocked = 0;
    let validationFailures = 0;
    let satisfied = 0;
    let unsatisfied = 0;
    let unevaluated = 0;
    let totalLatency = 0;

    for (const entry of this.entries) {
      toolCounts.set(entry.toolName, (toolCounts.get(entry.toolName) ?? 0) + 1);
      if (entry.wasBlocked) blocked++;
      if (entry.validationFailed) validationFailures++;
      if (entry.satisfied === true) satisfied++;
      else if (entry.satisfied === false) unsatisfied++;
      else unevaluated++;
      totalLatency += entry.latencyMs;
    }

    const topTools = [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    return {
      totalCalls: total,
      blocked,
      validationFailures,
      satisfied,
      unsatisfied,
      unevaluated,
      topTools,
      averageLatencyMs: total > 0 ? Math.round(totalLatency / total) : 0,
    };
  }

  clear(): void {
    this.entries = [];
  }
}

/** Singleton telemetry store — shared across agent runs in the same browser session */
export const toolTelemetry = new TelemetryStore();
