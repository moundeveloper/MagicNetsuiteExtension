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
              <Button
                @click="openTrashPanel"
                severity="secondary"
                class="w-full"
                size="small"
              >
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
                  <i :class="getBookmarkStatusIcon(bm)" :class2="getBookmarkStatusClass(bm)" class="fc-bookmark-status text-xs" :style="{ color: bm.exists === true ? '#22c55e' : bm.exists === false ? '#ef4444' : '#9ca3af' }"></i>
                  <i
                    :class="bm.itemType === 'folder' ? 'pi pi-folder text-yellow-400' : 'pi pi-file text-blue-400'"
                    class="text-xs"
                  ></i>
                  <span class="fc-bookmark-name">{{ bm.name }}</span>
                  <button
                    class="fc-bookmark-remove"
                    @click.stop="removeBookmarkById(bm.id!)"
                    title="Remove bookmark"
                  >
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
              <button
                v-if="currentFolderInfo"
                class="fc-view-toggle"
                :class="{ active: bookmarkedIds.has(currentFolderInfo.id) }"
                :title="bookmarkedIds.has(currentFolderInfo.id) ? 'Remove Bookmark' : 'Bookmark this folder'"
                @click="toggleBookmark(currentFolderInfo)"
              >
                <i :class="bookmarkedIds.has(currentFolderInfo.id) ? 'pi pi-bookmark-fill' : 'pi pi-bookmark'" class="text-xs"></i>
              </button>
              <InputText
                v-model="contentSearch"
                type="text"
                placeholder="Filter..."
                size="small"
                class="fc-filter-input"
              />
              <button
                class="fc-view-toggle"
                title="New Folder"
                @click="openNewFolderDialog"
              >
                <i class="pi pi-folder-plus text-xs"></i>
              </button>
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

        <!-- ═══ GLOBAL SEARCH PANEL ═══ -->
        <!-- ═══ GLOBAL SEARCH ═══ -->
        <div v-if="!openedFile" class="fc-global-search">
          <div class="fc-search-input-row">
            <i class="pi pi-search text-xs text-gray-400"></i>
            <input
              v-model="globalSearchQuery"
              type="text"
              placeholder="Search all files and folders..."
              class="fc-search-input"
              @input="handleGlobalSearch"
              @keydown.escape="clearGlobalSearch"
            />
            <i v-if="globalSearchLoading" class="pi pi-spin pi-spinner text-xs text-gray-400"></i>
            <button v-if="globalSearchQuery" class="fc-search-close" @click="clearGlobalSearch">
              <i class="pi pi-times text-xs"></i>
            </button>
          </div>
          <div v-if="globalSearchResults.length > 0" class="fc-search-results">
            <div
              v-for="result in globalSearchResults"
              :key="`${result.type}-${result.id}`"
              class="fc-search-result-item"
              @click="handleSearchResultClick(result)"
            >
              <i :class="result.type === 'folder' ? 'pi pi-folder text-amber-500' : 'pi pi-file text-gray-500'" class="text-xs"></i>
              <span class="fc-search-result-name">{{ result.name }}</span>
              <span class="fc-search-result-path">{{ result.path }}</span>
              <button
                class="fc-search-result-bookmark"
                :title="bookmarkedIds.has(result.id) ? 'Remove Bookmark' : 'Add Bookmark'"
                @click.stop="toggleBookmarkFromSearchResult(result)"
              >
                <i :class="bookmarkedIds.has(result.id) ? 'pi pi-bookmark-fill text-amber-400' : 'pi pi-bookmark text-gray-400'" class="text-xs"></i>
              </button>
            </div>
          </div>
          <div v-else-if="globalSearchQuery.trim() && !globalSearchLoading" class="fc-search-empty">
            No results found
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

          <!-- File content: Image (no edit) -->
          <div v-else-if="fileIsBinary && fileContent" class="fc-file-view fc-file-image">
            <img :src="fileContent" :alt="openedFile.name" class="fc-image-content" />
          </div>

          <!-- File content: Text/Code -->
          <template v-else-if="fileContent !== null && !fileIsBinary">
            <!-- Edit toolbar -->
            <div v-if="isTextFile(openedFile)" class="fc-edit-toolbar">
              <div class="fc-edit-toolbar-left">
                <label class="fc-edit-toggle">
                  <input type="checkbox" v-model="isEditing" />
                  <span class="fc-toggle-slider"></span>
                  <span class="fc-toggle-label">{{ isEditing ? 'Editing' : 'Read-only' }}</span>
                </label>
              </div>
              <div class="fc-edit-toolbar-right">
                <template v-if="isEditing">
                  <Button
                    size="small"
                    :disabled="isSaving || !hasUnsavedChanges"
                    @click="saveFile"
                  >
                    <i class="pi pi-save text-xs mr-1"></i>
                    {{ isSaving ? 'Saving...' : 'Save' }}
                    <kbd v-if="!isSaving" class="fc-kbd">Ctrl+S</kbd>
                  </Button>

                  <!-- Version history dropdown -->
                  <div class="fc-history-wrapper">
                    <Button
                      size="small"
                      severity="secondary"
                      @click="toggleHistoryDropdown"
                      :disabled="versionHistory.length === 0"
                    >
                      <i class="pi pi-history text-xs mr-1"></i>
                      History
                      <span v-if="versionHistory.length > 0" class="fc-history-badge">{{ versionHistory.length }}</span>
                    </Button>

                    <!-- History dropdown panel -->
                    <div v-if="historyDropdownOpen" class="fc-history-dropdown">
                      <div class="fc-history-header">
                        <span>Version History</span>
                        <button class="fc-history-close" @click="historyDropdownOpen = false">
                          <i class="pi pi-times text-xs"></i>
                        </button>
                      </div>
                      <div class="fc-history-list">
                        <div
                          v-for="ver in versionHistory"
                          :key="ver.id"
                          class="fc-history-item"
                          :class="{ active: selectedVersionId === ver.id }"
                          @click="selectVersion(ver)"
                        >
                          <div class="fc-history-item-time">{{ formatVersionDate(ver.savedAt) }}</div>
                          <div class="fc-history-item-name">{{ ver.fileName }}</div>
                        </div>
                      </div>
                      <div v-if="versionHistory.length > 0" class="fc-history-footer">
                        <Button
                          size="small"
                          severity="danger"
                          class="w-full"
                          @click="commitHistory"
                        >
                          <i class="pi pi-check text-xs mr-1"></i>
                          Commit (Clear History)
                        </Button>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </div>

            <!-- Diff view (when viewing a version) -->
            <div v-if="showingDiff && selectedVersionContent !== null" class="fc-file-view fc-file-diff">
              <div class="fc-diff-bar">
                <span class="text-xs text-gray-600">
                  <i class="pi pi-clock text-xs mr-1"></i>
                  Comparing: <strong>{{ selectedVersionLabel }}</strong> vs Current
                </span>
                <div class="flex items-center gap-2">
                  <Button size="small" severity="secondary" @click="revertToVersion">
                    <i class="pi pi-undo text-xs mr-1"></i>
                    Revert to This
                  </Button>
                  <Button size="small" severity="secondary" @click="closeDiff">
                    <i class="pi pi-times text-xs mr-1"></i>
                    Close Diff
                  </Button>
                </div>
              </div>
              <DiffViewer
                :original="selectedVersionContent"
                :modified="editorContent"
                :language="getCodeLanguage(openedFile)"
              />
            </div>

            <!-- Editor / Viewer -->
            <div v-else class="fc-file-view fc-file-code">
              <FileCodeEditor
                v-if="isEditing"
                v-model="editorContent"
                :language="getCodeLanguage(openedFile)"
                @ctrl-s="saveFile"
              />
              <CodeViewer
                v-else
                :code="fileContent"
                :language="getCodeLanguage(openedFile)"
              />
            </div>
          </template>

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
          <!-- Drag & drop overlay -->
          <div
            class="fc-drop-zone"
            :class="{ 'fc-drag-over': isDragOver }"
            @dragover="handleDragOver"
            @dragleave="handleDragLeave"
            @drop="handleDrop"
          >
            <!-- Upload overlay indicator -->
            <div v-if="isDragOver" class="fc-drop-overlay">
              <i class="pi pi-cloud-upload text-4xl text-indigo-500"></i>
              <p>Drop files to upload to this folder</p>
            </div>

            <!-- Uploading indicator -->
            <div v-if="isUploading" class="fc-upload-bar">
              <i class="pi pi-spin pi-spinner text-xs"></i>
              <span>{{ uploadProgress }}</span>
            </div>

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
              <div class="fc-grid-label" :title="renamingItemId === item.id ? undefined : item.name">
                <input
                  v-if="renamingItemId === item.id"
                  v-model="renameValue"
                  class="fc-rename-input"
                  @keydown.enter.stop="commitRename(item)"
                  @keydown.escape.stop="cancelRename"
                  @blur="cancelRename"
                  @click.stop
                  :ref="(el) => { if (el && renamingItemId === item.id) (el as HTMLInputElement).focus(); }"
                />
                <template v-else>{{ item.name }}</template>
              </div>
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
                    <input
                      v-if="renamingItemId === item.id"
                      v-model="renameValue"
                      class="fc-rename-input"
                      @keydown.enter.stop="commitRename(item)"
                      @keydown.escape.stop="cancelRename"
                      @blur="cancelRename"
                      @click.stop
                      :ref="(el) => { if (el && renamingItemId === item.id) (el as HTMLInputElement).focus(); }"
                    />
                    <span v-else>{{ item.name }}</span>
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

          </div>

          <!-- Status bar -->
          <div class="fc-status-bar">
            <span>{{ folderCount }} folder{{ folderCount !== 1 ? 's' : '' }}, {{ fileCount }} file{{ fileCount !== 1 ? 's' : '' }}</span>
            <span v-if="selectedItems.length > 0" class="ml-4">
              {{ selectedItems.length }} selected
            </span>
            <Button
              v-if="selectedItems.length > 1"
              size="small"
              severity="danger"
              class="ml-auto fc-bulk-delete-btn"
              @click="confirmBulkDelete"
            >
              <i class="pi pi-trash text-xs mr-1"></i>
              Delete {{ selectedItems.length }} Items
            </Button>
          </div>
        </template>
      </div>

      <!-- Detail / Preview panel -->
      <div
        v-if="detailItem && !openedFile"
        class="fc-detail-panel"
        :style="{ width: detailPanelWidth + 'px' }"
      >
        <!-- Resize handle on left edge -->
        <div
          class="fc-detail-resize-handle"
          :class="{ 'fc-detail-resize-handle--active': isResizingPanel }"
          @mousedown="startPanelResize"
        />
        <div class="fc-detail-header">
          <h4>{{ detailItem.name }}</h4>
          <button
            class="fc-detail-bookmark"
            :title="bookmarkedIds.has(detailItem.id) ? 'Remove Bookmark' : 'Add Bookmark'"
            @click="toggleBookmark(detailItem)"
          >
            <i
              :class="bookmarkedIds.has(detailItem.id) ? 'pi pi-bookmark-fill text-yellow-400' : 'pi pi-bookmark text-gray-400'"
              class="text-sm"
            ></i>
          </button>
          <button class="fc-detail-close" @click="detailItem = null">
            <i class="pi pi-times text-xs"></i>
          </button>
        </div>
        <div class="fc-detail-body">
          <div class="fc-detail-icon-large">
            <i :class="getItemIcon(detailItem)" class="text-4xl"></i>
          </div>

          <!-- Preview section -->
          <div
            v-if="detailItem.type === 'file' && isPreviewable(detailItem as FileItem)"
            class="fc-detail-preview"
            :style="{ maxHeight: Math.min(Math.round(detailPanelWidth * 0.85), 480) + 'px' }"
          >
            <div v-if="previewLoading" class="fc-preview-loading">
              <i class="pi pi-spin pi-spinner text-sm text-gray-400"></i>
            </div>
            <div v-else-if="previewError" class="fc-preview-unavailable">
              <i class="pi pi-eye-slash text-gray-400 text-sm"></i>
              <span>No preview available</span>
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
            <div class="fc-detail-field">
              <span class="label">Open in NetSuite</span>
              <a :href="getNetsuiteEditUrl(detailItem)" target="_blank" class="value text-blue-600 hover:underline text-xs break-all">
                {{ detailItem.type === 'file' ? 'Edit File' : 'Edit Folder' }} <i class="pi pi-external-link text-[10px]"></i>
              </a>
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
        :class="['fc-context-item', { 'fc-context-item--danger': action.danger }]"
        @click="action.handler(); contextMenu.visible = false"
      >
        <i :class="action.icon" class="text-xs"></i>
        <span>{{ action.label }}</span>
      </div>
    </div>
  </Teleport>

  <!-- Drop version confirmation dialog -->
  <Teleport to="body">
    <div v-if="showDropConfirm" class="fc-confirm-overlay" @click.self="confirmDropCancel">
      <div class="fc-confirm-box">
        <div class="fc-confirm-header">
          <i class="pi pi-exclamation-triangle text-amber-500"></i>
          <span>History Full</span>
        </div>
        <p class="fc-confirm-body">
          You already have 5 saved versions. Saving now will permanently delete the oldest version
          <strong>({{ dropConfirmDate }})</strong> to make room.
        </p>
        <div class="fc-confirm-actions">
          <Button size="small" severity="secondary" @click="confirmDropCancel">Cancel</Button>
          <Button size="small" severity="warn" @click="confirmDropProceed">
            <i class="pi pi-save text-xs mr-1"></i>
            Save Anyway
          </Button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Delete confirmation dialog -->
  <Teleport to="body">
    <div v-if="showDeleteConfirm" class="fc-confirm-overlay" @click.self="cancelDelete">
      <div class="fc-confirm-box">
        <div class="fc-confirm-header fc-confirm-danger">
          <i class="pi pi-exclamation-triangle text-red-500"></i>
          <span v-if="deleteTargets.length === 1">Delete {{ deleteTargets[0]!.type === 'folder' ? 'Folder' : 'File' }}</span>
          <span v-else>Delete {{ deleteTargets.length }} Items</span>
        </div>
        <div class="fc-confirm-body">
          <!-- Single item -->
          <template v-if="deleteTargets.length === 1">
            <p>
              Are you sure you want to delete <strong>{{ deleteTargets[0]!.name }}</strong>?
            </p>
            <p v-if="deleteTargets[0]!.type === 'file' && isTextFile(deleteTargets[0] as any)" class="text-xs text-gray-400 mt-1">
              The file content will be saved to trash for 15 days so you can restore it.
            </p>
            <p v-else-if="deleteTargets[0]!.type === 'file'" class="text-xs text-gray-400 mt-1">
              Binary files cannot be restored from trash.
            </p>
          </template>
          <!-- Bulk items -->
          <template v-else>
            <p>Are you sure you want to delete <strong>{{ deleteTargets.length }}</strong> items?</p>
            <ul class="fc-delete-list">
              <li v-for="t in deleteTargets.slice(0, 8)" :key="`${t.type}-${t.id}`">
                <i :class="getItemIcon(t)" class="text-xs"></i>
                {{ t.name }}
              </li>
              <li v-if="deleteTargets.length > 8" class="text-gray-400">
                ... and {{ deleteTargets.length - 8 }} more
              </li>
            </ul>
            <p class="text-xs text-gray-400 mt-1">Text file content will be saved to trash for 15 days.</p>
          </template>
          <!-- Folder has contents info -->
          <div v-if="folderContentWarning" class="fc-folder-warning">
            <i class="pi pi-info-circle text-blue-400 text-xs"></i>
            <span>{{ folderContentWarning }}</span>
          </div>
        </div>
        <div class="fc-confirm-actions">
          <Button size="small" severity="secondary" @click="cancelDelete">Cancel</Button>
          <Button
            size="small"
            severity="danger"
            @click="executeDelete"
            :loading="isDeleting"
          >
            <i class="pi pi-trash text-xs mr-1"></i>
            Delete
          </Button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- New Folder dialog -->
  <Teleport to="body">
    <div v-if="showNewFolderDialog" class="fc-confirm-overlay" @click.self="cancelNewFolder">
      <div class="fc-confirm-box">
        <div class="fc-confirm-header">
          <i class="pi pi-folder-plus text-amber-500"></i>
          <span>New Folder</span>
        </div>
        <div class="fc-confirm-body">
          <p class="mb-2">
            Create a new folder inside
            <strong>{{ breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1]!.name : 'Root' }}</strong>.
          </p>
          <InputText
            ref="newFolderInputRef"
            v-model="newFolderName"
            placeholder="Folder name"
            size="small"
            class="w-full"
            @keydown.enter="executeNewFolder"
            @keydown.escape="cancelNewFolder"
          />
        </div>
        <div class="fc-confirm-actions">
          <Button size="small" severity="secondary" @click="cancelNewFolder">Cancel</Button>
          <Button
            size="small"
            @click="executeNewFolder"
            :loading="isCreatingFolder"
            :disabled="!newFolderName.trim()"
          >
            <i class="pi pi-check text-xs mr-1"></i>
            Create
          </Button>
        </div>
      </div>
    </div>
  </Teleport>


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
            <Button
              v-if="trashedItems.length > 0"
              size="small"
              severity="danger"
              @click="handleEmptyTrash"
            >
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
          <div
            v-for="item in trashedItems"
            :key="item.id"
            class="fc-trash-item"
          >
            <div class="fc-trash-item-icon">
              <i :class="item.itemType === 'folder' ? 'pi pi-folder text-amber-500' : 'pi pi-file text-gray-500'"></i>
            </div>
            <div class="fc-trash-item-info">
              <div class="fc-trash-item-name">{{ item.name }}</div>
              <div class="fc-trash-item-meta">
                <span>{{ item.originalFolderName }}</span>
                <template v-if="item.itemType === 'folder'">
                  <span v-if="getFolderTrashInfo(item) as any" class="text-xs text-gray-400">
                    &nbsp;·&nbsp;{{ (getFolderTrashInfo(item)!.files) }} file{{ getFolderTrashInfo(item)!.files !== 1 ? 's' : '' }}
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
              <Button
                size="small"
                severity="danger"
                text
                @click="permanentlyDelete(item)"
                title="Delete permanently"
              >
                <i class="pi pi-times text-xs"></i>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Restore folder picker -->
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
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import { callApi, ApiRequestType, type ApiResponse, getNetsuiteEnvironment } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { Button, InputText, useToast } from "primevue";
import MCard from "../components/universal/card/MCard.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import FolderTreeNode from "../components/FolderTreeNode.vue";
import CodeViewer from "../components/CodeViewer.vue";
import FileCodeEditor from "../components/FileCodeEditor.vue";
import DiffViewer from "../components/DiffViewer.vue";
import {
  getVersionsForFile,
  saveVersion,
  wouldDropVersion,
  clearVersionHistory,
  getVersionContent,
  formatVersionDate,
  type FileVersion
} from "../utils/fileVersionsDb";
import {
  trashItem,
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
  removeBookmarkByNetsuiteId,
  getBookmarks,
  getBookmarkByNetsuiteId,
  updateBookmarkExists,
  type Bookmark
} from "../utils/fileCabinetBookmarksDb";

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

