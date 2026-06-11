// apiTesterDb.ts — IndexedDB-backed storage for API Tester View using Dexie.js
import Dexie, { type EntityTable } from "dexie";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface KVRowRecord {
  key: string;
  value: string;
}

export interface KVBodyRowRecord {
  key: string;
  value: string;
  type: "string" | "number" | "boolean" | "null" | "array" | "array(number)";
}

export interface ApiRequestRecord {
  requestId: string;
  name: string;
  method: string;
  url: string;
  params: KVRowRecord[];
  headers: KVRowRecord[];
  body: string;
  bodyType: string;
  createdAt: string;
  updatedAt: string;
  /** Internal ID of the associated NetSuite script (for log filtering) */
  scriptInternalId?: number | null;
  /** Script type: "RESTLET" | "SCRIPTLET" | null */
  scriptType?: string | null;
  /** Human-readable script name (e.g. "My RESTlet") */
  scriptName?: string | null;
  /** Deployment script ID (e.g. "customdeploy_my_restlet_1") */
  deploymentScriptId?: string | null;
  /** File cabinet internal ID of the script file (for UPDATE_FILE_CONTENT) */
  scriptFileId?: number | null;
  /** Folder ID of the script file (required by updateNetsuiteFileContent) */
  scriptFileFolderId?: number | null;
  /** Key-value pairs for the "key-value (JSON)" body type */
  bodyKv?: KVBodyRowRecord[];
}

/** Generic key-value store for UI state (openTabs, activeTab) */
export interface ApiTesterUiStateRecord {
  key: string;
  value: any;
}

/** Persisted request history entry */
export interface RequestHistoryRecord {
  /** UUID primary key */
  id: string;
  method: string;
  /** Final URL including query params (for display); base URL for body methods */
  url: string;
  /** Unix timestamp (ms) when the request was sent */
  timestamp: number;
  /** HTTP status code, or null if the request failed before a response */
  status: number | null;
  /** Full HTTP response snapshot */
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    duration: number;
    url: string;
    error?: string;
  } | null;
  /** Script execution logs (populated async after the request) */
  logs: Array<{
    id: string;
    datetime: string;
    title: string;
    level: string;
    message: string;
    scriptName: string;
    deploymentName: string;
  }> | null;
  params: KVRowRecord[];
  headers: KVRowRecord[];
  body: string;
  bodyType: string;
  /** Key-value body rows at send time */
  bodyKv?: KVBodyRowRecord[];
  scriptName: string | null;
}

/** Persisted NetSuite internal API tester history entry */
export interface NetsuiteApiHistoryRecord {
  id: string;
  route: string;
  params: Record<string, any>;
  status: "ok" | "error";
  duration: number;
  message: any;
  timestamp: number;
}

// ─────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────

const db = new Dexie("MagicNetsuiteApiTester") as Dexie & {
  requests: EntityTable<ApiRequestRecord, "requestId">;
  uiState: EntityTable<ApiTesterUiStateRecord, "key">;
  requestHistory: EntityTable<RequestHistoryRecord, "id">;
  netsuiteApiHistory: EntityTable<NetsuiteApiHistoryRecord, "id">;
};

db.version(1).stores({
  requests: "&requestId, name, createdAt, updatedAt",
  uiState: "&key"
});

db.version(2).stores({
  requests: "&requestId, name, createdAt, updatedAt",
  uiState: "&key",
  requestHistory: "&id, timestamp"
});

db.version(3).stores({
  requests: "&requestId, name, createdAt, updatedAt",
  uiState: "&key",
  requestHistory: "&id, timestamp",
  netsuiteApiHistory: "&id, timestamp, route"
});

// ─────────────────────────────────────────────
// Request CRUD
// ─────────────────────────────────────────────

export const getAllApiRequests = async (): Promise<ApiRequestRecord[]> => {
  return db.requests.orderBy("createdAt").toArray();
};

export const upsertApiRequest = async (req: ApiRequestRecord): Promise<void> => {
  await db.requests.put(req);
};

export const bulkUpsertApiRequests = async (reqs: ApiRequestRecord[]): Promise<void> => {
  await db.requests.bulkPut(reqs);
};

export const deleteApiRequest = async (requestId: string): Promise<void> => {
  await db.requests.delete(requestId);
};

// ─────────────────────────────────────────────
// UI State
// ─────────────────────────────────────────────

export const getApiTesterUiState = async <T>(key: string, defaultValue: T): Promise<T> => {
  const record = await db.uiState.get(key);
  return record !== undefined ? (record.value as T) : defaultValue;
};

export const setApiTesterUiState = async (key: string, value: any): Promise<void> => {
  await db.uiState.put({ key, value });
};

// ─────────────────────────────────────────────
// Request History CRUD
// ─────────────────────────────────────────────

const MAX_HISTORY_ENTRIES = 100;

/**
 * Persist a history entry, then prune oldest entries beyond MAX_HISTORY_ENTRIES.
 */
export const addRequestHistoryEntry = async (entry: RequestHistoryRecord): Promise<void> => {
  await db.requestHistory.put(entry);
  const count = await db.requestHistory.count();
  if (count > MAX_HISTORY_ENTRIES) {
    const overflow = count - MAX_HISTORY_ENTRIES;
    const oldest = await db.requestHistory
      .orderBy("timestamp")
      .limit(overflow)
      .toArray();
    await db.requestHistory.bulkDelete(oldest.map((e) => e.id));
  }
};

/**
 * Load all history entries, newest first (capped at MAX_HISTORY_ENTRIES).
 */
export const getAllRequestHistory = async (): Promise<RequestHistoryRecord[]> => {
  return db.requestHistory.orderBy("timestamp").reverse().toArray();
};

/**
 * Delete a single history entry by its UUID.
 */
export const deleteRequestHistoryEntry = async (id: string): Promise<void> => {
  await db.requestHistory.delete(id);
};

/**
 * Delete all history entries.
 */
export const clearRequestHistory = async (): Promise<void> => {
  await db.requestHistory.clear();
};

/**
 * Update the logs field of an existing history entry (called after async log fetch).
 */
export const updateRequestHistoryLogs = async (
  id: string,
  logs: RequestHistoryRecord["logs"]
): Promise<void> => {
  await db.requestHistory.where("id").equals(id).modify({ logs });
};

// ─────────────────────────────────────────────
// NetSuite API Tester History CRUD
// ─────────────────────────────────────────────

export const addNetsuiteApiHistoryEntry = async (
  entry: NetsuiteApiHistoryRecord
): Promise<void> => {
  await db.netsuiteApiHistory.put(entry);
  const count = await db.netsuiteApiHistory.count();
  if (count > MAX_HISTORY_ENTRIES) {
    const overflow = count - MAX_HISTORY_ENTRIES;
    const oldest = await db.netsuiteApiHistory
      .orderBy("timestamp")
      .limit(overflow)
      .toArray();
    await db.netsuiteApiHistory.bulkDelete(oldest.map((e) => e.id));
  }
};

export const getAllNetsuiteApiHistory = async (): Promise<NetsuiteApiHistoryRecord[]> => {
  return db.netsuiteApiHistory.orderBy("timestamp").reverse().toArray();
};

export const deleteNetsuiteApiHistoryEntry = async (id: string): Promise<void> => {
  await db.netsuiteApiHistory.delete(id);
};

export const clearNetsuiteApiHistory = async (): Promise<void> => {
  await db.netsuiteApiHistory.clear();
};
