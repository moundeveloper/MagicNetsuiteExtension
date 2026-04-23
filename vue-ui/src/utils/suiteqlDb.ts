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

/** Generic key-value store for UI state (openTabs, activeTab, aiEditorOpenTabs, aiPanelWidth) */
export interface SuiteQLUiStateRecord {
  key: string;
  value: any;
}

export interface SqlChatSessionRecord {
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
  chatSessions: EntityTable<SqlChatSessionRecord, "sessionId">;
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

// ─────────────────────────────────────────────
// Chat Sessions CRUD
// ─────────────────────────────────────────────

export const getChatSessionsForFile = async (
  fileId: string
): Promise<SqlChatSessionRecord[]> => {
  return db.chatSessions
    .where("fileId")
    .equals(fileId)
    .reverse()
    .sortBy("createdAt")
    .then((sessions) => sessions.reverse());
};

export const upsertChatSession = async (
  session: SqlChatSessionRecord
): Promise<void> => {
  await db.chatSessions.put(session);
};

export const deleteChatSession = async (sessionId: string): Promise<void> => {
  await db.chatSessions.delete(sessionId);
};

export const deleteChatSessionsForFile = async (
  fileId: string
): Promise<void> => {
  await db.chatSessions.where("fileId").equals(fileId).delete();
};

export { db as suiteqlDb };
