import { callApi } from "./api";
import { RequestRoutes } from "../types/request";

export const CUSTOM_TOOLS_STORAGE_KEY = "magic_netsuite_custom_tools_v1";

export const CUSTOM_TOOL_BOTH_MODULES = [
  "record", "search", "query", "runtime", "log", "url", "format", "email",
  "https", "http", "xml", "currency", "transaction"
] as const;
export const CUSTOM_TOOL_CLIENT_MODULES = ["currentRecord", "dialog", "message"] as const;
export const CUSTOM_TOOL_SERVER_MODULES = [
  "file", "render", "task", "workflow", "encode", "error", "redirect"
] as const;
export const CUSTOM_TOOL_MODULES = [
  ...CUSTOM_TOOL_BOTH_MODULES,
  ...CUSTOM_TOOL_CLIENT_MODULES,
  ...CUSTOM_TOOL_SERVER_MODULES
] as const;

export type CustomToolModule = typeof CUSTOM_TOOL_MODULES[number];
export type CustomToolDomain = "client" | "server" | "both";
export type CustomToolStatus = "active" | "draft";
export type CustomToolRisk = "read" | "write";

export interface CustomToolRecord {
  id: string;
  name: string;
  displayName: string;
  description: string;
  tags: string[];
  modules: CustomToolModule[];
  domain: CustomToolDomain;
  inputSchema: Record<string, unknown>;
  code: string;
  status: CustomToolStatus;
  risk: CustomToolRisk;
  enabled: boolean;
  testInput: Record<string, unknown>;
  lastTestResult?: unknown;
  lastTestedAt?: string;
  lastTestDomain?: "client" | "server";
  createdAt: string;
  updatedAt: string;
}

export type CustomToolDraft = Omit<CustomToolRecord, "id" | "createdAt" | "updatedAt" | "testInput"> & {
  id?: string;
  testInput?: Record<string, unknown>;
};

const storageArea = () => globalThis.chrome?.storage?.local;

const modulePaths: Record<CustomToolModule, string> = {
  record: "N/record", search: "N/search", query: "N/query", runtime: "N/runtime",
  log: "N/log", url: "N/url", format: "N/format", email: "N/email",
  https: "N/https", http: "N/http", xml: "N/xml", currency: "N/currency",
  transaction: "N/transaction", currentRecord: "N/currentRecord",
  dialog: "N/ui/dialog", message: "N/ui/message", file: "N/file",
  render: "N/render", task: "N/task", workflow: "N/workflow",
  encode: "N/encode", error: "N/error", redirect: "N/redirect"
};

export const getCustomToolModulePath = (module: CustomToolModule): string => modulePaths[module];

export const getAvailableCustomToolModules = (domain: CustomToolDomain): readonly CustomToolModule[] => {
  if (domain === "client") return [...CUSTOM_TOOL_BOTH_MODULES, ...CUSTOM_TOOL_CLIENT_MODULES];
  if (domain === "server") return [...CUSTOM_TOOL_BOTH_MODULES, ...CUSTOM_TOOL_SERVER_MODULES];
  return CUSTOM_TOOL_BOTH_MODULES;
};

const inferLegacyDomain = (tool: Partial<CustomToolRecord>): CustomToolDomain =>
  (tool.modules || []).some((module) => CUSTOM_TOOL_SERVER_MODULES.includes(module as typeof CUSTOM_TOOL_SERVER_MODULES[number]))
    ? "server"
    : "both";

const normalizeStoredTool = (tool: CustomToolRecord): CustomToolRecord => ({
  ...tool,
  domain: tool.domain || inferLegacyDomain(tool),
  testInput: tool.testInput && typeof tool.testInput === "object" && !Array.isArray(tool.testInput) ? tool.testInput : {}
});

const readRaw = async (): Promise<CustomToolRecord[]> => {
  const area = storageArea();
  if (area) {
    const result = await area.get(CUSTOM_TOOLS_STORAGE_KEY);
    const value = result[CUSTOM_TOOLS_STORAGE_KEY];
    return Array.isArray(value) ? (value as CustomToolRecord[]).map(normalizeStoredTool) : [];
  }
  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_TOOLS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeStoredTool) : [];
  } catch {
    return [];
  }
};

const writeRaw = async (tools: CustomToolRecord[]): Promise<void> => {
  const area = storageArea();
  if (area) {
    await area.set({ [CUSTOM_TOOLS_STORAGE_KEY]: tools });
    return;
  }
  localStorage.setItem(CUSTOM_TOOLS_STORAGE_KEY, JSON.stringify(tools));
};

const uid = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `custom_tool_${Date.now()}_${Math.random().toString(16).slice(2)}`;

export const normalizeCustomToolName = (value: string): string =>
  value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);

