import { computed, readonly, ref } from "vue";
import { useAiProvider, type ChatMessage, type ToolCall } from "./useAiProvider";
import type { ToolDefinition } from "./useAgent";
import { tools as baseTools } from "../utils/toolManager";
import { createSqlAiTools } from "../utils/sqlAiTools";
import {
  netsuiteDocsTools,
  NETSUITE_DOCS_SYSTEM_PROMPT,
} from "../utils/netsuiteDocsTools";
import { bundleTools, BUNDLE_TOOLS_SYSTEM_PROMPT } from "../utils/bundleTools";
import { skillTools } from "../utils/skillSearchTools";
import {
  beginHarnessWorkerTab,
  callApi,
  endHarnessWorkerTab,
  getNetsuiteEnvironment,
} from "../utils/api";
import { RequestRoutes } from "../types/request";
import { agentCache } from "../utils/agentCacheStore";
import { extractPdfText } from "../utils/pdfUtils";
import {
  bulkPutHarnessAgents,
  bulkPutHarnessItems,
  clearHarnessItems,
  deleteHarnessAgent,
  deleteHarnessThread,
  getHarnessAgents,
  getHarnessItems,
  getHarnessThreads,
  getHarnessUiState,
  putHarnessItem,
  replaceHarnessItems,
  setHarnessUiState,
  upsertHarnessAgent,
  upsertHarnessThread,
  type HarnessAgentRecord,
  type HarnessAttachment,
  type HarnessItemRecord,
  type HarnessItemStatus,
  type HarnessPermissionMode,
  type HarnessThreadRecord,
} from "../utils/agentHarnessDb";

type HarnessRisk = "none" | "low" | "medium" | "high";
export type HarnessToolsetId =
  | "context"
  | "suiteql"
  | "records"
  | "scripts"
  | "filecabinet"
  | "docs"
  | "bundles"
  | "output";

export type { HarnessAttachment } from "../utils/agentHarnessDb";

export interface HarnessTool extends ToolDefinition {
  toolsetIds: HarnessToolsetId[];
  readOnly: boolean;
  risk: HarnessRisk;
}

export interface HarnessProfile {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  color: string;
  description: string;
  defaultPermissionMode: HarnessPermissionMode;
  toolsets: readonly HarnessToolsetId[];
  maxSteps: number;
  systemFocus: string;
  builtIn?: boolean;
  enabled?: boolean;
  enabledToolNames?: readonly string[];
  createdAt?: string;
  updatedAt?: string;
}

export type HarnessAgent = HarnessProfile;

export interface HarnessAgentDraft {
  id?: string;
  name: string;
  shortName: string;
  icon: string;
  color: string;
  description: string;
  defaultPermissionMode: HarnessPermissionMode;
  toolsets: HarnessToolsetId[];
  enabledToolNames?: string[];
  maxSteps: number;
  systemFocus: string;
  enabled?: boolean;
  builtIn?: boolean;
}

export interface HarnessToolsetDefinition {
  id: HarnessToolsetId;
  name: string;
  icon: string;
  description: string;
}

export interface HarnessApprovalRequest {
  toolName: string;
  toolInput: unknown;
  profileName: string;
  profileColor: string;
  reason: string;
}

export interface HarnessTelemetryEntry {
  id: string;
  turnId: string;
  toolName: string;
  status: HarnessItemStatus;
  latencyMs: number;
  risk: HarnessRisk;
  resultSummary: string;
  createdAt: string;
}

export interface HarnessRunOptions {
  attachments?: HarnessAttachment[];
}

export const HARNESS_TOOLSETS: HarnessToolsetDefinition[] = [
  {
    id: "context",
    name: "Context",
    icon: "pi pi-compass",
    description: "Account, session, cache, time, math, and basic harness context.",
  },
  {
    id: "suiteql",
    name: "SuiteQL",
    icon: "pi pi-database",
    description: "Live schema discovery, joins, field values, and query execution.",
  },
  {
    id: "records",
    name: "Records",
    icon: "pi pi-table",
    description: "Record loading, custom records, sublists, and exports.",
  },
  {
    id: "scripts",
    name: "Scripts",
    icon: "pi pi-code",
    description: "SuiteScript records, deployments, logs, source files, and modules.",
  },
  {
    id: "filecabinet",
    name: "File Cabinet",
    icon: "pi pi-folder",
    description: "File and folder search, reads, upload workflows, and cache writes.",
  },
  {
    id: "docs",
    name: "Docs",
    icon: "pi pi-book",
    description: "Official NetSuite help pages and SuiteScript module reference.",
  },
  {
    id: "bundles",
    name: "Bundles",
    icon: "pi pi-box",
    description: "SuiteApp bundle inventory and component inspection.",
  },
  {
    id: "output",
    name: "Artifacts",
    icon: "pi pi-file",
    description: "Generated reports, PDFs, cached content, and upload-ready files.",
  },
];

const DEFAULT_AGENT_TIMESTAMP = "2026-05-22T00:00:00.000Z";

const DEFAULT_HARNESS_AGENT_SEEDS = [
  {
    id: "navigator",
    name: "Explore",
    shortName: "Explore",
    icon: "pi pi-compass",
    color: "#7c3aed",
    description: "Find and summarize live NetSuite data without changing anything.",
    defaultPermissionMode: "read",
    toolsets: ["context", "suiteql", "records", "scripts", "filecabinet", "docs", "bundles"],
    maxSteps: 8,
    systemFocus:
      "Explore the account safely. Resolve record-to-file/report relationships through SuiteQL before using File Cabinet IDs, cite IDs and tool evidence, and avoid write actions.",
    builtIn: true,
    enabled: true,
  },
  {
    id: "suitescript-builder",
    name: "Build",
    shortName: "Build",
    icon: "pi pi-wrench",
    color: "#6366f1",
    description: "Inspect, write, and stage SuiteScript work with approval gates.",
    defaultPermissionMode: "build",
    toolsets: ["context", "suiteql", "records", "scripts", "filecabinet", "docs", "output"],
    maxSteps: 10,
    systemFocus:
      "Build SuiteScript changes with module documentation, existing script context, cache-backed artifacts, and explicit approval for every NetSuite write.",
    builtIn: true,
    enabled: true,
  },
  {
    id: "release-auditor",
    name: "Review",
    shortName: "Review",
    icon: "pi pi-shield",
    color: "#0f766e",
    description: "Check bundles, deployments, and script impact before shipping.",
    defaultPermissionMode: "read",
    toolsets: ["context", "suiteql", "records", "scripts", "docs", "bundles"],
    maxSteps: 9,
    systemFocus:
      "Act as a release and impact auditor. Prefer read-only inspection, compare bundle/script/deployment facts, and produce concise risk notes.",
    builtIn: true,
    enabled: true,
  },
  {
    id: "file-operator",
    name: "Files",
    shortName: "Files",
    icon: "pi pi-folder-open",
    color: "#8b5cf6",
    description: "Search, read, compare, and stage File Cabinet assets.",
    defaultPermissionMode: "build",
    toolsets: ["context", "suiteql", "scripts", "filecabinet", "docs", "output"],
    maxSteps: 9,
    systemFocus:
      "Work through File Cabinet assets deliberately. Resolve folder and file IDs before reads or uploads, and keep generated content in cache before writing.",
    builtIn: true,
    enabled: true,
  },
] satisfies Array<Omit<HarnessAgent, "createdAt" | "updatedAt">>;

export const DEFAULT_HARNESS_AGENTS: HarnessAgent[] = DEFAULT_HARNESS_AGENT_SEEDS.map((agent) => ({
  ...agent,
  createdAt: DEFAULT_AGENT_TIMESTAMP,
  updatedAt: DEFAULT_AGENT_TIMESTAMP,
}));

export const HARNESS_PROFILES = DEFAULT_HARNESS_AGENTS;

const UI_ACTIVE_THREAD_KEY = "agent-harness-active-thread";
const UI_ACTIVE_PROFILE_KEY = "agent-harness-active-profile";
const UI_PERMISSION_MODE_KEY = "agent-harness-permission-mode";

