import Dexie, { type EntityTable } from "dexie";

export type NotebookEntryType =
  | "note"
  | "record"
  | "script"
  | "query"
  | "file"
  | "docs"
  | "link";

export interface NotebookEntry {
  id: string;
  type: NotebookEntryType;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  url: string;
  netsuiteId: string;
  recordType: string;
  scriptId: string;
  filePath: string;
  code: string;
  group: string;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

const db = new Dexie("MagicNetsuiteNotebook") as Dexie & {
  entries: EntityTable<NotebookEntry, "id">;
};

db.version(1).stores({
  entries: "&id, type, title, group, pinned, archived, createdAt, updatedAt"
});

const newId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `note_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

const normalizeEntry = (
  entry: Partial<NotebookEntry> & Pick<NotebookEntry, "title" | "type">
): NotebookEntry => {
  const now = new Date().toISOString();
  const tags = Array.isArray(entry.tags)
    ? entry.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];

  return {
    id: String(entry.id ?? newId()),
    type: entry.type,
    title: String(entry.title).trim(),
    summary: String(entry.summary ?? "").trim(),
    body: String(entry.body ?? ""),
    tags,
    url: String(entry.url ?? "").trim(),
    netsuiteId: String(entry.netsuiteId ?? "").trim(),
    recordType: String(entry.recordType ?? "").trim(),
    scriptId: String(entry.scriptId ?? "").trim(),
    filePath: String(entry.filePath ?? "").trim(),
    code: String(entry.code ?? ""),
    group: String(entry.group ?? "General").trim() || "General",
    pinned: Boolean(entry.pinned ?? false),
    archived: Boolean(entry.archived ?? false),
    createdAt: String(entry.createdAt ?? now),
    updatedAt: now
  };
};

export const getNotebookEntries = async (): Promise<NotebookEntry[]> => {
  const entries = await db.entries.toArray();
  return entries.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
};

export const upsertNotebookEntry = async (
  entry: Partial<NotebookEntry> & Pick<NotebookEntry, "title" | "type">
): Promise<NotebookEntry> => {
  const existing = entry.id ? await db.entries.get(entry.id) : undefined;
  const normalized = normalizeEntry({
    ...existing,
    ...entry,
    createdAt: existing?.createdAt ?? entry.createdAt
  });
  await db.entries.put(normalized);
  return normalized;
};

export const deleteNotebookEntry = async (id: string): Promise<void> => {
  await db.entries.delete(id);
};

export const bulkImportNotebookEntries = async (
  entries: NotebookEntry[]
): Promise<void> => {
  const normalized = entries
    .filter((entry) => entry.title && entry.type)
    .map((entry) => normalizeEntry(entry));
  await db.entries.bulkPut(normalized);
};

export { db as notebookDb };
