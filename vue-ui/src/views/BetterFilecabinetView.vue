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
      <!-- ── Sidebar ───────────────────────────────────────────────────── -->
      <ExpandableSidebar>
        <template #collapsed>
          <button
            class="p-2 rounded bg-slate-600 hover:opacity-100 hover:bg-slate-500 transition-opacity duration-150 text-[var(--p-slate-50)]"
            @click="refreshActivePane"
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
                  :active-folder-id="activeFolderId"
                  :expanded-ids="expandedFolderIds"
                  @select="navigateActivePane"
                  @toggle="toggleFolderExpand"
                />
              </div>
            </div>
          </div>

          <!-- Actions -->
          <div class="sidebar-section">
            <h4>Actions</h4>
            <div class="flex flex-col gap-2">
              <Button @click="refreshActivePane" class="w-full" size="small">
                <i class="pi pi-refresh font-medium"></i>
                Refresh
              </Button>
              <Button @click="navigateActivePane(null)" severity="secondary" class="w-full" size="small">
                <i class="pi pi-home font-medium"></i>
                Root
              </Button>
              <Button @click="openTrashPanel" severity="secondary" class="w-full" size="small">
                <i class="pi pi-trash font-medium"></i>
                Trash
                <span v-if="trashCount > 0" class="fc-trash-badge">{{ trashCount }}</span>
              </Button>
            </div>
          </div>

          <!-- Bookmarks -->
          <div class="sidebar-section">
            <h4
              class="fc-section-toggle"
              @click="showBookmarksSection = !showBookmarksSection"
            >
              <i class="pi pi-bookmark-fill text-yellow-500 text-xs"></i>
              Bookmarks
              <span v-if="bookmarks.length > 0" class="fc-trash-badge">{{ bookmarks.length }}</span>
              <i
                :class="showBookmarksSection ? 'pi pi-chevron-up' : 'pi pi-chevron-down'"
                class="ml-auto text-xs text-gray-400"
              ></i>
            </h4>
            <template v-if="showBookmarksSection">
              <div v-if="bookmarks.length === 0" class="text-xs text-gray-500 italic mt-1">
                No bookmarks yet. Right-click any file or folder to add one.
              </div>
              <div v-else class="fc-bookmarks-list">
                <div
                  v-for="bm in bookmarks"
                  :key="bm.id"
                  class="fc-bookmark-item"
                  :title="`${bm.name}\n${bm.parentFolderName}`"
                  @click="navigateToBookmark(bm)"
                >
                  <i
                    :class="getBookmarkStatusIcon(bm)"
                    class="fc-bookmark-status text-xs"
                    :style="{ color: bm.exists === true ? '#22c55e' : bm.exists === false ? '#ef4444' : '#9ca3af' }"
                  ></i>
                  <i
                    :class="bm.itemType === 'folder' ? 'pi pi-folder text-yellow-400' : 'pi pi-file text-blue-400'"
                    class="text-xs"
                  ></i>
                  <span class="fc-bookmark-name">{{ bm.name }}</span>
                  <button class="fc-bookmark-remove" @click.stop="removeBookmarkById(bm.id!)" title="Remove bookmark">
                    <i class="pi pi-times text-xs"></i>
                  </button>
                </div>
              </div>
              <Button
                v-if="bookmarks.length > 0"
                size="small"
                severity="secondary"
                class="w-full mt-2"
                :loading="isCheckingBookmarks"
                @click="checkAllBookmarks"
              >
                <i class="pi pi-check-circle text-xs mr-1"></i>
                Check Availability
              </Button>
            </template>
          </div>

          <!-- Folder Info -->
          <div v-if="activeFolderInfo" class="sidebar-section">
            <h4>Folder Info</h4>
            <div class="text-xs space-y-1">
              <div><span class="text-gray-500">Name:</span> {{ activeFolderInfo.name }}</div>
              <div><span class="text-gray-500">Type:</span> {{ activeFolderInfo.foldertype || 'DEFAULT' }}</div>
              <div><span class="text-gray-500">Files:</span> {{ activeFolderInfo.numfolderfiles ?? '—' }}</div>
              <div><span class="text-gray-500">Size:</span> {{ formatFolderSize(activeFolderInfo.foldersize) }}</div>
              <div><span class="text-gray-500">ID:</span> {{ activeFolderInfo.id }}</div>
            </div>
          </div>
        </template>
      </ExpandableSidebar>

      <!-- ── Workspace: tab bar + panes ──────────────────────────────── -->
      <div ref="workspaceRef" class="fc-workspace">

        <!-- ── SINGLE MODE ─────────────────────────────────────────── -->
        <template v-if="!isSplit">
          <!-- Tab bar -->
          <div class="fc-tabbar">
            <div class="fc-tabbar-tabs">
              <div
                v-for="pane in panes"
                :key="pane.id"
                class="fc-tab"
                :class="{
                  'fc-tab--active': pane.id === activePaneId,
                  'fc-tab--drop-before': reorderTarget?.id === pane.id && reorderTarget?.side === 'before',
                  'fc-tab--drop-after':  reorderTarget?.id === pane.id && reorderTarget?.side === 'after',
                }"
                draggable="true"
                @click="activePaneId = pane.id"
                @dragstart="onTabDragStart($event, pane.id)"
                @dragend="onTabDragEnd"
                @dragover.prevent="onTabReorderOver($event, pane.id)"
                @dragleave="reorderTarget = null"
                @drop.prevent="onTabReorderDrop(pane.id)"
              >
                <span class="fc-tab-label">{{ pane.label }}</span>
                <button
                  v-if="panes.length > 1"
                  class="fc-tab-close"
                  @click.stop="closePane(pane.id)"
                  title="Close tab"
                >
                  <i class="pi pi-times" style="font-size:0.6rem"></i>
                </button>
              </div>
              <button class="fc-tab-add" @click="addPane" title="New tab">
                <i class="pi pi-plus" style="font-size:0.75rem"></i>
              </button>
            </div>
          </div>

          <!-- Pane area — split overlays live here (opacity-based, always in DOM) -->
          <div
            class="fc-panes-area"
            :class="{ 'fc-panes-area--dragging': draggingTabId !== null }"
          >
            <div
              class="fc-split-overlay fc-split-overlay--left"
              :class="{ 'fc-split-overlay--active': splitDropSide === 'left' }"
              @dragover.prevent="splitDropSide = 'left'"
              @dragleave="splitDropSide = null"
              @drop.prevent="onDropSplit('left')"
            >
              <i class="pi pi-objects-column" style="font-size:1.1rem"></i>
              Split Left
            </div>
            <div
              class="fc-split-overlay fc-split-overlay--right"
              :class="{ 'fc-split-overlay--active': splitDropSide === 'right' }"
              @dragover.prevent="splitDropSide = 'right'"
              @dragleave="splitDropSide = null"
              @drop.prevent="onDropSplit('right')"
            >
              Split Right
              <i class="pi pi-objects-column" style="font-size:1.1rem"></i>
            </div>
            <FileCabinetPane
              v-for="pane in panes"
              :key="pane.id"
              v-show="pane.id === activePaneId"
              :ref="(el) => registerPaneRef(pane.id, el)"
              :bookmarked-ids="bookmarkedIds"
              :current-environment="currentEnvironment"
              @label-change="(label) => updatePaneLabel(pane.id, label)"
              @folder-navigate="(fid) => onPaneFolderNavigate(pane.id, fid)"
              @folder-info-change="(info) => onPaneFolderInfoChange(pane.id, info)"
              @bookmark-changed="reloadBookmarks"
              @trash-changed="reloadTrashCount"
              @expand-folder="expandFolderInTree"
            />
          </div>
        </template>

        <!-- ── SPLIT MODE ──────────────────────────────────────────── -->
        <template v-else>
          <div class="fc-split-container">
            <!-- Left group -->
            <div class="fc-split-group" :style="{ width: splitRatio + '%' }">
              <div class="fc-tabbar fc-split-tabbar" :class="{ 'fc-split-tabbar--drop-target': draggingTabId !== null && draggingGroup === 'right' }">
                <div class="fc-tabbar-tabs">
                  <div
                    v-for="pane in leftGroupPanes"
                    :key="pane.id"
                    class="fc-tab"
                    :class="{
                      'fc-tab--active': pane.id === leftActiveId,
                      'fc-tab--drop-before': reorderTarget?.id === pane.id && reorderTarget?.side === 'before',
                      'fc-tab--drop-after':  reorderTarget?.id === pane.id && reorderTarget?.side === 'after',
                    }"
                    draggable="true"
                    @click="leftActiveId = pane.id"
                    @dragstart="onTabDragStart($event, pane.id, 'left')"
                    @dragend="onTabDragEnd"
                    @dragover.prevent="onTabReorderOver($event, pane.id)"
                    @dragleave="reorderTarget = null"
                    @drop.prevent="onTabReorderDrop(pane.id)"
                  >
                    <span class="fc-tab-label">{{ pane.label }}</span>
                    <button
                      class="fc-tab-close"
                      @click.stop="closePaneFromSplit(pane.id, 'left')"
                      title="Close tab"
                    >
                      <i class="pi pi-times" style="font-size:0.6rem"></i>
                    </button>
                  </div>
                  <button class="fc-tab-add" @click="addPaneToGroup('left')" title="New tab">
                    <i class="pi pi-plus" style="font-size:0.75rem"></i>
                  </button>
                </div>
                <!-- Drop zone: receive from right (opacity-based, always in DOM) -->
                <div
                  class="fc-group-dropzone"
                  :class="{ 'fc-group-dropzone--active': dropZone === 'group-left' }"
                  @dragover.prevent="dropZone = 'group-left'"
                  @dragleave="dropZone = null"
                  @drop.prevent="moveTabToGroup(draggingTabId!, 'left')"
                >
                  <i class="pi pi-arrow-left text-xs mr-1"></i> Move here
                </div>
              </div>
              <div class="fc-panes-area">
                <FileCabinetPane
                  v-for="pane in leftGroupPanes"
                  :key="pane.id"
                  v-show="pane.id === leftActiveId"
                  :ref="(el) => registerPaneRef(pane.id, el)"
                  :bookmarked-ids="bookmarkedIds"
                  :current-environment="currentEnvironment"
                  @label-change="(label) => updatePaneLabel(pane.id, label)"
                  @folder-navigate="(fid) => onPaneFolderNavigate(pane.id, fid)"
                  @folder-info-change="(info) => onPaneFolderInfoChange(pane.id, info)"
                  @bookmark-changed="reloadBookmarks"
                  @trash-changed="reloadTrashCount"
                  @expand-folder="expandFolderInTree"
                />
              </div>
            </div>

            <!-- Resize handle -->
            <div class="fc-split-handle" @mousedown="startSplitResize"></div>

            <!-- Right group -->
            <div class="fc-split-group" style="flex: 1">
              <div class="fc-tabbar fc-split-tabbar" :class="{ 'fc-split-tabbar--drop-target': draggingTabId !== null && draggingGroup === 'left' }">
                <div class="fc-tabbar-tabs">
                  <div
                    v-for="pane in rightGroupPanes"
                    :key="pane.id"
                    class="fc-tab"
                    :class="{
                      'fc-tab--active': pane.id === rightActiveId,
                      'fc-tab--drop-before': reorderTarget?.id === pane.id && reorderTarget?.side === 'before',
                      'fc-tab--drop-after':  reorderTarget?.id === pane.id && reorderTarget?.side === 'after',
                    }"
                    draggable="true"
                    @click="rightActiveId = pane.id"
                    @dragstart="onTabDragStart($event, pane.id, 'right')"
                    @dragend="onTabDragEnd"
                    @dragover.prevent="onTabReorderOver($event, pane.id)"
                    @dragleave="reorderTarget = null"
                    @drop.prevent="onTabReorderDrop(pane.id)"
                  >
                    <span class="fc-tab-label">{{ pane.label }}</span>
                    <button
                      class="fc-tab-close"
                      @click.stop="closePaneFromSplit(pane.id, 'right')"
                      title="Close tab"
                    >
                      <i class="pi pi-times" style="font-size:0.6rem"></i>
                    </button>
                  </div>
                  <button class="fc-tab-add" @click="addPaneToGroup('right')" title="New tab">
                    <i class="pi pi-plus" style="font-size:0.75rem"></i>
                  </button>
                </div>
                <!-- Drop zone: receive from left (opacity-based, always in DOM) -->
                <div
                  class="fc-group-dropzone"
                  :class="{ 'fc-group-dropzone--active': dropZone === 'group-right' }"
                  @dragover.prevent="dropZone = 'group-right'"
                  @dragleave="dropZone = null"
                  @drop.prevent="moveTabToGroup(draggingTabId!, 'right')"
                >
                  Move here <i class="pi pi-arrow-right text-xs ml-1"></i>
                </div>
              </div>
              <div class="fc-panes-area">
                <FileCabinetPane
                  v-for="pane in rightGroupPanes"
                  :key="pane.id"
                  v-show="pane.id === rightActiveId"
                  :ref="(el) => registerPaneRef(pane.id, el)"
                  :bookmarked-ids="bookmarkedIds"
                  :current-environment="currentEnvironment"
                  @label-change="(label) => updatePaneLabel(pane.id, label)"
                  @folder-navigate="(fid) => onPaneFolderNavigate(pane.id, fid)"
                  @folder-info-change="(info) => onPaneFolderInfoChange(pane.id, info)"
                  @bookmark-changed="reloadBookmarks"
                  @trash-changed="reloadTrashCount"
                  @expand-folder="expandFolderInTree"
                />
              </div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </MCard>

  <!-- ── Trash panel ─────────────────────────────────────────────────────── -->
  <Teleport to="body">
    <div v-if="showTrashPanel" class="fc-confirm-overlay" @click.self="closeTrashPanel">
      <div class="fc-trash-panel">
        <div class="fc-trash-panel-header">
          <div class="flex items-center gap-2">
            <i class="pi pi-trash text-sm"></i>
            <span class="font-semibold">Trash</span>
            <span class="text-xs text-gray-400">({{ trashedItems.length }} items)</span>
          </div>
          <div class="flex items-center gap-2">
            <Button v-if="trashedItems.length > 0" size="small" severity="danger" @click="handleEmptyTrash">
              <i class="pi pi-ban text-xs mr-1"></i>
              Empty Trash
            </Button>
            <button class="fc-search-close" @click="closeTrashPanel">
              <i class="pi pi-times text-xs"></i>
            </button>
          </div>
        </div>
        <div class="fc-trash-panel-body">
          <div v-if="trashedItems.length === 0" class="fc-trash-empty">
            <i class="pi pi-check-circle text-2xl text-green-400"></i>
            <p>Trash is empty</p>
          </div>
          <div v-for="item in trashedItems" :key="item.id" class="fc-trash-item">
            <div class="fc-trash-item-icon">
              <i :class="item.itemType === 'folder' ? 'pi pi-folder text-amber-500' : 'pi pi-file text-gray-500'"></i>
            </div>
            <div class="fc-trash-item-info">
              <div class="fc-trash-item-name">{{ item.name }}</div>
              <div class="fc-trash-item-meta">
                <span>{{ item.originalFolderName }}</span>
                <template v-if="item.itemType === 'folder'">
                  <span v-if="getFolderTrashInfo(item) as any" class="text-xs text-gray-400">
                    &nbsp;·&nbsp;{{ getFolderTrashInfo(item)!.files }} file{{ getFolderTrashInfo(item)!.files !== 1 ? 's' : '' }}
                    <template v-if="getFolderTrashInfo(item)!.folders > 0">, {{ getFolderTrashInfo(item)!.folders }} subfolder{{ getFolderTrashInfo(item)!.folders !== 1 ? 's' : '' }}</template>
                    &nbsp;inside
                  </span>
                </template>
                <span class="fc-trash-item-timer">{{ formatTimeRemaining(item.deletedAt) }}</span>
              </div>
            </div>
            <div class="fc-trash-item-actions">
              <Button
                v-if="item.itemType === 'file' ? item.content !== null : true"
                size="small"
                severity="secondary"
                @click="restoreItem(item)"
                :loading="isRestoringId === item.id"
                title="Restore"
              >
                <i class="pi pi-undo text-xs"></i>
              </Button>
              <Button size="small" severity="danger" text @click="permanentlyDelete(item)" title="Delete permanently">
                <i class="pi pi-times text-xs"></i>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ── Restore folder picker ───────────────────────────────────────────── -->
  <Teleport to="body">
    <div v-if="showRestoreFolderPicker && restorePickerItem" class="fc-confirm-overlay" @click.self="showRestoreFolderPicker = false">
      <div class="fc-confirm-box" style="max-width: 440px">
        <div class="fc-confirm-header">
          <i class="pi pi-folder text-amber-500"></i>
          <span>Choose Restore Location</span>
        </div>
        <p class="fc-confirm-body">
          The original folder for <strong>{{ restorePickerItem.name }}</strong> is no longer available.
          Choose a folder to restore it to:
        </p>
        <div class="fc-restore-picker">
          <InputText
            v-model="restorePickerSearch"
            type="text"
            placeholder="Search folders..."
            size="small"
            class="w-full mb-2"
            @input="loadRestoreFolders"
          />
          <div class="fc-restore-folder-list">
            <div
              v-for="folder in restorePickerFolders"
              :key="folder.id"
              class="fc-restore-folder-item"
              @click="confirmRestoreToFolder(folder.id)"
            >
              <i class="pi pi-folder text-amber-500 text-xs"></i>
              <span>{{ folder.name }}</span>
              <span class="text-xs text-gray-400 ml-auto">#{{ folder.id }}</span>
            </div>
          </div>
        </div>
        <div class="fc-confirm-actions mt-3">
          <Button size="small" severity="secondary" @click="showRestoreFolderPicker = false">Cancel</Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, watch } from "vue";
