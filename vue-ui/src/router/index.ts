import {
  createMemoryHistory,
  createRouter,
  type RouteRecordRaw,
} from "vue-router";
import { getRoutes } from "./routesMap";

const routes = getRoutes();

export const router = createRouter({
  history: createMemoryHistory(),
  routes,
});
