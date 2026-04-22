<template>
  <!-- Backdrop -->
  <transition name="fade">
    <div v-if="paletteOpen" class="backdrop" @click="closePalette" />
  </transition>

  <!-- Search palette modal -->
  <transition name="palette-drop">
    <div v-if="paletteOpen" class="palette-modal" @click.stop @keydown="onPaletteKeydown">
      <div class="palette-search-row">
        <i class="pi pi-search palette-icon" />
        <input
          ref="searchInputEl"
          v-model="query"
          class="palette-input"
          placeholder="Search SuiteScript methods, objects, enums..."
          autocomplete="off"
          spellcheck="false"
          @input="onInput"
        />
        <kbd class="esc-hint">esc</kbd>
      </div>

      <!-- Type filter pills -->
      <div class="type-filter-row">
        <button
          v-for="t in TYPE_FILTERS"
          :key="t"
          class="type-pill"
          :class="[`pill-${t.toLowerCase()}`, { active: typeFilter === t }]"
          @click="setTypeFilter(t)"
        >{{ t }}</button>
      </div>

      <div v-if="results.length > 0" class="palette-results" ref="resultsEl">
        <div
          v-for="(item, idx) in results"
          :key="item.id"
          class="result-item"
          :class="{ active: idx === activeIdx }"
          @mouseenter="activeIdx = idx"
          @click="selectItem(item)"
          :ref="(el) => setItemRef(el, idx)"
        >
          <span class="result-badge" :class="badgeClass(item.memberType)">{{ item.memberType }}</span>
          <span class="result-name">{{ item.name }}</span>
          <span class="result-module">{{ item.moduleName }}</span>
          <span v-if="item.returnType" class="result-return">&rarr; {{ item.returnType }}</span>
        </div>
      </div>

      <div v-else-if="isSearching" class="palette-status">
        <i class="pi pi-spin pi-spinner" /> Searching...
      </div>
      <div v-else-if="query.trim() && !isSearching" class="palette-status">
        No results for "{{ query }}"
      </div>
      <div v-else class="palette-hint">
        Type to search SuiteScript 2.x documentation
      </div>

      <div class="palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>↵</kbd> open</span>
        <span><kbd>esc</kbd> close</span>
        <span class="footer-spacer" />
        <span v-if="dbStats && dbStats.memberCount > 0" class="db-stats">
          {{ dbStats.memberCount.toLocaleString() }} members · {{ dbStats.moduleCount }} modules
        </span>
        <span v-else-if="dbStats !== null" class="db-stats db-stats-empty">
          <i class="pi pi-exclamation-triangle" /> No modules loaded
        </span>
      </div>
    </div>
  </transition>

  <!-- Detail slide-over (right side, full height) -->
  <transition name="detail-slide">
    <div v-if="detailMember" class="detail-panel" :style="{ width: panelWidth + 'px' }">
      <!-- Resize handle (left edge) -->
      <div class="resize-handle" @mousedown.prevent="startResize" />

      <!-- Inline sidebar search -->
      <transition name="sidebar-search-drop">
        <div v-if="sidebarSearchOpen" class="sidebar-search" @keydown="onSidebarKeydown" @click.stop>
          <div class="sidebar-search-row">
            <i class="pi pi-search sidebar-search-icon" />
            <input
              ref="sidebarSearchInputEl"
              v-model="sidebarQuery"
              class="sidebar-search-input"
              placeholder="Search SuiteScript..."
              autocomplete="off"
              spellcheck="false"
              @input="onSidebarInput"
            />
            <button class="sidebar-search-close" @click="closeSidebarSearch" title="Close search (Esc)">
              <i class="pi pi-times" />
            </button>
          </div>
          <div v-if="sidebarResults.length > 0" class="sidebar-results" ref="sidebarResultsEl">
            <div
              v-for="(item, idx) in sidebarResults"
              :key="item.id"
              class="sidebar-result-item"
              :class="{ active: idx === sidebarActiveIdx }"
              @mouseenter="sidebarActiveIdx = idx"
              @click="selectSidebarItem(item)"
              :ref="(el) => setSidebarItemRef(el, idx)"
            >
              <span class="result-badge" :class="badgeClass(item.memberType)">{{ item.memberType }}</span>
              <span class="result-name">{{ item.name }}</span>
              <span class="result-module">{{ item.moduleName }}</span>
            </div>
          </div>
          <div v-else-if="sidebarIsSearching" class="sidebar-status">
            <i class="pi pi-spin pi-spinner" /> Searching...
          </div>
          <div v-else-if="sidebarQuery.trim()" class="sidebar-status">
            No results for "{{ sidebarQuery }}"
          </div>
        </div>
      </transition>

      <div class="detail-header">
        <div class="detail-header-main">
          <span class="detail-badge" :class="badgeClass(detailMember.memberType)">
            {{ detailMember.memberType }}
          </span>
          <h2 class="detail-title">{{ detailMember.name }}</h2>
          <span class="detail-module">{{ detailMember.moduleName }}</span>
        </div>
        <div class="detail-header-actions">
          <button class="action-btn" @click="openSidebarSearch" title="Search in sidebar (Ctrl+M)">
            <i class="pi pi-search" />
          </button>
          <button class="action-btn close-btn" @click="closeDetail">
            <i class="pi pi-times" />
          </button>
        </div>
      </div>

      <p v-if="detailMember.description" class="detail-description">
        {{ detailMember.description }}
      </p>

      <div class="detail-body">
        <!-- Loading full details -->
        <div v-if="isLoadingDetail" class="detail-loading">
          <i class="pi pi-spin pi-spinner" /> Loading...
        </div>

        <template v-else-if="detailFull">
          <!-- Overview -->
          <div v-if="detailFull.details?.overview" class="d-section">
            <h4 class="d-heading">Overview</h4>
            <div class="overview-list">
              <div
                v-for="(val, key) in detailFull.details.overview"
                :key="key"
                class="overview-item"
              >
                <span class="overview-label">{{ key }}</span>
                <span class="overview-value">{{ val }}</span>
              </div>
            </div>
          </div>

          <!-- Parameters -->
          <div v-if="detailFull.details?.parameters?.length" class="d-section">
            <h4 class="d-heading">Parameters</h4>
            <table class="params-table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Type</th>
                  <th>Required</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(p, i) in detailFull.details.parameters" :key="i">
                  <td class="param-name">{{ p.Parameter }}</td>
                  <td class="param-type">{{ p.Type }}</td>
                  <td class="param-req">{{ p["Required / Optional"] }}</td>
                  <td>{{ p.Description }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Errors -->
          <div v-if="detailFull.details?.errors?.length" class="d-section">
            <h4 class="d-heading">Errors</h4>
            <table class="params-table">
              <thead>
                <tr>
                  <th>Error Code</th>
                  <th>Thrown If</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(e, i) in detailFull.details.errors" :key="i">
                  <td class="error-code">{{ e["Error Code"] }}</td>
                  <td>{{ e["Thrown If"] }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Notes -->
          <div v-if="detailFull.details?.notes?.length" class="d-section">
            <h4 class="d-heading">Notes</h4>
            <ul class="notes-list">
              <li v-for="(n, i) in detailFull.details.notes" :key="i">{{ n }}</li>
            </ul>
          </div>

          <!-- Syntax -->
          <div v-if="detailFull.details?.syntax" class="d-section">
            <h4 class="d-heading">Syntax</h4>
            <CodeViewer
              :code="detailFull.details.syntax"
              language="javascript"
              :auto-height="true"
            />
          </div>

          <!-- Enum values -->
          <div v-if="detailFull.details?.enumValues?.length" class="d-section">
            <h4 class="d-heading">
              Values
              <span class="enum-count-badge">{{ detailFull.details.enumValues.length }}</span>
            </h4>
            <input
              v-model="enumSearch"
              class="enum-search-input"
              placeholder="Filter values..."
            />
            <div class="enum-grid">
              <span
                v-for="v in filteredEnumValues"
                :key="v"
                class="enum-tag"
              >{{ v }}</span>
              <span v-if="filteredEnumValues.length === 0" class="enum-no-match">No matches</span>
            </div>
          </div>

          <!-- Script types -->
          <div v-if="detailFull.scriptTypes" class="d-section">
            <h4 class="d-heading">Supported Script Types</h4>
            <p class="script-types-text">{{ detailFull.scriptTypes }}</p>
          </div>
        </template>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
import CodeViewer from "../components/CodeViewer.vue";
import {
  searchMembers,
  getMemberById,
  getModuleCount,
  getMemberCount,
  type ModuleSearchResult,
  type StoredMember
} from "../utils/modulesDb";

// ── State ──────────────────────────────────────────────────────────
const paletteOpen = ref(false);
const query = ref("");
const results = ref<ModuleSearchResult[]>([]);
const activeIdx = ref(0);
const isSearching = ref(false);
const searchInputEl = ref<HTMLInputElement | null>(null);
const resultsEl = ref<HTMLElement | null>(null);
const itemRefs: HTMLElement[] = [];

const detailMember = ref<ModuleSearchResult | null>(null);
const detailFull = ref<StoredMember | null>(null);
const isLoadingDetail = ref(false);
const enumSearch = ref("");

// Sidebar inline search
const sidebarSearchOpen = ref(false);
const sidebarQuery = ref("");
const sidebarResults = ref<ModuleSearchResult[]>([]);
const sidebarActiveIdx = ref(0);
const sidebarIsSearching = ref(false);
const sidebarSearchInputEl = ref<HTMLInputElement | null>(null);
const sidebarResultsEl = ref<HTMLElement | null>(null);
const sidebarItemRefs: HTMLElement[] = [];
let sidebarSearchDebounce: ReturnType<typeof setTimeout> | null = null;

// Panel resize
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = Math.round(window.innerWidth * 0.9);
const panelWidth = ref(500);
let resizing = false;
let resizeStartX = 0;
let resizeStartWidth = 0;

const TYPE_FILTERS = ["All", "Method", "Object", "Property", "Enum"] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];
const typeFilter = ref<TypeFilter>("All");

const dbStats = ref<{ moduleCount: number; memberCount: number } | null>(null);

let searchDebounce: ReturnType<typeof setTimeout> | null = null;

// ── Computed ───────────────────────────────────────────────────────
const filteredEnumValues = computed(() => {
  const vals = detailFull.value?.details?.enumValues ?? [];
  if (!enumSearch.value.trim()) return vals;
  const q = enumSearch.value.toLowerCase();
  return vals.filter((v) => v.toLowerCase().includes(q));
});

// ── Helpers ────────────────────────────────────────────────────────
const badgeClass = (type: string) => {
  const map: Record<string, string> = {
    Method: "badge-method",
    Object: "badge-object",
    Property: "badge-property",
    Enum: "badge-enum"
  };
  return map[type] ?? "";
};

const setItemRef = (el: unknown, idx: number) => {
  if (el) itemRefs[idx] = el as HTMLElement;
};

const setSidebarItemRef = (el: unknown, idx: number) => {
  if (el) sidebarItemRefs[idx] = el as HTMLElement;
};

const scrollActiveIntoView = () => {
  const el = itemRefs[activeIdx.value];
  if (el) el.scrollIntoView({ block: "nearest" });
};

// ── Palette open/close ─────────────────────────────────────────────
const openPalette = () => {
  paletteOpen.value = true;
  query.value = "";
  results.value = [];
  activeIdx.value = 0;
  nextTick(() => searchInputEl.value?.focus());
};

const closePalette = () => {
  paletteOpen.value = false;
  window.parent.postMessage({ type: "PALETTE_CLOSE" }, "*");
};

const closeDetail = () => {
  detailMember.value = null;
  detailFull.value = null;
  enumSearch.value = "";
  if (!paletteOpen.value) {
    window.parent.postMessage({ type: "PALETTE_CLOSE" }, "*");
  }
};

// ── Search ─────────────────────────────────────────────────────────
const onInput = () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  activeIdx.value = 0;
  searchDebounce = setTimeout(() => doSearch(), 180);
};

