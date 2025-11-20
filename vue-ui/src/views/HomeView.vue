<script setup lang="ts">
import { computed, ref } from "vue";

import { getRouteMap } from "../router/routesMap";
import { InputText } from "primevue";

const searchFeatures = ref("");
const props = defineProps<{
  vhOffset: number;
}>();

const features = computed(() => {
  return getRouteMap().filter(
    (route) =>
      route.name.toLowerCase() !== "home" &&
      route.name.toLowerCase().includes(searchFeatures.value.toLowerCase())
  );
});
</script>

<template>
  <h1>::FEATURES</h1>
  <InputText v-model="searchFeatures" placeholder="Search" />
  <div
    :style="{ height: `${vhOffset}vh` }"
    data-ignore
    class="grid [grid-template-columns:repeat(auto-fit,180px)] [grid-auto-rows:min-content] gap-8 p-2 overflow-y-auto"
  >
    <router-link
      v-for="feature in features"
      :key="feature.route"
      :to="feature.route"
      class="menu-item aspect-square flex flex-col items-center justify-center"
    >
      <i :class="feature.icon" />
      <span class="text-center">{{ feature.name }}</span>
    </router-link>
  </div>
</template>

<style scoped>
.wraper {
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.home-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 2rem;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  text-decoration: none;
  font-weight: 500;
  color: var(--p-slate-600);
  border-radius: 0.5rem;
  transition:
    background-color 0.25s,
    color 0.25s;
  outline: solid 1px var(--p-slate-600);
}

/* Hover: lighter slate tone */
.menu-item:hover {
  background-color: var(--p-slate-200);
  color: var(--p-slate-800);
}

/* Active: darker slate tone */
.menu-item.active {
  background-color: var(--p-slate-300);
  color: var(--p-slate-900);
  font-weight: 600;
}
</style>
