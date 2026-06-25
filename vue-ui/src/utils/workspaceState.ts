import Dexie, { type EntityTable } from "dexie";

const LEGACY_STORAGE_KEY = "magic_netsuite_workspace_states";
const MIGRATION_KEY = "chrome-local-v1";

type WorkspaceStates = Record<string, Record<string, unknown>>;

type WorkspaceStateRow = {
  id: string;
  environment: string;
  scope: string;
  value: unknown;
  updatedAt: string;
};

type WorkspaceMetaRow = {
  key: string;
  completedAt: string;
};

const db = new Dexie("MagicNetsuiteWorkspaces") as Dexie & {
  workspaceStates: EntityTable<WorkspaceStateRow, "id">;
  meta: EntityTable<WorkspaceMetaRow, "key">;
};

db.version(1).stores({
  workspaceStates: "&id, environment, scope, updatedAt",
  meta: "&key"
});

const normalizeEnvironment = (environment: string) =>
  environment && environment !== "unknown" ? environment : "unknown";

const stateId = (scope: string, environment: string) =>
  `${normalizeEnvironment(environment)}::${scope}`;

const toSerializable = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

let migrationPromise: Promise<void> | null = null;

const migrateLegacyWorkspaceStates = async () => {
  if (await db.meta.get(MIGRATION_KEY)) return;

  let legacyStates: WorkspaceStates = {};
  try {
    const result = await chrome.storage.local.get(LEGACY_STORAGE_KEY);
    const stored = result?.[LEGACY_STORAGE_KEY];
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      legacyStates = stored as WorkspaceStates;
    }
  } catch {
    // A fresh install or invalidated extension context simply has no legacy data.
  }

  const now = new Date().toISOString();
  const rows: WorkspaceStateRow[] = [];
  for (const [environment, scopes] of Object.entries(legacyStates)) {
    if (!scopes || typeof scopes !== "object" || Array.isArray(scopes)) {
      continue;
    }
    for (const [scope, value] of Object.entries(scopes)) {
      rows.push({
        id: stateId(scope, environment),
        environment: normalizeEnvironment(environment),
        scope,
        value: toSerializable(value),
        updatedAt: now
      });
    }
  }

  await db.transaction("rw", db.workspaceStates, db.meta, async () => {
    if (rows.length) await db.workspaceStates.bulkPut(rows);
    await db.meta.put({ key: MIGRATION_KEY, completedAt: now });
  });

  try {
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
  } catch {
    // Migration is complete in Dexie even if legacy cleanup is unavailable.
  }
};

const ensureMigrated = () => {
  migrationPromise ??= migrateLegacyWorkspaceStates().catch((error) => {
    migrationPromise = null;
    throw error;
  });
  return migrationPromise;
};

export const getWorkspaceState = async <T>(
  scope: string,
  environment: string
): Promise<T | null> => {
  await ensureMigrated();
  const row = await db.workspaceStates.get(stateId(scope, environment));
  return (row?.value as T) ?? null;
};

export const saveWorkspaceState = async (
  scope: string,
  environment: string,
  state: unknown
) => {
  await ensureMigrated();
  const normalizedEnvironment = normalizeEnvironment(environment);
  await db.workspaceStates.put({
    id: stateId(scope, normalizedEnvironment),
    environment: normalizedEnvironment,
    scope,
    value: toSerializable(state),
    updatedAt: new Date().toISOString()
  });
};

export { db as workspaceDb };