// ── Snapshot types (for folder trash/restore) ───────────────────────────────

interface FileSnapshot {
  id: number;
  name: string;
  filetype: string;
  filesize: number;
  content: string | null;
}

interface SubfolderSnapshot {
  id: number;
  name: string;
  snapshot: FolderSnapshot;
}

interface FolderSnapshot {
  files: FileSnapshot[];
  subfolders: SubfolderSnapshot[];
}

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

// ── Drag & drop upload ─────────────────────────────────────────────────────
const isDragOver = ref(false);
const isUploading = ref(false);
const uploadProgress = ref("");

// ── Inline rename ──────────────────────────────────────────────────────────
const renamingItemId = ref<number | null>(null);
const renameValue = ref("");
const isRenamingLoading = ref(false);

// ── Bookmarks ──────────────────────────────────────────────────────────────
const bookmarks = ref<Bookmark[]>([]);
const isCheckingBookmarks = ref(false);
const showBookmarksSection = ref(true);

// ── Global search ──────────────────────────────────────────────────────────
const globalSearchQuery = ref("");
const globalSearchResults = ref<{ id: number; name: string; path: string; type: "file" | "folder"; url?: string; folder?: number; filetype?: string; filesize?: number }[]>([]);
const globalSearchLoading = ref(false);

