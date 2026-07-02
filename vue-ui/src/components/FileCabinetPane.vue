<template>
  <div
    class="fc-pane-wrapper"
    :class="{ 'fc-pane--context-picker': props.contextPicker }"
  >
    <!-- ── Main content area ─────────────────────────────────────────────── -->
    <div class="fc-pane-main">
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
              outlined
              @click="closeFile"
            >
              <i class="pi pi-arrow-left text-xs mr-1"></i>
              Back
            </Button>
          </template>
          <template v-else>
            <button
              v-if="currentFolderInfo && !props.contextPicker"
              class="fc-view-toggle"
              :class="{ active: props.bookmarkedIds.has(currentFolderInfo.id) }"
              :title="
                props.bookmarkedIds.has(currentFolderInfo.id)
                  ? 'Remove Bookmark'
                  : 'Bookmark this folder'
              "
              @click="toggleBookmark(currentFolderInfo)"
            >
              <i
                :class="
                  props.bookmarkedIds.has(currentFolderInfo.id)
                    ? 'pi pi-bookmark-fill'
                    : 'pi pi-bookmark'
                "
                class="text-xs"
              ></i>
            </button>
            <InputText
              v-model="contentSearch"
              type="text"
              placeholder="Filter name or ID..."
              size="small"
              class="fc-filter-input"
            />
            <button
              class="fc-view-toggle"
              title="Refresh current location"
              :disabled="isLoading"
              @click="refreshCurrentFolder"
            >
              <i
                :class="isLoading ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'"
                class="text-xs"
              ></i>
            </button>
            <button
              v-if="!props.contextPicker"
              class="fc-view-toggle"
              title="New Folder"
              @click="openNewFolderDialog"
            >
              <i class="pi pi-folder-plus text-xs"></i>
            </button>
            <button
              v-if="!props.contextPicker"
              class="fc-view-toggle"
              title="New Text File"
              @click="openNewFileDialog"
            >
              <i class="pi pi-file-edit text-xs"></i>
            </button>
            <div class="fc-view-seg">
              <button
                class="fc-view-seg-btn"
                :class="{ active: viewMode === 'grid' }"
                @click="viewMode = 'grid'"
                title="Grid view"
              >
                <i class="pi pi-th-large text-xs"></i>
              </button>
              <button
                class="fc-view-seg-btn"
                :class="{ active: viewMode === 'list' }"
                @click="viewMode = 'list'"
                title="List view"
              >
                <i class="pi pi-list text-xs"></i>
              </button>
            </div>
          </template>
        </div>
      </div>

      <!-- Global search -->
      <div v-if="!openedFile" class="fc-global-search">
        <div class="fc-search-input-row">
          <i class="pi pi-search text-xs text-gray-400"></i>
          <input
            v-model="globalSearchQuery"
            type="text"
            placeholder="Search all files and folders by name or ID..."
            class="fc-search-input"
            @input="handleGlobalSearch"
            @keydown.escape="clearGlobalSearch"
          />
          <i
            v-if="globalSearchLoading"
            class="pi pi-spin pi-spinner text-xs text-gray-400"
          ></i>
          <button
            v-if="globalSearchQuery"
            class="fc-search-close"
            @click="clearGlobalSearch"
          >
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
            <i
              :class="
                result.type === 'folder'
                  ? 'pi pi-folder text-amber-500'
                  : 'pi pi-file text-gray-500'
              "
              class="text-xs"
            ></i>
            <span class="fc-search-result-name">{{ result.name }}</span>
            <span class="fc-search-result-path">{{ result.path }}</span>
            <button
              v-if="props.contextPicker && result.type === 'file'"
              type="button"
              class="fc-add-btn fc-search-add-btn"
              :class="{ attached: props.attachedFileIds?.has(result.id) }"
              :disabled="props.attachedFileIds?.has(result.id)"
              title="Add to context"
              @click.stop="addSearchResultToContext(result)"
            >
              <i
                :class="
                  props.attachedFileIds?.has(result.id)
                    ? 'pi pi-check'
                    : 'pi pi-plus'
                "
              />
            </button>
            <button
              v-else-if="!props.contextPicker"
              class="fc-search-result-bookmark"
              :title="
                props.bookmarkedIds.has(result.id)
                  ? 'Remove Bookmark'
                  : 'Add Bookmark'
              "
              @click.stop="toggleBookmarkFromSearchResult(result)"
            >
              <i
                :class="
                  props.bookmarkedIds.has(result.id)
                    ? 'pi pi-bookmark-fill text-amber-400'
                    : 'pi pi-bookmark text-gray-400'
                "
                class="text-xs"
              ></i>
            </button>
          </div>
        </div>
        <div
          v-else-if="
            globalSearchQuery.trim().length >= 3 && !globalSearchLoading
          "
          class="fc-search-empty"
        >
          No results found
        </div>
        <div
          v-else-if="
            globalSearchQuery.trim().length > 0 &&
            globalSearchQuery.trim().length < 3 &&
            !isNumericGlobalSearchQuery &&
            !globalSearchLoading
          "
          class="fc-search-empty"
        >
          Type at least 3 characters to search
        </div>
      </div>

      <!-- ═══ OPENED FILE VIEW ═══ -->
      <template v-if="openedFile">
        <div v-if="fileLoading" class="flex-1 flex items-center justify-center">
          <div class="text-center">
            <i class="pi pi-spin pi-spinner text-2xl text-gray-400"></i>
            <p class="text-sm text-gray-500 mt-2">
              Loading {{ openedFile.name }}...
            </p>
          </div>
        </div>
        <div
          v-else-if="fileLoadError"
          class="flex-1 flex items-center justify-center"
        >
          <div class="text-center text-red-500">
            <i class="pi pi-exclamation-circle text-3xl mb-2"></i>
            <p class="text-sm">{{ fileLoadError }}</p>
            <Button size="small" class="mt-2" @click="openFile(openedFile!)"
              >Retry</Button
            >
          </div>
        </div>
        <div
          v-else-if="fileIsBinary && fileContent"
          class="fc-file-view"
          :class="
            isPdfFile(openedFile!) && pdfObjectUrl
              ? 'fc-file-pdf'
              : 'fc-file-image'
          "
        >
          <iframe
            v-if="isPdfFile(openedFile!) && pdfObjectUrl"
            :src="pdfObjectUrl"
            class="fc-pdf-viewer"
            title="PDF Viewer"
          ></iframe>
          <img
            v-else
            :src="fileContent"
            :alt="openedFile!.name"
            class="fc-image-content"
          />
        </div>
        <template v-else-if="fileContent !== null && !fileIsBinary">
          <div v-if="isTextFile(openedFile)" class="fc-edit-toolbar">
            <div class="fc-edit-toolbar-left">
              <label class="fc-edit-toggle">
                <input type="checkbox" v-model="isEditing" />
                <span class="fc-toggle-slider"></span>
                <span class="fc-toggle-label">{{
                  isEditing ? "Editing" : "Read-only"
                }}</span>
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
                  {{ isSaving ? "Saving..." : "Save" }}
                  <kbd v-if="!isSaving" class="fc-kbd">Ctrl+S</kbd>
                </Button>
                <div class="fc-history-wrapper">
                  <Button
                    size="small"
                    severity="secondary"
                    outlined
                    @click="toggleHistoryDropdown"
                    :disabled="versionHistory.length === 0"
                  >
                    <i class="pi pi-history text-xs mr-1"></i>
                    History
                    <span
                      v-if="versionHistory.length > 0"
                      class="fc-history-badge"
                      >{{ versionHistory.length }}</span
                    >
                  </Button>
                  <div v-if="historyDropdownOpen" class="fc-history-dropdown">
                    <div class="fc-history-header">
                      <span>Version History</span>
                      <button
                        class="fc-history-close"
                        @click="historyDropdownOpen = false"
                      >
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
                        <div class="fc-history-item-time">
                          {{ formatVersionDate(ver.savedAt) }}
                        </div>
                        <div class="fc-history-item-name">
                          {{ ver.fileName }}
                        </div>
                      </div>
                    </div>
                    <div
                      v-if="versionHistory.length > 0"
                      class="fc-history-footer"
                    >
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
              <Button
                size="small"
                severity="secondary"
                outlined
                :class="{ 'fc-btn-active': showCompare }"
                @click="showCompare ? closeCompare() : openCompare()"
              >
                <i class="pi pi-arrows-h text-xs mr-1"></i>
                Compare
              </Button>
            </div>
          </div>

          <div
            v-if="showingDiff && selectedVersionContent !== null"
            class="fc-file-view fc-file-diff"
          >
            <div class="fc-diff-bar">
              <span class="text-xs text-gray-600">
                <i class="pi pi-clock text-xs mr-1"></i>
                Comparing: <strong>{{ selectedVersionLabel }}</strong> vs
                Current
              </span>
              <div class="flex items-center gap-2">
                <Button
                  size="small"
                  severity="secondary"
                  outlined
                  @click="revertToVersion"
                >
                  <i class="pi pi-undo text-xs mr-1"></i>
                  Revert to This
                </Button>
                <Button
                  size="small"
                  severity="secondary"
                  outlined
                  @click="closeDiff"
                >
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

          <div v-else-if="showCompare" class="fc-file-view fc-file-compare">
            <div class="fc-compare-bar">
              <div class="fc-compare-labels">
                <span class="fc-compare-label fc-compare-label-left">
                  <i class="pi pi-lock text-xs mr-1"></i>
                  Original (read-only)
                </span>
                <span class="fc-compare-label fc-compare-label-right">
                  <i class="pi pi-pencil text-xs mr-1"></i>
                  Modified (editable)
                </span>
              </div>
              <div class="flex items-center gap-2">
                <Button
                  size="small"
                  severity="secondary"
                  outlined
                  @click="loadCompareFromClipboard"
                >
                  <i class="pi pi-clipboard text-xs mr-1"></i>
                  Paste Clipboard
                </Button>
                <Button
                  size="small"
                  severity="secondary"
                  outlined
                  @click="swapCompare"
                >
                  <i class="pi pi-sort-alt text-xs mr-1"></i>
                  Swap
                </Button>
              </div>
            </div>
            <DiffComparator
              :key="compareKey"
              :original="compareA"
              :modified="compareB"
              :language="getCodeLanguage(openedFile)"
              @update:modified="compareB = $event"
            />
          </div>

          <div v-else class="fc-file-view fc-file-code">
            <FileCodeEditor
              v-model="editorContent"
              :language="getCodeLanguage(openedFile)"
              :readonly="!isEditing"
              @ctrl-s="saveFile"
            />
          </div>
        </template>
        <div v-else class="flex-1 flex items-center justify-center">
          <div class="text-center text-gray-500">
            <i class="pi pi-file text-4xl mb-2"></i>
            <p>Unable to display this file</p>
          </div>
        </div>
      </template>

      <!-- ═══ FOLDER LISTING VIEW ═══ -->
      <template v-else>
        <div
          class="fc-drop-zone"
          :class="{ 'fc-drag-over': !props.contextPicker && isDragOver }"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
          @drop="handleDrop"
          @contextmenu.prevent="handleBodyContextMenu($event)"
        >
          <!-- Deletion loading overlay -->
          <div v-if="isDeleting" class="fc-delete-overlay">
            <i class="pi pi-spin pi-spinner text-xl text-indigo-500"></i>
            <span class="text-sm text-gray-600 mt-2">Deleting...</span>
          </div>
          <!-- Rename loading overlay -->
          <div v-if="isRenamingLoading" class="fc-delete-overlay">
            <i class="pi pi-spin pi-spinner text-xl text-indigo-500"></i>
            <span class="text-sm text-gray-600 mt-2">Renaming...</span>
          </div>
          <!-- Move loading overlay -->
          <div v-if="isMoveLoading" class="fc-delete-overlay">
            <i class="pi pi-spin pi-spinner text-xl text-indigo-500"></i>
            <span class="text-sm text-gray-600 mt-2">Moving...</span>
          </div>
          <div
            v-if="!props.contextPicker && isDragOver"
            class="fc-drop-overlay"
          >
            <i class="pi pi-cloud-upload text-4xl text-indigo-500"></i>
            <p>Drop files to upload to this folder</p>
          </div>
          <div v-if="isUploading" class="fc-upload-bar">
            <i class="pi pi-spin pi-spinner text-xs"></i>
            <span>{{ uploadProgress }}</span>
          </div>
          <div v-if="isLoading" class="flex-1 flex items-center justify-center">
            <i class="pi pi-spin pi-spinner text-2xl text-gray-400"></i>
          </div>
          <div
            v-else-if="loadError"
            class="flex-1 flex items-center justify-center"
          >
            <div class="text-center text-red-500">
              <i class="pi pi-exclamation-circle text-3xl mb-2"></i>
              <p class="text-sm">{{ loadError }}</p>
              <Button size="small" class="mt-2" @click="refreshCurrentFolder"
                >Retry</Button
              >
            </div>
          </div>
          <div
            v-else-if="filteredItems.length === 0 && !isLoading"
            class="flex-1 flex items-center justify-center"
          >
            <div class="text-center text-gray-500">
              <i class="pi pi-folder-open text-4xl mb-2"></i>
              <p>
                {{
                  contentSearch ? "No matching items" : "This folder is empty"
                }}
              </p>
            </div>
          </div>
          <!-- Grid view -->
          <div v-else-if="viewMode === 'grid'" class="fc-grid-view">
            <div
              v-for="item in filteredItems"
              :key="item.type + '-' + item.id"
              class="fc-grid-item"
              :class="{
                selected: isSelected(item),
                'fc-drop-target':
                  item.type === 'folder' && dropTargetFolderId === item.id
              }"
              :draggable="renamingItemId !== item.id"
              @click="handleItemClick(item, $event)"
              @mousedown.middle.prevent="emit('open-in-newtab', item)"
              @dblclick="handleItemDblClick(item)"
              @contextmenu.prevent.stop="handleItemContext(item, $event)"
              @dragstart="handleItemDragStart(item, $event)"
              @dragend="handleItemDragEnd"
              @dragover.prevent="handleFolderDragOver(item, $event)"
              @dragleave="handleFolderDragLeave"
              @drop.prevent.stop="handleMoveItemDrop(item, $event)"
            >
              <div class="fc-grid-icon">
                <i :class="getItemIcon(item)" class="text-2xl"></i>
              </div>
              <div
                class="fc-grid-label"
                :title="renamingItemId === item.id ? undefined : item.name"
              >
                <input
                  v-if="renamingItemId === item.id"
                  v-model="renameValue"
                  class="fc-rename-input"
                  @keydown.enter.stop="commitRename(item)"
                  @keydown.escape.stop="cancelRename"
                  @blur="cancelRename"
                  @click.stop
                />
                <template v-else>{{ item.name }}</template>
              </div>
              <div class="fc-grid-meta">
                <template v-if="item.type === 'folder'"
                  >{{ item.numfolderfiles ?? 0 }} files</template
                >
                <template v-else>{{ formatFileSize(item.filesize) }}</template>
              </div>
              <div
                v-if="props.contextPicker && item.type === 'file'"
                class="fc-grid-add"
              >
                <button
                  type="button"
                  class="fc-add-btn"
                  :class="{ attached: props.attachedFileIds?.has(item.id) }"
                  :disabled="
                    props.attachedFileIds?.has(item.id) ||
                    props.attachingFileIds?.has(item.id)
                  "
                  :title="
                    props.attachedFileIds?.has(item.id)
                      ? 'Added to context'
                      : 'Add to context'
                  "
                  @click.stop="emit('add-to-context', item)"
                >
                  <i
                    :class="
                      props.attachingFileIds?.has(item.id)
                        ? 'pi pi-spin pi-spinner'
                        : props.attachedFileIds?.has(item.id)
                          ? 'pi pi-check'
                          : 'pi pi-plus'
                    "
                  />
                </button>
              </div>
            </div>
          </div>
          <!-- List view -->
          <div v-else class="fc-list-view">
            <table class="fc-table">
              <thead>
                <tr>
                  <th class="fc-th-name" @click="toggleSort('name')">
                    Name
                    <i
                      v-if="sortField === 'name'"
                      :class="
                        sortDir === 'asc'
                          ? 'pi pi-sort-up-fill'
                          : 'pi pi-sort-down-fill'
                      "
                      class="text-xs ml-1"
                    ></i>
                  </th>
                  <th class="fc-th-type" @click="toggleSort('fileType')">
                    Type
                    <i
                      v-if="sortField === 'fileType'"
                      :class="
                        sortDir === 'asc'
                          ? 'pi pi-sort-up-fill'
                          : 'pi pi-sort-down-fill'
                      "
                      class="text-xs ml-1"
                    ></i>
                  </th>
                  <th class="fc-th-size" @click="toggleSort('size')">
                    Size
                    <i
                      v-if="sortField === 'size'"
                      :class="
                        sortDir === 'asc'
                          ? 'pi pi-sort-up-fill'
                          : 'pi pi-sort-down-fill'
                      "
                      class="text-xs ml-1"
                    ></i>
                  </th>
                  <th
                    class="fc-th-date"
                    @click="toggleSort('lastmodifieddate')"
                  >
                    Modified
                    <i
                      v-if="sortField === 'lastmodifieddate'"
                      :class="
                        sortDir === 'asc'
                          ? 'pi pi-sort-up-fill'
                          : 'pi pi-sort-down-fill'
                      "
                      class="text-xs ml-1"
                    ></i>
                  </th>
                  <th class="fc-th-id">ID</th>
                  <th v-if="props.contextPicker" class="fc-th-action"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in filteredItems"
                  :key="item.type + '-' + item.id"
                  class="fc-table-row"
                  :class="{
                    selected: isSelected(item),
                    'fc-drop-target':
                      item.type === 'folder' && dropTargetFolderId === item.id
                  }"
                  :draggable="renamingItemId !== item.id"
                  @click="handleItemClick(item, $event)"
                  @mousedown.middle.prevent="emit('open-in-newtab', item)"
                  @dblclick="handleItemDblClick(item)"
                  @contextmenu.prevent.stop="handleItemContext(item, $event)"
                  @dragstart="handleItemDragStart(item, $event)"
                  @dragend="handleItemDragEnd"
                  @dragover.prevent="handleFolderDragOver(item, $event)"
                  @dragleave="handleFolderDragLeave"
                  @drop.prevent.stop="handleMoveItemDrop(item, $event)"
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
                    />
                    <span v-else>{{ item.name }}</span>
                  </td>
                  <td class="fc-td-type">
                    {{
                      item.type === "folder" ? "Folder" : item.filetype || "—"
                    }}
                  </td>
                  <td class="fc-td-size">
                    <template v-if="item.type === 'folder'">{{
                      formatFolderSize(item.foldersize)
                    }}</template>
                    <template v-else>{{
                      formatFileSize(item.filesize)
                    }}</template>
                  </td>
                  <td class="fc-td-date">{{ item.lastmodifieddate || "—" }}</td>
                  <td class="fc-td-id">{{ item.id }}</td>
                  <td v-if="props.contextPicker" class="fc-td-action">
                    <button
                      v-if="item.type === 'file'"
                      type="button"
                      class="fc-add-btn"
                      :class="{ attached: props.attachedFileIds?.has(item.id) }"
                      :disabled="
                        props.attachedFileIds?.has(item.id) ||
                        props.attachingFileIds?.has(item.id)
                      "
                      :title="
                        props.attachedFileIds?.has(item.id)
                          ? 'Added to context'
                          : 'Add to context'
                      "
                      @click.stop="emit('add-to-context', item)"
                    >
                      <i
                        :class="
                          props.attachingFileIds?.has(item.id)
                            ? 'pi pi-spin pi-spinner'
                            : props.attachedFileIds?.has(item.id)
                              ? 'pi pi-check'
                              : 'pi pi-plus'
                        "
                      />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Status bar -->
        <div class="fc-status-bar">
          <span
            >{{ folderCount }} folder{{ folderCount !== 1 ? "s" : "" }},
            {{ fileCount }} file{{ fileCount !== 1 ? "s" : "" }}</span
          >
          <span v-if="selectedItems.length > 0" class="ml-4"
            >{{ selectedItems.length }} selected</span
          >
          <Button
            v-if="!props.contextPicker && selectedItems.length > 1"
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

    <!-- ── Detail / Preview panel ─────────────────────────────────────────── -->
    <div
      v-if="detailItem && !openedFile && !props.contextPicker"
      class="fc-detail-panel"
      :style="{ width: detailPanelWidth + 'px' }"
    >
      <div
        class="fc-detail-resize-handle"
        :class="{ 'fc-detail-resize-handle--active': isResizingPanel }"
        @mousedown="startPanelResize"
      />
      <div class="fc-detail-header">
        <i
          :class="getItemIcon(detailItem)"
          class="text-sm flex-shrink-0"
          style="margin-top: 1px"
        ></i>
        <h4>{{ detailItem.name }}</h4>
        <button
          class="fc-detail-bookmark"
          :title="
            props.bookmarkedIds.has(detailItem.id)
              ? 'Remove Bookmark'
              : 'Add Bookmark'
          "
          @click="toggleBookmark(detailItem)"
        >
          <i
            :class="
              props.bookmarkedIds.has(detailItem.id)
                ? 'pi pi-bookmark-fill text-yellow-400'
                : 'pi pi-bookmark text-gray-400'
            "
            class="text-sm"
          ></i>
        </button>
        <button class="fc-detail-close" @click="detailItem = null">
          <i class="pi pi-times text-xs"></i>
        </button>
      </div>
      <div class="fc-detail-body">
        <div
          v-if="
            detailItem.type === 'file' && isPreviewable(detailItem as FileItem)
          "
          class="fc-detail-preview"
          :style="{
            maxHeight: Math.min(Math.round(detailPanelWidth * 0.85), 480) + 'px'
          }"
        >
          <div v-if="previewLoading" class="fc-preview-loading">
            <i class="pi pi-spin pi-spinner text-sm text-gray-400"></i>
          </div>
          <div v-else-if="previewError" class="fc-preview-unavailable">
            <i class="pi pi-eye-slash text-gray-400 text-sm"></i>
            <span>No preview available</span>
          </div>
          <template v-else-if="previewContent">
            <img
              v-if="isImageFile(detailItem as FileItem)"
              :src="previewContent"
              :alt="detailItem.name"
              class="fc-preview-image"
            />
            <div v-else class="fc-preview-code">
              <CodeViewer
                :code="previewContent"
                :language="getCodeLanguage(detailItem as FileItem)"
              />
            </div>
          </template>
        </div>
        <div
          v-if="detailItem.type === 'file' && (detailItem as FileItem).url"
          class="fc-detail-actions"
        >
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
            <span class="value">{{
              detailItem.type === "folder"
                ? "Folder"
                : detailItem.filetype || "—"
            }}</span>
          </div>
          <div class="fc-detail-field">
            <span class="label">Size</span>
            <span class="value">
              {{
                detailItem.type === "folder"
                  ? formatFolderSize(detailItem.foldersize)
                  : formatFileSize(detailItem.filesize)
              }}
            </span>
          </div>
          <div class="fc-detail-field">
            <span class="label">Modified</span>
            <span class="value">{{ detailItem.lastmodifieddate || "—" }}</span>
          </div>
          <div
            v-if="detailItem.type === 'file' && detailItem.createddate"
            class="fc-detail-field"
          >
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
            <a
              :href="getNetsuiteEditUrl(detailItem)"
              target="_blank"
              class="value text-blue-600 hover:underline text-xs break-all"
            >
              {{ detailItem.type === "file" ? "Edit File" : "Edit Folder" }}
              <i class="pi pi-external-link text-[10px]"></i>
            </a>
          </div>
          <div v-if="detailItem.type === 'folder'" class="fc-detail-field">
            <span class="label">Files</span>
            <span class="value">{{ detailItem.numfolderfiles ?? 0 }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Teleported overlays ────────────────────────────────────────────── -->

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
          :class="[
            'fc-context-item',
            { 'fc-context-item--danger': action.danger }
          ]"
          @click="
            action.handler();
            contextMenu.visible = false;
          "
        >
          <i :class="action.icon" class="text-xs"></i>
          <span>{{ action.label }}</span>
        </div>
      </div>
    </Teleport>

    <!-- Drop version confirmation dialog -->
    <Teleport to="body">
      <div
        v-if="showDropConfirm"
        class="fc-confirm-overlay"
        @click.self="confirmDropCancel"
      >
        <div class="fc-confirm-box">
          <div class="fc-confirm-header">
            <i class="pi pi-exclamation-triangle text-amber-500"></i>
            <span>History Full</span>
          </div>
          <p class="fc-confirm-body">
            You already have 5 saved versions. Saving now will permanently
            delete the oldest version
            <strong>({{ dropConfirmDate }})</strong> to make room.
          </p>
          <div class="fc-confirm-actions">
            <Button size="small" severity="secondary" @click="confirmDropCancel"
              >Cancel</Button
            >
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
      <div
        v-if="showDeleteConfirm"
        class="fc-confirm-overlay"
        @click.self="cancelDelete"
      >
        <div class="fc-confirm-box">
          <div class="fc-confirm-header fc-confirm-danger">
            <i class="pi pi-exclamation-triangle text-red-500"></i>
            <span v-if="deleteTargets.length === 1"
              >Delete
              {{
                deleteTargets[0]!.type === "folder" ? "Folder" : "File"
              }}</span
            >
            <span v-else>Delete {{ deleteTargets.length }} Items</span>
          </div>
          <div class="fc-confirm-body">
            <template v-if="deleteTargets.length === 1">
              <p>
                Are you sure you want to delete
                <strong>{{ deleteTargets[0]!.name }}</strong
                >?
              </p>
              <p
                v-if="
                  deleteTargets[0]!.type === 'file' &&
                  isTextFile(deleteTargets[0] as any)
                "
                class="text-xs text-gray-400 mt-1"
              >
                The file content will be saved to trash for 15 days so you can
                restore it.
              </p>
              <p
                v-else-if="deleteTargets[0]!.type === 'file'"
                class="text-xs text-gray-400 mt-1"
              >
                Binary files cannot be restored from trash.
              </p>
            </template>
            <template v-else>
              <p>
                Are you sure you want to delete
                <strong>{{ deleteTargets.length }}</strong> items?
              </p>
              <ul class="fc-delete-list">
                <li
                  v-for="t in deleteTargets.slice(0, 8)"
                  :key="`${t.type}-${t.id}`"
                >
                  <i :class="getItemIcon(t)" class="text-xs"></i>
                  {{ t.name }}
                </li>
                <li v-if="deleteTargets.length > 8" class="text-gray-400">
                  ... and {{ deleteTargets.length - 8 }} more
                </li>
              </ul>
              <p class="text-xs text-gray-400 mt-1">
                Text file content will be saved to trash for 15 days.
              </p>
            </template>
            <div v-if="folderContentWarning" class="fc-folder-warning">
              <i class="pi pi-info-circle text-blue-400 text-xs"></i>
              <span>{{ folderContentWarning }}</span>
            </div>
          </div>
          <div class="fc-confirm-actions">
            <Button size="small" severity="secondary" @click="cancelDelete"
              >Cancel</Button
            >
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

    <!-- Move confirmation dialog -->
    <Teleport to="body">
      <div
        v-if="showMoveConfirm"
        class="fc-confirm-overlay"
        @click.self="cancelMove"
      >
        <div class="fc-confirm-box">
          <div class="fc-confirm-header">
            <i class="pi pi-arrow-right-arrow-left text-blue-400"></i>
            <span v-if="moveTargets.length === 1"
              >Move
              {{ moveTargets[0]!.type === "folder" ? "Folder" : "File" }}</span
            >
            <span v-else>Move {{ moveTargets.length }} Items</span>
          </div>
          <div class="fc-confirm-body">
            <template v-if="moveTargets.length === 1">
              <p>
                Move <strong>{{ moveTargets[0]!.name }}</strong> into
                <strong>{{ moveDestFolder?.name }}</strong
                >?
              </p>
            </template>
            <template v-else>
              <p>
                Move <strong>{{ moveTargets.length }}</strong> items into
                <strong>{{ moveDestFolder?.name }}</strong
                >?
              </p>
              <ul class="fc-delete-list">
                <li
                  v-for="t in moveTargets.slice(0, 8)"
                  :key="`${t.type}-${t.id}`"
                >
                  <i :class="getItemIcon(t)" class="text-xs"></i>
                  {{ t.name }}
                </li>
                <li v-if="moveTargets.length > 8" class="text-gray-400">
                  ... and {{ moveTargets.length - 8 }} more
                </li>
              </ul>
            </template>
          </div>
          <div class="fc-confirm-actions">
            <Button size="small" severity="secondary" @click="cancelMove"
              >Cancel</Button
            >
            <Button
              size="small"
              severity="info"
              @click="executeMove"
              :loading="isMoveLoading"
            >
              <i class="pi pi-arrow-right-arrow-left text-xs mr-1"></i>
              Move
            </Button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- New Folder dialog -->
    <Teleport to="body">
      <div
        v-if="showNewFolderDialog"
        class="fc-confirm-overlay"
        @click.self="cancelNewFolder"
      >
        <div class="fc-confirm-box">
          <div class="fc-confirm-header">
            <i class="pi pi-folder-plus text-amber-500"></i>
            <span>New Folder</span>
          </div>
          <div class="fc-confirm-body">
            <p class="mb-2">
              Create a new folder inside
              <strong>{{
                breadcrumbs.length > 0
                  ? breadcrumbs[breadcrumbs.length - 1]!.name
                  : "Root"
              }}</strong
              >.
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
            <Button size="small" severity="secondary" @click="cancelNewFolder"
              >Cancel</Button
            >
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

    <!-- New File dialog -->
    <Teleport to="body">
      <div
        v-if="showNewFileDialog"
        class="fc-confirm-overlay"
        @click.self="cancelNewFile"
      >
        <div class="fc-confirm-box" style="max-width: 460px">
          <div class="fc-confirm-header">
            <i class="pi pi-file-edit text-blue-500"></i>
            <span>New Text File</span>
          </div>
          <div class="fc-confirm-body">
            <p class="mb-3">
              Create a new file in
              <strong>{{
                breadcrumbs.length > 0
                  ? breadcrumbs[breadcrumbs.length - 1]!.name
                  : "Root"
              }}</strong
              >.
            </p>

            <!-- Name + Extension row -->
            <label class="fc-nf-label">File name</label>
            <div class="fc-nf-name-row">
              <InputText
                ref="newFileInputRef"
                v-model="newFileBaseName"
                placeholder="my-script"
                size="small"
                class="fc-nf-name-input"
                @keydown.escape="cancelNewFile"
              />
              <span class="fc-nf-dot">.</span>
              <MSelect
                v-model="newFileExtension"
                :options="FILE_EXTENSIONS"
                option-label="label"
                option-value="value"
                size="small"
                class="fc-nf-ext-select"
              />
            </div>
            <p v-if="newFileBaseName.trim()" class="fc-nf-preview">
              <i class="pi pi-file text-blue-400 text-xs"></i>
              {{ newFileBaseName.trim() }}.{{ newFileExtension }}
            </p>

            <!-- Initial content -->
            <label class="fc-nf-label mt-3"
              >Initial content
              <span class="text-gray-400">(optional)</span></label
            >
            <textarea
              v-model="newFileContent"
              class="fc-nf-content"
              placeholder="// Start writing here..."
              rows="6"
              spellcheck="false"
            />
          </div>
          <div class="fc-confirm-actions">
            <Button
              size="small"
              severity="secondary"
              outlined
              @click="cancelNewFile"
              >Cancel</Button
            >
            <Button
              size="small"
              @click="executeNewFile"
              :loading="isCreatingFile"
              :disabled="!newFileBaseName.trim()"
            >
              <i class="pi pi-check text-xs mr-1"></i>
              Create
            </Button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts" setup>
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick
} from "vue";
import { callApi, ApiRequestType, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { Button, InputText, useToast } from "primevue";
import MSelect from "./universal/input/MSelect.vue";
import CodeViewer from "./CodeViewer.vue";
import FileCodeEditor from "./FileCodeEditor.vue";
import DiffViewer from "./DiffViewer.vue";
import DiffComparator from "./DiffComparator.vue";
import { getViewportBoundedMenuPosition } from "../utils/viewportPosition";
import {
  getVersionsForFile,
  saveVersion,
  wouldDropVersion,
  clearVersionHistory,
  getVersionContent,
  formatVersionDate,
  type FileVersion
} from "../utils/fileVersionsDb";
import { trashItem } from "../utils/fileCabinetTrashDb";
import {
  addBookmark,
  removeBookmark,
  getBookmarkByNetsuiteId,
  updateBookmarkExists,
  updateBookmarkName
} from "../utils/fileCabinetBookmarksDb";
import { upsertNotebookEntry } from "../utils/notebookDb";

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

// ── Props & Emits ──────────────────────────────────────────────────────────

const props = defineProps<{
  bookmarkedIds: Set<number>;
  currentEnvironment: string;
  /** If provided, the pane mounts directly to this folder instead of root. */
  initialFolderId?: number | null;
  /** If provided, the pane opens this file immediately after mounting. */
  initialFile?: {
    type: "file";
    id: number;
    name: string;
    filetype: string;
    filesize: number;
    folder: number;
    lastmodifieddate: string | null;
    url?: string;
  } | null;
  /** When true, shows an "Add" button on each file for context-picker usage. */
  contextPicker?: boolean;
  /** File IDs already attached to the harness context. */
  attachedFileIds?: Set<number>;
  /** File IDs currently being fetched for context attachment. */
  attachingFileIds?: Set<number>;
  /** Optional file type allowlist; folders remain visible for navigation. */
  allowedFileTypes?: Set<string>;
}>();

const emit = defineEmits<{
  (e: "bookmark-changed"): void;
  (e: "trash-changed"): void;
  (e: "label-change", label: string): void;
  (e: "folder-navigate", folderId: number | null): void;
  (e: "folder-info-change", info: FolderItem | null): void;
  (e: "file-change", file: FileItem | null): void;
  (e: "expand-folder", folderId: number): void;
  (e: "item-moved", dstFolderId: number): void;
  (e: "open-in-newtab", item: CabinetItem): void;
  (e: "add-to-context", item: FileItem): void;
}>();

const toast = useToast();

// ── State ──────────────────────────────────────────────────────────────────

const isLoading = ref(false);
const loadError = ref<string | null>(null);
const currentFolderId = ref<number | null>(null);
const breadcrumbs = ref<{ id: number; name: string }[]>([]);

const rootFolders = ref<FolderItem[]>([]);
const childFoldersCache = ref<Map<number | null, FolderItem[]>>(new Map());
const currentSubfolders = ref<FolderItem[]>([]);
const currentFiles = ref<FileItem[]>([]);
const currentFolderInfo = ref<FolderItem | null>(null);

const contentSearch = ref("");
const viewMode = ref<"grid" | "list">("list");
const sortField = ref<string>("name");
const sortDir = ref<"asc" | "desc">("asc");

const selectedItems = ref<CabinetItem[]>([]);
const detailItem = ref<CabinetItem | null>(null);

// ── Drag & drop upload ─────────────────────────────────────────────────────
const isDragOver = ref(false);
const isUploading = ref(false);
const uploadProgress = ref("");

// ── Item drag / move ───────────────────────────────────────────────────────
const dropTargetFolderId = ref<number | null>(null);
const isMoveLoading = ref(false);

// ── Inline rename ──────────────────────────────────────────────────────────
const renamingItemId = ref<number | null>(null);
const renameValue = ref("");
const isRenamingLoading = ref(false);

// ── Global search ──────────────────────────────────────────────────────────
const globalSearchQuery = ref("");
const globalSearchResults = ref<
  {
    id: number;
    name: string;
    path: string;
    type: "file" | "folder";
    url?: string;
    folder?: number;
    filetype?: string;
    filesize?: number;
  }[]
>([]);
const globalSearchLoading = ref(false);
const isNumericGlobalSearchQuery = computed(() =>
  /^\d+$/.test(globalSearchQuery.value.trim())
);

// ── Delete & Trash ─────────────────────────────────────────────────────────
const showDeleteConfirm = ref(false);
const deleteTargets = ref<CabinetItem[]>([]);
const deleteRecursive = ref(false);
const folderContentWarning = ref<string | null>(null);
const isDeleting = ref(false);

// ── Move confirm ────────────────────────────────────────────────────────────
const showMoveConfirm = ref(false);
const moveTargets = ref<CabinetItem[]>([]);
const moveDestFolder = ref<CabinetItem | null>(null);
const moveSrcFolderId = ref<number | null>(null);

type ContextMenuAction = {
  label: string;
  icon: string;
  handler: () => void;
  danger?: boolean;
};

const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  actions: [] as ContextMenuAction[]
});
const contextMenuRef = ref<HTMLElement | null>(null);

