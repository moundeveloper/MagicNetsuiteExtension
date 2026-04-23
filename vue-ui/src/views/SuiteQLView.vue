<template>
  <MCard
    flex
    autoHeight
    direction="row"
    gap="0.5"
    padding=""
    outlined
    elevated
    :style="{ height: `90vh` }"
  >
    <template #default>
      <!-- Left Sidebar: Actions + Files only -->
      <ExpandableSidebar>
        <template #collapsed>
          <button
            class="p-2 rounded bg-slate-600 hover:opacity-100 hover:bg-slate-500 transition-opacity duration-150 text-[var(--p-slate-50)]"
            @click="runCurrentQuery"
            :disabled="currentFile?.isExecuting"
            title="Run Query (Ctrl+Enter)"
          >
            <i class="pi pi-play text-sm"></i>
          </button>
        </template>
        <template #default>
          <div class="sidebar-section">
            <h4>Actions</h4>
            <div class="flex flex-col gap-2">
              <Button
                @click="runCurrentQuery"
                :disabled="currentFile?.isExecuting"
                class="w-full"
              >
                <i class="pi pi-play font-medium"></i>
                {{ currentFile?.isExecuting ? "Running..." : "Run Query" }}
              </Button>
              <Button
                @click="fetchTables"
                :disabled="isLoadingTables"
                severity="secondary"
                class="w-full"
              >
                <i class="pi pi-refresh font-medium"></i>
                {{ isLoadingTables ? "Loading..." : "Refresh Tables" }}
              </Button>
              <div class="text-xs">
                <span v-if="saveStatus === 'saving'" class="text-amber-500"
                  >Syncing…</span
                >
                <span
                  v-else-if="saveStatus === 'saved'"
                  class="text-emerald-600"
                  >✓ Saved</span
                >
                <span v-else-if="saveStatus === 'error'" class="text-red-500"
                  >Save failed</span
                >
              </div>
            </div>
          </div>

          <div class="sidebar-section">
            <h4>Query Files</h4>
            <InputText
              v-model="fileSearchTerm"
              type="text"
              placeholder="Search files..."
              size="small"
              class="w-full mb-2"
            />
            <div
              class="flex flex-col gap-1 overflow-y-auto pr-1"
              style="max-height: calc(90vh - 300px)"
            >
              <div
                v-for="file in filteredFiles"
                :key="file.id"
                class="file-item flex items-center gap-2 py-2 px-3 rounded cursor-pointer hover:bg-slate-200 transition-colors group"
                :class="{ 'bg-slate-200': activeFileId === file.id }"
                @click="openFileInTab(file.id)"
              >
                <i class="pi pi-database text-xs text-slate-500"></i>
                <MInput
                  v-model="file.name"
                  outlined
                  item-dynamic
                  class="flex-1 text-ellipsis overflow-hidden"
                />
                <button
                  class="ml-auto p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-300"
                  @click.stop="removeFile(file.id)"
                >
                  <i class="pi pi-times text-xs"></i>
                </button>
              </div>
            </div>
            <Button size="small" text class="mt-2 w-full" @click="addNewFile">
              <i class="pi pi-plus text-sm mr-1"></i>
              New Query
            </Button>
          </div>
        </template>
      </ExpandableSidebar>

      <!-- Main area -->
      <div class="flex-1 flex flex-col p-2" style="min-width: 0">
        <MTabs
          v-if="openTabs.length > 0"
          :tabs="tabs"
          :dynamic="true"
          v-model="activeFileId"
          @add-tab="addNewFile"
          @delete-tab="removeFileByTab"
        >
          <template #tab-content="{ activeTab: activeTabName, contentHeight }">
            <div
              v-for="file in files"
              :key="file.id"
              v-show="activeTabName === file.id"
              class="flex flex-col"
              :style="{ height: `${contentHeight}px` }"
            >
              <!-- Editor toolbar — slim icon+label buttons -->
              <div
                class="editor-toolbar shrink-0 flex items-center gap-1.5 px-2 py-1 border-b border-slate-200"
                style="position: relative; z-index: 0"
              >
                <button
                  class="toolbar-btn"
                  @click="formatCurrentSQL(file.id)"
                  title="Format SQL"
                >
                  <i class="pi pi-align-left"></i>
                  <span>Format</span>
                </button>
                <button
                  class="toolbar-btn"
                  @click="openInRunQuickScript(file)"
                  title="Open in Script Runner"
                >
                  <i class="pi pi-external-link"></i>
                  <span>Script Runner</span>
                </button>
                <button
                  class="toolbar-btn"
                  :class="showAiEditor ? 'toolbar-btn-active' : ''"
                  @click="showAiEditor = !showAiEditor"
                  title="Toggle AI SQL Editor"
                >
                  <i class="pi pi-sparkles"></i>
                  <span>AI Editor</span>
                </button>

                <!-- Limit selector -->
                <div class="flex items-center gap-1 ml-2">
                  <span class="text-xs text-slate-500 mr-1">Limit:</span>
                  <button
                    v-for="opt in LIMIT_OPTIONS"
                    :key="opt"
                    class="limit-pill"
                    :class="
                      limitValue === opt
                        ? 'limit-pill-active'
                        : 'limit-pill-inactive'
                    "
                    @click="limitValue = opt"
                  >
                    {{ opt >= 1000 ? opt / 1000 + "K" : opt }}
                  </button>

                  <!-- Custom limit chip: always shows number, dblclick to edit inline -->
                  <div
                    class="limit-pill limit-custom-chip"
                    :class="
                      isCustomLimit
                        ? 'limit-pill-active'
                        : 'limit-pill-inactive'
                    "
                    @click.stop="limitValue = customLimitValue"
                    @dblclick.stop="enterCustomEdit"
                    title="Custom row limit — double-click to edit"
                  >
                    <span
                      v-if="!isEditingCustom"
                      class="limit-custom-display"
                      >{{ customLimitValue }}</span
                    >
                    <input
                      v-else
                      ref="customLimitInputRef"
                      class="limit-custom-input"
                      type="number"
                      :value="customLimitValue"
                      @change="onCustomLimitChange"
                      @blur="isEditingCustom = false"
                      @keydown.enter.stop="isEditingCustom = false"
                      @keydown.escape.stop="isEditingCustom = false"
                      @click.stop
                    />
                  </div>

                  <button
                    class="limit-pill"
                    :class="
                      limitValue === null
                        ? 'limit-pill-active'
                        : 'limit-pill-inactive'
                    "
                    @click="limitValue = null"
                  >
                    No Limit
                  </button>
                </div>

                <span
                  v-if="file.isExecuting"
                  class="text-xs ml-auto text-amber-500 font-medium"
                  >Executing…</span
                >

                <!-- Unlimited confirm overlay -->
                <div
                  v-if="showLimitConfirm && activeFileId === file.id"
                  class="limit-confirm-overlay"
                >
                  <div class="limit-confirm-box">
                    <p class="text-sm font-semibold text-slate-800">
                      Query returns
                      <span class="text-red-600">{{
                        pendingConfirmCount.toLocaleString()
                      }}</span>
                      rows
                    </p>
                    <p class="text-xs text-slate-500 mt-1">
                      Fetching all rows may crash the page or take a long time.
                    </p>
                    <div class="flex gap-2 mt-3">
                      <button
                        class="toolbar-btn"
                        style="color: var(--p-red-600)"
                        @click="confirmUnlimitedQuery(file)"
                      >
                        Fetch all
                      </button>
                      <button
                        class="toolbar-btn"
                        @click="showLimitConfirm = false"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Editor + bottom panel splitter + AI editor -->
              <div class="flex-1 min-h-0 flex flex-row">
                <!-- Main editor area -->
                <div class="flex-1 min-w-0">
                <vue-splitter is-horizontal data-ignore class="h-full">
                  <template #top-pane>
                    <SuiteQLCodeEditor
                      v-model="file.code"
                      :schema="sqlSchema"
                      :readonly="file.isExecuting"
                      :ref="(el: any) => setEditorRef(file.id, el)"
                      @change="onCodeChange(file.id, $event)"
                      @ctrl-enter="runCurrentQuery"
                    />
                  </template>
                  <template #bottom-pane>
                    <!-- Bottom schema/results panel -->
                    <div class="bottom-panel h-full flex flex-col">
                      <!-- Tab bar -->
                      <div
                        class="bottom-tabbar shrink-0 flex items-center border-b border-slate-200"
                      >
                        <button
                          v-for="btab in bottomTabDefs"
                          :key="btab.id"
                          class="bottom-tab"
                          :class="
                            bottomTab === btab.id
                              ? 'tab-active'
                              : 'tab-inactive'
                          "
                          @click="
                            bottomTab = btab.id;
                            schemaSearch = '';
                            tableFilter = '';
                          "
                        >
                          {{ btab.label }}
                        </button>

                        <!-- Right side of tab bar -->
                        <div class="ml-auto flex items-center gap-2 px-3">
                          <span
                            v-if="
                              file.results.length > 0 && bottomTab === 'results'
                            "
                            class="text-xs font-mono text-emerald-600 font-semibold"
                          >
                            {{ file.results.length
                            }}{{
                              file.totalCount > file.results.length
                                ? ` of ${file.totalCount.toLocaleString()}`
                                : ""
                            }}
                            rows
                          </span>
                          <span
                            v-else-if="file.error && bottomTab === 'results'"
                            class="text-xs text-red-500 font-medium"
                            >Error</span
                          >
                          <template
                            v-if="
                              bottomTab === 'results' && file.results.length > 0
                            "
                          >
                            <button
                              class="schema-action-btn"
                              @click="copyResults(file)"
                            >
                              JSON
                            </button>
                            <button
                              class="schema-action-btn"
                              @click="copyResultsCSV(file)"
                            >
                              CSV
                            </button>
                          </template>

                          <!-- Table filter pills for fields/joins tabs -->
                          <template
                            v-if="
                              (bottomTab === 'fields' ||
                                bottomTab === 'joins') &&
                              queryTableIds.length > 1
                            "
                          >
                            <button
                              class="table-pill"
                              :class="
                                tableFilter === ''
                                  ? 'table-pill-active'
                                  : 'table-pill-inactive'
                              "
                              @click="tableFilter = ''"
                            >
                              All
                            </button>
                            <button
                              v-for="tid in queryTableIds"
                              :key="tid"
                              class="table-pill"
                              :class="
                                tableFilter === tid
                                  ? 'table-pill-active'
                                  : 'table-pill-inactive'
                              "
                              @click="tableFilter = tid"
                            >
                              {{ tid }}
                            </button>
                          </template>

                          <input
                            v-if="bottomTab !== 'results'"
                            v-model="schemaSearch"
                            placeholder="Search…"
                            class="schema-search-input"
                          />
                        </div>
                      </div>

                      <!-- Tab content -->
                      <div class="flex-1 overflow-auto">
                        <!-- Results -->
                        <div v-show="bottomTab === 'results'" class="h-full">
                          <table
                            v-if="file.results.length > 0"
                            class="results-table w-full"
                          >
                            <thead>
                              <tr>
                                <th v-for="col in file.columns" :key="col">
                                  {{ col }}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr v-for="(row, idx) in file.results" :key="idx">
                                <td v-for="col in file.columns" :key="col">
                                  {{ row[col] ?? "" }}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          <div
                            v-else-if="file.error"
                            class="p-4 text-sm font-mono whitespace-pre-wrap text-red-500"
                          >
                            {{ file.error }}
                          </div>
                          <div
                            v-else
                            class="flex flex-col items-center justify-center h-full gap-2 text-slate-400"
                          >
                            <i class="pi pi-table text-2xl"></i>
                            <span class="text-sm"
                              >Run a query to see results</span
                            >
                            <span class="text-xs opacity-60">Ctrl+Enter</span>
                          </div>
                        </div>

                        <!-- Tables browser -->
                        <div v-show="bottomTab === 'tables'" class="p-3">
                          <div
                            v-if="isLoadingTables"
                            class="flex items-center justify-center py-10 gap-2 text-slate-400"
                          >
                            <i class="pi pi-spin pi-spinner"></i>
                            Loading tables…
                          </div>
                          <div v-else class="tables-grid">
                            <div
                              v-for="table in filteredSchemaTables"
                              :key="table.id"
                              class="table-card"
                              :class="{
                                'table-card-selected':
                                  selectedTableId === table.id,
                                'table-card-in-query': queryTableIds.includes(
                                  table.id
                                )
                              }"
                              @click="handleTableClick(table)"
                              :title="table.label"
                            >
                              <div class="table-card-id">{{ table.id }}</div>
                              <div class="table-card-label">
                                {{ table.label }}
                              </div>
                            </div>
                          </div>
                          <div
                            v-if="
                              !isLoadingTables &&
                              filteredSchemaTables.length === 0
                            "
                            class="text-center py-10 text-sm text-slate-400"
                          >
                            No tables match "{{ schemaSearch }}"
                          </div>
                        </div>

                        <!-- Fields -->
                        <div v-show="bottomTab === 'fields'">
                          <div
                            v-if="
                              queryTableIds.length === 0 &&
                              !selectedTableId &&
                              !isLoadingDetail
                            "
                            class="flex flex-col items-center justify-center py-10 gap-2 text-slate-400"
                          >
                            <i class="pi pi-table text-2xl"></i>
                            <span class="text-sm">
                              Add a table to your query or select one from the
                              <button
                                class="underline text-blue-500"
                                @click="bottomTab = 'tables'"
                              >
                                Tables
                              </button>
                              tab
                            </span>
                          </div>
                          <div
                            v-else-if="isLoadingDetail"
                            class="flex items-center justify-center py-10 gap-2 text-slate-400"
                          >
                            <i class="pi pi-spin pi-spinner"></i>
                            Loading fields…
                          </div>
                          <table
                            v-else-if="filteredSchemaFields.length > 0"
                            class="schema-table w-full"
                          >
                            <thead>
                              <tr>
                                <th>Column ID</th>
                                <th>Label</th>
                                <th>Data Type</th>
                                <th v-if="activeQueryTableCount > 1">
                                  Source Table
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr
                                v-for="field in filteredSchemaFields"
                                :key="`${field.tableId}_${field.id}`"
                                class="schema-row"
                                @click="insertAtCursor(field.id)"
                                :title="`Click to insert '${field.id}' at cursor`"
                              >
                                <td class="font-mono field-id-col">
                                  {{ field.id }}
                                </td>
                                <td class="schema-col-secondary">
                                  {{ field.label }}
                                </td>
                                <td class="font-mono text-xs">
                                  <span class="datatype-badge">{{
                                    field.dataType
                                  }}</span>
                                </td>
                                <td
                                  v-if="activeQueryTableCount > 1"
                                  class="font-mono text-xs"
                                >
                                  <span class="table-badge">{{
                                    field.tableId
                                  }}</span>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          <div
                            v-else-if="activeQueryTableCount > 0"
                            class="text-center py-6 text-sm text-slate-400"
                          >
                            No fields match "{{ schemaSearch }}"
                          </div>
                        </div>

                        <!-- Joins -->
                        <div v-show="bottomTab === 'joins'">
                          <div
                            v-if="
                              queryTableIds.length === 0 && !selectedTableId
                            "
                            class="flex flex-col items-center justify-center py-10 gap-2 text-slate-400"
                          >
                            <i class="pi pi-sitemap text-2xl"></i>
                            <span class="text-sm">
                              Add a table to your query or select one from the
                              <button
                                class="underline text-blue-500"
                                @click="bottomTab = 'tables'"
                              >
                                Tables
                              </button>
                              tab
                            </span>
                          </div>
                          <table
                            v-else-if="filteredSchemaJoins.length > 0"
                            class="schema-table w-full"
                          >
                            <thead>
                              <tr>
                                <th>Join / Relation</th>
                                <th>Target Table</th>
                                <th>Cardinality</th>
                                <th>Type</th>
                                <th>Condition</th>
                                <th v-if="activeQueryTableCount > 1">Source</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr
                                v-for="join in filteredSchemaJoins"
                                :key="`${join.tableId}_${join.id}`"
                                class="schema-row"
                                @click="insertJoinAtCursor(join)"
                                :title="`Click to insert JOIN for '${join.label}'`"
                              >
                                <td class="join-label-col">{{ join.label }}</td>
                                <td class="font-mono text-xs">
                                  <span class="table-badge">{{
                                    join.sourceTargetType?.id || "–"
                                  }}</span>
                                </td>
                                <td class="text-xs schema-col-muted font-mono">
                                  {{ join.cardinality }}
                                </td>
                                <td class="text-xs schema-col-muted">
                                  {{ join.joinType }}
                                </td>
                                <td
                                  class="font-mono text-xs schema-col-truncate schema-col-muted"
                                >
                                  {{
                                    join.sourceTargetType?.joinPairs?.[0]
                                      ?.label || "–"
                                  }}
                                </td>
                                <td
                                  v-if="activeQueryTableCount > 1"
                                  class="font-mono text-xs"
                                >
                                  <span
                                    class="table-badge table-badge-source"
                                    >{{ join.tableId }}</span
                                  >
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          <div
                            v-else-if="activeQueryTableCount > 0"
                            class="text-center py-6 text-sm text-slate-400"
                          >
                            No joins match "{{ schemaSearch }}"
                          </div>
                        </div>
                      </div>
                    </div>
                  </template>
                </vue-splitter>
                </div>

                <!-- AI SQL Editor panel (drag-resizable) -->
                <template v-if="showAiEditor">
                  <div
                    class="ai-panel-resize-handle"
                    @mousedown="startAiPanelResize"
                  />
                  <SqlAiEditor
                    :get-editor-query="getEditorQuery"
                    class="sql-ai-editor-panel"
                    :style="{ width: aiPanelWidth + 'px' }"
                  />
                </template>
              </div>
            </div>
          </template>
        </MTabs>

        <div
          v-if="openTabs.length === 0 && files.length > 0"
          class="flex-1 flex items-center justify-center text-slate-400"
        >
          <div class="text-center">
            <i class="pi pi-folder-open text-4xl mb-2"></i>
            <p>No tabs open</p>
            <p class="text-sm">Click a file in the sidebar to open it</p>
          </div>
        </div>

        <div
          v-else-if="files.length === 0"
          class="flex-1 flex items-center justify-center text-slate-400"
        >
          <div class="text-center">
            <i class="pi pi-database text-4xl mb-2"></i>
            <p>No queries yet</p>
            <Button size="small" class="mt-2" @click="addNewFile">
              <i class="pi pi-plus mr-1"></i>
              New Query
            </Button>
          </div>
        </div>
      </div>
    </template>
  </MCard>