export const validateCustomToolSchema = (schema: unknown): string[] => {
  const errors: string[] = [];
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return ["Input schema must be a JSON object."];
  }
  const object = schema as Record<string, unknown>;
  if (object.type !== "object") errors.push('Input schema type must be "object".');
  if (object.properties !== undefined && (!object.properties || typeof object.properties !== "object" || Array.isArray(object.properties))) {
    errors.push("Input schema properties must be an object.");
  }
  if (object.required !== undefined && !Array.isArray(object.required)) {
    errors.push("Input schema required must be an array of property names.");
  }
  return errors;
};

export const validateCustomToolCode = (code: string): string[] => {
  if (!code.trim()) return ["JavaScript body is required."];
  // Do not compile here: extension pages prohibit eval/new Function under CSP.
  // Monaco provides editor diagnostics and the selected NetSuite runtime is authoritative.
  return [];
};

export const validateCustomTool = (tool: CustomToolDraft, existing: CustomToolRecord[] = []): string[] => {
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(tool.name)) {
    errors.push("Tool name must start with a letter and contain 3–64 lowercase letters, numbers, or underscores.");
  }
  if (!tool.displayName.trim()) errors.push("Display name is required.");
  if (!tool.description.trim()) errors.push("Description is required so the AI can route correctly.");
  if (!["client", "server", "both"].includes(tool.domain)) errors.push("Execution domain must be client, server, or both.");
  if (existing.some((item) => item.name === tool.name && item.id !== tool.id)) {
    errors.push(`A custom tool named "${tool.name}" already exists.`);
  }
  const allowedModules = new Set(getAvailableCustomToolModules(tool.domain));
  for (const module of tool.modules) {
    if (!allowedModules.has(module)) {
      errors.push(`${getCustomToolModulePath(module)} is not available for the ${tool.domain} execution domain.`);
    }
  }
  errors.push(...validateCustomToolSchema(tool.inputSchema));
  errors.push(...validateCustomToolCode(tool.code));
  return errors;
};