// ── Open File state ────────────────────────────────────────────────────────
const openedFile = ref<FileItem | null>(null);
const fileContent = ref<string | null>(null);
const fileContentType = ref<string>("");
const fileIsBinary = ref(false);
const fileLoading = ref(false);
const fileLoadError = ref<string | null>(null);
const pdfObjectUrl = ref<string | null>(null);

const previewContent = ref<string | null>(null);
const previewLoading = ref(false);
const previewError = ref(false);

// ── Detail panel resize ────────────────────────────────────────────────────
const detailPanelWidth = ref(240);
const isResizingPanel = ref(false);

// ── Edit mode ─────────────────────────────────────────────────────────────
const isEditing = ref(false);
const editorContent = ref("");
const isSaving = ref(false);
const hasUnsavedChanges = computed(
  () => editorContent.value !== fileContent.value
);

// Version history
const versionHistory = ref<FileVersion[]>([]);
const historyDropdownOpen = ref(false);
const selectedVersionId = ref<number | null>(null);
const selectedVersionContent = ref<string | null>(null);
const selectedVersionLabel = ref("");
const showingDiff = ref(false);

// Comparator
const showCompare = ref(false);
const compareA = ref("");
const compareB = ref("");
const compareKey = ref(0);

// Drop version confirm
const showDropConfirm = ref(false);
const dropConfirmDate = ref("");
let dropConfirmResolve: ((proceed: boolean) => void) | null = null;

