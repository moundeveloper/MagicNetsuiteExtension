<template>
  <div class="m-table" :style="{ height: height }">
    <!-- Header Toolbar -->
    <div
      v-if="$slots.toolbar || searchable || collapsible"
      class="m-table-header-toolbar"
    >
      <!-- Default Items Row -->
      <div class="m-table-toolbar-defaults">
        <!-- Search Input -->
        <div v-if="searchable" class="m-table-search">
          <i class="pi pi-search search-icon"></i>
          <InputText
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

        <!-- Column Visibility Toggle -->
        <div
          v-if="collapsible"
          class="m-table-column-toggle"
          ref="columnToggleRef"
        >
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

    <!-- Header Columns -->
    <div class="m-table-header" :style="{ gridTemplateColumns }">
      <div v-if="expandable" class="m-table-expand-cell"></div>
      <div
        v-for="(column, index) in visibleColumns"
        :key="index"
        class="m-table-header-cell"
      >
        {{ column.label }}
      </div>
    </div>

    <!-- Body with Virtual Scrolling -->
    <div class="m-table-body" ref="scrollContainer" @scroll="handleScroll">
      <!-- Loading State -->
      <div v-if="loading" class="m-table-loading">
        <slot name="loading">
          <MLoader />
        </slot>
      </div>

      <template v-else>
        <div :style="{ height: `${offsetTop}px`, flexShrink: 0 }"></div>

        <MTableRow
          v-for="row in visibleRows"
          :key="row.data.id"
          :row="row.data"
          :columns="visibleColumns"
          :expandable="expandable"
          :gridTemplateColumns="gridTemplateColumns"
          :expanded="isRowExpanded(row.data)"
          :autoRowHeight="autoRowHeight"
          @toggle-expand="toggleRowExpand(row.data)"
          @row-height="registerRowHeight"
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
      </template>
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
import MLoader from "../patterns/MLoader.vue";
import { InputText } from "primevue";

interface Column {
  label: string;
  field: string;
  width: string;
  slotContent?: any;
  contextMenu?: ContextMenuItem[];
  searchable?: boolean;
}

interface ColumnWithVisibility extends Column {
  visible: boolean;
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
    collapsible?: boolean;
    collapsibleKey?: string;
    autoRowHeight?: boolean;
    loading?: boolean;
  }>(),
  {
    rowHeight: 48,
    buffer: 3,
    searchable: false,
    searchPlaceholder: "Search...",
    expandable: false,
    collapsible: false,
    collapsibleKey: "m-table-columns",
    autoRowHeight: false,
    loading: false
  }
);

const slots = defineSlots();
const scrollContainer = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const containerHeight = ref(0);
const searchQuery = ref("");
const expandedRows = ref<Set<string>>(new Set());
const showColumnControls = ref(false);
const columnVisibility = ref<Record<string, boolean>>({});
const rowHeights = ref<Record<string, number>>({});
const rowElements = ref<Record<string, HTMLElement>>({});
const dropdownPosition = ref<"bottom" | "top">("bottom");
const dropdownStyle = ref<{ left: string; top: string }>({
  left: "0",
  top: "0"
});
const columnToggleRef = ref<HTMLElement | null>(null);
const dropdownRef = ref<HTMLElement | null>(null);

const updateDropdownPosition = () => {
  if (!columnToggleRef.value || !dropdownRef.value) return;

  const toggleRect = columnToggleRef.value.getBoundingClientRect();
  const dropdownRect = dropdownRef.value.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const spaceBelow = viewportHeight - toggleRect.bottom;
  const spaceAbove = toggleRect.top;
  const spaceRight = viewportWidth - toggleRect.left;
  const spaceLeft = toggleRect.right;

  const dropdownHeight = dropdownRect.height;
  const dropdownWidth = dropdownRect.width;

  let verticalPos: "bottom" | "top";
  if (spaceBelow >= dropdownHeight + 8) {
    verticalPos = "bottom";
  } else if (spaceAbove >= dropdownHeight + 8) {
    verticalPos = "top";
  } else if (spaceBelow >= spaceAbove) {
    verticalPos = "bottom";
  } else {
    verticalPos = "top";
  }

  dropdownPosition.value = verticalPos;

  let leftPos: number;
  if (spaceRight >= dropdownWidth + 8) {
    leftPos = toggleRect.left;
  } else if (spaceLeft >= dropdownWidth + 8) {
    leftPos = toggleRect.right - dropdownWidth;
  } else if (spaceRight >= spaceLeft) {
    leftPos = toggleRect.left;
  } else {
    leftPos = toggleRect.right - dropdownWidth;
  }

  dropdownStyle.value = {
    left: `${leftPos}px`,
    top:
      verticalPos === "bottom"
        ? `${toggleRect.bottom + 4}px`
        : `${toggleRect.top - dropdownRect.height - 4}px`
  };
};

