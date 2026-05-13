// apiTesterDb.ts — IndexedDB-backed storage for API Tester View using Dexie.js
import Dexie, { type EntityTable } from "dexie";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface KVRowRecord {
  key: string;
  value: string;
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
}

/** Generic key-value store for UI state (openTabs, activeTab) */
export interface ApiTesterUiStateRecord {
  key: string;
  value: any;
}

// ─────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────

const db = new Dexie("MagicNetsuiteApiTester") as Dexie & {
  requests: EntityTable<ApiRequestRecord, "requestId">;
  uiState: EntityTable<ApiTesterUiStateRecord, "key">;
};

db.version(1).stores({
  requests: "&requestId, name, createdAt, updatedAt",
  uiState: "&key"
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
