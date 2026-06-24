import {
  createMemoryHistory,
  createRouter,
  type RouteRecordRaw,
} from "vue-router";
import { getRoutes } from "./routesMap";
import { recordRecentView } from "../utils/recentViews";

const routes = getRoutes();

export const router = createRouter({
  history: createMemoryHistory(),
  routes,
});

router.afterEach((to) => {
  void recordRecentView(to);
});
