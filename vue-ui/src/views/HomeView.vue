<script setup lang="ts">
import { computed, ref } from "vue";
import {
  getRouteMap,
  RouteStatus,
  RouteStatusColors
} from "../router/routesMap";
import { InputText } from "primevue";
import { useFormattedRouteName } from "../composables/useFormattedRouteName";
import { Privilege } from "../types/privilege";
import { callApi, ApiRequestType } from "../utils/api";
import { useSettings } from "../states/settingsState";
import MPanel from "../components/universal/panels/MPanel.vue";

const { formattedRouteName } = useFormattedRouteName();
const { settings } = useSettings();

const searchFeatures = ref("");
const props = defineProps<{
  vhOffset: number;
}>();

const privilegeLevel = import.meta.env.VITE_PRIVILEGE_LEVEL;
const mode = import.meta.env.MODE;
const isAdmin = computed(() => privilegeLevel === Privilege.ADMIN);

const blackList = ["features", "settings", "modules not found"];

const allFeatures = computed(() => {
  return getRouteMap().filter(
    (route) =>
      !blackList.includes(route.name.toLowerCase()) &&
      route.name.toLowerCase().includes(searchFeatures.value.toLowerCase()) &&
      (privilegeLevel === Privilege.ADMIN ||
        route.status === RouteStatus.release)
  );
});

const preferredFeatures = computed(() => {
  return allFeatures.value.filter((f) =>
    settings.preferredFeatures.includes(f.route)
  );
});

const nonPreferredFeatures = computed(() => {
  return allFeatures.value.filter(
    (f) => !settings.preferredFeatures.includes(f.route)
  );
});

const canAccess = (feature: (typeof allFeatures.value)[0]) => {
  if (feature.status === RouteStatus.release) return true;
  return isAdmin.value;
};

const isDisabled = (feature: (typeof allFeatures.value)[0]) => !canAccess(feature);

const togglePreferred = (route: string) => {
  const index = settings.preferredFeatures.indexOf(route);
  if (index === -1) {
    settings.preferredFeatures.push(route);
  } else {
    settings.preferredFeatures.splice(index, 1);
  }
};

const testPing = async () => {
  console.log("Testing ping with 30 second delay...");
  const result = await callApi(
    "PING" as any,
    { delay: 30000 },
    ApiRequestType.NORMAL
  );
  console.log("Ping result:", result);
};
</script>

<template>
  <h1>{{ formattedRouteName }}</h1>
  <!--   <div class="test-buttons">
    <button class="test-ping-btn" @click="testPing">
      Test Temp Tab (30s Ping)
    </button>
  </div> -->
  <InputText v-model="searchFeatures" placeholder="Search" />

  <div
    :style="{ height: `${vhOffset}vh` }"
    data-ignore
    class="flex flex-col gap-4 overflow-y-auto p-2"
  >
    <MPanel
      v-if="preferredFeatures.length > 0"
      expanded
      toggleable
      outline
      header="Preferred"
    >
      <div
        class="grid [grid-template-columns:repeat(auto-fit,180px)] [grid-auto-rows:min-content] gap-8 p-2"
      >
        <router-link
          v-for="feature in preferredFeatures"
          :key="feature.route"
          :to="feature.route"
          custom
          v-slot="{ navigate }"
        >
          <div
            class="menu-item aspect-square flex flex-col items-center justify-center position-relative"
            :class="{
              'feature-development': feature.status !== RouteStatus.release,
              'feature-disabled': isDisabled(feature)
            }"
            @click="
              () => {
                if (canAccess(feature)) {
                  navigate();
                }
              }
            "
          >
            <button
              class="preferred-btn active"
              @click.stop="togglePreferred(feature.route)"
              title="Remove from preferred"
            >
              <i class="pi pi-star-fill"></i>
            </button>
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
    </MPanel>

    <MPanel
      v-if="nonPreferredFeatures.length > 0"
      expanded
      toggleable
      outline
      header="All Features"
    >
      <div
        class="grid [grid-template-columns:repeat(auto-fit,180px)] [grid-auto-rows:min-content] gap-8 p-2"
      >
        <router-link
          v-for="feature in nonPreferredFeatures"
          :key="feature.route"
          :to="feature.route"
          custom
          v-slot="{ navigate }"
        >
          <div
            class="menu-item aspect-square flex flex-col items-center justify-center position-relative"
            :class="{
              'feature-development': feature.status !== RouteStatus.release,
              'feature-disabled': isDisabled(feature)
            }"
            @click="
              () => {
                if (canAccess(feature)) {
                  navigate();
                }
              }
            "
          >
            <button
              class="preferred-btn"
              @click.stop="togglePreferred(feature.route)"
              title="Add to preferred"
            >
              <i class="pi pi-star"></i>
            </button>
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
    </MPanel>
  </div>
</template>

<style scoped>
.wraper {
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.test-buttons {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.test-ping-btn {
  padding: 0.5rem 1rem;
  background-color: var(--p-primary-500);
  color: white;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  font-weight: 500;
  transition: background-color 0.2s;
}

.test-ping-btn:hover {
  background-color: var(--p-primary-600);
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
  background-color: var(--p-slate-100);
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
  background-color: color-mix(in srgb, var(--p-slate-200) 70%, transparent);
  color: var(--p-slate-400);
}

.preferred-btn {
  position: absolute;
  top: 0;
  left: 0;
  margin: 0.5rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  color: var(--p-slate-400);
  transition: color 0.2s;
  padding: 0.25rem;
}

.preferred-btn:hover {
  color: var(--p-amber-500);
}

.preferred-btn.active {
  color: var(--p-amber-500);
}

.feature-development:hover {
  background-color: color-mix(in srgb, var(--p-slate-200) 70%, transparent);
  color: var(--p-slate-400);
}
</style>