// ── Delete & Trash ─────────────────────────────────────────────────────────
const showDeleteConfirm = ref(false);
const deleteTargets = ref<CabinetItem[]>([]);
const deleteRecursive = ref(false);
const folderContentWarning = ref<string | null>(null);
const isDeleting = ref(false);
const currentEnvironment = ref("unknown");

const showTrashPanel = ref(false);
const trashedItems = ref<TrashedItem[]>([]);
const trashCount = ref(0);
const isRestoringId = ref<number | null>(null);

// Restore folder picker
const showRestoreFolderPicker = ref(false);
const restorePickerItem = ref<TrashedItem | null>(null);
const restorePickerFolders = ref<{ id: number; name: string }[]>([]);
const restorePickerSearch = ref("");

const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  actions: [] as { label: string; icon: string; handler: () => void; danger?: boolean }[]
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
const previewError = ref(false);

// ── Detail panel resize ────────────────────────────────────────────────────
const detailPanelWidth = ref(240);
const isResizingPanel = ref(false);

const startPanelResize = (e: MouseEvent) => {
  e.preventDefault();
  isResizingPanel.value = true;
  const startX = e.clientX;
  const startWidth = detailPanelWidth.value;

  const onMove = (ev: MouseEvent) => {
    // Panel is on the right; dragging left (smaller clientX) = wider panel
    const delta = startX - ev.clientX;
    detailPanelWidth.value = Math.min(600, Math.max(200, startWidth + delta));
  };
  const onUp = () => {
    isResizingPanel.value = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
};

// ── Edit mode state ────────────────────────────────────────────────────────

const isEditing = ref(false);
const editorContent = ref("");
const isSaving = ref(false);
const hasUnsavedChanges = computed(() => editorContent.value !== fileContent.value);

// Version history
const versionHistory = ref<FileVersion[]>([]);
const historyDropdownOpen = ref(false);
const selectedVersionId = ref<number | null>(null);
const selectedVersionContent = ref<string | null>(null);
const selectedVersionLabel = ref("");
const showingDiff = ref(false);

// Drop version confirm dialog
const showDropConfirm = ref(false);
const dropConfirmDate = ref("");
let dropConfirmResolve: ((proceed: boolean) => void) | null = null;

const confirmDropCancel = () => {
  if (dropConfirmResolve) dropConfirmResolve(false);
};

const confirmDropProceed = () => {
  if (dropConfirmResolve) dropConfirmResolve(true);
};

// ── New folder dialog ───────────────────────────────────────────────────────
const showNewFolderDialog = ref(false);
const newFolderName = ref("");
const isCreatingFolder = ref(false);
const newFolderInputRef = ref<any>(null);

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
  isEditing.value = false;
  editorContent.value = "";
  showingDiff.value = false;
  selectedVersionContent.value = null;
  selectedVersionId.value = null;
  historyDropdownOpen.value = false;

  try {
    const result = await fetchFileContent(file);
    if (result) {
      fileContent.value = result.content;
      fileContentType.value = result.contentType;
      fileIsBinary.value = result.binary;
      editorContent.value = result.content;
    }
    // Load version history
    await loadVersionHistory(file.id);
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
  isEditing.value = false;
  editorContent.value = "";
  showingDiff.value = false;
  selectedVersionContent.value = null;
  selectedVersionId.value = null;
  historyDropdownOpen.value = false;
  versionHistory.value = [];
};

const loadPreview = async (file: FileItem) => {
  if (!file.url || !isPreviewable(file)) {
    previewContent.value = null;
    previewError.value = false;
    return;
  }

  previewLoading.value = true;
  previewError.value = false;
  try {
    const result = await fetchFileContent(file);
    if (result) {
      if (result.binary) {
        // Image: store data URL
        previewContent.value = result.content;
      } else {
        // Detect HTML error pages (e.g. 404 redirect returned as text/html)
        const trimmed = result.content.trimStart();
        const isHtmlPage = /^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
        if (isHtmlPage) {
          previewContent.value = null;
          previewError.value = true;
          return;
        }
        // Text: truncate for preview (first 50 lines)
        const lines = result.content.split("\n");
        previewContent.value = lines.slice(0, 50).join("\n");
        if (lines.length > 50) previewContent.value += "\n// ... truncated";
      }
    } else {
      previewError.value = true;
    }
  } catch {
    previewContent.value = null;
    previewError.value = true;
  } finally {
    previewLoading.value = false;
  }
};

// ── Edit / Save / Version History ──────────────────────────────────────────

const loadVersionHistory = async (fileId: number) => {
  versionHistory.value = await getVersionsForFile(fileId);
};

const saveFile = async () => {
  if (!openedFile.value || isSaving.value || !hasUnsavedChanges.value) return;

  const file = openedFile.value;

  // Check if oldest version will be dropped — ask for confirmation
  const willDrop = await wouldDropVersion(file.id);
  if (willDrop) {
    dropConfirmDate.value = formatVersionDate(willDrop.savedAt);
    const proceed = await new Promise<boolean>((resolve) => {
      dropConfirmResolve = resolve;
      showDropConfirm.value = true;
    });
    showDropConfirm.value = false;
    dropConfirmResolve = null;
    if (!proceed) return;
  }

  isSaving.value = true;

  try {
    // Save the PREVIOUS content as a version (before overwriting)
    if (fileContent.value !== null) {
      await saveVersion(file.id, file.name, fileContent.value);
    }

    // Save to NetSuite
    const response = await callApi(
      RequestRoutes.UPDATE_FILE_CONTENT,
      {
        fileId: file.id,
        fileContent: editorContent.value,
        fileName: file.name,
        folderId: file.folder,
        mediaType: file.filetype || "JAVASCRIPT"
      },
      ApiRequestType.NORMAL
    );

    const result = (response as ApiResponse)?.message || response;
    if (result?.isUpdated === false) {
      throw new Error("NetSuite returned failure status");
    }

    // Update local state to match saved content
    fileContent.value = editorContent.value;

    // Reload version history
    await loadVersionHistory(file.id);

    toast.add({
      severity: "success",
      summary: "Saved",
      detail: `${file.name} saved to NetSuite`,
      life: 3000
    });
  } catch (err: any) {
    toast.add({
      severity: "error",
      summary: "Save Failed",
      detail: err.message || "Failed to save file",
      life: 5000
    });
  } finally {
    isSaving.value = false;
  }
};

const toggleHistoryDropdown = () => {
  historyDropdownOpen.value = !historyDropdownOpen.value;
  if (historyDropdownOpen.value && openedFile.value) {
    loadVersionHistory(openedFile.value.id);
  }
};

const selectVersion = async (ver: FileVersion) => {
  selectedVersionId.value = ver.id ?? null;
  selectedVersionLabel.value = formatVersionDate(ver.savedAt);
  const content = await getVersionContent(ver.id!);
  selectedVersionContent.value = content;
  showingDiff.value = true;
  historyDropdownOpen.value = false;
};

const revertToVersion = () => {
  if (selectedVersionContent.value !== null) {
    editorContent.value = selectedVersionContent.value;
    showingDiff.value = false;
    selectedVersionContent.value = null;
    selectedVersionId.value = null;
    toast.add({
      severity: "info",
      summary: "Reverted",
      detail: "Editor content restored. Save to apply changes to NetSuite.",
      life: 4000
    });
  }
};

const closeDiff = () => {
  showingDiff.value = false;
  selectedVersionContent.value = null;
  selectedVersionId.value = null;
};

const commitHistory = async () => {
  if (!openedFile.value) return;

  const count = await clearVersionHistory(openedFile.value.id);
  versionHistory.value = [];
  historyDropdownOpen.value = false;

  toast.add({
    severity: "success",
    summary: "History Cleared",
    detail: `${count} version${count !== 1 ? "s" : ""} removed. Current content in NetSuite is unchanged.`,
    life: 4000
  });
};

// ── Selection & interaction ────────────────────────────────────────────────

const isSelected = (item: CabinetItem) =>
  selectedItems.value.some((s) => s.type === item.type && s.id === item.id);

const handleItemClick = (item: CabinetItem, event: MouseEvent) => {
  if (renamingItemId.value === item.id) return; // Don't change selection while renaming
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
      label: "Open in NetSuite",
      icon: "pi pi-external-link",
      handler: () => window.open(getNetsuiteEditUrl(item), "_blank")
    });
    // Rename: only positive-id folders (not system roots)
    if (item.id > 0) {
      actions.push({
        label: "Rename",
        icon: "pi pi-pencil",
        handler: () => startRename(item)
      });
    }
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
        handler: () => window.open(getNetsuiteEditUrl(item), "_blank")
      });
      actions.push({
        label: "Copy URL",
        icon: "pi pi-link",
        handler: () => copyToClipboard(item.url!)
      });
    }
    // Rename: all file types supported via editMediaItem
    actions.push({
      label: "Rename",
      icon: "pi pi-pencil",
      handler: () => startRename(item)
    });
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

  // Bookmark toggle
  const alreadyBookmarked = bookmarkedIds.value.has(item.id);
  actions.push({
    label: alreadyBookmarked ? "Remove Bookmark" : "Add Bookmark",
    icon: alreadyBookmarked ? "pi pi-bookmark-fill" : "pi pi-bookmark",
    handler: () => toggleBookmark(item)
  });

  // System/root folders (negative IDs) cannot be deleted
  if (item.id > 0) {
    actions.push({
      label: "Delete",
      icon: "pi pi-trash text-red-500",
      handler: () => confirmDeleteItem(item),
      danger: true
    });
  }

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