import { callApi, ApiRequestType, type ApiResponse, getNetsuiteEnvironment } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { Button, InputText, useToast } from "primevue";
import MCard from "../components/universal/card/MCard.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import FolderTreeNode from "../components/FolderTreeNode.vue";
import FileCabinetPane from "../components/FileCabinetPane.vue";
import {
  getTrashedItems,
  removeFromTrash,
  emptyTrash,
  autoPurgeTrash,
  getTrashCount,
  formatTimeRemaining,
  type TrashedItem
} from "../utils/fileCabinetTrashDb";
import {
  addBookmark,
  removeBookmark,
  getBookmarks,
  getBookmarkByNetsuiteId,
  updateBookmarkExists,
  type Bookmark
} from "../utils/fileCabinetBookmarksDb";
import { callApi as apiCall } from "../utils/api";

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

interface FolderSnapshot {
  files: { id: number; name: string; filetype: string; filesize: number; content: string | null }[];
  subfolders: { id: number; name: string; snapshot: FolderSnapshot }[];
}

// ── Tab/Split state ────────────────────────────────────────────────────────

interface PaneDef {
  id: string;
  label: string;
}

let _paneCounter = 1;

const panes = ref<PaneDef[]>([{ id: "pane-1", label: "File Cabinet" }]);
const activePaneId = ref("pane-1");

