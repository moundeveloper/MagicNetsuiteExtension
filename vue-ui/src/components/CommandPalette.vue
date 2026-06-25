<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { routes, RouteStatus } from "../router/routesMap";
import { getNetsuiteEnvironment } from "../utils/api";
import { getRecentViews, type RecentView } from "../utils/recentViews";
import { hasAdminAccess } from "../utils/adminAccess";

type PaletteItem = {
  id: string;
  label: string;
  detail: string;
  icon: string;
  path: string;
  kind: "feature" | "recent" | "jump";
  keywords: string;
};

const router = useRouter();
const open = ref(false);
const query = ref("");
const selectedIndex = ref(0);
const recentViews = ref<RecentView[]>([]);
const environment = ref("unknown");
const inputRef = ref<HTMLInputElement | null>(null);

const mode = import.meta.env.MODE;

const featureItems = computed<PaletteItem[]>(() =>
  routes
    .filter(
      (route) =>
        route.route !== "/processing" &&
        route.status !== RouteStatus.deprecated &&
        (!route.adminOnly || hasAdminAccess.value) &&
        (mode === "development" || route.status === RouteStatus.release)
    )
    .map((route) => ({
      id: `feature:${route.route}`,
      label: route.name,
      detail: route.breadcrumb || "Feature",
      icon: route.icon,
      path: route.route,
      kind: "feature",
      keywords: `${route.name} ${route.breadcrumb || ""} ${route.route}`
    }))
);

const recentItems = computed<PaletteItem[]>(() =>
  recentViews.value.map((view) => ({
    id: `recent:${view.path}`,
    label: view.label,
    detail: `Recent · ${view.section}`,
    icon: view.icon,
    path: view.path,
    kind: "recent",
    keywords: `${view.label} ${view.section} ${view.path}`
  }))
);

const directJumpItems = computed<PaletteItem[]>(() => {
  const value = query.value.trim();
  const items: PaletteItem[] = [];
  let match = value.match(/^scripts?\s+#?(\d+)$/i);
  if (match) {
    items.push({
      id: `jump:script:${match[1]}`,
      label: `Open Script #${match[1]}`,
      detail: "Direct jump to Script Detail",
      icon: "pi pi-code",
      path: `/scripts/${match[1]}`,
      kind: "jump",
      keywords: value
    });
  }

  match = value.match(/^records?\s+([a-z0-9_]+)\s+#?(\d+)$/i);
  if (match) {
    const recordType = match[1]!;
    const recordId = match[2]!;
    items.push({
      id: `jump:record:${recordType}:${recordId}`,
      label: `Open ${recordType} #${recordId}`,
      detail: "Direct jump to Record Detail",
      icon: "pi pi-database",
      path: `/records/${encodeURIComponent(recordType)}/${recordId}`,
      kind: "jump",
      keywords: value
    });
  }

  match = value.match(/^bundles?\s+#?(\d+)$/i);
  if (match) {
    items.push({
      id: `jump:bundle:${match[1]}`,
      label: `Open Bundle #${match[1]}`,
      detail: "Direct jump to Bundle Detail",
      icon: "pi pi-box",
      path: `/bundles/${match[1]}`,
      kind: "jump",
      keywords: value
    });
  }

  match = value.match(/^templates?\s+#?(\d+)$/i);
  if (match) {
    items.push({
      id: `jump:template:${match[1]}`,
      label: `Open Template #${match[1]}`,
      detail: "Direct jump to Template Detail",
      icon: "pi pi-file-pdf",
      path: `/templates/${match[1]}`,
      kind: "jump",
      keywords: value
    });
  }
  return items;
});

const scoreItem = (item: PaletteItem, terms: string[]) => {
  const label = item.label.toLowerCase();
  const haystack = `${item.keywords} ${item.detail}`.toLowerCase();
  let score = item.kind === "recent" ? 2 : 0;
  for (const term of terms) {
    if (!haystack.includes(term)) return -1;
    if (label === term) score += 20;
    else if (label.startsWith(term)) score += 12;
    else if (label.includes(term)) score += 7;
    else score += 3;
  }
  return score;
};

const results = computed(() => {
  const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const base = [...recentItems.value, ...featureItems.value];
  const filtered =
    terms.length === 0
      ? base
      : base
          .map((item) => ({ item, score: scoreItem(item, terms) }))
          .filter((entry) => entry.score >= 0)
          .sort((a, b) => b.score - a.score)
          .map((entry) => entry.item);

  const unique = new Map<string, PaletteItem>();
  for (const item of [...directJumpItems.value, ...filtered]) {
    if (!unique.has(item.path)) unique.set(item.path, item);
  }
  return [...unique.values()].slice(0, 12);
});

const closePalette = () => {
  open.value = false;
  query.value = "";
  selectedIndex.value = 0;
};

const openPalette = async () => {
  environment.value = await getNetsuiteEnvironment().catch(() => "unknown");
  recentViews.value = await getRecentViews(environment.value, 8);
  open.value = true;
  await nextTick();
  inputRef.value?.focus();
};

const selectItem = async (item?: PaletteItem) => {
  if (!item) return;
  closePalette();
  await router.push(item.path);
};

const handleGlobalKeydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (open.value) closePalette();
    else void openPalette();
  }
};

const handleInputKeydown = (event: KeyboardEvent) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    selectedIndex.value = Math.min(
      selectedIndex.value + 1,
      Math.max(0, results.value.length - 1)
    );
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    selectedIndex.value = Math.max(0, selectedIndex.value - 1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    void selectItem(results.value[selectedIndex.value]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closePalette();
  }
};

watch(query, () => {
  selectedIndex.value = 0;
});

onMounted(() => window.addEventListener("keydown", handleGlobalKeydown));
onBeforeUnmount(() =>
  window.removeEventListener("keydown", handleGlobalKeydown)
);

defineExpose({ open: openPalette });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="command-palette-backdrop"
      @mousedown.self="closePalette"
    >
      <section class="command-palette" role="dialog" aria-label="Go anywhere">
        <header class="command-palette-input">
          <i class="pi pi-search"></i>
          <input
            ref="inputRef"
            v-model="query"
            placeholder="Go anywhere… try “script 123” or “record salesorder 456”"
            @keydown="handleInputKeydown"
          />
          <kbd>ESC</kbd>
        </header>

        <div class="command-palette-results">
          <button
            v-for="(item, index) in results"
            :key="item.id"
            type="button"
            :class="{ selected: index === selectedIndex }"
            @mouseenter="selectedIndex = index"
            @click="selectItem(item)"
          >
            <span class="command-palette-icon">
              <i :class="item.icon"></i>
            </span>
            <span class="command-palette-copy">
              <strong>{{ item.label }}</strong>
              <small>{{ item.detail }}</small>
            </span>
            <span v-if="item.kind === 'recent'" class="command-palette-badge">
              recent
            </span>
            <i class="pi pi-arrow-right command-palette-arrow"></i>
          </button>

          <div v-if="results.length === 0" class="command-palette-empty">
            <i class="pi pi-compass"></i>
            <strong>No destination found</strong>
            <span>Search a feature or use one of the direct-jump formats.</span>
          </div>
        </div>

        <footer class="command-palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span>{{ environment.split(".")[0]?.toUpperCase() || "UNKNOWN" }}</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.command-palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: rgba(15, 23, 42, 0.46);
  padding: min(16vh, 130px) 18px 18px;
  backdrop-filter: blur(3px);
}

.command-palette {
  width: min(680px, 96vw);
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.7);
  border-radius: 12px;
  background: white;
  box-shadow: 0 28px 80px rgba(15, 23, 42, 0.34);
}

