<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, type RouteLocationNormalizedLoaded } from "vue-router";
import { routes } from "../router/routesMap";
import { getNetsuiteEnvironment } from "../utils/api";
import { getWorkspaceState, saveWorkspaceState } from "../utils/workspaceState";
import { useSettings } from "../states/settingsState";
import {
  formatKeyboardShortcut,
  keyboardShortcutMatches
} from "../utils/keyboardShortcut";

type TabGroup = "left" | "right";

type ViewTab = {
  id: string;
  fullPath: string;
  label: string;
  component: unknown;
  routeHydrated: boolean;
};

type ReorderTarget = {
  id: string;
  side: "before" | "after";
} | null;

type TabContextMenu = {
  tabId: string;
  x: number;
  y: number;
} | null;

type SavedWorkspace = {
  tabs: Array<{ id: string; fullPath: string }>;
  activeTabId: string;
  leftTabIds: string[];
  rightTabIds: string[];
  leftActiveId: string;
  rightActiveId: string;
  splitRatio: number;
};

type WorkspaceSnapshot = {
  id: string;
  name: string;
  createdAt: number;
  workspace: SavedWorkspace;
};

defineProps<{
  vhOffset: number;
}>();

const route = useRoute();
const router = useRouter();
const { settings } = useSettings();
const workspaceRef = ref<HTMLElement | null>(null);
const tabs = ref<ViewTab[]>([]);
const activeTabId = ref("");
const leftTabIds = ref<string[]>([]);
const rightTabIds = ref<string[]>([]);
const leftActiveId = ref("");
const rightActiveId = ref("");
const splitRatio = ref(50);
const draggingTabId = ref<string | null>(null);
const draggingGroup = ref<TabGroup | null>(null);
const reorderTarget = ref<ReorderTarget>(null);
const splitDropSide = ref<TabGroup | null>(null);
const dropZone = ref<"single" | "group-left" | "group-right" | null>(null);
const isResizingSplit = ref(false);
const workspaceGeneration = ref(0);
const workspaceSwitching = ref(false);
const tabContextMenu = ref<TabContextMenu>(null);
const tabReloadVersions = ref<Record<string, number>>({});
const workspaceLibraryOpen = ref(false);
const workspaceSnapshotName = ref("");
const workspaceSnapshots = ref<WorkspaceSnapshot[]>([]);
const workspaceLibraryLoading = ref(false);
let tabActivationNavigation = false;
let nextTabId = 1;
let workspaceEnvironment = "unknown";
let workspaceReady = false;
let workspaceDisposed = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let workspaceTransitionQueue: Promise<void> = Promise.resolve();
const closedTabs = ref<Array<{ tab: ViewTab; group: TabGroup | null; index: number }>>([]);

const isSplit = computed(() => leftTabIds.value.length > 0 && rightTabIds.value.length > 0);
const leftTabs = computed(() => leftTabIds.value.map(findTab).filter(Boolean) as ViewTab[]);
const rightTabs = computed(() => rightTabIds.value.map(findTab).filter(Boolean) as ViewTab[]);

const topLevelRouteItems = routes.flatMap((item) => [
  item,
  ...(item.children ?? []).map((child) => ({
    ...child,
    icon: item.icon,
    status: item.status,
    route: child.route
  }))
]);

const pathMatchesPattern = (path: string, pattern: string) => {
  const regex = new RegExp(`^${pattern.replace(/:[^/]+/g, "[^/]+")}$`);
  return regex.test(path);
};

const createTabId = () => `view-tab-${nextTabId++}`;

const routeLabel = (currentRoute: { path: string; name?: unknown }) => {
  const match =
    topLevelRouteItems.find((item) => item.route === currentRoute.path) ??
    topLevelRouteItems.find((item) => pathMatchesPattern(currentRoute.path, item.route));

  return match?.breadcrumb || match?.name || String(currentRoute.name ?? "View");
};

const componentForRoute = (currentRoute: Pick<RouteLocationNormalizedLoaded, "matched">) => {
  const record = currentRoute.matched[currentRoute.matched.length - 1];
  return record?.components?.default ?? null;
};

function findTab(id: string) {
  return tabs.value.find((tab) => tab.id === id);
}

const tabFromRoute = (currentRoute: RouteLocationNormalizedLoaded): ViewTab | null => {
  const component = componentForRoute(currentRoute);
  if (!component) return null;

  return {
    id: createTabId(),
    fullPath: currentRoute.fullPath,
    label: routeLabel(currentRoute),
    component,
    routeHydrated: true
  };
};

const tabFromPath = (path: string): ViewTab | null => {
  const resolved = router.resolve(path);
  const component = componentForRoute(resolved);
  if (!component) return null;

  return {
    id: createTabId(),
    fullPath: resolved.fullPath,
    label: routeLabel(resolved),
    component,
    routeHydrated: false
  };
};

const ensureGroupState = () => {
  const validIds = new Set(tabs.value.map((tab) => tab.id));
  leftTabIds.value = leftTabIds.value.filter((id) => validIds.has(id));
  rightTabIds.value = rightTabIds.value.filter((id) => validIds.has(id));

  if (isSplit.value) {
    if (!leftActiveId.value || !leftTabIds.value.includes(leftActiveId.value)) {
      leftActiveId.value = leftTabIds.value[0] ?? "";
    }
    if (!rightActiveId.value || !rightTabIds.value.includes(rightActiveId.value)) {
      rightActiveId.value = rightTabIds.value[0] ?? "";
    }
    return;
  }

  leftTabIds.value = [];
  rightTabIds.value = [];
  leftActiveId.value = "";
  rightActiveId.value = "";
};