const doSearch = async () => {
  if (!query.value.trim()) {
    results.value = [];
    return;
  }
  isSearching.value = true;
  const memberType = typeFilter.value !== "All" ? typeFilter.value : undefined;
  results.value = await searchMembers(query.value, { limit: 40, memberType });
  isSearching.value = false;
  activeIdx.value = 0;
};

// ── Select ─────────────────────────────────────────────────────────
const selectItem = async (item: ModuleSearchResult) => {
  paletteOpen.value = false;
  enumSearch.value = "";
  detailMember.value = item;
  isLoadingDetail.value = true;
  detailFull.value = (await getMemberById(item.id)) ?? null;
  isLoadingDetail.value = false;
};

// ── Keyboard ───────────────────────────────────────────────────────
const onPaletteKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closePalette();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeIdx.value = Math.min(activeIdx.value + 1, results.value.length - 1);
    scrollActiveIntoView();
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    activeIdx.value = Math.max(activeIdx.value - 1, 0);
    scrollActiveIntoView();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const item = results.value[activeIdx.value];
    if (item) selectItem(item);
    return;
  }
};

// ── Sidebar inline search ──────────────────────────────────────────
const openSidebarSearch = () => {
  sidebarSearchOpen.value = true;
  sidebarQuery.value = "";
  sidebarResults.value = [];
  sidebarActiveIdx.value = 0;
  nextTick(() => sidebarSearchInputEl.value?.focus());
};

