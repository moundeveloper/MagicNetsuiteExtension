<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
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
import { getNotebookEntries, type NotebookEntry } from "../utils/notebookDb";
import { getNetsuiteEnvironment } from "../utils/api";

const route = useRoute();
const router = useRouter();
const { settings, isSettingsLoaded } = useSettings();
const visibleBottom = ref(false);
const search = ref("");
const notebookSearchOpen = ref(false);
const notebookSearch = ref("");
const notebookEntries = ref<NotebookEntry[]>([]);
const environmentHost = ref("unknown");
const environmentLoading = ref(true);

const privilegeLevel = import.meta.env.VITE_PRIVILEGE_LEVEL;
const mode = import.meta.env.MODE;

const blackList = ["settings", "modules not found", "features", "processing"];

const allLinks = computed(() => {
  return routes.filter((link) => {
    return (
      link.name.toLowerCase().includes(search.value.toLowerCase()) &&
      !blackList.includes(link.name.toLowerCase()) &&
      link.status !== RouteStatus.deprecated &&
      (mode === "development" || link.status === RouteStatus.release) &&
      (!link.adminOnly || isAdmin.value)
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

const notebookSearchResults = computed(() => {
  const q = notebookSearch.value.trim().toLowerCase();
  return notebookEntries.value
    .filter((entry) => {
      if (!q) return !entry.archived;
      return !entry.archived && [
        entry.title,
        entry.summary,
        entry.body,
        entry.group,
        entry.scriptId,
        entry.netsuiteId,
        entry.filePath,
        entry.url,
        entry.tags.join(" ")
      ].join(" ").toLowerCase().includes(q);
    })
    .slice(0, 8);
});

const isAdmin = computed(() => privilegeLevel === "ADMIN");

const environmentAccount = computed(() => {
  if (!environmentHost.value || environmentHost.value === "unknown") {
    return "No account";
  }

  return (environmentHost.value.split(".")[0] || environmentHost.value)
    .toUpperCase()
    .replace(/-/g, "_");
});

const environmentType = computed(() => {
  if (environmentAccount.value === "No account") return "Disconnected";
  return /_SB\d+$/i.test(environmentAccount.value) ? "Sandbox" : "Production";
});

const refreshEnvironment = async () => {
  environmentLoading.value = true;
  environmentHost.value = await getNetsuiteEnvironment();
  environmentLoading.value = false;
};

const handleTabActivated = () => {
  void refreshEnvironment();
};

const handleTabUpdated: Parameters<
  typeof chrome.tabs.onUpdated.addListener
>[0] = (_tabId, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    void refreshEnvironment();
  }
};

const canAccess = (link: RouteItem) => {
  if (link.status === RouteStatus.deprecated) return false;
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
          if (child.breadcrumbParents) {
            for (const parent of child.breadcrumbParents) {
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
});const parseShortcut = (shortcut: string) => {
  const parts = shortcut.toLowerCase().split("+");
  const modifiers = parts.slice(0, -1);
  const key = parts[parts.length - 1];
  return { modifiers, key };
};

const handleKeydown = (e: KeyboardEvent) => {
  const notebookShortcut = parseShortcut(settings.modulesSearch || "ctrl+m");
  const notebookCtrlPressed = e.ctrlKey || e.metaKey;
  const notebookMatch =
    (!notebookShortcut.modifiers.includes("ctrl") || notebookCtrlPressed) &&
    (!notebookShortcut.modifiers.includes("alt") || e.altKey) &&
    (!notebookShortcut.modifiers.includes("shift") || e.shiftKey) &&
    e.key.toLowerCase() === notebookShortcut.key;

  if (notebookMatch) {
    e.preventDefault();
    openNotebookSearch();
    return;
  }

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

const openNotebookSearch = async () => {
  notebookEntries.value = await getNotebookEntries();
  notebookSearchOpen.value = true;
  setTimeout(() => {
    document.querySelector<HTMLInputElement>(".notebook-global-search input")?.focus();
  }, 0);
};

const openNotebookEntry = (entry?: NotebookEntry) => {
  notebookSearchOpen.value = false;
  const query = entry ? `?q=${encodeURIComponent(entry.title)}` : notebookSearch.value ? `?q=${encodeURIComponent(notebookSearch.value)}` : "";
  router.push(`/notebook${query}`);
};

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("focus", refreshEnvironment);
  void refreshEnvironment();

  if (typeof chrome !== "undefined" && chrome.tabs) {
    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("focus", refreshEnvironment);

  if (typeof chrome !== "undefined" && chrome.tabs) {
    chrome.tabs.onActivated.removeListener(handleTabActivated);
    chrome.tabs.onUpdated.removeListener(handleTabUpdated);
  }
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

    <div
      class="environment-account"
      :class="{
        'environment-account--sandbox': environmentType === 'Sandbox',
        'environment-account--disconnected': environmentType === 'Disconnected'
      }"
      :title="environmentHost"
      aria-live="polite"
    >
      <i
        :class="environmentLoading ? 'pi pi-spin pi-spinner' : 'pi pi-building'"
      ></i>
      <span class="environment-account__text">
        <strong>{{ environmentLoading ? "Detecting..." : environmentAccount }}</strong>
        <small>{{ environmentType }}</small>
      </span>
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

  <Teleport to="body">
    <div
      v-if="notebookSearchOpen"
      class="notebook-search-backdrop"
      @click="notebookSearchOpen = false"
    >
      <div class="notebook-global-search" @click.stop>
        <div class="notebook-global-input">
          <i class="pi pi-search"></i>
          <input
            v-model="notebookSearch"
            placeholder="Search Notebook notes, scripts, files, IDs..."
            @keydown.enter.prevent="openNotebookEntry(notebookSearchResults[0])"
            @keydown.escape.prevent="notebookSearchOpen = false"
          />
          <kbd>{{ settings.modulesSearch.toUpperCase() }}</kbd>
        </div>
        <div class="notebook-global-results">
          <button
            v-for="entry in notebookSearchResults"
            :key="entry.id"
            @click="openNotebookEntry(entry)"
          >
            <span>
              <strong>{{ entry.title }}</strong>
              <small>{{ entry.group || entry.type }} · {{ entry.summary || entry.scriptId || entry.filePath || entry.netsuiteId }}</small>
            </span>
            <i class="pi pi-arrow-right"></i>
          </button>
          <button v-if="notebookSearchResults.length === 0" @click="openNotebookEntry()">
            <span>
              <strong>Search Notebook</strong>
              <small>Open the Notebook archive with this query</small>
            </span>
            <i class="pi pi-arrow-right"></i>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
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

.environment-account {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--p-emerald-300);
  border-radius: 0.5rem;
  background: var(--p-emerald-50);
  color: var(--p-emerald-700);
  flex-shrink: 0;
}

.environment-account--sandbox {
  border-color: var(--p-amber-300);
  background: var(--p-amber-50);
  color: var(--p-amber-700);
}

.environment-account--disconnected {
  border-color: var(--p-slate-300);
  background: var(--p-slate-100);
  color: var(--p-slate-500);
}

.environment-account__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.05;
}

.environment-account__text strong {
  max-width: 10rem;
  overflow: hidden;
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.environment-account__text small {
  margin-top: 0.15rem;
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
}

.settings-btn {
  padding: 0.5rem;
}

@media (max-width: 720px) {
  .environment-account__text small {
    display: none;
  }

  .environment-account__text strong {
    max-width: 7rem;
  }
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

.notebook-search-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
  background: rgba(15, 23, 42, 0.32);
}

.notebook-global-search {
  width: min(680px, calc(100vw - 2rem));
  border-radius: 8px;
  background: #f8fafc;
  outline: 1px solid #cbd5e1;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.24);
  overflow: hidden;
}

.notebook-global-input {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  height: 3rem;
  padding: 0 0.85rem;
  background: white;
  border-bottom: 1px solid #dbe3ee;
  color: #64748b;
}

.notebook-global-input input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #0f172a;
  font: inherit;
}

.notebook-global-input kbd {
  padding: 0.15rem 0.4rem;
  border-radius: 5px;
  color: #475569;
  background: #e2e8f0;
  font-size: 0.68rem;
}

.notebook-global-results {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 48vh;
  overflow: auto;
  padding: 0.55rem;
}

.notebook-global-results button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border: 0;
  border-radius: 6px;
  padding: 0.55rem 0.65rem;
  background: white;
  color: #334155;
  outline: 1px solid #e2e8f0;
  cursor: pointer;
  text-align: left;
}

.notebook-global-results button:hover {
  background: #eff6ff;
  outline-color: #93c5fd;
}

.notebook-global-results span {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  min-width: 0;
}

.notebook-global-results strong,
.notebook-global-results small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notebook-global-results small {
  color: #64748b;
  font-size: 0.72rem;
}
</style>
