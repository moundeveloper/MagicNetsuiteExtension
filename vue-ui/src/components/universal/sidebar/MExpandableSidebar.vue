<template>
  <div
    class="expandable-sidebar"
    :class="{ 'is-expanded': isExpanded }"
    :style="sidebarStyles"
  >
    <div class="sidebar-header">
      <button
        class="toggle-btn"
        @click="toggleSidebar"
        :title="isExpanded ? 'Minimize' : 'Expand'"
      >
        <i :class="isExpanded ? 'pi pi-angle-left' : 'pi pi-angle-right'"></i>
      </button>
    </div>

    <!-- Collapsed icon actions — only visible when collapsed -->
    <div v-if="!isExpanded" class="collapsed-content">
      <slot name="collapsed"></slot>
    </div>

    <div class="sidebar-content" :class="{ 'is-hidden': !isExpanded }">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";

interface Props {
  expandedWidth?: string;
  collapsedWidth?: string;
  defaultExpanded?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  expandedWidth: "300px",
  collapsedWidth: "3rem",
  defaultExpanded: true
});

const isExpanded = ref(props.defaultExpanded);

const toggleSidebar = () => {
  isExpanded.value = !isExpanded.value;
};

const sidebarStyles = computed(() => ({
  width: isExpanded.value ? props.expandedWidth : props.collapsedWidth,
  minWidth: isExpanded.value ? props.expandedWidth : props.collapsedWidth
}));
</script>

<style scoped>
.expandable-sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: var(--p-slate-50);
  border-right: 1px solid var(--p-slate-300);
  transition:
    width 0.3s ease,
    min-width 0.3s ease;
  overflow: hidden;
  height: 100%;
}

.sidebar-header {
  display: flex;
  padding: 0.5rem;
  border-bottom: 1px solid var(--p-slate-200);
  justify-content: flex-end;
}

.toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  border: none;
  background: var(--p-slate-200);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.toggle-btn:hover {
  background: var(--p-slate-300);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  transition:
    opacity 0.2s ease,
    visibility 0.2s ease;
}

.sidebar-content.is-hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.collapsed-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
}
</style>
