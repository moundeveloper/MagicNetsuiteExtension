<template>
  <MCard
    flex
    autoHeight
    direction="row"
    gap="0.5"
    padding=""
    outlined
    elevated
    :style="{ height: '90vh' }"
  >
    <template #default>
      <ExpandableSidebar>
        <template #collapsed>
          <button
            class="p-2 rounded bg-slate-600 hover:opacity-100 hover:bg-slate-500 transition-opacity duration-150 text-[var(--p-slate-50)]"
            @click="refreshCurrentFolder"
            title="Refresh"
          >
            <i class="pi pi-refresh text-sm"></i>
          </button>
        </template>
        <template #default>
          <!-- Folder tree -->
          <div class="sidebar-section sidebar-section-tree">
            <h4>Folders</h4>
            <InputText
              v-model="treeSearch"
              type="text"
              placeholder="Search folders..."
              size="small"
              class="w-full mb-2"
            />
            <div class="folder-tree-container">
              <div
                v-for="folder in filteredRootFolders"
                :key="folder.id"
                class="folder-tree-root"
              >
                <FolderTreeNode
                  :folder="folder"
                  :active-folder-id="currentFolderId"
                  :expanded-ids="expandedFolderIds"
                  @select="navigateToFolder"
                  @toggle="toggleFolderExpand"
                />
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="sidebar-section">
            <h4>Actions</h4>
            <div class="flex flex-col gap-2">
              <Button
                @click="refreshCurrentFolder"
                :disabled="isLoading"
                class="w-full"
                size="small"
              >
                <i class="pi pi-refresh font-medium"></i>
                {{ isLoading ? "Loading..." : "Refresh" }}
              </Button>
              <Button
                @click="navigateToFolder(null)"
                severity="secondary"
                class="w-full"
                size="small"
              >
                <i class="pi pi-home font-medium"></i>
                Root
              </Button>
            </div>
          </div>

          <!-- Info -->
          <div v-if="currentFolderInfo" class="sidebar-section">
            <h4>Folder Info</h4>
            <div class="text-xs space-y-1">
              <div><span class="text-gray-500">Name:</span> {{ currentFolderInfo.name }}</div>
              <div><span class="text-gray-500">Type:</span> {{ currentFolderInfo.foldertype || 'DEFAULT' }}</div>
              <div><span class="text-gray-500">Files:</span> {{ currentFolderInfo.numfolderfiles ?? '—' }}</div>
              <div><span class="text-gray-500">Size:</span> {{ formatFolderSize(currentFolderInfo.foldersize) }}</div>
              <div><span class="text-gray-500">ID:</span> {{ currentFolderInfo.id }}</div>
            </div>
          </div>
        </template>
      </ExpandableSidebar>

      <!-- Main content area -->
      <div class="flex-1 flex flex-col" style="min-width: 0">
        <!-- Breadcrumb bar -->
        <div class="fc-breadcrumb-bar">
          <button class="fc-breadcrumb-item" @click="navigateToFolder(null)">
            <i class="pi pi-home text-xs"></i>
          </button>
          <template v-for="(crumb, idx) in breadcrumbs" :key="crumb.id">
            <i class="pi pi-angle-right text-xs text-gray-400"></i>
            <button
              class="fc-breadcrumb-item"
              :class="{ active: idx === breadcrumbs.length - 1 && !openedFile }"
              @click="navigateToFolder(crumb.id)"
            >
              {{ crumb.name }}
            </button>
          </template>
          <!-- Open file name in breadcrumb -->
          <template v-if="openedFile">
            <i class="pi pi-angle-right text-xs text-gray-400"></i>
            <span class="fc-breadcrumb-item active">
              <i :class="getItemIcon(openedFile)" class="text-xs mr-1"></i>
              {{ openedFile.name }}
            </span>
          </template>
          <div class="ml-auto flex items-center gap-2">
            <template v-if="openedFile">
              <Button
                size="small"
                severity="secondary"
                @click="closeFile"
              >
                <i class="pi pi-arrow-left text-xs mr-1"></i>
                Back
              </Button>
            </template>
            <template v-else>
              <InputText
                v-model="contentSearch"
                type="text"
                placeholder="Filter..."
                size="small"
                class="fc-filter-input"
              />
              <button
                class="fc-view-toggle"
                :class="{ active: viewMode === 'grid' }"
                @click="viewMode = 'grid'"
                title="Grid view"
              >
                <i class="pi pi-th-large text-xs"></i>
              </button>
              <button
                class="fc-view-toggle"
                :class="{ active: viewMode === 'list' }"
                @click="viewMode = 'list'"
                title="List view"
              >
                <i class="pi pi-list text-xs"></i>
              </button>
            </template>
          </div>
        </div>

        <!-- ═══ OPENED FILE VIEW ═══ -->
        <template v-if="openedFile">
          <!-- File loading -->
          <div v-if="fileLoading" class="flex-1 flex items-center justify-center">
            <div class="text-center">
              <i class="pi pi-spin pi-spinner text-2xl text-gray-400"></i>
              <p class="text-sm text-gray-500 mt-2">Loading {{ openedFile.name }}...</p>
            </div>
          </div>

          <!-- File load error -->
          <div v-else-if="fileLoadError" class="flex-1 flex items-center justify-center">
            <div class="text-center text-red-500">
              <i class="pi pi-exclamation-circle text-3xl mb-2"></i>
              <p class="text-sm">{{ fileLoadError }}</p>
              <Button size="small" class="mt-2" @click="openFile(openedFile!)">Retry</Button>
            </div>
          </div>

          <!-- File content: Image -->
          <div v-else-if="fileIsBinary && fileContent" class="fc-file-view fc-file-image">
            <img :src="fileContent" :alt="openedFile.name" class="fc-image-content" />
          </div>

          <!-- File content: Text/Code -->
          <div v-else-if="fileContent !== null" class="fc-file-view fc-file-code">
            <CodeViewer
              :code="fileContent"
              :language="getCodeLanguage(openedFile)"
            />
          </div>

          <!-- No content -->
          <div v-else class="flex-1 flex items-center justify-center">
            <div class="text-center text-gray-500">
              <i class="pi pi-file text-4xl mb-2"></i>
              <p>Unable to display this file</p>
            </div>
          </div>
        </template>

        <!-- ═══ FOLDER LISTING VIEW ═══ -->
        <template v-else>
          <!-- Loading -->
          <div v-if="isLoading" class="flex-1 flex items-center justify-center">
            <i class="pi pi-spin pi-spinner text-2xl text-gray-400"></i>
          </div>

          <!-- Error -->
          <div v-else-if="loadError" class="flex-1 flex items-center justify-center">
            <div class="text-center text-red-500">
              <i class="pi pi-exclamation-circle text-3xl mb-2"></i>
              <p class="text-sm">{{ loadError }}</p>
              <Button size="small" class="mt-2" @click="refreshCurrentFolder">Retry</Button>
            </div>
          </div>

          <!-- Empty state -->
          <div v-else-if="filteredItems.length === 0 && !isLoading" class="flex-1 flex items-center justify-center">
            <div class="text-center text-gray-500">
              <i class="pi pi-folder-open text-4xl mb-2"></i>
              <p>{{ contentSearch ? 'No matching items' : 'This folder is empty' }}</p>
            </div>
          </div>

          <!-- Grid view -->
          <div
            v-else-if="viewMode === 'grid'"
            class="fc-grid-view"
            @contextmenu.prevent
          >
            <div
              v-for="item in filteredItems"
              :key="item.type + '-' + item.id"
              class="fc-grid-item"
              :class="{ selected: isSelected(item) }"
              @click="handleItemClick(item, $event)"
              @dblclick="handleItemDblClick(item)"
              @contextmenu.prevent="handleItemContext(item, $event)"
            >
              <div class="fc-grid-icon">
                <i :class="getItemIcon(item)" class="text-2xl"></i>
              </div>
              <div class="fc-grid-label" :title="item.name">{{ item.name }}</div>
              <div class="fc-grid-meta">
                <template v-if="item.type === 'folder'">
                  {{ item.numfolderfiles ?? 0 }} files
                </template>
                <template v-else>
                  {{ formatFileSize(item.filesize) }}
                </template>
              </div>
            </div>
          </div>

          <!-- List view -->
          <div
            v-else
            class="fc-list-view"
            @contextmenu.prevent
          >
            <table class="fc-table">
              <thead>
                <tr>
                  <th class="fc-th-name" @click="toggleSort('name')">
                    Name
                    <i v-if="sortField === 'name'" :class="sortDir === 'asc' ? 'pi pi-sort-up-fill' : 'pi pi-sort-down-fill'" class="text-xs ml-1"></i>
                  </th>
                  <th class="fc-th-type" @click="toggleSort('fileType')">
                    Type
                    <i v-if="sortField === 'fileType'" :class="sortDir === 'asc' ? 'pi pi-sort-up-fill' : 'pi pi-sort-down-fill'" class="text-xs ml-1"></i>
                  </th>
                  <th class="fc-th-size" @click="toggleSort('size')">
                    Size
                    <i v-if="sortField === 'size'" :class="sortDir === 'asc' ? 'pi pi-sort-up-fill' : 'pi pi-sort-down-fill'" class="text-xs ml-1"></i>
                  </th>
                  <th class="fc-th-date" @click="toggleSort('lastmodifieddate')">
                    Modified
                    <i v-if="sortField === 'lastmodifieddate'" :class="sortDir === 'asc' ? 'pi pi-sort-up-fill' : 'pi pi-sort-down-fill'" class="text-xs ml-1"></i>
                  </th>
                  <th class="fc-th-id">ID</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in filteredItems"
                  :key="item.type + '-' + item.id"
                  class="fc-table-row"
                  :class="{ selected: isSelected(item) }"
                  @click="handleItemClick(item, $event)"
                  @dblclick="handleItemDblClick(item)"
                  @contextmenu.prevent="handleItemContext(item, $event)"
                >
                  <td class="fc-td-name">
                    <i :class="getItemIcon(item)" class="text-sm mr-2"></i>
                    <span>{{ item.name }}</span>
                  </td>
                  <td class="fc-td-type">{{ item.type === 'folder' ? 'Folder' : (item.filetype || '—') }}</td>
                  <td class="fc-td-size">
                    <template v-if="item.type === 'folder'">
                      {{ formatFolderSize(item.foldersize) }}
                    </template>
                    <template v-else>
                      {{ formatFileSize(item.filesize) }}
                    </template>
                  </td>
                  <td class="fc-td-date">{{ item.lastmodifieddate || '—' }}</td>
                  <td class="fc-td-id">{{ item.id }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Status bar -->
          <div class="fc-status-bar">
            <span>{{ folderCount }} folder{{ folderCount !== 1 ? 's' : '' }}, {{ fileCount }} file{{ fileCount !== 1 ? 's' : '' }}</span>
            <span v-if="selectedItems.length > 0" class="ml-4">
              {{ selectedItems.length }} selected
            </span>
          </div>
        </template>
      </div>

      <!-- Detail / Preview panel -->
      <div v-if="detailItem && !openedFile" class="fc-detail-panel">
        <div class="fc-detail-header">
          <h4>{{ detailItem.name }}</h4>
          <button class="fc-detail-close" @click="detailItem = null">
            <i class="pi pi-times text-xs"></i>
          </button>
        </div>
        <div class="fc-detail-body">
          <div class="fc-detail-icon-large">
            <i :class="getItemIcon(detailItem)" class="text-4xl"></i>
          </div>

          <!-- Preview section -->
          <div v-if="detailItem.type === 'file' && isPreviewable(detailItem as FileItem)" class="fc-detail-preview">
            <div v-if="previewLoading" class="fc-preview-loading">
              <i class="pi pi-spin pi-spinner text-sm text-gray-400"></i>
            </div>
            <template v-else-if="previewContent">
              <!-- Image preview -->
              <img
                v-if="isImageFile(detailItem as FileItem)"
                :src="previewContent"
                :alt="detailItem.name"
                class="fc-preview-image"
              />
              <!-- Text/code preview -->
              <div v-else class="fc-preview-code">
                <CodeViewer
                  :code="previewContent"
                  :language="getCodeLanguage(detailItem as FileItem)"
                />
              </div>
            </template>
          </div>

          <!-- Open button for files -->
          <div v-if="detailItem.type === 'file' && (detailItem as FileItem).url" class="fc-detail-actions">
            <Button
              size="small"
              class="w-full"
              @click="openFile(detailItem as FileItem)"
            >
              <i class="pi pi-eye text-xs mr-1"></i>
              Open File
            </Button>
          </div>

          <div class="fc-detail-fields">
            <div class="fc-detail-field">
              <span class="label">Type</span>
              <span class="value">{{ detailItem.type === 'folder' ? 'Folder' : (detailItem.filetype || '—') }}</span>
            </div>
            <div class="fc-detail-field">
              <span class="label">Size</span>
              <span class="value">
                {{ detailItem.type === 'folder' ? formatFolderSize(detailItem.foldersize) : formatFileSize(detailItem.filesize) }}
              </span>
            </div>
            <div class="fc-detail-field">
              <span class="label">Modified</span>
              <span class="value">{{ detailItem.lastmodifieddate || '—' }}</span>
            </div>
            <div v-if="detailItem.type === 'file' && detailItem.createddate" class="fc-detail-field">
              <span class="label">Created</span>
              <span class="value">{{ detailItem.createddate }}</span>
            </div>
            <div class="fc-detail-field">
              <span class="label">Internal ID</span>
              <span class="value">{{ detailItem.id }}</span>
            </div>
            <div v-if="detailItem.description" class="fc-detail-field">
              <span class="label">Description</span>
              <span class="value">{{ detailItem.description }}</span>
            </div>
            <div v-if="detailItem.type === 'file' && detailItem.url" class="fc-detail-field">
              <span class="label">URL</span>
              <a :href="detailItem.url" target="_blank" class="value text-blue-600 hover:underline text-xs break-all">{{ detailItem.url }}</a>
            </div>
            <div v-if="detailItem.type === 'folder'" class="fc-detail-field">
              <span class="label">Files</span>
              <span class="value">{{ detailItem.numfolderfiles ?? 0 }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </MCard>

  <!-- Context menu -->
  <Teleport to="body">
    <div
      v-if="contextMenu.visible"
      ref="contextMenuRef"
      class="fc-context-menu"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      @contextmenu.prevent
    >
      <div
        v-for="(action, idx) in contextMenu.actions"
        :key="idx"
        class="fc-context-item"
        @click="action.handler(); contextMenu.visible = false"
      >
        <i :class="action.icon" class="text-xs"></i>
        <span>{{ action.label }}</span>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { callApi, ApiRequestType, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { Button, InputText, useToast } from "primevue";
import MCard from "../components/universal/card/MCard.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import FolderTreeNode from "../components/FolderTreeNode.vue";
import CodeViewer from "../components/CodeViewer.vue";

const toast = useToast();

// ── Types ──────────────────────────────────────────────────────────────────

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

interface FileItem {
  type: "file";
  id: number;
  name: string;
  filetype: string;
  filesize: number;
  folder: number;
  lastmodifieddate: string | null;
  createddate?: string | null;
  description?: string;
  url?: string;
}

type CabinetItem = FolderItem | FileItem;

// ── State ──────────────────────────────────────────────────────────────────

const isLoading = ref(false);
const loadError = ref<string | null>(null);
const currentFolderId = ref<number | null>(null);
const breadcrumbs = ref<{ id: number; name: string }[]>([]);

const rootFolders = ref<FolderItem[]>([]);
const childFoldersCache = ref<Map<number | null, FolderItem[]>>(new Map());
const currentSubfolders = ref<FolderItem[]>([]);
const currentFiles = ref<FileItem[]>([]);

const treeSearch = ref("");
const contentSearch = ref("");
const viewMode = ref<"grid" | "list">("list");
const sortField = ref<string>("name");
const sortDir = ref<"asc" | "desc">("asc");

const selectedItems = ref<CabinetItem[]>([]);
const detailItem = ref<CabinetItem | null>(null);

const expandedFolderIds = ref<Set<number>>(new Set());

const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  actions: [] as { label: string; icon: string; handler: () => void }[]
});
const contextMenuRef = ref<HTMLElement | null>(null);

// ── Open File state ────────────────────────────────────────────────────────

const openedFile = ref<FileItem | null>(null);
const fileContent = ref<string | null>(null);
const fileContentType = ref<string>("");
const fileIsBinary = ref(false);
const fileLoading = ref(false);
const fileLoadError = ref<string | null>(null);

// Preview in detail panel
const previewContent = ref<string | null>(null);
const previewLoading = ref(false);

// ── File type helpers ──────────────────────────────────────────────────────

const TEXT_FILE_TYPES = new Set([
  "JAVASCRIPT", "TYPESCRIPT", "PLAINTEXT", "CSV", "XMLDOC", "HTMLDOC",
  "JSON", "STYLESHEET", "FREEMARKER", "SVGIMAGE", "CONFIG"
]);

const IMAGE_FILE_TYPES = new Set([
  "JPGIMAGE", "PNGIMAGE", "GIFIMAGE", "BMPIMAGE", "TIFFIMAGE", "ICON"
]);

const isTextFile = (item: FileItem) => TEXT_FILE_TYPES.has(item.filetype);
const isImageFile = (item: FileItem) => IMAGE_FILE_TYPES.has(item.filetype);
const isPreviewable = (item: FileItem) => isTextFile(item) || isImageFile(item) || item.filetype === "SVGIMAGE";

const getCodeLanguage = (item: FileItem): "javascript" | "sql" => {
  if (item.filetype === "JAVASCRIPT" || item.filetype === "TYPESCRIPT") return "javascript";
  return "javascript"; // fallback — CodeViewer only supports js/sql
};

// ── Computed ───────────────────────────────────────────────────────────────

const currentFolderInfo = computed(() => {
  if (currentFolderId.value === null) return null;
  const findInTree = (folders: FolderItem[]): FolderItem | null => {
    for (const f of folders) {
      if (f.id === currentFolderId.value) return f;
      if (f.children) {
        const found = findInTree(f.children);
        if (found) return found;
      }
    }
    return null;
  };
  return findInTree(rootFolders.value);
});

const allItems = computed<CabinetItem[]>(() => {
  const folders: CabinetItem[] = currentSubfolders.value.map((f) => ({
    ...f,
    type: "folder" as const
  }));
  const files: CabinetItem[] = currentFiles.value.map((f) => ({
    ...f,
    type: "file" as const
  }));
  return [...folders, ...files];
});

const filteredItems = computed(() => {
  let items = allItems.value;

  if (contentSearch.value) {
    const q = contentSearch.value.toLowerCase();
    items = items.filter((item) => item.name.toLowerCase().includes(q));
  }

  // Sort: folders first, then by sortField
  items = [...items].sort((a, b) => {
    // Folders always before files
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;

    let cmp = 0;
    if (sortField.value === "name") {
      cmp = a.name.localeCompare(b.name);
    } else if (sortField.value === "fileType") {
      const aType = a.type === "folder" ? "Folder" : (a as FileItem).filetype || "";
      const bType = b.type === "folder" ? "Folder" : (b as FileItem).filetype || "";
      cmp = aType.localeCompare(bType);
    } else if (sortField.value === "size") {
      const aSize = a.type === "folder" ? (a as FolderItem).foldersize : (a as FileItem).filesize;
      const bSize = b.type === "folder" ? (b as FolderItem).foldersize : (b as FileItem).filesize;
      cmp = (aSize || 0) - (bSize || 0);
    } else if (sortField.value === "lastmodifieddate") {
      cmp = (a.lastmodifieddate || "").localeCompare(b.lastmodifieddate || "");
    }

    return sortDir.value === "asc" ? cmp : -cmp;
  });

  return items;
});

const filteredRootFolders = computed(() => {
  if (!treeSearch.value) return rootFolders.value;
  const q = treeSearch.value.toLowerCase();
  const matchesSearch = (folder: FolderItem): boolean => {
    if (folder.name.toLowerCase().includes(q)) return true;
    if (folder.children) return folder.children.some(matchesSearch);
    return false;
  };
  return rootFolders.value.filter(matchesSearch);
});

const folderCount = computed(() =>
  allItems.value.filter((i) => i.type === "folder").length
);
const fileCount = computed(() =>
  allItems.value.filter((i) => i.type === "file").length
);

// ── SuiteQL helpers ────────────────────────────────────────────────────────

const runQuery = async (sql: string): Promise<any[]> => {
  const response = await callApi(
    RequestRoutes.RUN_SUITEQL_QUERY,
    { sql, limit: 5000 },
    ApiRequestType.NORMAL
  );
  const result = (response as ApiResponse)?.message || response;
  if (result?.error) throw new Error(result.error);
  return Array.isArray(result) ? result : result?.results || [];
};

// ── Data fetching ──────────────────────────────────────────────────────────

const fetchRootFolders = async () => {
  const rows = await runQuery(`
    SELECT id, name, parent, foldertype, numFolderFiles, folderSize, lastModifiedDate, description
    FROM MediaItemFolder
    WHERE parent IS NULL
    ORDER BY name
  `);
  rootFolders.value = rows.map((r: any) => ({
    type: "folder" as const,
    id: r.id,
    name: r.name,
    parent: r.parent,
    foldertype: r.foldertype || "DEFAULT",
    numfolderfiles: r.numfolderfiles ?? 0,
    foldersize: r.foldersize ?? 0,
    lastmodifieddate: r.lastmodifieddate,
    description: r.description,
    children: undefined
  }));
};

const fetchChildFolders = async (parentId: number): Promise<FolderItem[]> => {
  if (childFoldersCache.value.has(parentId)) {
    return childFoldersCache.value.get(parentId)!;
  }
  const rows = await runQuery(`
    SELECT id, name, parent, foldertype, numFolderFiles, folderSize, lastModifiedDate, description
    FROM MediaItemFolder
    WHERE parent = ${parentId}
    ORDER BY name
  `);
  const children: FolderItem[] = rows.map((r: any) => ({
    type: "folder" as const,
    id: r.id,
    name: r.name,
    parent: r.parent,
    foldertype: r.foldertype || "DEFAULT",
    numfolderfiles: r.numfolderfiles ?? 0,
    foldersize: r.foldersize ?? 0,
    lastmodifieddate: r.lastmodifieddate,
    description: r.description,
    children: undefined
  }));
  childFoldersCache.value.set(parentId, children);
  return children;
};

const fetchFiles = async (folderId: number): Promise<FileItem[]> => {
  const rows = await runQuery(`
    SELECT id, name, fileType, fileSize, folder, lastModifiedDate, createdDate, description, url
    FROM File
    WHERE folder = ${folderId}
    ORDER BY name
  `);
  return rows.map((r: any) => ({
    type: "file" as const,
    id: r.id,
    name: r.name,
    filetype: r.filetype || "",
    filesize: r.filesize ?? 0,
    folder: r.folder,
    lastmodifieddate: r.lastmodifieddate,
    createddate: r.createddate,
    description: r.description,
    url: r.url
  }));
};

const buildBreadcrumbs = async (folderId: number | null) => {
  if (folderId === null) {
    breadcrumbs.value = [];
    return;
  }

  const crumbs: { id: number; name: string }[] = [];
  let current = folderId;

  // Walk up the parent chain (max 20 levels to prevent infinite loops)
  for (let i = 0; i < 20 && current !== null; i++) {
    // Check root folders first
    const rootMatch = rootFolders.value.find((f) => f.id === current);
    if (rootMatch) {
      crumbs.unshift({ id: rootMatch.id, name: rootMatch.name });
      break;
    }

    // Query for this folder
    const rows = await runQuery(`
      SELECT id, name, parent FROM MediaItemFolder WHERE id = ${current} AND ROWNUM <= 1
    `);
    if (rows.length === 0) break;

    crumbs.unshift({ id: rows[0].id, name: rows[0].name });
    current = rows[0].parent;
  }

  breadcrumbs.value = crumbs;
};

// ── Navigation ─────────────────────────────────────────────────────────────

const navigateToFolder = async (folderId: number | null) => {
  // Close any open file when navigating folders
  openedFile.value = null;
  fileContent.value = null;
  fileLoadError.value = null;

  isLoading.value = true;
  loadError.value = null;
  selectedItems.value = [];
  detailItem.value = null;
  contentSearch.value = "";

  try {
    currentFolderId.value = folderId;

    if (folderId === null) {
      // Root level
      await fetchRootFolders();
      currentSubfolders.value = rootFolders.value;
      currentFiles.value = [];
      breadcrumbs.value = [];
    } else {
      const [folders, files] = await Promise.all([
        fetchChildFolders(folderId),
        fetchFiles(folderId)
      ]);
      currentSubfolders.value = folders;
      currentFiles.value = files;
      await buildBreadcrumbs(folderId);

      // Also update the tree
      const parentFolder = findFolderInTree(rootFolders.value, folderId);
      if (parentFolder) {
        parentFolder.children = folders;
      }
    }
  } catch (err: any) {
    loadError.value = err.message || "Failed to load folder contents";
  } finally {
    isLoading.value = false;
  }
};

const refreshCurrentFolder = () => {
  childFoldersCache.value.clear();
  navigateToFolder(currentFolderId.value);
};

const toggleFolderExpand = async (folderId: number) => {
  if (expandedFolderIds.value.has(folderId)) {
    expandedFolderIds.value.delete(folderId);
  } else {
    expandedFolderIds.value.add(folderId);
    // Load children if not yet loaded
    const folder = findFolderInTree(rootFolders.value, folderId);
    if (folder && !folder.children) {
      folder.children = await fetchChildFolders(folderId);
    }
  }
  // Trigger reactivity
  expandedFolderIds.value = new Set(expandedFolderIds.value);
};

const findFolderInTree = (folders: FolderItem[], id: number): FolderItem | null => {
  for (const f of folders) {
    if (f.id === id) return f;
    if (f.children) {
      const found = findFolderInTree(f.children, id);
      if (found) return found;
    }
  }
  return null;
};

// ── File content fetching ──────────────────────────────────────────────────

const fetchFileContent = async (file: FileItem): Promise<{ content: string; contentType: string; binary: boolean } | null> => {
  if (!file.url) return null;
  const response = await callApi(
    RequestRoutes.FETCH_FILE_CONTENT,
    { fileUrl: file.url },
    ApiRequestType.NORMAL
  );
  const result = (response as ApiResponse)?.message || response;
  if (result?.error) throw new Error(result.error);
  return result;
};

const openFile = async (file: FileItem) => {
  if (!file.url) {
    toast.add({ severity: "warn", summary: "No URL", detail: "This file has no accessible URL", life: 3000 });
    return;
  }

  openedFile.value = file;
  fileContent.value = null;
  fileIsBinary.value = false;
  fileContentType.value = "";
  fileLoadError.value = null;
  fileLoading.value = true;

  try {
    const result = await fetchFileContent(file);
    if (result) {
      fileContent.value = result.content;
      fileContentType.value = result.contentType;
      fileIsBinary.value = result.binary;
    }
  } catch (err: any) {
    fileLoadError.value = err.message || "Failed to load file";
  } finally {
    fileLoading.value = false;
  }
};

const closeFile = () => {
  openedFile.value = null;
  fileContent.value = null;
  fileLoadError.value = null;
};

const loadPreview = async (file: FileItem) => {
  if (!file.url || !isPreviewable(file)) {
    previewContent.value = null;
    return;
  }

  previewLoading.value = true;
  try {
    const result = await fetchFileContent(file);
    if (result) {
      if (result.binary) {
        // Image: store data URL
        previewContent.value = result.content;
      } else {
        // Text: truncate for preview (first 50 lines)
        const lines = result.content.split("\n");
        previewContent.value = lines.slice(0, 50).join("\n");
        if (lines.length > 50) previewContent.value += "\n// ... truncated";
      }
    }
  } catch {
    previewContent.value = null;
  } finally {
    previewLoading.value = false;
  }
};

// ── Selection & interaction ────────────────────────────────────────────────

const isSelected = (item: CabinetItem) =>
  selectedItems.value.some((s) => s.type === item.type && s.id === item.id);

const handleItemClick = (item: CabinetItem, event: MouseEvent) => {
  if (event.ctrlKey || event.metaKey) {
    // Toggle multi-select
    const idx = selectedItems.value.findIndex(
      (s) => s.type === item.type && s.id === item.id
    );
    if (idx >= 0) {
      selectedItems.value.splice(idx, 1);
    } else {
      selectedItems.value.push(item);
    }
  } else {
    selectedItems.value = [item];
  }
  detailItem.value = item;
};

const handleItemDblClick = (item: CabinetItem) => {
  if (item.type === "folder") {
    navigateToFolder(item.id);
    expandedFolderIds.value.add(item.id);
    expandedFolderIds.value = new Set(expandedFolderIds.value);
  } else {
    // Open file in-view
    openFile(item as FileItem);
  }
};

const handleItemContext = (item: CabinetItem, event: MouseEvent) => {
  selectedItems.value = [item];
  detailItem.value = item;

  const actions: typeof contextMenu.value.actions = [];

  if (item.type === "folder") {
    actions.push({
      label: "Open Folder",
      icon: "pi pi-folder-open",
      handler: () => navigateToFolder(item.id)
    });
    actions.push({
      label: "Copy Folder ID",
      icon: "pi pi-copy",
      handler: () => copyToClipboard(String(item.id))
    });
  } else {
    if (item.url) {
      actions.push({
        label: "Open File",
        icon: "pi pi-eye",
        handler: () => openFile(item as FileItem)
      });
      actions.push({
        label: "Open in New Tab",
        icon: "pi pi-external-link",
        handler: () => window.open(item.url, "_blank")
      });
      actions.push({
        label: "Copy URL",
        icon: "pi pi-link",
        handler: () => copyToClipboard(item.url!)
      });
    }
    actions.push({
      label: "Copy File ID",
      icon: "pi pi-copy",
      handler: () => copyToClipboard(String(item.id))
    });
  }

  actions.push({
    label: "Copy Name",
    icon: "pi pi-file",
    handler: () => copyToClipboard(item.name)
  });

  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    actions
  };
};

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text).then(() => {
    toast.add({
      severity: "success",
      summary: "Copied",
      detail: text.length > 50 ? text.slice(0, 50) + "..." : text,
      life: 2000
    });
  });
};