</template>

<script lang="ts" setup>
import {
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  computed,
  nextTick
} from "vue";
import { useRouter } from "vue-router";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { Button } from "primevue";
import { InputText } from "primevue";
import VueSplitter from "@rmp135/vue-splitter";
import SuiteQLCodeEditor from "../components/SuiteQLCodeEditor.vue";
import SqlAiEditor from "../components/SqlAiEditor.vue";

import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MCard from "../components/universal/card/MCard.vue";
import MTabs from "../components/universal/tabs/MTabs.vue";
import MInput from "../components/universal/input/MInput.vue";
import { generateId } from "../utils/utilities";

const router = useRouter();

// ============================================================================
// Types
// ============================================================================

interface QueryFile {
  id: string;
  name: string;
  code: string;
  results: Record<string, any>[];
  columns: string[];
  error: string;
  isExecuting: boolean;
  totalCount: number;
}

interface TableInfo {
  id: string;
  label: string;
  type: string;
  isAvailable?: boolean;
}

interface FieldInfo {
  id: string;
  label: string;
  dataType: string;
  fieldType: string;
  isColumn: boolean;
}

interface JoinInfo {
  id: string;
  label: string;
  joinType: string;
  cardinality: string;
  fieldId: string;
  sourceTargetType?: {
    id: string;
    label: string;
    joinPairs?: Array<{ id: string; label: string }>;
  };
}

