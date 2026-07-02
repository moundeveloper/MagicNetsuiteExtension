<!-- MTableStatic.vue — same look as MTable but renders all rows directly, no virtual scroll, no height prop -->
<template>
  <div class="m-table-static">
    <!-- Header Toolbar -->
    <div
      v-if="$slots.toolbar || searchable || collapsible"
      class="m-table-header-toolbar"
    >
      <div class="m-table-toolbar-defaults">
        <!-- Search -->
        <div v-if="searchable" class="m-table-search">
          <i class="pi pi-search search-icon"></i>
          <InputText
            type="text"
            v-model="searchQuery"
            :placeholder="searchPlaceholder"
            class="search-input"
          />
          <button v-if="searchQuery" @click="searchQuery = ''" class="search-clear">
            <i class="pi pi-times"></i>
          </button>
        </div>

        <!-- Column Visibility Toggle -->
        <div v-if="collapsible" class="m-table-column-toggle" ref="columnToggleRef">
          <button
            @click="showColumnControls = !showColumnControls"
            class="column-toggle-btn"
            :class="{ active: showColumnControls }"
            title="Toggle Columns"
          >
            <i class="pi pi-table"></i>
          </button>
          <div
            v-if="showColumnControls"
            ref="dropdownRef"
            class="column-controls-dropdown"
            :style="dropdownStyle"
          >
            <div class="column-controls-header">
              <span>Columns</span>
              <button @click="showColumnControls = false" class="close-btn">
                <i class="pi pi-times"></i>
              </button>
            </div>
            <div class="column-controls-list">
              <label
                v-for="(col, index) in columnsWithVisibility"
                :key="index"
                class="column-control-item"
              >
                <input
                  type="checkbox"
                  :checked="col.visible"
                  @change="toggleColumn(col.field)"
                />
                <span>{{ col.label }}</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- Custom toolbar slot -->
      <div v-if="$slots.toolbar" class="m-table-toolbar-custom">
        <slot name="toolbar" />
      </div>
    </div>

    <!-- Column Headers -->
    <div class="m-table-header" :style="{ gridTemplateColumns }">
      <div
        v-for="(column, index) in visibleColumns"
        :key="index"
        class="m-table-header-cell"
      >
        {{ column.label }}
      </div>
    </div>

    <!-- Column Filter Row -->
    <div
      v-if="hasFilterableColumns"
      class="m-table-filter-row"
      :style="{ gridTemplateColumns }"
    >
      <div
        v-for="(column, index) in visibleColumns"
        :key="index"
        class="m-table-filter-cell"
      >
        <input
          v-if="column.filterable"
          type="text"
          v-model="columnFilters[column.field]"
          :placeholder="`Filter…`"
          class="column-filter-input"
        />
      </div>
    </div>

    <!-- Body — scrolls naturally, no fixed height -->
    <div class="m-table-body">
      <!-- Loading -->
      <div v-if="loading" class="m-table-loading">
        <slot name="loading">
          <MLoader />
        </slot>
      </div>

      <template v-else>
        <!-- Rows -->
        <div
          v-for="(row, idx) in filteredRows"
          :key="row.id ?? idx"
          class="m-table-row"
          :style="{ gridTemplateColumns }"
        >
          <div
            v-for="(column, cidx) in visibleColumns"
            :key="cidx"
            class="m-table-cell"
            @contextmenu.prevent="
              column.contextMenu && showContextMenu($event, row, column.contextMenu!)
            "
          >
            <component
              v-if="column.slotContent"
              :is="column.slotContent"
              :value="row[column.field]"
              :row="row"
            />
            <span v-else>{{ row[column.field] }}</span>
          </div>
        </div>

        <!-- Empty state -->
        <div v-if="filteredRows.length === 0" class="m-table-empty">
          <slot name="empty">
            <i class="pi pi-search" style="font-size: 2rem; color: var(--p-slate-400)" />
            <p>{{ searchQuery ? `No results found for "${searchQuery}"` : 'No data.' }}</p>
          </slot>
        </div>
      </template>
    </div>

    <MContextMenu />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, type VNode } from "vue";
import { type ContextMenuItem } from "../../../composables/useMContextMenu";
import MContextMenu from "../contextMenu/MContextMenu.vue";
import MLoader from "../patterns/MLoader.vue";
import { InputText } from "primevue";
import { useMContextMenu } from "../../../composables/useMContextMenu";

interface Column {
  label: string;
  field: string;
  width: string;
  slotContent?: any;
  contextMenu?: ContextMenuItem[];
  searchable?: boolean;
  filterable?: boolean;
}

interface ColumnWithVisibility extends Column {
  visible: boolean;
}

const props = withDefaults(
  defineProps<{
    rows: any[];
    searchable?: boolean;
    searchPlaceholder?: string;
    collapsible?: boolean;
    collapsibleKey?: string;
    loading?: boolean;
  }>(),
  {
    searchable: false,
    searchPlaceholder: "Search...",
    collapsible: false,
    collapsibleKey: "m-table-static-columns",
    loading: false,
  }
);