// Split
const isSplit = ref(false);
const leftGroupIds = ref<string[]>(["pane-1"]);
const rightGroupIds = ref<string[]>([]);
const leftActiveId = ref("pane-1");
const rightActiveId = ref<string | null>(null);
const splitRatio = ref(50);
const workspaceRef = ref<HTMLElement | null>(null);

// Drag state
const draggingTabId = ref<string | null>(null);
const draggingGroup = ref<"left" | "right" | null>(null);
const dropZone = ref<"group-left" | "group-right" | null>(null);
const reorderTarget = ref<{ id: string; side: "before" | "after" } | null>(null);
const splitDropSide = ref<"left" | "right" | null>(null);

// Computed groups
const leftGroupPanes = computed(() => panes.value.filter((p) => leftGroupIds.value.includes(p.id)));
const rightGroupPanes = computed(() => panes.value.filter((p) => rightGroupIds.value.includes(p.id)));

// Pane refs
type PaneRef = InstanceType<typeof FileCabinetPane>;
const paneRefs: Record<string, PaneRef | null> = {};

const registerPaneRef = (id: string, el: any) => {
  paneRefs[id] = el as PaneRef | null;
};

// ── Sidebar sync (from active pane) ───────────────────────────────────────

const activeFolderId = ref<number | null>(null);
const activeFolderInfo = ref<FolderItem | null>(null);

