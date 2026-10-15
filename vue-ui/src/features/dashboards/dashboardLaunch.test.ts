import { describe, it, expect } from "vitest";
import {
  normalizeDashboardShortcut,
  matchesDashboardShortcut,
  updateDashboardLaunchPreferences,
  reservedDashboardShortcuts,
  dashboardPath,
} from "../../../../shared/dashboardLaunch";
describe("dashboard launch preferences", () => {
  it("normalizes modifiers and requires an intentional shortcut", () => {
    expect(normalizeDashboardShortcut(" Alt + CTRL + 1 ")).toBe("ctrl+alt+1");
    for (const bad of ["a", "shift+a", "ctrl+ctrl+a", "ctrl+unknown+a"])
      expect(() => normalizeDashboardShortcut(bad)).toThrow();
    expect(normalizeDashboardShortcut("")).toBe("");
  });
  it("matches exact modifiers rather than stealing other shortcuts", () => {
    const event = {
      key: "A",
      ctrlKey: true,
      altKey: true,
      metaKey: false,
      shiftKey: false,
    };
    expect(matchesDashboardShortcut(event, "ctrl+alt+a")).toBe(true);
    expect(
      matchesDashboardShortcut({ ...event, shiftKey: true }, "ctrl+alt+a"),
    ).toBe(false);
    expect(
      matchesDashboardShortcut(
        { ...event, key: "!", code: "Digit1", shiftKey: true },
        "ctrl+alt+shift+1",
      ),
    ).toBe(true);
  });
  it("preserves pins when assigning and clearing a shortcut, and prunes deleted dashboards", () => {
    const original = {
      a: { pinned: true },
      deleted: { shortcut: "ctrl+alt+1" },
    };
    const next = updateDashboardLaunchPreferences(
      original,
      "a",
      { shortcut: "CTRL+ALT+1" },
      ["a", "b"],
    );
    expect(next).toEqual({ a: { pinned: true, shortcut: "ctrl+alt+1" } });
    expect(original.deleted).toBeDefined();
    expect(
      updateDashboardLaunchPreferences(next, "a", { shortcut: "" }, ["a"]),
    ).toEqual({ a: { pinned: true, shortcut: "" } });
    expect(() =>
      updateDashboardLaunchPreferences(next, "deleted", { pinned: true }, [
        "a",
      ]),
    ).toThrow();
  });
  it("rejects another dashboard’s shortcut and existing extension shortcuts", () => {
    const prefs = { a: { shortcut: "ctrl+alt+1" } };
    expect(() =>
      updateDashboardLaunchPreferences(prefs, "b", { shortcut: "ctrl+alt+1" }, [
        "a",
        "b",
      ]),
    ).toThrow("Another dashboard");
    expect(() =>
      updateDashboardLaunchPreferences(
        {},
        "a",
        { shortcut: "ctrl+k" },
        ["a"],
        reservedDashboardShortcuts({}),
      ),
    ).toThrow("already used");
    expect(() =>
      updateDashboardLaunchPreferences(
        {},
        "a",
        { shortcut: "alt+z" },
        ["a"],
        reservedDashboardShortcuts({}),
      ),
    ).toThrow("already used");
  });
  it("encodes standalone dashboard paths for tab persistence and direct links", () => {
    expect(dashboardPath("a/b", "Tasks & checks")).toBe(
      "/dashboard/a%2Fb?label=Tasks%20%26%20checks",
    );
  });
});