const slots = defineSlots();
const searchQuery = ref("");
const showColumnControls = ref(false);
const columnVisibility = ref<Record<string, boolean>>({});
const columnToggleRef = ref<HTMLElement | null>(null);
const dropdownRef = ref<HTMLElement | null>(null);
const dropdownStyle = ref<{ left: string; top: string }>({ left: "0", top: "0" });

const { showContextMenu } = useMContextMenu();

const columnFilters = ref<Record<string, string>>({});
const hasFilterableColumns = computed(() => visibleColumns.value.some((c) => c.filterable));

// ── Column definitions extracted from default slot VNodes ─────────────────
const columns = computed<Column[]>(() => {
  const defaultSlot = slots.default?.();
  if (!defaultSlot) return [];
  return defaultSlot
    .filter((vnode: VNode) => vnode.type && typeof vnode.type === "object")
    .map((vnode: VNode) => {
      const p = vnode.props || {};
      let slotContent: any = null;
      if (vnode.children && typeof vnode.children === "object" && !Array.isArray(vnode.children)) {
        const childSlots = vnode.children as Record<string, () => any>;
        if (childSlots.default) slotContent = childSlots.default;
      }
      const contextMenu = p.contextMenu || p["context-menu"] || null;
      const searchableProp = p.searchable;
      const searchable = searchableProp === false || searchableProp === "false" ? false : true;
      const filterableProp = p.filterable;
      const filterable = filterableProp === true || filterableProp === "true" ? true : false;
      return {
        label: p.label || "",
        field: p.field || "",
        width: p.width || "1fr",
        slotContent,
        contextMenu,
        searchable,
        filterable,
      };
    });
});

const columnsWithVisibility = computed<ColumnWithVisibility[]>(() =>
  columns.value.map((col) => ({ ...col, visible: columnVisibility.value[col.field] ?? true }))
);

const visibleColumns = computed(() => {
  if (!props.collapsible) return columns.value;
  return columns.value.filter((col) => columnVisibility.value[col.field] !== false);
});

// ── Grid template ─────────────────────────────────────────────────────────
const gridTemplateColumns = computed(() => {
  const cols = visibleColumns.value
    .map((c) => {
      const w = c.width || "1fr";
      return w.includes("px") || w.includes("rem") || w.includes("%") ? w : `minmax(100px, ${w})`;
    })
    .join(" ");
  return cols;
});

// ── Search / filter ───────────────────────────────────────────────────────
const filteredRows = computed(() => {
  let rows = props.rows;

  // Global search
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase();
    const searchableCols = columns.value.filter((c) => c.searchable);
    rows = rows.filter((row) =>
      searchableCols.some((col) => {
        const val = row[col.field];
        return val != null && String(val).toLowerCase().includes(query);
      })
    );
  }

  // Per-column filters
  const activeFilters = Object.entries(columnFilters.value).filter(([, v]) => v.trim());
  if (activeFilters.length > 0) {
    rows = rows.filter((row) =>
      activeFilters.every(([field, filterVal]) => {
        const val = row[field];
        return val != null && String(val).toLowerCase().includes(filterVal.toLowerCase());
      })
    );
  }

  return rows;
});

watch(() => props.rows, () => { searchQuery.value = ""; columnFilters.value = {}; });

// ── Collapsible column visibility ─────────────────────────────────────────
const STORAGE_PREFIX = "m-table-static-";