const getActivePaneId = () => {
  if (isSplit.value) return leftActiveId.value; // left is "primary"
  return activePaneId.value;
};

const onPaneFolderNavigate = (paneId: string, folderId: number | null) => {
  if (paneId !== getActivePaneId()) return;
  activeFolderId.value = folderId;
  // Sync tree: expand path if needed
  if (folderId !== null) {
    expandedFolderIds.value.add(folderId);
    expandedFolderIds.value = new Set(expandedFolderIds.value);
  }
  // Refresh root folders in sidebar tree
  loadSidebarRootFolders();
};

const onPaneFolderInfoChange = (paneId: string, info: FolderItem | null) => {
  if (paneId !== getActivePaneId()) return;
  activeFolderInfo.value = info;
};

// ── Pane management ────────────────────────────────────────────────────────

const addPane = () => {
  _paneCounter++;
  const id = `pane-${_paneCounter}`;
  panes.value.push({ id, label: "File Cabinet" });
  activePaneId.value = id;
};

const addPaneToGroup = (group: "left" | "right") => {
  _paneCounter++;
  const id = `pane-${_paneCounter}`;
  panes.value.push({ id, label: "File Cabinet" });
  if (group === "left") {
    leftGroupIds.value = [...leftGroupIds.value, id];
    leftActiveId.value = id;
  } else {
    rightGroupIds.value = [...rightGroupIds.value, id];
    rightActiveId.value = id;
  }
};

const closePane = (paneId: string) => {
  if (panes.value.length <= 1) return;
  const idx = panes.value.findIndex((p) => p.id === paneId);
  panes.value.splice(idx, 1);
  delete paneRefs[paneId];
  if (activePaneId.value === paneId) {
    activePaneId.value = panes.value[Math.max(0, idx - 1)]?.id ?? panes.value[0]!.id;
  }
};

const closePaneFromSplit = (paneId: string, group: "left" | "right") => {
  if (group === "left") {
    leftGroupIds.value = leftGroupIds.value.filter((id) => id !== paneId);
    if (leftGroupIds.value.length === 0) {
      // Collapse split — bring right group to single mode
      isSplit.value = false;
      activePaneId.value = rightActiveId.value ?? rightGroupIds.value[0] ?? panes.value[0]!.id;
      leftGroupIds.value = [...rightGroupIds.value];
      rightGroupIds.value = [];
    } else {
      leftActiveId.value = leftGroupIds.value[0]!;
    }
  } else {
    rightGroupIds.value = rightGroupIds.value.filter((id) => id !== paneId);
    if (rightGroupIds.value.length === 0) {
      // Collapse split
      isSplit.value = false;
      activePaneId.value = leftActiveId.value ?? leftGroupIds.value[0] ?? panes.value[0]!.id;
      rightGroupIds.value = [];
    } else {
      rightActiveId.value = rightGroupIds.value[0]!;
    }
  }
  // Remove pane entirely
  const idx = panes.value.findIndex((p) => p.id === paneId);
  if (idx >= 0) panes.value.splice(idx, 1);
  delete paneRefs[paneId];
};

// ── Tab drag → split ───────────────────────────────────────────────────────

const onTabDragStart = (event: DragEvent, paneId: string, group?: "left" | "right") => {
  draggingTabId.value = paneId;
  draggingGroup.value = group ?? null;
  // Required for Firefox
  event.dataTransfer?.setData("text/plain", paneId);
};

const onTabDragEnd = () => {
  draggingTabId.value = null;
  draggingGroup.value = null;
  dropZone.value = null;
  reorderTarget.value = null;
  splitDropSide.value = null;
};

const onDropSplit = (direction: "left" | "right") => {
  const tabId = draggingTabId.value;
  if (!tabId) return;

  isSplit.value = true;

  if (panes.value.length === 1) {
    // Auto-create a companion pane so neither group is empty
    _paneCounter++;
    const newId = `pane-${_paneCounter}`;
    panes.value.push({ id: newId, label: "File Cabinet" });
    if (direction === "right") {
      leftGroupIds.value = [tabId];
      rightGroupIds.value = [newId];
      leftActiveId.value = tabId;
      rightActiveId.value = newId;
    } else {
      leftGroupIds.value = [newId];
      rightGroupIds.value = [tabId];
      leftActiveId.value = newId;
      rightActiveId.value = tabId;
    }
  } else if (direction === "right") {
    leftGroupIds.value = panes.value.map((p) => p.id).filter((id) => id !== tabId);
    rightGroupIds.value = [tabId];
    leftActiveId.value = leftGroupIds.value[0]!;
    rightActiveId.value = tabId;
  } else {
    rightGroupIds.value = panes.value.map((p) => p.id).filter((id) => id !== tabId);
    leftGroupIds.value = [tabId];
    leftActiveId.value = tabId;
    rightActiveId.value = rightGroupIds.value[0]!;
  }

  onTabDragEnd();
};