// ── Sorting ────────────────────────────────────────────────────────────────

const toggleSort = (field: string) => {
  if (sortField.value === field) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortField.value = field;
    sortDir.value = "asc";
  }
};

// ── Formatting ─────────────────────────────────────────────────────────────

const formatFileSize = (bytes: number | null | undefined): string => {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatFolderSize = (kb: number | null | undefined): string => {
  if (!kb) return "—";
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

const FILE_TYPE_ICONS: Record<string, string> = {
  JAVASCRIPT: "pi pi-code text-yellow-600",
  TYPESCRIPT: "pi pi-code text-blue-600",
  XMLDOC: "pi pi-file text-orange-500",
  HTMLDOC: "pi pi-globe text-red-500",
  PLAINTEXT: "pi pi-file-edit text-gray-500",
  CSV: "pi pi-table text-green-600",
  EXCEL: "pi pi-file-excel text-green-700",
  PDF: "pi pi-file-pdf text-red-600",
  JPGIMAGE: "pi pi-image text-purple-500",
  PNGIMAGE: "pi pi-image text-purple-500",
  GIFIMAGE: "pi pi-image text-purple-500",
  BMPIMAGE: "pi pi-image text-purple-500",
  TIFFIMAGE: "pi pi-image text-purple-500",
  SVGIMAGE: "pi pi-image text-purple-500",
  ICON: "pi pi-image text-purple-500",
  JSON: "pi pi-file text-yellow-500",
  MISCBINARY: "pi pi-file text-gray-400",
  STYLESHEET: "pi pi-palette text-blue-500",
  FREEMARKER: "pi pi-file text-teal-500",
  AUTOCAD: "pi pi-file text-gray-600",
  ZIP: "pi pi-box text-amber-600",
  GZIP: "pi pi-box text-amber-600",
  TAR: "pi pi-box text-amber-600",
  WORD: "pi pi-file-word text-blue-700",
  POWERPOINT: "pi pi-file text-orange-600",
  CERTIFICATE: "pi pi-shield text-green-500"
};

const getItemIcon = (item: CabinetItem): string => {
  if (item.type === "folder") {
    const ft = (item as FolderItem).foldertype;
    if (ft === "SUITESCRIPTS") return "pi pi-code text-indigo-500";
    if (ft === "SUITEBUNDLES") return "pi pi-box text-amber-600";
    if (ft === "SUITEAPPS") return "pi pi-th-large text-teal-500";
    if (ft === "TEMPLATES") return "pi pi-file-pdf text-red-500";
    if (ft === "IMAGES") return "pi pi-image text-purple-500";
    if (ft === "CERTIFICATES") return "pi pi-shield text-green-500";
    return "pi pi-folder text-amber-500";
  }
  const fileType = (item as FileItem).filetype || "";
  return FILE_TYPE_ICONS[fileType] || "pi pi-file text-gray-400";
};

// ── Context menu dismiss ───────────────────────────────────────────────────

const handleDocClick = (event: MouseEvent) => {
  if (
    contextMenuRef.value &&
    !contextMenuRef.value.contains(event.target as Node)
  ) {
    contextMenu.value.visible = false;
  }
};

// ── Preview watcher ────────────────────────────────────────────────────────

watch(detailItem, (item) => {
  previewContent.value = null;
  if (item && item.type === "file" && isPreviewable(item as FileItem)) {
    loadPreview(item as FileItem);
  }
});

onMounted(async () => {
  document.addEventListener("click", handleDocClick);
  await navigateToFolder(null);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleDocClick);
});
</script>

<style scoped>
/* ── Sidebar ──────────────────────────────────────────────────────────────── */
.sidebar-section {
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  background: var(--p-slate-100);
  border-radius: 4px;
  border: 1px solid var(--p-slate-200);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sidebar-section h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-slate-700);
}