const closeSidebarSearch = () => {
  sidebarSearchOpen.value = false;
  sidebarQuery.value = "";
  sidebarResults.value = [];
};

const onSidebarInput = () => {
  if (sidebarSearchDebounce) clearTimeout(sidebarSearchDebounce);
  sidebarActiveIdx.value = 0;
  sidebarSearchDebounce = setTimeout(() => doSidebarSearch(), 180);
};

const doSidebarSearch = async () => {
  if (!sidebarQuery.value.trim()) {
    sidebarResults.value = [];
    return;
  }
  sidebarIsSearching.value = true;
  sidebarResults.value = await searchMembers(sidebarQuery.value, { limit: 20 });
  sidebarIsSearching.value = false;
  sidebarActiveIdx.value = 0;
};

const selectSidebarItem = async (item: ModuleSearchResult) => {
  closeSidebarSearch();
  enumSearch.value = "";
  detailMember.value = item;
  isLoadingDetail.value = true;
  detailFull.value = (await getMemberById(item.id)) ?? null;
  isLoadingDetail.value = false;
};

const onSidebarKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeSidebarSearch();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    sidebarActiveIdx.value = Math.min(sidebarActiveIdx.value + 1, sidebarResults.value.length - 1);
    sidebarItemRefs[sidebarActiveIdx.value]?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    sidebarActiveIdx.value = Math.max(sidebarActiveIdx.value - 1, 0);
    sidebarItemRefs[sidebarActiveIdx.value]?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    const item = sidebarResults.value[sidebarActiveIdx.value];
    if (item) selectSidebarItem(item);
    return;
  }
};

