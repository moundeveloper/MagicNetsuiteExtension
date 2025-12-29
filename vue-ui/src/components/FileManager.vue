<template>
  <div class="file-manager">
    <div class="file-manager-content" style="display: flex; gap: 1rem">
      <!-- Folder Tree -->
      <Tree
        :value="folders"
        selectionMode="single"
        :selectionKeys="selectedFolder"
        @selection-change="onFolderSelect"
        @contextmenu="onFolderContextMenu"
      />
      <ContextMenu :model="folderMenu" ref="folderContextMenu" />

      <div style="flex: 1">
        <!-- Breadcrumb -->
        <Breadcrumb :model="breadcrumbItems" />

        <!-- Files Table -->
        <DataTable
          :value="files"
          :selection="selectedFile"
          selectionMode="single"
          @selection-change="onFileSelect"
          @contextmenu="onFileContextMenu"
        >
          <Column field="id" header="ID" />
          <Column field="name" header="Name" />
          <Column field="size" header="Size" />
          <Column field="modified" header="Modified" />
        </DataTable>
        <ContextMenu :model="fileMenu" ref="fileContextMenu" />
      </div>
    </div>

    <!-- Dialog Example -->
    <Dialog v-model:visible="showRenameDialog" header="Rename" modal>
      <div class="p-fluid">
        <InputText v-model="renameValue" />
      </div>
      <div class="p-mt-2">
        <Button label="Save" icon="pi pi-check" @click="renameItem" />
        <Button
          label="Cancel"
          icon="pi pi-times"
          class="p-button-secondary"
          @click="showRenameDialog = false"
        />
      </div>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type ContextMenu from "primevue/contextmenu";
import {
  Tree,
  DataTable,
  Column,
  Breadcrumb,
  Toolbar,
  ContextMenu as PrimeContextMenu,
  Button,
  Dialog,
  InputText,
  type TreeSelectionKeys,
} from "primevue";
import type { MenuItem } from "primevue/menuitem";

interface Folder {
  key: string;
  label: string;
  children?: Folder[];
}

interface File {
  id: number;
  name: string;
  size: string;
  modified: string;
}

// ------------------ State ------------------
const folders = ref<Folder[]>([
  { key: "1", label: "Root", children: [{ key: "2", label: "Projects" }] },
]);

const selectedFolder = ref<TreeSelectionKeys>();
const breadcrumbItems = ref([{ label: "Root" }]);

const files = ref<File[]>([
  { id: 1, name: "File1.docx", size: "12 KB", modified: "2025-12-23" },
]);

const selectedFile = ref<File | null>(null);

// Dialog state
const showRenameDialog = ref(false);
const renameValue = ref("");
let renameTarget: "file" | "folder" | null = null;

// ------------------ Toolbar ------------------
const toolbarItems: MenuItem[] = [
  { label: "Upload", icon: "pi pi-upload", command: () => uploadFile() },
  { label: "New Folder", icon: "pi pi-folder", command: () => createFolder() },
];

// ------------------ Context Menus ------------------
const folderMenu: MenuItem[] = [
  { label: "Rename", icon: "pi pi-pencil", command: () => openRenameFolder() },
  { label: "Delete", icon: "pi pi-trash", command: () => deleteFolder() },
];

const fileMenu: MenuItem[] = [
  { label: "Rename", icon: "pi pi-pencil", command: () => openRenameFile() },
  { label: "Delete", icon: "pi pi-trash", command: () => deleteFile() },
];

const folderContextMenu = ref<InstanceType<typeof ContextMenu> | null>(null);
const fileContextMenu = ref<InstanceType<typeof ContextMenu> | null>(null);

// ------------------ Methods ------------------
function onFolderSelect(event: { value: TreeSelectionKeys }) {
  selectedFolder.value = event.value; // OK now
  /*   loadFilesForFolder(selectedFolder.value as string);
  updateBreadcrumb(selectedFolder.value as string); */
}

function onFileSelect(event: any) {
  selectedFile.value = event.value;
}

// ------------------ Breadcrumb ------------------
function updateBreadcrumb(folderKey: string | null) {
  // Simple example: update breadcrumb based on folder key
  breadcrumbItems.value = [{ label: "Root" }];
  if (folderKey === "2") breadcrumbItems.value.push({ label: "Projects" });
}

// ------------------ Context Menu Handlers ------------------
function onFolderContextMenu(event: MouseEvent) {
  folderContextMenu.value?.show(event);
}

function onFileContextMenu(event: MouseEvent) {
  fileContextMenu.value?.show(event);
}

// ------------------ Dialog Actions ------------------
function openRenameFolder() {
  renameTarget = "folder";
  renameValue.value = getSelectedFolderName() ?? "";
  showRenameDialog.value = true;
}

function openRenameFile() {
  renameTarget = "file";
  renameValue.value = selectedFile.value?.name ?? "";
  showRenameDialog.value = true;
}

function renameItem() {
  if (renameTarget === "folder") {
    // Call backend to rename folder
    console.log("Rename folder to", renameValue.value);
  } else if (renameTarget === "file") {
    // Call backend to rename file
    console.log("Rename file to", renameValue.value);
    if (selectedFile.value) selectedFile.value.name = renameValue.value;
  }
  showRenameDialog.value = false;
  renameTarget = null;
}

// ------------------ Folder/File Actions ------------------
function getSelectedFolderName(): string | null {
  const findFolder = (folders: Folder[], key: string | null): Folder | null => {
    if (!key) return null;
    for (const f of folders) {
      if (f.key === key) return f;
      if (f.children) {
        const found = findFolder(f.children, key);
        if (found) return found;
      }
    }
    return null;
  };
  /*   return findFolder(folders.value, selectedFolder.value)?.label ?? null; */
  return null;
}

function createFolder() {
  console.log("Create folder inside", selectedFolder.value);
}

function deleteFolder() {
  console.log("Delete folder", selectedFolder.value);
}

function deleteFile() {
  console.log("Delete file", selectedFile.value?.name);
}

function uploadFile() {
  console.log("Upload file to folder", selectedFolder.value);
}

function downloadFile(file: File) {
  console.log("Download file", file.name);
}

// ------------------ Load files for folder ------------------
function loadFilesForFolder(folderKey: string | null) {
  // Example: replace with backend call
  if (folderKey === "2") {
    files.value = [
      { id: 2, name: "Project.docx", size: "50 KB", modified: "2025-12-23" },
    ];
  } else {
    files.value = [
      { id: 1, name: "File1.docx", size: "12 KB", modified: "2025-12-23" },
    ];
  }
}
</script>

<style scoped>
.file-manager {
  padding: 1rem;
}

.file-manager-content {
  margin-top: 1rem;
}
</style>