interface TableDetail {
  id: string;
  label: string;
  fields: FieldInfo[];
  joins: JoinInfo[];
}

// Enriched row types for aggregated display
interface FieldRow extends FieldInfo {
  tableId: string;
}
interface JoinRow extends JoinInfo {
  tableId: string;
}

// ============================================================================
// State
// ============================================================================

const files = ref<QueryFile[]>([]);
const openTabs = ref<string[]>([]);
const activeFileId = ref("");
const fileSearchTerm = ref("");
const isRestoring = ref(true);

// Schema state
const tables = ref<TableInfo[]>([]);
const isLoadingTables = ref(false);
const isLoadingDetail = ref(false);

// Selected table (from Tables browser click — used for the browse tab)
const selectedTableId = ref("");

// Tables detected from the current active query (FROM + all JOINs)
const queryTableIds = ref<string[]>([]);

// Detail cache keyed by table id (lowercase)
const tableDetailCache = ref<Record<string, TableDetail>>({});

// Bottom panel
const bottomTab = ref("results");
const schemaSearch = ref("");
const tableFilter = ref(""); // "" = all, else a specific table id

// Row limit
const LIMIT_OPTIONS = [10, 100, 500, 1000, 2000, 4000] as const;
const limitValue = ref<number | null>(1000); // null = unlimited
const customLimitValue = ref(250); // always-visible custom number
const isEditingCustom = ref(false);
const customLimitInputRef = ref<HTMLInputElement | null>(null);
const showLimitConfirm = ref(false);
const pendingConfirmCount = ref(0);

