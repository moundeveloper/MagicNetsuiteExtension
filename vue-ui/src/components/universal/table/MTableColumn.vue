<!-- MTableColumn.vue -->
<template>
  <slot :value="value" :row="row"></slot>
</template>

<script setup lang="ts">
export interface ContextMenuItem {
  label: string;
  icon?: string;
  action: (row: any) => void;
}

defineProps<{
  label: string;
  field: string;
  width?: string;
  value?: any;
  row?: any;
  contextMenu?: ContextMenuItem[];
  searchable?: boolean;
}>();
</script>