// ── Inline rename ──────────────────────────────────────────────────────────

const startRename = (item: CabinetItem) => {
  contextMenu.value.visible = false;
  renamingItemId.value = item.id;
  renameValue.value = item.name;
};

const cancelRename = () => {
  if (isRenamingLoading.value) return;
  renamingItemId.value = null;
  renameValue.value = "";
};

const commitRename = async (item: CabinetItem) => {
  const newName = renameValue.value.trim();
  if (!newName || newName === item.name || isRenamingLoading.value) {
    cancelRename();
    return;
  }
  isRenamingLoading.value = true;
  try {
    if (item.type === "folder") {
      await callApi(
        RequestRoutes.RENAME_FOLDER,
        { folderId: item.id, newName, parentFolderId: item.parent ?? -15 },
        ApiRequestType.NORMAL
      );
      const folderItem = currentSubfolders.value.find((f) => f.id === item.id);
      if (folderItem) folderItem.name = newName;
    } else {
      const fi = item as FileItem;
      await callApi(
        RequestRoutes.RENAME_FILE,
        { fileId: fi.id, newName, folderId: fi.folder, filetype: fi.filetype || "", filesize: fi.filesize || 0 },
        ApiRequestType.NORMAL
      );
      const fileItem = currentFiles.value.find((f) => f.id === fi.id);
      if (fileItem) fileItem.name = newName;
    }
    // Update detail panel if this item is open
    if (detailItem.value?.id === item.id) detailItem.value = { ...detailItem.value, name: newName };
    toast.add({ severity: "success", summary: "Renamed", detail: newName, life: 2000 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    toast.add({ severity: "error", summary: "Rename Failed", detail: msg, life: 3500 });
  } finally {
    isRenamingLoading.value = false;
    renamingItemId.value = null;
    renameValue.value = "";
  }
};

// ── Bookmarks ──────────────────────────────────────────────────────────────

/** Reactive Set of bookmarked NetSuite IDs for the current environment (for O(1) lookup). */
const bookmarkedIds = computed(() => new Set(bookmarks.value.map((b) => b.netsuiteId)));

const loadBookmarks = async () => {
  if (!currentEnvironment.value || currentEnvironment.value === "unknown") return;
  bookmarks.value = await getBookmarks(currentEnvironment.value);
};

const toggleBookmark = async (item: CabinetItem) => {
  if (!currentEnvironment.value || currentEnvironment.value === "unknown") return;
  const existing = await getBookmarkByNetsuiteId(currentEnvironment.value, item.id);
  if (existing) {
    await removeBookmark(existing.id!);
    toast.add({ severity: "info", summary: "Bookmark Removed", detail: item.name, life: 2000 });
  } else {
    const parentFolderId =
      item.type === "folder" ? ((item as FolderItem).parent ?? null) : (item as FileItem).folder;
    const parentFolderName =
      breadcrumbs.value.length > 0
        ? breadcrumbs.value[breadcrumbs.value.length - 1]!.name
        : "Root";
    const newBmId = await addBookmark({
      environment: currentEnvironment.value,
      itemType: item.type,
      netsuiteId: item.id,
      name: item.name,
      parentFolderId,
      parentFolderName,
      filetype: item.type === "file" ? (item as FileItem).filetype : undefined,
      url: item.type === "file" ? (item as FileItem).url : undefined
    });
    // Auto-check existence immediately after adding
    try {
      const table = item.type === "file" ? "File" : "MediaItemFolder";
      const rows = await runQuery(`SELECT id FROM ${table} WHERE id = ${item.id}`);
      await updateBookmarkExists(newBmId, rows.length > 0);
    } catch { /* silently skip if check fails */ }
    toast.add({ severity: "success", summary: "Bookmarked", detail: item.name, life: 2000 });
  }
  await loadBookmarks();
};

const removeBookmarkById = async (id: number) => {
  await removeBookmark(id);
  await loadBookmarks();
};

const navigateToBookmark = (bm: Bookmark) => {
  if (bm.itemType === "folder") {
    navigateToFolder(bm.netsuiteId);
  } else if (bm.parentFolderId !== null) {
    navigateToFolder(bm.parentFolderId);
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
      const foundIds = new Set<number>(rows.map((r: { id: string | number }) => Number(r.id)));
      for (const bm of group) {
        await updateBookmarkExists(bm.id!, foundIds.has(bm.netsuiteId));
      }
    };

    await verifyGroup("file", fileBookmarks);
    await verifyGroup("folder", folderBookmarks);
    await loadBookmarks();
    toast.add({
      severity: "success",
      summary: "Check Complete",
      detail: `${bookmarks.value.length} bookmark${bookmarks.value.length !== 1 ? "s" : ""} verified`,
      life: 2500
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    toast.add({ severity: "error", summary: "Check Failed", detail: msg, life: 3500 });
  } finally {
    isCheckingBookmarks.value = false;
  }
};

const getBookmarkStatusClass = (bm: Bookmark) => {
  if (bm.exists === true) return "text-green-500";
  if (bm.exists === false) return "text-red-500";
  return "text-gray-400";
};

const getBookmarkStatusIcon = (bm: Bookmark) => {
  if (bm.exists === true) return "pi pi-check-circle";
  if (bm.exists === false) return "pi pi-times-circle";
  return "pi pi-question-circle";
};

const toggleSort = (field: string) => {
  if (sortField.value === field) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortField.value = field;
    sortDir.value = "asc";
  }
};

// ── Formatting ─────────────────────────────────────────────────────────────

const getNetsuiteEditUrl = (item: CabinetItem): string => {
  const env = currentEnvironment.value !== "unknown" ? currentEnvironment.value : "system.netsuite.com";
  if (item.type === "file") {
    return `https://${env}/app/common/media/mediaitem.nl?id=${item.id}&e=T`;
  }
  return `https://${env}/app/common/media/mediaitemfolder.nl?id=${item.id}&e=T`;
};

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

// ── Drag & drop upload ─────────────────────────────────────────────────────

/**
 * Encode an ArrayBuffer to a base64 string without blowing the call stack
 * (handles large binary files by processing in 8 KB chunks).
 */
const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
  }
  return btoa(chunks.join(""));
};

