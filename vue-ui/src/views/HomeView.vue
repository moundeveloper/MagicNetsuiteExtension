<script setup lang="ts">
import { computed, ref } from "vue";
import {
  getRouteMap,
  RouteStatus,
  RouteStatusColors,
} from "../router/routesMap";
import { InputText } from "primevue";
import { useFormattedRouteName } from "../composables/useFormattedRouteName";
import { Privilege } from "../types/privilege";

const { formattedRouteName } = useFormattedRouteName();

const searchFeatures = ref("");
const props = defineProps<{
  vhOffset: number;
}>();

const privilegeLevel = import.meta.env.VITE_PRIVILEGE_LEVEL;
const isAdmin = computed(() => privilegeLevel === Privilege.ADMIN);

const blackList = ["features", "settings", "modules not found"];

const features = computed(() => {
  return getRouteMap().filter(
    (route) =>
      !blackList.includes(route.name.toLowerCase()) &&
      route.name.toLowerCase().includes(searchFeatures.value.toLowerCase())
  );
});

const canAccess = (feature: (typeof features.value)[0]) => {
  if (feature.status === RouteStatus.release) return true;
  return isAdmin.value; // dev routes only for ADMIN
};

const isDisabled = (feature: (typeof features.value)[0]) => !canAccess(feature);
</script>

<template>
  <h1>{{ formattedRouteName }}</h1>
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
      custom
      v-slot="{ navigate }"
    >
      <div
        class="menu-item aspect-square flex flex-col items-center justify-center position-relative"
        :class="{
          'feature-development': feature.status !== RouteStatus.release,
          'feature-disabled': isDisabled(feature),
        }"
        @click="
          () => {
            if (canAccess(feature)) {
              navigate();
            }
          }
        "
      >
        <div
          v-if="feature.status !== RouteStatus.release"
          class="feature-status"
          :style="{ backgroundColor: RouteStatusColors[feature.status] || '' }"
        >
          {{ feature.status }}
        </div>
        <i :class="feature.icon" />
        <span class="text-center">{{ feature.name }}</span>
      </div>
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
  cursor: pointer;
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

.feature-status {
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  color: white;
  position: absolute;
  top: 0;
  right: 0;
  margin: 0.5rem;
  text-transform: uppercase;
}

.feature-development {
  outline: solid 1px var(--p-slate-400);
}

/* Disabled ONLY when user cannot access */
.feature-disabled {
  cursor: not-allowed;
  background-color: var(--p-slate-200);
  color: var(--p-slate-400);
  outline: solid 1px var(--p-slate-300);
}

.feature-disabled:hover {
  background-color: var(--p-slate-200);
  color: var(--p-slate-400);
}

.feature-development:hover {
  background-color: var(--p-slate-200);
  color: var(--p-slate-400);
}
</style>
