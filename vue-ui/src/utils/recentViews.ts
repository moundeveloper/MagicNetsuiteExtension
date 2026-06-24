import type { RouteLocationNormalized } from "vue-router";
import { routes } from "../router/routesMap";
import { getNetsuiteEnvironment } from "./api";

export type RecentView = {
  path: string;
  label: string;
  section: string;
  icon: string;
  environment: string;
  visitedAt: number;
};

const STORAGE_KEY = "magic_netsuite_recent_views";
const MAX_ITEMS = 30;
const EXCLUDED_PATHS = new Set(["/", "/settings", "/processing", "/feature-feedback"]);
export const RECENT_VIEWS_CHANGED_EVENT = "magic-netsuite-recent-views-changed";
let writeQueue: Promise<void> = Promise.resolve();

const pathMatchesPattern = (path: string, pattern: string) => {
  const regex = new RegExp(`^${pattern.replace(/:[^/]+/g, "[^/]+")}$`);
  return regex.test(path);
};

const routeDetails = (path: string) => {
  for (const route of routes) {
    if (route.route === path) {
      return {
        label: route.breadcrumb || route.name,
        section: route.name,
        icon: route.icon
      };
    }

    const child = route.children?.find((item) =>
      pathMatchesPattern(path, item.route)
    );
    if (child) {
      const childSegments = child.route.split("/");
      const pathSegments = path.split("/");
      const identifiers = childSegments
        .map((segment, index) =>
          segment.startsWith(":") ? pathSegments[index] : null
        )
        .filter((segment): segment is string => Boolean(segment))
        .map((segment) => decodeURIComponent(segment));
      const baseLabel = child.breadcrumb || child.name;

      return {
        label:
          identifiers.length > 0
            ? `${baseLabel} · ${identifiers.join(" / ")}`
            : baseLabel,
        section: route.name,
        icon: route.icon
      };
    }
  }

  return null;
};

const readAll = async (): Promise<RecentView[]> => {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result?.[STORAGE_KEY];
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
};

const writeAll = async (items: RecentView[]) => {
  await chrome.storage.local.set({ [STORAGE_KEY]: items.slice(0, MAX_ITEMS) });
  window.dispatchEvent(new CustomEvent(RECENT_VIEWS_CHANGED_EVENT));
};

export const recordRecentView = async (
  route: Pick<RouteLocationNormalized, "path" | "fullPath">
) => {
  if (EXCLUDED_PATHS.has(route.path)) return;

  const details = routeDetails(route.path);
  if (!details) return;

  let environment = "unknown";
  try {
    environment = await getNetsuiteEnvironment();
  } catch {
    // A closed executor tab should not interrupt normal navigation.
  }

  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const items = await readAll();
      const next: RecentView = {
        path: route.fullPath,
        ...details,
        environment,
        visitedAt: Date.now()
      };

      const withoutDuplicate = items.filter(
        (item) =>
          !(item.path === next.path && item.environment === next.environment)
      );
      await writeAll([next, ...withoutDuplicate]);
    });

  await writeQueue;
};

export const getRecentViews = async (
  environment?: string,
  limit = 6
): Promise<RecentView[]> => {
  const items = await readAll();
  return items
    .filter((item) => !environment || item.environment === environment)
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, limit);
};

export const removeRecentView = async (view: RecentView) => {
  const items = await readAll();
  await writeAll(
    items.filter(
      (item) =>
        !(item.path === view.path && item.environment === view.environment)
    )
  );
};

export const clearRecentViews = async (environment?: string) => {
  if (!environment) {
    await writeAll([]);
    return;
  }

  const items = await readAll();
  await writeAll(items.filter((item) => item.environment !== environment));
};
