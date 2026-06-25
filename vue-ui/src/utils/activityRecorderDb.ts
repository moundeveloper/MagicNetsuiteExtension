import Dexie, { type EntityTable } from "dexie";
import { RequestRoutes } from "../types/request";

export type ActivityStatus = "success" | "error";
export type ActivityKind = "read" | "write" | "execute" | "system";

export type ActivityEntry = {
  id?: number;
  route: RequestRoutes;
  mode: string;
  kind: ActivityKind;
  status: ActivityStatus;
  environment: string;
  startedAt: number;
  durationMs: number;
  payload: unknown;
  response?: unknown;
  error?: string;
};

export type ActivityFilters = {
  environment?: string;
  status?: ActivityStatus | "all";
  kind?: ActivityKind | "all";
  query?: string;
  limit?: number;
};

const WRITE_ROUTES = new Set<RequestRoutes>([
  RequestRoutes.CLEAR_SCRIPT_LOGS,
  RequestRoutes.CREATE_FOLDER,
  RequestRoutes.UPLOAD_FILE,
  RequestRoutes.SAVE_TEMPLATE,
  RequestRoutes.CREATE_SCRIPT,
  RequestRoutes.CREATE_SCRIPT_DEPLOYMENT,
  RequestRoutes.UPDATE_FILE_CONTENT,
  RequestRoutes.DELETE_FILE,
  RequestRoutes.DELETE_FOLDER,
  RequestRoutes.BATCH_DELETE_FILE_CABINET_ITEMS,
  RequestRoutes.RENAME_FILE,
  RequestRoutes.RENAME_FOLDER,
  RequestRoutes.MOVE_ITEMS,
  RequestRoutes.CREATE_CUSTOM_LIST,
  RequestRoutes.UPDATE_CUSTOM_LIST,
  RequestRoutes.CREATE_RECORD,
  RequestRoutes.UPDATE_RECORD_FIELDS,
  RequestRoutes.CREATE_CUSTOM_RECORD_TYPE,
  RequestRoutes.CREATE_CUSTOM_RECORD_FIELD,
  RequestRoutes.UPDATE_CUSTOM_RECORD_FIELD,
  RequestRoutes.CREATE_SCRIPT_FIELD,
  RequestRoutes.UPDATE_SCRIPT_FIELD,
  RequestRoutes.REMOVE_SERVER_COMPONENTS
]);

const EXECUTE_ROUTES = new Set<RequestRoutes>([
  RequestRoutes.RUN_QUICK_SCRIPT,
  RequestRoutes.RUN_QUICK_SCRIPT_SERVER,
  RequestRoutes.EXECUTE_SCRIPT_DEPLOYMENT,
  RequestRoutes.RENDER_FREEMARKER_TEMPLATE,
  RequestRoutes.PREVIEW,
  RequestRoutes.EXECUTE_HTTP_REQUEST
]);

const SYSTEM_ROUTES = new Set<RequestRoutes>([
  RequestRoutes.CHECK_CONNECTION,
  RequestRoutes.CHECK_GOVERNANCE
]);

const IGNORED_ROUTES = new Set<RequestRoutes>([RequestRoutes.CHECK_GOVERNANCE]);
const MAX_ENTRIES = 1500;
const SENSITIVE_KEY = /authorization|password|passwd|secret|token|cookie|api[-_]?key/i;
const MAX_STRING_LENGTH = 12000;
const MAX_ARRAY_LENGTH = 100;
const MAX_OBJECT_KEYS = 150;

const db = new Dexie("MagicNetsuiteFlightRecorder") as Dexie & {
  activities: EntityTable<ActivityEntry, "id">;
};

db.version(1).stores({
  activities:
    "++id, environment, route, status, kind, startedAt, [environment+startedAt]"
});

const sanitize = (
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): unknown => {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}… [truncated ${value.length - MAX_STRING_LENGTH} chars]`
      : value;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") {
    return `[${typeof value}]`;
  }
  if (depth >= 7) return "[max depth]";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitize(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_LENGTH) {
      items.push(`[${value.length - MAX_ARRAY_LENGTH} more items]`);
    }
    return items;
  }

  const output: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, item] of entries.slice(0, MAX_OBJECT_KEYS)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? "[redacted]"
      : sanitize(item, depth + 1, seen);
  }
  if (entries.length > MAX_OBJECT_KEYS) {
    output.__truncated = `${entries.length - MAX_OBJECT_KEYS} more keys`;
  }
  return output;
};

export const getActivityKind = (route: RequestRoutes): ActivityKind => {
  if (WRITE_ROUTES.has(route)) return "write";
  if (EXECUTE_ROUTES.has(route)) return "execute";
  if (SYSTEM_ROUTES.has(route)) return "system";
  return "read";
};

export const isReplaySafe = (route: RequestRoutes) =>
  getActivityKind(route) === "read";

const emitChanged = () => {
  window.dispatchEvent(new CustomEvent("magic-netsuite-activity-changed"));
};

const prune = async () => {
  const count = await db.activities.count();
  if (count <= MAX_ENTRIES) return;
  const staleIds = await db.activities
    .orderBy("startedAt")
    .limit(count - MAX_ENTRIES)
    .primaryKeys();
  await db.activities.bulkDelete(staleIds as number[]);
};

export const recordActivity = async (
  entry: Omit<ActivityEntry, "id" | "kind" | "payload" | "response"> & {
    payload: unknown;
    response?: unknown;
  }
) => {
  if (IGNORED_ROUTES.has(entry.route)) return;
  await db.activities.add({
    ...entry,
    kind: getActivityKind(entry.route),
    payload: sanitize(entry.payload),
    response: sanitize(entry.response)
  });
  await prune();
  emitChanged();
};

export const listActivities = async (
  filters: ActivityFilters = {}
): Promise<ActivityEntry[]> => {
  let rows = await db.activities.orderBy("startedAt").reverse().toArray();
  const query = filters.query?.trim().toLowerCase();
  rows = rows.filter((row) => {
    if (filters.environment && row.environment !== filters.environment) return false;
    if (filters.status && filters.status !== "all" && row.status !== filters.status) {
      return false;
    }
    if (filters.kind && filters.kind !== "all" && row.kind !== filters.kind) {
      return false;
    }
    if (
      query &&
      !`${row.route} ${row.error || ""} ${JSON.stringify(row.payload)}`
        .toLowerCase()
        .includes(query)
    ) {
      return false;
    }
    return true;
  });
  return rows.slice(0, filters.limit ?? 500);
};

export const clearActivities = async (environment?: string) => {
  if (environment) {
    await db.activities.where("environment").equals(environment).delete();
  } else {
    await db.activities.clear();
  }
  emitChanged();
};

export const deleteActivity = async (id: number) => {
  await db.activities.delete(id);
  emitChanged();
};

export { db as activityRecorderDb };