const ensureRouteTab = (currentRoute: RouteLocationNormalizedLoaded) => {
  const component = componentForRoute(currentRoute);
  if (!component) return;

  const activeTab = findTab(activeTabId.value);
  let targetTab = activeTab;

  if (tabs.value.length === 0) {
    const firstTab = tabFromRoute(currentRoute);
    if (!firstTab) return;
    tabs.value.push(firstTab);
    targetTab = firstTab;
  } else if (activeTab) {
    activeTab.fullPath = currentRoute.fullPath;
    activeTab.label = routeLabel(currentRoute);
    activeTab.component = component;
  } else {
    const newTab = tabFromRoute(currentRoute);
    if (!newTab) return;
    tabs.value.push(newTab);
    targetTab = newTab;
  }

  if (!targetTab) return;
  activeTabId.value = targetTab.id;

  if (isSplit.value) {
    if (leftTabIds.value.includes(targetTab.id)) leftActiveId.value = targetTab.id;
    else if (rightTabIds.value.includes(targetTab.id)) rightActiveId.value = targetTab.id;
    else {
      const target = activeGroup.value ?? "right";
      addTabToGroup(targetTab.id, target);
      if (target === "left") leftActiveId.value = targetTab.id;
      else rightActiveId.value = targetTab.id;
    }
  }
};

const activeGroup = computed<TabGroup | null>(() => {
  if (leftTabIds.value.includes(activeTabId.value)) return "left";
  if (rightTabIds.value.includes(activeTabId.value)) return "right";
  return null;
});

const activateTab = async (tabId: string) => {
  const tab = findTab(tabId);
  if (!tab) return;
  activeTabId.value = tabId;
  if (leftTabIds.value.includes(tabId)) leftActiveId.value = tabId;
  if (rightTabIds.value.includes(tabId)) rightActiveId.value = tabId;
  if (route.fullPath !== tab.fullPath) {
    tabActivationNavigation = true;
    try {
      await router.push(tab.fullPath);
      await nextTick();
    } finally {
      tabActivationNavigation = false;
    }
  }
  if (!tab.routeHydrated) {
    tab.routeHydrated = true;
    await nextTick();
  }
};

const closeTab = async (tabId: string) => {
  if (tabs.value.length <= 1) return;

  const wasActive = activeTabId.value === tabId;
  const index = tabs.value.findIndex((tab) => tab.id === tabId);
  const closingTab = findTab(tabId);
  if (closingTab) {
    closedTabs.value.unshift({
      tab: { ...closingTab },
      group: leftTabIds.value.includes(tabId)
        ? "left"
        : rightTabIds.value.includes(tabId)
          ? "right"
          : null,
      index
    });
    closedTabs.value = closedTabs.value.slice(0, 10);
  }
  tabs.value = tabs.value.filter((tab) => tab.id !== tabId);
  leftTabIds.value = leftTabIds.value.filter((id) => id !== tabId);
  rightTabIds.value = rightTabIds.value.filter((id) => id !== tabId);
  ensureGroupState();

  if (!wasActive) return;

  const nextTab =
    tabs.value[Math.max(0, Math.min(index, tabs.value.length - 1))] ?? tabs.value[0];
  if (nextTab) await activateTab(nextTab.id);
};

const reopenClosedTab = async () => {
  const closed = closedTabs.value.shift();
  if (!closed) return;

  const restored = tabFromPath(closed.tab.fullPath);
  if (!restored) return;
  tabs.value.splice(Math.min(closed.index, tabs.value.length), 0, restored);

  if (isSplit.value && closed.group) {
    addTabToGroup(restored.id, closed.group);
  }
  await activateTab(restored.id);
};

const handleWorkspaceShortcut = (event: KeyboardEvent) => {
  if (
    keyboardShortcutMatches(
      event,
      settings.newDashboardTab || "ctrl+alt+n"
    )
  ) {
    event.preventDefault();
    void newHomeTab();
    return;
  }

  if (
    keyboardShortcutMatches(
      event,
      settings.reopenClosedTab || "ctrl+alt+t"
    )
  ) {
    event.preventDefault();
    void reopenClosedTab();
  }
};

const showTabContextMenu = (event: MouseEvent, tabId: string) => {
  tabContextMenu.value = {
    tabId,
    x: Math.min(event.clientX, window.innerWidth - 220),
    y: Math.min(event.clientY, window.innerHeight - 240)
  };
};

const hideTabContextMenu = () => {
  tabContextMenu.value = null;
};

const reloadTab = (tabId: string) => {
  tabReloadVersions.value = {
    ...tabReloadVersions.value,
    [tabId]: (tabReloadVersions.value[tabId] ?? 0) + 1
  };
  hideTabContextMenu();
};

const duplicateTab = async (tabId: string) => {
  const source = findTab(tabId);
  if (!source) return;
  const duplicate = tabFromPath(source.fullPath);
  if (!duplicate) return;

  const sourceIndex = tabs.value.findIndex((tab) => tab.id === tabId);
  tabs.value.splice(sourceIndex + 1, 0, duplicate);
  const sourceGroup = leftTabIds.value.includes(tabId)
    ? "left"
    : rightTabIds.value.includes(tabId)
      ? "right"
      : null;
  if (sourceGroup) addTabToGroup(duplicate.id, sourceGroup);
  hideTabContextMenu();
  await activateTab(duplicate.id);
};

const copyTabLink = async (tabId: string) => {
  const tab = findTab(tabId);
  if (!tab) return;
  await navigator.clipboard.writeText(tab.fullPath);
  hideTabContextMenu();
};

const closeOtherTabs = async (tabId: string) => {
  const target = findTab(tabId);
  if (!target) return;
  tabs.value = [target];
  activeTabId.value = tabId;
  leftTabIds.value = [];
  rightTabIds.value = [];
  leftActiveId.value = "";
  rightActiveId.value = "";
  hideTabContextMenu();
  await activateTab(tabId);
};

const closeTabsToRight = async (tabId: string) => {
  const index = tabs.value.findIndex((tab) => tab.id === tabId);
  if (index < 0 || index === tabs.value.length - 1) {
    hideTabContextMenu();
    return;
  }
  const removedIds = new Set(tabs.value.slice(index + 1).map((tab) => tab.id));
  tabs.value = tabs.value.slice(0, index + 1);
  leftTabIds.value = leftTabIds.value.filter((id) => !removedIds.has(id));
  rightTabIds.value = rightTabIds.value.filter((id) => !removedIds.has(id));
  ensureGroupState();
  hideTabContextMenu();
  if (removedIds.has(activeTabId.value)) await activateTab(tabId);
};

