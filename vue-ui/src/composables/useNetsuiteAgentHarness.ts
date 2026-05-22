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
import { callApi, getNetsuiteEnvironment } from "../utils/api";
import { RequestRoutes } from "../types/request";
import {
  bulkPutHarnessItems,
  clearHarnessItems,
  deleteHarnessThread,
  getHarnessItems,
  getHarnessThreads,
  getHarnessUiState,
  putHarnessItem,
  replaceHarnessItems,
  setHarnessUiState,
  upsertHarnessThread,
  type HarnessAttachment,
  type HarnessItemRecord,
  type HarnessItemStatus,
  type HarnessPermissionMode,
  type HarnessThreadRecord,
} from "../utils/agentHarnessDb";

type HarnessRisk = "none" | "low" | "medium" | "high";
type HarnessToolsetId =
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
  toolsets: HarnessToolsetId[];
  maxSteps: number;
  systemFocus: string;
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

export const HARNESS_PROFILES: HarnessProfile[] = [
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
      "Explore the account safely. Find the smallest reliable NetSuite source of truth, cite IDs and tool evidence, and avoid write actions.",
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
  },
];

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

const formatMessageContent = (
  content: string,
  attachments?: HarnessAttachment[]
): string => {
  if (!attachments || attachments.length === 0) return content;
  const attachmentContext = attachments
    .map((attachment) => {
      const label =
        attachment.type === "pdf"
          ? `[PDF file: ${attachment.name}]`
          : `[File: ${attachment.name}]`;
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

const toExternalTool = (tool: HarnessTool) => ({
  type: "function" as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
});

const isWriteLikeToolName = (name: string): boolean =>
  /(upload|create|delete|remove|run|open|submit|deploy|write|patch|cache_upload|generate_pdf)/i.test(
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
      "netsuite_context_snapshot",
      "netsuite_get_current_user",
      "netsuite_get_current_record",
    ].includes(name)
  ) {
    ids.add("context");
  }
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
    "Get the active NetSuite account host, connection health, harness profile, permission mode, and timestamp. Use this when account context is uncertain before selecting account-specific tools.",
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
      profile: getProfile().name,
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
    ...createSqlAiTools(),
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

ACTIVE PROFILE
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
- For record IDs, never assume a file ID equals a record/entity ID. Resolve relationships first.
- For docs, use official NetSuite documentation tools. Do not answer NetSuite product rules from stale model memory.
- For bundles, list bundles before inspecting components unless a bundle ID is already known.
- For uploads, generated scripts, and report files, store and verify cache content before writing to NetSuite.

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

  const threads = ref<HarnessThreadRecord[]>([]);
  const activeThreadId = ref<string | null>(null);
  const items = ref<HarnessItemRecord[]>([]);
  const activeProfileId = ref("navigator");
  const permissionMode = ref<HarnessPermissionMode>("read");
  const environment = ref("unknown");
  const connectionStatus = ref<"unknown" | "checking" | "connected" | "disconnected" | "error">("unknown");
  const loading = ref(false);
  const error = ref<unknown>(null);
  const telemetry = ref<HarnessTelemetryEntry[]>([]);
  const activeController = ref<AbortController | null>(null);

  const activeProfile = computed(
    () =>
      HARNESS_PROFILES.find((profile) => profile.id === activeProfileId.value) ??
      HARNESS_PROFILES[0]!
  );

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
    return toolCatalog.value.filter((tool) => {
      const inProfile = tool.toolsetIds.some((id) => allowedSets.has(id));
      if (!inProfile) return false;
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
    const profile =
      HARNESS_PROFILES.find((p) => p.id === profileId) ?? HARNESS_PROFILES[0]!;
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
    await saveUiState();
    await updateThreadList();
    return thread;
  };

  const loadThread = async (threadId: string) => {
    const thread = threads.value.find((t) => t.threadId === threadId);
    if (!thread) return;
    activeThreadId.value = threadId;
    activeProfileId.value = thread.profileId;
    permissionMode.value = thread.permissionMode;
    items.value = await getHarnessItems(threadId);
    await saveUiState();
  };

  const removeThread = async (threadId: string) => {
    await deleteHarnessThread(threadId);
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
    const profile = HARNESS_PROFILES.find((p) => p.id === profileId);
    if (!profile) return;
    activeProfileId.value = profileId;
    permissionMode.value = profile.defaultPermissionMode;
    await saveUiState();
    await touchActiveThread();
  };

  const setPermissionMode = async (mode: HarnessPermissionMode) => {
    permissionMode.value = mode;
    await saveUiState();
    await touchActiveThread();
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
    turnId: string
  ): Promise<ChatMessage> => {
    const toolName = call.function.name;
    const tool = selectedTools.value.find((candidate) => candidate.name === toolName);
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
      const content = stringifyResult(result);
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
        error: `Tool "${toolName}" is not available in the active profile or permission mode.`,
      });
    }

    const validationError = validateRequired(tool, args);
    if (validationError) {
      return finish("error", { error: validationError }, tool.risk);
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
    turnId: string
  ): Promise<ChatMessage[]> => {
    const allReadOnly = calls.every((call) => {
      const tool = selectedTools.value.find((candidate) => candidate.name === call.function.name);
      return tool?.readOnly && permissionFor(tool, permissionMode.value) === "allow";
    });

    if (allReadOnly && calls.length > 1) {
      const indexed = await Promise.all(
        calls.map(async (call, index) => ({
          index,
          message: await executeToolCall(call, turnId),
        }))
      );
      return indexed.sort((a, b) => a.index - b.index).map((entry) => entry.message);
    }

    const outputs: ChatMessage[] = [];
    for (const call of calls) {
      outputs.push(await executeToolCall(call, turnId));
    }
    return outputs;
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
    const attachments = options.attachments?.filter((attachment) => attachment.content.trim());
    if ((!cleanPrompt && (!attachments || attachments.length === 0)) || loading.value) return;
    if (!activeThread.value) await createThread(activeProfileId.value);

    loading.value = true;
    error.value = null;
    const turnId = uid("turn");
    const controller = new AbortController();
    activeController.value = controller;

    try {
      const userItem = await appendItem({
        threadId: activeThreadId.value!,
        turnId,
        kind: "message",
        role: "user",
        content: cleanPrompt,
        attachments,
        status: "done",
        profileId: activeProfileId.value,
      });

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
        { role: "user", content: formatMessageContent(cleanPrompt, attachments) },
      ];
      const externalTools = selectedTools.value.map(toExternalTool);

      for (let step = 0; step < activeProfile.value.maxSteps; step++) {
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

        const response = await chatCompletion(runtimeMessages, {
          tools: externalTools,
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

        if (streamFlushTimer !== null) {
          window.clearTimeout(streamFlushTimer);
          streamFlushTimer = null;
        }

        const assistantText = response.content ?? streamed;
        const toolCalls = response.tool_calls ?? [];

        if (toolCalls.length === 0) {
          await updateItem(assistantItem.id, {
            content: assistantText || "[no response]",
            status: "done",
          });
          runtimeMessages.push({
            role: "assistant",
            content: assistantText || "[no response]",
          });
          await touchActiveThread();
          return;
        }

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

        const toolOutputs = await executeToolCalls(toolCalls, turnId);
        runtimeMessages.push(...toolOutputs);
      }

      await appendItem({
        threadId: activeThreadId.value!,
        turnId,
        kind: "system",
        role: "system",
        title: "Step limit reached",
        content:
          "The harness reached the profile step limit before producing a final answer. Try narrowing the request or switching to a more capable model.",
        status: "error",
        profileId: activeProfileId.value,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
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
        await appendItem({
          threadId: activeThreadId.value!,
          turnId,
          kind: "system",
          role: "system",
          title: "Harness error",
          content: String(err),
          status: "error",
          profileId: activeProfileId.value,
        });
      }
    } finally {
      loading.value = false;
      activeController.value = null;
      await touchActiveThread();
    }
  };

  const stop = () => {
    activeController.value?.abort();
  };

  const clearThread = async () => {
    if (!activeThreadId.value) return;
    await clearHarnessItems(activeThreadId.value);
    items.value = [];
    telemetry.value = [];
    await touchActiveThread({ title: "Untitled harness run" });
  };

  const initialize = async () => {
    await updateThreadList();
    activeProfileId.value = await getHarnessUiState(
      UI_ACTIVE_PROFILE_KEY,
      "navigator"
    );
    permissionMode.value = await getHarnessUiState<HarnessPermissionMode>(
      UI_PERMISSION_MODE_KEY,
      HARNESS_PROFILES.find((p) => p.id === activeProfileId.value)?.defaultPermissionMode ??
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
    setActiveProfile,
    setPermissionMode,
    threads: readonly(threads),
    activeThread: readonly(activeThread),
    items: readonly(items),
    profiles: HARNESS_PROFILES,
    toolsets: HARNESS_TOOLSETS,
    activeProfile,
    activeProfileId: readonly(activeProfileId),
    permissionMode: readonly(permissionMode),
    activeToolsets,
    selectedTools,
    lastEvidence,
    telemetry: readonly(telemetry),
    loading: readonly(loading),
    error: readonly(error),
    environment: readonly(environment),
    connectionStatus: readonly(connectionStatus),
    providerLabel,
  };
};
