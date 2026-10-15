export const OPEN_DASHBOARD_TAB_EVENT = "magic-netsuite-open-dashboard-tab";

export type OpenDashboardTabDetail = {
  path: string;
  label?: string;
  reuseExisting?: boolean;
  /** A navigator destination reuses its view even when the open tab has filter queries. */
  reuseByPath?: boolean;
};

let workspaceReady = false;
const pendingTabs: OpenDashboardTabDetail[] = [];
export function setDashboardWorkspaceReady(ready: boolean) {
  workspaceReady = ready;
  if (ready) {
    for (const detail of pendingTabs.splice(0)) {
      window.dispatchEvent(
        new CustomEvent(OPEN_DASHBOARD_TAB_EVENT, { detail }),
      );
    }
  }
}

export const openDashboardTab = (
  path: string,
  options: Omit<OpenDashboardTabDetail, "path"> = {},
) => {
  const detail = {
    path,
    label: options.label,
    reuseExisting: options.reuseExisting ?? true,
    ...(options.reuseByPath ? { reuseByPath: true } : {}),
  };
  if (!workspaceReady) {
    pendingTabs.push(detail);
    return;
  }
  window.dispatchEvent(
    new CustomEvent<OpenDashboardTabDetail>(OPEN_DASHBOARD_TAB_EVENT, {
      detail,
    }),
  );
};