.sidebar-section-tree {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.folder-tree-container {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

/* ── Breadcrumb bar ───────────────────────────────────────────────────────── */
.fc-breadcrumb-bar {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  flex-shrink: 0;
  overflow-x: auto;
}

.fc-breadcrumb-item {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--p-slate-600);
  padding: 0.125rem 0.35rem;
  border-radius: 3px;
  white-space: nowrap;
  transition: background 0.15s;
}

.fc-breadcrumb-item:hover {
  background: var(--p-slate-200);
}

.fc-breadcrumb-item.active {
  font-weight: 600;
  color: var(--p-slate-800);
}

.fc-filter-input {
  max-width: 160px;
  font-size: 0.75rem;
}

.fc-view-toggle {
  width: 26px;
  height: 26px;
  border-radius: 4px;
  border: 1px solid var(--p-slate-300);
  background: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p-slate-500);
  transition: all 0.15s;
}

.fc-view-toggle.active {
  background: var(--p-slate-600);
  border-color: var(--p-slate-600);
  color: white;
}

/* ── Grid view ────────────────────────────────────────────────────────────── */
.fc-grid-view {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 0.5rem;
  align-content: start;
}

.fc-grid-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.75rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  border: 1px solid transparent;
}

.fc-grid-item:hover {
  background: var(--p-slate-100);
}

