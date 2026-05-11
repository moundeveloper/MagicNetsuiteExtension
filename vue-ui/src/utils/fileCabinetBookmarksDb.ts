// fileCabinetBookmarksDb.ts — IndexedDB-backed bookmarks for file cabinet items
import Dexie, { type EntityTable } from "dexie";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface Bookmark {
  id?: number;
  /** NetSuite environment domain (e.g. "1234567.app.netsuite.com") */
  environment: string;
  /** "file" or "folder" */
  itemType: "file" | "folder";
  /** NetSuite internal ID */
  netsuiteId: number;
  /** Display name at bookmark time */
  name: string;
  /** Parent folder internal ID */
  parentFolderId: number | null;
  /** Parent folder display name (for context) */
  parentFolderName: string;
  /** NetSuite file type (e.g. JAVASCRIPT) — undefined for folders */
  filetype?: string;
  /** Relative file URL — undefined for folders */
  url?: string;
  /** When the bookmark was created */
  bookmarkedAt: Date;
  /**
   * Existence check result:
   *   undefined / null = never checked
   *   true  = item confirmed to exist in NetSuite
   *   false = item no longer found in NetSuite
   */
  exists?: boolean | null;
  /** When the last existence check was run */
  lastCheckedAt?: Date;
}

// ─────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────

const db = new Dexie("MagicNetsuiteFileCabinetBookmarks") as Dexie & {
  bookmarks: EntityTable<Bookmark, "id">;
};

db.version(1).stores({
  bookmarks: "++id, environment, itemType, netsuiteId, bookmarkedAt"
});

// ─────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────

/**
 * Add a new bookmark. Returns the local DB id.
 */
export const addBookmark = async (
  item: Omit<Bookmark, "id" | "bookmarkedAt" | "exists" | "lastCheckedAt">
): Promise<number> => {
  const id = await db.bookmarks.add({
    ...item,
    bookmarkedAt: new Date(),
    exists: null
  });
  return id!;
};

/**
 * Remove a bookmark by its local DB id.
 */
export const removeBookmark = async (id: number): Promise<void> => {
  await db.bookmarks.delete(id);
};

/**
 * Remove a bookmark by NetSuite ID + environment.
 */
export const removeBookmarkByNetsuiteId = async (
  environment: string,
  netsuiteId: number
): Promise<void> => {
  await db.bookmarks
    .where("environment")
    .equals(environment)
    .and((b) => b.netsuiteId === netsuiteId)
    .delete();
};

/**
 * Get all bookmarks for an environment, ordered by bookmarkedAt ascending.
 */
export const getBookmarks = async (environment: string): Promise<Bookmark[]> => {
  return db.bookmarks
    .where("environment")
    .equals(environment)
    .sortBy("bookmarkedAt");
};

/**
 * Find a bookmark by NetSuite ID + environment. Returns undefined if not bookmarked.
 */
export const getBookmarkByNetsuiteId = async (
  environment: string,
  netsuiteId: number
): Promise<Bookmark | undefined> => {
  return db.bookmarks
    .where("environment")
    .equals(environment)
    .and((b) => b.netsuiteId === netsuiteId)
    .first();
};

/**
 * Check if an item is currently bookmarked.
 */
export const isBookmarked = async (
  environment: string,
  netsuiteId: number
): Promise<boolean> => {
  const count = await db.bookmarks
    .where("environment")
    .equals(environment)
    .and((b) => b.netsuiteId === netsuiteId)
    .count();
  return count > 0;
};

/**
 * Update the existence check result for a bookmark.
 */
export const updateBookmarkExists = async (
  id: number,
  exists: boolean
): Promise<void> => {
  await db.bookmarks.update(id, { exists, lastCheckedAt: new Date() });
};
