import { describe, expect, it } from "vitest";
import {
  getRouteMap,
  getRoutes,
  isRouteVisibleInNavigation,
  routes,
} from "./routesMap";

type AsyncViewComponent = {
  __asyncLoader?: () => Promise<unknown>;
};

describe("workspace route components", () => {
  it("wraps every lazy route as an async Vue component", () => {
    const routeComponents = routes.flatMap((route) => [
      { path: route.route, component: route.component },
      ...(route.children ?? []).map((child) => ({
        path: child.route,
        component: child.component
      }))
    ]);

    expect(routeComponents.length).toBeGreaterThan(30);
    for (const route of routeComponents) {
      expect(
        typeof (route.component as AsyncViewComponent).__asyncLoader,
        `${route.path} must not expose a raw Promise-returning loader`
      ).toBe("function");
    }
  });

  it("exposes Jobs Center while keeping Execution Monitor internal", () => {
    const routeMap = getRouteMap();
    const jobs = routeMap.find((route) => route.route === "/jobs");
    const processing = routeMap.find(
      (route) => route.route === "/processing",
    );

    expect(jobs?.name).toBe("Jobs Center");
    expect(jobs && isRouteVisibleInNavigation(jobs)).toBe(true);
    expect(processing?.name).toBe("Execution Monitor");
    expect(processing && isRouteVisibleInNavigation(processing)).toBe(false);

    const processingRecord = getRoutes().find(
      (route) => route.path === "/processing",
    );
    expect(processingRecord?.meta.internalOnly).toBe(true);
  });
});