// ── Tab reorder ────────────────────────────────────────────────────────────

const onTabReorderOver = (event: DragEvent, targetId: string) => {
  const fromId = draggingTabId.value;
  if (!fromId || fromId === targetId) {
    reorderTarget.value = null;
    return;
  }

  // In split mode only allow reordering within the same group
  if (isSplit.value) {
    const sameLeft = leftGroupIds.value.includes(fromId) && leftGroupIds.value.includes(targetId);
    const sameRight = rightGroupIds.value.includes(fromId) && rightGroupIds.value.includes(targetId);
    if (!sameLeft && !sameRight) {
      reorderTarget.value = null;
      return;
    }
  }

  const el = event.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const side = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
  reorderTarget.value = { id: targetId, side };
};

const onTabReorderDrop = (targetId: string) => {
  const fromId = draggingTabId.value;
  if (!fromId || !reorderTarget.value || fromId === targetId) {
    reorderTarget.value = null;
    return;
  }

  // In split mode only allow reordering within the same group
  if (isSplit.value) {
    const sameLeft = leftGroupIds.value.includes(fromId) && leftGroupIds.value.includes(targetId);
    const sameRight = rightGroupIds.value.includes(fromId) && rightGroupIds.value.includes(targetId);
    if (!sameLeft && !sameRight) {
      reorderTarget.value = null;
      return;
    }
  }

  const arr = [...panes.value];
  const fromIdx = arr.findIndex((p) => p.id === fromId);
  if (fromIdx < 0) return;
  const [item] = arr.splice(fromIdx, 1);
  if (!item) return;
  const newToIdx = arr.findIndex((p) => p.id === targetId);
  if (newToIdx < 0) { arr.push(item); panes.value = arr; return; }
  const insertAt = reorderTarget.value.side === "before" ? newToIdx : newToIdx + 1;
  arr.splice(insertAt, 0, item);
  panes.value = arr;

  reorderTarget.value = null;
  onTabDragEnd();
};

const moveTabToGroup = (paneId: string, targetGroup: "left" | "right") => {
  if (targetGroup === "right") {
    leftGroupIds.value = leftGroupIds.value.filter((id) => id !== paneId);
    rightGroupIds.value = [...rightGroupIds.value, paneId];
    rightActiveId.value = paneId;
    if (leftGroupIds.value.length === 0) {
      isSplit.value = false;
      activePaneId.value = paneId;
    }
  } else {
    rightGroupIds.value = rightGroupIds.value.filter((id) => id !== paneId);
    leftGroupIds.value = [...leftGroupIds.value, paneId];
    leftActiveId.value = paneId;
    if (rightGroupIds.value.length === 0) {
      isSplit.value = false;
      activePaneId.value = leftActiveId.value;
    }
  }
  onTabDragEnd();
};

// ── Split resize ───────────────────────────────────────────────────────────

