import {
  createMemoryHistory,
  createRouter,
  type RouteRecordRaw,
} from "vue-router";
import { getRoutes } from "./routesMap";
import { recordRecentView } from "../utils/recentViews";
import {
  hasAdminAccess,
  initializeAdminAccess
} from "../utils/adminAccess";

const routes = getRoutes();

export const router = createRouter({
  history: createMemoryHistory(),
  routes,
});

router.beforeEach(async (to) => {
  await initializeAdminAccess();
  if (to.meta.adminOnly && !hasAdminAccess.value) {
    return {
      path: "/settings",
      query: { adminRequired: "1" }
    };
  }
  return true;
});

router.afterEach((to) => {
  void recordRecentView(to);
});

window.addEventListener("magic-netsuite-admin-access-changed", (event) => {
  const active = (event as CustomEvent<{ active?: boolean }>).detail?.active;
  if (!active && router.currentRoute.value.meta.adminOnly) {
    void router.push({
      path: "/settings",
      query: { adminRequired: "1" }
    });
  }
});
