<template>
  <div class="m-table" :style="{ height: height }">
    <!-- Header Toolbar -->
    <div v-if="$slots.toolbar || searchable" class="m-table-header-toolbar">
      <!-- Search Input -->
      <div v-if="searchable" class="m-table-search">
        <i class="pi pi-search search-icon"></i>
        <input
          type="text"
          v-model="searchQuery"
          :placeholder="searchPlaceholder"
          class="search-input"
        />
        <button
          v-if="searchQuery"
          @click="searchQuery = ''"
          class="search-clear"
        >
          <i class="pi pi-times"></i>
        </button>
      </div>

      <!-- Custom toolbar slot -->
      <slot name="toolbar" />
    </div>

    <!-- Header Columns -->
    <div class="m-table-header" :style="gridTemplateColumns">
      <div v-if="expandable" class="m-table-expand-cell"></div>
      <div
        v-for="(column, index) in columns"
        :key="index"
        class="m-table-header-cell"
      >
        {{ column.label }}
      </div>
    </div>

    <!-- Body with Virtual Scrolling -->
    <div class="m-table-body" ref="scrollContainer" @scroll="handleScroll">
      <div :style="{ height: `${offsetTop}px` }"></div>

      <MTableRow
        v-for="row in visibleRows"
        :key="row.data.id"
        :row="row.data"
        :columns="columns"
        :expandable="expandable"
        :gridTemplateColumns="gridTemplateColumns"
        :expanded="isRowExpanded(row.data)"
        @toggle-expand="toggleRowExpand(row.data)"
      >
        <template #expand="{ row }">
          <slot name="expand" :row="row" />
        </template>
      </MTableRow>

      <div v-if="filteredRows.length === 0" class="m-table-empty">
        <i
          class="pi pi-search"
          style="font-size: 2rem; color: var(--p-slate-400)"
        />
        <p>No results found for "{{ searchQuery }}"</p>
      </div>

      <div :style="{ height: `${offsetBottom}px` }"></div>
    </div>

    <!-- Global Context Menu -->
    <MContextMenu />
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  nextTick,
  type VNode
} from "vue";
import { type ContextMenuItem } from "../../../composables/useMContextMenu";
import MContextMenu from "../contextMenu/MContextMenu.vue";
import MTableRow from "./MTableRow.vue";

interface Column {
  label: string;
  field: string;
  width: string;
  slotContent?: any;
  contextMenu?: ContextMenuItem[];
  searchable?: boolean;
}

interface RowWithIndex {
  index: number;
  data: any;
}

const props = withDefaults(
  defineProps<{
    rows: any[];
    height?: string;
    rowHeight?: number;
    buffer?: number;
    searchable?: boolean;
    searchPlaceholder?: string;
    expandable?: boolean;
  }>(),
  {
    rowHeight: 48,
    buffer: 5,
    searchable: false,
    searchPlaceholder: "Search...",
    expandable: false
  }
);

const slots = defineSlots();
const scrollContainer = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const containerHeight = ref(0);
const searchQuery = ref("");
const expandedRows = ref<Set<string>>(new Set()); // store row.id

// Extract column definitions from default slot
const columns = computed<Column[]>(() => {
  const defaultSlot = slots.default?.();
  if (!defaultSlot) return [];

  return defaultSlot
    .filter((vnode: VNode) => vnode.type && typeof vnode.type === "object")
    .map((vnode: VNode) => {
      const columnProps = vnode.props || {};
      let slotContent: any = null;

      if (
        vnode.children &&
        typeof vnode.children === "object" &&
        !Array.isArray(vnode.children)
      ) {
        const childrenSlots = vnode.children as Record<string, () => any>;
        if (childrenSlots.default) slotContent = childrenSlots.default;
      }

      const contextMenu =
        columnProps.contextMenu || columnProps["context-menu"] || null;
      const searchable =
        columnProps.searchable !== undefined ? columnProps.searchable : true;

      return {
        label: columnProps.label || "",
        field: columnProps.field || "",
        width: columnProps.width || "1fr",
        slotContent,
        contextMenu,
        searchable
      };
    });
});

// Filter rows based on search query
const filteredRows = computed(() => {
  if (!searchQuery.value.trim()) return props.rows;
  const query = searchQuery.value.toLowerCase();
  const searchableCols = columns.value.filter((c) => c.searchable);
  return props.rows.filter((row) =>
    searchableCols.some((col) => {
      const val = row[col.field];
      return val != null && String(val).toLowerCase().includes(query);
    })
  );
});

// Virtual scroll calculations
const visibleRange = computed(() => {
  const start = Math.max(
    0,
    Math.floor(scrollTop.value / props.rowHeight) - props.buffer
  );
  const end = Math.min(
    filteredRows.value.length,
    Math.ceil(
      (scrollTop.value + (containerHeight.value || 0)) / props.rowHeight
    ) + props.buffer
  );
  return { startIndex: start, endIndex: end };
});

const visibleRows = computed<RowWithIndex[]>(() => {
  const { startIndex, endIndex } = visibleRange.value;
  return filteredRows.value
    .slice(startIndex, endIndex)
    .map((row, idx) => ({ index: startIndex + idx, data: row }));
});

const offsetTop = computed(
  () => visibleRange.value.startIndex * props.rowHeight
);
const offsetBottom = computed(() =>
  Math.max(
    0,
    filteredRows.value.length * props.rowHeight -
      visibleRange.value.endIndex * props.rowHeight
  )
);

const gridTemplateColumns = computed(() => {
  const expandCol = props.expandable ? "40px " : "";
  const cols = columns.value.map((c) => c.width).join(" ");
  return { gridTemplateColumns: expandCol + cols };
});

// Scroll handling
const handleScroll = (e: Event) =>
  (scrollTop.value = (e.target as HTMLElement).scrollTop);
const updateContainerHeight = () => {
  if (scrollContainer.value)
    containerHeight.value = scrollContainer.value.clientHeight;
};

const isRowExpanded = (row: any) => expandedRows.value.has(row.id);

const toggleRowExpand = (row: any) => {
  if (!props.expandable) return;
  if (expandedRows.value.has(row.id)) expandedRows.value.delete(row.id);
  else expandedRows.value.add(row.id);
  expandedRows.value = new Set(expandedRows.value); // trigger reactivity
};

watch(searchQuery, () => {
  scrollTop.value = 0;
  if (scrollContainer.value) scrollContainer.value.scrollTop = 0;
});

onMounted(() => {
  updateContainerHeight();
  window.addEventListener("resize", updateContainerHeight);
  nextTick(updateContainerHeight);
});

onUnmounted(() => window.removeEventListener("resize", updateContainerHeight));
</script>

<style scoped>
.m-table {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 6px;
}

.m-table-header-toolbar {
  padding: 12px 16px;
  border-bottom: 1px solid var(--p-slate-300);
  display: flex;
  gap: 12px;
  align-items: center;
}

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
  padding: 8px 36px 8px 36px;
  border: 1px solid var(--p-slate-300);
  border-radius: 6px;
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.15s ease;
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
  transition: background-color 0.15s ease;
}

.search-clear:hover {
  background-color: var(--p-slate-100);
  color: var(--p-slate-600);
}

.m-table-header {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 1px;
  background-color: var(--m-slate-200);
  border-bottom: 1px solid var(--p-slate-300);
  position: sticky;
  top: 0;
  z-index: 10;
}

.m-table-header-cell {
  padding: 12px 16px;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--p-slate-900);
  text-align: left;
}

.m-table-body {
  overflow-y: auto;
  flex: 1;
}

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