const serializeWorkspace = (): SavedWorkspace => ({
  tabs: tabs.value.map((tab) => ({ id: tab.id, fullPath: tab.fullPath })),
  activeTabId: activeTabId.value,
  leftTabIds: [...leftTabIds.value],
  rightTabIds: [...rightTabIds.value],
  leftActiveId: leftActiveId.value,
  rightActiveId: rightActiveId.value,
  splitRatio: splitRatio.value
});

const normalizeSavedWorkspace = (value: unknown): SavedWorkspace | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SavedWorkspace>;
  if (!Array.isArray(candidate.tabs)) return null;

  const normalizedTabs = candidate.tabs
    .filter(
      (tab): tab is { id: string; fullPath: string } =>
        Boolean(
          tab &&
            typeof tab === "object" &&
            typeof tab.id === "string" &&
            typeof tab.fullPath === "string"
        )
    )
    .map((tab) => ({ id: tab.id, fullPath: tab.fullPath }));
  if (!normalizedTabs.length) return null;

  return {
    tabs: normalizedTabs,
    activeTabId:
      typeof candidate.activeTabId === "string"
        ? candidate.activeTabId
        : normalizedTabs[0]!.id,
    leftTabIds: Array.isArray(candidate.leftTabIds)
      ? candidate.leftTabIds.filter(
          (id): id is string => typeof id === "string"
        )
      : [],
    rightTabIds: Array.isArray(candidate.rightTabIds)
      ? candidate.rightTabIds.filter(
          (id): id is string => typeof id === "string"
        )
      : [],
    leftActiveId:
      typeof candidate.leftActiveId === "string"
        ? candidate.leftActiveId
        : "",
    rightActiveId:
      typeof candidate.rightActiveId === "string"
        ? candidate.rightActiveId
        : "",
    splitRatio: Number.isFinite(Number(candidate.splitRatio))
      ? Number(candidate.splitRatio)
      : 50
  };
};

const normalizeWorkspaceSnapshot = (
  value: unknown
): WorkspaceSnapshot | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WorkspaceSnapshot>;
  const workspace = normalizeSavedWorkspace(candidate.workspace);
  if (
    !workspace ||
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string"
  ) {
    return null;
  }
  return {
    id: candidate.id,
    name: candidate.name,
    createdAt: Number.isFinite(Number(candidate.createdAt))
      ? Number(candidate.createdAt)
      : Date.now(),
    workspace
  };
};

const applySavedWorkspace = async (value: unknown) => {
  const saved = normalizeSavedWorkspace(value);
  if (!saved) return false;
  const requestedActiveId = saved.tabs.some(
    (tab) => tab.id === saved.activeTabId
  )
    ? saved.activeTabId
    : saved.tabs[0]!.id;
  const restoredTabs = saved.tabs
    .map((item) => {
      const tab = tabFromPath(item.fullPath);
      return tab
        ? {
            ...tab,
            id: item.id,
            routeHydrated: item.id === requestedActiveId
          }
        : null;
    })
    .filter((tab): tab is ViewTab => Boolean(tab));
  if (!restoredTabs.length) return false;

  const active =
    restoredTabs.find((tab) => tab.id === requestedActiveId) ??
    restoredTabs[0]!;
  if (!workspaceDisposed && route.fullPath !== active.fullPath) {
    tabActivationNavigation = true;
    try {
      await router.replace(active.fullPath);
      await nextTick();
    } finally {
      tabActivationNavigation = false;
    }
  }

  tabs.value = restoredTabs;
  nextTabId = Math.max(
    nextTabId,
    ...restoredTabs.map((tab) => {
      const match = tab.id.match(/view-tab-(\d+)/);
      return match ? Number(match[1]) + 1 : 1;
    })
  );
  const validIds = new Set(restoredTabs.map((tab) => tab.id));
  leftTabIds.value = saved.leftTabIds.filter((id) => validIds.has(id));
  rightTabIds.value = saved.rightTabIds.filter((id) => validIds.has(id));
  activeTabId.value = active.id;
  leftActiveId.value = validIds.has(saved.leftActiveId)
    ? saved.leftActiveId
    : leftTabIds.value[0] ?? "";
  rightActiveId.value = validIds.has(saved.rightActiveId)
    ? saved.rightActiveId
    : rightTabIds.value[0] ?? "";
  splitRatio.value = Math.max(25, Math.min(75, saved.splitRatio || 50));
  ensureGroupState();

  workspaceGeneration.value += 1;
  return true;
};

const scheduleWorkspaceSave = () => {
  if (!workspaceReady) return;
  if (saveTimer) clearTimeout(saveTimer);
  const environment = workspaceEnvironment;
  const workspace = serializeWorkspace();
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveWorkspaceState("dashboard", environment, workspace);
  }, 250);
};

const cancelScheduledWorkspaceSave = () => {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
};

const restoreWorkspace = async (environment?: string) => {
  workspaceEnvironment =
    environment ??
    (await getNetsuiteEnvironment().catch(() => "unknown"));
  if (workspaceDisposed) return false;

  const saved = await getWorkspaceState<unknown>(
    "dashboard",
    workspaceEnvironment
  );
  if (workspaceDisposed) return false;
  return applySavedWorkspace(saved);
};

const loadWorkspaceSnapshots = async () => {
  workspaceLibraryLoading.value = true;
  try {
    const stored = await getWorkspaceState<unknown>(
      "dashboard-snapshots",
      workspaceEnvironment
    );
    workspaceSnapshots.value = Array.isArray(stored)
      ? stored
          .map(normalizeWorkspaceSnapshot)
          .filter(
            (snapshot): snapshot is WorkspaceSnapshot => Boolean(snapshot)
          )
      : [];
  } finally {
    workspaceLibraryLoading.value = false;
  }
};

const openWorkspaceLibrary = async () => {
  workspaceLibraryOpen.value = true;
  workspaceSnapshotName.value = "";
  await loadWorkspaceSnapshots();
  await nextTick();
  document
    .querySelector<HTMLInputElement>(".workspace-library-create input")
    ?.focus();
};

