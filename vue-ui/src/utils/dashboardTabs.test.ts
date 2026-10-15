// @vitest-environment jsdom
import { it, expect } from "vitest";
import {
  openDashboardTab,
  setDashboardWorkspaceReady,
  OPEN_DASHBOARD_TAB_EVENT,
} from "./dashboardTabs";
it("queues a dashboard launch while the account workspace restores", () => {
  const received: unknown[] = [];
  const listener = (event: Event) =>
    received.push((event as CustomEvent).detail);
  window.addEventListener(OPEN_DASHBOARD_TAB_EVENT, listener);
  setDashboardWorkspaceReady(false);
  openDashboardTab("/dashboard/tasks", { label: "Tasks" });
  expect(received).toEqual([]);
  setDashboardWorkspaceReady(true);
  expect(received).toEqual([
    { path: "/dashboard/tasks", label: "Tasks", reuseExisting: true },
  ]);
  window.removeEventListener(OPEN_DASHBOARD_TAB_EVENT, listener);
  setDashboardWorkspaceReady(false);
});