const isCustomLimit = computed(
  () =>
    limitValue.value !== null &&
    !(LIMIT_OPTIONS as readonly number[]).includes(limitValue.value)
);

const enterCustomEdit = async () => {
  isEditingCustom.value = true;
  await nextTick();
  customLimitInputRef.value?.focus();
  customLimitInputRef.value?.select();
};

const onCustomLimitChange = (e: Event) => {
  const n = parseInt((e.target as HTMLInputElement).value);
  if (n > 0) {
    customLimitValue.value = n;
    limitValue.value = n;
  }
  isEditingCustom.value = false;
};

// AI Editor panel
const showAiEditor = ref(false);
const aiPanelWidth = ref(340);

const startAiPanelResize = (e: MouseEvent) => {
  const startX = e.clientX;
  const startWidth = aiPanelWidth.value;

  const onMove = (moveEvent: MouseEvent) => {
    const delta = startX - moveEvent.clientX; // drag left = wider
    aiPanelWidth.value = Math.max(240, Math.min(800, startWidth + delta));
  };

  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
};

// Editor refs
const editorRefs = ref<Record<string, any>>({});

// ============================================================================
// Computed
// ============================================================================

const persistedState = computed(() => ({
  files: files.value.map((f) => ({ id: f.id, name: f.name, code: f.code })),
  openTabs: openTabs.value,
  activeTab: activeFileId.value
}));

const tabs = computed(() =>
  openTabs.value
    .map((id) => {
      const file = files.value.find((f) => f.id === id);
      return file ? { name: file.id, label: file.name } : null;
    })
    .filter((t): t is { name: string; label: string } => t !== null)
);

const filteredFiles = computed(() => {
  const term = fileSearchTerm.value.toLowerCase();
  return term
    ? files.value.filter((f) => f.name.toLowerCase().includes(term))
    : files.value;
});

const currentFile = computed(() =>
  files.value.find((f) => f.id === activeFileId.value)
);

// The set of table IDs to show in Fields/Joins tabs:
// prefer queryTableIds; fall back to the manually selected one from the Tables browser
const activeQueryTableIds = computed((): string[] => {
  if (queryTableIds.value.length > 0) return queryTableIds.value;
  if (selectedTableId.value) return [selectedTableId.value];
  return [];
});

const activeQueryTableCount = computed(() => activeQueryTableIds.value.length);

const bottomTabDefs = computed(() => {
  const totalFields = activeQueryTableIds.value.reduce((sum, tid) => {
    const d = tableDetailCache.value[tid];
    return sum + (d ? d.fields.filter((f) => f.isColumn).length : 0);
  }, 0);
  const totalJoins = activeQueryTableIds.value.reduce((sum, tid) => {
    const d = tableDetailCache.value[tid];
    return sum + (d?.joins?.length ?? 0);
  }, 0);

  const defs: { id: string; label: string }[] = [
    { id: "results", label: "Results" },
    {
      id: "tables",
      label: `Tables${tables.value.length ? ` (${tables.value.length})` : ""}`
    }
  ];

  if (activeQueryTableIds.value.length > 0) {
    defs.push({
      id: "fields",
      label: `Fields${totalFields ? ` (${totalFields})` : ""}`
    });
    if (totalJoins > 0) {
      defs.push({ id: "joins", label: `Joins (${totalJoins})` });
    }
  }
  return defs;
});

const filteredSchemaTables = computed(() => {
  const term = schemaSearch.value.toLowerCase();
  if (!term) return tables.value;
  return tables.value.filter(
    (t) =>
      t.id.toLowerCase().includes(term) || t.label.toLowerCase().includes(term)
  );
});

const filteredSchemaFields = computed((): FieldRow[] => {
  const sourceTables = tableFilter.value
    ? [tableFilter.value]
    : activeQueryTableIds.value;

  const all: FieldRow[] = [];
  for (const tid of sourceTables) {
    const detail = tableDetailCache.value[tid];
    if (!detail) continue;
    for (const f of detail.fields.filter((f) => f.isColumn)) {
      all.push({ ...f, tableId: detail.id });
    }
  }

  const term = schemaSearch.value.toLowerCase();
  if (!term) return all;
  return all.filter(
    (f) =>
      f.id.toLowerCase().includes(term) ||
      f.label.toLowerCase().includes(term) ||
      f.tableId.toLowerCase().includes(term) ||
      f.dataType.toLowerCase().includes(term)
  );
});

const filteredSchemaJoins = computed((): JoinRow[] => {
  const sourceTables = tableFilter.value
    ? [tableFilter.value]
    : activeQueryTableIds.value;

  const all: JoinRow[] = [];
  for (const tid of sourceTables) {
    const detail = tableDetailCache.value[tid];
    if (!detail) continue;
    for (const j of detail.joins ?? []) {
      all.push({ ...j, tableId: detail.id });
    }
  }

  const term = schemaSearch.value.toLowerCase();
  if (!term) return all;
  return all.filter(
    (j) =>
      j.id.toLowerCase().includes(term) ||
      j.label.toLowerCase().includes(term) ||
      (j.sourceTargetType?.id ?? "").toLowerCase().includes(term) ||
      j.tableId.toLowerCase().includes(term)
  );
});

// Schema for CodeMirror SQL autocomplete: { tableName: ["col1", "col2", ...] }
const sqlSchema = computed((): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const [tableId, detail] of Object.entries(tableDetailCache.value)) {
    out[tableId.toLowerCase()] = detail.fields.filter((f) => f.isColumn).map((f) => f.id);
  }
  const tableCount = Object.keys(out).length;
  const colCount = Object.values(out).reduce((s, cols) => s + cols.length, 0);
  if (tableCount > 0) {
    console.log(`[SuiteQLView] sqlSchema — ${tableCount} tables, ${colCount} columns`);
  }
  return out;
});