const saveWorkspaceSnapshot = async () => {
  const name = workspaceSnapshotName.value.trim();
  if (!name || tabs.value.length === 0) return;

  const existing = workspaceSnapshots.value.find(
    (snapshot) => snapshot.name.toLowerCase() === name.toLowerCase()
  );
  const snapshot: WorkspaceSnapshot = {
    id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    createdAt: Date.now(),
    workspace: serializeWorkspace()
  };
  const nextSnapshots = [
    snapshot,
    ...workspaceSnapshots.value.filter((item) => item.id !== snapshot.id)
  ];
  await saveWorkspaceState(
    "dashboard-snapshots",
    workspaceEnvironment,
    nextSnapshots
  );
  workspaceSnapshots.value = nextSnapshots;
  workspaceSnapshotName.value = "";
};

const restoreWorkspaceSnapshot = async (snapshot: WorkspaceSnapshot) => {
  workspaceLibraryOpen.value = false;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  const previousWorkspace = serializeWorkspace();
  workspaceReady = false;
  workspaceSwitching.value = true;
  try {
    const restored = await applySavedWorkspace(snapshot.workspace);
    if (!restored) {
      await applySavedWorkspace(previousWorkspace);
      return;
    }
    await saveWorkspaceState(
      "dashboard",
      workspaceEnvironment,
      serializeWorkspace()
    );
  } finally {
    workspaceReady = true;
    workspaceSwitching.value = false;
  }
};

const deleteWorkspaceSnapshot = async (snapshotId: string) => {
  const nextSnapshots = workspaceSnapshots.value.filter(
    (snapshot) => snapshot.id !== snapshotId
  );
  await saveWorkspaceState(
    "dashboard-snapshots",
    workspaceEnvironment,
    nextSnapshots
  );
  workspaceSnapshots.value = nextSnapshots;
};

const formatSnapshotDate = (timestamp: number) =>
  new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

const switchWorkspaceEnvironment = async (nextEnvironment: string) => {
  if (workspaceDisposed || nextEnvironment === workspaceEnvironment) return;

  cancelScheduledWorkspaceSave();
  const previousEnvironment = workspaceEnvironment;
  const previousWorkspace = workspaceReady ? serializeWorkspace() : null;
  workspaceReady = false;
  workspaceSwitching.value = true;

  // Unmount every account-bound view before restoring the next workspace.
  // Tab IDs are intentionally stable in storage, so merely replacing the tab
  // array lets Vue reuse old component instances and their stale API state.
  tabs.value = [];
  activeTabId.value = "";
  leftTabIds.value = [];
  rightTabIds.value = [];
  leftActiveId.value = "";
  rightActiveId.value = "";
  workspaceGeneration.value += 1;
  await nextTick();

  try {
    if (previousWorkspace) {
      await saveWorkspaceState(
        "dashboard",
        previousEnvironment,
        previousWorkspace
      );
    }

    const restored = await restoreWorkspace(nextEnvironment);
    if (restored) return;

    tabs.value = [];
    activeTabId.value = "";
    leftTabIds.value = [];
    rightTabIds.value = [];
    leftActiveId.value = "";
    rightActiveId.value = "";
    await router.replace("/");
    ensureRouteTab(router.currentRoute.value);
  } finally {
    workspaceReady = true;
    workspaceSwitching.value = false;
  }
};

const handleWorkspaceEnvironmentChanged = (event: Event) => {
  const requestedEnvironment = (event as CustomEvent<string>).detail;
  workspaceTransitionQueue = workspaceTransitionQueue
    .catch(() => undefined)
    .then(async () => {
      const nextEnvironment =
        requestedEnvironment ||
        (await getNetsuiteEnvironment().catch(() => "unknown"));
      await switchWorkspaceEnvironment(nextEnvironment);
    });
};

const newHomeTab = async (group?: TabGroup) => {
  const tab = tabFromPath("/");
  if (!tab) return;

  tabs.value.push(tab);
  activeTabId.value = tab.id;

  if (group && isSplit.value) {
    addTabToGroup(tab.id, group);
    if (group === "left") leftActiveId.value = tab.id;
    else rightActiveId.value = tab.id;
  }

  await activateTab(tab.id);
};

const onTabBarWheel = (event: WheelEvent) => {
  const target = event.currentTarget as HTMLElement;
  target.scrollLeft += event.deltaY || event.deltaX;
};

const onTabDragStart = (event: DragEvent, tabId: string, group: TabGroup | null = null) => {
  draggingTabId.value = tabId;
  draggingGroup.value = group;
  event.dataTransfer?.setData("text/plain", tabId);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
};

const onTabDragEnd = () => {
  draggingTabId.value = null;
  draggingGroup.value = null;
  reorderTarget.value = null;
  splitDropSide.value = null;
  dropZone.value = null;
};

const onTabItemDragOver = (event: DragEvent, targetId: string) => {
  if (!draggingTabId.value || draggingTabId.value === targetId) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  reorderTarget.value = {
    id: targetId,
    side: event.clientX < rect.left + rect.width / 2 ? "before" : "after"
  };
};

const reorderTabs = (sourceId: string, targetId: string, side: "before" | "after") => {
  const source = findTab(sourceId);
  if (!source || sourceId === targetId) return;
  tabs.value = tabs.value.filter((tab) => tab.id !== sourceId);
  const targetIndex = tabs.value.findIndex((tab) => tab.id === targetId);
  const insertIndex = side === "before" ? targetIndex : targetIndex + 1;
  tabs.value.splice(Math.max(0, insertIndex), 0, source);
};

const addTabToGroup = (tabId: string, group: TabGroup) => {
  leftTabIds.value = leftTabIds.value.filter((id) => id !== tabId);
  rightTabIds.value = rightTabIds.value.filter((id) => id !== tabId);
  const list = group === "left" ? leftTabIds.value : rightTabIds.value;
  if (!list.includes(tabId)) list.push(tabId);
};

const onTabItemDrop = async (_event: DragEvent, targetId: string) => {
  if (!draggingTabId.value || !reorderTarget.value) return;
  const sourceId = draggingTabId.value;
  const targetGroup = leftTabIds.value.includes(targetId)
    ? "left"
    : rightTabIds.value.includes(targetId)
      ? "right"
      : null;

  reorderTabs(sourceId, targetId, reorderTarget.value.side);
  if (targetGroup) addTabToGroup(sourceId, targetGroup);
  await activateTab(sourceId);
  onTabDragEnd();
};

