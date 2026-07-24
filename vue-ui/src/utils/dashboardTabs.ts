export const OPEN_DASHBOARD_TAB_EVENT = "magic-netsuite-open-dashboard-tab";

export type OpenDashboardTabDetail = {
  path: string;
  label?: string;
  reuseExisting?: boolean;
};

export const openDashboardTab = (
  path: string,
  options: Omit<OpenDashboardTabDetail, "path"> = {}
) => {
  window.dispatchEvent(
    new CustomEvent<OpenDashboardTabDetail>(OPEN_DASHBOARD_TAB_EVENT, {
      detail: {
        path,
        label: options.label,
        reuseExisting: options.reuseExisting ?? true
      }
    })
  );
};
