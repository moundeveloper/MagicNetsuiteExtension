import { ref, onMounted, onBeforeUnmount } from "vue";
import { dashboardCommand } from "./api";
import { openDashboardTab } from "../../utils/dashboardTabs";
import { useSettings } from "../../states/settingsState";
import {
  DASHBOARD_LAUNCH_KEY,
  dashboardPath,
  updateDashboardLaunchPreferences,
  reservedDashboardShortcuts,
  type DashboardLaunchPreferences,
} from "../../../../shared/dashboardLaunch";
export { dashboardPath };

export function openSavedDashboard(dashboard: { id: string; title: string }) {
  openDashboardTab(dashboardPath(dashboard.id, dashboard.title), {
    label: dashboard.title,
  });
}

export function useDashboardLaunch() {
  const preferences = ref<DashboardLaunchPreferences>({});
  const { settings } = useSettings();
  async function refresh() {
    if (globalThis.chrome?.runtime?.id) {
      const stored = await chrome.storage.local.get(DASHBOARD_LAUNCH_KEY);
      preferences.value = (stored[DASHBOARD_LAUNCH_KEY] ||
        {}) as DashboardLaunchPreferences;
    } else
      preferences.value = JSON.parse(
        localStorage.getItem(DASHBOARD_LAUNCH_KEY) || "{}",
      );
  }
  async function update(
    id: string,
    patch: { pinned?: boolean; shortcut?: string },
  ) {
    if (globalThis.chrome?.runtime?.id) {
      const response = await chrome.runtime.sendMessage({
        type: "DASHBOARD_LAUNCH_PREFERENCES",
        dashboardId: id,
        patch,
      });
      if (!response?.ok)
        throw new Error(
          response?.error || "Could not save dashboard preferences.",
        );
      preferences.value = response.preferences;
    } else {
      const list = await dashboardCommand<{ id: string }[]>("list");
      const stored = JSON.parse(
        localStorage.getItem(DASHBOARD_LAUNCH_KEY) || "{}",
      );
      preferences.value = updateDashboardLaunchPreferences(
        stored,
        id,
        patch,
        list.map((d) => d.id),
        reservedDashboardShortcuts(
          settings as unknown as Record<string, unknown>,
        ),
      );
      localStorage.setItem(
        DASHBOARD_LAUNCH_KEY,
        JSON.stringify(preferences.value),
      );
      window.dispatchEvent(new Event("magic-dashboard-launch-changed"));
    }
  }
  const changed = (changes: Record<string, unknown>, area: string) => {
    if (area === "local" && changes[DASHBOARD_LAUNCH_KEY]) void refresh();
  };
  const storage = (event: StorageEvent) => {
    if (event.key === DASHBOARD_LAUNCH_KEY) void refresh();
  };
  const localChanged = () => void refresh();
  onMounted(() => {
    void refresh();
    globalThis.chrome?.storage?.onChanged?.addListener(changed);
    window.addEventListener("storage", storage);
    window.addEventListener("magic-dashboard-launch-changed", localChanged);
  });
  onBeforeUnmount(() => {
    globalThis.chrome?.storage?.onChanged?.removeListener(changed);
    window.removeEventListener("storage", storage);
    window.removeEventListener("magic-dashboard-launch-changed", localChanged);
  });
  return { preferences, update };
}