const onSingleTabbarDragOver = (event: DragEvent) => {
  if (!draggingTabId.value) return;
  event.preventDefault();
  dropZone.value = "single";
};

const onSingleTabbarDrop = async () => {
  if (draggingTabId.value) await activateTab(draggingTabId.value);
  onTabDragEnd();
};

const onTabbarDragOver = (_event: DragEvent, group: TabGroup) => {
  if (!draggingTabId.value) return;
  dropZone.value = group === "left" ? "group-left" : "group-right";
};

const onTabbarDrop = async (_event: DragEvent, group: TabGroup) => {
  if (!draggingTabId.value) return;
  addTabToGroup(draggingTabId.value, group);
  if (group === "left") leftActiveId.value = draggingTabId.value;
  else rightActiveId.value = draggingTabId.value;
  ensureGroupState();
  await activateTab(draggingTabId.value);
  onTabDragEnd();
};

const onDropSplit = async (side: TabGroup) => {
  const draggedId = draggingTabId.value;
  if (!draggedId || tabs.value.length < 2) {
    onTabDragEnd();
    return;
  }

  const otherIds = tabs.value.map((tab) => tab.id).filter((id) => id !== draggedId);
  if (side === "left") {
    leftTabIds.value = [draggedId];
    rightTabIds.value = otherIds;
    leftActiveId.value = draggedId;
    rightActiveId.value = activeTabId.value === draggedId ? otherIds[0] ?? "" : activeTabId.value;
  } else {
    leftTabIds.value = otherIds;
    rightTabIds.value = [draggedId];
    leftActiveId.value = activeTabId.value === draggedId ? otherIds[0] ?? "" : activeTabId.value;
    rightActiveId.value = draggedId;
  }

  ensureGroupState();
  await activateTab(draggedId);
  onTabDragEnd();
};

const getTabStyle = (tabId: string) => {
  const visibleSingle = !isSplit.value && tabId === activeTabId.value;
  const visibleLeft = isSplit.value && tabId === leftActiveId.value;
  const visibleRight = isSplit.value && tabId === rightActiveId.value;
  const visible = visibleSingle || visibleLeft || visibleRight;

  const base = {
    position: "absolute",
    top: "0",
    bottom: "0",
    overflow: "hidden",
    display: visible ? "flex" : "none",
    flexDirection: "column",
    minWidth: "0"
  } as Record<string, string>;

  if (!isSplit.value) {
    return { ...base, left: "0", right: "0" };
  }

  if (visibleLeft) {
    return { ...base, left: "0", width: `calc(${splitRatio.value}% - 2.5px)` };
  }

  if (visibleRight) {
    return {
      ...base,
      left: `calc(${splitRatio.value}% + 2.5px)`,
      right: "0"
    };
  }

  return base;
};

const startSplitResize = (event: MouseEvent) => {
  isResizingSplit.value = true;
  event.preventDefault();
  window.addEventListener("mousemove", onSplitResize);
  window.addEventListener("mouseup", stopSplitResize);
};

const onSplitResize = (event: MouseEvent) => {
  if (!isResizingSplit.value || !workspaceRef.value) return;
  const rect = workspaceRef.value.getBoundingClientRect();
  const ratio = ((event.clientX - rect.left) / rect.width) * 100;
  splitRatio.value = Math.max(25, Math.min(75, ratio));
};

const stopSplitResize = () => {
  isResizingSplit.value = false;
  window.removeEventListener("mousemove", onSplitResize);
  window.removeEventListener("mouseup", stopSplitResize);
};

watch(
  () => route.fullPath,
  () => {
    if (workspaceReady) ensureRouteTab(route);
  }
);

watch(tabs, ensureGroupState, { deep: true });
watch(
  [tabs, activeTabId, leftTabIds, rightTabIds, leftActiveId, rightActiveId, splitRatio],
  scheduleWorkspaceSave,
  { deep: true }
);

onMounted(async () => {
  workspaceDisposed = false;
  await router.isReady();
  if (workspaceDisposed) return;
  const restored = await restoreWorkspace();
  if (workspaceDisposed) return;
  if (!restored) ensureRouteTab(route);
  workspaceReady = true;
  window.addEventListener("keydown", handleWorkspaceShortcut);
  window.addEventListener("mousedown", hideTabContextMenu);
  window.addEventListener(
    "magic-netsuite-environment-changed",
    handleWorkspaceEnvironmentChanged
  );
});

onBeforeUnmount(() => {
  const environment = workspaceEnvironment;
  const workspace = workspaceReady ? serializeWorkspace() : null;
  workspaceDisposed = true;
  workspaceReady = false;
  stopSplitResize();
  cancelScheduledWorkspaceSave();
  if (workspace) {
    void saveWorkspaceState("dashboard", environment, workspace);
  }
  window.removeEventListener("keydown", handleWorkspaceShortcut);
  window.removeEventListener("mousedown", hideTabContextMenu);
  window.removeEventListener(
    "magic-netsuite-environment-changed",
    handleWorkspaceEnvironmentChanged
  );
});
</script>