const startSplitResize = (e: MouseEvent) => {
  e.preventDefault();
  const onMove = (ev: MouseEvent) => {
    if (!workspaceRef.value) return;
    const rect = workspaceRef.value.getBoundingClientRect();
    const newRatio = ((ev.clientX - rect.left) / rect.width) * 100;
    splitRatio.value = Math.min(80, Math.max(20, newRatio));
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
};

// ── Pane label update ──────────────────────────────────────────────────────

const updatePaneLabel = (paneId: string, label: string) => {
  const pane = panes.value.find((p) => p.id === paneId);
  if (pane) pane.label = label;
};

// ── Sidebar actions ────────────────────────────────────────────────────────

const refreshActivePane = () => {
  paneRefs[getActivePaneId()]?.refreshCurrentFolder();
};

const navigateActivePane = (folderId: number | null) => {
  paneRefs[getActivePaneId()]?.navigateToFolder(folderId);
};

// ── Shared: sidebar tree ───────────────────────────────────────────────────

const rootFolders = ref<FolderItem[]>([]);
const expandedFolderIds = ref<Set<number>>(new Set());
const treeSearch = ref("");
const childFoldersCache = ref<Map<number, FolderItem[]>>(new Map());

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

const runQuery = async (sql: string): Promise<any[]> => {
  const response = await callApi(RequestRoutes.RUN_SUITEQL_QUERY, { sql, limit: 5000 }, ApiRequestType.NORMAL);
  const result = (response as ApiResponse)?.message || response;
  if (result?.error) throw new Error(result.error);
  return Array.isArray(result) ? result : result?.results || [];
};

const loadSidebarRootFolders = async () => {
  try {
    const rows = await runQuery(`
      SELECT id, name, parent, foldertype, numFolderFiles, folderSize, lastModifiedDate
      FROM MediaItemFolder WHERE parent IS NULL ORDER BY name
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
      children: childFoldersCache.value.get(r.id) ?? undefined
    }));
  } catch { /* silently skip */ }
};

const fetchChildFoldersForTree = async (parentId: number): Promise<FolderItem[]> => {
  if (childFoldersCache.value.has(parentId)) return childFoldersCache.value.get(parentId)!;
  const rows = await runQuery(`
    SELECT id, name, parent, foldertype, numFolderFiles, folderSize, lastModifiedDate
    FROM MediaItemFolder WHERE parent = ${parentId} ORDER BY name
  `);
  const children: FolderItem[] = rows.map((r: any) => ({
    type: "folder" as const,
    id: r.id, name: r.name, parent: r.parent,
    foldertype: r.foldertype || "DEFAULT",
    numfolderfiles: r.numfolderfiles ?? 0,
    foldersize: r.foldersize ?? 0,
    lastmodifieddate: r.lastmodifieddate,
    children: undefined
  }));
  childFoldersCache.value.set(parentId, children);
  return children;
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

const toggleFolderExpand = async (folderId: number) => {
  if (expandedFolderIds.value.has(folderId)) {
    expandedFolderIds.value.delete(folderId);
  } else {
    expandedFolderIds.value.add(folderId);
    const folder = findFolderInTree(rootFolders.value, folderId);
    if (folder && !folder.children) {
      folder.children = await fetchChildFoldersForTree(folderId);
    }
  }
  expandedFolderIds.value = new Set(expandedFolderIds.value);
};

const expandFolderInTree = async (folderId: number) => {
  expandedFolderIds.value.add(folderId);
  expandedFolderIds.value = new Set(expandedFolderIds.value);
  const folder = findFolderInTree(rootFolders.value, folderId);
  if (folder && !folder.children) {
    folder.children = await fetchChildFoldersForTree(folderId);
  }
};

const formatFolderSize = (kb: number | null | undefined): string => {
  if (!kb) return "—";
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
};

// ── Shared: environment ────────────────────────────────────────────────────

const currentEnvironment = ref("unknown");

// ── Shared: bookmarks ──────────────────────────────────────────────────────

const bookmarks = ref<Bookmark[]>([]);
const isCheckingBookmarks = ref(false);
const showBookmarksSection = ref(true);

const bookmarkedIds = computed(() => new Set(bookmarks.value.map((b) => b.netsuiteId)));

const reloadBookmarks = async () => {
  if (!currentEnvironment.value || currentEnvironment.value === "unknown") return;
  bookmarks.value = await getBookmarks(currentEnvironment.value);
};

const removeBookmarkById = async (id: number) => {
  await removeBookmark(id);
  await reloadBookmarks();
};

const navigateToBookmark = (bm: Bookmark) => {
  if (bm.itemType === "folder") {
    navigateActivePane(bm.netsuiteId);
  } else if (bm.parentFolderId !== null) {
    navigateActivePane(bm.parentFolderId);
  }
};

const checkAllBookmarks = async () => {
  if (!currentEnvironment.value || bookmarks.value.length === 0) return;
  isCheckingBookmarks.value = true;
  try {
    const fileBookmarks = bookmarks.value.filter((b) => b.itemType === "file");
    const folderBookmarks = bookmarks.value.filter((b) => b.itemType === "folder");
    const verifyGroup = async (type: "file" | "folder", group: Bookmark[]) => {
      if (group.length === 0) return;
      const ids = group.map((b) => b.netsuiteId).join(", ");
      const table = type === "file" ? "File" : "MediaItemFolder";
      const rows = await runQuery(`SELECT id FROM ${table} WHERE id IN (${ids})`);
      const foundIds = new Set<number>(rows.map((r: any) => Number(r.id)));
      for (const bm of group) await updateBookmarkExists(bm.id!, foundIds.has(bm.netsuiteId));
    };
    await verifyGroup("file", fileBookmarks);
    await verifyGroup("folder", folderBookmarks);
    await reloadBookmarks();
    toast.add({ severity: "success", summary: "Check Complete", detail: `${bookmarks.value.length} bookmark${bookmarks.value.length !== 1 ? "s" : ""} verified`, life: 2500 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    toast.add({ severity: "error", summary: "Check Failed", detail: msg, life: 3500 });
  } finally {
    isCheckingBookmarks.value = false;
  }
};

const getBookmarkStatusIcon = (bm: Bookmark) => {
  if (bm.exists === true) return "pi pi-check-circle";
  if (bm.exists === false) return "pi pi-times-circle";
  return "pi pi-question-circle";
};

// ── Shared: trash ──────────────────────────────────────────────────────────

const showTrashPanel = ref(false);
const trashedItems = ref<TrashedItem[]>([]);
const trashCount = ref(0);
const isRestoringId = ref<number | null>(null);
const showRestoreFolderPicker = ref(false);
const restorePickerItem = ref<TrashedItem | null>(null);
const restorePickerFolders = ref<{ id: number; name: string }[]>([]);
const restorePickerSearch = ref("");

const reloadTrashCount = async () => {
  trashCount.value = await getTrashCount(currentEnvironment.value);
};

const openTrashPanel = async () => {
  showTrashPanel.value = true;
  await autoPurgeTrash(currentEnvironment.value);
  trashedItems.value = await getTrashedItems(currentEnvironment.value);
  trashCount.value = trashedItems.value.length;
};

const closeTrashPanel = () => {
  showTrashPanel.value = false;
  showRestoreFolderPicker.value = false;
  restorePickerItem.value = null;
};

const handleEmptyTrash = async () => {
  const count = await emptyTrash(currentEnvironment.value);
  trashedItems.value = [];
  trashCount.value = 0;
  showTrashPanel.value = false;
  toast.add({ severity: "success", summary: "Trash Emptied", detail: `${count} item${count !== 1 ? "s" : ""} permanently removed`, life: 3000 });
};

const permanentlyDelete = async (item: TrashedItem) => {
  if (!item.id) return;
  await removeFromTrash(item.id);
  trashedItems.value = trashedItems.value.filter((t) => t.id !== item.id);
  trashCount.value = trashedItems.value.length;
  toast.add({ severity: "info", summary: "Removed", detail: `${item.name} permanently deleted from trash`, life: 3000 });
};

const getFolderTrashInfo = (item: TrashedItem): { files: number; folders: number } | null => {
  if (item.itemType !== "folder" || !item.content) return null;
  try {
    const snapshot = JSON.parse(item.content) as FolderSnapshot;
    const countFiles = (s: FolderSnapshot): number => s.files.length + s.subfolders.reduce((acc, sf) => acc + countFiles(sf.snapshot), 0);
    const countFolders = (s: FolderSnapshot): number => s.subfolders.length + s.subfolders.reduce((acc, sf) => acc + countFolders(sf.snapshot), 0);
    return { files: countFiles(snapshot), folders: countFolders(snapshot) };
  } catch { return null; }
};

const restoreItem = async (item: TrashedItem) => {
  if (!item.id) return;
  if (item.itemType === "file" && !item.content) {
    toast.add({ severity: "warn", summary: "Cannot Restore", detail: "File content was not saved — binary files cannot be restored", life: 4000 });
    return;
  }
  if (item.originalFolderId !== null) {
    try {
      const rows = await runQuery(`SELECT id FROM MediaItemFolder WHERE id = ${item.originalFolderId} AND ROWNUM <= 1`);
      if (rows.length > 0) { await doRestore(item, item.originalFolderId); return; }
    } catch { /* show picker */ }
  }
  restorePickerItem.value = item;
  restorePickerSearch.value = "";
  await loadRestoreFolders();
  showRestoreFolderPicker.value = true;
};

const loadRestoreFolders = async () => {
  try {
    const search = restorePickerSearch.value.trim();
    const sql = search
      ? `SELECT id, name FROM MediaItemFolder WHERE LOWER(name) LIKE LOWER('%${search.replace(/'/g, "''")}%') AND ROWNUM <= 30 ORDER BY name`
      : `SELECT id, name FROM MediaItemFolder WHERE parent IS NULL AND ROWNUM <= 30 ORDER BY name`;
    restorePickerFolders.value = (await runQuery(sql)).map((r: any) => ({ id: Number(r.id), name: r.name || "Unnamed" }));
  } catch { restorePickerFolders.value = []; }
};

const confirmRestoreToFolder = async (folderId: number) => {
  if (!restorePickerItem.value) return;
  await doRestore(restorePickerItem.value, folderId);
  showRestoreFolderPicker.value = false;
  restorePickerItem.value = null;
};

const doRestore = async (item: TrashedItem, folderId: number) => {
  if (!item.id) return;
  isRestoringId.value = item.id;
  try {
    if (item.itemType === "file" && item.content) {
      const response = await callApi(RequestRoutes.UPLOAD_FILE, { fileName: item.name, fileContent: item.content, folderId }, ApiRequestType.NORMAL);
      const result = (response as ApiResponse)?.message || response;
      if (!result?.uploaded?.length) throw new Error("Upload failed during restore");
    } else if (item.itemType === "folder") {
      const createResp = await callApi(RequestRoutes.CREATE_FOLDER, { name: item.name, parentFolder: folderId }, ApiRequestType.NORMAL);
      const createResult = (createResp as ApiResponse)?.message || createResp;
      const newFolderId = createResult?.folderId ?? createResult?.id;
      if (newFolderId && item.content) {
        try {
          const snapshot = JSON.parse(item.content) as FolderSnapshot;
          await restoreFolderSnapshot(snapshot, Number(newFolderId));
        } catch { /* snapshot parse failure */ }
      }
    }
    await removeFromTrash(item.id);
    trashedItems.value = trashedItems.value.filter((t) => t.id !== item.id);
    trashCount.value = trashedItems.value.length;
    toast.add({ severity: "success", summary: "Restored", detail: `${item.name} has been restored`, life: 3000 });
    refreshActivePane();
  } catch (err: any) {
    toast.add({ severity: "error", summary: "Restore Failed", detail: err.message || "Failed to restore item", life: 5000 });
  } finally {
    isRestoringId.value = null;
  }
};

const restoreFolderSnapshot = async (snapshot: FolderSnapshot, parentFolderId: number) => {
  for (const f of snapshot.files) {
    if (!f.content) continue;
    try { await callApi(RequestRoutes.UPLOAD_FILE, { fileName: f.name, fileContent: f.content, folderId: parentFolderId }, ApiRequestType.NORMAL); } catch { /* best effort */ }
  }
  for (const sf of snapshot.subfolders) {
    try {
      const resp = await callApi(RequestRoutes.CREATE_FOLDER, { name: sf.name, parentFolder: parentFolderId }, ApiRequestType.NORMAL);
      const result = (resp as ApiResponse)?.message || resp;
      const newFolderId = result?.folderId ?? result?.id;
      if (newFolderId) await restoreFolderSnapshot(sf.snapshot, Number(newFolderId));
    } catch { /* best effort */ }
  }
};

// ── Lifecycle ──────────────────────────────────────────────────────────────

onMounted(async () => {
  currentEnvironment.value = await getNetsuiteEnvironment();
  await autoPurgeTrash(currentEnvironment.value);
  trashCount.value = await getTrashCount(currentEnvironment.value);
  await reloadBookmarks();
  await loadSidebarRootFolders();
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

.sidebar-section-tree { flex: 1; min-height: 0; overflow: hidden; }
.folder-tree-container { overflow-y: auto; flex: 1; min-height: 0; }

/* ── Workspace ────────────────────────────────────────────────────────────── */
.fc-workspace {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

/* ── Tab bar ──────────────────────────────────────────────────────────────── */
.fc-tabbar {
  display: flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
  background: var(--m-slate-150, #f1f5f9);
  border-bottom: 1px solid var(--p-slate-200);
  position: relative;
  min-height: 34px;
}

.fc-split-tabbar {
  border-bottom: 1px solid var(--p-slate-200);
}

.fc-tabbar-tabs {
  display: flex;
  align-items: center;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none;
  gap: 2px;
  padding: 3px 4px;
}

.fc-tabbar-tabs::-webkit-scrollbar { display: none; }

.fc-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 4px;
  background: transparent;
  color: var(--p-slate-500);
  cursor: pointer;
  white-space: nowrap;
  font-size: 0.78rem;
  font-weight: 500;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
  outline: 1px solid transparent;
  user-select: none;
}

.fc-tab:hover {
  background: var(--p-slate-200);
  color: var(--p-slate-700);
}

.fc-tab--active {
  background: var(--p-slate-600);
  color: white;
  outline-color: var(--p-slate-500);
}

.fc-tab-label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fc-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: inherit;
  opacity: 0.6;
  flex-shrink: 0;
  transition: background 0.1s, opacity 0.1s;
}

.fc-tab:hover .fc-tab-close,
.fc-tab--active .fc-tab-close { opacity: 1; }

.fc-tab-close:hover { background: rgba(255,255,255,0.2); opacity: 1; }

.fc-tab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--p-slate-500);
  flex-shrink: 0;
  margin-left: 2px;
  transition: background 0.12s;
}

.fc-tab-add:hover { background: var(--p-slate-200); }

/* ── Tab insert indicators (drag-to-reorder) ─────────────────────────────── */
.fc-tab--drop-before { box-shadow: -2px 0 0 0 var(--p-indigo-500); }
.fc-tab--drop-after  { box-shadow:  2px 0 0 0 var(--p-indigo-500); }

/* ── Split overlays (large drop targets over the pane area) ──────────────── */
.fc-split-overlay {
  position: absolute;
  top: 8px;
  bottom: 8px;
  width: 38%;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  border-radius: 6px;
  border: 2px dashed transparent;
  /* invisible + non-interactive by default */
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s, border-color 0.12s;
  user-select: none;
}

.fc-split-overlay--left  { left: 8px; }
.fc-split-overlay--right { right: 8px; }

/* Become visible + interactive while a tab is being dragged */
.fc-panes-area--dragging .fc-split-overlay {
  opacity: 1;
  pointer-events: all;
  background: rgba(99, 102, 241, 0.10);
  border-color: rgba(99, 102, 241, 0.35);
  color: var(--p-indigo-600);
}

.fc-split-overlay--active,
.fc-panes-area--dragging .fc-split-overlay:hover {
  background: rgba(99, 102, 241, 0.22);
  border-color: var(--p-indigo-500);
}

/* ── Group drop zone (split mode, move between groups) ──────────────────── */
.fc-group-dropzone {
  display: flex;
  align-items: center;
  padding: 3px 8px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-indigo-600);
  background: var(--p-indigo-50);
  border: 1px dashed var(--p-indigo-300);
  border-radius: 4px;
  white-space: nowrap;
  margin: 3px 4px;
  flex-shrink: 0;
  /* invisible + non-interactive by default */
  pointer-events: none;
  opacity: 0;
  transition: background 0.15s, opacity 0.12s;
}