const confirmDropCancel = () => {
  if (dropConfirmResolve) dropConfirmResolve(false);
};
const confirmDropProceed = () => {
  if (dropConfirmResolve) dropConfirmResolve(true);
};

// ── New folder ─────────────────────────────────────────────────────────────
const showNewFolderDialog = ref(false);
const newFolderName = ref("");
const isCreatingFolder = ref(false);
const newFolderInputRef = ref<any>(null);

// ── New file ───────────────────────────────────────────────────────────────
const showNewFileDialog = ref(false);
const newFileBaseName = ref("");
const newFileExtension = ref("js");
const newFileContent = ref("");
const isCreatingFile = ref(false);
const newFileInputRef = ref<any>(null);

const FILE_EXTENSIONS = [
  { label: "JavaScript (.js)", value: "js" },
  { label: "TypeScript (.ts)", value: "ts" },
  { label: "CSS (.css)", value: "css" },
  { label: "HTML (.html)", value: "html" },
  { label: "XML (.xml)", value: "xml" },
  { label: "JSON (.json)", value: "json" },
  { label: "Plain Text (.txt)", value: "txt" },
  { label: "CSV (.csv)", value: "csv" },
  { label: "SQL (.sql)", value: "sql" },
  { label: "FreeMarker (.ftl)", value: "ftl" },
  { label: "SHTML (.shtml)", value: "shtml" }
];

