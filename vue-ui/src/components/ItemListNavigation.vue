<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import { useRoute } from "vue-router";
import {
  RouteStatus,
  RouteStatusColors,
  type RouteItem
} from "../router/routesMap";
import { Button, Drawer, InputText } from "primevue";
import { useSettings } from "../states/settingsState";
import { Privilege } from "../types/privilege";
import MagicNetsuiteLogo from "./MagicNetsuiteLogo.vue";
import MPanel from "../components/universal/panels/MPanel.vue";

const props = defineProps<{
  links: RouteItem[];
}>();

const privilegeLevel = import.meta.env.VITE_PRIVILEGE_LEVEL;
const visibleBottom = ref(false);
const search = ref("");
const blackList = ["settings", "modules not found", "features", "processing"];
const mode = import.meta.env.MODE;
const { settings, isSettingsLoaded } = useSettings();

const allLinks = computed(() => {
  return props.links.filter((link) => {
    return (
      link.name.toLowerCase().includes(search.value.toLowerCase()) &&
      !blackList.includes(link.name.toLowerCase()) &&
      (mode === "development" || link.status === RouteStatus.release)
    );
  });
});

const preferredLinks = computed(() => {
  const prefs = settings.preferredFeatures || [];
  return allLinks.value.filter((l) => prefs.includes(l.route));
});

const nonPreferredLinks = computed(() => {
  const prefs = settings.preferredFeatures || [];
  return allLinks.value.filter((l) => !prefs.includes(l.route));
});

const isAdmin = computed(() => privilegeLevel === Privilege.ADMIN);

const canAccess = (link: RouteItem) => {
  if (link.status === RouteStatus.release) return true;
  return isAdmin.value;
};

const isDisabled = (link: RouteItem) => {
  return !canAccess(link);
};

const togglePreferred = (routeName: string) => {
  if (!settings.preferredFeatures) {
    settings.preferredFeatures = [];
  }
  const index = settings.preferredFeatures.indexOf(routeName);
  if (index === -1) {
    settings.preferredFeatures.push(routeName);
  } else {
    settings.preferredFeatures.splice(index, 1);
  }
};

const parseShortcut = (shortcut: string) => {
  const parts = shortcut.toLowerCase().split("+");
  const modifiers = parts.slice(0, -1);
  const key = parts[parts.length - 1];
  return { modifiers, key };
};

const handleKeydown = (e: KeyboardEvent) => {
  const { modifiers, key } = parseShortcut(settings.drawerOpen);
  const ctrlPressed = e.ctrlKey || e.metaKey;
  const altPressed = e.altKey;
  const shiftPressed = e.shiftKey;

  let match = true;
  if (modifiers.includes("ctrl") && !ctrlPressed) match = false;
  if (modifiers.includes("alt") && !altPressed) match = false;
  if (modifiers.includes("shift") && !shiftPressed) match = false;
  if (e.key.toLowerCase() !== key) match = false;

  if (match) {
    e.preventDefault();
    visibleBottom.value = !visibleBottom.value;
  }
};