// ============================================================================
// Editor Ref Setup
// ============================================================================

const setEditorRef = (fileId: string, el: any) => {
  if (el) editorRefs.value[fileId] = el;
};

/** Returns the current active editor's SQL (used by AI editor) */
const getEditorQuery = (): string => {
  const file = currentFile.value;
  if (!file) return "";
  const editorEl = editorRefs.value[file.id];
  return editorEl?.getValue() ?? file.code;
};

// ============================================================================
// File Management
// ============================================================================

const addNewFile = () => {
  const newId = generateId();
  files.value.push({
    id: newId,
    name: `query${newId}`,
    code: "SELECT\n    id,\n    entityid\nFROM\n    customer\nWHERE\n    ROWNUM <= 10",
    results: [],
    columns: [],
    error: "",
    isExecuting: false,
    totalCount: 0
  });
  openTabs.value.push(newId);
  activeFileId.value = newId;
};

const openFileInTab = (fileId: string) => {
  if (!openTabs.value.includes(fileId)) openTabs.value.push(fileId);
  activeFileId.value = fileId;
};

const removeFile = (fileId: string) => {
  openTabs.value = openTabs.value.filter((id) => id !== fileId);
  const index = files.value.findIndex((f) => f.id === fileId);
  if (index > -1) files.value.splice(index, 1);
  if (activeFileId.value === fileId) {
    activeFileId.value = openTabs.value[0] || files.value[0]?.id || "";
  }
};

const removeFileByTab = ({
  tabId,
  nextTabId
}: {
  tabId: string;
  nextTabId: string | null;
}) => {
  openTabs.value = openTabs.value.filter((id) => id !== tabId);
  if (activeFileId.value === tabId) {
    activeFileId.value =
      nextTabId || openTabs.value[0] || files.value[0]?.id || "";
  }
};

// ============================================================================
// Table / Schema Operations
// ============================================================================

const fetchTables = async () => {
  console.log("[SuiteQLView] fetchTables — start");
  isLoadingTables.value = true;
  try {
    const response = (await callApi(
      RequestRoutes.FETCH_SUITEQL_TABLES
    )) as ApiResponse;
    const data = response.message;
    const list: any[] = data?.data ?? (Array.isArray(data) ? data : []);
    tables.value = list.map((t: any) => ({
      id: t.id,
      label: t.label,
      type: t.type,
      isAvailable: t.isAvailable
    }));
    console.log(`[SuiteQLView] fetchTables — loaded ${tables.value.length} tables`);
    // Now that table list is loaded, detect tables in the current active file
    const activeFile = files.value.find((f) => f.id === activeFileId.value);
    if (activeFile?.code) await detectAndLoadTablesFromQuery(activeFile.code);
  } catch (error) {
    console.error("[SuiteQLView] fetchTables — error:", error);
  } finally {
    isLoadingTables.value = false;
  }
};

/** Load detail for one table into the cache */
const loadTableDetail = async (table: TableInfo): Promise<void> => {
  if (tableDetailCache.value[table.id]) {
    console.log(`[SuiteQLView] loadTableDetail — "${table.id}" already cached, skipping`);
    return;
  }
  console.log(`[SuiteQLView] loadTableDetail — fetching "${table.id}"`);
  isLoadingDetail.value = true;
  try {
    const response = (await callApi(RequestRoutes.FETCH_SUITEQL_TABLE_DETAIL, {
      tableName: table.id
    })) as ApiResponse;
    const data = response.message;
    const raw = data?.data ?? data ?? {};
    const detail: TableDetail = {
      id: raw.id || table.id,
      label: raw.label || table.label,
      fields: (raw.fields ?? []).map((f: any) => ({
        id: f.id,
        label: f.label,
        dataType: f.dataType,
        fieldType: f.fieldType,
        isColumn: f.isColumn
      })),
      joins: (raw.joins ?? []).map((j: any) => ({
        id: j.id,
        label: j.label,
        joinType: j.joinType,
        cardinality: j.cardinality,
        fieldId: j.fieldId,
        sourceTargetType: j.sourceTargetType
      }))
    };
    const colCount = detail.fields.filter((f) => f.isColumn).length;
    console.log(`[SuiteQLView] loadTableDetail — "${table.id}" OK: ${colCount} columns, ${detail.joins.length} joins`);
    tableDetailCache.value[table.id] = detail;
  } catch (error) {
    console.error(`[SuiteQLView] loadTableDetail — error for "${table.id}":`, error);
  } finally {
    isLoadingDetail.value = false;
  }
};

/** Click in the Tables browser tab — select + switch to Fields */
const handleTableClick = (table: TableInfo) => {
  selectedTableId.value = table.id;
  loadTableDetail(table);
  bottomTab.value = "fields";
};

/** Extract ALL table names from FROM + every JOIN clause and load their details */
const detectAndLoadTablesFromQuery = async (sql: string) => {
  if (!tables.value.length) {
    console.log("[SuiteQLView] detectAndLoad — tables list empty, skipping");
    return;
  }

  const matches = [...sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)];
  const found = matches.map((m) => m[1]).filter((n): n is string => Boolean(n));
  const unique = [...new Set(found.map((n) => n.toLowerCase()))];

  const resolved = unique
    .map((name) => tables.value.find((t) => t.id.toLowerCase() === name))
    .filter((t): t is TableInfo => Boolean(t));

  const unresolved = unique.filter(
    (name) => !tables.value.find((t) => t.id.toLowerCase() === name)
  );

  console.log(
    `[SuiteQLView] detectAndLoad — found: [${resolved.map((t) => t.id).join(", ")}]` +
    (unresolved.length ? ` | unresolved: [${unresolved.join(", ")}]` : "")
  );

  queryTableIds.value = resolved.map((t) => t.id);

  // Load details for any table not yet cached (in parallel)
  await Promise.all(resolved.map((t) => loadTableDetail(t)));
};

// ============================================================================
// Insert at Cursor
// ============================================================================

const insertAtCursor = (text: string) => {
  editorRefs.value[activeFileId.value]?.insertText(text);
};

const insertJoinAtCursor = (join: JoinRow) => {
  if (!join.sourceTargetType) return;
  const joinPair = join.sourceTargetType.joinPairs?.[0];
  const joinKeyword = join.joinType === "INVERSE" ? "LEFT JOIN" : "INNER JOIN";
  const clause = joinPair
    ? `\n${joinKeyword} ${join.sourceTargetType.id}\n    ON ${joinPair.label}`
    : `\n${joinKeyword} ${join.sourceTargetType.id}\n    ON -- ${join.label}`;
  insertAtCursor(clause);
};

// ============================================================================
// Format SQL
// ============================================================================