.command-palette-input {
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 13px 15px;
}

.command-palette-input > i {
  color: var(--p-indigo-500);
  font-size: 1rem;
}

.command-palette-input input {
  min-width: 0;
  flex: 1;
  border: none;
  background: transparent;
  color: var(--p-slate-800);
  font-family: var(--font-mono);
  font-size: 0.85rem;
  outline: none;
}

.command-palette kbd {
  border: 1px solid var(--p-slate-300);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--p-slate-50);
  color: var(--p-slate-500);
  padding: 1px 5px;
  font-family: var(--font-mono);
  font-size: 0.62rem;
}

.command-palette-results {
  max-height: min(55vh, 520px);
  overflow-y: auto;
  padding: 7px;
}

.command-palette-results button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--p-slate-700);
  cursor: pointer;
  padding: 9px 10px;
  text-align: left;
}

.command-palette-results button.selected {
  background: var(--p-indigo-50);
  color: var(--p-indigo-800);
}

.command-palette-icon {
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: white;
  color: var(--p-indigo-500);
}

.command-palette-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.command-palette-copy strong {
  overflow: hidden;
  font-size: 0.8rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-palette-copy small {
  overflow: hidden;
  color: var(--p-slate-400);
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-palette-badge {
  border-radius: 999px;
  background: var(--p-slate-100);
  color: var(--p-slate-500);
  padding: 2px 6px;
  font-size: 0.6rem;
}

.command-palette-arrow {
  color: var(--p-slate-300);
  font-size: 0.7rem;
}

.command-palette-empty {
  display: flex;
  min-height: 160px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: var(--p-slate-400);
  text-align: center;
}

.command-palette-empty i {
  font-size: 1.35rem;
}

.command-palette-empty strong {
  color: var(--p-slate-600);
  font-size: 0.82rem;
}

.command-palette-empty span {
  font-size: 0.68rem;
}

.command-palette-footer {
  display: flex;
  align-items: center;
  gap: 14px;
  border-top: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  color: var(--p-slate-400);
  padding: 7px 12px;
  font-size: 0.65rem;
}

.command-palette-footer span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.command-palette-footer span:last-child {
  margin-left: auto;
  color: var(--p-indigo-500);
  font-family: var(--font-mono);
}
</style>
