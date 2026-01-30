<!-- MTable.vue -->
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
      <!-- Expand Column -->
      <div v-if="expandable" class="m-table-expand-cell"></div>

      <!-- Header Columns -->
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
      <!-- Spacer for rows above viewport -->
      <div :style="{ height: `${offsetTop}px` }"></div>

      <!-- Visible rows -->
      <template v-for="row in visibleRows" :key="row.index">
        <!-- Normal row -->
        <div class="m-table-row" :style="gridTemplateColumns">
          <div
            v-if="expandable"
            class="m-table-expand-cell cursor-pointer"
            @click.stop="toggleRowExpand(row.index)"
          >
            <i
              class="pi pi-angle-down"
              :style="{
                transition: 'transform 0.2s ease',
                transform: isRowExpanded(row.index)
                  ? 'rotate(180deg)'
                  : 'rotate(0deg)'
              }"
            ></i>
          </div>

          <div
            v-for="(column, colIndex) in columns"
            :key="colIndex"
            class="m-table-cell"
            @contextmenu="handleContextMenu($event, row.data, column)"
          >
            <component
              v-if="column.slotContent"
              :is="column.slotContent"
              :value="row.data[column.field]"
              :row="row.data"
            />
            <span v-else>{{ row.data[column.field] }}</span>
          </div>
        </div>

        <!-- 👇 Expanded row goes RIGHT HERE -->
        <div
          v-if="expandable && isRowExpanded(row.index)"
          class="m-table-row"
          :style="gridTemplateColumns"
        >
          <div class="m-table-expand-cell"></div>

          <div
            class="m-table-cell"
            :style="{ gridColumn: `span ${columns.length}` }"
          >
            <slot name="expand" :row="row.data" />
          </div>
        </div>
      </template>

      <!-- Empty state -->
      <div v-if="filteredRows.length === 0" class="m-table-empty">
        <i
          class="pi pi-search"
          style="font-size: 2rem; color: var(--p-slate-400)"
        ></i>
        <p>No results found for "{{ searchQuery }}"</p>
      </div>

      <!-- Spacer for rows below viewport -->
      <div :style="{ height: `${offsetBottom}px` }"></div>
    </div>

    <!-- Context Menu -->
    <Teleport to="body">
      <div
        v-if="contextMenuVisible"
        ref="contextMenuRef"
        class="context-menu"
        :style="{
          top: `${contextMenuPosition.y}px`,
          left: `${contextMenuPosition.x}px`
        }"
        @contextmenu.prevent
      >
        <div
          v-for="(item, index) in currentContextMenu"
          :key="index"
          class="context-menu-item"
          @click="item.action(contextMenuRow)"
        >
          <i v-if="item.icon" :class="item.icon" class="context-menu-icon"></i>
          <span>{{ item.label }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  ref,
  onMounted,
  onUnmounted,
  watch,
  nextTick,
  type VNode
} from "vue";

interface ContextMenuItem {
  label: string;
  icon?: string;
  action: (row: any) => void;
}

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
const contextMenuVisible = ref(false);
const contextMenuPosition = ref({ x: 0, y: 0 });
const contextMenuRef = ref<HTMLElement | null>(null);
const currentContextMenu = ref<ContextMenuItem[]>([]);
const contextMenuRow = ref<any>(null);
const searchQuery = ref("");

// Extract column information from slots
const columns = computed<Column[]>(() => {
  const defaultSlot = slots.default?.();
  if (!defaultSlot) return [];

  return defaultSlot
    .filter((vnode: VNode) => {
      return vnode.type && typeof vnode.type === "object";
    })
    .map((vnode: VNode) => {
      const columnProps = vnode.props || {};

      let slotContent = null;
      if (
        vnode.children &&
        typeof vnode.children === "object" &&
        !Array.isArray(vnode.children)
      ) {
        slotContent = (vnode.children as any).default;
      }

      // Extract contextMenu - check both camelCase and kebab-case
      const contextMenu =
        columnProps.contextMenu || columnProps["context-menu"] || null;

      // Extract searchable flag
      const searchable =
        columnProps.searchable !== undefined ? columnProps.searchable : true; // Default to true if not specified

      return {
        label: columnProps.label || "",
        field: columnProps.field || "",
        width: columnProps.width || "1fr",
        slotContent: slotContent,
        contextMenu: contextMenu,
        searchable: searchable
      };
    });
});

// Filter rows based on search query
const filteredRows = computed(() => {
  if (!searchQuery.value.trim()) {
    return props.rows;
  }

  const query = searchQuery.value.toLowerCase();
  const searchableColumns = columns.value.filter((col) => col.searchable);

  return props.rows.filter((row) => {
    return searchableColumns.some((column) => {
      const value = row[column.field];
      if (value === null || value === undefined) return false;
      return String(value).toLowerCase().includes(query);
    });
  });
});