// Add a computed for the estimated row height based on known heights
const estimatedRowHeight = computed(() => {
  const known = Object.values(rowHeights.value);
  if (known.length === 0) return props.rowHeight;
  
  // Filter to only include non-expanded rows (within 20% of base height)
  const nonExpanded = known.filter(h => h <= props.rowHeight * 1.2);
  if (nonExpanded.length > 0) {
    return Math.round(nonExpanded.reduce((a, b) => a + b, 0) / nonExpanded.length);
  }
  
  // If all cached rows are expanded, use min height (not max)
  const min = Math.min(...known);
  return Math.round(min);
});

const registerRowHeight = (id: string, height: number) => {
  if (props.autoRowHeight && height > 0) {
    rowHeights.value[id] = height;
  }
};

const handleScroll = (e: Event) => {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    const newScrollTop = (e.target as HTMLElement).scrollTop;
    const scrollDiff = Math.abs(newScrollTop - scrollTop.value);
    if (scrollDiff > 2 || newScrollTop === 0) {
      scrollTop.value = newScrollTop;
    }
  });
};

const STORAGE_PREFIX = "m-table-";

const loadColumnVisibility = () => {
  if (!props.collapsibleKey) return null;
  try {
    const saved = localStorage.getItem(STORAGE_PREFIX + props.collapsibleKey);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

const saveColumnVisibility = () => {
  if (!props.collapsibleKey) return;
  try {
    localStorage.setItem(
      STORAGE_PREFIX + props.collapsibleKey,
      JSON.stringify(columnVisibility.value)
    );
  } catch {
    // ignore storage errors
  }
};

const initColumnVisibility = () => {
  const cols = columns.value;
  const saved = loadColumnVisibility();

  const visibility: Record<string, boolean> = {};
  cols.forEach((col) => {
    if (saved && saved.hasOwnProperty(col.field)) {
      visibility[col.field] = saved[col.field];
    } else {
      visibility[col.field] = true;
    }
  });
  columnVisibility.value = visibility;
};

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
      const searchableProp = columnProps.searchable;
      const searchable =
        searchableProp === false || searchableProp === "false" ? false : true;

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

const columnsWithVisibility = computed<ColumnWithVisibility[]>(() => {
  return columns.value.map((col) => ({
    ...col,
    visible: columnVisibility.value[col.field] ?? true
  }));
});

const visibleColumns = computed(() => {
  if (!props.collapsible) return columns.value;
  return columns.value.filter(
    (col) => columnVisibility.value[col.field] !== false
  );
});

const toggleColumn = (field: string) => {
  columnVisibility.value[field] = !columnVisibility.value[field];
  saveColumnVisibility();
};

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

// Simple visibleRange for fixed height rows
const visibleRange = computed(() => {
  const buffer = Math.max(props.buffer, 5);
  const start = Math.max(
    0,
    Math.floor(scrollTop.value / props.rowHeight) - buffer
  );
  const end = Math.min(
    filteredRows.value.length,
    Math.ceil(
      (scrollTop.value + (containerHeight.value || 0)) / props.rowHeight
    ) + buffer
  );
  return { startIndex: start, endIndex: end };
});

// Compute all scroll-related values in one pass to ensure consistency
const scrollState = computed(() => {
  const estHeight = estimatedRowHeight.value;
  
  if (!props.autoRowHeight) {
    const start = visibleRange.value.startIndex;
    const end = visibleRange.value.endIndex;
    return {
      startIndex: start,
      endIndex: end,
      offsetTop: start * props.rowHeight,
      totalHeight: filteredRows.value.length * props.rowHeight
    };
  }

  const scrollPos = scrollTop.value;
  const viewportHeight = containerHeight.value || 0;
  const viewportEnd = scrollPos + viewportHeight;

  const minBuffer = Math.max(props.buffer, 5);
  const bufferPx = minBuffer * estHeight;

  let totalHeight = 0;
  let startIndex = 0;
  let endIndex = 0;
  let foundStart = false;

  for (let i = 0; i < filteredRows.value.length; i++) {
    const rowH = rowHeights.value[filteredRows.value[i]?.id] || estHeight;
    const rowTop = totalHeight;
    const rowBottom = totalHeight + rowH;

    if (!foundStart && rowBottom > scrollPos - bufferPx) {
      startIndex = i;
      foundStart = true;
    }
    if (foundStart && rowTop < viewportEnd + bufferPx) {
      endIndex = i + 1;
    }

    totalHeight = rowBottom;
  }

  if (!foundStart) {
    startIndex = filteredRows.value.length;
    endIndex = filteredRows.value.length;
  }

  let offsetTop = 0;
  for (let i = 0; i < startIndex; i++) {
    offsetTop += rowHeights.value[filteredRows.value[i]?.id] || estHeight;
  }

  return { startIndex, endIndex, offsetTop, totalHeight };
});

const visibleRows = computed<RowWithIndex[]>(() => {
  const { startIndex, endIndex } = scrollState.value;
  return filteredRows.value
    .slice(startIndex, endIndex)
    .map((row, idx) => ({ index: startIndex + idx, data: row }));
});

const offsetTop = computed(() => scrollState.value.offsetTop);

const offsetBottom = computed(() => {
  const { startIndex, endIndex, offsetTop, totalHeight } = scrollState.value;
  const estHeight = estimatedRowHeight.value;
  let renderedHeight = 0;
  for (let i = startIndex; i < endIndex; i++) {
    renderedHeight +=
      rowHeights.value[filteredRows.value[i]?.id] || estHeight;
  }
  return Math.max(0, totalHeight - offsetTop - renderedHeight);
});

const gridTemplateColumns = computed(() => {
  const visibleCols = props.collapsible ? visibleColumns.value : columns.value;
  const expandCol = props.expandable ? "40px " : "";
  const cols = visibleCols
    .map((c) => {
      const width = c.width || "1fr";
      if (
        width.includes("px") ||
        width.includes("rem") ||
        width.includes("%")
      ) {
        return width;
      }
      return `minmax(100px, ${width})`;
    })
    .join(" ");
  return expandCol + cols;
});

// Scroll handling
let rafId: number | null = null;

const updateContainerHeight = () => {
  if (scrollContainer.value)
    containerHeight.value = scrollContainer.value.clientHeight;
};

const isRowExpanded = (row: any) => expandedRows.value.has(row.id);

const toggleRowExpand = (row: any) => {
  if (!props.expandable) return;
  const isCollapsing = expandedRows.value.has(row.id);
  
  if (isCollapsing) {
    delete rowHeights.value[row.id];
  }
  
  if (isCollapsing) expandedRows.value.delete(row.id);
  else expandedRows.value.add(row.id);
  expandedRows.value = new Set(expandedRows.value);
  
  if (isCollapsing && scrollContainer.value) {
    nextTick(() => {
      if (scrollContainer.value) {
        scrollContainer.value.scrollTop += 1;
        nextTick(() => {
          if (scrollContainer.value) {
            scrollContainer.value.scrollTop -= 1;
          }
        });
      }
    });
  }
};

watch(
  () => props.rows,
  () => {
    scrollTop.value = 0;
    if (scrollContainer.value) scrollContainer.value.scrollTop = 0;
    // Clear cached heights since we have a new dataset
    rowHeights.value = {};
  }
);

watch(filteredRows, () => {
  scrollTop.value = 0;
  if (scrollContainer.value) scrollContainer.value.scrollTop = 0;
});

let prevExpandedRows = new Set<string>();
watch(
  () => expandedRows.value,
  (newVal) => {
    if (props.autoRowHeight) {
      prevExpandedRows.forEach((id) => {
        if (!newVal.has(id)) {
          delete rowHeights.value[id];
        }
      });
      prevExpandedRows = new Set(newVal);
    }
  },
  { deep: true }
);

watch(
  () => props.loading,
  (newVal) => {
    if (newVal === false) {
      nextTick(updateContainerHeight);
    }
  }
);

watch(
  () => props.height,
  () => {
    nextTick(updateContainerHeight);
  }
);

watch(
  () => props.collapsible,
  (newVal) => {
    if (newVal) {
      initColumnVisibility();
    }
  }
);

watch(showColumnControls, (isOpen) => {
  if (isOpen) {
    nextTick(updateDropdownPosition);
    document.addEventListener("click", handleOutsideClick);
  } else {
    document.removeEventListener("click", handleOutsideClick);
  }
});

const handleOutsideClick = (e: MouseEvent) => {
  if (!columnToggleRef.value?.contains(e.target as Node)) {
    showColumnControls.value = false;
  }
};

watch(
  columns,
  () => {
    if (props.collapsible) {
      initColumnVisibility();
    }
  },
  { deep: true }
);

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  nextTick(() => {
    updateContainerHeight();
    window.addEventListener("resize", updateContainerHeight);

    if (props.collapsible) {
      initColumnVisibility();
    }

    if (scrollContainer.value) {
      resizeObserver = new ResizeObserver(() => {
        updateContainerHeight();
      });
      resizeObserver.observe(scrollContainer.value);
    }
  });
});

onUnmounted(() => {
  window.removeEventListener("resize", updateContainerHeight);
  document.removeEventListener("click", handleOutsideClick);
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  if (rafId) cancelAnimationFrame(rafId);
});
</script>

<style scoped>
.m-table {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  min-width: 0;
}

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

.column-toggle-btn:hover {
  background: var(--p-slate-100);
}

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

.close-btn:hover {
  color: var(--p-slate-700);
}

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

.column-control-item:hover {
  background: var(--p-slate-100);
}

.column-control-item input {
  cursor: pointer;
}

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
  gap: 1px;
  background-color: var(--m-slate-200);
  border-bottom: 1px solid var(--p-slate-300);
  flex-shrink: 0;
  width: 100%;
  min-width: 0;
}

.m-table-header-cell {
  padding: 12px 16px;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--p-slate-900);
  text-align: left;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.m-table-body {
  overflow: auto;
  flex: 1;
  min-width: 0;
  position: relative;
}

.m-table-loading {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
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