// ── Panel resize ───────────────────────────────────────────────────
const startResize = (e: MouseEvent) => {
  resizing = true;
  resizeStartX = e.clientX;
  resizeStartWidth = panelWidth.value;
  document.addEventListener("mousemove", onResizeMove);
  document.addEventListener("mouseup", stopResize);
};

const onResizeMove = (e: MouseEvent) => {
  if (!resizing) return;
  const delta = resizeStartX - e.clientX; // dragging left = wider
  const newWidth = Math.min(
    Math.max(resizeStartWidth + delta, PANEL_MIN_WIDTH),
    PANEL_MAX_WIDTH
  );
  panelWidth.value = newWidth;
};

const stopResize = () => {
  resizing = false;
  document.removeEventListener("mousemove", onResizeMove);
  document.removeEventListener("mouseup", stopResize);
};

// ── Type filter ────────────────────────────────────────────────────
const setTypeFilter = (t: TypeFilter) => {
  typeFilter.value = t;
  if (query.value.trim()) doSearch();
};

// ── Message listener (from content script) ────────────────────────
const onMessage = (e: MessageEvent) => {
  if (e.data?.type === "PALETTE_OPEN") {
    if (paletteOpen.value) {
      // Palette search modal already open — toggle it closed
      closePalette();
    } else if (detailMember.value) {
      // Sidebar detail panel is open — open inline search within it
      if (sidebarSearchOpen.value) {
        closeSidebarSearch();
      } else {
        openSidebarSearch();
      }
    } else {
      // Nothing open — open floating palette
      openPalette();
    }
  }
};

