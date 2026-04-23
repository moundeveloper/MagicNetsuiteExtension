<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { Button, Breadcrumb, Drawer, InputText } from "primevue";
import { useSettings } from "../states/settingsState";
import {
  routes,
  RouteStatus,
  RouteStatusColors,
  type RouteItem
} from "../router/routesMap";
import MagicNetsuiteLogo from "./MagicNetsuiteLogo.vue";
import MPanel from "./universal/panels/MPanel.vue";

const route = useRoute();
const { settings, isSettingsLoaded } = useSettings();
const visibleBottom = ref(false);
const search = ref("");

const privilegeLevel = import.meta.env.VITE_PRIVILEGE_LEVEL;
const mode = import.meta.env.MODE;

const blackList = ["settings", "modules not found", "features", "processing"];

const allLinks = computed(() => {
  return routes.filter((link) => {
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

const isAdmin = computed(() => privilegeLevel === "ADMIN");

const canAccess = (link: RouteItem) => {
  if (link.status === RouteStatus.release) return true;
  return isAdmin.value;
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

const closeDrawer = (routeStatus: RouteStatus) => {
  if (routeStatus !== RouteStatus.release) return;
  visibleBottom.value = false;
};

const home = {
  icon: "pi pi-home",
  route: "/"
};

const breadcrumbs = computed(() => {
  const currentPath = route.path;
  let foundRoute = routes.find((r) => r.route === currentPath);

  if (!foundRoute) {
    for (const r of routes) {
      if (r.children) {
        const child = r.children.find((c) => {
          const routePattern = c.route.replace(/:[^/]+/g, "[^/]+");
          const regex = new RegExp(`^${routePattern}$`);
          return regex.test(currentPath);
        });
        if (child) {
          const items = [];
          if (r.breadcrumbParents) {
            for (const parent of r.breadcrumbParents) {
              items.push({ label: parent.label, route: parent.route });
            }
          }
          items.push({ label: child.breadcrumb || child.name });
          return items;
        }
      }
    }
    return [];
  }

  const items = [];
  if (foundRoute.breadcrumbParents) {
    for (const parent of foundRoute.breadcrumbParents) {
      items.push({ label: parent.label, route: parent.route });
    }
  }
  items.push({ label: foundRoute.breadcrumb || foundRoute.name });
  return items;
});
</script>

<template>
  <header class="app-header">
    <RouterLink to="/" class="logo-link">
      <MagicNetsuiteLogo width="2.5rem" fill="var(--p-slate-600)" />
    </RouterLink>

    <Button
      icon="pi pi-arrow-up"
      @click="visibleBottom = true"
      class="menu-btn"
    >
      <span class="!text-white">{{
        `Open Menu(${settings.drawerOpen.toUpperCase()})`
      }}</span>
    </Button>

    <div class="breadcrumb-container">
      <Breadcrumb :home="home" :model="breadcrumbs">
        <template #item="{ item, props }">
          <router-link
            v-if="item.route"
            v-slot="{ href, navigate }"
            :to="item.route"
            custom
          >
            <a :href="href" v-bind="props.action" @click="navigate">
              <span :class="[item.icon, 'text-color']" />
              <span class="text-primary font-semibold">{{ item.label }}</span>
            </a>
          </router-link>
          <a v-else v-bind="props.action">
            <span class="text-surface-700 dark:text-surface-0">{{
              item.label
            }}</span>
          </a>
        </template>
      </Breadcrumb>
    </div>

    <RouterLink to="/settings" class="settings-link">
      <Button class="settings-btn">
        <i class="pi pi-cog text-white"></i>
      </Button>
    </RouterLink>
  </header>

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
                'feature-disabled': !canAccess(link)
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
                'feature-disabled': !canAccess(link)
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
.app-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: var(--surface-card);
  border-bottom: 1px solid var(--surface-border);
}

.logo-link {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.menu-btn {
  flex-shrink: 0;
  flex-grow: 0 !important;
  white-space: nowrap;
  width: fit-content;
  padding: 0.5rem 1rem;
}

.separator {
  width: 2px;
  height: 60%;
  background: var(--p-slate-400);
  flex-shrink: 0;
  align-self: center;
  border-radius: 0.5rem;
}

.breadcrumb-container {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.settings-link {
  flex-shrink: 0;
}

.settings-btn {
  padding: 0.5rem;
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

.menu-item:hover {
  background-color: var(--p-slate-200);
  color: var(--p-slate-800);
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

.preferred-btn:hover,
.preferred-btn.active {
  color: var(--p-amber-500);
}
</style>