.fc-grid-item.selected {
  background: var(--p-indigo-50);
  border-color: var(--p-indigo-300);
}

.fc-grid-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fc-grid-label {
  font-size: 0.75rem;
  text-align: center;
  color: var(--p-slate-700);
  word-break: break-word;
  max-width: 100%;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.fc-grid-meta {
  font-size: 0.65rem;
  color: var(--p-slate-400);
}

/* ── List view ────────────────────────────────────────────────────────────── */
.fc-list-view {
  flex: 1;
  overflow-y: auto;
}

.fc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.fc-table thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

.fc-table th {
  background: var(--p-slate-100);
  padding: 0.5rem 0.75rem;
  text-align: left;
  font-weight: 600;
  color: var(--p-slate-600);
  font-size: 0.75rem;
  border-bottom: 1px solid var(--p-slate-200);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.fc-table th:hover {
  background: var(--p-slate-200);
}

.fc-th-name {
  width: 40%;
}

.fc-th-type {
  width: 15%;
}

.fc-th-size {
  width: 15%;
}

.fc-th-date {
  width: 20%;
}

.fc-th-id {
  width: 10%;
}

.fc-table-row {
  cursor: pointer;
  transition: background 0.1s;
}

.fc-table-row:hover {
  background: var(--p-slate-50);
}

.fc-table-row.selected {
  background: var(--p-indigo-50);
}

.fc-table-row td {
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--p-slate-100);
  color: var(--p-slate-700);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fc-td-name {
  display: flex;
  align-items: center;
}

/* ── Status bar ───────────────────────────────────────────────────────────── */
.fc-status-bar {
  padding: 0.35rem 0.75rem;
  border-top: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  font-size: 0.7rem;
  color: var(--p-slate-500);
  flex-shrink: 0;
}

/* ── Detail panel ─────────────────────────────────────────────────────────── */
.fc-detail-panel {
  width: 240px;
  border-left: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow-y: auto;
}

.fc-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 0.75rem;
  border-bottom: 1px solid var(--p-slate-200);
}

.fc-detail-header h4 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-slate-800);
  word-break: break-word;
}

