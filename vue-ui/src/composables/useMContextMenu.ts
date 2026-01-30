// useMContextMenu.ts
import { ref, onMounted, onUnmounted } from "vue";

export interface ContextMenuItem {
  label: string;
  icon?: string;
  action: (row: any) => void;
}

// Singleton reactive state
const contextMenuVisible = ref(false);
const contextMenuPosition = ref({ x: 0, y: 0 });
const contextMenuRow = ref<any>(null);
const currentContextMenu = ref<ContextMenuItem[]>([]);
const contextMenuRef = ref<HTMLElement | null>(null);

let initialized = false;

export const useMContextMenu = () => {
  // Initialize global click listener only once
  if (!initialized) {
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

    initialized = true;
  }

  // Show menu at event position
  const showContextMenu = (
    event: MouseEvent,
    row: any,
    items: ContextMenuItem[]
  ) => {
    event.preventDefault();
    event.stopPropagation();

    contextMenuRow.value = row;
    currentContextMenu.value = items;

    const menuWidth = 200;
    const menuHeight = items.length * 36 + 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = event.clientX;
    let y = event.clientY;

    if (x + menuWidth > viewportWidth) x = viewportWidth - menuWidth - 10;
    if (y + menuHeight > viewportHeight) y = viewportHeight - menuHeight - 10;
    if (x < 10) x = 10;
    if (y < 10) y = 10;

    contextMenuPosition.value = { x, y };
    contextMenuVisible.value = true;
  };

  const hideContextMenu = () => {
    contextMenuVisible.value = false;
  };

  return {
    contextMenuVisible,
    contextMenuPosition,
    contextMenuRow,
    currentContextMenu,
    contextMenuRef,
    showContextMenu,
    hideContextMenu
  };
};