// ── File type helpers ──────────────────────────────────────────────────────

const TEXT_FILE_TYPES = new Set([
  "JAVASCRIPT",
  "TYPESCRIPT",
  "PLAINTEXT",
  "CSV",
  "XMLDOC",
  "HTMLDOC",
  "JSON",
  "STYLESHEET",
  "FREEMARKER",
  "SVGIMAGE",
  "CONFIG"
]);

const IMAGE_FILE_TYPES = new Set([
  "JPGIMAGE",
  "PNGIMAGE",
  "GIFIMAGE",
  "BMPIMAGE",
  "TIFFIMAGE",
  "ICON"
]);

const isTextFile = (item: FileItem) => TEXT_FILE_TYPES.has(item.filetype);
const isImageFile = (item: FileItem) => IMAGE_FILE_TYPES.has(item.filetype);
const isPdfFile = (item: FileItem) => item.filetype === "PDF";
const isPreviewable = (item: FileItem) =>
  isTextFile(item) || isImageFile(item) || item.filetype === "SVGIMAGE";

type FileEditorLanguage = "javascript" | "typescript" | "sql" | "json";

const getFileExtension = (name: string) =>
  name.toLowerCase().split(".").pop() ?? "";

const getCodeLanguage = (item: FileItem): FileEditorLanguage => {
  const ext = getFileExtension(item.name);
  if (item.filetype === "JSON" || ext === "json") return "json";
  if (ext === "sql") return "sql";
  return "javascript";
};

// ── Computed ───────────────────────────────────────────────────────────────

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
  if (props.allowedFileTypes?.size) {
    items = items.filter(
      (item) =>
        item.type === "folder" ||
        props.allowedFileTypes!.has((item as FileItem).filetype)
    );
  }
  if (contentSearch.value) {
    const q = contentSearch.value.trim().toLowerCase();
    items = items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) || String(item.id).includes(q)
    );
  }
  items = [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    let cmp = 0;
    if (sortField.value === "name") {
      cmp = a.name.localeCompare(b.name);
    } else if (sortField.value === "fileType") {
      const aType =
        a.type === "folder" ? "Folder" : (a as FileItem).filetype || "";
      const bType =
        b.type === "folder" ? "Folder" : (b as FileItem).filetype || "";
      cmp = aType.localeCompare(bType);
    } else if (sortField.value === "size") {
      const aSize =
        a.type === "folder"
          ? (a as FolderItem).foldersize
          : (a as FileItem).filesize;
      const bSize =
        b.type === "folder"
          ? (b as FolderItem).foldersize
          : (b as FileItem).filesize;
      cmp = (aSize || 0) - (bSize || 0);
    } else if (sortField.value === "lastmodifieddate") {
      cmp = (a.lastmodifieddate || "").localeCompare(b.lastmodifieddate || "");
    }
    return sortDir.value === "asc" ? cmp : -cmp;
  });
  return items;
});

const folderCount = computed(
  () => allItems.value.filter((i) => i.type === "folder").length
);
const fileCount = computed(
  () => allItems.value.filter((i) => i.type === "file").length
);

// ── SuiteQL ────────────────────────────────────────────────────────────────

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

const mapFolderRow = (r: any): FolderItem => ({
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
});

const fetchRootFolders = async () => {
  const rows = await runQuery(`
    SELECT id, name, parent, foldertype, numFolderFiles, folderSize, lastModifiedDate, description
    FROM MediaItemFolder WHERE parent IS NULL ORDER BY name
  `);
  rootFolders.value = rows.map(mapFolderRow);
};

const fetchFolderInfo = async (
  folderId: number
): Promise<FolderItem | null> => {
  const rows = await runQuery(`
    SELECT id, name, parent, foldertype, numFolderFiles, folderSize, lastModifiedDate, description
    FROM MediaItemFolder WHERE id = ${folderId} AND ROWNUM <= 1
  `);
  return rows.length > 0 ? mapFolderRow(rows[0]) : null;
};

const fetchChildFolders = async (parentId: number): Promise<FolderItem[]> => {
  if (childFoldersCache.value.has(parentId)) {
    return childFoldersCache.value.get(parentId)!;
  }
  const rows = await runQuery(`
    SELECT id, name, parent, foldertype, numFolderFiles, folderSize, lastModifiedDate, description
    FROM MediaItemFolder WHERE parent = ${parentId} ORDER BY name
  `);
  const children: FolderItem[] = rows.map(mapFolderRow);
  childFoldersCache.value.set(parentId, children);
  return children;
};

