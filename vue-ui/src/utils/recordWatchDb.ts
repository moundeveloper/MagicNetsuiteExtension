import Dexie, { type EntityTable } from "dexie";

export type WatchedRecord = {
  key: string;
  environment: string;
  recordType: string;
  recordId: string;
  label: string;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt: number | null;
  lastChangedAt: number | null;
  changeCount: number;
  error?: string;
};

export type RecordSnapshot = {
  id?: number;
  watchKey: string;
  capturedAt: number;
  fingerprint: string;
  data: unknown;
  changeCount: number;
};

export type RecordChange = {
  path: string;
  before: unknown;
  after: unknown;
  kind: "added" | "removed" | "changed";
};

const db = new Dexie("MagicNetsuiteWatchtower") as Dexie & {
  watches: EntityTable<WatchedRecord, "key">;
  snapshots: EntityTable<RecordSnapshot, "id">;
};

db.version(1).stores({
  watches: "&key, environment, updatedAt, lastChangedAt",
  snapshots: "++id, watchKey, capturedAt, [watchKey+capturedAt]"
});

const serializable = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

export const recordWatchKey = (
  environment: string,
  recordType: string,
  recordId: string
) => `${environment}::${recordType.toLowerCase()}::${recordId}`;

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
};

const fingerprint = (data: unknown) => {
  const source = stableStringify(data);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const flatten = (
  value: unknown,
  path = "",
  output = new Map<string, unknown>()
) => {
  if (value === null || typeof value !== "object") {
    output.set(path || "value", value);
    return output;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) output.set(path, []);
    value.forEach((item, index) =>
      flatten(item, `${path}[${index}]`, output)
    );
    return output;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) output.set(path, {});
  for (const [key, item] of entries) {
    flatten(item, path ? `${path}.${key}` : key, output);
  }
  return output;
};

export const diffRecordSnapshots = (
  before: unknown,
  after: unknown
): RecordChange[] => {
  const previous = flatten(before);
  const current = flatten(after);
  const paths = new Set([...previous.keys(), ...current.keys()]);
  const changes: RecordChange[] = [];

  for (const path of paths) {
    const hadBefore = previous.has(path);
    const hasAfter = current.has(path);
    const oldValue = previous.get(path);
    const newValue = current.get(path);
    if (hadBefore && hasAfter && stableStringify(oldValue) === stableStringify(newValue)) {
      continue;
    }
    changes.push({
      path,
      before: oldValue,
      after: newValue,
      kind: !hadBefore ? "added" : !hasAfter ? "removed" : "changed"
    });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
};

export const listWatchedRecords = async (environment?: string) => {
  const rows = environment
    ? await db.watches.where("environment").equals(environment).toArray()
    : await db.watches.toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
};

export const getWatchedRecord = (key: string) => db.watches.get(key);

export const isRecordWatched = async (
  environment: string,
  recordType: string,
  recordId: string
) => Boolean(await db.watches.get(recordWatchKey(environment, recordType, recordId)));

export const addWatchedRecord = async ({
  environment,
  recordType,
  recordId,
  label,
  data
}: {
  environment: string;
  recordType: string;
  recordId: string;
  label?: string;
  data?: unknown;
}) => {
  const now = Date.now();
  const key = recordWatchKey(environment, recordType, recordId);
  const existing = await db.watches.get(key);
  await db.watches.put({
    key,
    environment,
    recordType,
    recordId,
    label: label?.trim() || `${recordType} #${recordId}`,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastCheckedAt: existing?.lastCheckedAt ?? null,
    lastChangedAt: existing?.lastChangedAt ?? null,
    changeCount: existing?.changeCount ?? 0,
    error: undefined
  });
  if (data !== undefined && !existing) {
    await captureRecordSnapshot(key, data);
  }
  window.dispatchEvent(new CustomEvent("magic-netsuite-watchtower-changed"));
  return key;
};

export const captureRecordSnapshot = async (watchKey: string, data: unknown) => {
  const watch = await db.watches.get(watchKey);
  if (!watch) throw new Error("Watched record no longer exists.");

  const now = Date.now();
  const latest = await db.snapshots
    .where("watchKey")
    .equals(watchKey)
    .last();
  const cleanData = serializable(data);
  const nextFingerprint = fingerprint(cleanData);
  const changes = latest
    ? diffRecordSnapshots(latest.data, cleanData)
    : [];
  const changed = Boolean(latest && latest.fingerprint !== nextFingerprint);

  if (!latest || changed) {
    await db.snapshots.add({
      watchKey,
      capturedAt: now,
      fingerprint: nextFingerprint,
      data: cleanData,
      changeCount: changes.length
    });
  }

  await db.watches.update(watchKey, {
    updatedAt: now,
    lastCheckedAt: now,
    lastChangedAt: changed ? now : watch.lastChangedAt,
    changeCount: changed ? changes.length : 0,
    error: undefined
  });
  window.dispatchEvent(new CustomEvent("magic-netsuite-watchtower-changed"));
  return { changed, changes, captured: !latest || changed };
};

export const setWatchError = async (watchKey: string, error: string) => {
  await db.watches.update(watchKey, {
    updatedAt: Date.now(),
    lastCheckedAt: Date.now(),
    error
  });
  window.dispatchEvent(new CustomEvent("magic-netsuite-watchtower-changed"));
};

export const listRecordSnapshots = async (watchKey: string) => {
  const rows = await db.snapshots.where("watchKey").equals(watchKey).toArray();
  return rows.sort((a, b) => b.capturedAt - a.capturedAt);
};

export const removeWatchedRecord = async (watchKey: string) => {
  await db.transaction("rw", db.watches, db.snapshots, async () => {
    await db.watches.delete(watchKey);
    await db.snapshots.where("watchKey").equals(watchKey).delete();
  });
  window.dispatchEvent(new CustomEvent("magic-netsuite-watchtower-changed"));
};

export { db as recordWatchDb };