const formatSQL = (sql: string): string => {
  // Normalize all whitespace (including existing newlines) to single spaces — makes it idempotent
  let result = sql.trim().replace(/\s+/g, " ");

  // Uppercase multi-word keywords first (order matters: longer before shorter)
  const multiWordKeywords = [
    "SELECT DISTINCT",
    "IS NOT NULL",
    "IS NULL",
    "NOT LIKE",
    "NOT BETWEEN",
    "NOT IN",
    "INNER JOIN",
    "LEFT OUTER JOIN",
    "RIGHT OUTER JOIN",
    "FULL OUTER JOIN",
    "LEFT JOIN",
    "RIGHT JOIN",
    "CROSS JOIN",
    "ORDER BY",
    "GROUP BY",
    "UNION ALL"
  ];
  multiWordKeywords.forEach((kw) => {
    result = result.replace(new RegExp(`\\b${kw}\\b`, "gi"), kw);
  });

  // Uppercase single keywords
  const singleKeywords = [
    "SELECT",
    "FROM",
    "WHERE",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "UNION",
    "JOIN",
    "ON",
    "AND",
    "OR",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "COUNT",
    "SUM",
    "AVG",
    "MIN",
    "MAX",
    "ROWNUM",
    "ASC",
    "DESC",
    "COALESCE",
    "NULLIF",
    "CAST",
    "UPPER",
    "LOWER",
    "TRIM",
    "AS",
    "NULL",
    "NOT",
    "IN",
    "LIKE",
    "BETWEEN",
    "DISTINCT",
    "EXISTS",
    "ALL",
    "ANY"
  ];
  singleKeywords.forEach((kw) => {
    result = result.replace(new RegExp(`\\b(${kw})\\b`, "gi"), kw);
  });

  // Add newlines before major clauses
  [
    "FROM",
    "WHERE",
    "ORDER BY",
    "GROUP BY",
    "HAVING",
    "LIMIT",
    "OFFSET",
    "UNION ALL",
    "UNION"
  ].forEach((clause) => {
    result = result.replace(new RegExp(` (${clause})\\b`, "g"), "\n$1");
  });

  // Add newlines before JOIN clauses
  [
    "INNER JOIN",
    "LEFT OUTER JOIN",
    "RIGHT OUTER JOIN",
    "FULL OUTER JOIN",
    "LEFT JOIN",
    "RIGHT JOIN",
    "CROSS JOIN",
    "JOIN"
  ].forEach((j) => {
    result = result.replace(new RegExp(` (${j})\\b`, "g"), "\n$1");
  });

  // Indent ON
  result = result.replace(/ ON\b/g, "\n    ON");

  // Indent AND/OR in WHERE clause
  result = result.replace(/ (AND|OR)\b/g, "\n    $1");

  // Format SELECT columns: one per line, indented
  result = result.replace(
    /^(SELECT(?:\s+DISTINCT)?)(.*?)(?=\nFROM)/ms,
    (_, selectKw: string, cols: string) => {
      const items = cols.split(",").map((item: string, idx: number) => {
        const trimmed = item.trim();
        return idx === 0 ? `\n    ${trimmed}` : `    ${trimmed}`;
      });
      return `${selectKw}${items.join(",\n")}`;
    }
  );

  return result.trim();
};

const formatCurrentSQL = (fileId: string) => {
  const file = files.value.find((f) => f.id === fileId);
  if (!file) return;
  const editorEl = editorRefs.value[fileId];
  const current = editorEl?.getValue() ?? file.code;
  const formatted = formatSQL(current);
  editorEl?.setValue(formatted);
  file.code = formatted;
};

// ============================================================================
// Query Execution
// ============================================================================

const runCurrentQuery = async () => {
  const file = currentFile.value;
  if (!file || file.isExecuting) return;

  showLimitConfirm.value = false;

  // If unlimited, check count first
  if (limitValue.value === null) {
    try {
      const countResp = (await callApi(RequestRoutes.GET_SUITEQL_COUNT, {
        sql: file.code
      })) as ApiResponse;
      if (countResp.status === "ok") {
        const count = countResp.message as number;
        if (count > 4000) {
          pendingConfirmCount.value = count;
          showLimitConfirm.value = true;
          return;
        }
      }
    } catch {
      // proceed anyway
    }
  }

  await executeQuery(file, limitValue.value);
};

const confirmUnlimitedQuery = async (file: QueryFile) => {
  showLimitConfirm.value = false;
  await executeQuery(file, null);
};

const executeQuery = async (file: QueryFile, limit: number | null) => {
  console.log(`[SuiteQLView] executeQuery — file="${file.name}" limit=${limit ?? "none"}`);
  console.log(`[SuiteQLView] SQL:\n${file.code}`);
  file.isExecuting = true;
  file.results = [];
  file.columns = [];
  file.error = "";
  file.totalCount = 0;
  bottomTab.value = "results";

  detectAndLoadTablesFromQuery(file.code);

  try {
    const response = (await callApi(RequestRoutes.RUN_SUITEQL_QUERY, {
      sql: file.code,
      limit
    })) as ApiResponse;
    console.log(`[SuiteQLView] executeQuery — response status: ${response.status}`);
    if (response.status === "error") {
      file.error = response.message || "Query execution failed";
      console.error(`[SuiteQLView] executeQuery — error response:`, response.message);
      return;
    }
    const payload = response.message as
      | { results: Record<string, any>[]; totalCount: number }
      | Record<string, any>[];
    // Handle both old (array) and new ({ results, totalCount }) shape
    const results = Array.isArray(payload)
      ? payload
      : ((payload as any).results ?? []);
    const totalCount = Array.isArray(payload)
      ? results.length
      : ((payload as any).totalCount ?? results.length);
    console.log(`[SuiteQLView] executeQuery — got ${results.length} rows (total: ${totalCount}), payload shape: ${Array.isArray(payload) ? "array" : "object"}`);
    if (results.length > 0) {
      file.columns = Object.keys(results[0]);
      file.results = results;
      file.totalCount = totalCount;
    } else {
      file.error = "Query returned 0 rows";
    }
  } catch (error: any) {
    console.error("[SuiteQLView] executeQuery — caught exception:", error);
    file.error = `Execution failed: ${error?.message ?? error}`;
  } finally {
    file.isExecuting = false;
  }
};

// ============================================================================
// Open in RunQuickScript
// ============================================================================

const openInRunQuickScript = (file: QueryFile) => {
  const wrappedCode = `const sql = \`
${file.code}
\`;

const queryConfig = { query: sql };
const resultSet = await query.runSuiteQL.promise(queryConfig);
const results = resultSet.asMappedResults();

console.log('${file.name} results:', results.length, results);`;

  const newId = generateId();
  const newFile = { id: newId, name: `sql_${file.name}`, code: wrappedCode };

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.set({ rqs_pendingFile: newFile }, () => {
      router.push("/run-quick-script");
    });
  } else {
    router.push("/run-quick-script");
  }
};