const fetchFiles = async (folderId: number): Promise<FileItem[]> => {
  const rows = await runQuery(`
    SELECT id, name, fileType, fileSize, folder, lastModifiedDate, createdDate, description, url
    FROM File WHERE folder = ${folderId} ORDER BY name
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
  for (let i = 0; i < 20 && current !== null; i++) {
    const rootMatch = rootFolders.value.find((f) => f.id === current);
    if (rootMatch) {
      crumbs.unshift({ id: rootMatch.id, name: rootMatch.name });
      break;
    }
    const rows = await runQuery(
      `SELECT id, name, parent FROM MediaItemFolder WHERE id = ${current} AND ROWNUM <= 1`
    );
    if (rows.length === 0) break;
    crumbs.unshift({ id: rows[0].id, name: rows[0].name });
    current = rows[0].parent;
  }
  breadcrumbs.value = crumbs;
};

// ── Navigation ─────────────────────────────────────────────────────────────

const navigateToFolder = async (folderId: number | null) => {
  openedFile.value = null;
  emit("file-change", null);
  fileContent.value = null;
  fileLoadError.value = null;
  isLoading.value = true;
  loadError.value = null;
  selectedItems.value = [];
  detailItem.value = null;
  contentSearch.value = "";
  currentFolderInfo.value = null;

  // Invalidate only this folder's cache so breadcrumb clicks always show fresh contents
  if (folderId !== null) childFoldersCache.value.delete(folderId);

  try {
    currentFolderId.value = folderId;
    if (folderId === null) {
      await fetchRootFolders();
      currentSubfolders.value = rootFolders.value;
      currentFiles.value = [];
      breadcrumbs.value = [];
      currentFolderInfo.value = null;
    } else {
      const [folderInfo, folders, files] = await Promise.all([
        fetchFolderInfo(folderId),
        fetchChildFolders(folderId),
        fetchFiles(folderId)
      ]);
      currentFolderInfo.value = folderInfo;
      currentSubfolders.value = folders;
      currentFiles.value = files;
      await buildBreadcrumbs(folderId);
    }
  } catch (err: any) {
    loadError.value = err.message || "Failed to load folder contents";
  } finally {
    isLoading.value = false;
  }

  emit("folder-navigate", folderId);
  emit("folder-info-change", currentFolderInfo.value);
  updateLabel();
};

const refreshCurrentFolder = async () => {
  childFoldersCache.value.clear();
  await navigateToFolder(currentFolderId.value);
};

// ── File content ───────────────────────────────────────────────────────────

const fetchFileContent = async (file: FileItem) => {
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

const searchResultToFileItem = (
  result: (typeof globalSearchResults.value)[0]
): FileItem => ({
  type: "file",
  id: result.id,
  name: result.name,
  filetype: result.filetype || "",
  filesize: result.filesize || 0,
  folder: result.folder || 0,
  lastmodifieddate: null,
  url: result.url
});

const addSearchResultToContext = (
  result: (typeof globalSearchResults.value)[0]
) => {
  if (result.type !== "file") return;
  emit("add-to-context", searchResultToFileItem(result));
  globalSearchQuery.value = "";
  globalSearchResults.value = [];
};

const openFile = async (file: FileItem) => {
  if (props.contextPicker) {
    emit("add-to-context", file);
    return;
  }
  if (!file.url) {
    toast.add({
      severity: "warn",
      summary: "No URL",
      detail: "This file has no accessible URL",
      life: 3000
    });
    return;
  }
  openedFile.value = file;
  emit("file-change", file);
  fileContent.value = null;
  fileIsBinary.value = false;
  fileContentType.value = "";
  fileLoadError.value = null;
  fileLoading.value = true;
  isEditing.value = false;
  editorContent.value = "";
  showingDiff.value = false;
  showCompare.value = false;
  compareA.value = "";
  compareB.value = "";
  selectedVersionContent.value = null;
  selectedVersionId.value = null;
  historyDropdownOpen.value = false;
  if (pdfObjectUrl.value) {
    URL.revokeObjectURL(pdfObjectUrl.value);
    pdfObjectUrl.value = null;
  }
  updateLabel();

  try {
    const result = await fetchFileContent(file);
    if (result) {
      fileContent.value = result.content;
      fileContentType.value = result.contentType;
      fileIsBinary.value = result.binary;
      editorContent.value = result.content;
      if (result.binary && isPdfFile(file)) {
        try {
          const base64 = result.content.replace(/^data:[^;]+;base64,/, "");
          const raw = atob(base64);
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          const blob = new Blob([bytes], { type: "application/pdf" });
          pdfObjectUrl.value = URL.createObjectURL(blob);
        } catch {
          /* leave pdfObjectUrl null */
        }
      }
    }
    await loadVersionHistory(file.id);
  } catch (err: any) {
    fileLoadError.value = err.message || "Failed to load file";
  } finally {
    fileLoading.value = false;
  }
};

const closeFile = () => {
  openedFile.value = null;
  emit("file-change", null);
  fileContent.value = null;
  fileLoadError.value = null;
  isEditing.value = false;
  editorContent.value = "";
  showingDiff.value = false;
  showCompare.value = false;
  compareA.value = "";
  compareB.value = "";
  selectedVersionContent.value = null;
  selectedVersionId.value = null;
  historyDropdownOpen.value = false;
  versionHistory.value = [];
  if (pdfObjectUrl.value) {
    URL.revokeObjectURL(pdfObjectUrl.value);
    pdfObjectUrl.value = null;
  }
  updateLabel();
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
        previewContent.value = result.content;
      } else {
        const trimmed = result.content.trimStart();
        const isHtmlPage =
          /^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
        if (isHtmlPage) {
          previewContent.value = null;
          previewError.value = true;
          return;
        }
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

// ── Edit / Save / History ──────────────────────────────────────────────────

const loadVersionHistory = async (fileId: number) => {
  versionHistory.value = await getVersionsForFile(fileId);
};

const saveFile = async () => {
  if (!openedFile.value || isSaving.value || !hasUnsavedChanges.value) return;
  const file = openedFile.value;
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
    if (fileContent.value !== null)
      await saveVersion(file.id, file.name, fileContent.value);
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
    if (result?.isUpdated === false)
      throw new Error("NetSuite returned failure status");
    fileContent.value = editorContent.value;
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
  if (historyDropdownOpen.value && openedFile.value)
    loadVersionHistory(openedFile.value.id);
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
    detail: `${count} version${count !== 1 ? "s" : ""} removed.`,
    life: 4000
  });
};

// ── Comparator ─────────────────────────────────────────────────────────────

const openCompare = () => {
  showingDiff.value = false;
  compareA.value = fileContent.value ?? "";
  compareB.value = "";
  compareKey.value++;
  showCompare.value = true;
};

const closeCompare = () => {
  showCompare.value = false;
};

const loadCompareFromClipboard = async () => {
  try {
    const text = await navigator.clipboard.readText();
    compareB.value = text;
    compareKey.value++;
  } catch {
    toast.add({
      severity: "warn",
      summary: "Clipboard unavailable",
      detail: "Grant clipboard permission and try again",
      life: 3000
    });
  }
};

const swapCompare = () => {
  const tmp = compareA.value;
  compareA.value = compareB.value;
  compareB.value = tmp;
  compareKey.value++;
};

// ── Selection ──────────────────────────────────────────────────────────────

const isSelected = (item: CabinetItem) =>
  selectedItems.value.some((s) => s.type === item.type && s.id === item.id);

const handleItemClick = (item: CabinetItem, event: MouseEvent) => {
  if (renamingItemId.value === item.id) return;
  if (event.ctrlKey || event.metaKey) {
    const idx = selectedItems.value.findIndex(
      (s) => s.type === item.type && s.id === item.id
    );
    if (idx >= 0) selectedItems.value.splice(idx, 1);
    else selectedItems.value.push(item);
  } else if (isSelected(item) && selectedItems.value.length > 1) {
    // Standard file-manager rule: clicking an already-selected item inside a
    // multi-selection does NOT replace the selection — this lets the user drag
    // the whole group without accidentally reducing it to one item.
  } else {
    selectedItems.value = [item];
  }
  if (!props.contextPicker) detailItem.value = item;
};

const handleItemDblClick = (item: CabinetItem) => {
  if (item.type === "folder") {
    navigateToFolder(item.id);
    emit("expand-folder", item.id);
  } else if (!props.contextPicker) {
    openFile(item as FileItem);
  }
};

const showContextMenuAt = (event: MouseEvent, actions: ContextMenuAction[]) => {
  const cursorX = event.clientX;
  const cursorY = event.clientY;
  contextMenu.value = { visible: true, x: cursorX, y: cursorY, actions };

  void nextTick(() => {
    if (!contextMenuRef.value || !contextMenu.value.visible) return;
    const position = getViewportBoundedMenuPosition(
      cursorX,
      cursorY,
      contextMenuRef.value
    );
    contextMenu.value.x = position.x;
    contextMenu.value.y = position.y;
  });
};

const handleItemContext = (item: CabinetItem, event: MouseEvent) => {
  selectedItems.value = [item];
  if (!props.contextPicker) detailItem.value = item;

  if (props.contextPicker) {
    const actions: ContextMenuAction[] = [];
    if (item.type === "folder") {
      actions.push({
        label: "Open Folder",
        icon: "pi pi-folder-open",
        handler: () => navigateToFolder(item.id)
      });
    } else {
      const attached = props.attachedFileIds?.has(item.id);
      actions.push({
        label: attached ? "Queued for send" : "Add to context",
        icon: attached ? "pi pi-check" : "pi pi-plus",
        handler: () => {
          if (!attached) emit("add-to-context", item as FileItem);
        }
      });
    }
    showContextMenuAt(event, actions);
    return;
  }

  const actions: ContextMenuAction[] = [];
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
    if (item.id > 0)
      actions.push({
        label: "Rename",
        icon: "pi pi-pencil",
        handler: () => startRename(item)
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
        label: "Open in NetSuite",
        icon: "pi pi-external-link",
        handler: () => window.open(getNetsuiteEditUrl(item), "_blank")
      });
      actions.push({
        label: "Copy URL",
        icon: "pi pi-link",
        handler: () => copyToClipboard(item.url!)
      });
      if (isTextFile(item as FileItem)) {
        actions.push({
          label: "Compare",
          icon: "pi pi-arrows-h",
          handler: async () => {
            await openFile(item as FileItem);
            openCompare();
          }
        });
      }
    }
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
  actions.push({
    label: "Save to Notebook",
    icon: "pi pi-bookmark",
    handler: () => saveFileCabinetItemToNotebook(item)
  });
  const alreadyBookmarked = props.bookmarkedIds.has(item.id);
  actions.push({
    label: alreadyBookmarked ? "Remove Bookmark" : "Add Bookmark",
    icon: alreadyBookmarked ? "pi pi-bookmark-fill" : "pi pi-bookmark",
    handler: () => toggleBookmark(item)
  });
  if (item.id > 0) {
    actions.push({
      label: "Delete",
      icon: "pi pi-trash text-red-500",
      handler: () => confirmDeleteItem(item),
      danger: true
    });
  }
  showContextMenuAt(event, actions);
};

const saveFileCabinetItemToNotebook = async (item: CabinetItem) => {
  await upsertNotebookEntry({
    type: "file",
    title: item.name,
    summary:
      item.type === "folder"
        ? "File Cabinet folder"
        : `${(item as FileItem).filetype || "File"} · #${item.id}`,
    body: [
      `Type: ${item.type}`,
      `Internal ID: ${item.id}`,
      item.type === "folder"
        ? `Parent: ${(item as FolderItem).parent ?? "Root"}`
        : `Folder: ${(item as FileItem).folder}`,
      item.description ? `Description: ${item.description}` : ""
    ]
      .filter(Boolean)
      .join("\n"),
    url:
      item.type === "file"
        ? ((item as FileItem).url ?? "")
        : getNetsuiteEditUrl(item),
    netsuiteId: String(item.id),
    filePath: item.name,
    group: "File Cabinet",
    tags: ["file-cabinet", item.type, item.name],
    pinned: true
  });
  toast.add({
    severity: "success",
    summary: "Saved to Notebook",
    detail: item.name,
    life: 2200
  });
};

