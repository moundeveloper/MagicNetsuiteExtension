/** Personal launch preferences are separate from the dashboard definition and history. */
export const DASHBOARD_LAUNCH_KEY = "magic_netsuite_dashboard_launch_v1";
export type DashboardLaunchPreferences = Record<
  string,
  { pinned?: boolean; shortcut?: string }
>;
export function reservedDashboardShortcuts(settings: Record<string, unknown>) {
  return Object.entries({
    extensionToggle: "alt+shift+u",
    drawerOpen: "ctrl+k",
    modulesSearch: "ctrl+m",
    newDashboardTab: "ctrl+alt+n",
    dashboardWheelShortcut: "ctrl+alt+d",
    reopenClosedTab: "ctrl+alt+t",
    elementScreenshotShortcut: "ctrl+shift+s",
    ...settings,
  })
    .filter(
      ([key, value]) =>
        [
          "extensionToggle",
          "drawerOpen",
          "modulesSearch",
          "newDashboardTab",
          "dashboardWheelShortcut",
          "reopenClosedTab",
          "elementScreenshotShortcut",
        ].includes(key) && typeof value === "string",
    )
    .map(([, value]) => String(value))
    .concat(["alt+z", "ctrl+shift+x", "ctrl+shift+y", "alt+shift+s"]);
}

export function dashboardPath(id: string, title: string) {
  return `/dashboard/${encodeURIComponent(id)}?label=${encodeURIComponent(title)}`;
}

export function normalizeDashboardShortcut(value: string): string {
  if (!value.trim()) return "";
  const parts = value
    .toLowerCase()
    .split("+")
    .map((p) => p.trim());
  const modifiers = ["ctrl", "alt", "shift", "meta"];
  const key = parts.pop() || "";
  if (
    !/^[a-z0-9]$/.test(key) ||
    !parts.length ||
    parts.some((p) => !modifiers.includes(p)) ||
    new Set(parts).size !== parts.length ||
    !parts.some((p) => ["ctrl", "alt", "meta"].includes(p))
  ) {
    throw new Error(
      "Use Ctrl, Alt or Meta with a letter or number, for example Ctrl+Alt+1.",
    );
  }
  return [...modifiers.filter((p) => parts.includes(p)), key].join("+");
}

export function matchesDashboardShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
  > & { code?: string },
  shortcut: string,
) {
  if (!shortcut) return false;
  const parts = shortcut.split("+");
  return (
    (/^[a-z0-9]$/i.test(event.key)
      ? event.key.toLowerCase()
      : (event.code || "").replace(/^(Key|Digit)/, "").toLowerCase()) ===
      parts[parts.length - 1] &&
    event.ctrlKey === parts.includes("ctrl") &&
    event.altKey === parts.includes("alt") &&
    event.shiftKey === parts.includes("shift") &&
    event.metaKey === parts.includes("meta")
  );
}

export function updateDashboardLaunchPreferences(
  preferences: DashboardLaunchPreferences,
  id: string,
  patch: { pinned?: boolean; shortcut?: string },
  validIds: string[],
  reserved: string[] = [],
): DashboardLaunchPreferences {
  if (!validIds.includes(id)) throw new Error("Dashboard no longer exists.");
  const next: DashboardLaunchPreferences = Object.fromEntries(
    Object.entries(preferences).filter(([key]) => validIds.includes(key)),
  );
  const current = { ...next[id] };
  if (typeof patch.pinned === "boolean") current.pinned = patch.pinned;
  if (typeof patch.shortcut === "string") {
    const shortcut = normalizeDashboardShortcut(patch.shortcut);
    if (
      shortcut &&
      Object.entries(next).some(
        ([key, pref]) => key !== id && pref.shortcut === shortcut,
      )
    )
      throw new Error("Another dashboard already uses this shortcut.");
    if (
      shortcut &&
      reserved.some((value) => {
        try {
          return normalizeDashboardShortcut(value) === shortcut;
        } catch {
          return false;
        }
      })
    )
      throw new Error(
        "This shortcut is already used by the extension. Choose another combination.",
      );
    current.shortcut = shortcut;
  }
  next[id] = current;
  return next;
}