<template>
  <div ref="workspaceRef" class="view-tabs-workspace">
    <div
      v-show="!isSplit"
      class="view-tabbar"
      :class="{ 'view-tabbar--drop-active': dropZone === 'single' }"
      @dragover="onSingleTabbarDragOver"
      @dragleave="dropZone = null"
      @drop.prevent="onSingleTabbarDrop"
    >
      <div class="view-tabbar-tabs" @wheel.prevent="onTabBarWheel">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="view-tab"
          :class="{
            'view-tab--active': tab.id === activeTabId,
            'view-tab--drop-before': reorderTarget?.id === tab.id && reorderTarget?.side === 'before',
            'view-tab--drop-after': reorderTarget?.id === tab.id && reorderTarget?.side === 'after'
          }"
          draggable="true"
          @click="activateTab(tab.id)"
          @mousedown.middle.prevent="closeTab(tab.id)"
          @dragstart="onTabDragStart($event, tab.id)"
          @dragend="onTabDragEnd"
          @dragover="onTabItemDragOver($event, tab.id)"
          @dragleave="reorderTarget = null"
          @drop.prevent.stop="onTabItemDrop($event, tab.id)"
          @contextmenu.prevent.stop="showTabContextMenu($event, tab.id)"
        >
          <span class="view-tab-label">{{ tab.label }}</span>
          <button
            v-if="tabs.length > 1"
            class="view-tab-close"
            title="Close tab"
            @click.stop="closeTab(tab.id)"
          >
            <i class="pi pi-times"></i>
          </button>
        </div>
        <button
          class="view-tab-add"
          :title="`New tab (${formatKeyboardShortcut(settings.newDashboardTab)})`"
          @click="newHomeTab()"
        >
          <i class="pi pi-plus"></i>
        </button>
        <button
          v-if="closedTabs.length"
          class="view-tab-add"
          :title="`Reopen closed tab (${formatKeyboardShortcut(settings.reopenClosedTab)})`"
          @click="reopenClosedTab"
        >
          <i class="pi pi-history"></i>
        </button>
        <button
          class="view-tab-add"
          title="Workspace library"
          @click="openWorkspaceLibrary"
        >
          <i class="pi pi-briefcase"></i>
        </button>
      </div>
    </div>

    <div v-show="isSplit" class="view-split-tabbars">
      <div :style="{ width: `calc(${splitRatio}% - 2.5px)`, minWidth: 0 }">
        <div
          class="view-tabbar view-split-tabbar"
          :class="{ 'view-tabbar--drop-active': dropZone === 'group-left' }"
          @dragover.prevent="onTabbarDragOver($event, 'left')"
          @dragleave="dropZone = null"
          @drop.prevent="onTabbarDrop($event, 'left')"
        >
          <div class="view-tabbar-tabs" @wheel.prevent="onTabBarWheel">
            <div
              v-for="tab in leftTabs"
              :key="tab.id"
              class="view-tab"
              :class="{
                'view-tab--active': tab.id === leftActiveId,
                'view-tab--focused': tab.id === activeTabId,
                'view-tab--drop-before': reorderTarget?.id === tab.id && reorderTarget?.side === 'before',
                'view-tab--drop-after': reorderTarget?.id === tab.id && reorderTarget?.side === 'after'
              }"
              draggable="true"
              @click="activateTab(tab.id)"
              @mousedown.middle.prevent="closeTab(tab.id)"
              @dragstart="onTabDragStart($event, tab.id, 'left')"
              @dragend="onTabDragEnd"
              @dragover="onTabItemDragOver($event, tab.id)"
              @dragleave="reorderTarget = null"
              @drop.prevent.stop="onTabItemDrop($event, tab.id)"
              @contextmenu.prevent.stop="showTabContextMenu($event, tab.id)"
            >
              <span class="view-tab-label">{{ tab.label }}</span>
              <button class="view-tab-close" title="Close tab" @click.stop="closeTab(tab.id)">
                <i class="pi pi-times"></i>
              </button>
            </div>
            <button
              class="view-tab-add"
              :title="`New tab (${formatKeyboardShortcut(settings.newDashboardTab)})`"
              @click="newHomeTab('left')"
            >
              <i class="pi pi-plus"></i>
            </button>
            <button
              v-if="closedTabs.length"
              class="view-tab-add"
              :title="`Reopen closed tab (${formatKeyboardShortcut(settings.reopenClosedTab)})`"
              @click="reopenClosedTab"
            >
              <i class="pi pi-history"></i>
            </button>
          </div>
        </div>
      </div>

      <div class="view-split-tabbars-sep"></div>

      <div style="flex: 1; min-width: 0">
        <div
          class="view-tabbar view-split-tabbar"
          :class="{ 'view-tabbar--drop-active': dropZone === 'group-right' }"
          @dragover.prevent="onTabbarDragOver($event, 'right')"
          @dragleave="dropZone = null"
          @drop.prevent="onTabbarDrop($event, 'right')"
        >
          <div class="view-tabbar-tabs" @wheel.prevent="onTabBarWheel">
            <div
              v-for="tab in rightTabs"
              :key="tab.id"
              class="view-tab"
              :class="{
                'view-tab--active': tab.id === rightActiveId,
                'view-tab--focused': tab.id === activeTabId,
                'view-tab--drop-before': reorderTarget?.id === tab.id && reorderTarget?.side === 'before',
                'view-tab--drop-after': reorderTarget?.id === tab.id && reorderTarget?.side === 'after'
              }"
              draggable="true"
              @click="activateTab(tab.id)"
              @mousedown.middle.prevent="closeTab(tab.id)"
              @dragstart="onTabDragStart($event, tab.id, 'right')"
              @dragend="onTabDragEnd"
              @dragover="onTabItemDragOver($event, tab.id)"
              @dragleave="reorderTarget = null"
              @drop.prevent.stop="onTabItemDrop($event, tab.id)"
              @contextmenu.prevent.stop="showTabContextMenu($event, tab.id)"
            >
              <span class="view-tab-label">{{ tab.label }}</span>
              <button class="view-tab-close" title="Close tab" @click.stop="closeTab(tab.id)">
                <i class="pi pi-times"></i>
              </button>
            </div>
            <button
              class="view-tab-add"
              :title="`New tab (${formatKeyboardShortcut(settings.newDashboardTab)})`"
              @click="newHomeTab('right')"
            >
              <i class="pi pi-plus"></i>
            </button>
            <button
              v-if="closedTabs.length"
              class="view-tab-add"
              :title="`Reopen closed tab (${formatKeyboardShortcut(settings.reopenClosedTab)})`"
              @click="reopenClosedTab"
            >
              <i class="pi pi-history"></i>
            </button>
            <button
              class="view-tab-add"
              title="Workspace library"
              @click="openWorkspaceLibrary"
            >
              <i class="pi pi-briefcase"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="view-pane-host" :class="{ 'view-pane-host--split-drag': draggingTabId && !isSplit }">
      <div v-if="workspaceSwitching" class="view-workspace-switching">
        <i class="pi pi-spin pi-spinner"></i>
        <span>Loading account workspace...</span>
      </div>
      <div
        class="view-split-overlay view-split-overlay--left"
        :class="{ 'view-split-overlay--active': splitDropSide === 'left' }"
        @dragover.prevent="splitDropSide = 'left'"
        @dragleave="splitDropSide = null"
        @drop.prevent="onDropSplit('left')"
      >
        <i class="pi pi-objects-column"></i>
        Split Left
      </div>
      <div
        class="view-split-overlay view-split-overlay--right"
        :class="{ 'view-split-overlay--active': splitDropSide === 'right' }"
        @dragover.prevent="splitDropSide = 'right'"
        @dragleave="splitDropSide = null"
        @drop.prevent="onDropSplit('right')"
      >
        Split Right
        <i class="pi pi-objects-column"></i>
      </div>

      <div
        v-show="isSplit"
        class="view-split-handle"
        :style="{ left: splitRatio + '%' }"
        @mousedown="startSplitResize"
      ></div>

      <main
        v-for="tab in tabs"
        :key="`${workspaceGeneration}:${tab.id}:${tabReloadVersions[tab.id] ?? 0}`"
        class="view-tab-pane"
        :style="getTabStyle(tab.id)"
        @mousedown.capture="activeTabId = tab.id"
      >
        <component
          v-if="tab.routeHydrated"
          :is="tab.component"
          :vhOffset="vhOffset"
        />
      </main>
    </div>

    <Teleport to="body">
      <div
        v-if="tabContextMenu"
        class="view-tab-context-menu"
        :style="{ left: `${tabContextMenu.x}px`, top: `${tabContextMenu.y}px` }"
        @mousedown.stop
        @contextmenu.prevent
      >
        <button type="button" @click="reloadTab(tabContextMenu.tabId)">
          <i class="pi pi-refresh"></i>
          Reload tab
        </button>
        <button type="button" @click="duplicateTab(tabContextMenu.tabId)">
          <i class="pi pi-clone"></i>
          Duplicate
        </button>
        <button type="button" @click="copyTabLink(tabContextMenu.tabId)">
          <i class="pi pi-link"></i>
          Copy link
        </button>
        <div class="view-tab-context-menu__separator"></div>
        <button type="button" @click="closeOtherTabs(tabContextMenu.tabId)">
          <i class="pi pi-times-circle"></i>
          Close others
        </button>
        <button type="button" @click="closeTabsToRight(tabContextMenu.tabId)">
          <i class="pi pi-angle-double-right"></i>
          Close tabs to the right
        </button>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="workspaceLibraryOpen"
        class="workspace-library-backdrop"
        @mousedown.self="workspaceLibraryOpen = false"
      >
        <section class="workspace-library">
          <header>
            <div>
              <strong>Workspace Library</strong>
              <span>Saved for {{ workspaceEnvironment.split(".")[0]?.toUpperCase() }}</span>
            </div>
            <button
              type="button"
              title="Close"
              @click="workspaceLibraryOpen = false"
            >
              <i class="pi pi-times"></i>
            </button>
          </header>

          <form
            class="workspace-library-create"
            @submit.prevent="saveWorkspaceSnapshot"
          >
            <input
              v-model="workspaceSnapshotName"
              placeholder="Name this workspace…"
              maxlength="80"
            />
            <button
              type="submit"
              :disabled="!workspaceSnapshotName.trim() || tabs.length === 0"
            >
              <i class="pi pi-save"></i>
              Save current layout
            </button>
          </form>

          <div class="workspace-library-list">
            <div v-if="workspaceLibraryLoading" class="workspace-library-empty">
              <i class="pi pi-spin pi-spinner"></i>
              Loading workspaces…
            </div>
            <article
              v-for="snapshot in workspaceSnapshots"
              v-else
              :key="snapshot.id"
            >
              <span class="workspace-library-item-icon">
                <i class="pi pi-objects-column"></i>
              </span>
              <span class="workspace-library-item-copy">
                <strong>{{ snapshot.name }}</strong>
                <small>
                  {{ snapshot.workspace.tabs.length }} tabs
                  <template
                    v-if="
                      snapshot.workspace.leftTabIds.length &&
                      snapshot.workspace.rightTabIds.length
                    "
                  >
                    · split {{ Math.round(snapshot.workspace.splitRatio) }}/{{ 100 - Math.round(snapshot.workspace.splitRatio) }}
                  </template>
                  · {{ formatSnapshotDate(snapshot.createdAt) }}
                </small>
              </span>
              <button
                type="button"
                title="Restore workspace"
                @click="restoreWorkspaceSnapshot(snapshot)"
              >
                <i class="pi pi-history"></i>
              </button>
              <button
                type="button"
                class="workspace-library-delete"
                title="Delete workspace"
                @click="deleteWorkspaceSnapshot(snapshot.id)"
              >
                <i class="pi pi-trash"></i>
              </button>
            </article>
            <div
              v-if="!workspaceLibraryLoading && workspaceSnapshots.length === 0"
              class="workspace-library-empty"
            >
              <i class="pi pi-briefcase"></i>
              <strong>No saved workspaces yet</strong>
              <span>Arrange your tabs and save the layout above.</span>
            </div>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.view-tabs-workspace {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  padding: 0 0.75rem 0.75rem;
}