// ── Internal shortcut listener (handles Ctrl+M when iframe has focus) ──
let internalShortcut = "ctrl+m";

const parseShortcut = (s: string) => {
  const parts = s.toLowerCase().split("+");
  return { key: parts[parts.length - 1], modifiers: parts.slice(0, -1) };
};

const onInternalKeydown = (e: KeyboardEvent) => {
  const { key, modifiers } = parseShortcut(internalShortcut);
  const ctrlMatch = modifiers.includes("ctrl") ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey;
  const altMatch = modifiers.includes("alt") ? e.altKey : !e.altKey;
  const shiftMatch = modifiers.includes("shift") ? e.shiftKey : !e.shiftKey;
  const keyMatch = e.key.toLowerCase() === key;

  if (ctrlMatch && altMatch && shiftMatch && keyMatch) {
    e.preventDefault();
    e.stopPropagation();
    // Dispatch through the same message handler for consistent logic
    onMessage({ data: { type: "PALETTE_OPEN" } } as MessageEvent);
  }
};

onMounted(() => {
  window.addEventListener("message", onMessage);
  window.addEventListener("keydown", onInternalKeydown);

  // Load configured shortcut from extension settings
  try {
    chrome.storage.sync.get(["magic_netsuite_settings"], (result) => {
      if (result?.magic_netsuite_settings?.modulesSearch) {
        internalShortcut = result.magic_netsuite_settings.modulesSearch;
      }
    });
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.magic_netsuite_settings?.newValue?.modulesSearch) {
        internalShortcut = changes.magic_netsuite_settings.newValue.modulesSearch;
      }
    });
  } catch {
    // chrome API unavailable (e.g. dev mode outside extension) — use default
  }

  // Load DB stats for footer badge
  Promise.all([getModuleCount(), getMemberCount()]).then(([moduleCount, memberCount]) => {
    dbStats.value = { moduleCount, memberCount };
  }).catch(() => {
    dbStats.value = null;
  });
});

onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  window.removeEventListener("keydown", onInternalKeydown);
  document.removeEventListener("mousemove", onResizeMove);
  document.removeEventListener("mouseup", stopResize);
});
</script>

<style>
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  background: transparent;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  height: 100%;
  overflow: hidden;
}

#palette-app {
  height: 100%;
  width: 100%;
  position: relative;
}
</style>

<style scoped>
/* ── Backdrop ── */
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 100;
  backdrop-filter: blur(2px);
}

/* ── Palette modal ── */
.palette-modal {
  position: fixed;
  top: 14vh;
  left: 50%;
  transform: translateX(-50%);
  width: min(640px, 92vw);
  background: #ffffff;
  border-radius: 10px;
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.25),
    0 0 0 1px rgba(0, 0, 0, 0.08);
  z-index: 200;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.palette-search-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.8rem 1rem;
  border-bottom: 1px solid #e2e8f0;
}

.palette-icon {
  font-size: 0.9rem;
  color: #94a3b8;
  flex-shrink: 0;
}

.palette-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 0.95rem;
  font-family: inherit;
  color: #1e293b;
  background: transparent;
}

.palette-input::placeholder {
  color: #94a3b8;
}

.esc-hint {
  font-size: 0.65rem;
  background: #f1f5f9;
  color: #94a3b8;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 2px 5px;
  flex-shrink: 0;
}

/* ── Results ── */
.palette-results {
  max-height: 340px;
  overflow-y: auto;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1rem;
  cursor: pointer;
  transition: background 0.1s;
  border-bottom: 1px solid #f8fafc;
}

