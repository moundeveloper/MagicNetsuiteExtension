<template>
  <div class="context-modal-overlay">
    <section class="context-modal">
      <header class="context-modal-header">
        <h2>NetSuite Context Picker</h2>
        <div class="context-header-actions">
          <span class="status-pill" :class="connectionClass">
            <span class="status-dot" />
            {{ status }}
          </span>
          <button
            v-if="canRequestFullscreen"
            class="context-modal-close"
            type="button"
            title="Fullscreen"
            @click="requestLargerDisplayMode"
          >
            <span class="pi pi-expand" aria-hidden="true" />
          </button>
          <button class="context-modal-close" type="button" title="Refresh" @click="checkBridge">
            <span class="pi pi-refresh" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div class="context-modal-body">
        <div class="context-tabs">
          <button type="button" :class="{ active: tab === 'records' }" @click="activateTab('records')">
            <span class="pi pi-database" aria-hidden="true" />
            <span>Records</span>
          </button>
          <button type="button" :class="{ active: tab === 'files' }" @click="activateTab('files')">
            <span class="pi pi-folder" aria-hidden="true" />
            <span>Files</span>
          </button>
        </div>

        <section v-if="tab === 'records'" class="context-panel context-panel--records">
          <div class="context-toolbar">
            <div ref="recordTypeSelectRef" class="context-select-shell">
              <button
                type="button"
                class="context-select-trigger"
                :class="{ open: recordTypeMenuOpen }"
                :disabled="recordTypesLoading"
                @click="toggleRecordTypeMenu"
              >
                <span>{{ selectedRecordTypeLabel }}</span>
                <span :class="recordTypesLoading ? 'pi pi-spin pi-spinner' : 'pi pi-angle-down'" aria-hidden="true" />
              </button>
              <div v-if="recordTypeMenuOpen" class="context-select-menu" role="listbox">
                <label class="context-select-search-row">
                  <span class="pi pi-search" aria-hidden="true" />
                  <input
                    v-model="recordTypeQuery"
                    class="context-select-search"
                    type="search"
                    placeholder="Search record types"
                    @keydown.escape.stop.prevent="recordTypeMenuOpen = false"
                  />
                </label>
                <button
                  v-for="type in filteredRecordTypes"
                  :key="type.id"
                  type="button"
                  class="context-select-option"
                  :class="{ active: selectedRecordType === type.id }"
                  role="option"
                  :aria-selected="selectedRecordType === type.id"
                  @click="selectRecordType(type.id)"
                >
                  <strong>{{ type.name }}</strong>
                  <small>{{ type.id }}</small>
                </button>
                <p v-if="filteredRecordTypes.length === 0" class="context-select-empty">No record types loaded.</p>
              </div>
            </div>
            <input
              v-model="recordQuery"
              class="context-search"
              type="search"
              placeholder="ID, name, tranid, scriptid"
              @keydown.enter.prevent="searchRecords"
            />
            <button
              type="button"
              class="agent-secondary-btn"
              :disabled="!appReady || !selectedRecordType || recordsLoading"
              @click="searchRecords"
            >
              <span class="pi pi-search" aria-hidden="true" />
              Search
            </button>
          </div>

          <div class="context-table-host">
            <div v-if="recordsLoading" class="context-table-overlay">
              <span class="pi pi-spin pi-spinner" aria-hidden="true" />
              <span>Loading records...</span>
            </div>
            <div class="context-data-table">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>ID</th>
                    <th class="context-action-th"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="record in paginatedRecords" :key="`${selectedRecordType}:${record.id}`">
                    <td>
                      <div class="context-primary-cell">
                        <span>
                          <span class="context-row-icon pi pi-database" aria-hidden="true" />
                          <strong>{{ record.label }}</strong>
                        </span>
                        <small>{{ record.meta || selectedRecordType }}</small>
                      </div>
                    </td>
                    <td class="context-muted-cell">{{ selectedRecordTypeName() }}</td>
                    <td class="context-muted-cell">#{{ record.id }}</td>
                    <td class="context-action-cell">
                      <button
                        type="button"
                        class="context-add-btn"
                        :class="{ attached: isQueued('record', record.id, selectedRecordType) }"
                        :disabled="isQueued('record', record.id, selectedRecordType)"
                        :title="isQueued('record', record.id, selectedRecordType) ? 'Queued for send' : 'Add to context'"
                        @click="queueRecord(record)"
                      >
                        <span
                          :class="isQueued('record', record.id, selectedRecordType) ? 'pi pi-check' : 'pi pi-plus'"
                          aria-hidden="true"
                        />
                      </button>
                    </td>
                  </tr>
                  <tr v-if="!recordsLoading && records.length === 0">
                    <td colspan="4">
                      <div class="context-empty context-empty--table">
                        <span class="pi pi-search" aria-hidden="true" />
                        <span>No records loaded.</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="records.length > recordsPerPage" class="context-pagination">
              <span>{{ records.length }} records</span>
              <div>
                <button type="button" class="context-page-btn" :disabled="recordPage <= 1" @click="previousRecordPage">
                  <span class="pi pi-angle-left" aria-hidden="true" />
                </button>
                <span>Page {{ recordPage }} / {{ recordPageCount }}</span>
                <button type="button" class="context-page-btn" :disabled="recordPage >= recordPageCount" @click="nextRecordPage">
                  <span class="pi pi-angle-right" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section v-else class="context-panel context-panel--fc">
          <div class="context-fc-host">
            <div class="fc-pane-wrapper fc-pane--context-picker">
              <div class="fc-pane-main">
                <div class="fc-breadcrumb-bar">
                  <button class="fc-breadcrumb-item" type="button" @click="loadFileCabinetFolder(null)">
                    <span class="pi pi-home" aria-hidden="true" />
                  </button>
                  <template v-for="crumb in fileBreadcrumbs" :key="crumb.id">
                    <span class="pi pi-angle-right fc-breadcrumb-separator" aria-hidden="true" />
                    <button
                      class="fc-breadcrumb-item"
                      type="button"
                      :class="{ active: crumb.id === currentFolderId }"
                      @click="loadFileCabinetFolder(crumb.id)"
                    >
                      {{ crumb.name }}
                    </button>
                  </template>
                  <button
                    type="button"
                    class="fc-view-toggle fc-refresh-btn"
                    :disabled="filesLoading"
                    title="Refresh folder"
                    @click="loadFileCabinetFolder(currentFolderId)"
                  >
                    <span :class="filesLoading ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" aria-hidden="true" />
                  </button>
                </div>

                <div class="fc-global-search">
                  <div class="fc-search-input-row">
                    <span class="pi pi-search" aria-hidden="true" />
                    <input
                      v-model="fileQuery"
                      class="fc-search-input"
                      type="search"
                      placeholder="Search File Cabinet files and folders"
                      @keydown.enter.prevent="searchFiles"
                    />
                    <button
                      type="button"
                      class="agent-secondary-btn fc-search-action"
                      :disabled="!appReady || !fileQuery.trim() || filesLoading"
                      @click="searchFiles"
                    >
                      Search
                    </button>
                  </div>
                </div>

                <div class="fc-drop-zone">
                  <div v-if="filesLoading" class="context-table-overlay">
                    <span class="pi pi-spin pi-spinner" aria-hidden="true" />
                    <span>{{ fileQuery.trim() ? "Searching files..." : "Loading folder..." }}</span>
                  </div>
                  <div class="fc-list-view">
                    <table class="fc-table">
                      <thead>
                        <tr>
                          <th class="fc-th-name">Name</th>
                          <th class="fc-th-type">Type</th>
                          <th class="fc-th-size">Size</th>
                          <th class="fc-th-id">ID</th>
                          <th class="fc-th-action"></th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="item in fileCabinetItems"
                          :key="`${item.type}:${item.id}`"
                          class="fc-table-row"
                          @click="handleFileCabinetItemClick(item)"
                        >
                          <td>
                            <span class="fc-td-name">
                              <span
                                class="fc-file-icon pi"
                                :class="item.type === 'folder' ? 'pi-folder' : 'pi-file'"
                                aria-hidden="true"
                              />
                              <span class="fc-file-name">{{ item.name }}</span>
                            </span>
                          </td>
                          <td>{{ item.type === "folder" ? "Folder" : item.filetype || "File" }}</td>
                          <td>{{ item.type === "folder" ? formatSize(item.foldersize) : formatSize(item.filesize) }}</td>
                          <td>#{{ item.id }}</td>
                          <td class="fc-td-action">
                            <button
                              v-if="item.type === 'file'"
                              type="button"
                              class="context-add-btn"
                              :class="{ attached: isQueued('file', String(item.id)) }"
                              :disabled="isQueued('file', String(item.id))"
                              :title="isQueued('file', String(item.id)) ? 'Queued for send' : 'Add to context'"
                              @click.stop="queueFile(item)"
                            >
                              <span
                                :class="isQueued('file', String(item.id)) ? 'pi pi-check' : 'pi pi-plus'"
                                aria-hidden="true"
                              />
                            </button>
                          </td>
                        </tr>
                        <tr v-if="!filesLoading && fileCabinetItems.length === 0">
                          <td colspan="5">
                            <div class="context-empty context-empty--table">
                              <span class="pi pi-folder-open" aria-hidden="true" />
                              <span>{{ fileQuery.trim() ? "No matching files or folders." : "This folder is empty." }}</span>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div class="fc-status-bar">
                    {{ folders.length }} folder{{ folders.length === 1 ? "" : "s" }},
                    {{ files.length }} file{{ files.length === 1 ? "" : "s" }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside class="context-rail">
          <div class="context-rail-header">
            <div>
              <strong>Selected context</strong>
              <span>{{ queued.length }} item{{ queued.length === 1 ? "" : "s" }}</span>
            </div>
            <button type="button" class="agent-secondary-btn" :disabled="queued.length === 0" @click="clearQueue">
              Clear
            </button>
          </div>

          <div class="context-chip-list">
            <span v-for="item in queued" :key="item.key" class="context-chip">
              <span :class="item.kind === 'record' ? 'pi pi-database' : 'pi pi-file'" aria-hidden="true" />
              <span>{{ item.name }}</span>
              <button type="button" title="Remove" @click="removeQueued(item.key)">
                <span class="pi pi-times" aria-hidden="true" />
              </button>
            </span>
            <p v-if="queued.length === 0" class="context-empty-inline">
              Pick records or files to load into Claude.
            </p>
          </div>

          <div class="context-options">
            <label class="context-toggle">
              <input v-model="includeSublists" type="checkbox" />
              <span class="context-toggle-slider" />
              <span>Include record sublists</span>
            </label>
            <button class="agent-primary-btn context-send" type="button" :disabled="queued.length === 0 || sending" @click="sendToClaude">
              <span :class="sending ? 'pi pi-spin pi-spinner' : 'pi pi-send'" aria-hidden="true" />
              {{ sending ? "Loading selected context..." : "Load into Claude" }}
            </button>
            <p v-if="lastSaved" class="context-saved">
              Saved {{ lastSaved.count }} item{{ lastSaved.count === 1 ? "" : "s" }} at {{ lastSaved.time }}.
            </p>
          </div>
        </aside>

        <p v-if="error" class="context-error">{{ error }}</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { App } from "@modelcontextprotocol/ext-apps";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

type Tab = "records" | "files";
type RecordType = { id: string; name: string };
type RecordRow = { id: string; label: string; meta: string; raw?: Record<string, unknown> };
type FolderRow = {
  type: "folder";
  id: number;
  name: string;
  parent: number | null;
  foldertype: string;
  numfolderfiles: number;
  foldersize: number;
  lastmodifieddate: string | null;
};
type FileRow = {
  type?: "file";
  id: number;
  name: string;
  filetype: string;
  filesize: number;
  folder?: unknown;
  url?: string;
};
type CabinetItem = FolderRow | (FileRow & { type: "file" });
type QueueItem = {
  key: string;
  kind: "record" | "file";
  name: string;
  id: string;
  recordType?: string;
};

const app = new App(
  { name: "Magic NetSuite Context Picker", version: "1.0.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
);

const tab = ref<Tab>("records");
const status = ref("Connecting...");
const error = ref("");
const appReady = ref(false);
const includeSublists = ref(false);
const displayMode = ref<"inline" | "fullscreen" | "pip">("inline");
const availableDisplayModes = ref<Array<"inline" | "fullscreen" | "pip">>([]);

const recordTypes = ref<RecordType[]>([]);
const recordTypesLoading = ref(false);
const selectedRecordType = ref("");
const recordTypeMenuOpen = ref(false);
const recordTypeQuery = ref("");
const recordTypeSelectRef = ref<HTMLElement | null>(null);
const recordQuery = ref("");
const records = ref<RecordRow[]>([]);
const recordPage = ref(1);
const recordsPerPage = 24;
const recordsLoading = ref(false);

const fileQuery = ref("");
const currentFolderId = ref<number | null>(null);
const fileBreadcrumbs = ref<Array<{ id: number; name: string }>>([]);
const folders = ref<FolderRow[]>([]);
const files = ref<FileRow[]>([]);
const filesLoading = ref(false);

const queued = ref<QueueItem[]>([]);
const sending = ref(false);
const lastSaved = ref<{ count: number; time: string } | null>(null);

const selectedRecordTypeLabel = computed(() => {
  const selected = recordTypes.value.find((type) => type.id === selectedRecordType.value);
  if (selected) return `${selected.name} (${selected.id})`;
  return recordTypesLoading.value ? "Loading record types..." : "Record type";
});

const filteredRecordTypes = computed(() => {
  const query = recordTypeQuery.value.trim().toLowerCase();
  if (!query) return recordTypes.value;
  return recordTypes.value.filter((type) =>
    `${type.name} ${type.id}`.toLowerCase().includes(query),
  );
});

const recordPageCount = computed(() => Math.max(1, Math.ceil(records.value.length / recordsPerPage)));

const paginatedRecords = computed(() => {
  const start = (recordPage.value - 1) * recordsPerPage;
  return records.value.slice(start, start + recordsPerPage);
});

const fileCabinetItems = computed<CabinetItem[]>(() => {
  const folderItems: CabinetItem[] = folders.value.map((folder) => ({ ...folder, type: "folder" }));
  const fileItems: CabinetItem[] = files.value.map((file) => ({ ...file, type: "file" }));
  return [...folderItems, ...fileItems];
});

const connectionClass = computed(() => {
  if (status.value.includes("connected") || status.value.includes("Connected") || status.value.includes("Sent")) {
    return "status-pill--connected";
  }
  if (status.value.includes("unavailable") || status.value.includes("failed") || status.value.includes("Connection")) {
    return "status-pill--error";
  }
  return "status-pill--checking";
});

const canRequestFullscreen = computed(() =>
  availableDisplayModes.value.includes("fullscreen") && displayMode.value !== "fullscreen",
);

function readStructured<T>(result: unknown, key: string, fallback: T): T {
  const direct = result as {
    structuredContent?: Record<string, unknown>;
    result?: { structuredContent?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> };
    content?: Array<{ type: string; text?: string }>;
  };
  const structured = direct?.structuredContent ?? direct?.result?.structuredContent;
  if (structured?.[key] !== undefined) return structured[key] as T;

  const text = (direct?.content ?? direct?.result?.content)?.find((item) => item.type === "text")?.text;
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed?.[key] !== undefined) return parsed[key] as T;
  } catch {
    if (key === "markdown") return text as T;
  }
  return fallback;
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!appReady.value) {
    throw new Error("The Claude app bridge is still connecting. Try again in a moment.");
  }
  return app.callServerTool({ name, arguments: args });
}