export const getCustomTools = async (): Promise<CustomToolRecord[]> =>
  (await readRaw()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const getCustomTool = async (idOrName: string): Promise<CustomToolRecord | undefined> => {
  const key = idOrName.trim().toLowerCase();
  return (await readRaw()).find((tool) => tool.id === idOrName || tool.name.toLowerCase() === key);
};

export const saveCustomTool = async (draft: CustomToolDraft): Promise<CustomToolRecord> => {
  const all = await readRaw();
  const normalized = { ...draft, name: normalizeCustomToolName(draft.name) };
  const errors = validateCustomTool(normalized, all);
  if (errors.length) throw new Error(errors.join("\n"));
  const now = new Date().toISOString();
  const existing = draft.id ? all.find((tool) => tool.id === draft.id) : undefined;
  const record: CustomToolRecord = {
    ...normalized,
    id: existing?.id ?? uid(),
    tags: [...new Set(normalized.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))],
    modules: [...new Set(normalized.modules)].filter((module): module is CustomToolModule =>
      CUSTOM_TOOL_MODULES.includes(module as CustomToolModule)
    ),
    testInput: normalized.testInput ?? existing?.testInput ?? {},
    lastTestResult: normalized.lastTestResult ?? existing?.lastTestResult,
    lastTestedAt: normalized.lastTestedAt ?? existing?.lastTestedAt,
    lastTestDomain: normalized.lastTestDomain ?? existing?.lastTestDomain,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  const next = existing ? all.map((tool) => tool.id === record.id ? record : tool) : [...all, record];
  await writeRaw(next);
  return record;
};

export const deleteCustomTool = async (id: string): Promise<void> => {
  await writeRaw((await readRaw()).filter((tool) => tool.id !== id));
};

export const saveCustomToolTestState = async (
  id: string,
  testInput: Record<string, unknown>,
  result: unknown,
  domain: "client" | "server"
): Promise<void> => {
  const tools = await readRaw();
  const testedAt = new Date().toISOString();
  await writeRaw(tools.map((tool) => tool.id === id ? {
    ...tool,
    testInput,
    lastTestResult: result,
    lastTestedAt: testedAt,
    lastTestDomain: domain
  } : tool));
};

type CustomToolSearchResult = Omit<
  CustomToolRecord,
  "code" | "testInput" | "lastTestResult" | "lastTestedAt" | "lastTestDomain"
> & { score: number };

export const searchCustomTools = async (query: string): Promise<CustomToolSearchResult[]> => {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return (await readRaw())
    .filter((tool) => tool.enabled && tool.status === "active")
    .map((tool) => {
      const name = `${tool.name} ${tool.displayName}`.toLowerCase();
      const metadata = `${tool.description} ${tool.tags.join(" ")} ${tool.modules.join(" ")}`.toLowerCase();
      const score = terms.length === 0 ? 1 : terms.reduce((sum, term) =>
        sum + (name.includes(term) ? 8 : 0) + (metadata.includes(term) ? 3 : 0), 0
      );
      const {
        code: _code,
        testInput: _testInput,
        lastTestResult: _lastTestResult,
        lastTestedAt: _lastTestedAt,
        lastTestDomain: _lastTestDomain,
        ...metadataOnly
      } = tool;
      return { ...metadataOnly, score };
    })
    .filter((tool) => tool.score > 0)
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
};

const validateInput = (schema: Record<string, unknown>, input: Record<string, unknown>): string[] => {
  const errors: string[] = [];
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
  for (const field of required) {
    if (input[field] === undefined || input[field] === null || input[field] === "") errors.push(`Missing required input: ${field}`);
  }
  for (const [field, value] of Object.entries(input)) {
    const expected = properties[field]?.type;
    if (!expected || value === null || value === undefined) continue;
    const actual = Array.isArray(value) ? "array" : typeof value;
    if (expected !== actual && !(expected === "integer" && typeof value === "number" && Number.isInteger(value))) {
      errors.push(`Input "${field}" must be ${String(expected)}, got ${actual}.`);
    }
  }
  return errors;
};

export const buildCustomToolExecutionCode = (tool: CustomToolRecord, input: Record<string, unknown>): string => {
  const serializedInput = JSON.stringify(JSON.stringify(input));
  const moduleObject = tool.modules.map((module) => `${module}: ${module}`).join(", ");
  const context = JSON.stringify(JSON.stringify({
    toolName: tool.name,
    displayName: tool.displayName,
    modules: tool.modules,
    executedAt: new Date().toISOString()
  }));
  const invocation = tool.domain === "server"
    ? `(function(input, context) {\n${tool.code}\n})(__customToolInput, __customToolContext)`
    : `(async function(input, context) {\n${tool.code}\n})(__customToolInput, __customToolContext)`;
  return [
    `const __customToolInput = JSON.parse(${serializedInput});`,
    `const __customToolContext = Object.freeze({ ...JSON.parse(${context}), modules: Object.freeze({ ${moduleObject} }) });`,
    `return ${invocation};`
  ].join("\n");
};

const resolveExecutionDomain = (
  configured: CustomToolDomain,
  requested?: Exclude<CustomToolDomain, "both">
): Exclude<CustomToolDomain, "both"> => {
  if (configured === "both") return requested || "client";
  if (requested && requested !== configured) {
    throw new Error(`This tool is restricted to ${configured} execution.`);
  }
  return configured;
};

const runCustomTool = async (
  tool: CustomToolRecord,
  input: Record<string, unknown>,
  requestedDomain?: Exclude<CustomToolDomain, "both">
): Promise<unknown> => {
  const executionDomain = resolveExecutionDomain(tool.domain, requestedDomain);
  const executionTool = { ...tool, domain: executionDomain };
  const response = await callApi(
    executionDomain === "server" ? RequestRoutes.RUN_QUICK_SCRIPT_SERVER : RequestRoutes.RUN_QUICK_SCRIPT,
    { code: buildCustomToolExecutionCode(executionTool, input) }
  );
  const execution = response.message as { result?: unknown; logs?: unknown; error?: unknown };
  if (execution?.error) throw new Error(String(execution.error));
  return { tool: tool.name, executionDomain, result: execution?.result ?? execution, logs: execution?.logs ?? [] };
};

export const executeCustomTool = async (
  idOrName: string,
  input: Record<string, unknown> = {},
  requestedDomain?: Exclude<CustomToolDomain, "both">
): Promise<unknown> => {
  const tool = await getCustomTool(idOrName);
  if (!tool || !tool.enabled || tool.status !== "active") {
    throw new Error(`Active custom tool "${idOrName}" was not found.`);
  }
  const inputErrors = validateInput(tool.inputSchema, input);
  if (inputErrors.length) throw new Error(inputErrors.join("\n"));
  return runCustomTool(tool, input, requestedDomain);
};

/** Execute the editor draft for an explicit user test without activating it for AI routing. */
export const executeCustomToolDraft = async (
  draft: CustomToolDraft,
  input: Record<string, unknown> = {},
  requestedDomain?: Exclude<CustomToolDomain, "both">
): Promise<unknown> => {
  const errors = validateCustomTool(draft);
  if (errors.length) throw new Error(errors.join("\n"));
  const inputErrors = validateInput(draft.inputSchema, input);
  if (inputErrors.length) throw new Error(inputErrors.join("\n"));
  const now = new Date().toISOString();
  const record: CustomToolRecord = {
    ...draft,
    id: draft.id ?? "editor_test",
    testInput: draft.testInput ?? input,
    createdAt: now,
    updatedAt: now
  };
  return runCustomTool(record, input, requestedDomain);
};