const handleBodyContextMenu = (event: MouseEvent) => {
  if (props.contextPicker) return;
  // Only show when right-clicking on the empty background (not on an item)
  const target = event.target as HTMLElement;
  const isOnItem = target.closest(".fc-grid-item, .fc-table-row");
  if (isOnItem) return;
  const actions: ContextMenuAction[] = [
    {
      label: "New Folder",
      icon: "pi pi-folder-plus",
      handler: () => openNewFolderDialog()
    },
    {
      label: "New File",
      icon: "pi pi-file-edit",
      handler: () => openNewFileDialog()
    }
  ];
  if (currentFolderId.value !== null) {
    actions.push({
      label: "Copy Folder ID",
      icon: "pi pi-copy",
      handler: () => copyToClipboard(String(currentFolderId.value))
    });
  }
  showContextMenuAt(event, actions);
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
  nextTick(() => {
    const inp = document.querySelector<HTMLInputElement>(".fc-rename-input");
    if (!inp) return;
    inp.focus();
    if (item.type === "file") {
      const dot = item.name.lastIndexOf(".");
      const pos = dot > 0 ? dot : item.name.length;
      inp.setSelectionRange(pos, pos);
    } else {
      inp.setSelectionRange(inp.value.length, inp.value.length);
    }
  });
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
        {
          fileId: fi.id,
          newName,
          folderId: fi.folder,
          filetype: fi.filetype || "",
          filesize: fi.filesize || 0
        },
        ApiRequestType.NORMAL
      );
      const fileItem = currentFiles.value.find((f) => f.id === fi.id);
      if (fileItem) fileItem.name = newName;
    }
    if (detailItem.value?.id === item.id)
      detailItem.value = { ...detailItem.value, name: newName };
    // Sync bookmark name if this item is bookmarked
    if (props.currentEnvironment && props.currentEnvironment !== "unknown") {
      const bm = await getBookmarkByNetsuiteId(
        props.currentEnvironment,
        item.id
      );
      if (bm?.id !== undefined) {
        await updateBookmarkName(bm.id, newName);
        emit("bookmark-changed");
      }
    }
    toast.add({
      severity: "success",
      summary: "Renamed",
      detail: newName,
      life: 2000
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    toast.add({
      severity: "error",
      summary: "Rename Failed",
      detail: msg,
      life: 3500
    });
  } finally {
    isRenamingLoading.value = false;
    renamingItemId.value = null;
    renameValue.value = "";
  }
};

// ── Bookmarks ──────────────────────────────────────────────────────────────

const toggleBookmark = async (item: CabinetItem) => {
  if (!props.currentEnvironment || props.currentEnvironment === "unknown")
    return;
  const existing = await getBookmarkByNetsuiteId(
    props.currentEnvironment,
    item.id
  );
  if (existing) {
    await removeBookmark(existing.id!);
    toast.add({
      severity: "info",
      summary: "Bookmark Removed",
      detail: item.name,
      life: 2000
    });
  } else {
    const parentFolderId =
      item.type === "folder"
        ? ((item as FolderItem).parent ?? null)
        : (item as FileItem).folder;
    const isCurrentFolder =
      item.type === "folder" && item.id === currentFolderId.value;
    const parentCrumbIndex = isCurrentFolder
      ? breadcrumbs.value.length - 2
      : breadcrumbs.value.length - 1;
    const parentFolderName =
      parentCrumbIndex >= 0
        ? breadcrumbs.value[parentCrumbIndex]!.name
        : "Root";
    const newBmId = await addBookmark({
      environment: props.currentEnvironment,
      itemType: item.type,
      netsuiteId: item.id,
      name: item.name,
      parentFolderId,
      parentFolderName,
      filetype: item.type === "file" ? (item as FileItem).filetype : undefined,
      url: item.type === "file" ? (item as FileItem).url : undefined
    });
    try {
      const table = item.type === "file" ? "File" : "MediaItemFolder";
      const rows = await runQuery(
        `SELECT id FROM ${table} WHERE id = ${item.id}`
      );
      await updateBookmarkExists(newBmId, rows.length > 0);
    } catch {
      /* skip */
    }
    toast.add({
      severity: "success",
      summary: "Bookmarked",
      detail: item.name,
      life: 2000
    });
  }
  emit("bookmark-changed");
};

const toggleBookmarkFromSearchResult = async (
  result: (typeof globalSearchResults.value)[0]
) => {
  if (!props.currentEnvironment || props.currentEnvironment === "unknown")
    return;
  const existing = await getBookmarkByNetsuiteId(
    props.currentEnvironment,
    result.id
  );
  if (existing) {
    await removeBookmark(existing.id!);
    toast.add({
      severity: "info",
      summary: "Bookmark Removed",
      detail: result.name,
      life: 2000
    });
  } else {
    const newBmId = await addBookmark({
      environment: props.currentEnvironment,
      itemType: result.type,
      netsuiteId: result.id,
      name: result.name,
      parentFolderId: result.folder ?? null,
      parentFolderName: result.path || "Root",
      filetype: result.type === "file" ? result.filetype : undefined,
      url: result.type === "file" ? result.url : undefined
    });
    try {
      const table = result.type === "file" ? "File" : "MediaItemFolder";
      const rows = await runQuery(
        `SELECT id FROM ${table} WHERE id = ${result.id}`
      );
      await updateBookmarkExists(newBmId, rows.length > 0);
    } catch {
      /* skip */
    }
    toast.add({
      severity: "success",
      summary: "Bookmarked",
      detail: result.name,
      life: 2000
    });
  }
  emit("bookmark-changed");
};

const toggleSort = (field: string) => {
  if (sortField.value === field)
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  else {
    sortField.value = field;
    sortDir.value = "asc";
  }
};

// ── Formatting ─────────────────────────────────────────────────────────────

const getNetsuiteEditUrl = (item: CabinetItem): string => {
  const env =
    props.currentEnvironment !== "unknown"
      ? props.currentEnvironment
      : "system.netsuite.com";
  if (item.type === "file")
    return `https://${env}/app/common/media/mediaitem.nl?id=${item.id}&e=T`;
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
  if (props.contextPicker) return;
  event.preventDefault();
  if (event.dataTransfer?.types.includes("Files")) {
    isDragOver.value = true;
  } else if (
    event.dataTransfer?.types.includes("application/fc-item") &&
    currentFolderId.value !== null
  ) {
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }
};

const handleDragLeave = (event: DragEvent) => {
  if (props.contextPicker) return;
  const related = event.relatedTarget as Node | null;
  const target = event.currentTarget as HTMLElement;
  if (!related || !target.contains(related)) isDragOver.value = false;
};

const handleDrop = async (event: DragEvent) => {
  if (props.contextPicker) return;
  event.preventDefault();
  isDragOver.value = false;

  // Item-move drop: item was dragged from grid/list onto empty folder space
  const fcItemJson = event.dataTransfer?.getData("application/fc-item");
  if (fcItemJson) {
    if (currentFolderId.value !== null) {
      const currentName =
        breadcrumbs.value.length > 0
          ? breadcrumbs.value[breadcrumbs.value.length - 1]!.name
          : "Root";
      const targetFolder: FolderItem = {
        type: "folder",
        id: currentFolderId.value,
        name: currentName,
        parent: null,
        foldertype: "DEFAULT",
        numfolderfiles: 0,
        foldersize: 0,
        lastmodifieddate: null
      };
      await handleMoveItemDrop(targetFolder, event);
    }
    return;
  }

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
      if (result?.uploaded?.length > 0) uploaded.push(file.name);
      else errors.push(file.name);
    }
    if (uploaded.length > 0) {
      toast.add({
        severity: "success",
        summary: "Upload Complete",
        detail: `${uploaded.length} file${uploaded.length > 1 ? "s" : ""} uploaded`,
        life: 3000
      });
      await refreshCurrentFolder();
    }
    if (errors.length > 0)
      toast.add({
        severity: "error",
        summary: "Upload Errors",
        detail: `Failed: ${errors.join(", ")}`,
        life: 5000
      });
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

// ── Item drag / move handlers ───────────────────────────────────────────────

const handleItemDragStart = (item: CabinetItem, event: DragEvent) => {
  if (event.dataTransfer) {
    // Snapshot the full selection at drag-start so drop handlers always
    // receive the correct item list regardless of any later state changes.
    const isInSelection = selectedItems.value.some(
      (s) => s.type === item.type && s.id === item.id
    );
    const itemsToDrag: CabinetItem[] =
      isInSelection && selectedItems.value.length > 1
        ? [...selectedItems.value]
        : [item];
    event.dataTransfer.setData("application/fc-item", JSON.stringify(item));
    event.dataTransfer.setData(
      "application/fc-items",
      JSON.stringify(itemsToDrag)
    );
    // Snapshot the source folder so cross-pane drops use the right srcFolderId.
    event.dataTransfer.setData(
      "application/fc-srcfolder",
      String(currentFolderId.value ?? "")
    );
    event.dataTransfer.effectAllowed = "move";
  }
};

const handleItemDragEnd = () => {
  dropTargetFolderId.value = null;
};

const handleFolderDragOver = (folder: CabinetItem, event: DragEvent) => {
  if (folder.type !== "folder") return;
  if (!event.dataTransfer?.types.includes("application/fc-item")) return;
  event.dataTransfer.dropEffect = "move";
  dropTargetFolderId.value = folder.id;
};

const handleFolderDragLeave = () => {
  dropTargetFolderId.value = null;
};

const handleMoveItemDrop = (targetFolder: CabinetItem, event: DragEvent) => {
  dropTargetFolderId.value = null;
  if (targetFolder.type !== "folder") return;
  const itemJson = event.dataTransfer?.getData("application/fc-item");
  if (!itemJson) return;
  let draggedItem: CabinetItem;
  try {
    draggedItem = JSON.parse(itemJson);
  } catch {
    return;
  }

  const itemsJson = event.dataTransfer?.getData("application/fc-items");
  let itemsToMove: CabinetItem[];
  if (itemsJson) {
    try {
      itemsToMove = JSON.parse(itemsJson);
    } catch {
      itemsToMove = [draggedItem];
    }
  } else {
    itemsToMove = [draggedItem];
  }

  const filtered = itemsToMove.filter((item) => {
    if (item.id === targetFolder.id) return false;
    const itemSrcFolder =
      item.type === "folder"
        ? ((item as FolderItem).parent ?? currentFolderId.value)
        : (item as FileItem).folder;
    return itemSrcFolder !== targetFolder.id;
  });
  if (filtered.length === 0) return;

  const srcFolderSnap = event.dataTransfer?.getData("application/fc-srcfolder");
  const srcFolderId = srcFolderSnap
    ? Number(srcFolderSnap)
    : filtered[0]!.type === "file"
      ? (filtered[0] as FileItem).folder
      : ((filtered[0] as FolderItem).parent ?? currentFolderId.value);

  // Stage and show confirm popup (same pattern as delete)
  moveTargets.value = filtered;
  moveDestFolder.value = targetFolder;
  moveSrcFolderId.value = srcFolderId;
  showMoveConfirm.value = true;
};