const uid = (prefix: string): string => {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  const random =
    cryptoObj && "randomUUID" in cryptoObj
      ? cryptoObj.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${random}`;
};

const nowIso = (): string => new Date().toISOString();

const clampStepLimit = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(1, Math.min(60, Math.floor(numeric)))
    : fallback;
};

const HARNESS_TOOLSET_IDS = new Set(HARNESS_TOOLSETS.map((toolset) => toolset.id));

const normalizeAgent = (agent: HarnessAgentRecord | HarnessAgent): HarnessAgent => {
  const fallback = DEFAULT_HARNESS_AGENTS.find((candidate) => candidate.id === agent.id);
  const rawToolsets = (agent.toolsets ?? fallback?.toolsets ?? ["context"]) as string[];
  const toolsets: HarnessToolsetId[] = rawToolsets
    .filter((id): id is HarnessToolsetId => HARNESS_TOOLSET_IDS.has(id as HarnessToolsetId));

  return {
    id: agent.id,
    name: agent.name || fallback?.name || "Agent",
    shortName: agent.shortName || agent.name || fallback?.shortName || "Agent",
    icon: agent.icon || fallback?.icon || "pi pi-sparkles",
    color: agent.color || fallback?.color || "#7c3aed",
    description: agent.description || fallback?.description || "Custom NetSuite agent.",
    defaultPermissionMode: agent.defaultPermissionMode || fallback?.defaultPermissionMode || "read",
    toolsets: toolsets.length > 0 ? toolsets : (["context"] as HarnessToolsetId[]),
    enabledToolNames: Array.isArray(agent.enabledToolNames)
      ? [...new Set(agent.enabledToolNames)]
      : undefined,
    maxSteps: Math.max(1, Math.min(20, Number(agent.maxSteps || fallback?.maxSteps || 8))),
    systemFocus:
      agent.systemFocus ||
      fallback?.systemFocus ||
      "Work as a focused NetSuite agent. Use live evidence, keep responses concise, and respect permissions.",
    builtIn: Boolean(agent.builtIn ?? fallback?.builtIn),
    enabled: agent.enabled !== false,
    createdAt: agent.createdAt || nowIso(),
    updatedAt: agent.updatedAt || nowIso(),
  };
};

const agentToRecord = (agent: HarnessAgent): HarnessAgentRecord => ({
  ...agent,
  toolsets: Array.from(agent.toolsets),
  enabledToolNames: agent.enabledToolNames ? Array.from(agent.enabledToolNames) : undefined,
  createdAt: agent.createdAt || nowIso(),
  updatedAt: agent.updatedAt || nowIso(),
});

const compact = (text: string, max = 1000): string => {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`;
};

const stringifyResult = (value: unknown, max = 6000): string => {
  if (typeof value === "string") return compact(value, max);
  try {
    return compact(JSON.stringify(value, null, 2), max);
  } catch {
    return compact(String(value), max);
  }
};

const MAX_ATTACHMENT_CHARS = 300_000;

const isSendableAttachment = (attachment: HarnessAttachment): boolean =>
  Boolean(attachment.deferred) || attachment.content.trim().length > 0;

const yieldToMain = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const getFileContentTool = baseTools.find((tool) => tool.name === "netsuite_get_file_content");

const dataUrlToFile = (dataUrl: string, name: string): File => {
  const [header = "", body = ""] = dataUrl.split(",", 2);
  const contentType = /^data:([^;]+);/i.exec(header)?.[1] || "application/octet-stream";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: contentType });
};

const appendRecordFieldLines = async (
  lines: string[],
  fields: Record<string, { value?: unknown; text?: unknown }>,
  lineBudget: { count: number }
): Promise<void> => {
  const entries = Object.entries(fields);
  for (let i = 0; i < entries.length; i++) {
    const [fieldId, field] = entries[i]!;
    const display = field?.text ?? field?.value;
    if (display !== null && display !== undefined && String(display) !== "") {
      lines.push(`${fieldId}: ${display}`);
      lineBudget.count += 1;
    }
    if (i > 0 && i % 40 === 0) await yieldToMain();
  }
};

const serializeRecordPayload = async (payload: unknown): Promise<string> => {
  if (!payload || typeof payload !== "object") {
    return String(payload ?? "");
  }
  const record = payload as {
    body?: Record<string, { value?: unknown; text?: unknown }>;
    sublists?: Record<string, Array<Record<string, { value?: unknown; text?: unknown }>>>;
  };

  if (!record.body && !record.sublists) {
    return stringifyResult(payload, MAX_ATTACHMENT_CHARS);
  }

  const lines: string[] = [];
  const lineBudget = { count: 0 };

  if (record.body && typeof record.body === "object") {
    await appendRecordFieldLines(lines, record.body, lineBudget);
  }

  if (record.sublists && typeof record.sublists === "object") {
    for (const [sublistId, rows] of Object.entries(record.sublists)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      lines.push("", `## Sublist: ${sublistId}`);
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        if (!row || typeof row !== "object") continue;
        lines.push(`### Line ${rowIndex + 1}`);
        await appendRecordFieldLines(lines, row, lineBudget);
        if (lineBudget.count > 0 && lineBudget.count % 80 === 0) await yieldToMain();
      }
    }
  }

  let text = lines.join("\n").trim();
  if (!text) return stringifyResult(payload, MAX_ATTACHMENT_CHARS);
  if (text.length > MAX_ATTACHMENT_CHARS) {
    text = `${text.slice(0, MAX_ATTACHMENT_CHARS)}\n\n... [truncated ${text.length - MAX_ATTACHMENT_CHARS} characters]`;
  }
  return text;
};

const resolveDeferredRecordAttachment = async (
  attachment: HarnessAttachment,
  payload: unknown
): Promise<HarnessAttachment> => {
  const serialized = await serializeRecordPayload(payload);
  const content = [
    "NetSuite record context",
    `recordType: ${attachment.sourceType}`,
    `internalId: ${attachment.sourceId}`,
    "",
    serialized,
  ].join("\n");
  return {
    ...attachment,
    deferred: false,
    type: "text",
    content,
    size: content.length,
  };
};

const resolveDeferredFileAttachment = async (
  attachment: HarnessAttachment,
  fileMeta: { cacheKey?: string; error?: string }
): Promise<HarnessAttachment> => {
  if (fileMeta.error) {
    const content = `Failed to load file: ${fileMeta.error}`;
    return {
      ...attachment,
      deferred: false,
      type: "text",
      content,
      size: content.length,
    };
  }

  const cacheKey = fileMeta.cacheKey ?? `file_${attachment.sourceId}`;
  const entry = agentCache.get(cacheKey);
  let body = entry?.content ?? "";
  let attachmentType: HarnessAttachment["type"] = "text";

  if (body.startsWith("data:") && /application\/pdf/i.test(body)) {
    attachmentType = "pdf";
    await yieldToMain();
    try {
      const pdfFile = dataUrlToFile(body, attachment.name);
      const extracted = await extractPdfText(pdfFile);
      await yieldToMain();
      body = extracted.pages
        .map((page) => `<page ${page.pageNumber}>\n${page.text}\n</page ${page.pageNumber}>`)
        .join("\n\n");
    } catch {
      body = "[PDF content could not be extracted as text]";
    }
  }

  if (body.length > MAX_ATTACHMENT_CHARS) {
    body = `${body.slice(0, MAX_ATTACHMENT_CHARS)}\n\n... [truncated ${body.length - MAX_ATTACHMENT_CHARS} characters]`;
  }

  const content = [
    "NetSuite File Cabinet context",
    `fileId: ${attachment.sourceId}`,
    `name: ${attachment.name}`,
    attachment.sourceType ? `fileType: ${attachment.sourceType}` : "",
    cacheKey ? `cacheKey: ${cacheKey}` : "",
    "",
    body,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    ...attachment,
    deferred: false,
    type: attachmentType,
    content,
    size: content.length,
  };
};

const prefetchAttachment = async (
  attachment: HarnessAttachment
): Promise<HarnessAttachment> => {
  if (attachment.source === "record" && attachment.sourceType && attachment.sourceId) {
    await yieldToMain();
    const response = await callApi(RequestRoutes.LOAD_RECORD_JSON, {
      type: attachment.sourceType,
      id: attachment.sourceId,
      includeSublists: true,
    });
    if (response.status === "error") {
      throw new Error(
        typeof response.message === "string"
          ? response.message
          : JSON.stringify(response.message)
      );
    }
    await yieldToMain();
    return resolveDeferredRecordAttachment(attachment, response.message);
  }

  if (attachment.source === "filecabinet" && attachment.sourceId) {
    if (!getFileContentTool?.execute) {
      throw new Error("netsuite_get_file_content is not available.");
    }
    await yieldToMain();
    const fileId = Number(attachment.sourceId);
    const meta = (await getFileContentTool.execute({ fileId })) as {
      cacheKey?: string;
      error?: string;
    };
    await yieldToMain();
    return resolveDeferredFileAttachment(attachment, meta);
  }

  return { ...attachment, deferred: false };
};

const resolveAttachmentsForTurn = async (
  attachments: HarnessAttachment[] | undefined
): Promise<{ attachments: HarnessAttachment[] }> => {
  const sendable = (attachments ?? []).filter(isSendableAttachment);
  if (sendable.length === 0) {
    return { attachments: [] };
  }

  const deferred = sendable.filter((attachment) => attachment.deferred);
  const immediate = sendable.filter((attachment) => !attachment.deferred);
  const resolvedDeferred: HarnessAttachment[] = [];

  for (const attachment of deferred) {
    try {
      resolvedDeferred.push(await prefetchAttachment(attachment));
    } catch (err) {
      const content = `Failed to load context: ${String(err)}`;
      resolvedDeferred.push({
        ...attachment,
        deferred: false,
        type: "text",
        content,
        size: content.length,
      });
    }
    await yieldToMain();
  }

  return { attachments: [...immediate, ...resolvedDeferred] };
};

