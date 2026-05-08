// fileCabinetTrashDb.ts — IndexedDB-backed trash for deleted file cabinet items
import Dexie, { type EntityTable } from "dexie";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface TrashedItem {
  id?: number;
  /** NetSuite environment domain (e.g. "1234567.app.netsuite.com") */
  environment: string;
  /** "file" or "folder" */
  itemType: "file" | "folder";
  /** NetSuite internal ID of the deleted item */
  netsuiteId: number;
  /** Display name */
  name: string;
  /** Parent folder ID where the item lived */
  originalFolderId: number | null;
  /** Parent folder name (for display) */
  originalFolderName: string;
  /** File content (text files only — null for folders and binary files) */
  content: string | null;
  /** NetSuite file type (e.g. JAVASCRIPT, PLAINTEXT) — null for folders */
  fileType: string | null;
  /** File size in bytes — null for folders */
  fileSize: number | null;
  /** When the item was deleted (trashed) */
  deletedAt: Date;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

/** Items auto-purge after this many days */
const AUTO_PURGE_DAYS = 15;

// ─────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────

const db = new Dexie("MagicNetsuiteFileCabinetTrash") as Dexie & {
  trashedItems: EntityTable<TrashedItem, "id">;
};

db.version(1).stores({
  trashedItems: "++id, environment, itemType, netsuiteId, deletedAt"
});

// ─────────────────────────────────────────────
// Auto-purge
// ─────────────────────────────────────────────

/**
 * Remove items older than AUTO_PURGE_DAYS for a given environment.
 * Call this on mount / before displaying the trash.
 */
export const autoPurgeTrash = async (environment: string): Promise<number> => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - AUTO_PURGE_DAYS);

  const toDelete = await db.trashedItems
    .where("environment")
    .equals(environment)
    .filter((item) => item.deletedAt < cutoff)
    .primaryKeys();

  if (toDelete.length > 0) {
    await db.trashedItems.bulkDelete(toDelete);
  }
  return toDelete.length;
};

// ─────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────

/**
 * Move an item to trash (store locally before NetSuite deletion).
 */
export const trashItem = async (item: Omit<TrashedItem, "id" | "deletedAt">): Promise<number> => {
  const id = await db.trashedItems.add({
    ...item,
    deletedAt: new Date()
  });
  return id!;
};

/**
 * Get all trashed items for an environment, newest first.
 */
export const getTrashedItems = async (environment: string): Promise<TrashedItem[]> => {
  return db.trashedItems
    .where("environment")
    .equals(environment)
    .reverse()
    .sortBy("deletedAt");
};

/**
 * Get a single trashed item by its local DB id.
 */
export const getTrashedItem = async (id: number): Promise<TrashedItem | undefined> => {
  return db.trashedItems.get(id);
};

/**
 * Remove a single item from trash (after restore or permanent delete).
 */
export const removeFromTrash = async (id: number): Promise<void> => {
  await db.trashedItems.delete(id);
};

/**
 * Empty all trash for an environment.
 */
export const emptyTrash = async (environment: string): Promise<number> => {
  const keys = await db.trashedItems
    .where("environment")
    .equals(environment)
    .primaryKeys();
  await db.trashedItems.bulkDelete(keys);
  return keys.length;
};

/**
 * Get the count of trashed items for an environment.
 */
export const getTrashCount = async (environment: string): Promise<number> => {
  return db.trashedItems
    .where("environment")
    .equals(environment)
    .count();
};

/**
 * Format the time remaining before auto-purge.
 */
export const formatTimeRemaining = (deletedAt: Date): string => {
  const expiresAt = new Date(deletedAt);
  expiresAt.setDate(expiresAt.getDate() + AUTO_PURGE_DAYS);

  const now = new Date();
  const diffMs = expiresAt.getTime() - now.getTime();

  if (diffMs <= 0) return "expired";

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h left`;
  return "< 1h left";
};

export { AUTO_PURGE_DAYS };