const cancelMove = () => {
  showMoveConfirm.value = false;
  moveTargets.value = [];
  moveDestFolder.value = null;
  moveSrcFolderId.value = null;
};

const executeMove = async () => {
  const filtered = moveTargets.value;
  const targetFolder = moveDestFolder.value;
  const srcFolderId = moveSrcFolderId.value;
  if (!filtered.length || !targetFolder || srcFolderId === null) return;

  showMoveConfirm.value = false;
  const fileIds = filtered.filter((i) => i.type === "file").map((i) => i.id);
  const folderIds = filtered
    .filter((i) => i.type === "folder")
    .map((i) => i.id);

  isMoveLoading.value = true;
  try {
    await callApi(
      RequestRoutes.MOVE_ITEMS,
      { srcFolderId, dstFolderId: targetFolder.id, fileIds, folderIds },
      ApiRequestType.NORMAL
    );
    const label =
      filtered.length === 1 ? filtered[0]!.name : `${filtered.length} items`;
    toast.add({
      severity: "success",
      summary: "Moved",
      detail: `${label} → ${targetFolder.name}`,
      life: 3000
    });
    emit("item-moved", targetFolder.id);
    await refreshCurrentFolder();
  } catch (err: any) {
    toast.add({
      severity: "error",
      summary: "Move Failed",
      detail: err.message || "Failed to move item",
      life: 5000
    });
  } finally {
    isMoveLoading.value = false;
    moveTargets.value = [];
    moveDestFolder.value = null;
    moveSrcFolderId.value = null;
  }
};

// ── Global search ──────────────────────────────────────────────────────────

let searchDebounce: ReturnType<typeof setTimeout> | null = null;
const isNumericSearchText = (value: string) => /^\d+$/.test(value.trim());

const handleGlobalSearch = () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  const q = globalSearchQuery.value.trim();
  const isNumericQuery = isNumericSearchText(q);
  if (!q || (!isNumericQuery && q.length < 3)) {
    globalSearchResults.value = [];
    return;
  }
  searchDebounce = setTimeout(() => executeGlobalSearch(q), 500);
};