const formatMessageContent = (
  content: string,
  attachments?: HarnessAttachment[]
): string => {
  const resolved = attachments?.filter(
    (attachment) => !attachment.deferred && attachment.content.trim()
  );
  if (!resolved || resolved.length === 0) return content;
  const attachmentContext = resolved
    .map((attachment) => {
      const sourceLabel =
        attachment.source === "record"
          ? "NetSuite record"
          : attachment.source === "filecabinet"
            ? "File Cabinet file"
            : attachment.type === "pdf"
              ? "PDF file"
              : "File";
      const sourceMeta = [
        attachment.sourceType ? `type=${attachment.sourceType}` : "",
        attachment.sourceId ? `id=${attachment.sourceId}` : "",
      ].filter(Boolean).join(", ");
      const label = `[${sourceLabel}: ${attachment.name}${sourceMeta ? ` (${sourceMeta})` : ""}]`;
      return `${label}\n${attachment.content}\n[/end of ${attachment.name}]`;
    })
    .join("\n\n");

  return `${content}\n\n---\n${attachmentContext}`;
};

const parseToolArgs = (call: ToolCall): Record<string, unknown> => {
  const raw = call.function.arguments;
  if (typeof raw !== "string") return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const RELATED_FILE_WORD_PATTERN = /\b(report|file|document|attachment|pdf)\b/i;
const EXPLICIT_FILE_ID_PATTERN =
  /\b(file|document|attachment|pdf)\s*(?:internal\s*)?id\s*#?\s*\d+\b/i;
const RECORD_ENTITY_PATTERNS: Array<{ entity: string; regex: RegExp }> = [
  { entity: "lead", regex: /\blead\s*(?:id\s*)?#?\s*(\d+)\b/i },
  { entity: "customer", regex: /\bcustomer\s*(?:id\s*)?#?\s*(\d+)\b/i },
  { entity: "prospect", regex: /\bprospect\s*(?:id\s*)?#?\s*(\d+)\b/i },
  { entity: "contact", regex: /\bcontact\s*(?:id\s*)?#?\s*(\d+)\b/i },
  { entity: "entity", regex: /\bentity\s*(?:id\s*)?#?\s*(\d+)\b/i },
  { entity: "vendor", regex: /\bvendor\s*(?:id\s*)?#?\s*(\d+)\b/i },
  { entity: "employee", regex: /\bemployee\s*(?:id\s*)?#?\s*(\d+)\b/i },
  { entity: "transaction", regex: /\btransaction\s*(?:id\s*)?#?\s*(\d+)\b/i },
  { entity: "invoice", regex: /\binvoice\s*(?:id\s*)?#?\s*(\d+)\b/i },
  { entity: "sales order", regex: /\bsales\s*order\s*(?:id\s*)?#?\s*(\d+)\b/i },
  { entity: "opportunity", regex: /\bopportunity\s*(?:id\s*)?#?\s*(\d+)\b/i },
];

const extractRecordEntityMention = (
  prompt: string
): { entity: string; id: number } | null => {
  for (const { entity, regex } of RECORD_ENTITY_PATTERNS) {
    const match = prompt.match(regex);
    if (!match) continue;
    const id = Number(match[1]);
    if (Number.isInteger(id)) return { entity, id };
  }
  return null;
};

const isRecordRelatedFilePrompt = (prompt: string): boolean =>
  RELATED_FILE_WORD_PATTERN.test(prompt) &&
  extractRecordEntityMention(prompt) !== null &&
  !EXPLICIT_FILE_ID_PATTERN.test(prompt);

const numericArg = (
  args: Record<string, unknown>,
  keys: string[]
): number | null => {
  for (const key of keys) {
    const value = args[key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
};

const isFileIdTool = (toolName: string): boolean =>
  toolName === "netsuite_find_file" ||
  toolName === "netsuite_get_file_content" ||
  toolName === "netsuite_read_file" ||
  toolName.endsWith("__netsuite_find_file") ||
  toolName.endsWith("__netsuite_get_file_content") ||
  toolName.endsWith("__netsuite_read_file");

const validateRecordRelatedFileToolCall = (
  toolName: string,
  args: Record<string, unknown>,
  prompt: string
): string | null => {
  if (!isFileIdTool(toolName)) return null;
  if (!isRecordRelatedFilePrompt(prompt)) return null;

  const mention = extractRecordEntityMention(prompt);
  const requestedId = numericArg(args, ["fileId", "id"]);
  if (!mention || requestedId !== mention.id) return null;

  return (
    `Blocked unsafe File Cabinet ID lookup: the user asked for a report/file related ` +
    `to ${mention.entity} ${mention.id}. That number is the ${mention.entity} record ID, ` +
    `not a verified file ID. Use SuiteQL relationship discovery first: search tables/joins, ` +
    `query the related record or attachment table, then read/search only the file ID returned by that lookup.`
  );
};

const parseJsonResult = (content: string): unknown => {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

const resultCount = (value: unknown): number | null => {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.count === "number") return obj.count;
  if (typeof obj.rowCount === "number") return obj.rowCount;
  if (typeof obj.totalCount === "number") return obj.totalCount;
  for (const key of ["files", "folders", "results", "recordTypes"]) {
    const nested = obj[key];
    if (Array.isArray(nested)) return nested.length;
    if (nested && typeof nested === "object") {
      const nestedObj = nested as Record<string, unknown>;
      if (typeof nestedObj.totalCount === "number") return nestedObj.totalCount;
      if (Array.isArray(nestedObj.results)) return nestedObj.results.length;
    }
  }
  return null;
};

const buildRecordRelatedFileNudges = (
  prompt: string,
  calls: ToolCall[],
  outputs: ChatMessage[]
): string[] => {
  if (!isRecordRelatedFilePrompt(prompt)) return [];
  const mention = extractRecordEntityMention(prompt);
  if (!mention) return [];

  const nudges = new Set<string>();

  calls.forEach((call, index) => {
    const toolName = call.function.name;
    const output = outputs[index];
    const parsed = parseJsonResult(output?.content ?? "");
    const count = resultCount(parsed);

    if (toolName === "netsuite_load_record" || toolName.endsWith("__netsuite_load_record")) {
      nudges.add(
        `Record load identified ${mention.entity} ${mention.id}, but it does not locate related files. ` +
        `Next use SuiteQL schema discovery, not File Cabinet browsing: inspect Customer/lead joins, ` +
        `look for report/file/AI enrichment tables, and query the relationship by ${mention.entity} ID.`
      );
    }

    if (toolName === "netsuite_get_record_fields" || toolName.endsWith("__netsuite_get_record_fields")) {
      nudges.add(
        `A ${mention.entity} field dump does not prove the linked report file. Use netsuite_find_record_related_file if available, ` +
        `or query the custom relationship table that contains both a ${mention.entity} reference and a report/file field.`
      );
    }

    if (toolName === "sql_search_tables" || toolName.endsWith("__sql_search_tables")) {
      const tables = parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).tables
        : null;
      const likely = Array.isArray(tables)
        ? tables.find((table) => {
            const row = table as Record<string, unknown>;
            const haystack = `${row.id ?? ""} ${row.label ?? ""}`.toLowerCase();
            return haystack.includes(mention.entity) && haystack.includes("report");
          }) as Record<string, unknown> | undefined
        : undefined;
      if (likely?.id) {
        nudges.add(
          `Likely relationship table found: ${String(likely.id)}. Next inspect its fields, then query the ${mention.entity} reference field and report/file field for ${mention.entity} ${mention.id}.`
        );
      }
    }

    if (toolName === "sql_get_table_fields" || toolName.endsWith("__sql_get_table_fields")) {
      const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      const table = String(obj.table ?? "");
      const fields = Array.isArray(obj.fields) ? obj.fields as Array<Record<string, unknown>> : [];
      const fieldText = fields
        .map((field) => `${field.id ?? ""} ${field.label ?? ""}`)
        .join(" ")
        .toLowerCase();
      const tableText = table.toLowerCase();
      const looksLikeRecordReportTable =
        (tableText.includes(mention.entity) || fieldText.includes(mention.entity)) &&
        (tableText.includes("report") || fieldText.includes("report")) &&
        /\b(file|pdf|document|attachment)\b|_file\b/i.test(fieldText);

      if (looksLikeRecordReportTable) {
        const linkField = fields.find((field) => {
          const haystack = `${field.id ?? ""} ${field.label ?? ""}`.toLowerCase();
          return haystack.includes(mention.entity) && !/(file|report|pdf|document|attachment)/i.test(haystack);
        }) ?? fields.find((field) => {
          const haystack = `${field.id ?? ""} ${field.label ?? ""}`.toLowerCase();
          return haystack.includes("entity") || haystack.includes("customer");
        });
        const fileField = fields.find((field) => {
          const haystack = `${field.id ?? ""} ${field.label ?? ""}`.toLowerCase();
          return /(file|pdf|document|attachment)/i.test(haystack);
        }) ?? fields.find((field) => `${field.id ?? ""} ${field.label ?? ""}`.toLowerCase().includes("report"));
        const linkId = String(linkField?.id ?? "").trim();
        const fileId = String(fileField?.id ?? "").trim();
        if (table && linkId && fileId) {
          nudges.add(
            `This appears to be the linking table. Next run: SELECT id, name, ${linkId}, ${fileId} FROM ${table} ` +
            `WHERE ${linkId} = ${mention.id} AND ${fileId} IS NOT NULL AND ROWNUM <= 5. Then read the returned file ID.`
          );
        }
      } else if (tableText === "file") {
        nudges.add(
          `The File table describes files but does not link them to ${mention.entity} ${mention.id}. Search/inspect the custom report relationship table instead.`
        );
      }
    }

    if (toolName === "netsuite_find_file" || toolName.endsWith("__netsuite_find_file")) {
      if (count === 0 || count === null) {
        nudges.add(
          `File Cabinet search did not prove the record relationship. Do not retry generic report/file searches. ` +
          `Use SuiteQL: search tables for "lead", "report", and "file"; inspect joins/fields; then query for records tied to ${mention.entity} ${mention.id}.`
        );
      } else {
        nudges.add(
          `A file-name search can return unrelated files. Only finish if the file result is linked to ${mention.entity} ${mention.id}; ` +
          `otherwise verify the relationship with SuiteQL before answering.`
        );
      }
    }

    if (
      toolName === "netsuite_get_root_folders" ||
      toolName === "netsuite_list_folder" ||
      toolName === "netsuite_find_folder" ||
      toolName.endsWith("__netsuite_list_folder") ||
      toolName.endsWith("__netsuite_find_folder")
    ) {
      nudges.add(
        `Folder browsing can find where files live, but it cannot prove which report belongs to ${mention.entity} ${mention.id}. ` +
        `Switch to SuiteQL relationship discovery and query the linking record/table.`
      );
    }

    if (
      (toolName === "sql_execute_query" || toolName.endsWith("__suiteql_execute_query")) &&
      count === 0
    ) {
      nudges.add(
        `The SuiteQL query returned no rows. Change the relationship strategy: inspect table fields/joins, ` +
        `sample values where needed, and avoid broad File Cabinet name searches.`
      );
    }
  });

  return Array.from(nudges);
};

const toExternalTool = (tool: HarnessTool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
});

const isWriteLikeToolName = (name: string): boolean =>
  /(upload|create|delete|remove|run|open|submit|deploy|write|patch|cache_upload)/i.test(
    name
  );

const toolRisk = (tool: ToolDefinition): HarnessRisk => {
  if (tool.destructive) return "high";
  if (/^(cache_upload_file|netsuite_create_script|netsuite_upload_file)$/i.test(tool.name)) {
    return "high";
  }
  if (isWriteLikeToolName(tool.name)) return "medium";
  if (/^(sql_execute_query|netsuite_load_record|netsuite_export_record)$/i.test(tool.name)) {
    return "low";
  }
  return "none";
};

const toolsetIdsFor = (name: string): HarnessToolsetId[] => {
  const ids = new Set<HarnessToolsetId>();

  if (
    [
      "calculate",
      "get_current_time",
      "cache_store",
      "cache_retrieve",
      "cache_display",
      "cache_list",
      "cache_delete",
      "search_skills",
      "load_skill",
      "netsuite_context_snapshot",
      "netsuite_get_current_user",
      "netsuite_get_current_record",
    ].includes(name)
  ) {
    ids.add("context");
  }
  if (name === "netsuite_find_record_related_file") ids.add("suiteql");
  if (name.startsWith("sql_")) ids.add("suiteql");
  if (
    name.includes("record") ||
    name === "netsuite_load_record" ||
    name === "netsuite_export_record"
  ) {
    ids.add("records");
  }
  if (
    name.includes("script") ||
    name.includes("deployment") ||
    name.includes("module")
  ) {
    ids.add("scripts");
  }
  if (
    name.includes("file") ||
    name.includes("folder") ||
    name.includes("cache_upload")
  ) {
    ids.add("filecabinet");
  }
  if (
    name.includes("docs") ||
    name.includes("doc_page") ||
    name.includes("module_member")
  ) {
    ids.add("docs");
  }
  if (name.includes("bundle")) ids.add("bundles");
  if (name.includes("pdf") || name.startsWith("generate_")) ids.add("output");

  if (ids.size === 0) ids.add("context");
  return Array.from(ids);
};

const validateRequired = (
  tool: HarnessTool,
  args: Record<string, unknown>
): string | null => {
  const required = tool.parameters?.required ?? [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      return `Missing required parameter "${key}" for ${tool.name}.`;
    }
  }
  return null;
};

const permissionFor = (
  tool: HarnessTool,
  mode: HarnessPermissionMode
): "allow" | "ask" | "deny" => {
  if (mode === "read" && !tool.readOnly) return "deny";
  if (tool.risk === "high") return "ask";
  if (mode === "release" && tool.risk === "medium") return "ask";
  if (mode === "build" && tool.risk === "medium") return "ask";
  return "allow";
};

const buildHarnessSnapshotTool = (
  getProfile: () => HarnessProfile,
  getPermissionMode: () => HarnessPermissionMode,
  getEnvironment: () => string
): HarnessTool => ({
  name: "netsuite_context_snapshot",
  description:
    "Get the active NetSuite account host, connection health, harness agent, permission mode, and timestamp. Use this when account context is uncertain before selecting account-specific tools.",
  parameters: { type: "object", properties: {}, required: [] },
  toolsetIds: ["context"],
  readOnly: true,
  risk: "none",
  execute: async () => {
    const environment = await getNetsuiteEnvironment();
    let connection: "connected" | "unknown" | "disconnected" | "error" = "unknown";
    let detail: unknown = null;
    let currentUser: unknown = null;
    try {
      const response = await callApi(RequestRoutes.CHECK_CONNECTION);
      connection = response.message === "connected" ? "connected" : "disconnected";
      detail = response.message;
    } catch (err) {
      connection = "disconnected";
      detail = String(err);
    }
    try {
      const userResponse = await callApi(RequestRoutes.CURRENT_USER);
      currentUser = userResponse.message;
    } catch {
      currentUser = null;
    }
    return {
      environment: environment === "unknown" ? getEnvironment() : environment,
      connection,
      detail,
      currentUser,
      agent: getProfile().name,
      permissionMode: getPermissionMode(),
      timestamp: new Date().toISOString(),
    };
  },
});

const buildToolCatalog = (
  getProfile: () => HarnessProfile,
  getPermissionMode: () => HarnessPermissionMode,
  getEnvironment: () => string
): HarnessTool[] => {
  const map = new Map<string, HarnessTool>();
  const add = (tool: ToolDefinition) => {
    const risk = toolRisk(tool);
    map.set(tool.name, {
      ...tool,
      toolsetIds: toolsetIdsFor(tool.name),
      risk,
      readOnly: risk === "none" || risk === "low",
    });
  };

  [
    ...baseTools,
    ...skillTools,
    ...createSqlAiTools().filter((tool) => tool.name !== "sql_get_editor_query"),
    ...netsuiteDocsTools,
    ...bundleTools,
    buildHarnessSnapshotTool(getProfile, getPermissionMode, getEnvironment),
  ].forEach(add);

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
};

const buildSystemPrompt = (
  profile: HarnessProfile,
  mode: HarnessPermissionMode,
  environment: string,
  toolsets: HarnessToolsetDefinition[],
  tools: HarnessTool[]
): string => {
  const toolsetText = toolsets
    .map((set) => `- ${set.name}: ${set.description}`)
    .join("\n");
  const toolText = tools
    .map((tool) => {
      const permission = permissionFor(tool, mode);
      return `- ${tool.name} [${tool.toolsetIds.join(", ")}; risk=${tool.risk}; permission=${permission}]`;
    })
    .join("\n");

  return `You are the Magic NetSuite Agent Harness, a NetSuite-first agent runtime.

REFERENCE ARCHITECTURE YOU MUST FOLLOW
- Thread: durable user session.
- Turn: one unit of work initiated by a user message.
- Item: visible event inside a turn: user message, assistant message, tool execution, approval, or system note.
- Treat tools as typed NetSuite capabilities, not as a generic chat add-on.
- Prefer live NetSuite APIs, SuiteQL schema discovery, File Cabinet helpers, official docs, and bundle inspectors over memory.
- Use the minimum toolset that proves the answer. Stop once evidence is sufficient.
- Keep visible responses concise, operational, and evidence-backed.

ACTIVE AGENT
${profile.name}: ${profile.systemFocus}

CURRENT ACCOUNT
- Environment host: ${environment || "unknown"}
- Permission mode: ${mode}

PERMISSION RULES
- read: read-only account exploration. Do not call write-like tools.
- build: may prepare artifacts and cache content. Ask before any write-like NetSuite action.
- release: stricter build mode. Ask before medium/high risk actions and summarize impact before final answer.
- If a tool is denied, pick another read-only path or ask the user for explicit mode change.

NETSUITE ROUTING RULES
- For account data, use SuiteQL or the specific netsuite_* tool.
- For "my", "me", current user, owner, role, department, location, or subsidiary scope, call netsuite_get_current_user before broad account searches.
- For "my scripts", call netsuite_get_current_user first, then call netsuite_get_scripts with the owner filter. Do not call netsuite_get_scripts with empty arguments for that request.
- For SuiteScript source, find the script record first, then fetch script files, then cache/retrieve/display as needed.
- For record-related files/reports, never assume a file ID equals a record/entity ID. "lead id 181" means lead/customer record 181, not file 181.
- For "report/file/document/attachment for lead/customer/entity/transaction ID", use SuiteQL relationship discovery before File Cabinet tools: search tables, inspect fields/joins, query the relationship, then read the returned file ID.
- Loading the lead/customer record is only an identity check; it does not prove which report file is linked. After loading, continue with SuiteQL joins/custom-record fields instead of browsing root folders or searching generic "report" file names.
- For record-related report/file requests, prefer netsuite_find_record_related_file when available. It runs the relationship lookup deterministically and returns the linked file ID/evidence in one tool call.
- If a generic file search returns empty or unrelated results, switch to SuiteQL relationship discovery immediately.
- For docs, use official NetSuite documentation tools. Do not answer NetSuite product rules from stale model memory.
- For bundles, list bundles before inspecting components unless a bundle ID is already known.
- For uploads, generated scripts, and report files, store and verify cache content before writing to NetSuite.

ROUTING EXAMPLES
- User: "find the report file with lead id 181" -> do not call netsuite_find_file(fileId/id: 181). Prefer netsuite_find_record_related_file({ recordType: "lead", recordId: "181", purpose: "report" }); otherwise use SuiteQL tables/fields/joins to find the report relationship and returned file ID.
- User: "read file id 181" -> use File Cabinet read/search tools because the user explicitly said file ID.
- User: "find files named invoice" -> use netsuite_find_file(name: "invoice") because this is a file-name search, not a record relationship.

RESPONSE PRESENTATION
- Use markdown tables for lists of scripts, files, records, bundles, deployments, search results, and comparisons.
- Use short headings only when they improve scanning.
- Use callouts for warnings, approval needs, or missing evidence.
- Use checklists for next actions and collapse long evidence sections when the answer would otherwise get noisy.
- For requested diagrams, flowcharts, sequence diagrams, or visual workflow explanations, load the diagram skill on demand: call search_skills with a diagram-related query, then load_skill, then emit a \`\`\`diagram fenced block that follows the loaded instructions.

ACTIVE TOOLSETS
${toolsetText}

AVAILABLE TOOLS
${toolText}

${NETSUITE_DOCS_SYSTEM_PROMPT}

${BUNDLE_TOOLS_SYSTEM_PROMPT}`;
};

export const useNetsuiteAgentHarness = (
  onApprovalRequest?: (request: HarnessApprovalRequest) => Promise<boolean>
) => {
  const { chatCompletion, settings } = useAiProvider();

  const agents = ref<HarnessAgent[]>([]);
  const threads = ref<HarnessThreadRecord[]>([]);
  const activeThreadId = ref<string | null>(null);
  const items = ref<HarnessItemRecord[]>([]);
  const activeProfileId = ref("navigator");
  const permissionMode = ref<HarnessPermissionMode>("read");
  const environment = ref("unknown");
  const connectionStatus = ref<"unknown" | "checking" | "connected" | "disconnected" | "error">("unknown");
  const loading = ref(false);
  const contextResolving = ref(false);
  const error = ref<unknown>(null);
  const telemetry = ref<HarnessTelemetryEntry[]>([]);
  const activeController = ref<AbortController | null>(null);

  const enabledAgents = computed(() => {
    const source = agents.value.length > 0 ? agents.value : DEFAULT_HARNESS_AGENTS;
    const visible = source.filter((agent) => agent.enabled !== false);
    return visible.length > 0 ? visible : source;
  });

  const activeProfile = computed(
    () =>
      enabledAgents.value.find((profile) => profile.id === activeProfileId.value) ??
      agents.value.find((profile) => profile.id === activeProfileId.value) ??
      enabledAgents.value[0] ??
      DEFAULT_HARNESS_AGENTS[0]!
  );

  const activeAgent = activeProfile;

  const toolCatalog = computed(() =>
    buildToolCatalog(
      () => activeProfile.value,
      () => permissionMode.value,
      () => environment.value
    )
  );

  const activeThread = computed(
    () => threads.value.find((thread) => thread.threadId === activeThreadId.value) ?? null
  );

  const selectedTools = computed(() => {
    const allowedSets = new Set(activeProfile.value.toolsets);
    const explicitlyEnabled = Array.isArray(activeProfile.value.enabledToolNames)
      ? new Set(activeProfile.value.enabledToolNames)
      : null;
    return toolCatalog.value.filter((tool) => {
      const inProfile = tool.toolsetIds.some((id) => allowedSets.has(id));
      if (!inProfile) return false;
      if (explicitlyEnabled && !explicitlyEnabled.has(tool.name)) return false;
      return permissionFor(tool, permissionMode.value) !== "deny";
    });
  });

  const activeToolsets = computed(() =>
    HARNESS_TOOLSETS.map((toolset) => ({
      ...toolset,
      active: activeProfile.value.toolsets.includes(toolset.id),
      count: selectedTools.value.filter((tool) => tool.toolsetIds.includes(toolset.id)).length,
    }))
  );

  const agentAllowsTool = (tool: HarnessTool, agent = activeProfile.value): boolean => {
    const inAgentToolset = tool.toolsetIds.some((id) => agent.toolsets.includes(id));
    if (!inAgentToolset) return false;
    if (!Array.isArray(agent.enabledToolNames)) return true;
    return agent.enabledToolNames.includes(tool.name);
  };

  const toolGroups = computed(() =>
    HARNESS_TOOLSETS.map((toolset) => {
      const inAgent = activeProfile.value.toolsets.includes(toolset.id);
      const tools = toolCatalog.value
        .filter((tool) => tool.toolsetIds.includes(toolset.id))
        .map((tool) => {
          const permission = permissionFor(tool, permissionMode.value);
          const enabledByAgent = agentAllowsTool(tool);
          return {
            ...tool,
            permission,
            inAgentToolset: inAgent,
            enabledByAgent,
            selected: enabledByAgent && permission !== "deny",
          };
        });

      return {
        ...toolset,
        active: inAgent,
        count: tools.filter((tool) => tool.selected).length,
        total: tools.length,
        tools,
      };
    })
  );

  const lastEvidence = computed(() =>
    items.value
      .filter((item) => item.kind === "tool" && (item.status === "done" || item.status === "error"))
      .slice(-6)
      .reverse()
  );

  const providerLabel = computed(() => {
    const provider = settings.aiProvider || "unconfigured";
    if (provider === "ollama") return `Ollama · ${settings.ollamaModel || "no model"}`;
    if (provider === "opencode") return `OpenCode · ${settings.opencodeModel || "no model"}`;
    if (provider === "copilot") return `Copilot · ${settings.copilotModel || "default"}`;
    if (provider === "openrouter") return `OpenRouter · ${settings.openrouterModel || "free"}`;
    return provider;
  });

  const updateThreadList = async () => {
    threads.value = await getHarnessThreads();
  };

  const loadAgents = async () => {
    let stored = await getHarnessAgents();
    const missingDefaults = DEFAULT_HARNESS_AGENTS.filter(
      (agent) => !stored.some((storedAgent) => storedAgent.id === agent.id)
    );

    if (missingDefaults.length > 0) {
      await bulkPutHarnessAgents(missingDefaults.map((agent) => agentToRecord(agent)));
      stored = await getHarnessAgents();
    }

    const defaultOrder = new Map(DEFAULT_HARNESS_AGENTS.map((agent, index) => [agent.id, index]));
    agents.value = stored
      .map(normalizeAgent)
      .sort(
        (a, b) =>
          (defaultOrder.get(a.id) ?? 1000) - (defaultOrder.get(b.id) ?? 1000) ||
          a.name.localeCompare(b.name)
      );
  };

  const findAgentById = (agentId?: string | null): HarnessAgent | undefined =>
    agents.value.find((agent) => agent.id === agentId) ??
    DEFAULT_HARNESS_AGENTS.find((agent) => agent.id === agentId);

  const getAgentById = (agentId?: string | null): HarnessAgent =>
    findAgentById(agentId) ??
    activeProfile.value;

  const saveAgent = async (draft: HarnessAgentDraft): Promise<HarnessAgent> => {
    const existing = draft.id ? findAgentById(draft.id) : null;
    const timestamp = nowIso();
    const normalized = normalizeAgent({
      id: draft.id || uid("agent"),
      name: draft.name.trim() || "Untitled Agent",
      shortName: (draft.shortName || draft.name || "Agent").trim().slice(0, 18),
      icon: draft.icon || "pi pi-sparkles",
      color: /^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : "#7c3aed",
      description: draft.description.trim() || "Custom NetSuite agent.",
      defaultPermissionMode: draft.defaultPermissionMode,
      toolsets: draft.toolsets,
      enabledToolNames: Array.isArray(draft.enabledToolNames)
        ? [...new Set(draft.enabledToolNames)]
        : undefined,
      maxSteps: draft.maxSteps,
      systemFocus: draft.systemFocus.trim(),
      builtIn: Boolean(existing?.builtIn || draft.builtIn),
      enabled: draft.enabled !== false,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    });

    await upsertHarnessAgent(agentToRecord(normalized));
    await loadAgents();
    return getAgentById(normalized.id);
  };

  const duplicateAgent = async (agentId: string): Promise<HarnessAgent | null> => {
    const source = findAgentById(agentId);
    if (!source) return null;
    const copy = await saveAgent({
      ...source,
      id: undefined,
      builtIn: false,
      name: `${source.name} Copy`,
      shortName: `${source.shortName}`.slice(0, 18),
      toolsets: Array.from(source.toolsets),
      enabledToolNames: source.enabledToolNames ? Array.from(source.enabledToolNames) : undefined,
    });
    activeProfileId.value = copy.id;
    permissionMode.value = copy.defaultPermissionMode;
    await saveUiState();
    await touchActiveThread();
    return copy;
  };

  const removeAgent = async (agentId: string): Promise<void> => {
    const target = findAgentById(agentId);
    if (!target || target.builtIn) return;
    await deleteHarnessAgent(agentId);
    await loadAgents();
    if (activeProfileId.value === agentId) {
      activeProfileId.value = enabledAgents.value[0]?.id ?? DEFAULT_HARNESS_AGENTS[0]!.id;
      permissionMode.value = activeProfile.value.defaultPermissionMode;
      await saveUiState();
      await touchActiveThread();
    }
  };

  const refreshEnvironment = async () => {
    connectionStatus.value = "checking";
    try {
      environment.value = await getNetsuiteEnvironment();
      const response = await callApi(RequestRoutes.CHECK_CONNECTION);
      connectionStatus.value =
        response.message === "connected" ? "connected" : "disconnected";
    } catch (err) {
      connectionStatus.value = "disconnected";
      if (environment.value === "unknown") {
        try {
          environment.value = await getNetsuiteEnvironment();
        } catch {
          environment.value = "unknown";
        }
      }
    }
  };

  const saveUiState = async () => {
    await Promise.all([
      setHarnessUiState(UI_ACTIVE_THREAD_KEY, activeThreadId.value),
      setHarnessUiState(UI_ACTIVE_PROFILE_KEY, activeProfileId.value),
      setHarnessUiState(UI_PERMISSION_MODE_KEY, permissionMode.value),
    ]);
  };

  const setLocalItem = (
    itemId: string,
    patch: Partial<HarnessItemRecord>
  ): HarnessItemRecord | null => {
    const idx = items.value.findIndex((item) => item.id === itemId);
    if (idx === -1) return null;
    const updated = {
      ...items.value[idx]!,
      ...patch,
      updatedAt: nowIso(),
    };
    items.value.splice(idx, 1, updated);
    return updated;
  };

  const updateItem = async (
    itemId: string,
    patch: Partial<HarnessItemRecord>,
    persist = true
  ) => {
    const updated = setLocalItem(itemId, patch);
    if (updated && persist) await putHarnessItem(updated);
  };

  const appendItem = async (
    item: Omit<HarnessItemRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<HarnessItemRecord> => {
    const record: HarnessItemRecord = {
      ...item,
      id: uid("item"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    items.value.push(record);
    await putHarnessItem(record);
    return record;
  };

  const settleActiveTurnItems = async (
    turnId: string,
    status: Extract<HarnessItemStatus, "error" | "rejected">,
    fallbackContent: string
  ) => {
    const activeItems = items.value.filter(
      (item) =>
        item.turnId === turnId &&
        (item.status === "running" || item.status === "pending")
    );
    await Promise.all(
      activeItems.map((item) =>
        updateItem(item.id, {
          status,
          content:
            item.content.trim() && !/^(running|waiting)/i.test(item.content.trim())
              ? item.content
              : fallbackContent,
        })
      )
    );
  };

  const touchActiveThread = async (patch: Partial<HarnessThreadRecord> = {}) => {
    if (!activeThread.value) return;
    const updated = {
      ...activeThread.value,
      ...patch,
      profileId: activeProfileId.value,
      permissionMode: permissionMode.value,
      environment: environment.value,
      updatedAt: nowIso(),
    };
    await upsertHarnessThread(updated);
    await updateThreadList();
  };

  const createThread = async (
    profileId = activeProfileId.value
  ): Promise<HarnessThreadRecord> => {
    const profile = findAgentById(profileId) ?? enabledAgents.value[0] ?? DEFAULT_HARNESS_AGENTS[0]!;
    activeProfileId.value = profile.id;
    permissionMode.value = profile.defaultPermissionMode;
    const thread: HarnessThreadRecord = {
      threadId: uid("thread"),
      title: "Untitled harness run",
      profileId: profile.id,
      permissionMode: profile.defaultPermissionMode,
      environment: environment.value,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await upsertHarnessThread(thread);
    activeThreadId.value = thread.threadId;
    items.value = [];
    await agentCache.init(thread.threadId);
    await saveUiState();
    await updateThreadList();
    return thread;
  };

  const loadThread = async (threadId: string) => {
    const thread = threads.value.find((t) => t.threadId === threadId);
    if (!thread) return;
    activeThreadId.value = threadId;
    activeProfileId.value =
      findAgentById(thread.profileId)?.id ??
      enabledAgents.value[0]?.id ??
      DEFAULT_HARNESS_AGENTS[0]!.id;
    permissionMode.value = thread.permissionMode;
    items.value = await getHarnessItems(threadId);
    await agentCache.init(threadId);
    await saveUiState();
  };

  const removeThread = async (threadId: string) => {
    await deleteHarnessThread(threadId);
    await agentCache.deleteForChat(threadId);
    await updateThreadList();
    if (activeThreadId.value === threadId) {
      if (threads.value[0]) {
        await loadThread(threads.value[0].threadId);
      } else {
        await createThread();
      }
    }
  };

  const setActiveProfile = async (profileId: string) => {
    const profile = findAgentById(profileId);
    if (!profile || profile.enabled === false) return;
    activeProfileId.value = profile.id;
    permissionMode.value = profile.defaultPermissionMode;
    await saveUiState();
    await touchActiveThread();
  };

  const setActiveAgent = setActiveProfile;

  const setPermissionMode = async (mode: HarnessPermissionMode) => {
    permissionMode.value = mode;
    await saveUiState();
    await touchActiveThread();
  };

  const defaultToolNamesForAgent = (agent: HarnessAgent): string[] => {
    const allowedSets = new Set(agent.toolsets);
    return toolCatalog.value
      .filter((tool) => tool.toolsetIds.some((id) => allowedSets.has(id)))
      .map((tool) => tool.name);
  };

  const toggleToolForActiveAgent = async (
    toolName: string,
    enabled?: boolean
  ): Promise<void> => {
    const tool = toolCatalog.value.find((candidate) => candidate.name === toolName);
    if (!tool) return;
    const agent = activeProfile.value;
    const names = new Set(
      Array.isArray(agent.enabledToolNames)
        ? agent.enabledToolNames
        : defaultToolNamesForAgent(agent)
    );
    const shouldEnable = enabled ?? !names.has(toolName);
    if (shouldEnable) {
      names.add(toolName);
    } else {
      names.delete(toolName);
    }

    const nextToolsets = new Set(agent.toolsets);
    if (shouldEnable) {
      tool.toolsetIds.forEach((id) => nextToolsets.add(id));
    }

    await saveAgent({
      ...agent,
      toolsets: Array.from(nextToolsets),
      enabledToolNames: Array.from(names).sort(),
    });
  };

  const toggleToolsetForActiveAgent = async (toolsetId: HarnessToolsetId): Promise<void> => {
    const agent = activeProfile.value;
    const nextToolsets = new Set(agent.toolsets);
    const currentlyActive = nextToolsets.has(toolsetId);
    const currentNames = new Set(
      Array.isArray(agent.enabledToolNames)
        ? agent.enabledToolNames
        : defaultToolNamesForAgent(agent)
    );
    const toolsetToolNames = toolCatalog.value
      .filter((tool) => tool.toolsetIds.includes(toolsetId))
      .map((tool) => tool.name);

    if (currentlyActive) {
      nextToolsets.delete(toolsetId);
      toolsetToolNames.forEach((name) => currentNames.delete(name));
    } else {
      nextToolsets.add(toolsetId);
      toolsetToolNames.forEach((name) => currentNames.add(name));
    }

    await saveAgent({
      ...agent,
      toolsets: Array.from(nextToolsets),
      enabledToolNames: Array.from(currentNames).sort(),
    });
  };

  const buildPriorMessages = (excludeItemId?: string): ChatMessage[] => {
    const prior = items.value
      .filter((item) => item.id !== excludeItemId)
      .filter((item) => item.kind === "message" && item.role !== "system")
      .slice(-14);

    const messages: ChatMessage[] = prior.map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content:
        item.role === "user"
          ? formatMessageContent(item.content, item.attachments)
          : item.content,
    }));

    const evidence = lastEvidence.value
      .slice()
      .reverse()
      .map(
        (item) =>
          `- ${item.toolName ?? "tool"} (${item.status}, ${item.latencyMs ?? 0}ms): ${compact(item.content.replace(/\s+/g, " "), 500)}`
      )
      .join("\n");

    if (evidence) {
      messages.push({
        role: "user",
        content: `Recent harness evidence from prior turns:\n${evidence}`,
      });
    }

    return messages;
  };

  const executeToolCall = async (
    call: ToolCall,
    turnId: string,
    prompt: string,
    toolPool: HarnessTool[] = selectedTools.value
  ): Promise<ChatMessage> => {
    const toolName = call.function.name;
    const tool = toolPool.find((candidate) => candidate.name === toolName);
    const args = parseToolArgs(call);
    const start = performance.now();

    const item = await appendItem({
      threadId: activeThreadId.value!,
      turnId,
      kind: "tool",
      role: "tool",
      title: toolName,
      content: "Running...",
      status: "running",
      profileId: activeProfileId.value,
      toolName,
      toolInput: args,
      risk: tool?.risk ?? "medium",
    });

    const finish = async (
      status: HarnessItemStatus,
      result: unknown,
      risk: HarnessRisk = tool?.risk ?? "medium"
    ): Promise<ChatMessage> => {
      const latencyMs = Math.max(0, Math.round(performance.now() - start));
      const content = stringifyResult(
        result,
        6000
      );
      await updateItem(item.id, {
        status,
        content,
        latencyMs,
        risk,
      });
      telemetry.value.unshift({
        id: uid("telemetry"),
        turnId,
        toolName,
        status,
        latencyMs,
        risk,
        resultSummary: compact(content.replace(/\s+/g, " "), 220),
        createdAt: nowIso(),
      });
      return {
        role: "tool",
        tool_call_id: call.id,
        content,
      };
    };

    if (!tool) {
      return finish("error", {
        error: `Tool "${toolName}" is not available to the active agent or permission mode.`,
      });
    }

    const validationError = validateRequired(tool, args);
    if (validationError) {
      return finish("error", { error: validationError }, tool.risk);
    }

    const relationshipGuardError = validateRecordRelatedFileToolCall(
      toolName,
      args,
      prompt
    );
    if (relationshipGuardError) {
      return finish("error", { error: relationshipGuardError }, tool.risk);
    }

    const permission = permissionFor(tool, permissionMode.value);
    if (permission === "deny") {
      return finish("rejected", {
        error: `Tool "${toolName}" is denied in ${permissionMode.value} mode.`,
      }, tool.risk);
    }

    if (permission === "ask") {
      await updateItem(item.id, {
        kind: "approval",
        title: `Approval required: ${toolName}`,
        content: "Waiting for user approval...",
        status: "pending",
      });
      const approved = await onApprovalRequest?.({
        toolName,
        toolInput: args,
        profileName: activeProfile.value.name,
        profileColor: activeProfile.value.color,
        reason: `${toolName} is ${tool.risk} risk in ${permissionMode.value} mode.`,
      });
      if (!approved) {
        return finish("rejected", {
          error: `User rejected ${toolName}.`,
        }, tool.risk);
      }
      await updateItem(item.id, {
        kind: "tool",
        content: "Approved. Running...",
        status: "running",
      });
    }

    try {
      const result = await tool.execute(args);
      return finish("done", result, tool.risk);
    } catch (err) {
      return finish("error", { error: String(err) }, tool.risk);
    }
  };

  const executeToolCalls = async (
    calls: ToolCall[],
    turnId: string,
    prompt: string,
    toolPool: HarnessTool[] = selectedTools.value
  ): Promise<ChatMessage[]> => {
    const allReadOnly = calls.every((call) => {
      const tool = toolPool.find((candidate) => candidate.name === call.function.name);
      return tool?.readOnly && permissionFor(tool, permissionMode.value) === "allow";
    });

    if (allReadOnly && calls.length > 1) {
      const indexed = await Promise.all(
        calls.map(async (call, index) => ({
          index,
          message: await executeToolCall(call, turnId, prompt, toolPool),
        }))
      );
      return indexed.sort((a, b) => a.index - b.index).map((entry) => entry.message);
    }

    const outputs: ChatMessage[] = [];
    for (const call of calls) {
      outputs.push(await executeToolCall(call, turnId, prompt, toolPool));
    }
    return outputs;
  };

  const synthesizeFromMessages = async (
    messages: ChatMessage[],
    turnId: string,
    instruction: string,
    visibleTitle?: string
  ): Promise<string> => {
    const synthesisMessages: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        content: instruction,
      },
    ];

    let item: HarnessItemRecord | null = null;
    let streamed = "";
    let streamFlushTimer: number | null = null;

    if (visibleTitle) {
      item = await appendItem({
        threadId: activeThreadId.value!,
        turnId,
        kind: "message",
        role: "assistant",
        title: visibleTitle,
        content: "",
        status: "running",
        profileId: activeProfileId.value,
      });
    }

    let response: Awaited<ReturnType<typeof chatCompletion>> | null = null;
    try {
      response = await chatCompletion(synthesisMessages, {
        signal: activeController.value?.signal,
        onChunk: visibleTitle
          ? (chunk) => {
              streamed += chunk;
              if (streamFlushTimer !== null || !item) return;
              streamFlushTimer = window.setTimeout(() => {
                streamFlushTimer = null;
                if (!item) return;
                void updateItem(
                  item.id,
                  {
                    content: streamed,
                    status: "running",
                  },
                  false
                );
              }, 80);
            }
          : undefined,
      });
    } finally {
      if (streamFlushTimer !== null) {
        window.clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
      }
    }

    if (!response) {
      throw new Error("The model did not return a synthesis response.");
    }

    const text = (response.content ?? streamed).trim();
    if (item) {
      await updateItem(item.id, {
        content: text || "[no response]",
        status: text ? "done" : "error",
      });
    }
    return text;
  };

  const rerunFromItem = async (
    itemId: string,
    prompt: string,
    options: HarnessRunOptions = {}
  ): Promise<void> => {
    if (!activeThreadId.value || loading.value) return;
    const idx = items.value.findIndex((item) => item.id === itemId);
    if (idx === -1) return;
    const editedItem = items.value[idx]!;
    if (editedItem.role !== "user") return;

    const keptItems = items.value.slice(0, idx);
    items.value = keptItems;
    await replaceHarnessItems(activeThreadId.value, keptItems);
    const keptTurnIds = new Set(keptItems.map((item) => item.turnId));
    telemetry.value = telemetry.value.filter((entry) => keptTurnIds.has(entry.turnId));

    await runTurn(prompt, {
      attachments: options.attachments ?? editedItem.attachments,
    });
  };

  const runTurn = async (
    prompt: string,
    options: HarnessRunOptions = {}
  ): Promise<void> => {
    const cleanPrompt = prompt.trim();
    const rawAttachments = options.attachments?.filter(isSendableAttachment);
    if ((!cleanPrompt && (!rawAttachments || rawAttachments.length === 0)) || loading.value) return;
    if (!activeThread.value) await createThread(activeProfileId.value);

    loading.value = true;
    error.value = null;
    const turnId = uid("turn");
    const controller = new AbortController();
    activeController.value = controller;

    // Allow the UI scroll (triggered by the view before runTurn) to paint first.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    let workerTabReferenceUrl: string | undefined;
    try {
      const env = await getNetsuiteEnvironment();
      if (env !== "unknown") {
        workerTabReferenceUrl = `https://${env}/app/setup/mainsetup.nl`;
      }
    } catch {
      workerTabReferenceUrl = undefined;
    }

    try {
      await beginHarnessWorkerTab(turnId, workerTabReferenceUrl);
    } catch (err) {
      console.warn("[harness] Could not open worker tab; heavy calls may run in-page", err);
    }

    try {
      const hasDeferred = rawAttachments?.some((attachment) => attachment.deferred) ?? false;
      let attachments: HarnessAttachment[];
      let userItem: HarnessItemRecord;

      if (hasDeferred && rawAttachments?.length) {
        userItem = await appendItem({
          threadId: activeThreadId.value!,
          turnId,
          kind: "message",
          role: "user",
          content: cleanPrompt,
          attachments: rawAttachments,
          status: "done",
          profileId: activeProfileId.value,
        });

        contextResolving.value = true;
        try {
          ({ attachments } = await resolveAttachmentsForTurn(rawAttachments));
          await updateItem(userItem.id, { attachments });
        } finally {
          contextResolving.value = false;
        }
      } else {
        ({ attachments } = await resolveAttachmentsForTurn(rawAttachments));
        userItem = await appendItem({
          threadId: activeThreadId.value!,
          turnId,
          kind: "message",
          role: "user",
          content: cleanPrompt,
          attachments,
          status: "done",
          profileId: activeProfileId.value,
        });
      }

      if (activeThread.value?.title === "Untitled harness run") {
        await touchActiveThread({
          title: cleanPrompt.replace(/\s+/g, " ").slice(0, 64),
        });
      } else {
        await touchActiveThread();
      }

      const systemPrompt = buildSystemPrompt(
        activeProfile.value,
        permissionMode.value,
        environment.value,
        activeToolsets.value.filter((set) => set.active),
        selectedTools.value
      );
      const runtimeMessages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        ...buildPriorMessages(userItem.id),
        {
          role: "user",
          content: formatMessageContent(cleanPrompt, attachments),
        },
      ];
      const externalTools = selectedTools.value.map(toExternalTool);
      const mainStepLimit = Math.max(
        activeProfile.value.maxSteps,
        clampStepLimit(settings.agentMainStepLimit, activeProfile.value.maxSteps)
      );
      let blankNoToolResponses = 0;

      for (let step = 0; step < mainStepLimit; step++) {
        let streamed = "";
        let streamFlushTimer: number | null = null;
        const assistantItem = await appendItem({
          threadId: activeThreadId.value!,
          turnId,
          kind: "message",
          role: "assistant",
          title: step === 0 ? activeProfile.value.name : "Follow-up pass",
          content: "",
          status: "running",
          profileId: activeProfileId.value,
        });

        let response: Awaited<ReturnType<typeof chatCompletion>> | null = null;
        try {
          response = await chatCompletion(runtimeMessages, {
            tools: externalTools.length > 0 ? externalTools : undefined,
            signal: controller.signal,
            onChunk: (chunk) => {
              streamed += chunk;
              if (streamFlushTimer !== null) return;
              streamFlushTimer = window.setTimeout(() => {
                streamFlushTimer = null;
                void updateItem(
                  assistantItem.id,
                  {
                    content: streamed,
                    status: "running",
                  },
                  false
                );
              }, 80);
            },
          });
        } finally {
          if (streamFlushTimer !== null) {
            window.clearTimeout(streamFlushTimer);
            streamFlushTimer = null;
          }
        }

        if (!response) {
          throw new Error("The model did not return a response.");
        }

        const assistantText = response.content ?? streamed;
        const toolCalls = response.tool_calls ?? [];

        if (toolCalls.length === 0) {
          const trimmedText = assistantText.trim();
          if (!trimmedText) {
            blankNoToolResponses += 1;
            await updateItem(assistantItem.id, {
              content:
                "The model returned an empty response with no tool call, so the harness is continuing from the evidence already gathered.",
              status: "done",
            });

            const shouldForceFinal =
              blankNoToolResponses >= 2 || step >= mainStepLimit - 1;
            if (shouldForceFinal) {
              const finalText = await synthesizeFromMessages(
                runtimeMessages,
                turnId,
                "The previous model pass returned an empty response with no tool calls. Do not call tools. Using only the tool results and evidence already present, produce the final user-facing answer now. If the requested file/report was found, include the record ID, linking table/field evidence, file ID, and file metadata/cache key when available. If more work is required, say the single next missing step.",
                "Final synthesis"
              );
              if (finalText) {
                runtimeMessages.push({ role: "assistant", content: finalText });
                await touchActiveThread();
                return;
              }
            }

            runtimeMessages.push({
              role: "user",
              content:
                "You returned an empty response with no tool call. Continue this same user request now: either call the next required tool or provide the final answer from the evidence already present. Do not repeat schema searches that already succeeded.",
            });
            continue;
          }

          await updateItem(assistantItem.id, {
            content: trimmedText,
            status: "done",
          });
          runtimeMessages.push({
            role: "assistant",
            content: trimmedText,
          });
          await touchActiveThread();
          return;
        }

        blankNoToolResponses = 0;

        await updateItem(assistantItem.id, {
          content:
            assistantText ||
            `Calling ${toolCalls.length} tool${toolCalls.length === 1 ? "" : "s"}: ${toolCalls.map((call) => call.function.name).join(", ")}`,
          status: "done",
        });
        runtimeMessages.push({
          role: "assistant",
          content: assistantText || "",
          tool_calls: toolCalls,
        });

        const toolOutputs = await executeToolCalls(toolCalls, turnId, cleanPrompt);
        runtimeMessages.push(...toolOutputs);

        const nudges = buildRecordRelatedFileNudges(
          cleanPrompt,
          toolCalls,
          toolOutputs
        );
        if (nudges.length > 0) {
          runtimeMessages.push({
            role: "user",
            content: `Tool-result guidance for this same user request:\n${nudges
              .map((nudge) => `- ${nudge}`)
              .join("\n")}`,
          });
        }
      }

      const finalText = await synthesizeFromMessages(
        runtimeMessages,
        turnId,
        "The main agent step budget has been used. Do not call tools. Using only the tool results and evidence already present, produce the final user-facing answer now. If the requested file/report was found or cached, include the linked record/table evidence, file ID, name/type when available, and cache key/display status. If it was not found, say exactly what is still missing.",
        "Final synthesis"
      );
      if (finalText) {
        runtimeMessages.push({ role: "assistant", content: finalText });
        await touchActiveThread();
        return;
      }

      await appendItem({
        threadId: activeThreadId.value!,
        turnId,
        kind: "system",
        role: "system",
        title: "Step limit reached",
        content:
          "The harness reached the agent step limit and the final synthesis pass did not produce an answer. Try raising the main or sub-agent step limit in Settings.",
        status: "error",
        profileId: activeProfileId.value,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        await settleActiveTurnItems(
          turnId,
          "rejected",
          "Run stopped by user before this step completed."
        );
        await appendItem({
          threadId: activeThreadId.value!,
          turnId,
          kind: "system",
          role: "system",
          title: "Stopped",
          content: "Run stopped by user.",
          status: "rejected",
          profileId: activeProfileId.value,
        });
      } else {
        error.value = err;
        const message = err instanceof Error ? err.message : String(err);
        await settleActiveTurnItems(
          turnId,
          "error",
          `Run stopped because the provider or tool failed: ${message}`
        );
        await appendItem({
          threadId: activeThreadId.value!,
          turnId,
          kind: "system",
          role: "system",
          title: "Harness error",
          content: message,
          status: "error",
          profileId: activeProfileId.value,
        });
      }
    } finally {
      await endHarnessWorkerTab(turnId);
      loading.value = false;
      activeController.value = null;
      await touchActiveThread();
    }
  };

  const stop = () => {
    activeController.value?.abort();
    void endHarnessWorkerTab();
  };

  const clearThread = async () => {
    if (!activeThreadId.value) return;
    await clearHarnessItems(activeThreadId.value);
    agentCache.clear();
    items.value = [];
    telemetry.value = [];
    await touchActiveThread({ title: "Untitled harness run" });
  };

  const initialize = async () => {
    await loadAgents();
    await updateThreadList();
    activeProfileId.value = await getHarnessUiState(
      UI_ACTIVE_PROFILE_KEY,
      "navigator"
    );
    if (!findAgentById(activeProfileId.value)) {
      activeProfileId.value = enabledAgents.value[0]?.id ?? DEFAULT_HARNESS_AGENTS[0]!.id;
    }
    permissionMode.value = await getHarnessUiState<HarnessPermissionMode>(
      UI_PERMISSION_MODE_KEY,
      findAgentById(activeProfileId.value)?.defaultPermissionMode ??
        "read"
    );
    activeThreadId.value = await getHarnessUiState<string | null>(
      UI_ACTIVE_THREAD_KEY,
      null
    );

    if (activeThreadId.value && threads.value.some((thread) => thread.threadId === activeThreadId.value)) {
      await loadThread(activeThreadId.value);
    } else if (threads.value[0]) {
      await loadThread(threads.value[0].threadId);
    } else {
      await createThread(activeProfileId.value);
    }

    void refreshEnvironment();
  };

  return {
    initialize,
    createThread,
    loadThread,
    removeThread,
    clearThread,
    runTurn,
    rerunFromItem,
    stop,
    refreshEnvironment,
    saveAgent,
    duplicateAgent,
    removeAgent,
    getAgentById,
    setActiveProfile,
    setActiveAgent,
    setPermissionMode,
    toggleToolForActiveAgent,
    toggleToolsetForActiveAgent,
    threads: readonly(threads),
    activeThread: readonly(activeThread),
    items: readonly(items),
    agents: readonly(agents),
    profiles: readonly(agents),
    toolsets: HARNESS_TOOLSETS,
    toolCatalog,
    activeProfile,
    activeAgent,
    activeProfileId: readonly(activeProfileId),
    activeAgentId: readonly(activeProfileId),
    permissionMode: readonly(permissionMode),
    activeToolsets,
    toolGroups,
    selectedTools,
    lastEvidence,
    telemetry: readonly(telemetry),
    loading: readonly(loading),
    contextResolving: readonly(contextResolving),
    error: readonly(error),
    environment: readonly(environment),
    connectionStatus: readonly(connectionStatus),
    providerLabel,
  };
};
