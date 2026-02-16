<template>
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
        @click="handleItemClick(item)"
      >
        <i v-if="item.icon" :class="item.icon" class="context-menu-icon"></i>
        <span>{{ item.label }}</span>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useMContextMenu } from "../../../composables/useMContextMenu";

const {
  contextMenuVisible,
  contextMenuPosition,
  currentContextMenu,
  contextMenuRow,
  contextMenuRef,
  hideContextMenu
} = useMContextMenu();

const capturedRow = ref<any>(null);

watch(contextMenuVisible, (visible) => {
  if (visible) {
    capturedRow.value = contextMenuRow.value;
  } else {
    capturedRow.value = null;
  }
});

const handleItemClick = (item: any) => {
  if (item.action && capturedRow.value) {
    item.action(capturedRow.value);
  }
  hideContextMenu();
};

const handleClickOutside = (event: MouseEvent) => {
  if (
    contextMenuRef.value &&
    !contextMenuRef.value.contains(event.target as Node)
  ) {
    contextMenuVisible.value = false;
  }
};

onMounted(() => {
  document.addEventListener("click", handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener("click", handleClickOutside);
});
</script>

<style scoped>
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