/* Reveal when the parent tab bar is a valid drop target */
.fc-split-tabbar--drop-target .fc-group-dropzone {
  opacity: 1;
  pointer-events: all;
  cursor: pointer;
}

.fc-group-dropzone--active {
  background: var(--p-indigo-100);
  border-color: var(--p-indigo-500);
}

/* ── Panes area ──────────────────────────────────────────────────────────── */
.fc-panes-area {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
  position: relative;
}

/* ── Split layout ────────────────────────────────────────────────────────── */
.fc-split-container {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.fc-split-group {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.fc-split-handle {
  width: 5px;
  background: var(--p-slate-200);
  cursor: col-resize;
  flex-shrink: 0;
  transition: background 0.15s;
  position: relative;
  z-index: 5;
}

.fc-split-handle:hover,
.fc-split-handle:active { background: var(--p-indigo-300); }

/* ── Sidebar bits ─────────────────────────────────────────────────────────── */
.fc-trash-badge {
  color: var(--p-slate-400);
  font-size: 0.7rem;
  font-weight: 500;
  margin-left: 0.25rem;
}

.fc-section-toggle {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
  user-select: none;
  margin-bottom: 0.5rem;
}

.fc-bookmarks-list { display: flex; flex-direction: column; gap: 2px; margin-top: 0.25rem; }
.fc-bookmark-item { display: flex; align-items: center; gap: 0.3rem; padding: 0.3rem 0.4rem; border-radius: 4px; cursor: pointer; font-size: 0.72rem; min-width: 0; }
.fc-bookmark-item:hover { background: var(--p-slate-200); }
.fc-bookmark-status { flex-shrink: 0; }
.fc-bookmark-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--p-slate-700); }
.fc-bookmark-remove { flex-shrink: 0; background: none; border: none; cursor: pointer; padding: 0 0.15rem; color: var(--p-slate-400); border-radius: 3px; opacity: 0; transition: opacity 0.1s; }
.fc-bookmark-item:hover .fc-bookmark-remove { opacity: 1; }
.fc-bookmark-remove:hover { color: var(--p-red-500); background: var(--p-red-50); }

