<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, type RouteLocationNormalizedLoaded } from "vue-router";
import { routes } from "../router/routesMap";

type TabGroup = "left" | "right";

type ViewTab = {
  id: string;
  fullPath: string;
  label: string;
  component: unknown;
};

type ReorderTarget = {
  id: string;
  side: "before" | "after";
} | null;

defineProps<{
  vhOffset: number;
}>();

const route = useRoute();
const router = useRouter();
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
let tabActivationNavigation = false;
let nextTabId = 1;

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
    component
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
    component
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
};

const closeTab = async (tabId: string) => {
  if (tabs.value.length <= 1) return;

  const wasActive = activeTabId.value === tabId;
  const index = tabs.value.findIndex((tab) => tab.id === tabId);
  tabs.value = tabs.value.filter((tab) => tab.id !== tabId);
  leftTabIds.value = leftTabIds.value.filter((id) => id !== tabId);
  rightTabIds.value = rightTabIds.value.filter((id) => id !== tabId);
  ensureGroupState();

  if (!wasActive) return;

  const nextTab =
    tabs.value[Math.max(0, Math.min(index, tabs.value.length - 1))] ?? tabs.value[0];
  if (nextTab) await activateTab(nextTab.id);
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
  () => ensureRouteTab(route)
);

watch(tabs, ensureGroupState, { deep: true });

onMounted(async () => {
  await router.isReady();
  ensureRouteTab(route);
});

onBeforeUnmount(() => {
  stopSplitResize();
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
        <button class="view-tab-add" title="New tab" @click="newHomeTab()">
          <i class="pi pi-plus"></i>
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
            >
              <span class="view-tab-label">{{ tab.label }}</span>
              <button class="view-tab-close" title="Close tab" @click.stop="closeTab(tab.id)">
                <i class="pi pi-times"></i>
              </button>
            </div>
            <button class="view-tab-add" title="New tab" @click="newHomeTab('left')">
              <i class="pi pi-plus"></i>
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
            >
              <span class="view-tab-label">{{ tab.label }}</span>
              <button class="view-tab-close" title="Close tab" @click.stop="closeTab(tab.id)">
                <i class="pi pi-times"></i>
              </button>
            </div>
            <button class="view-tab-add" title="New tab" @click="newHomeTab('right')">
              <i class="pi pi-plus"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="view-pane-host" :class="{ 'view-pane-host--split-drag': draggingTabId && !isSplit }">
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
        :key="tab.id"
        class="view-tab-pane"
        :style="getTabStyle(tab.id)"
        @mousedown.capture="activeTabId = tab.id"
      >
        <component :is="tab.component" :vhOffset="vhOffset" />
      </main>
    </div>
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