const handleDragOver = (event: DragEvent) => {
  event.preventDefault();
  if (event.dataTransfer?.types.includes("Files")) {
    isDragOver.value = true;
  }
};

const handleDragLeave = (event: DragEvent) => {
  // Only dismiss if actually leaving the container (not entering a child)
  const related = event.relatedTarget as Node | null;
  const target = event.currentTarget as HTMLElement;
  if (!related || !target.contains(related)) {
    isDragOver.value = false;
  }
};

const handleDrop = async (event: DragEvent) => {
  event.preventDefault();
  isDragOver.value = false;

  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const targetFolderId = currentFolderId.value ?? -15;
  isUploading.value = true;

  const uploaded: string[] = [];
  const errors: string[] = [];

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      uploadProgress.value = `Uploading ${i + 1}/${files.length}: ${file.name}`;

      const fileContentBase64 = arrayBufferToBase64(await file.arrayBuffer());
      const response = await callApi(
        RequestRoutes.UPLOAD_FILE,
        {
          fileName: file.name,
          fileContentBase64,
          mimeType: file.type || "application/octet-stream",
          folderId: targetFolderId
        },
        ApiRequestType.NORMAL
      );

      const result = (response as ApiResponse)?.message || response;
      if (result?.uploaded?.length > 0) {
        uploaded.push(file.name);
      } else {
        errors.push(file.name);
      }
    }

    if (uploaded.length > 0) {
      toast.add({
        severity: "success",
        summary: "Upload Complete",
        detail: `${uploaded.length} file${uploaded.length > 1 ? "s" : ""} uploaded`,
        life: 3000
      });
      // Refresh current folder to show new files
      await refreshCurrentFolder();
    }

    if (errors.length > 0) {
      toast.add({
        severity: "error",
        summary: "Upload Errors",
        detail: `Failed: ${errors.join(", ")}`,
        life: 5000
      });
    }
  } catch (err: any) {
    toast.add({
      severity: "error",
      summary: "Upload Failed",
      detail: err.message || "An error occurred during upload",
      life: 5000
    });
  } finally {
    isUploading.value = false;
    uploadProgress.value = "";
  }
};

// ── Global search ──────────────────────────────────────────────────────────

let searchDebounce: ReturnType<typeof setTimeout> | null = null;

const handleGlobalSearch = () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  const q = globalSearchQuery.value.trim();
  if (!q) {
    globalSearchResults.value = [];
    return;
  }
  searchDebounce = setTimeout(() => {
    executeGlobalSearch(q);
  }, 300);
};