/* ── Confirm/Trash overlays ───────────────────────────────────────────────── */
.fc-confirm-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.4); z-index: 9999; }
.fc-confirm-box { background: white; border-radius: 0.5rem; box-shadow: 0 20px 60px rgba(0,0,0,0.2); padding: 1.25rem; max-width: 380px; width: 90%; }
.fc-confirm-header { display: flex; align-items: center; gap: 0.5rem; font-weight: 600; font-size: 0.9rem; margin-bottom: 0.75rem; color: var(--p-slate-800); }
.fc-confirm-body { font-size: 0.8rem; color: var(--p-slate-600); line-height: 1.5; margin-bottom: 1rem; }
.fc-confirm-actions { display: flex; justify-content: flex-end; gap: 0.5rem; }

.fc-trash-panel { background: white; border-radius: 0.5rem; box-shadow: 0 20px 60px rgba(0,0,0,0.2); width: 90%; max-width: 520px; max-height: 70vh; display: flex; flex-direction: column; }
.fc-trash-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid var(--p-slate-200); flex-shrink: 0; }
.fc-trash-panel-body { flex: 1; overflow-y: auto; min-height: 0; }
.fc-trash-empty { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 2rem; color: var(--p-slate-400); font-size: 0.8rem; }
.fc-trash-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; border-bottom: 1px solid var(--p-slate-100); transition: background 0.1s; }
.fc-trash-item:hover { background: var(--p-slate-50); }
.fc-trash-item-icon { flex-shrink: 0; }
.fc-trash-item-info { flex: 1; min-width: 0; }
.fc-trash-item-name { font-size: 0.8rem; font-weight: 500; color: var(--p-slate-800); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fc-trash-item-meta { display: flex; gap: 0.5rem; font-size: 0.7rem; color: var(--p-slate-400); }
.fc-trash-item-timer { color: var(--p-amber-600); font-weight: 500; }
.fc-trash-item-actions { display: flex; gap: 0.25rem; flex-shrink: 0; }

.fc-restore-picker { margin-bottom: 0.5rem; }
.fc-restore-folder-list { max-height: 200px; overflow-y: auto; border: 1px solid var(--p-slate-200); border-radius: 4px; }
.fc-restore-folder-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.4rem 0.6rem; cursor: pointer; font-size: 0.78rem; transition: background 0.1s; }
.fc-restore-folder-item:hover { background: var(--p-indigo-50); }

.fc-search-close { background: none; border: none; padding: 0.2rem; cursor: pointer; color: var(--p-slate-500); border-radius: 3px; }
.fc-search-close:hover { background: var(--p-slate-200); }

/* ── PrimeVue overrides ───────────────────────────────────────────────────── */
.sidebar-section :deep(.p-inputtext) { font-size: 0.75rem; }
</style>
