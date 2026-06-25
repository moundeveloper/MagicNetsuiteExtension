const STORAGE_KEY = "magic_netsuite_workspace_states";

type WorkspaceStates = Record<string, Record<string, unknown>>;
let writeQueue: Promise<void> = Promise.resolve();

const normalizeEnvironment = (environment: string) =>
  environment && environment !== "unknown" ? environment : "unknown";

const readStates = async (): Promise<WorkspaceStates> => {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result?.[STORAGE_KEY];
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
};

export const getWorkspaceState = async <T>(
  scope: string,
  environment: string
): Promise<T | null> => {
  const states = await readStates();
  return (states[normalizeEnvironment(environment)]?.[scope] as T) ?? null;
};

export const saveWorkspaceState = async (
  scope: string,
  environment: string,
  state: unknown
) => {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const states = await readStates();
      const key = normalizeEnvironment(environment);
      states[key] = {
        ...(states[key] ?? {}),
        [scope]: state
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: states });
    });
  await writeQueue;
};
