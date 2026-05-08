<template>
  <div class="tree-node">
    <div
      class="tree-node-row"
      :class="{ active: activeFolderId === folder.id }"
      @click.stop="$emit('select', folder.id)"
    >
      <button
        class="tree-toggle"
        :class="{ expanded: isExpanded, invisible: !hasChildren }"
        @click.stop="$emit('toggle', folder.id)"
      >
        <i class="pi pi-angle-right text-xs"></i>
      </button>
      <i :class="folderIcon" class="text-xs"></i>
      <span class="tree-label" :title="folder.name">{{ folder.name }}</span>
      <span v-if="folder.numfolderfiles" class="tree-badge">{{ folder.numfolderfiles }}</span>
    </div>
    <div v-if="isExpanded && folder.children" class="tree-children">
      <FolderTreeNode
        v-for="child in folder.children"
        :key="child.id"
        :folder="child"
        :active-folder-id="activeFolderId"
        :expanded-ids="expandedIds"
        @select="(id: number) => $emit('select', id)"
        @toggle="(id: number) => $emit('toggle', id)"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";

interface FolderItem {
  type: "folder";
  id: number;
  name: string;
  parent: number | null;
  foldertype: string;
  numfolderfiles: number;
  foldersize: number;
  lastmodifieddate: string | null;
  description?: string;
  children?: FolderItem[];
}

const props = defineProps<{
  folder: FolderItem;
  activeFolderId: number | null;
  expandedIds: Set<number>;
}>();

defineEmits<{
  select: [id: number];
  toggle: [id: number];
}>();

const isExpanded = computed(() => props.expandedIds.has(props.folder.id));

const hasChildren = computed(() => {
  // Show expand arrow if children loaded and non-empty, or if numfolderfiles hints at subfolders
  if (props.folder.children && props.folder.children.length > 0) return true;
  // If children haven't been loaded yet, assume it may have subfolders
  if (props.folder.children === undefined) return true;
  return false;
});

const FOLDER_TYPE_ICONS: Record<string, string> = {
  SUITESCRIPTS: "pi pi-code text-indigo-500",
  SUITEBUNDLES: "pi pi-box text-amber-600",
  SUITEAPPS: "pi pi-th-large text-teal-500",
  TEMPLATES: "pi pi-file-pdf text-red-500",
  IMAGES: "pi pi-image text-purple-500",
  CERTIFICATES: "pi pi-shield text-green-500"
};

const folderIcon = computed(() => {
  const ft = props.folder.foldertype;
  if (ft && FOLDER_TYPE_ICONS[ft]) return FOLDER_TYPE_ICONS[ft];
  return isExpanded.value ? "pi pi-folder-open text-amber-500" : "pi pi-folder text-amber-500";
});
</script>

<style scoped>
.tree-node {
  user-select: none;
}

.tree-node-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.35rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s;
}

.tree-node-row:hover {
  background: var(--p-slate-200);
}

.tree-node-row.active {
  background: var(--p-indigo-100);
  color: var(--p-indigo-800);
}

.tree-toggle {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  color: var(--p-slate-500);
  transition: transform 0.15s;
  border-radius: 3px;
}

.tree-toggle:hover {
  background: var(--p-slate-300);
}

.tree-toggle.expanded {
  transform: rotate(90deg);
}

.tree-toggle.invisible {
  visibility: hidden;
}

.tree-label {
  font-size: 0.75rem;
  color: var(--p-slate-700);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.tree-node-row.active .tree-label {
  font-weight: 600;
  color: var(--p-indigo-800);
}

.tree-badge {
  font-size: 0.6rem;
  color: var(--p-slate-400);
  background: var(--p-slate-100);
  padding: 0 0.3rem;
  border-radius: 8px;
  flex-shrink: 0;
  line-height: 1.4;
}

.tree-children {
  padding-left: 1rem;
}
</style>
