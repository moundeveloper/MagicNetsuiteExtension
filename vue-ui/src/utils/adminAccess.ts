import { computed, reactive } from "vue";

const SESSION_KEY = "magic_netsuite_temporary_admin_access";
const ACCESS_DURATION_MS = 30 * 60 * 1000;
const PASSKEY = "mounmoon";

const state = reactive({
  initialized: false,
  expiresAt: 0
});

let initialization: Promise<void> | null = null;
let expiryTimer: number | null = null;

export const isBuiltInAdmin =
  import.meta.env.VITE_PRIVILEGE_LEVEL === "ADMIN";

const emitAccessChanged = () => {
  window.dispatchEvent(
    new CustomEvent("magic-netsuite-admin-access-changed", {
      detail: {
        active: isBuiltInAdmin || state.expiresAt > Date.now(),
        expiresAt: state.expiresAt || null
      }
    })
  );
};

const clearExpiryTimer = () => {
  if (expiryTimer !== null) {
    window.clearTimeout(expiryTimer);
    expiryTimer = null;
  }
};

const scheduleExpiry = () => {
  clearExpiryTimer();
  if (!state.expiresAt || isBuiltInAdmin) return;
  const remaining = state.expiresAt - Date.now();
  if (remaining <= 0) {
    state.expiresAt = 0;
    void chrome.storage.session.remove(SESSION_KEY).catch(() => undefined);
    emitAccessChanged();
    return;
  }
  expiryTimer = window.setTimeout(() => {
    state.expiresAt = 0;
    expiryTimer = null;
    void chrome.storage.session.remove(SESSION_KEY).catch(() => undefined);
    emitAccessChanged();
  }, remaining);
};

export const initializeAdminAccess = () => {
  if (state.initialized) return Promise.resolve();
  initialization ??= (async () => {
    if (!isBuiltInAdmin) {
      try {
        const result = await chrome.storage.session.get(SESSION_KEY);
        const expiresAt = Number(result?.[SESSION_KEY]?.expiresAt || 0);
        if (expiresAt > Date.now()) {
          state.expiresAt = expiresAt;
        } else if (expiresAt) {
          await chrome.storage.session.remove(SESSION_KEY);
        }
      } catch {
        state.expiresAt = 0;
      }
    }
    state.initialized = true;
    scheduleExpiry();
  })();
  return initialization;
};

export const hasAdminAccess = computed(
  () => isBuiltInAdmin || state.expiresAt > Date.now()
);

export const adminAccessExpiresAt = computed(() =>
  isBuiltInAdmin ? null : state.expiresAt || null
);

export const unlockAdminAccess = async (passkey: string) => {
  if (isBuiltInAdmin) return true;
  if (passkey !== PASSKEY) return false;

  state.expiresAt = Date.now() + ACCESS_DURATION_MS;
  try {
    await chrome.storage.session.set({
      [SESSION_KEY]: { expiresAt: state.expiresAt }
    });
  } catch {
    // The in-memory grant remains valid for this extension view.
  }
  scheduleExpiry();
  emitAccessChanged();
  return true;
};

export const revokeAdminAccess = async () => {
  if (isBuiltInAdmin) return;
  clearExpiryTimer();
  state.expiresAt = 0;
  try {
    await chrome.storage.session.remove(SESSION_KEY);
  } catch {
    // Access is already revoked in this extension view.
  }
  emitAccessChanged();
};

void initializeAdminAccess();
