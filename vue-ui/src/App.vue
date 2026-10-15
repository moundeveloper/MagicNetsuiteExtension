<script setup lang="ts">
import {
  RouterView,
  useRouter,
  useRoute,
  type RouteRecordNameGeneric,
} from "vue-router";
import AppHeader from "./components/AppHeader.vue";
import { getRouteMap } from "./router/routesMap";
import { onBeforeUnmount, onMounted, ref, computed, watch } from "vue";
import { useVhOffset } from "./composables/useVhOffset";
import { Toast } from "primevue";
import GridPattern from "./components/universal/patterns/GridPattern.vue";
import ViewTabsWorkspace from "./components/ViewTabsWorkspace.vue";
import { openDashboardTab } from "./utils/dashboardTabs";
import AppErrorBoundary from "./components/AppErrorBoundary.vue";
import {
  useDashboardLaunch,
  openSavedDashboard,
} from "./features/dashboards/launch";
import { dashboardCommand, observeDashboards } from "./features/dashboards/api";
import { useSettings } from "./states/settingsState";
import {
  installDashboardWheel,
  preferredWheelItems,
  type DashboardWheelItem,
} from "../../shared/dashboardWheel";
import { getPreferredViews, RouteStatus } from "../../shared/navigationViews";
import { hasAdminAccess } from "./utils/adminAccess";
const { settings, isSettingsLoaded } = useSettings();
const wheelDashboards = ref<DashboardWheelItem[]>([]);
let disposeWheel: (() => void) | undefined;
let stopDashboardList: (() => void) | undefined;
async function refreshWheelDashboards() {
  try {
    wheelDashboards.value = await dashboardCommand("list");
  } catch {
    wheelDashboards.value = [];
  }
}
import { matchesDashboardShortcut } from "../../shared/dashboardLaunch";
const { preferences: dashboardLaunchPreferences } = useDashboardLaunch();
function handleDashboardShortcut(event: KeyboardEvent) {
  if (
    event.repeat ||
    event.isComposing ||
    event.defaultPrevented ||
    isExecutionSurface
  )
    return;
  const match = Object.entries(dashboardLaunchPreferences.value).find(
    ([, pref]) => matchesDashboardShortcut(event, pref.shortcut || ""),
  );
  if (!match) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void dashboardCommand<{ id: string; title: string }>("get", {
    dashboardId: match[0],
  })
    .then((dashboard) => openWheelDestination({ ...dashboard, mode: "" }))
    .catch((error) => console.warn("[Dashboard shortcut]", error));
}

const container = ref<HTMLElement | null>(null);
const { vhOffset } = useVhOffset(container);
const route = useRoute();

const isAdmin = import.meta.env.VITE_PRIVILEGE_LEVEL === "ADMIN";
const preferredViews = computed(() =>
  getPreferredViews(settings.preferredFeatures).filter(
    (view) =>
      (!view.adminOnly || hasAdminAccess.value) &&
      (isAdmin || view.status === RouteStatus.release),
  ),
);

const isTemplateReviewRoute = computed(() => route.name === "TemplateReview");
const appSearchParams = new URLSearchParams(window.location.search);
const isExecutionSurface = appSearchParams.has("magicExecutionSurface");
const isDashboardWidget = appSearchParams.has("magicDashboardWidget");
const isStandaloneRoute = computed(
  () => isTemplateReviewRoute.value || isExecutionSurface,
);
const isDashboardPreview = appSearchParams.has("magicDashboardPreview");
const isTemplateReviewWindow = appSearchParams.has("magicTemplateReview");
const isEmbeddedDashboard = window.self !== window.top;

type PanelAction = "open" | "close";
type OpenViewStorage = {
  openView?: RouteRecordNameGeneric;
};

const sendPanelState = (action: PanelAction): void => {
  chrome.runtime.sendMessage({
    type: "PANEL_STATE",
    payload: action,
  });
};

const router = useRouter();
let sidePanelPort: chrome.runtime.Port | null = null;
let navigatorPort: chrome.runtime.Port | null = null;
let navigatorDisposed = false;
let navigatorReconnect: ReturnType<typeof setTimeout> | undefined;

function openWheelDestination(item: DashboardWheelItem) {
  if (isDashboardWidget) {
    void chrome.runtime
      .sendMessage(
        item.kind === "view"
          ? { type: "OPEN_PREFERRED_VIEW", path: item.path }
          : { type: "OPEN_SAVED_DASHBOARD", dashboardId: item.id },
      )
      .then((response) => {
        if (!response?.ok)
          throw new Error(response?.error || "Could not open widget.");
      })
      .catch((error) => console.warn("[Dashboard widget]", error));
  } else if (item.kind === "view" && item.path)
    openDashboardTab(item.path, { label: item.title, reuseByPath: true });
  else openSavedDashboard(item);
}
const handleWidgetMessage = (event: MessageEvent) => {
  if (
    event.source !== window.parent ||
    event.data?.type !== "DASHBOARD_WIDGET_OPEN"
  )
    return;
  if (event.origin === "null") return;
  const parent = new URL(event.origin);
  if (
    !parent.hostname.endsWith(".app.netsuite.com") &&
    !(import.meta.env.DEV && parent.hostname === "127.0.0.1")
  )
    return;
  try {
    openNavigatorTab(event.data.path, event.data.label, event.data.preferred);
  } catch (error) {
    console.warn("[Dashboard widget]", error);
  }
};