.result-item.active,
.result-item:hover {
  background: #f1f5f9;
}

.result-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 0.58rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

.badge-method {
  background: #dbeafe;
  color: #1d4ed8;
}
.badge-object {
  background: #f3e8ff;
  color: #7c3aed;
}
.badge-property {
  background: #dcfce7;
  color: #16a34a;
}
.badge-enum {
  background: #fef3c7;
  color: #d97706;
}

.result-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: #1e293b;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.result-module {
  font-size: 0.65rem;
  color: #94a3b8;
  flex-shrink: 0;
  white-space: nowrap;
}

.result-return {
  font-size: 0.65rem;
  color: #64748b;
  font-family: "JetBrains Mono", monospace;
  flex-shrink: 0;
  white-space: nowrap;
}

/* ── Status / hint / footer ── */
.palette-status,
.palette-hint {
  padding: 1.25rem 1rem;
  font-size: 0.8rem;
  color: #94a3b8;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
}

.palette-footer {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 0.45rem 1rem;
  border-top: 1px solid #f1f5f9;
  background: #fafafa;
  font-size: 0.65rem;
  color: #94a3b8;
}

.palette-footer kbd {
  font-size: 0.62rem;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 3px;
  padding: 1px 4px;
  color: #64748b;
}

.footer-spacer {
  flex: 1;
}

.db-stats {
  font-size: 0.62rem;
  color: #94a3b8;
  white-space: nowrap;
}

.db-stats-empty {
  color: #f59e0b;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

/* ── Type filter pills ── */
.type-filter-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 1rem;
  border-bottom: 1px solid #f1f5f9;
  background: #fafafa;
}

.type-pill {
  border: 1px solid #e2e8f0;
  background: #ffffff;
  border-radius: 4px;
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  cursor: pointer;
  color: #64748b;
  transition: background 0.1s, color 0.1s, border-color 0.1s;
}

.type-pill:hover {
  background: #f1f5f9;
}

/* Active states per type */
.type-pill.pill-all.active {
  background: #1e293b;
  color: #ffffff;
  border-color: #1e293b;
}
.type-pill.pill-method.active {
  background: #dbeafe;
  color: #1d4ed8;
  border-color: #93c5fd;
}
.type-pill.pill-object.active {
  background: #f3e8ff;
  color: #7c3aed;
  border-color: #c4b5fd;
}
.type-pill.pill-property.active {
  background: #dcfce7;
  color: #16a34a;
  border-color: #86efac;
}
.type-pill.pill-enum.active {
  background: #fef3c7;
  color: #d97706;
  border-color: #fcd34d;
}

/* ── Detail panel ── */
.detail-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 500px;
  max-width: 100vw;
  height: 100vh;
  background: #ffffff;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
  z-index: 150;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Resize handle ── */
.resize-handle {
  position: absolute;
  top: 0;
  left: 0;
  width: 5px;
  height: 100%;
  cursor: ew-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;
}

.resize-handle:hover,
.resize-handle:active {
  background: rgba(99, 102, 241, 0.25);
}

/* ── Sidebar inline search ── */
.sidebar-search {
  border-bottom: 2px solid #e2e8f0;
  background: #f8fafc;
  flex-shrink: 0;
}

.sidebar-search-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
}

.sidebar-search-icon {
  font-size: 0.8rem;
  color: #94a3b8;
  flex-shrink: 0;
}

.sidebar-search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 0.85rem;
  font-family: inherit;
  color: #1e293b;
  background: transparent;
}

.sidebar-search-input::placeholder {
  color: #94a3b8;
}

.sidebar-search-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  border-radius: 4px;
  font-size: 0.7rem;
  flex-shrink: 0;
  transition: all 0.1s;
}

.sidebar-search-close:hover {
  background: #e2e8f0;
  color: #475569;
}

.sidebar-results {
  max-height: 220px;
  overflow-y: auto;
  border-top: 1px solid #e2e8f0;
}

.sidebar-result-item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.75rem;
  cursor: pointer;
  transition: background 0.1s;
  border-bottom: 1px solid #f1f5f9;
}

