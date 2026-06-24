<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  getRouteMap,
  RouteStatus,
  RouteStatusColors
} from "../router/routesMap";
import { InputText } from "primevue";

import { Privilege } from "../types/privilege";
import { callApi, ApiRequestType } from "../utils/api";
import { useSettings } from "../states/settingsState";
import MPanel from "../components/universal/panels/MPanel.vue";
import { getNetsuiteEnvironment } from "../utils/api";
import {
  clearRecentViews,
  getRecentViews,
  RECENT_VIEWS_CHANGED_EVENT,
  removeRecentView,
  type RecentView
} from "../utils/recentViews";
const { settings, isSettingsLoaded } = useSettings();

const searchFeatures = ref("");
const recentViews = ref<RecentView[]>([]);
const recentEnvironment = ref("unknown");
const recentAccount = computed(
  () => recentEnvironment.value.split(".")[0]?.toUpperCase() || "UNKNOWN"
);
const props = defineProps<{
  vhOffset: number;
}>();

const privilegeLevel = import.meta.env.VITE_PRIVILEGE_LEVEL;
const mode = import.meta.env.MODE;
const isAdmin = computed(() => privilegeLevel === Privilege.ADMIN);

const blackList = ["features", "settings", "modules not found", "processing"];

const allFeatures = computed(() => {
  return getRouteMap().filter(
    (route) =>
      !blackList.includes(route.name.toLowerCase()) &&
      route.name.toLowerCase().includes(searchFeatures.value.toLowerCase()) &&
      route.status !== RouteStatus.deprecated &&
      (!route.adminOnly || isAdmin.value) &&
      (privilegeLevel === Privilege.ADMIN ||
        route.status === RouteStatus.release)
  );
});

const preferredFeatures = computed(() => {
  const prefs = settings.preferredFeatures || [];
  return allFeatures.value.filter((f) => prefs.includes(f.route));
});

const nonPreferredFeatures = computed(() => {
  const prefs = settings.preferredFeatures || [];
  return allFeatures.value.filter((f) => !prefs.includes(f.route));
});

const canAccess = (feature: (typeof allFeatures.value)[0]) => {
  if (feature.status === RouteStatus.deprecated) return false;
  if (feature.status === RouteStatus.release) return true;
  return isAdmin.value;
};

const isDisabled = (feature: (typeof allFeatures.value)[0]) =>
  !canAccess(feature);

const togglePreferred = (route: string) => {
  if (!settings.preferredFeatures) {
    settings.preferredFeatures = [];
  }
  const index = settings.preferredFeatures.indexOf(route);
  if (index === -1) {
    settings.preferredFeatures.push(route);
  } else {
    settings.preferredFeatures.splice(index, 1);
  }
};

const loadRecentViews = async () => {
  recentEnvironment.value = await getNetsuiteEnvironment();
  recentViews.value = await getRecentViews(recentEnvironment.value);
};

const removeRecent = async (view: RecentView) => {
  await removeRecentView(view);
  await loadRecentViews();
};

const clearRecent = async () => {
  await clearRecentViews(recentEnvironment.value);
  await loadRecentViews();
};

const formatRecentTime = (timestamp: number) => {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
};

const handleRecentViewsChanged = () => void loadRecentViews();
const handleEnvironmentChanged = () => void loadRecentViews();

onMounted(() => {
  void loadRecentViews();
  window.addEventListener(RECENT_VIEWS_CHANGED_EVENT, handleRecentViewsChanged);
  window.addEventListener(
    "magic-netsuite-environment-changed",
    handleEnvironmentChanged
  );
});

onBeforeUnmount(() => {
  window.removeEventListener(
    RECENT_VIEWS_CHANGED_EVENT,
    handleRecentViewsChanged
  );
  window.removeEventListener(
    "magic-netsuite-environment-changed",
    handleEnvironmentChanged
  );
});

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
  <!--   <div class="test-buttons">
    <button class="test-ping-btn" @click="testPing">
      Test Temp Tab (30s Ping)
    </button>
  </div> -->
  <InputText v-model="searchFeatures" placeholder="Search" class="mx-2" />

  <div
    v-if="isSettingsLoaded"
    :style="{ height: `${vhOffset}vh` }"
    data-ignore
    class="flex flex-col gap-4 overflow-y-auto p-2"
  >
    <MPanel
      v-if="recentViews.length > 0 && !searchFeatures"
      expanded
      toggleable
      outline
      header="Workspace Trail"
    >
      <div class="recent-panel-heading">
        <span>
          Continue in
          <strong>{{ recentAccount }}</strong>
        </span>
        <button class="recent-clear" title="Clear workspace trail" @click="clearRecent">
          Clear
        </button>
      </div>
      <div class="recent-grid">
        <router-link
          v-for="view in recentViews"
          :key="`${view.environment}:${view.path}`"
          :to="view.path"
          custom
          v-slot="{ navigate }"
        >
          <button class="recent-item" @click="navigate">
            <span class="recent-icon">
              <i :class="view.icon"></i>
            </span>
            <span class="recent-copy">
              <strong>{{ view.label }}</strong>
              <small>{{ view.section }} · {{ formatRecentTime(view.visitedAt) }}</small>
            </span>
            <span
              class="recent-remove"
              role="button"
              tabindex="0"
              title="Remove from trail"
              @click.stop="removeRecent(view)"
              @keydown.enter.stop="removeRecent(view)"
            >
              <i class="pi pi-times"></i>
            </span>
          </button>
        </router-link>
      </div>
    </MPanel>

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
              :style="{
                backgroundColor: RouteStatusColors[feature.status] || ''
              }"
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
              :style="{
                backgroundColor: RouteStatusColors[feature.status] || ''
              }"
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
.recent-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0.5rem 0.75rem;
  color: var(--p-slate-500);
  font-size: 0.72rem;
  font-family: var(--font-mono);
}

.recent-panel-heading strong {
  color: var(--p-indigo-600);
}

.recent-clear {
  border: 0;
  background: transparent;
  color: var(--p-slate-400);
  cursor: pointer;
  font: inherit;
}

.recent-clear:hover {
  color: var(--p-red-500);
}

.recent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 0.65rem;
  padding: 0.15rem 0.5rem 0.5rem;
}

.recent-item {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.7rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.55rem;
  background: color-mix(in srgb, var(--p-slate-50) 90%, transparent);
  color: var(--p-slate-700);
  cursor: pointer;
  text-align: left;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    transform 0.15s ease;
}

.recent-item:hover {
  transform: translateY(-1px);
  border-color: var(--p-indigo-300);
  background: color-mix(in srgb, var(--p-indigo-50) 70%, var(--p-slate-50));
}

.recent-icon {
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border-radius: 0.45rem;
  background: var(--p-indigo-100);
  color: var(--p-indigo-600);
}

.recent-copy {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.15rem;
}

.recent-copy strong,
.recent-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-copy strong {
  font-size: 0.8rem;
}

.recent-copy small {
  color: var(--p-slate-400);
  font-size: 0.65rem;
  font-family: var(--font-mono);
}

.recent-remove {
  flex: 0 0 auto;
  padding: 0.3rem;
  border-radius: 0.35rem;
  color: var(--p-slate-300);
  opacity: 0;
}

.recent-item:hover .recent-remove,
.recent-remove:focus {
  opacity: 1;
}

.recent-remove:hover {
  color: var(--p-red-500);
  background: var(--p-red-50);
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
