<script setup lang="ts">
import { RouterView, useRouter } from "vue-router";
import ItemListNavigation from "./components/ItemListNavigation.vue";
import { getRouteMap } from "./router/routesMap";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useVhOffset } from "./composables/useVhOffset";
import { Toast } from "primevue";
import MagicNetsuiteLogo from "./components/MagicNetsuiteLogo.vue";

const container = ref<HTMLElement | null>(null);
const { vhOffset } = useVhOffset(container);

type PanelAction = "open" | "close";

const sendPanelState = (action: PanelAction): void => {
  chrome.runtime.sendMessage({
    type: "PANEL_STATE",
    payload: action,
  });
};

const router = useRouter();

onMounted(async () => {
  try {
    // Open Panel on a specific route
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "OPEN_VIEW") {
        router.push({ name: message.view });
      }
    });

    chrome.storage.session.get("openView", (result) => {
      console.log("openView", result);
      if (result?.openView) {
        router.push({ name: result.openView });
        chrome.storage.session.remove("openView");
      }
    });

    // Port Detection
    const port = chrome.runtime.connect({ name: "sidePanel" });

    // Optional: detect disconnect from background
    port.onDisconnect.addListener(() => {
      console.log("Disconnected from background (cleanup if needed)");
    });
  } catch (error) {
    console.log("Error", error);
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
  <ItemListNavigation :links="getRouteMap()" />
  <MagicNetsuiteLogo
    class="logo-bg-decoration"
    width="25rem"
    fill="var(--p-slate-200)"
  />
  <main ref="container">
    <RouterView :vhOffset="vhOffset" />
  </main>
</template>

<style scoped>
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}
.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}
.logo.vue:hover {
  filter: drop-shadow(0 0 2em #42b883aa);
}

main {
  height: 100%;
  overflow: hidden;
  padding: 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  position: relative;
}

.logo-bg-decoration {
  position: absolute;
  top: 50%;
  right: 50%;
  transform: translate(50%, -50%);
}
</style>