// ============================================================================
// Code Change Handler
// ============================================================================

let detectDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const onCodeChange = (fileId: string, newCode: string) => {
  if (fileId !== activeFileId.value) return;
  if (detectDebounceTimer !== null) clearTimeout(detectDebounceTimer);
  detectDebounceTimer = setTimeout(() => {
    detectDebounceTimer = null;
    detectAndLoadTablesFromQuery(newCode);
  }, 400);
};

// ============================================================================
// Copy Helpers
// ============================================================================

const copyResults = async (file: QueryFile) => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(file.results, null, 2));
  } catch {
    /* silent */
  }
};

const copyResultsCSV = async (file: QueryFile) => {
  if (!file.results.length) return;
  const header = file.columns.join(",");
  const rows = file.results.map((r) =>
    file.columns
      .map((c) => {
        const val = String(r[c] ?? "");
        return val.includes(",") || val.includes('"') || val.includes("\n")
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      })
      .join(",")
  );
  try {
    await navigator.clipboard.writeText([header, ...rows].join("\n"));
  } catch {
    /* silent */
  }
};

// ============================================================================
// Persistence
// ============================================================================

type SaveStatus = "idle" | "saving" | "saved" | "error";
const saveStatus = ref<SaveStatus>("idle");
let saveTimeout: number | undefined;

const STORAGE_KEYS = {
  files: "suiteql_cachedFiles",
  tabs: "suiteql_cachedOpenTabs",
  active: "suiteql_cachedActiveTab"
};

const saveAllFiles = (state: any) => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  saveStatus.value = "saving";
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = window.setTimeout(() => {
    chrome.storage.local.set(
      {
        [STORAGE_KEYS.files]: state.files,
        [STORAGE_KEYS.tabs]: state.openTabs,
        [STORAGE_KEYS.active]: state.activeTab
      },
      () => {
        if (chrome.runtime.lastError) {
          saveStatus.value = "error";
          return;
        }
        saveStatus.value = "saved";
        setTimeout(() => {
          if (saveStatus.value === "saved") saveStatus.value = "idle";
        }, 1500);
      }
    );
  }, 1000);
};

watch(
  persistedState,
  (state) => {
    if (isRestoring.value) return;
    saveAllFiles(state);
  },
  { deep: true }
);

// When switching tabs, detect tables in the newly active file's SQL
watch(activeFileId, (id) => {
  if (!id) return;
  queryTableIds.value = [];
  tableFilter.value = "";
  const file = files.value.find((f) => f.id === id);
  if (file?.code) detectAndLoadTablesFromQuery(file.code);
});

// ============================================================================
// Lifecycle
// ============================================================================

const handleGlobalKeydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    runCurrentQuery();
  }
};

onMounted(() => {
  window.addEventListener("keydown", handleGlobalKeydown);
  fetchTables(); // also triggers detectAndLoadTablesFromQuery after tables load

  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    isRestoring.value = false;
    return;
  }

  chrome.storage.local.get(
    [STORAGE_KEYS.files, STORAGE_KEYS.tabs, STORAGE_KEYS.active],
    (result) => {
      try {
        const restoredFiles = Array.isArray(result[STORAGE_KEYS.files])
          ? result[STORAGE_KEYS.files].map((f: any) => ({
              id: f.id || generateId(),
              name: f.name || "query.sql",
              code: f.code || "",
              results: [],
              columns: [],
              error: "",
              isExecuting: false,
              totalCount: 0
            }))
          : [];

        files.value = restoredFiles;

        let cachedTabs: string[] = [];
        if (Array.isArray(result[STORAGE_KEYS.tabs])) {
          cachedTabs = result[STORAGE_KEYS.tabs];
        } else if (
          result[STORAGE_KEYS.tabs] &&
          typeof result[STORAGE_KEYS.tabs] === "object"
        ) {
          cachedTabs = Object.values(result[STORAGE_KEYS.tabs]);
        }

        const validTabs = cachedTabs.filter((id: string) =>
          restoredFiles.some((file: QueryFile) => file.id === id)
        );
        openTabs.value = validTabs;

        const active = result[STORAGE_KEYS.active];
        activeFileId.value =
          typeof active === "string" && openTabs.value.includes(active)
            ? active
            : openTabs.value[0] || "";
      } catch (error) {
        console.error("Restore failed:", error);
        openTabs.value = [];
        activeFileId.value = "";
        chrome.storage.local.remove([STORAGE_KEYS.tabs, STORAGE_KEYS.active]);
      }
      isRestoring.value = false;
      // fetchTables (async above) will call detectAndLoadTablesFromQuery once tables arrive
    }
  );
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalKeydown);
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const filesData = files.value.map((f) => ({
        id: f.id,
        name: f.name,
        code: f.code
      }));
      chrome.storage.local.set({
        [STORAGE_KEYS.files]: filesData,
        [STORAGE_KEYS.tabs]: openTabs.value,
        [STORAGE_KEYS.active]: activeFileId.value
      });
    }
  } catch (error) {
    console.error(error);
  }
});
</script>

<style scoped>
/* ── Sidebar ── */
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

.file-item {
  font-size: 0.8125rem;
}

/* ── Editor toolbar ── */
.editor-toolbar {
  background: var(--p-slate-50);
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 3px 9px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--p-slate-600);
  border: 1px solid var(--p-slate-200);
  background: white;
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
}

.toolbar-btn:hover {
  color: var(--p-slate-800);
  border-color: var(--p-slate-400);
  background: var(--p-slate-50);
}

.toolbar-btn i {
  font-size: 0.7rem;
}