// Handle context menu
const handleContextMenu = (event: MouseEvent, row: any, column: Column) => {
  if (!column.contextMenu || column.contextMenu.length === 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  contextMenuRow.value = row;
  currentContextMenu.value = column.contextMenu;

  // Calculate position with boundary detection
  const menuWidth = 200;
  const menuHeight = column.contextMenu.length * 36 + 8;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let x = event.clientX;
  let y = event.clientY;

  if (x + menuWidth > viewportWidth) {
    x = viewportWidth - menuWidth - 10;
  }

  if (y + menuHeight > viewportHeight) {
    y = viewportHeight - menuHeight - 10;
  }

  if (x < 10) {
    x = 10;
  }

  if (y < 10) {
    y = 10;
  }

  contextMenuPosition.value = { x, y };
  contextMenuVisible.value = true;
};

// Close context menu on outside click
const handleClickOutside = (event: MouseEvent) => {
  if (
    contextMenuRef.value &&
    !contextMenuRef.value.contains(event.target as Node)
  ) {
    contextMenuVisible.value = false;
  }
};

// Update container height
const updateContainerHeight = () => {
  if (scrollContainer.value) {
    containerHeight.value = scrollContainer.value.clientHeight;
  }
};

// Calculate visible range
const visibleRange = computed(() => {
  const height = containerHeight.value || 0;
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop.value / props.rowHeight) - props.buffer
  );
  const endIndex = Math.min(
    filteredRows.value.length,
    Math.ceil((scrollTop.value + height) / props.rowHeight) + props.buffer
  );

  return { startIndex, endIndex };
});

// Get visible rows with their indices
const visibleRows = computed<RowWithIndex[]>(() => {
  const { startIndex, endIndex } = visibleRange.value;
  return filteredRows.value.slice(startIndex, endIndex).map((row, idx) => ({
    index: startIndex + idx,
    data: row
  }));
});

// Calculate offset for spacers
const offsetTop = computed(() => {
  return visibleRange.value.startIndex * props.rowHeight;
});

const offsetBottom = computed(() => {
  const totalHeight = filteredRows.value.length * props.rowHeight;
  const visibleHeight = visibleRange.value.endIndex * props.rowHeight;
  return Math.max(0, totalHeight - visibleHeight);
});

// Handle scroll event
const handleScroll = (event: Event) => {
  const target = event.target as HTMLElement;
  scrollTop.value = target.scrollTop;
};

// Generate grid-template-columns based on column widths
const gridTemplateColumns = computed(() => {
  const expandCol = props.expandable ? "40px " : "";
  const cols = columns.value.map((col) => col.width).join(" ");
  return { gridTemplateColumns: expandCol + cols };
});

// Reset scroll when search changes
watch(searchQuery, () => {
  scrollTop.value = 0;
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = 0;
  }
});

// --- Expand logic ---

const expandedRows = ref<Set<number>>(new Set());

const isRowExpanded = (rowIndex: number) => {
  return expandedRows.value.has(rowIndex);
};

const toggleRowExpand = (rowIndex: number) => {
  if (!props.expandable) return;

  if (expandedRows.value.has(rowIndex)) {
    expandedRows.value.delete(rowIndex);
  } else {
    expandedRows.value.add(rowIndex);
  }

  // Force reactivity on Set mutation
  expandedRows.value = new Set(expandedRows.value);
};

// Watch for height changes
watch(
  () => props.height,
  () => {
    nextTick(() => {
      updateContainerHeight();
    });
  }
);

// Update scroll on mount
onMounted(() => {
  updateContainerHeight();

  if (scrollContainer.value) {
    scrollTop.value = scrollContainer.value.scrollTop;
  }

  document.addEventListener("click", handleClickOutside);
  window.addEventListener("resize", updateContainerHeight);

  nextTick(() => {
    updateContainerHeight();
  });
});

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside);
  window.removeEventListener("resize", updateContainerHeight);
});
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

.m-table-expand-cell {
  width: 40px; /* fixed size */
  min-width: 40px;
  max-width: 40px;

  display: flex;
  align-items: center;
  justify-content: center;
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

.m-table-row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 1px;
  border-bottom: 1px solid var(--p-slate-200);
  transition: background-color 0.15s ease;
}

.m-table-row:hover {
  background-color: var(--m-slate-100);
}

.m-table-row:last-child {
  border-bottom: none;
}

.m-table-cell {
  padding: 12px 16px;
  font-size: 0.875rem;
  color: var(--p-slate-700);
  display: flex;
  align-items: center;
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

/* Context Menu */
.context-menu {
  position: fixed;
  background: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  min-width: 160px;
  padding: 4px 0;
  border-block: 2px solid var(--p-slate-600);
}

.context-menu-item {
  padding: 8px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--p-slate-700);
  transition: background-color 0.15s ease;
}

.context-menu-item:hover {
  background-color: var(--p-slate-100);
}

.context-menu-icon {
  font-size: 0.875rem;
  color: var(--p-slate-600);
}
</style>