.sidebar-result-item.active,
.sidebar-result-item:hover {
  background: #eff6ff;
}

.sidebar-status {
  padding: 0.6rem 0.75rem;
  font-size: 0.75rem;
  color: #94a3b8;
  border-top: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

/* Sidebar search transition */
.sidebar-search-drop-enter-active,
.sidebar-search-drop-leave-active {
  transition: max-height 0.2s ease, opacity 0.2s ease;
  overflow: hidden;
  max-height: 320px;
}

.sidebar-search-drop-enter-from,
.sidebar-search-drop-leave-to {
  max-height: 0;
  opacity: 0;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem 1rem 0.75rem;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
}

.detail-header-main {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.detail-badge {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 3px;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  align-self: flex-start;
}

.detail-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  font-family: "JetBrains Mono", monospace;
  word-break: break-word;
}

.detail-module {
  font-size: 0.7rem;
  color: #94a3b8;
}

.detail-header-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
  padding-top: 2px;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all 0.12s;
}

.action-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
}

.close-btn:hover {
  background: #fef2f2;
  border-color: #fecaca;
  color: #dc2626;
}

.detail-description {
  font-size: 0.78rem;
  color: #64748b;
  line-height: 1.5;
  margin: 0;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid #f1f5f9;
  flex-shrink: 0;
}

.detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 1rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.detail-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  color: #94a3b8;
  font-size: 0.8rem;
}

/* ── Detail sections ── */
.d-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.d-heading {
  font-size: 0.68rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.overview-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.overview-item {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.45rem 0.6rem;
  background: #f8fafc;
  border-left: 3px solid #cbd5e1;
  border-radius: 0 4px 4px 0;
  font-size: 0.72rem;
}

.overview-label {
  font-weight: 600;
  color: #94a3b8;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.overview-value {
  color: #334155;
  line-height: 1.5;
}

.params-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.7rem;
}

.params-table th {
  text-align: left;
  padding: 0.3rem 0.4rem;
  background: #f8fafc;
  color: #64748b;
  font-weight: 600;
  border-bottom: 1px solid #e2e8f0;
}

.params-table td {
  padding: 0.3rem 0.4rem;
  color: #475569;
  border-bottom: 1px solid #f1f5f9;
  vertical-align: top;
}

.param-name {
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
  color: #1e293b;
  white-space: nowrap;
}

.param-type {
  font-family: "JetBrains Mono", monospace;
  color: #1d4ed8;
  white-space: nowrap;
}

.param-req {
  white-space: nowrap;
}

.error-code {
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
  color: #dc2626;
  white-space: nowrap;
}

.notes-list {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.72rem;
  color: #475569;
  line-height: 1.5;
}

.enum-count-badge {
  display: inline-block;
  font-size: 0.6rem;
  font-weight: 500;
  background: #e2e8f0;
  color: #64748b;
  border-radius: 3px;
  padding: 1px 5px;
}

.enum-search-input {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  padding: 0.3rem 0.5rem;
  font-size: 0.72rem;
  font-family: inherit;
  outline: none;
  color: #334155;
  background: #fafafa;
}

.enum-search-input:focus {
  border-color: #94a3b8;
  background: #fff;
}

.enum-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  max-height: 150px;
  overflow-y: auto;
  padding: 0.1rem 0;
}

.enum-tag {
  display: inline-block;
  padding: 0.15rem 0.45rem;
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  font-size: 0.67rem;
  font-family: "JetBrains Mono", monospace;
  white-space: nowrap;
}

.enum-no-match {
  font-size: 0.7rem;
  color: #94a3b8;
  font-style: italic;
}

.script-types-text {
  font-size: 0.72rem;
  color: #475569;
  margin: 0;
}

/* ── Transitions ── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.palette-drop-enter-active,
.palette-drop-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
.palette-drop-enter-from,
.palette-drop-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}

.detail-slide-enter-active,
.detail-slide-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}
.detail-slide-enter-from,
.detail-slide-leave-to {
  opacity: 0;
  transform: translateX(40px);
}
</style>