const loadColumnVisibility = () => {
  try {
    const saved = localStorage.getItem(STORAGE_PREFIX + props.collapsibleKey);
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
};

const saveColumnVisibility = () => {
  try {
    localStorage.setItem(STORAGE_PREFIX + props.collapsibleKey, JSON.stringify(columnVisibility.value));
  } catch { /* ignore */ }
};

const initColumnVisibility = () => {
  const saved = loadColumnVisibility();
  const visibility: Record<string, boolean> = {};
  columns.value.forEach((col) => {
    visibility[col.field] = saved?.hasOwnProperty(col.field) ? saved[col.field] : true;
  });
  columnVisibility.value = visibility;
};

const toggleColumn = (field: string) => {
  columnVisibility.value[field] = !columnVisibility.value[field];
  saveColumnVisibility();
};

// ── Column toggle dropdown positioning ───────────────────────────────────
const updateDropdownPosition = () => {
  if (!columnToggleRef.value || !dropdownRef.value) return;
  const toggleRect = columnToggleRef.value.getBoundingClientRect();
  const dropdownRect = dropdownRef.value.getBoundingClientRect();
  const spaceRight = window.innerWidth - toggleRect.left;
  const leftPos = spaceRight >= dropdownRect.width + 8
    ? toggleRect.left
    : toggleRect.right - dropdownRect.width;
  dropdownStyle.value = {
    left: `${leftPos}px`,
    top: `${toggleRect.bottom + 4}px`,
  };
};

const handleOutsideClick = (e: MouseEvent) => {
  if (!columnToggleRef.value?.contains(e.target as Node)) {
    showColumnControls.value = false;
  }
};

watch(showColumnControls, (isOpen) => {
  if (isOpen) {
    nextTick(updateDropdownPosition);
    document.addEventListener("click", handleOutsideClick);
  } else {
    document.removeEventListener("click", handleOutsideClick);
  }
});

watch(columns, () => { if (props.collapsible) initColumnVisibility(); }, { deep: true });

onMounted(() => { if (props.collapsible) initColumnVisibility(); });
onUnmounted(() => { document.removeEventListener("click", handleOutsideClick); });
</script>

<style scoped>
/* ── Root ────────────────────────────────────────────────────────────────── */
.m-table-static {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  min-width: 0;
}

/* ── Toolbar ─────────────────────────────────────────────────────────────── */
.m-table-header-toolbar {
  padding: 12px 16px;
  border-bottom: 1px solid var(--p-slate-300);
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex-shrink: 0;
}

.m-table-toolbar-defaults {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.m-table-toolbar-custom {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px solid var(--p-slate-200);
}

/* ── Search ──────────────────────────────────────────────────────────────── */
.m-table-search {
  position: relative;
  flex: 1;
  max-width: 400px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--p-slate-400);
  font-size: 0.875rem;
}

.search-input {
  width: 100%;
  padding: 8px 36px;
  border: 1px solid var(--p-slate-300);
  border-radius: 6px;
  font-size: 0.875rem;
  outline: none;
}

.search-input:focus {
  border-color: var(--p-slate-400);
}

.search-clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--p-slate-400);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.search-clear:hover {
  background-color: var(--p-slate-100);
  color: var(--p-slate-600);
}

/* ── Column toggle ───────────────────────────────────────────────────────── */
.m-table-column-toggle {
  position: relative;
}

.column-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--p-slate-300);
  border-radius: 6px;
  background: var(--p-slate-100);
  cursor: pointer;
  transition: all 0.15s ease;
}

.column-toggle-btn:hover,
.column-toggle-btn.active {
  background: var(--p-slate-200);
  border-color: var(--p-slate-400);
}

.column-controls-dropdown {
  position: fixed;
  min-width: 200px;
  background: var(--p-slate-100);
  border: 1px solid var(--p-slate-300);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
}

.column-controls-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--p-slate-200);
  font-weight: 600;
  font-size: 0.875rem;
}

.close-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--p-slate-500);
}

.close-btn:hover { color: var(--p-slate-700); }

.column-controls-list {
  padding: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.column-control-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-radius: 4px;
  font-size: 0.875rem;
  transition: background 0.15s ease;
}

.column-control-item:hover { background: var(--p-slate-100); }
.column-control-item input { cursor: pointer; }

/* ── Column filter row ───────────────────────────────────────────────────── */
.m-table-filter-row {
  display: grid;
  border-bottom: 1px solid var(--p-slate-300);
  background: var(--p-slate-50);
  flex-shrink: 0;
  width: 100%;
  min-width: 0;
}

.m-table-filter-cell {
  padding: 4px 8px;
  min-width: 0;
  display: flex;
  align-items: center;
}

.column-filter-input {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--p-slate-300);
  border-radius: 4px;
  font-size: 0.8rem;
  outline: none;
  background: #fff;
  color: var(--p-slate-700);
}

.column-filter-input:focus {
  border-color: var(--p-indigo-400);
}

.column-filter-input::placeholder {
  color: var(--p-slate-400);
}

/* ── Column header ───────────────────────────────────────────────────────── */
.m-table-header {
  display: grid;
  border-bottom: 1px solid var(--p-slate-300);
  flex-shrink: 0;
  width: 100%;
  min-width: 0;
}

.m-table-header-cell {
  padding: 12px 16px;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--p-slate-800);
  text-align: left;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Body ────────────────────────────────────────────────────────────────── */
.m-table-body {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

/* ── Rows ────────────────────────────────────────────────────────────────── */
.m-table-row {
  display: grid;
  border-bottom: 1px solid var(--p-slate-200);
  min-width: 0;
}

.m-table-row:hover {
  background: var(--p-slate-50);
}

/* ── Cells ───────────────────────────────────────────────────────────────── */
.m-table-cell {
  padding: 12px 16px;
  font-size: 0.875rem;
  color: var(--p-slate-700);
  display: flex;
  align-items: center;
  border-right: 1px solid var(--p-slate-200);
  min-width: 0;
  overflow: hidden;
  word-break: break-word;
  white-space: normal;
  width: 100%;
}

.m-table-cell:last-child { border-right: none; }

/* ── Loading ─────────────────────────────────────────────────────────────── */
.m-table-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
}

/* ── Empty ───────────────────────────────────────────────────────────────── */
.m-table-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  gap: 12px;
  color: var(--p-slate-500);
}
</style>
