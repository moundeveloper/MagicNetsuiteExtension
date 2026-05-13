// fileVersionsDb.ts — IndexedDB-backed file version history using Dexie.js
import Dexie, { type EntityTable } from "dexie";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface FileVersion {
  id?: number;
  /** NetSuite file internal ID */
  fileId: number;
  /** File name (for display) */
  fileName: string;
  /** Full file content at this point in time */
  content: string;
  /** When this version was saved */
  savedAt: Date;
}

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const MAX_VERSIONS_PER_FILE = 5;

// ─────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────

const db = new Dexie("MagicNetsuiteFileVersions") as Dexie & {
  fileVersions: EntityTable<FileVersion, "id">;
};

db.version(1).stores({
  fileVersions: "++id, fileId, savedAt"
});

// ─────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────

/**
 * Get all versions for a file, newest first.
 */
export const getVersionsForFile = async (fileId: number): Promise<FileVersion[]> => {
  const versions = await db.fileVersions
    .where("fileId")
    .equals(fileId)
    .reverse()
    .sortBy("savedAt");
  return versions;
};

/**
 * Get the count of versions for a file.
 */
export const getVersionCount = async (fileId: number): Promise<number> => {
  return db.fileVersions.where("fileId").equals(fileId).count();
};

/**
 * Save a new version. Returns { saved: true, droppedVersion?: FileVersion }
 * if the oldest version had to be dropped to stay within MAX_VERSIONS_PER_FILE.
 */
export const saveVersion = async (
  fileId: number,
  fileName: string,
  content: string
): Promise<{ saved: true; droppedVersion: FileVersion | null }> => {
  const versions = await getVersionsForFile(fileId);

  let droppedVersion: FileVersion | null = null;

  // If at capacity, remove the oldest
  if (versions.length >= MAX_VERSIONS_PER_FILE) {
    const oldest = versions[versions.length - 1];
    if (oldest?.id) {
      droppedVersion = oldest;
      await db.fileVersions.delete(oldest.id);
    }
  }

  await db.fileVersions.add({
    fileId,
    fileName,
    content,
    savedAt: new Date()
  });

  return { saved: true, droppedVersion };
};

/**
 * Check if saving would drop the oldest version.
 * Returns the version that would be dropped, or null if under the limit.
 */
export const wouldDropVersion = async (fileId: number): Promise<FileVersion | null> => {
  const versions = await getVersionsForFile(fileId);
  if (versions.length >= MAX_VERSIONS_PER_FILE) {
    return versions[versions.length - 1] || null;
  }
  return null;
};

/**
 * Get a specific version by ID.
 */
export const getVersion = async (versionId: number): Promise<FileVersion | undefined> => {
  return db.fileVersions.get(versionId);
};

/**
 * Delete a single version by its primary key.
 */
export const deleteVersion = async (versionId: number): Promise<void> => {
  await db.fileVersions.delete(versionId);
};

/**
 * Delete all versions for a file (used by "commit" to clear history).
 */
export const clearVersionHistory = async (fileId: number): Promise<number> => {
  return db.fileVersions.where("fileId").equals(fileId).delete();
};

/**
 * Revert: returns the content of a specific version.
 * Does NOT modify the database — the caller is responsible for
 * setting editor content and optionally saving.
 */
export const getVersionContent = async (versionId: number): Promise<string | null> => {
  const version = await db.fileVersions.get(versionId);
  return version?.content ?? null;
};

/**
 * Format a version date for display.
 */
export const formatVersionDate = (date: Date): string => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

export { MAX_VERSIONS_PER_FILE };