const executeGlobalSearch = async (query: string) => {
  globalSearchLoading.value = true;
  try {
    const escaped = query.replace(/'/g, "''");

    // Search files with folder path
    const filesSql = `
      SELECT f.id, f.name, f.folder, f.url, f.fileType, f.fileSize,
             mf.name AS foldername
      FROM File f
      LEFT JOIN MediaItemFolder mf ON f.folder = mf.id
      WHERE LOWER(f.name) LIKE LOWER('%${escaped}%')
        AND ROWNUM <= 30
    `;

    // Search folders
    const foldersSql = `
      SELECT id, name, parent
      FROM MediaItemFolder
      WHERE LOWER(name) LIKE LOWER('%${escaped}%')
        AND ROWNUM <= 15
    `;

    const [fileRows, folderRows] = await Promise.all([
      runQuery(filesSql),
      runQuery(foldersSql)
    ]);

    const results: typeof globalSearchResults.value = [];

    // Map folder results
    for (const folder of folderRows) {
      if (!folder?.id) continue;
      results.push({
        id: Number(folder.id),
        name: folder.name || "Unnamed",
        path: folder.parent ? `(parent: ${folder.parent})` : "(root)",
        type: "folder"
      });
    }

    // Map file results
    for (const file of fileRows) {
      if (!file?.id) continue;
      results.push({
        id: Number(file.id),
        name: file.name || "Unnamed",
        path: file.foldername ? `/${file.foldername}/` : `(folder: ${file.folder})`,
        type: "file",
        url: file.url || undefined,
        folder: file.folder ? Number(file.folder) : undefined,
        filetype: file.filetype || undefined,
        filesize: file.filesize ? Number(file.filesize) : undefined
      });
    }

    globalSearchResults.value = results;
  } catch (err) {
    globalSearchResults.value = [];
    toast.add({
      severity: "error",
      summary: "Search Error",
      detail: "Failed to search file cabinet",
      life: 3000
    });
  } finally {
    globalSearchLoading.value = false;
  }
};

const handleSearchResultClick = async (result: typeof globalSearchResults.value[0]) => {
  globalSearchQuery.value = "";
  globalSearchResults.value = [];

  if (result.type === "folder") {
    navigateToFolder(result.id);
  } else {
    // Navigate to the file's parent folder first, then open the file
    if (result.folder) {
      await navigateToFolder(result.folder);
    }
    // Build a proper FileItem with the data from search
    openFile({
      type: "file",
      id: result.id,
      name: result.name,
      filetype: result.filetype || "",
      filesize: result.filesize || 0,
      folder: result.folder || 0,
      lastmodifieddate: null,
      url: result.url
    } as FileItem);
  }
};

const clearGlobalSearch = () => {
  globalSearchQuery.value = "";
  globalSearchResults.value = [];
};

const toggleBookmarkFromSearchResult = async (result: typeof globalSearchResults.value[0]) => {
  if (!currentEnvironment.value || currentEnvironment.value === "unknown") return;
  const existing = await getBookmarkByNetsuiteId(currentEnvironment.value, result.id);
  if (existing) {
    await removeBookmark(existing.id!);
    toast.add({ severity: "info", summary: "Bookmark Removed", detail: result.name, life: 2000 });
  } else {
    const newBmId = await addBookmark({
      environment: currentEnvironment.value,
      itemType: result.type,
      netsuiteId: result.id,
      name: result.name,
      parentFolderId: result.folder ?? null,
      parentFolderName: result.path || "Root",
      filetype: result.type === "file" ? result.filetype : undefined,
      url: result.type === "file" ? result.url : undefined
    });
    // Auto-check existence immediately after adding
    try {
      const table = result.type === "file" ? "File" : "MediaItemFolder";
      const rows = await runQuery(`SELECT id FROM ${table} WHERE id = ${result.id}`);
      await updateBookmarkExists(newBmId, rows.length > 0);
    } catch { /* silently skip if check fails */ }
    toast.add({ severity: "success", summary: "Bookmarked", detail: result.name, life: 2000 });
  }
  await loadBookmarks();
};

// ── New Folder ─────────────────────────────────────────────────────────────

const openNewFolderDialog = () => {
  newFolderName.value = "";
  showNewFolderDialog.value = true;
  nextTick(() => {
    const el = newFolderInputRef.value?.$el ?? newFolderInputRef.value;
    el?.focus?.();
  });
};

const cancelNewFolder = () => {
  showNewFolderDialog.value = false;
  newFolderName.value = "";
};

const executeNewFolder = async () => {
  const name = newFolderName.value.trim();
  if (!name) return;

  isCreatingFolder.value = true;
  try {
    const parentFolder = currentFolderId.value ?? null;

    const response = await callApi(
      RequestRoutes.CREATE_FOLDER,
      { name, parentFolder },
      ApiRequestType.NORMAL
    );
    const result = (response as ApiResponse)?.message || response;
    const newId = result?.folderId || result?.id;

    showNewFolderDialog.value = false;
    newFolderName.value = "";

    toast.add({
      severity: "success",
      summary: "Folder Created",
      detail: `"${name}" created`,
      life: 3000
    });

    // Navigate directly into the new folder
    if (newId) {
      await navigateToFolder(Number(newId));
    } else {
      await refreshCurrentFolder();
    }

    // Expand parent tree node so the new folder shows in the sidebar
    if (parentFolder !== null) {
      expandedFolderIds.value.add(parentFolder);
      expandedFolderIds.value = new Set(expandedFolderIds.value);
    }
  } catch (err: any) {
    toast.add({
      severity: "error",
      summary: "Create Failed",
      detail: err.message || "Failed to create folder",
      life: 5000
    });
  } finally {
    isCreatingFolder.value = false;
  }
};

// ── Delete & Trash ─────────────────────────────────────────────────────────

const confirmDeleteItem = async (item: CabinetItem) => {
  // System/root folders have negative IDs and cannot be deleted
  if (item.id < 0) {
    toast.add({
      severity: "warn",
      summary: "Cannot Delete",
      detail: `"${item.name}" is a system folder and cannot be deleted.`,
      life: 4000
    });
    return;
  }

  deleteTargets.value = [item];
  deleteRecursive.value = false;
  folderContentWarning.value = null;

  // If it's a folder, check for contents
  if (item.type === "folder") {
    await checkFolderContents([item as FolderItem]);
  }

  showDeleteConfirm.value = true;
};

const confirmBulkDelete = async () => {
  // Filter out system/root folders (negative IDs)
  const eligible = selectedItems.value.filter((i) => i.id > 0);
  const skipped = selectedItems.value.length - eligible.length;
  if (skipped > 0 && eligible.length === 0) {
    toast.add({
      severity: "warn",
      summary: "Cannot Delete",
      detail: "Selected items include only system folders which cannot be deleted.",
      life: 4000
    });
    return;
  }
  deleteTargets.value = eligible;
  deleteRecursive.value = false;
  folderContentWarning.value = null;

  // Check if any folders have contents
  const folders = deleteTargets.value.filter((t) => t.type === "folder") as FolderItem[];
  if (folders.length > 0) {
    await checkFolderContents(folders);
  }

  showDeleteConfirm.value = true;
};

const checkFolderContents = async (folders: FolderItem[]) => {
  try {
    const ids = folders.map((f) => f.id).join(",");
    // Check for files in these folders
    const fileRows = await runQuery(`
      SELECT folder, COUNT(*) AS cnt FROM File WHERE folder IN (${ids}) GROUP BY folder
    `);
    // Check for subfolders
    const subRows = await runQuery(`
      SELECT parent, COUNT(*) AS cnt FROM MediaItemFolder WHERE parent IN (${ids}) GROUP BY parent
    `);

    let totalFiles = 0;
    let totalSubfolders = 0;
    for (const r of fileRows) totalFiles += Number(r.cnt);
    for (const r of subRows) totalSubfolders += Number(r.cnt);

    if (totalFiles > 0 || totalSubfolders > 0) {
      const parts: string[] = [];
      if (totalFiles > 0) parts.push(`${totalFiles} file${totalFiles !== 1 ? "s" : ""}`);
      if (totalSubfolders > 0) parts.push(`${totalSubfolders} subfolder${totalSubfolders !== 1 ? "s" : ""}`);
      folderContentWarning.value = `Contains ${parts.join(" and ")} — all will be saved to trash.`;
    }
  } catch {
    // If check fails, allow delete anyway — NetSuite will reject if non-empty
    folderContentWarning.value = null;
  }
};

const cancelDelete = () => {
  showDeleteConfirm.value = false;
  deleteTargets.value = [];
  deleteRecursive.value = false;
  folderContentWarning.value = null;
};

const executeDelete = async () => {
  const items = deleteTargets.value;
  if (items.length === 0) return;

  isDeleting.value = true;
  showDeleteConfirm.value = false;

  const folderName = breadcrumbs.value.length > 0
    ? breadcrumbs.value[breadcrumbs.value.length - 1]!.name
    : "Root";

  let deletedCount = 0;
  const errors: string[] = [];

  try {
    for (const item of items) {
      try {
        if (item.type === "folder") {
          // Build snapshot of all folder contents before deleting
          const snapshot = await buildFolderSnapshot(item.id);

          // Save folder + snapshot to trash as a single item
          await trashItem({
            environment: currentEnvironment.value,
            itemType: "folder",
            netsuiteId: item.id,
            name: item.name,
            originalFolderId: (item as FolderItem).parent,
            originalFolderName: folderName,
            content: JSON.stringify(snapshot),
            fileType: null,
            fileSize: null
          });

          // Delete all contents recursively from NetSuite
          await deleteNetsuiteRecursive(item.id);

          // Delete the folder itself
          await callApi(
            RequestRoutes.DELETE_FOLDER,
            { folderId: item.id },
            ApiRequestType.NORMAL
          );
        } else {
          // For text files, fetch content before deleting so we can restore
          let content: string | null = null;
          if (isTextFile(item as FileItem)) {
            try {
              const resp = await callApi(
                RequestRoutes.FETCH_FILE_CONTENT,
                { fileUrl: (item as FileItem).url },
                ApiRequestType.NORMAL
              );
              const result = (resp as ApiResponse)?.message || resp;
              if (result?.content && !result?.binary) {
                content = result.content;
              }
            } catch {
              // Best effort — proceed even if we can't save content
            }
          }

          // Save to trash before deleting from NetSuite
          await trashItem({
            environment: currentEnvironment.value,
            itemType: "file",
            netsuiteId: item.id,
            name: item.name,
            originalFolderId: (item as FileItem).folder,
            originalFolderName: folderName,
            content,
            fileType: (item as FileItem).filetype,
            fileSize: (item as FileItem).filesize
          });

          await callApi(
            RequestRoutes.DELETE_FILE,
            { fileId: item.id, folderId: (item as FileItem).folder },
            ApiRequestType.NORMAL
          );
        }

        deletedCount++;
      } catch (err: any) {
        errors.push(`${item.name}: ${err.message || "failed"}`);
      }
    }

    // Update trash count
    trashCount.value = await getTrashCount(currentEnvironment.value);

    if (deletedCount > 0) {
      toast.add({
        severity: "success",
        summary: "Deleted",
        detail: `${deletedCount} item${deletedCount !== 1 ? "s" : ""} moved to trash`,
        life: 3000
      });
    }

    if (errors.length > 0) {
      toast.add({
        severity: "error",
        summary: "Some Deletions Failed",
        detail: errors.slice(0, 3).join("\n") + (errors.length > 3 ? `\n...and ${errors.length - 3} more` : ""),
        life: 6000
      });
    }

    // Refresh current folder
    selectedItems.value = [];
    await refreshCurrentFolder();
  } catch (err: any) {
    toast.add({
      severity: "error",
      summary: "Delete Failed",
      detail: err.message || "Failed to delete items",
      life: 5000
    });
  } finally {
    isDeleting.value = false;
    deleteTargets.value = [];
    deleteRecursive.value = false;
    folderContentWarning.value = null;
  }
};

/**
 * Build a full recursive snapshot of all files and subfolders inside a folder.
 * Text file content is fetched; binary files are stored with content: null.
 */
const buildFolderSnapshot = async (folderId: number): Promise<FolderSnapshot> => {
  const fileRows = await runQuery(`
    SELECT id, name, fileType, fileSize, url FROM File WHERE folder = ${folderId}
  `);

  const files: FileSnapshot[] = [];
  for (const f of fileRows) {
    let content: string | null = null;
    if (f.filetype && TEXT_FILE_TYPES.has(f.filetype)) {
      try {
        const resp = await callApi(
          RequestRoutes.FETCH_FILE_CONTENT,
          { fileUrl: f.url },
          ApiRequestType.NORMAL
        );
        const result = (resp as ApiResponse)?.message || resp;
        if (result?.content && !result?.binary) {
          content = result.content;
        }
      } catch {
        // Best effort — proceed without content
      }
    }
    files.push({
      id: Number(f.id),
      name: f.name,
      filetype: f.filetype || "",
      filesize: f.filesize ? Number(f.filesize) : 0,
      content
    });
  }

  const subfolderRows = await runQuery(`
    SELECT id, name FROM MediaItemFolder WHERE parent = ${folderId}
  `);

  const subfolders: SubfolderSnapshot[] = [];
  for (const sf of subfolderRows) {
    const childSnapshot = await buildFolderSnapshot(Number(sf.id));
    subfolders.push({ id: Number(sf.id), name: sf.name, snapshot: childSnapshot });
  }

  return { files, subfolders };
};

/**
 * Recursively delete all files and subfolders inside a folder from NetSuite.
 * No trashing — call buildFolderSnapshot first if you need to preserve contents.
 */
const deleteNetsuiteRecursive = async (folderId: number) => {
  const fileRows = await runQuery(`
    SELECT id FROM File WHERE folder = ${folderId}
  `);
  for (const f of fileRows) {
    await callApi(
      RequestRoutes.DELETE_FILE,
      { fileId: Number(f.id), folderId },
      ApiRequestType.NORMAL
    );
  }

  const subfolderRows = await runQuery(`
    SELECT id FROM MediaItemFolder WHERE parent = ${folderId}
  `);
  for (const sf of subfolderRows) {
    await deleteNetsuiteRecursive(Number(sf.id));
    await callApi(
      RequestRoutes.DELETE_FOLDER,
      { folderId: Number(sf.id) },
      ApiRequestType.NORMAL
    );
  }
};

/**
 * Restore a FolderSnapshot tree into a parent folder in NetSuite.
 * Creates subfolders via CREATE_FOLDER and uploads files via UPLOAD_FILE.
 */
const restoreFolderSnapshot = async (snapshot: FolderSnapshot, parentFolderId: number) => {
  for (const f of snapshot.files) {
    if (!f.content) continue; // Binary — skip, can't restore without content
    try {
      await callApi(
        RequestRoutes.UPLOAD_FILE,
        { fileName: f.name, fileContent: f.content, folderId: parentFolderId },
        ApiRequestType.NORMAL
      );
    } catch {
      // Best effort per file
    }
  }

  for (const sf of snapshot.subfolders) {
    try {
      const resp = await callApi(
        RequestRoutes.CREATE_FOLDER,
        { name: sf.name, parentFolder: parentFolderId },
        ApiRequestType.NORMAL
      );
      const result = (resp as ApiResponse)?.message || resp;
      const newFolderId = result?.folderId ?? result?.id;
      if (newFolderId) {
        await restoreFolderSnapshot(sf.snapshot, Number(newFolderId));
      }
    } catch {
      // Best effort per subfolder
    }
  }
};

// ── Trash panel ────────────────────────────────────────────────────────────

/**
 * Parse a trashed folder's snapshot and return total file/folder counts.
 * Returns null if the item is not a folder or has no snapshot content.
 */
const getFolderTrashInfo = (item: TrashedItem): { files: number; folders: number } | null => {
  if (item.itemType !== "folder" || !item.content) return null;
  try {
    const snapshot = JSON.parse(item.content) as FolderSnapshot;
    const countFiles = (s: FolderSnapshot): number =>
      s.files.length + s.subfolders.reduce((acc, sf) => acc + countFiles(sf.snapshot), 0);
    const countFolders = (s: FolderSnapshot): number =>
      s.subfolders.length + s.subfolders.reduce((acc, sf) => acc + countFolders(sf.snapshot), 0);
    return { files: countFiles(snapshot), folders: countFolders(snapshot) };
  } catch {
    return null;
  }
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
  toast.add({
    severity: "success",
    summary: "Trash Emptied",
    detail: `${count} item${count !== 1 ? "s" : ""} permanently removed`,
    life: 3000
  });
};

const permanentlyDelete = async (item: TrashedItem) => {
  if (!item.id) return;
  await removeFromTrash(item.id);
  trashedItems.value = trashedItems.value.filter((t) => t.id !== item.id);
  trashCount.value = trashedItems.value.length;
  toast.add({
    severity: "info",
    summary: "Removed",
    detail: `${item.name} permanently deleted from trash`,
    life: 3000
  });
};

// ── Restore ────────────────────────────────────────────────────────────────

const restoreItem = async (item: TrashedItem) => {
  if (!item.id) return;

  // Only text files can be restored (we saved their content)
  if (item.itemType === "file" && !item.content) {
    toast.add({
      severity: "warn",
      summary: "Cannot Restore",
      detail: "File content was not saved — binary files cannot be restored",
      life: 4000
    });
    return;
  }

  // Check if original folder still exists
  if (item.originalFolderId !== null) {
    try {
      const rows = await runQuery(`
        SELECT id FROM MediaItemFolder WHERE id = ${item.originalFolderId} AND ROWNUM <= 1
      `);
      if (rows.length > 0) {
        // Folder exists — restore directly
        await doRestore(item, item.originalFolderId);
        return;
      }
    } catch {
      // Folder check failed — show picker
    }
  }

  // Original folder not available — show folder picker
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
    restorePickerFolders.value = (await runQuery(sql)).map((r: any) => ({
      id: Number(r.id),
      name: r.name || "Unnamed"
    }));
  } catch {
    restorePickerFolders.value = [];
  }
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
      // Re-upload file to the target folder
      const response = await callApi(
        RequestRoutes.UPLOAD_FILE,
        {
          fileName: item.name,
          fileContent: item.content,
          folderId
        },
        ApiRequestType.NORMAL
      );
      const result = (response as ApiResponse)?.message || response;
      if (!result?.uploaded?.length) {
        throw new Error("Upload failed during restore");
      }
    } else if (item.itemType === "folder") {
      // Re-create the folder with the correct key (parentFolder, not parentId)
      const createResp = await callApi(
        RequestRoutes.CREATE_FOLDER,
        { name: item.name, parentFolder: folderId },
        ApiRequestType.NORMAL
      );
      const createResult = (createResp as ApiResponse)?.message || createResp;
      const newFolderId = createResult?.folderId ?? createResult?.id;

      // Restore all contents from the snapshot stored in content
      if (newFolderId && item.content) {
        try {
          const snapshot = JSON.parse(item.content) as FolderSnapshot;
          await restoreFolderSnapshot(snapshot, Number(newFolderId));
        } catch {
          // Snapshot parse failure — folder itself still restored
        }
      }
    }

    // Remove the parent item from trash
    await removeFromTrash(item.id);
    trashedItems.value = trashedItems.value.filter((t) => t.id !== item.id);
    trashCount.value = trashedItems.value.length;

    toast.add({
      severity: "success",
      summary: "Restored",
      detail: `${item.name} has been restored`,
      life: 3000
    });

    // Refresh if we're in the target folder
    if (currentFolderId.value === folderId) {
      await refreshCurrentFolder();
    }
  } catch (err: any) {
    toast.add({
      severity: "error",
      summary: "Restore Failed",
      detail: err.message || "Failed to restore item",
      life: 5000
    });
  } finally {
    isRestoringId.value = null;
  }
};