.fc-detail-close {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
  color: var(--p-slate-400);
  border-radius: 3px;
  flex-shrink: 0;
}

.fc-detail-close:hover {
  background: var(--p-slate-200);
}

.fc-detail-body {
  padding: 0.75rem;
}

.fc-detail-icon-large {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 0;
}

.fc-detail-fields {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.fc-detail-field {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.fc-detail-field .label {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--p-slate-500);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.fc-detail-field .value {
  font-size: 0.8rem;
  color: var(--p-slate-700);
}

/* ── Context menu ─────────────────────────────────────────────────────────── */
.fc-context-menu {
  position: fixed;
  background: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  min-width: 160px;
  padding: 4px 0;
  border-radius: 6px;
  border: 1px solid var(--p-slate-200);
}

.fc-context-item {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--p-slate-700);
  transition: background 0.1s;
}

.fc-context-item:hover {
  background: var(--p-slate-100);
}

/* ── PrimeVue overrides ───────────────────────────────────────────────────── */
.sidebar-section :deep(.p-inputtext) {
  font-size: 0.75rem;
}

/* ── File view (opened file) ──────────────────────────────────────────────── */
.fc-file-view {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.fc-file-image {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: var(--p-slate-100);
}

.fc-image-content {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.fc-file-code {
  padding: 0;
}

.fc-file-code :deep(.code-viewer-wrapper) {
  height: 100%;
}

.fc-file-code :deep(.code-viewer) {
  height: 100%;
  border-radius: 0;
}

.fc-file-code :deep(.cm-editor) {
  height: 100%;
}

/* ── Detail panel preview ─────────────────────────────────────────────────── */
.fc-detail-preview {
  margin-bottom: 0.75rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 4px;
  overflow: hidden;
  max-height: 200px;
}

.fc-preview-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.fc-preview-image {
  width: 100%;
  height: auto;
  max-height: 200px;
  object-fit: contain;
  display: block;
}

.fc-preview-code {
  max-height: 200px;
  overflow: hidden;
  font-size: 0.65rem;
}

.fc-preview-code :deep(.code-viewer) {
  border-radius: 0;
  font-size: 10px;
}

.fc-preview-code :deep(.cm-editor) {
  max-height: 200px;
}

.fc-detail-actions {
  margin-bottom: 0.75rem;
}
</style>
