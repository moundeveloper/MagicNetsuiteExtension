// aiAssistantDb.ts — IndexedDB-backed storage for AI Assistant View using Dexie.js
import Dexie, { type EntityTable } from "dexie";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface AiChatRecord {
  chatId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: any[];
}

export interface AiAssistantUiStateRecord {
  key: string;
  value: any;
}

// ─────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────

const db = new Dexie("MagicNetsuiteAiAssistant") as Dexie & {
  chats: EntityTable<AiChatRecord, "chatId">;
  uiState: EntityTable<AiAssistantUiStateRecord, "key">;
};

db.version(1).stores({
  chats: "&chatId, title, createdAt, updatedAt",
  uiState: "&key"
});

// ─────────────────────────────────────────────
// Chats CRUD
// ─────────────────────────────────────────────

export const getAllAiChats = async (): Promise<AiChatRecord[]> => {
  return db.chats.orderBy("updatedAt").reverse().toArray();
};

export const getAiChat = async (chatId: string): Promise<AiChatRecord | undefined> => {
  return db.chats.get(chatId);
};

export const upsertAiChat = async (chat: AiChatRecord): Promise<void> => {
  await db.chats.put(chat);
};

export const deleteAiChat = async (chatId: string): Promise<void> => {
  await db.chats.delete(chatId);
};

// ─────────────────────────────────────────────
// UI State
// ─────────────────────────────────────────────

export const getAiAssistantUiState = async <T>(
  key: string,
  defaultValue: T
): Promise<T> => {
  const record = await db.uiState.get(key);
  return record !== undefined ? (record.value as T) : defaultValue;
};

export const setAiAssistantUiState = async (
  key: string,
  value: any
): Promise<void> => {
  await db.uiState.put({ key, value });
};

export { db as aiAssistantDb };