function openNavigatorTab(path: string, label?: string, preferred = false) {
  if (preferred) {
    const view = preferredViews.value.find((view) => view.route === path);
    if (!view)
      throw new Error(
        "This preferred view is no longer available. Check your Home preferences and access.",
      );
    openDashboardTab(view.route, { label: view.name, reuseByPath: true });
  } else {
    if (!path.startsWith("/dashboard/"))
      throw new Error("Invalid dashboard destination.");
    openDashboardTab(path, { label });
  }
}

async function connectNavigatorWorkspace() {
  if (
    isDashboardPreview ||
    isExecutionSurface ||
    isTemplateReviewWindow ||
    isDashboardWidget
  )
    return;
  const tab = await chrome.tabs.getCurrent?.();
  if (!isEmbeddedDashboard && tab?.id) return;
  const currentWindow = await chrome.windows?.getCurrent?.();
  if (navigatorDisposed) return;
  navigatorPort = chrome.runtime.connect({ name: "navigatorWorkspace" });
  navigatorPort.onDisconnect.addListener(() => {
    navigatorPort = null;
    if (!navigatorDisposed)
      navigatorReconnect = setTimeout(() => {
        void connectNavigatorWorkspace().catch((error) =>
          console.warn("[Navigator workspace]", error),
        );
      }, 500);
  });
  navigatorPort.onMessage.addListener((message) => {
    if (message.type !== "NAVIGATOR_OPEN") return;
    if (document.visibilityState === "hidden") {
      navigatorPort?.postMessage({
        type: "NAVIGATOR_OPEN_RESULT",
        requestId: message.requestId,
      });
      return;
    }
    try {
      openNavigatorTab(message.path, message.label, message.preferred);
      navigatorPort?.postMessage({
        type: "NAVIGATOR_OPEN_RESULT",
        requestId: message.requestId,
        ok: true,
      });
    } catch (error) {
      navigatorPort?.postMessage({
        type: "NAVIGATOR_OPEN_RESULT",
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  navigatorPort.postMessage({
    type: "NAVIGATOR_REGISTER",
    kind: isEmbeddedDashboard ? "page" : "panel",
    windowId: currentWindow?.id,
  });
}

const handleRuntimeMessage = (
  message: {
    type?: string;
    view?: string;
    sessionId?: string;
    path?: string;
    label?: string;
  },
  _sender?: unknown,
  sendResponse?: (response: unknown) => void,
) => {
  if (
    message.type === "OPEN_PREFERRED_VIEW_TAB" &&
    isDashboardPreview &&
    message.sessionId === appSearchParams.get("magicDashboardPreview")
  ) {
    const view = preferredViews.value.find(
      (view) => view.route === message.path,
    );
    if (!view) {
      sendResponse?.({
        ok: false,
        error:
          "This preferred view is no longer available. Check your Home preferences and access.",
      });
      return;
    }
    openDashboardTab(view.route, { label: view.name, reuseByPath: true });
    sendResponse?.({ ok: true });
    return;
  }
  if (
    message.type === "OPEN_SAVED_DASHBOARD_VIEW" &&
    isDashboardPreview &&
    message.sessionId === appSearchParams.get("magicDashboardPreview") &&
    message.path?.startsWith("/dashboard/")
  ) {
    openDashboardTab(message.path, { label: message.label });
    sendResponse?.({ ok: true });
    return;
  }
  if (
    message.type === "OPEN_TEMPLATE_STUDIO" &&
    (isDashboardPreview || isEmbeddedDashboard)
  ) {
    openDashboardTab("/template-studio", {
      label: "Template Studio",
      reuseExisting: true,
    });
    return;
  }
  if (message.type === "OPEN_VIEW" && message.view) {
    if (isExecutionSurface) return;
    void router.push({ name: message.view });
  }
};

onMounted(async () => {
  void connectNavigatorWorkspace().catch((error) =>
    console.warn("[Navigator workspace]", error),
  );
  void refreshWheelDashboards();
  stopDashboardList = observeDashboards(() => void refreshWheelDashboards());
  disposeWheel = installDashboardWheel({
    shortcut: () => settings.dashboardWheelShortcut,
    enabled: () => !isExecutionSurface && !isTemplateReviewWindow,
    items: () => [
      ...preferredWheelItems(preferredViews.value.map((view) => view.route)),
      ...wheelDashboards.value
        .map((d) => ({
          ...d,
          pinned: Boolean(dashboardLaunchPreferences.value[d.id]?.pinned),
        }))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    ],
    open: openWheelDestination,
  });
  window.addEventListener("keydown", handleDashboardShortcut, true);
  try {
    if (isDashboardPreview || isTemplateReviewWindow) {
      document.title = "Magic NetSuite";
      document
        .querySelectorAll<HTMLLinkElement>(
          'link[rel="icon"], link[rel="shortcut icon"]',
        )
        .forEach((node) => node.remove());
      const icon = document.createElement("link");
      icon.rel = "icon";
      icon.type = "image/png";
      icon.href = chrome.runtime.getURL("icons/icon32.png");
      document.head.appendChild(icon);
    }

    if (isTemplateReviewWindow || isExecutionSurface) {
      if (isExecutionSurface) document.title = "Magic NetSuite · Execution";
      return;
    }
    if (isDashboardWidget) {
      window.addEventListener("message", handleWidgetMessage);
      if (!isSettingsLoaded.value)
        await new Promise<void>((resolve) => {
          const stop = watch(isSettingsLoaded, (loaded) => {
            if (loaded) {
              stop();
              resolve();
            }
          });
        });
      if (navigatorDisposed) return;
      window.parent.postMessage({ type: "DASHBOARD_WIDGET_READY" }, "*");
      return;
    }

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    window.addEventListener("beforeunload", handleUnload);

    chrome.storage.session.get<OpenViewStorage>("openView", (result) => {
      if (isAdmin) console.log("openView", result);
      if (result?.openView) {
        router.push({ name: result.openView });
        chrome.storage.session.remove("openView");
      }
    });

    sidePanelPort = chrome.runtime.connect({ name: "sidePanel" });

    sidePanelPort.onDisconnect.addListener(() => {
      if (isAdmin)
        console.log("Disconnected from background (cleanup if needed)");
    });
  } catch (error) {
    if (isAdmin) console.log("[App] Error", "Could not connect to background");
  }
});

const handleUnload = () => {
  sendPanelState("close");
};

onBeforeUnmount(() => {
  if (isDashboardWidget) {
    window.removeEventListener("message", handleWidgetMessage);
  }
  navigatorDisposed = true;
  clearTimeout(navigatorReconnect);
  disposeWheel?.();
  stopDashboardList?.();
  window.removeEventListener("keydown", handleDashboardShortcut, true);
  chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  window.removeEventListener("beforeunload", handleUnload);
  sidePanelPort?.disconnect();
  navigatorPort?.disconnect();
  navigatorPort = null;
  sidePanelPort = null;
});
</script>

<template>
  <Toast />
  <AppErrorBoundary>
    <GridPattern
      v-if="!isStandaloneRoute && !isDashboardWidget"
      class="app-background-decoration"
    />
    <AppHeader v-if="!isStandaloneRoute && !isDashboardWidget" />

    <main
      v-if="!isStandaloneRoute"
      ref="container"
      class="tabbed-shell"
      :class="{ 'widget-shell': isDashboardWidget }"
    >
      <ViewTabsWorkspace
        data-ignore
        :vhOffset="vhOffset"
        :ephemeral="isDashboardWidget"
      />
    </main>

    <RouterView v-else v-slot="{ Component, route }">
      <transition name="subtle-fade" mode="out-in">
        <main
          ref="container"
          :class="{ 'full-screen': isStandaloneRoute }"
          :key="route.fullPath"
        >
          <component :is="Component" :vhOffset="vhOffset" />
        </main>
      </transition>
    </RouterView>
  </AppErrorBoundary>
</template>

<style scoped>
main {
  position: relative;
  height: 100%;
  overflow: hidden;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  z-index: 1;
}
main.widget-shell {
  padding: 0;
}

.app-background-decoration {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.app-background-decoration :deep(.sci-fi-background) {
  min-height: 100vh;
}

.app-background-decoration :deep(.particle-canvas) {
  position: fixed;
}

main.full-screen {
  padding: 0;
}

main.tabbed-shell {
  padding: 0;
  gap: 0;
}

.subtle-fade-enter-active {
  transition:
    transform 0.4s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.subtle-fade-enter-from {
  transform: translateX(-20px);
  opacity: 0;
}

.subtle-fade-enter-to {
  transform: translateX(0);
  opacity: 1;
}

.subtle-fade-leave-active {
  transition: opacity 0.2s ease;
}

.subtle-fade-leave-from {
  opacity: 1;
}

.subtle-fade-leave-to {
  opacity: 0;
}
</style>