// ── Preview watcher ────────────────────────────────────────────────────────

watch(detailItem, (item) => {
  previewContent.value = null;
  previewError.value = false;
  if (item && item.type === "file" && isPreviewable(item as FileItem)) {
    loadPreview(item as FileItem);
  }
});

onMounted(async () => {
  document.addEventListener("click", handleDocClick);
  currentEnvironment.value = await getNetsuiteEnvironment();
  await autoPurgeTrash(currentEnvironment.value);
  trashCount.value = await getTrashCount(currentEnvironment.value);
  await loadBookmarks();
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
  display: flex;
  align-items: center;
}

.fc-bulk-delete-btn {
  font-size: 0.65rem !important;
  padding: 0.2rem 0.5rem !important;
}

/* ── Detail panel ─────────────────────────────────────────────────────────── */
.fc-detail-panel {
  border-left: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow-y: auto;
  position: relative;
  min-width: 200px;
  max-width: 600px;
}

.fc-detail-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 5px;
  cursor: col-resize;
  z-index: 10;
  transition: background 0.15s;
}

.fc-detail-resize-handle:hover,
.fc-detail-resize-handle--active {
  background: var(--p-blue-200);
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
}

.fc-preview-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.fc-preview-unavailable {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.75rem;
  color: var(--p-slate-400);
  font-size: 0.75rem;
  font-style: italic;
}

.fc-preview-image {
  width: 100%;
  height: auto;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

.fc-preview-code {
  overflow: hidden;
  font-size: 0.65rem;
  height: 100%;
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

/* ── Edit toolbar ─────────────────────────────────────────────────────────── */
.fc-edit-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  flex-shrink: 0;
  gap: 0.5rem;
}

.fc-edit-toolbar-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.fc-edit-toolbar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Toggle switch */
.fc-edit-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  user-select: none;
}

.fc-edit-toggle input {
  display: none;
}

.fc-toggle-slider {
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: var(--p-slate-300);
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
}

.fc-toggle-slider::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: white;
  transition: transform 0.2s;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

.fc-edit-toggle input:checked + .fc-toggle-slider {
  background: var(--p-indigo-500);
}

.fc-edit-toggle input:checked + .fc-toggle-slider::after {
  transform: translateX(14px);
}

.fc-toggle-label {
  font-size: 0.75rem;
  color: var(--p-slate-600);
  font-weight: 500;
}

.fc-kbd {
  font-size: 0.55rem;
  font-family: "JetBrains Mono", monospace;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 3px;
  padding: 1px 4px;
  margin-left: 0.35rem;
  line-height: 1;
}

/* ── History dropdown ─────────────────────────────────────────────────────── */
.fc-history-wrapper {
  position: relative;
}

.fc-history-badge {
  font-size: 0.6rem;
  background: var(--p-indigo-500);
  color: white;
  border-radius: 8px;
  padding: 0 0.35rem;
  margin-left: 0.25rem;
  line-height: 1.5;
  font-weight: 600;
}

