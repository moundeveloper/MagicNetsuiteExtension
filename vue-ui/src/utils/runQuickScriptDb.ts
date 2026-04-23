// runQuickScriptDb.ts — IndexedDB-backed storage for Run Quick Script View using Dexie.js
import Dexie, { type EntityTable } from "dexie";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface ScriptFileRecord {
  fileId: string;
  name: string;
  code: string;
  createdAt: string;
  updatedAt: string;
}

export interface RQSUiStateRecord {
  key: string;
  value: any;
}

// ─────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────

const db = new Dexie("MagicNetsuiteRunQuickScript") as Dexie & {
  scriptFiles: EntityTable<ScriptFileRecord, "fileId">;
  uiState: EntityTable<RQSUiStateRecord, "key">;
};

db.version(1).stores({
  scriptFiles: "&fileId, name, createdAt, updatedAt",
  uiState: "&key"
});

// ─────────────────────────────────────────────
// Script Files CRUD
// ─────────────────────────────────────────────

export const getAllScriptFiles = async (): Promise<ScriptFileRecord[]> => {
  return db.scriptFiles.toArray();
};

export const upsertScriptFile = async (
  file: ScriptFileRecord
): Promise<void> => {
  await db.scriptFiles.put(file);
};

export const deleteScriptFile = async (fileId: string): Promise<void> => {
  await db.scriptFiles.delete(fileId);
};

export const bulkUpsertScriptFiles = async (
  files: ScriptFileRecord[]
): Promise<void> => {
  await db.scriptFiles.bulkPut(files);
};

// ─────────────────────────────────────────────
// UI State
// ─────────────────────────────────────────────

export const getRQSUiState = async <T>(key: string, defaultValue: T): Promise<T> => {
  const record = await db.uiState.get(key);
  return record !== undefined ? (record.value as T) : defaultValue;
};

export const setRQSUiState = async (key: string, value: any): Promise<void> => {
  await db.uiState.put({ key, value });
};

export { db as runQuickScriptDb };
