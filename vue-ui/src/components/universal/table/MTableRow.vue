<!-- MTableRow.vue -->
<template>
  <div class="m-table-row-wrapper">
    <div class="m-table-row" :style="{ gridTemplateColumns }">
      <div
        v-if="expandable"
        class="m-table-expand-cell cursor-pointer"
        @click.stop="toggle"
      >
        <i
          class="pi pi-angle-down"
          :style="{
            transition: 'transform 0.2s ease',
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)'
          }"
        ></i>
      </div>

      <div
        v-for="(column, idx) in columns"
        :key="idx"
        class="m-table-cell"
        @contextmenu.prevent="
          column.contextMenu && showContextMenu($event, row, column.contextMenu)
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

    <div
      v-if="expandable && expanded"
      class="m-table-row"
      :style="{ gridTemplateColumns }"
    >
      <div class="m-table-expand-cell"></div>
      <div
        class="m-table-cell"
        :style="{ gridColumn: `span ${columns.length}` }"
      >
        <slot name="expand" :row="row" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useMContextMenu } from "../../../composables/useMContextMenu";

interface Column {
  label: string;
  field: string;
  width: string;
  slotContent?: any;
  contextMenu?: any[];
}

const props = defineProps<{
  row: any;
  columns: Column[];
  expandable: boolean;
  gridTemplateColumns: string;
  expanded: boolean; // <-- controlled from parent
}>();

const emit = defineEmits<{
  (e: "toggle-expand", row: any): void;
}>();

const toggle = () => {
  if (props.expandable) {
    emit("toggle-expand", props.row); // parent updates expandedRows
  }
};

const { showContextMenu } = useMContextMenu();
</script>

<style scoped>
.m-table-row {
  display: grid;
  gap: 0;
  border-bottom: 1px solid var(--p-slate-200);
  transition: background-color 0.15s ease;
  min-width: 0;
}

/* Normal cells with vertical dividers */
.m-table-cell {
  padding: 12px 16px;
  font-size: 0.875rem;
  color: var(--p-slate-700);
  display: flex;
  align-items: center;
  border-right: 1px solid var(--p-slate-200);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Remove right border for last cell */
.m-table-cell:last-child {
  border-right: none;
}

/* Expand/collapse cell */
.m-table-expand-cell {
  width: 40px;
  min-width: 40px;
  max-width: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-right: 1px solid var(--p-slate-200); /* line after expand column */
}

/* Expanded row content spanning all columns */
.m-table-expanded-content {
  grid-column: span 1000;
  padding: 12px 16px;
  background-color: rgba(226, 232, 240, 0.1); /* light transparent */
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.875rem;
  color: var(--p-slate-700);
}
</style>