/* ── Limit pills ── */
.limit-pill {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  border: 1px solid var(--p-slate-300);
  cursor: pointer;
  transition:
    background 0.1s,
    color 0.1s;
  white-space: nowrap;
}
.limit-pill-active {
  background: var(--p-slate-700);
  color: var(--p-slate-50);
  border-color: var(--p-slate-700);
}
.limit-pill-inactive {
  background: transparent;
  color: var(--p-slate-500);
}
.limit-pill-inactive:hover {
  background: var(--p-slate-200);
  color: var(--p-slate-700);
}
.limit-custom-chip {
  /* Fixed dimensions — span and input are identical size, zero layout shift */
  width: 3.2rem;
  padding: 0.15rem 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.limit-custom-display {
  font-size: 0.68rem;
  font-weight: 600;
  text-align: center;
  width: 100%;
  user-select: none;
  line-height: 1;
}
.limit-custom-input {
  font-size: 0.68rem;
  font-weight: 600;
  text-align: center;
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: inherit;
  padding: 0;
  line-height: 1;
  /* Hide number spinners */
  -moz-appearance: textfield;
}
.limit-custom-input::-webkit-outer-spin-button,
.limit-custom-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* ── Unlimited confirm overlay ── */
.limit-confirm-overlay {
  position: absolute;
  inset: 0;
  background: rgba(248, 250, 252, 0.9);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  backdrop-filter: blur(2px);
}
.limit-confirm-box {
  background: white;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  max-width: 320px;
}

/* ── Bottom panel ── */
.bottom-panel {
  background: var(--p-slate-50);
}

.bottom-tabbar {
  background: var(--p-slate-100);
  min-height: 34px;
}

.bottom-tab {
  cursor: pointer;
  border-top: 2px solid transparent;
  border-bottom: 2px solid transparent;
  user-select: none;
  font-size: 0.72rem;
  padding: 0.45rem 0.9rem;
  color: var(--p-slate-400);
  transition:
    color 0.12s,
    background 0.12s;
  white-space: nowrap;
}

.tab-active {
  color: var(--p-slate-800);
  border-top-color: var(--p-blue-500, #3b82f6);
  background: var(--p-slate-50);
  font-weight: 600;
}

.tab-inactive:hover {
  color: var(--p-slate-600);
  background: var(--p-slate-200);
}

/* ── Table filter pills ── */
.table-pill {
  font-size: 0.65rem;
  padding: 2px 7px;
  border-radius: 999px;
  cursor: pointer;
  border: 1px solid var(--p-slate-300);
  font-family: "Consolas", monospace;
  transition: all 0.12s;
  white-space: nowrap;
}

.table-pill-inactive {
  background: white;
  color: var(--p-slate-500);
}

.table-pill-inactive:hover {
  border-color: var(--p-blue-400, #60a5fa);
  color: var(--p-blue-600, #2563eb);
}

.table-pill-active {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
  font-weight: 600;
}

/* ── Schema search ── */
.schema-search-input {
  background: white;
  border: 1px solid var(--p-slate-300);
  border-radius: 4px;
  color: var(--p-slate-700);
  font-size: 0.75rem;
  padding: 3px 8px;
  outline: none;
  width: 160px;
  font-family: inherit;
}
.schema-search-input::placeholder {
  color: var(--p-slate-400);
}
.schema-search-input:focus {
  border-color: #93c5fd;
}

/* ── Copy buttons ── */
.schema-action-btn {
  font-size: 0.68rem;
  padding: 2px 7px;
  border-radius: 3px;
  color: var(--p-slate-500);
  border: 1px solid var(--p-slate-300);
  background: white;
  cursor: pointer;
  transition: all 0.12s;
}
.schema-action-btn:hover {
  color: var(--p-slate-700);
  background: var(--p-slate-100);
  border-color: var(--p-slate-400);
}

/* ── Results table ── */
.results-table {
  border-collapse: collapse;
  font-family: "Consolas", "Monaco", monospace;
  font-size: 0.75rem;
}

.results-table th {
  background: var(--p-slate-100);
  color: var(--p-slate-700);
  padding: 6px 14px;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid var(--p-slate-200);
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
}

.results-table td {
  padding: 4px 14px;
  border-bottom: 1px solid var(--p-slate-100);
  white-space: nowrap;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--p-slate-700);
}

.results-table tr:hover td {
  background: #eff6ff;
}
.results-table tr:nth-child(even) td {
  background: var(--p-slate-50);
}
.results-table tr:nth-child(even):hover td {
  background: #eff6ff;
}

/* ── Schema tables (fields / joins) ── */
.schema-table {
  border-collapse: collapse;
  font-size: 0.75rem;
  width: 100%;
}

.schema-table th {
  background: var(--p-slate-100);
  color: var(--p-slate-500);
  padding: 5px 14px;
  text-align: left;
  font-weight: 600;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 2px solid var(--p-slate-200);
  position: sticky;
  top: 0;
  z-index: 1;
  white-space: nowrap;
}

.schema-row td {
  padding: 5px 14px;
  border-bottom: 1px solid var(--p-slate-100);
  cursor: pointer;
  color: var(--p-slate-700);
}

.schema-row:hover td {
  background: #eff6ff;
}

/* Reserve space for ↵ hint so width never shifts */
.schema-row td:first-child {
  white-space: nowrap;
}
.schema-row td:first-child::after {
  content: " ↵";
  font-size: 0.6rem;
  color: #93c5fd;
  visibility: hidden;
}
.schema-row:hover td:first-child::after {
  visibility: visible;
}

/* Field ID column — indigo/violet to contrast */
.field-id-col {
  color: #4f46e5;
  font-weight: 600;
}

/* Join label column — blue */
.join-label-col {
  color: #1d4ed8;
  font-weight: 500;
}

/* Data type badge */
.datatype-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  background: #ecfdf5;
  color: #065f46;
  border: 1px solid #a7f3d0;
  font-size: 0.65rem;
  font-family: "Consolas", monospace;
}

/* Table name badge */
.table-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
  font-size: 0.65rem;
  font-family: "Consolas", monospace;
}

.table-badge-source {
  background: #faf5ff;
  color: #7c3aed;
  border-color: #ddd6fe;
}

/* Utility column helpers */
.schema-col-secondary {
  color: var(--p-slate-600);
}
.schema-col-muted {
  color: var(--p-slate-400);
}
.schema-col-truncate {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Tables grid ── */
.tables-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 6px;
}

.table-card {
  padding: 8px 10px;
  border: 1px solid var(--p-slate-200);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.12s;
  background: white;
}

.table-card:hover {
  border-color: #93c5fd;
  background: #eff6ff;
}

.table-card-selected {
  border-color: #3b82f6 !important;
  background: #dbeafe !important;
}

/* Tables that are referenced in the current query get a subtle accent */
.table-card-in-query {
  border-color: #a5b4fc;
  background: #f5f3ff;
}

.table-card-in-query:hover {
  border-color: #818cf8;
  background: #ede9fe;
}

.table-card-id {
  font-family: "Consolas", monospace;
  font-size: 0.7rem;
  font-weight: 700;
  color: #4f46e5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table-card-label {
  font-size: 0.65rem;
  color: var(--p-slate-400);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

/* Sidebar input sizing */
.sidebar-section :deep(.p-inputtext) {
  font-size: 0.75rem;
}

/* ── AI Editor toggle ── */
.toolbar-btn-active {
  background: var(--p-blue-50, #eff6ff) !important;
  color: var(--p-blue-600, #2563eb) !important;
  border-color: var(--p-blue-300, #93c5fd) !important;
}

/* ── AI Editor panel (drag-resizable) ── */
.sql-ai-editor-panel {
  flex-shrink: 0;
  min-width: 240px;
  max-width: 800px;
  overflow: hidden;
}

/* ── Drag handle between main editor and AI panel ── */
.ai-panel-resize-handle {
  width: 5px;
  flex-shrink: 0;
  cursor: col-resize;
  background: var(--p-slate-200);
  transition: background 0.12s;
  position: relative;
  z-index: 1;
}

.ai-panel-resize-handle:hover,
.ai-panel-resize-handle:active {
  background: var(--p-blue-400, #60a5fa);
}
</style>
