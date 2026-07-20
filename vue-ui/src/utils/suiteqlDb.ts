// suiteqlDb.ts — IndexedDB-backed storage for SuiteQL View using Dexie.js
import Dexie, { type EntityTable } from "dexie";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface QueryFileRecord {
  fileId: string;
  name: string;
  code: string;
  createdAt: string;
  updatedAt: string;
}

/** Generic key-value store for query tabs and schema-panel preferences. */
export interface SuiteQLUiStateRecord {
  key: string;
  value: any;
}

type LegacySqlChatSessionRecord = {
  sessionId: string;
  fileId: string;
  name: string;
  createdAt: string;
  messages: any[];
  agentHistory: any[];
}

// ─────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────

const db = new Dexie("MagicNetsuiteSuiteQL") as Dexie & {
  queryFiles: EntityTable<QueryFileRecord, "fileId">;
  uiState: EntityTable<SuiteQLUiStateRecord, "key">;
  chatSessions: EntityTable<LegacySqlChatSessionRecord, "sessionId">;
};

db.version(1).stores({
  queryFiles: "&fileId, name, createdAt, updatedAt",
  uiState: "&key",
  chatSessions: "&sessionId, fileId, createdAt"
});

// ─────────────────────────────────────────────
// Query Files CRUD
// ─────────────────────────────────────────────

export const getAllQueryFiles = async (): Promise<QueryFileRecord[]> => {
  return db.queryFiles.toArray();
};

export const upsertQueryFile = async (
  file: QueryFileRecord
): Promise<void> => {
  await db.queryFiles.put(file);
};

export const deleteQueryFile = async (fileId: string): Promise<void> => {
  await db.queryFiles.delete(fileId);
};

export const bulkUpsertQueryFiles = async (
  files: QueryFileRecord[]
): Promise<void> => {
  await db.queryFiles.bulkPut(files);
};

// ─────────────────────────────────────────────
// UI State
// ─────────────────────────────────────────────

export const getUiState = async <T>(key: string, defaultValue: T): Promise<T> => {
  const record = await db.uiState.get(key);
  return record !== undefined ? (record.value as T) : defaultValue;
};

export const setUiState = async (key: string, value: any): Promise<void> => {
  await db.uiState.put({ key, value });
};

export { db as suiteqlDb };
