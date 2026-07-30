<script setup lang="ts">
import {
  RouterView,
  useRouter,
  useRoute,
  type RouteRecordNameGeneric
} from "vue-router";
import AppHeader from "./components/AppHeader.vue";
import { getRouteMap } from "./router/routesMap";
import { onBeforeUnmount, onMounted, ref, computed } from "vue";
import { useVhOffset } from "./composables/useVhOffset";
import { Toast } from "primevue";
import GridPattern from "./components/universal/patterns/GridPattern.vue";
import ViewTabsWorkspace from "./components/ViewTabsWorkspace.vue";
import { openDashboardTab } from "./utils/dashboardTabs";
import AppErrorBoundary from "./components/AppErrorBoundary.vue";

const container = ref<HTMLElement | null>(null);
const { vhOffset } = useVhOffset(container);
const route = useRoute();

const isAdmin = import.meta.env.VITE_PRIVILEGE_LEVEL === "ADMIN";

const isTemplateReviewRoute = computed(() => route.name === "TemplateReview");
const appSearchParams = new URLSearchParams(window.location.search);
const isExecutionSurface = appSearchParams.has("magicExecutionSurface");
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
    payload: action
  });
};

const router = useRouter();
let sidePanelPort: chrome.runtime.Port | null = null;

const handleRuntimeMessage = (message: { type?: string; view?: string }) => {
  if (
    message.type === "OPEN_TEMPLATE_STUDIO" &&
    (isDashboardPreview || isEmbeddedDashboard)
  ) {
    openDashboardTab("/template-studio", {
      label: "Template Studio",
      reuseExisting: true
    });
    return;
  }
  if (message.type === "OPEN_VIEW" && message.view) {
    if (isExecutionSurface) return;
    void router.push({ name: message.view });
  }
};

onMounted(async () => {
  try {
    if (isDashboardPreview || isTemplateReviewWindow) {
      document.title = "Magic NetSuite";
      document
        .querySelectorAll<HTMLLinkElement>(
          'link[rel="icon"], link[rel="shortcut icon"]'
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
  chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  window.removeEventListener("beforeunload", handleUnload);
  sidePanelPort?.disconnect();
  sidePanelPort = null;
});
</script>

<template>
  <Toast />
  <AppErrorBoundary>
    <GridPattern v-if="!isStandaloneRoute" class="app-background-decoration" />
    <AppHeader v-if="!isStandaloneRoute" />

    <main v-if="!isStandaloneRoute" ref="container" class="tabbed-shell">
      <ViewTabsWorkspace data-ignore :vhOffset="vhOffset" />
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
