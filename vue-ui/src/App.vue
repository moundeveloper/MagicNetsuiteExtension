<script setup lang="ts">
import { RouterView } from "vue-router";
import ItemListNavigation from "./components/ItemListNavigation.vue";
import { getRouteMap } from "./router/routesMap";
import { ref } from "vue";
import { useVhOffset } from "./composables/useVhOffset";

const container = ref<HTMLElement | null>(null);
const { vhOffset } = useVhOffset(container);
</script>

<template>
  <ItemListNavigation :links="getRouteMap()" />
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
}
</style>