async function checkBridge(): Promise<void> {
  error.value = "";
  status.value = "Checking bridge...";
  try {
    await callTool("magic_netsuite_bridge_status");
    status.value = "Bridge connected";
  } catch (err) {
    status.value = "Bridge unavailable";
    error.value = err instanceof Error ? err.message : String(err);
  }
}

async function loadRecordTypes(): Promise<void> {
  if (!appReady.value || recordTypesLoading.value || recordTypes.value.length > 0) return;
  recordTypesLoading.value = true;
  error.value = "";
  try {
    const result = await callTool("magic_netsuite_list_record_types");
    recordTypes.value = readStructured<RecordType[]>(result, "recordTypes", []);
    if (!selectedRecordType.value && recordTypes.value.length) {
      selectedRecordType.value = recordTypes.value.find((type) => type.id === "customer")?.id ?? recordTypes.value[0]!.id;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    recordTypesLoading.value = false;
  }
}

async function ensureRecordTypes(): Promise<void> {
  if (recordTypes.value.length === 0) await loadRecordTypes();
}

async function toggleRecordTypeMenu(): Promise<void> {
  await ensureRecordTypes();
  recordTypeMenuOpen.value = !recordTypeMenuOpen.value;
}

async function selectRecordType(recordType: string): Promise<void> {
  selectedRecordType.value = recordType;
  recordTypeMenuOpen.value = false;
  recordTypeQuery.value = "";
  recordPage.value = 1;
  await searchRecords();
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (!recordTypeMenuOpen.value) return;
  const target = event.target instanceof Node ? event.target : null;
  if (target && recordTypeSelectRef.value?.contains(target)) return;
  recordTypeMenuOpen.value = false;
}

function previousRecordPage(): void {
  recordPage.value = Math.max(1, recordPage.value - 1);
}

function nextRecordPage(): void {
  recordPage.value = Math.min(recordPageCount.value, recordPage.value + 1);
}

async function searchRecords(): Promise<void> {
  if (!selectedRecordType.value) return;
  recordsLoading.value = true;
  error.value = "";
  try {
    const result = await callTool("magic_netsuite_search_records", {
      recordType: selectedRecordType.value,
      query: recordQuery.value,
      limit: 100,
    });
    records.value = readStructured<RecordRow[]>(result, "records", []);
    recordPage.value = 1;
  } catch (err) {
    records.value = [];
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    recordsLoading.value = false;
  }
}

async function searchFiles(): Promise<void> {
  const query = fileQuery.value.trim();
  if (!query) {
    await loadFileCabinetFolder(currentFolderId.value);
    return;
  }
  filesLoading.value = true;
  error.value = "";
  try {
    const result = await callTool("magic_netsuite_search_files", { query, limit: 50 });
    folders.value = readStructured<FolderRow[]>(result, "folders", []);
    fileBreadcrumbs.value = [];
    currentFolderId.value = null;
    files.value = readStructured<FileRow[]>(result, "files", []);
  } catch (err) {
    folders.value = [];
    files.value = [];
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    filesLoading.value = false;
  }
}

async function loadFileCabinetFolder(folderId: number | null): Promise<void> {
  if (!appReady.value || filesLoading.value) return;
  filesLoading.value = true;
  error.value = "";
  fileQuery.value = "";
  try {
    const args = folderId === null ? { folderId: null } : { folderId };
    const result = await callTool("magic_netsuite_list_file_cabinet_folder", args);
    currentFolderId.value = readStructured<number | null>(result, "folderId", folderId);
    fileBreadcrumbs.value = readStructured<Array<{ id: number; name: string }>>(result, "breadcrumbs", []);
    folders.value = readStructured<FolderRow[]>(result, "folders", []);
    files.value = readStructured<FileRow[]>(result, "files", []);
  } catch (err) {
    folders.value = [];
    files.value = [];
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    filesLoading.value = false;
  }
}

function selectedRecordTypeName(): string {
  return recordTypes.value.find((type) => type.id === selectedRecordType.value)?.name ?? selectedRecordType.value;
}

function isQueued(kind: QueueItem["kind"], id: string, recordType = ""): boolean {
  const key = kind === "record" ? `record:${recordType}:${id}` : `file:${id}`;
  return queued.value.some((item) => item.key === key);
}

function queueRecord(record: RecordRow): void {
  if (!selectedRecordType.value || isQueued("record", record.id, selectedRecordType.value)) return;
  queued.value.push({
    key: `record:${selectedRecordType.value}:${record.id}`,
    kind: "record",
    id: record.id,
    recordType: selectedRecordType.value,
    name: `${selectedRecordTypeName()}: ${record.label} (#${record.id})`,
  });
}

async function activateTab(nextTab: Tab): Promise<void> {
  tab.value = nextTab;
  if (nextTab === "records") await ensureRecordTypes();
  if (nextTab === "files" && folders.value.length === 0 && files.value.length === 0) {
    await loadFileCabinetFolder(currentFolderId.value);
  }
}

function queueFile(file: FileRow): void {
  const id = String(file.id);
  if (isQueued("file", id)) return;
  queued.value.push({
    key: `file:${id}`,
    kind: "file",
    id,
    name: `${file.name} (#${id})`,
  });
}

function handleFileCabinetItemClick(item: CabinetItem): void {
  if (item.type === "folder") {
    void loadFileCabinetFolder(item.id);
    return;
  }
  queueFile(item);
}

function removeQueued(key: string): void {
  queued.value = queued.value.filter((item) => item.key !== key);
  lastSaved.value = null;
}

function clearQueue(): void {
  queued.value = [];
  lastSaved.value = null;
}

function formatSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "unknown size";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function loadQueueMarkdown(): Promise<string> {
  const sections: string[] = [];
  for (const item of queued.value) {
    if (item.kind === "record") {
      const result = await callTool("magic_netsuite_load_record_context", {
        recordType: item.recordType,
        recordId: item.id,
        includeSublists: includeSublists.value,
      });
      sections.push(readStructured<string>(result, "markdown", `# ${item.name}\nUnable to load context.`));
    } else {
      const result = await callTool("magic_netsuite_read_file_context", { fileId: item.id });
      sections.push(readStructured<string>(result, "markdown", `# ${item.name}\nUnable to load context.`));
    }
  }
  return sections.join("\n\n---\n\n");
}

async function sendToClaude(): Promise<void> {
  if (queued.value.length === 0) return;
  sending.value = true;
  error.value = "";
  try {
    const markdown = await loadQueueMarkdown();
    const selectedItems = queued.value.map((item) => ({
      kind: item.kind,
      id: item.id,
      recordType: item.recordType,
      name: item.name,
    }));
    await callTool("magic_netsuite_save_selected_context", {
      markdown,
      selectedItems,
    });
    lastSaved.value = {
      count: selectedItems.length,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    await app.updateModelContext({
      content: [{ type: "text", text: markdown }],
      structuredContent: {
        source: "Magic NetSuite",
        selectedItems,
      },
    });
    await requestInlineDisplayMode();
    status.value = `Sent ${queued.value.length} item${queued.value.length === 1 ? "" : "s"}`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    sending.value = false;
  }
}

app.ontoolresult = (result) => {
  const structured = (result as { structuredContent?: { initialTab?: Tab } })?.structuredContent;
  if (structured?.initialTab) tab.value = structured.initialTab;
};

app.onhostcontextchanged = (ctx) => {
  document.documentElement.dataset.theme = ctx.theme ?? "light";
  const hostContext = app.getHostContext();
  displayMode.value = ctx.displayMode ?? hostContext?.displayMode ?? displayMode.value;
  availableDisplayModes.value = ctx.availableDisplayModes ?? hostContext?.availableDisplayModes ?? availableDisplayModes.value;
  document.documentElement.dataset.displayMode = displayMode.value;
};

async function requestLargerDisplayMode(): Promise<void> {
  const hostContext = app.getHostContext();
  const modes = hostContext?.availableDisplayModes ?? availableDisplayModes.value;
  if (!modes.includes("fullscreen") || displayMode.value === "fullscreen") return;

  try {
    const result = await app.requestDisplayMode({ mode: "fullscreen" });
    displayMode.value = result.mode;
    document.documentElement.dataset.displayMode = displayMode.value;
  } catch {
    displayMode.value = hostContext?.displayMode ?? "inline";
    document.documentElement.dataset.displayMode = displayMode.value;
  }
}

async function requestInlineDisplayMode(): Promise<void> {
  if (displayMode.value !== "fullscreen") return;

  try {
    const result = await app.requestDisplayMode({ mode: "inline" });
    displayMode.value = result.mode;
    document.documentElement.dataset.displayMode = displayMode.value;
  } catch {
    displayMode.value = app.getHostContext()?.displayMode ?? displayMode.value;
    document.documentElement.dataset.displayMode = displayMode.value;
  }
}

onMounted(async () => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  try {
    await app.connect();
    appReady.value = true;
    status.value = "Connected";
    const hostContext = app.getHostContext();
    displayMode.value = hostContext?.displayMode ?? "inline";
    availableDisplayModes.value = hostContext?.availableDisplayModes ?? [];
    document.documentElement.dataset.displayMode = displayMode.value;
    void requestLargerDisplayMode();

    window.setTimeout(() => {
      void checkBridge();
      if (tab.value === "records") void loadRecordTypes();
    }, 300);
  } catch (err) {
    status.value = "Connection failed";
    error.value = err instanceof Error ? err.message : String(err);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
});
</script>