const executeGlobalSearch = async (query: string) => {
  globalSearchLoading.value = true;
  try {
    const escaped = query.replace(/'/g, "''");
    const numericId = isNumericSearchText(query) ? Number(query) : null;
    const fileWhere = numericId !== null
      ? `(LOWER(f.name) LIKE LOWER('%${escaped}%') OR f.id = ${numericId})`
      : `LOWER(f.name) LIKE LOWER('%${escaped}%')`;
    const folderWhere = numericId !== null
      ? `(LOWER(name) LIKE LOWER('%${escaped}%') OR id = ${numericId})`
      : `LOWER(name) LIKE LOWER('%${escaped}%')`;
    const [fileRows, folderRows] = await Promise.all([
      runQuery(
        `SELECT f.id, f.name, f.folder, f.url, f.fileType, f.fileSize, mf.name AS foldername FROM File f LEFT JOIN MediaItemFolder mf ON f.folder = mf.id WHERE ${fileWhere} AND ROWNUM <= 30`
      ),
      runQuery(
        `SELECT id, name, parent FROM MediaItemFolder WHERE ${folderWhere} AND ROWNUM <= 15`
      )
    ]);
    const results: typeof globalSearchResults.value = [];
    for (const folder of folderRows) {
      if (!folder?.id) continue;
      results.push({
        id: Number(folder.id),
        name: folder.name || "Unnamed",
        path: folder.parent ? `(parent: ${folder.parent})` : "(root)",
        type: "folder"
      });
    }
    for (const file of fileRows) {
      if (!file?.id) continue;
      const filetype = file.filetype || undefined;
      if (props.allowedFileTypes?.size && !props.allowedFileTypes.has(filetype || ""))
        continue;
      results.push({
        id: Number(file.id),
        name: file.name || "Unnamed",
        path: file.foldername
          ? `/${file.foldername}/`
          : `(folder: ${file.folder})`,
        type: "file",
        url: file.url || undefined,
        folder: file.folder ? Number(file.folder) : undefined,
        filetype,
        filesize: file.filesize ? Number(file.filesize) : undefined
      });
    }
    globalSearchResults.value = results;
  } catch {
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

const handleSearchResultClick = async (
  result: (typeof globalSearchResults.value)[0]
) => {
  if (props.contextPicker && result.type === "file") {
    addSearchResultToContext(result);
    return;
  }
  globalSearchQuery.value = "";
  globalSearchResults.value = [];
  if (result.type === "folder") {
    navigateToFolder(result.id);
  } else {
    if (result.folder) await navigateToFolder(result.folder);
    openFile(searchResultToFileItem(result));
  }
};

const clearGlobalSearch = () => {
  globalSearchQuery.value = "";
  globalSearchResults.value = [];
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
    await refreshCurrentFolder();
    if (parentFolder !== null) emit("expand-folder", parentFolder);
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

// ── New File ───────────────────────────────────────────────────────────────

const openNewFileDialog = () => {
  newFileBaseName.value = "";
  newFileContent.value = "";
  newFileExtension.value = "js";
  showNewFileDialog.value = true;
  nextTick(() => {
    const el = newFileInputRef.value?.$el ?? newFileInputRef.value;
    el?.focus?.();
  });
};

const cancelNewFile = () => {
  showNewFileDialog.value = false;
  newFileBaseName.value = "";
  newFileContent.value = "";
};

const executeNewFile = async () => {
  const baseName = newFileBaseName.value.trim();
  if (!baseName) return;
  const fileName = `${baseName}.${newFileExtension.value}`;
  isCreatingFile.value = true;
  try {
    const folderId = currentFolderId.value ?? -15;
    const response = await callApi(
      RequestRoutes.UPLOAD_FILE,
      { fileName, fileContent: newFileContent.value, folderId },
      ApiRequestType.NORMAL
    );
    const result = (response as ApiResponse)?.message || response;
    if (!result?.uploaded?.length)
      throw new Error("NetSuite did not confirm the upload");
    showNewFileDialog.value = false;
    newFileBaseName.value = "";
    newFileContent.value = "";
    toast.add({
      severity: "success",
      summary: "File Created",
      detail: `"${fileName}" created`,
      life: 3000
    });
    await refreshCurrentFolder();
  } catch (err: any) {
    toast.add({
      severity: "error",
      summary: "Create Failed",
      detail: err.message || "Failed to create file",
      life: 5000
    });
  } finally {
    isCreatingFile.value = false;
  }
};

// ── Delete & Trash ─────────────────────────────────────────────────────────

const confirmDeleteItem = async (item: CabinetItem) => {
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
  if (item.type === "folder") await checkFolderContents([item as FolderItem]);
  showDeleteConfirm.value = true;
};

const confirmBulkDelete = async () => {
  const eligible = selectedItems.value.filter((i) => i.id > 0);
  const skipped = selectedItems.value.length - eligible.length;
  if (skipped > 0 && eligible.length === 0) {
    toast.add({
      severity: "warn",
      summary: "Cannot Delete",
      detail:
        "Selected items include only system folders which cannot be deleted.",
      life: 4000
    });
    return;
  }
  deleteTargets.value = eligible;
  deleteRecursive.value = false;
  folderContentWarning.value = null;
  const folders = deleteTargets.value.filter(
    (t) => t.type === "folder"
  ) as FolderItem[];
  if (folders.length > 0) await checkFolderContents(folders);
  showDeleteConfirm.value = true;
};

const checkFolderContents = async (folders: FolderItem[]) => {
  try {
    const ids = folders.map((f) => f.id).join(",");
    const [fileRows, subRows] = await Promise.all([
      runQuery(
        `SELECT folder, COUNT(*) AS cnt FROM File WHERE folder IN (${ids}) GROUP BY folder`
      ),
      runQuery(
        `SELECT parent, COUNT(*) AS cnt FROM MediaItemFolder WHERE parent IN (${ids}) GROUP BY parent`
      )
    ]);
    let totalFiles = 0;
    let totalSubfolders = 0;
    for (const r of fileRows) totalFiles += Number(r.cnt);
    for (const r of subRows) totalSubfolders += Number(r.cnt);
    if (totalFiles > 0 || totalSubfolders > 0) {
      const parts: string[] = [];
      if (totalFiles > 0)
        parts.push(`${totalFiles} file${totalFiles !== 1 ? "s" : ""}`);
      if (totalSubfolders > 0)
        parts.push(
          `${totalSubfolders} subfolder${totalSubfolders !== 1 ? "s" : ""}`
        );
      folderContentWarning.value = `Contains ${parts.join(" and ")} — all will be saved to trash.`;
    }
  } catch {
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
  const folderName =
    breadcrumbs.value.length > 0
      ? breadcrumbs.value[breadcrumbs.value.length - 1]!.name
      : "Root";
  const errors: string[] = [];
  const preparedItems: CabinetItem[] = [];
  const filesToDelete: { fileId: number; folderId: number }[] = [];
  const folderIdsToDelete: number[] = [];

  try {
    for (const item of items) {
      try {
        if (item.type === "folder") {
          const snapshot = await buildFolderSnapshot(item.id);
          await trashItem({
            environment: props.currentEnvironment,
            itemType: "folder",
            netsuiteId: item.id,
            name: item.name,
            originalFolderId: (item as FolderItem).parent,
            originalFolderName: folderName,
            content: JSON.stringify(snapshot),
            fileType: null,
            fileSize: null
          });
          await collectNetsuiteRecursiveDelete(
            item.id,
            filesToDelete,
            folderIdsToDelete
          );
          folderIdsToDelete.push(item.id);
        } else {
          let content: string | null = null;
          if (isTextFile(item as FileItem)) {
            try {
              const resp = await callApi(
                RequestRoutes.FETCH_FILE_CONTENT,
                { fileUrl: (item as FileItem).url },
                ApiRequestType.NORMAL
              );
              const result = (resp as ApiResponse)?.message || resp;
              if (result?.content && !result?.binary) content = result.content;
            } catch {
              /* best effort */
            }
          }
          await trashItem({
            environment: props.currentEnvironment,
            itemType: "file",
            netsuiteId: item.id,
            name: item.name,
            originalFolderId: (item as FileItem).folder,
            originalFolderName: folderName,
            content,
            fileType: (item as FileItem).filetype,
            fileSize: (item as FileItem).filesize
          });
          filesToDelete.push({
            fileId: item.id,
            folderId: (item as FileItem).folder
          });
        }
        preparedItems.push(item);
      } catch (err: any) {
        errors.push(`${item.name}: ${err.message || "failed"}`);
      }
    }

    if (filesToDelete.length > 0 || folderIdsToDelete.length > 0) {
      const response = await callApi(
        RequestRoutes.BATCH_DELETE_FILE_CABINET_ITEMS,
        { files: filesToDelete, folderIds: folderIdsToDelete },
        ApiRequestType.NORMAL
      );
      const result = (response as ApiResponse)?.message || response;
      for (const error of result?.errors || []) {
        errors.push(
          `${error.type} ${error.id}: ${error.error || "failed"}`
        );
      }
    }

    emit("trash-changed");
    if (preparedItems.length > 0)
      toast.add({
        severity: "success",
        summary: "Deleted",
        detail: `${preparedItems.length} item${preparedItems.length !== 1 ? "s" : ""} moved to trash`,
        life: 3000
      });
    if (errors.length > 0)
      toast.add({
        severity: "error",
        summary: "Some Deletions Failed",
        detail: errors.slice(0, 3).join("\n"),
        life: 6000
      });
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
const buildFolderSnapshot = async (
  folderId: number
): Promise<FolderSnapshot> => {
  const fileRows = await runQuery(
    `SELECT id, name, fileType, fileSize, url FROM File WHERE folder = ${folderId}`
  );
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
        if (result?.content && !result?.binary) content = result.content;
      } catch {
        /* skip */
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
  const subfolderRows = await runQuery(
    `SELECT id, name FROM MediaItemFolder WHERE parent = ${folderId}`
  );
  const subfolders: SubfolderSnapshot[] = [];
  for (const sf of subfolderRows) {
    const childSnapshot = await buildFolderSnapshot(Number(sf.id));
    subfolders.push({
      id: Number(sf.id),
      name: sf.name,
      snapshot: childSnapshot
    });
  }
  return { files, subfolders };
};

const collectNetsuiteRecursiveDelete = async (
  folderId: number,
  files: { fileId: number; folderId: number }[],
  folderIds: number[]
) => {
  const fileRows = await runQuery(
    `SELECT id FROM File WHERE folder = ${folderId}`
  );
  for (const file of fileRows) {
    files.push({ fileId: Number(file.id), folderId });
  }

  const subfolderRows = await runQuery(
    `SELECT id FROM MediaItemFolder WHERE parent = ${folderId}`
  );
  for (const subfolder of subfolderRows) {
    const subfolderId = Number(subfolder.id);
    await collectNetsuiteRecursiveDelete(subfolderId, files, folderIds);
    folderIds.push(subfolderId);
  }
};
// ── Detail panel resize ────────────────────────────────────────────────────

const startPanelResize = (e: MouseEvent) => {
  e.preventDefault();
  isResizingPanel.value = true;
  const startX = e.clientX;
  const startWidth = detailPanelWidth.value;
  const onMove = (ev: MouseEvent) => {
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

// ── Tab label helper ───────────────────────────────────────────────────────

const updateLabel = () => {
  if (openedFile.value) {
    emit("label-change", openedFile.value.name);
  } else if (breadcrumbs.value.length > 0) {
    emit("label-change", breadcrumbs.value[breadcrumbs.value.length - 1]!.name);
  } else {
    emit("label-change", "File Cabinet");
  }
};

// ── Watchers ───────────────────────────────────────────────────────────────

watch(detailItem, (item) => {
  previewContent.value = null;
  previewError.value = false;
  if (item && item.type === "file" && isPreviewable(item as FileItem))
    loadPreview(item as FileItem);
});

watch(currentFolderInfo, (info) => {
  emit("folder-info-change", info);
});

// ── Lifecycle ──────────────────────────────────────────────────────────────

onMounted(async () => {
  document.addEventListener("click", handleDocClick);
  if (props.contextPicker) viewMode.value = "list";
  await navigateToFolder(props.initialFolderId ?? null);
  if (props.initialFile) {
    await openFile(props.initialFile as FileItem);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleDocClick);
});

// ── Expose ─────────────────────────────────────────────────────────────────

defineExpose({
  navigateToFolder,
  refreshCurrentFolder,
  currentFolderInfo,
  openFile
});
</script>

<style scoped>
.fc-pane-wrapper {
  display: flex;
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
}

.fc-pane-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

/* ── Breadcrumb bar ─────────────────────────────────────────────────────── */
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
  border: 1px solid var(--p-slate-400);
  background: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p-slate-600);
  transition: all 0.15s;
}

.fc-view-toggle:hover {
  border-color: var(--p-slate-500);
  color: var(--p-slate-800);
  background: var(--p-slate-100);
}

.fc-view-toggle:disabled {
  cursor: default;
  opacity: 0.6;
}

.fc-view-toggle:disabled:hover {
  border-color: var(--p-slate-400);
  color: var(--p-slate-600);
  background: white;
}

.fc-view-toggle.active {
  background: var(--p-slate-600);
  border-color: var(--p-slate-600);
  color: white;
}

/* ── Segmented view toggle ──────────────────────────────────────────────── */
.fc-view-seg {
  display: inline-flex;
  border: 1px solid var(--p-slate-300);
  border-radius: 5px;
  overflow: hidden;
  background: white;
}

.fc-view-seg-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p-slate-500);
  transition:
    background 0.12s,
    color 0.12s;
  position: relative;
}

.fc-view-seg-btn + .fc-view-seg-btn::before {
  content: "";
  position: absolute;
  left: 0;
  top: 20%;
  bottom: 20%;
  width: 1px;
  background: var(--p-slate-300);
}

.fc-view-seg-btn:hover {
  background: var(--p-slate-100);
  color: var(--p-slate-700);
}

.fc-view-seg-btn.active {
  background: var(--p-slate-600);
  color: white;
}

/* Hide the divider when either neighbouring button is active */
.fc-view-seg-btn.active + .fc-view-seg-btn::before,
.fc-view-seg-btn.active::before {
  display: none;
}

/* ── Grid view ───────────────────────────────────────────────────────────── */
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
  position: relative;
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
.fc-grid-item.fc-drop-target {
  outline: 2px solid var(--p-indigo-400);
  background: rgba(99, 102, 241, 0.12);
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

/* ── List view ───────────────────────────────────────────────────────────── */
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
.fc-table-row.fc-drop-target {
  outline: 2px solid var(--p-indigo-400);
  background: rgba(99, 102, 241, 0.12);
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

/* ── Status bar ──────────────────────────────────────────────────────────── */
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

/* ── Detail panel ────────────────────────────────────────────────────────── */
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
  gap: 0.4rem;
  padding: 0.75rem;
  border-bottom: 1px solid var(--p-slate-200);
}

.fc-detail-header h4 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-slate-800);
  word-break: break-word;
  flex: 1;
  min-width: 0;
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

/* ── Context menu ────────────────────────────────────────────────────────── */
.fc-context-menu {
  position: fixed;
  background: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  min-width: 160px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
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
.fc-context-item--danger {
  border-top: 1px solid var(--p-slate-200);
  color: var(--p-red-600);
}
.fc-context-item--danger:hover {
  background: var(--p-red-50);
}

/* ── File views ──────────────────────────────────────────────────────────── */
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
.fc-file-pdf {
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}
.fc-pdf-viewer {
  width: 100%;
  flex: 1;
  border: none;
  display: block;
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
.fc-file-code :deep(.file-code-editor) {
  height: 100%;
}

/* CodeMirror editors inside fc-file-code fill the container */
/* ── Edit toolbar ────────────────────────────────────────────────────────── */
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
.fc-btn-active {
  background: var(--p-indigo-100) !important;
  color: var(--p-indigo-700) !important;
  border-color: var(--p-indigo-300) !important;
}

/* ── History dropdown ────────────────────────────────────────────────────── */
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

/* ── Diff/Compare bars ───────────────────────────────────────────────────── */
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
.fc-file-compare {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}
.fc-compare-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0.75rem;
  background: var(--p-indigo-50);
  border-bottom: 1px solid var(--p-indigo-200);
  flex-shrink: 0;
  gap: 0.5rem;
}
.fc-compare-labels {
  display: flex;
  gap: 1rem;
  align-items: center;
  flex: 1;
  min-width: 0;
}
.fc-compare-label {
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--p-slate-600);
}
.fc-compare-label-left {
  color: var(--p-indigo-600);
}
.fc-compare-label-right {
  color: var(--p-teal-600);
}
.fc-file-compare :deep(.diff-comparator) {
  flex: 1;
  max-height: none;
  border: none;
  border-radius: 0;
  width: 100%;
}

/* ── Detail panel preview ────────────────────────────────────────────────── */
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
  max-height: 400px;
}
.fc-detail-actions {
  margin-bottom: 0.75rem;
}
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

/* ── Drop zone & upload ──────────────────────────────────────────────────── */
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
.fc-delete-overlay {
  position: absolute;
  inset: 0;
  z-index: 15;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(2px);
  pointer-events: all;
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

/* ── Global search ───────────────────────────────────────────────────────── */
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

.fc-search-add-btn {
  flex-shrink: 0;
  margin-left: auto;
}
.fc-search-empty {
  padding: 0.75rem;
  text-align: center;
  font-size: 0.75rem;
  color: var(--p-slate-400);
  border-top: 1px solid var(--p-slate-200);
}

/* ── Confirm dialogs ─────────────────────────────────────────────────────── */
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
.fc-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
.fc-confirm-danger span {
  color: var(--p-red-600);
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

/* ── New-file dialog ─────────────────────────────────────────────────────── */
.fc-nf-label {
  display: block;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--p-slate-500);
  margin-bottom: 0.25rem;
}
.fc-nf-label.mt-3 {
  margin-top: 0.75rem;
}
.fc-nf-name-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.fc-nf-name-input {
  flex: 1;
  min-width: 0;
}
.fc-nf-dot {
  font-weight: 600;
  color: var(--p-slate-500);
}
.fc-nf-ext-select {
  flex-shrink: 0;
  min-width: 9rem;
  max-width: 12rem;
}
.fc-nf-preview {
  margin-top: 0.3rem;
  font-size: 0.72rem;
  color: var(--p-slate-400);
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.fc-nf-content {
  width: 100%;
  margin-top: 0.25rem;
  border: 1px solid var(--p-slate-300);
  border-radius: 5px;
  padding: 0.4rem 0.5rem;
  font-size: 0.72rem;
  font-family: "JetBrains Mono", "Fira Code", monospace;
  color: var(--p-slate-800);
  resize: vertical;
  outline: none;
  box-sizing: border-box;
  line-height: 1.5;
}
.fc-nf-content:focus {
  border-color: var(--p-indigo-400);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
}

/* ── Inline rename ───────────────────────────────────────────────────────── */
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

/* ── Context picker mode ─────────────────────────────────────────────────── */
.fc-pane--context-picker .fc-pane-main {
  flex: 1;
  min-height: 0;
}

.fc-pane--context-picker .fc-drop-zone {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.fc-pane--context-picker .fc-grid-view,
.fc-pane--context-picker .fc-list-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.fc-th-action {
  width: 44px;
}

.fc-td-action {
  width: 44px;
  text-align: center;
}

.fc-grid-add {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 2;
}

.fc-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  background: var(--p-slate-100);
  color: var(--p-slate-600);
  cursor: pointer;
  font-size: 0.72rem;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}

.fc-add-btn:hover:not(:disabled) {
  border-color: #c4b5fd;
  background: #f5f3ff;
  color: #6d28d9;
}

.fc-add-btn.attached,
.fc-add-btn:disabled {
  border-color: var(--p-emerald-200);
  background: var(--p-emerald-50);
  color: var(--p-emerald-700);
  cursor: default;
}

/* ── PrimeVue overrides ──────────────────────────────────────────────────── */
:deep(.p-inputtext) {
  font-size: 0.75rem;
}
</style>