.view-tabbar {
  display: flex;
  min-height: 34px;
  flex-shrink: 0;
  align-items: center;
  background: var(--m-slate-150, #f1f5f9);
  border: 1px solid var(--p-slate-200);
  border-bottom: none;
  border-radius: 6px 6px 0 0;
}

.view-split-tabbar {
  border-radius: 6px 6px 0 0;
}

.view-tabbar-tabs {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  padding: 3px 4px;
  scrollbar-width: none;
}

.view-tabbar-tabs::-webkit-scrollbar {
  display: none;
}

.view-tab {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
  max-width: 180px;
  padding: 4px 10px;
  border-radius: 4px;
  color: var(--p-slate-500);
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 500;
  outline: 1px solid transparent;
  user-select: none;
  white-space: nowrap;
}

.view-tab:hover {
  background: var(--p-slate-200);
  color: var(--p-slate-700);
}

.view-tab--active {
  background: var(--p-slate-600);
  color: white;
  outline-color: var(--p-slate-500);
}

.view-tab--focused {
  box-shadow: inset 0 -2px 0 var(--p-indigo-400);
}

.view-tab--drop-before {
  box-shadow: -2px 0 0 0 var(--p-indigo-500);
}

.view-tab--drop-after {
  box-shadow: 2px 0 0 0 var(--p-indigo-500);
}

.view-tab-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.view-workspace-switching {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--p-slate-50);
  color: var(--p-slate-500);
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

.view-tab-context-menu {
  position: fixed;
  z-index: 100000;
  display: flex;
  width: 210px;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  background: white;
  padding: 5px;
  box-shadow: 0 14px 38px rgba(15, 23, 42, 0.22);
}

.view-tab-context-menu button {
  display: flex;
  align-items: center;
  gap: 9px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--p-slate-700);
  cursor: pointer;
  padding: 7px 8px;
  text-align: left;
  font-size: 0.75rem;
}