.fc-history-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  width: 260px;
  background: white;
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  z-index: 100;
  overflow: hidden;
}

.fc-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--p-slate-200);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-slate-700);
}

.fc-history-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--p-slate-400);
  padding: 0.15rem;
  border-radius: 3px;
}

.fc-history-close:hover {
  background: var(--p-slate-200);
}

.fc-history-list {
  max-height: 240px;
  overflow-y: auto;
}

.fc-history-item {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: background 0.1s;
  border-bottom: 1px solid var(--p-slate-100);
}

.fc-history-item:hover {
  background: var(--p-slate-50);
}

.fc-history-item.active {
  background: var(--p-indigo-50);
  border-left: 3px solid var(--p-indigo-500);
}

.fc-history-item-time {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--p-slate-700);
}

.fc-history-item-name {
  font-size: 0.65rem;
  color: var(--p-slate-500);
  margin-top: 0.125rem;
}

.fc-history-footer {
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
}

/* ── Diff bar ─────────────────────────────────────────────────────────────── */
.fc-diff-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0.75rem;
  background: var(--p-amber-50);
  border-bottom: 1px solid var(--p-amber-200);
  flex-shrink: 0;
}

.fc-file-diff {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
}

.fc-file-diff :deep(.diff-viewer) {
  flex: 1;
  max-height: none;
  border: none;
  border-radius: 0;
  width: 100%;
}

/* ── FileCodeEditor in file view ──────────────────────────────────────────── */
.fc-file-code :deep(.file-code-editor) {
  height: 100%;
}

/* ── Drag & drop zone ─────────────────────────────────────────────────────── */
.fc-drop-zone {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  position: relative;
}

.fc-drop-zone.fc-drag-over {
  outline: 2px dashed var(--p-indigo-400);
  outline-offset: -4px;
  background: rgba(99, 102, 241, 0.03);
}

.fc-drop-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  background: rgba(255, 255, 255, 0.92);
  z-index: 10;
  pointer-events: none;
  border-radius: 4px;
}

.fc-drop-overlay p {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--p-indigo-600);
}

.fc-upload-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.75rem;
  background: var(--p-indigo-50);
  border-bottom: 1px solid var(--p-indigo-200);
  font-size: 0.75rem;
  color: var(--p-indigo-700);
  flex-shrink: 0;
}

/* ── Global search ────────────────────────────────────────────────────────── */
.fc-global-search {
  border-bottom: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  flex-shrink: 0;
}

.fc-search-input-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
}

.fc-search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 0.8rem;
  color: var(--p-slate-800);
  font-family: inherit;
}

.fc-search-input::placeholder {
  color: var(--p-slate-400);
}

.fc-search-close {
  background: none;
  border: none;
  padding: 0.2rem;
  cursor: pointer;
  color: var(--p-slate-500);
  border-radius: 3px;
}

.fc-search-close:hover {
  background: var(--p-slate-200);
}

.fc-search-results {
  max-height: 280px;
  overflow-y: auto;
  border-top: 1px solid var(--p-slate-200);
}

.fc-search-result-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  cursor: pointer;
  font-size: 0.78rem;
  transition: background 0.1s;
}

.fc-search-result-item:hover {
  background: var(--p-indigo-50);
}

.fc-search-result-name {
  font-weight: 500;
  color: var(--p-slate-800);
  white-space: nowrap;
}

.fc-search-result-path {
  color: var(--p-slate-400);
  font-size: 0.7rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.fc-search-result-bookmark {
  background: none;
  border: none;
  padding: 0.2rem;
  cursor: pointer;
  border-radius: 3px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}

.fc-search-result-item:hover .fc-search-result-bookmark {
  opacity: 1;
}

.fc-search-result-bookmark:hover {
  background: var(--p-slate-200);
}

.fc-search-empty {
  padding: 0.75rem;
  text-align: center;
  font-size: 0.75rem;
  color: var(--p-slate-400);
  border-top: 1px solid var(--p-slate-200);
}

/* ── Confirm dialog ───────────────────────────────────────────────────────── */
.fc-confirm-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  z-index: 9999;
}

.fc-confirm-box {
  background: white;
  border-radius: 0.5rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  padding: 1.25rem;
  max-width: 380px;
  width: 90%;
}

.fc-confirm-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  font-size: 0.9rem;
  margin-bottom: 0.75rem;
  color: var(--p-slate-800);
}

.fc-confirm-body {
  font-size: 0.8rem;
  color: var(--p-slate-600);
  line-height: 1.5;
  margin-bottom: 1rem;
}

.fc-delete-list {
  margin: 0.5rem 0;
  padding: 0;
  list-style: none;
  max-height: 160px;
  overflow-y: auto;
  font-size: 0.75rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 4px;
  padding: 0.4rem;
}

.fc-delete-list li {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0;
}

.fc-folder-warning {
  display: flex;
  align-items: flex-start;
  gap: 0.35rem;
  margin-top: 0.5rem;
  padding: 0.4rem 0.5rem;
  background: var(--p-amber-50, #fffbeb);
  border: 1px solid var(--p-amber-200, #fde68a);
  border-radius: 4px;
  font-size: 0.72rem;
  color: var(--p-amber-800, #92400e);
  line-height: 1.4;
}

.fc-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.fc-confirm-danger span {
  color: var(--p-red-600);
}

/* ── Trash badge ──────────────────────────────────────────────────────────── */
.fc-trash-badge {
  color: var(--p-slate-400);
  font-size: 0.7rem;
  font-weight: 500;
  margin-left: 0.25rem;
}

/* ── Trash panel ──────────────────────────────────────────────────────────── */
.fc-trash-panel {
  background: white;
  border-radius: 0.5rem;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  width: 90%;
  max-width: 520px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
}

.fc-trash-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--p-slate-200);
  flex-shrink: 0;
}

.fc-trash-panel-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.fc-trash-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2rem;
  color: var(--p-slate-400);
  font-size: 0.8rem;
}

.fc-trash-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--p-slate-100);
  transition: background 0.1s;
}

.fc-trash-item:hover {
  background: var(--p-slate-50);
}

.fc-trash-item-icon {
  flex-shrink: 0;
}

.fc-trash-item-info {
  flex: 1;
  min-width: 0;
}

.fc-trash-item-name {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--p-slate-800);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fc-trash-item-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.7rem;
  color: var(--p-slate-400);
}

.fc-trash-item-timer {
  color: var(--p-amber-600);
  font-weight: 500;
}

.fc-trash-item-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

/* ── Restore folder picker ────────────────────────────────────────────────── */
.fc-restore-picker {
  margin-bottom: 0.5rem;
}

.fc-restore-folder-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--p-slate-200);
  border-radius: 4px;
}

.fc-restore-folder-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.6rem;
  cursor: pointer;
  font-size: 0.78rem;
  transition: background 0.1s;
}

.fc-restore-folder-item:hover {
  background: var(--p-indigo-50);
}

/* ── Context menu delete styling ──────────────────────────────────────────── */
.fc-context-item--danger {
  border-top: 1px solid var(--p-slate-200);
  color: var(--p-red-600);
}

.fc-context-item--danger:hover {
  background: var(--p-red-50);
}

/* ── Inline rename input ──────────────────────────────────────────────────── */
.fc-rename-input {
  width: 100%;
  max-width: 100%;
  border: 1px solid var(--p-indigo-400);
  border-radius: 3px;
  padding: 1px 4px;
  font-size: inherit;
  background: var(--p-surface-0, #fff);
  color: inherit;
  outline: none;
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
}

/* ── Detail panel bookmark button ────────────────────────────────────────── */
.fc-detail-bookmark {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.25rem;
  color: var(--p-slate-400);
  border-radius: 3px;
  flex-shrink: 0;
  margin-right: 0.25rem;
}

.fc-detail-bookmark:hover {
  background: var(--p-slate-200);
}

/* ── Sidebar section toggle header ──────────────────────────────────────── */
.fc-section-toggle {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  cursor: pointer;
  user-select: none;
  margin-bottom: 0.5rem;
}

/* ── Bookmarks list ──────────────────────────────────────────────────────── */
.fc-bookmarks-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 0.25rem;
}

.fc-bookmark-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.4rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.72rem;
  min-width: 0;
}

.fc-bookmark-item:hover {
  background: var(--p-slate-200);
}

.fc-bookmark-status {
  flex-shrink: 0;
}

.fc-bookmark-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--p-slate-700);
}

.fc-bookmark-remove {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 0.15rem;
  color: var(--p-slate-400);
  border-radius: 3px;
  opacity: 0;
  transition: opacity 0.1s;
}

.fc-bookmark-item:hover .fc-bookmark-remove {
  opacity: 1;
}

.fc-bookmark-remove:hover {
  color: var(--p-red-500);
  background: var(--p-red-50);
}
</style>
