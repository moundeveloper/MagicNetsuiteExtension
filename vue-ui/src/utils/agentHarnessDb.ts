// agentHarnessDb.ts — persistence for the NetSuite agent harness
import Dexie, { type EntityTable } from "dexie";
import { isRef, toRaw, unref } from "vue";

export type HarnessPermissionMode = "read" | "build" | "release";
export type HarnessItemKind = "message" | "tool" | "approval" | "system";
export type HarnessItemStatus = "pending" | "running" | "done" | "error" | "rejected";
export type HarnessRole = "user" | "assistant" | "tool" | "system";

export interface HarnessAttachment {
  name: string;
  type: "text" | "pdf";
  content: string;
  size: number;
  source?: "upload" | "record" | "filecabinet";
  sourceId?: string;
  sourceType?: string;
}

export interface HarnessThreadRecord {
  threadId: string;
  title: string;
  profileId: string;
  permissionMode: HarnessPermissionMode;
  environment: string;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessAgentRecord {
  id: string;
  name: string;
  shortName: string;
  icon: string;
  color: string;
  description: string;
  defaultPermissionMode: HarnessPermissionMode;
  toolsets: string[];
  enabledToolNames?: string[];
  maxSteps: number;
  systemFocus: string;
  builtIn?: boolean;
  enabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HarnessItemRecord {
  id: string;
  threadId: string;
  turnId: string;
  kind: HarnessItemKind;
  role?: HarnessRole;
  title?: string;
  content: string;
  status: HarnessItemStatus;
  profileId?: string;
  attachments?: HarnessAttachment[];
  toolName?: string;
  toolInput?: unknown;
  latencyMs?: number;
  risk?: "none" | "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
}

export interface HarnessUiStateRecord {
  key: string;
  value: unknown;
}

const db = new Dexie("MagicNetsuiteAgentHarness") as Dexie & {
  agents: EntityTable<HarnessAgentRecord, "id">;
  threads: EntityTable<HarnessThreadRecord, "threadId">;
  items: EntityTable<HarnessItemRecord, "id">;
  uiState: EntityTable<HarnessUiStateRecord, "key">;
};

db.version(1).stores({
  threads: "&threadId, updatedAt, profileId, environment",
  items: "&id, threadId, turnId, kind, status, toolName, createdAt",
  uiState: "&key",
});

db.version(2).stores({
  agents: "&id, name, updatedAt, enabled",
  threads: "&threadId, updatedAt, profileId, environment",
  items: "&id, threadId, turnId, kind, status, toolName, createdAt",
  uiState: "&key",
});

const toStorageValue = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (isRef(value)) return toStorageValue(unref(value), seen);

  const raw = value !== null && typeof value === "object" ? toRaw(value) : value;

  if (
    raw === null ||
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean"
  ) {
    return raw;
  }

  if (raw === undefined) return undefined;
  if (typeof raw === "bigint") return raw.toString();
  if (typeof raw === "symbol") return raw.toString();
  if (typeof raw === "function") return `[Function ${raw.name || "anonymous"}]`;

  if (raw instanceof Date) return raw.toISOString();
  if (raw instanceof Error) {
    return {
      name: raw.name,
      message: raw.message,
      stack: raw.stack,
    };
  }

  if (typeof File !== "undefined" && raw instanceof File) {
    return {
      name: raw.name,
      size: raw.size,
      type: raw.type,
      lastModified: raw.lastModified,
    };
  }

  if (typeof Blob !== "undefined" && raw instanceof Blob) {
    return {
      size: raw.size,
      type: raw.type,
    };
  }

  if (Array.isArray(raw)) {
    if (seen.has(raw)) return "[Circular]";
    seen.add(raw);
    return raw.map((entry) => toStorageValue(entry, seen));
  }

  if (raw && typeof raw === "object") {
    if (seen.has(raw)) return "[Circular]";
    seen.add(raw);

    const plain: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
      const normalized = toStorageValue(entry, seen);
      if (normalized !== undefined) plain[key] = normalized;
    }
    return plain;
  }

  return String(raw);
};

const toStorageRecord = <T>(value: T): T => toStorageValue(value) as T;

export const getHarnessAgents = async (): Promise<HarnessAgentRecord[]> =>
  db.agents.orderBy("updatedAt").reverse().toArray();

export const getHarnessAgent = async (
  id: string
): Promise<HarnessAgentRecord | undefined> => db.agents.get(id);

export const upsertHarnessAgent = async (
  agent: HarnessAgentRecord
): Promise<void> => {
  await db.agents.put(toStorageRecord(agent));
};

export const bulkPutHarnessAgents = async (
  agents: HarnessAgentRecord[]
): Promise<void> => {
  if (agents.length > 0) {
    await db.agents.bulkPut(agents.map((agent) => toStorageRecord(agent)));
  }
};

export const deleteHarnessAgent = async (id: string): Promise<void> => {
  await db.agents.delete(id);
};

export const getHarnessThreads = async (): Promise<HarnessThreadRecord[]> =>
  db.threads.orderBy("updatedAt").reverse().toArray();

export const getHarnessThread = async (
  threadId: string
): Promise<HarnessThreadRecord | undefined> => db.threads.get(threadId);

export const upsertHarnessThread = async (
  thread: HarnessThreadRecord
): Promise<void> => {
  await db.threads.put(toStorageRecord(thread));
};

export const deleteHarnessThread = async (threadId: string): Promise<void> => {
  await db.transaction("rw", db.threads, db.items, async () => {
    await db.items.where("threadId").equals(threadId).delete();
    await db.threads.delete(threadId);
  });
};

export const getHarnessItems = async (
  threadId: string
): Promise<HarnessItemRecord[]> =>
  db.items.where("threadId").equals(threadId).sortBy("createdAt");

export const putHarnessItem = async (
  item: HarnessItemRecord
): Promise<void> => {
  await db.items.put(toStorageRecord(item));
};

export const bulkPutHarnessItems = async (
  items: HarnessItemRecord[]
): Promise<void> => {
  if (items.length > 0) {
    await db.items.bulkPut(items.map((item) => toStorageRecord(item)));
  }
};

export const replaceHarnessItems = async (
  threadId: string,
  items: HarnessItemRecord[]
): Promise<void> => {
  await db.transaction("rw", db.items, async () => {
    await db.items.where("threadId").equals(threadId).delete();
    if (items.length > 0) {
      await db.items.bulkPut(items.map((item) => toStorageRecord(item)));
    }
  });
};

export const clearHarnessItems = async (threadId: string): Promise<void> => {
  await db.items.where("threadId").equals(threadId).delete();
};

export const getHarnessUiState = async <T>(
  key: string,
  defaultValue: T
): Promise<T> => {
  const record = await db.uiState.get(key);
  return record === undefined ? defaultValue : (record.value as T);
};

export const setHarnessUiState = async (
  key: string,
  value: unknown
): Promise<void> => {
  await db.uiState.put({ key, value: toStorageValue(value) });
};

export { db as agentHarnessDb };
