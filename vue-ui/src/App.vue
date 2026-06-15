<script setup lang="ts">
import { RouterView, useRouter, useRoute } from "vue-router";
import AppHeader from "./components/AppHeader.vue";
import { getRouteMap } from "./router/routesMap";
import { onBeforeUnmount, onMounted, ref, computed } from "vue";
import { useVhOffset } from "./composables/useVhOffset";
import { Toast } from "primevue";
import GridPattern from "./components/universal/patterns/GridPattern.vue";
import ViewTabsWorkspace from "./components/ViewTabsWorkspace.vue";

const container = ref<HTMLElement | null>(null);
const { vhOffset } = useVhOffset(container);
const route = useRoute();

const isAdmin = import.meta.env.VITE_PRIVILEGE_LEVEL === "ADMIN";

const isProcessingRoute = computed(() => route.path === "/processing");

type PanelAction = "open" | "close";

const sendPanelState = (action: PanelAction): void => {
  chrome.runtime.sendMessage({
    type: "PANEL_STATE",
    payload: action
  });
};

const router = useRouter();

onMounted(async () => {
  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "OPEN_VIEW") {
        router.push({ name: message.view });
      }
    });

    chrome.storage.session.get("openView", (result) => {
      if (isAdmin) console.log("openView", result);
      if (result?.openView) {
        router.push({ name: result.openView });
        chrome.storage.session.remove("openView");
      }
    });

    const port = chrome.runtime.connect({ name: "sidePanel" });

    port.onDisconnect.addListener(() => {
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
  window.removeEventListener("beforeunload", handleUnload);
});
</script>

<template>
  <Toast />
  <GridPattern v-if="!isProcessingRoute" class="app-background-decoration" />
  <AppHeader v-if="!isProcessingRoute" />

  <main v-if="!isProcessingRoute" ref="container" class="tabbed-shell">
    <ViewTabsWorkspace data-ignore :vhOffset="vhOffset" />
  </main>

  <RouterView v-else v-slot="{ Component, route }">
    <transition name="subtle-fade" mode="out-in">
      <main
        ref="container"
        :class="{ 'full-screen': isProcessingRoute }"
        :key="route.fullPath"
      >
        <component :is="Component" :vhOffset="vhOffset" />
      </main>
    </transition>
  </RouterView>
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