.view-tab-context-menu button:hover {
  background: var(--p-slate-100);
}

.view-tab-context-menu button i {
  width: 14px;
  color: var(--p-indigo-500);
  font-size: 0.72rem;
}

.view-tab-context-menu__separator {
  height: 1px;
  margin: 3px 2px;
  background: var(--p-slate-200);
}

.workspace-library-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.46);
  padding: 18px;
  backdrop-filter: blur(3px);
}

.workspace-library {
  display: flex;
  width: min(680px, 96vw);
  max-height: min(720px, 90vh);
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 12px;
  background: white;
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.32);
}

.workspace-library > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 13px 15px;
}

.workspace-library > header > div,
.workspace-library-item-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.workspace-library > header strong {
  color: var(--p-slate-800);
  font-size: 0.9rem;
}

.workspace-library > header span {
  color: var(--p-indigo-500);
  font-family: var(--font-mono);
  font-size: 0.68rem;
}

.workspace-library button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  background: white;
  color: var(--p-slate-600);
  cursor: pointer;
}

.workspace-library button:hover:not(:disabled) {
  border-color: var(--p-indigo-300);
  background: var(--p-indigo-50);
  color: var(--p-indigo-700);
}

.workspace-library button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.workspace-library > header button {
  width: 30px;
  height: 30px;
}

.workspace-library-create {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  padding: 11px 13px;
}

.workspace-library-create input {
  min-width: 0;
  flex: 1;
  border: 1px solid var(--p-slate-300);
  border-radius: 6px;
  background: white;
  color: var(--p-slate-800);
  padding: 8px 10px;
  font: inherit;
  font-size: 0.78rem;
  outline: none;
}

.workspace-library-create input:focus {
  border-color: var(--p-indigo-400);
  box-shadow: 0 0 0 2px var(--p-indigo-100);
}

.workspace-library-create button {
  border-color: var(--p-indigo-200);
  background: var(--p-indigo-50);
  color: var(--p-indigo-700);
  padding: 0 12px;
  font-size: 0.72rem;
  font-weight: 700;
}

.workspace-library-list {
  min-height: 220px;
  overflow-y: auto;
  padding: 8px;
}

.workspace-library-list article {
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 8px;
  padding: 9px;
}

.workspace-library-list article:hover {
  background: var(--p-slate-50);
}

.workspace-library-item-icon {
  display: inline-flex;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--p-indigo-100);
  border-radius: 8px;
  background: var(--p-indigo-50);
  color: var(--p-indigo-600);
}

.workspace-library-item-copy {
  flex: 1;
}

.workspace-library-item-copy strong {
  overflow: hidden;
  color: var(--p-slate-700);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-library-item-copy small {
  color: var(--p-slate-400);
  font-size: 0.66rem;
}

.workspace-library-list article > button {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
}

.workspace-library-delete:hover {
  border-color: var(--p-red-200) !important;
  background: var(--p-red-50) !important;
  color: var(--p-red-600) !important;
}

.workspace-library-empty {
  display: flex;
  min-height: 210px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: var(--p-slate-400);
  text-align: center;
  font-size: 0.72rem;
}

.workspace-library-empty > i {
  color: var(--p-indigo-400);
  font-size: 1.3rem;
}

.workspace-library-empty strong {
  color: var(--p-slate-600);
  font-size: 0.8rem;
}

.view-tab-close,
.view-tab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.view-tab-close {
  width: 16px;
  height: 16px;
  opacity: 0.65;
}

.view-tab-close i {
  font-size: 0.6rem;
}

.view-tab-close:hover {
  background: rgba(255, 255, 255, 0.22);
  opacity: 1;
}

.view-tab-add {
  width: 24px;
  height: 24px;
  color: var(--p-slate-500);
  flex-shrink: 0;
}

.view-tab-add:hover {
  background: var(--p-slate-200);
}

.view-tabbar--drop-active {
  background: var(--p-indigo-50);
  outline: 1px dashed var(--p-indigo-400);
  outline-offset: -2px;
}

.view-split-tabbars {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
}

.view-split-tabbars-sep {
  width: 5px;
  flex-shrink: 0;
  background: var(--p-slate-200);
}

.view-pane-host {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 0 0 6px 6px;
  background: rgba(255, 255, 255, 0.55);
}

.view-tab-pane {
  padding: 0.75rem;
}

.view-split-overlay {
  position: absolute;
  top: 8px;
  bottom: 8px;
  z-index: 20;
  display: flex;
  width: 38%;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 2px dashed transparent;
  border-radius: 6px;
  color: var(--p-indigo-600);
  font-size: 0.78rem;
  font-weight: 600;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s, background 0.12s, border-color 0.12s;
  user-select: none;
}

.view-split-overlay--left {
  left: 8px;
}

.view-split-overlay--right {
  right: 8px;
}

.view-pane-host--split-drag .view-split-overlay {
  opacity: 1;
  pointer-events: all;
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.35);
}

.view-split-overlay--active,
.view-pane-host--split-drag .view-split-overlay:hover {
  background: rgba(99, 102, 241, 0.22);
  border-color: var(--p-indigo-500);
}

.view-split-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 5;
  width: 5px;
  transform: translateX(-50%);
  background: var(--p-slate-200);
  cursor: col-resize;
}

.view-split-handle:hover,
.view-split-handle:active {
  background: var(--p-indigo-300);
}
</style>
