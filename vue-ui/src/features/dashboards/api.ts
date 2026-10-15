import { callApi } from "../../utils/api";
import { RequestRoutes } from "../../types/request";
import {
  createDashboardService,
  DASHBOARDS_STORAGE_KEY,
  hasOwn,
} from "../../../../shared/dashboards";
export * from "../../../../shared/dashboards";

const previewService = createDashboardService(
  {
    read: async () =>
      JSON.parse(localStorage.getItem(DASHBOARDS_STORAGE_KEY) || "[]"),
    write: async (all) => {
      localStorage.setItem(DASHBOARDS_STORAGE_KEY, JSON.stringify(all));
      window.dispatchEvent(new Event("magic-dashboards-changed"));
    },
  },
  async (step, code) => {
    const response = await callApi(
      step.domain === "server"
        ? RequestRoutes.RUN_QUICK_SCRIPT_SERVER
        : RequestRoutes.RUN_QUICK_SCRIPT,
      { code },
    );
    if (
      response.status === "error" ||
      response.message?.error ||
      response.message?.success === false
    )
      throw new Error(
        String(
          response.message?.error || response.message || "Execution failed.",
        ),
      );
    return response.message && hasOwn(response.message, "result")
      ? response.message.result
      : response.message;
  },
);
export async function dashboardCommand<T = any>(
  operation: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!globalThis.chrome?.runtime?.id) return previewService(operation, args);
  const response = await chrome.runtime.sendMessage({
    type: "DASHBOARD_COMMAND",
    operation,
    args,
  });
  if (!response?.ok)
    throw new Error(response?.error || "Dashboard worker did not respond.");
  return response.result;
}
export function observeDashboards(refresh: () => void) {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === "local" && changes[DASHBOARDS_STORAGE_KEY]) refresh();
  };
  globalThis.chrome?.storage?.onChanged?.addListener(listener);
  const storage = (e: StorageEvent) => {
    if (e.key === DASHBOARDS_STORAGE_KEY) refresh();
  };
  window.addEventListener("storage", storage);
  window.addEventListener("magic-dashboards-changed", refresh);
  return () => {
    globalThis.chrome?.storage?.onChanged?.removeListener(listener);
    window.removeEventListener("storage", storage);
    window.removeEventListener("magic-dashboards-changed", refresh);
  };
}