const closeDrawer = (routeStatus: RouteStatus) => {
  if (routeStatus !== RouteStatus.release) return;
  visibleBottom.value = false;
};

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <div class="flex p-4 gap-3 z-10">
    <RouterLink to="/" class="flex flex-col items-center">
      <MagicNetsuiteLogo width="3rem" fill="var(--p-slate-600)" />
    </RouterLink>
    <Button
      icon="pi pi-arrow-up"
      @click="visibleBottom = true"
      class="fixed flex-1"
    >
      <span class="!text-white">{{
        `Open Menu(${settings.drawerOpen.toUpperCase()})`
      }}</span>
    </Button>

    <RouterLink to="/settings">
      <Button class="w-full h-full">
        <i class="pi pi-cog text-white"></i>
      </Button>
    </RouterLink>

    <!-- <ModulesConnected /> -->
  </div>

  <Drawer
    v-model:visible="visibleBottom"
    header="Navigation Items"
    position="bottom"
    style="height: 70vh"
  >
    <div
      v-if="isSettingsLoaded"
      class="flex flex-col gap-4 h-full overflow-y-auto"
    >
      <div class="flex gap-4 px-4">
        <InputText
          class="flex-1"
          v-model="search"
          placeholder="Search"
          autofocus
        />

        <RouterLink to="/">
          <Button class="w-full h-full" @click="visibleBottom = false">
            <i class="pi pi-home text-white"></i>
          </Button>
        </RouterLink>
      </div>
      <MPanel
        v-if="preferredLinks.length > 0"
        expanded
        toggleable
        outline
        header="Preferred"
      >
        <div
          class="grid [grid-template-columns:repeat(auto-fit,150px)] gap-4 p-2"
        >
          <router-link
            v-for="link in preferredLinks"
            :key="link.route"
            :to="link.route"
            custom
            v-slot="{ navigate }"
          >
            <div
              class="menu-item aspect-square flex flex-col items-center justify-center position-relative"
              :class="{
                'feature-development': link.status !== RouteStatus.release,
                'feature-disabled': isDisabled(link)
              }"
              @click="
                () => {
                  if (canAccess(link)) {
                    navigate();
                    closeDrawer(link.status);
                  }
                }
              "
            >
              <button
                class="preferred-btn active"
                @click.stop="togglePreferred(link.route)"
                title="Remove from preferred"
              >
                <i class="pi pi-star-fill"></i>
              </button>

              <div
                v-if="link.status !== RouteStatus.release"
                class="feature-status"
                :style="{
                  backgroundColor: RouteStatusColors[link.status] || ''
                }"
              >
                {{ link.status }}
              </div>

              <i :class="link.icon" />
              <span class="text-center">{{ link.name }}</span>
            </div>
          </router-link>
        </div>
      </MPanel>

      <MPanel
        v-if="nonPreferredLinks.length > 0"
        expanded
        toggleable
        outline
        header="All Features"
      >
        <div
          class="grid [grid-template-columns:repeat(auto-fit,150px)] gap-4 p-2"
        >
          <router-link
            v-for="link in nonPreferredLinks"
            :key="link.route"
            :to="link.route"
            custom
            v-slot="{ navigate }"
          >
            <div
              class="menu-item aspect-square flex flex-col items-center justify-center position-relative"
              :class="{
                'feature-development': link.status !== RouteStatus.release,
                'feature-disabled': isDisabled(link)
              }"
              @click="
                () => {
                  if (canAccess(link)) {
                    navigate();
                    closeDrawer(link.status);
                  }
                }
              "
            >
              <button
                class="preferred-btn"
                @click.stop="togglePreferred(link.route)"
                title="Add to preferred"
              >
                <i class="pi pi-star"></i>
              </button>

              <div
                v-if="link.status !== RouteStatus.release"
                class="feature-status"
                :style="{
                  backgroundColor: RouteStatusColors[link.status] || ''
                }"
              >
                {{ link.status }}
              </div>

              <i :class="link.icon" />
              <span class="text-center">{{ link.name }}</span>
            </div>
          </router-link>
        </div>
      </MPanel>
    </div>
  </Drawer>
</template>

<style scoped>
.menu-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background: var(--surface-card);
  border-radius: 0.75rem;
}

/* Base link style */
.menu-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  text-decoration: none;
  font-weight: 500;
  color: #475569; /* slate-600 text */
  border-radius: 0.5rem;
  transition:
    background-color 0.25s,
    color 0.25s;
  outline: solid 1px var(--p-slate-600);
  cursor: pointer;
}

/* Hover: lighter slate tone */
.menu-item:hover {
  background-color: #e2e8f0; /* slate-200 */
  color: #1e293b; /* slate-800 */
}

/* Active: darker slate tone */
.menu-item.active {
  background-color: #cbd5e1; /* slate-300 */
  color: #0f172a; /* slate-900 */
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

/* Development route base (badge only, no dimming) */
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

/* Disabled hover lock */
.feature-disabled:hover {
  background-color: var(--p-slate-200);
  color: var(--p-slate-400);
}

.feature-development:hover {
  background-color: var(--p-slate-200);
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
  z-index: 1;
}

.preferred-btn:hover {
  color: var(--p-amber-500);
}

.preferred-btn.active {
  color: var(--p-amber-500);
}
</style>
