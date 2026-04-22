<template>
  <ViewHeader />

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
      <ExpandableSidebar>
        <template #collapsed>
          <button
            class="p-2 rounded bg-slate-600 hover:opacity-100 hover:bg-slate-500 transition-opacity duration-150 text-[var(--p-slate-50)]"
            @click="runCurrentQuery"
            :disabled="currentFile?.isExecuting"
            :title="currentFile?.isExecuting ? 'Running...' : 'Run Query'"
            size="small"
          >
            <i class="pi pi-play text-sm"></i>
          </button>
        </template>
        <template #default>
          <!-- Actions -->
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
                class="w-full"
                severity="secondary"
              >
                <i class="pi pi-refresh font-medium"></i>
                {{ isLoadingTables ? "Loading..." : "Refresh Tables" }}
              </Button>
              <div class="text-xs text-gray-500">
                <span v-if="saveStatus === 'saving'" class="text-yellow-500">
                  Syncing…
                </span>
                <span v-else-if="saveStatus === 'saved'" class="text-green-500">
                  ✓ Saved
                </span>
                <span v-else-if="saveStatus === 'error'" class="text-red-500">
                  Save failed
                </span>
              </div>
            </div>
          </div>

          <!-- Files -->
          <div class="sidebar-section">
            <h4>Query Files</h4>
            <InputText
              v-model="fileSearchTerm"
              type="text"
              placeholder="Search files..."
              size="small"
              class="w-full mb-2"
            />
            <div class="flex flex-col gap-1 max-h-32 overflow-y-auto pr-2">
              <div
                v-for="file in filteredFiles"
                :key="file.id"
                class="file-item flex items-center gap-2 py-2 px-4 rounded cursor-pointer hover:bg-slate-200 transition-colors group"
                :class="{ 'bg-slate-200': activeFileId === file.id }"
                @click="openFileInTab(file.id)"
              >
                <i class="pi pi-database text-sm" style="color: var(--p-slate-600)"></i>
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

          <!-- Tables Browser -->
          <div class="sidebar-section">
            <h4>Tables ({{ tables.length }})</h4>
            <InputText
              v-model="tableSearchTerm"
              type="text"
              placeholder="Search tables..."
              size="small"
              class="w-full mb-2"
            />
            <div class="flex flex-col gap-1 text-xs max-h-48 overflow-y-auto">
              <div
                v-for="table in filteredTables"
                :key="table.id"
                class="table-item py-1 px-2 rounded cursor-pointer hover:bg-slate-200 transition-colors"
                :class="{ 'bg-blue-100': selectedTableId === table.id }"
                @click="selectTable(table)"
              >
                <div class="font-medium truncate">{{ table.id }}</div>
                <div class="text-gray-400 truncate">{{ table.label }}</div>
              </div>
            </div>
          </div>

          <!-- Table Detail -->
          <div v-if="selectedTableDetail" class="sidebar-section">
            <h4>{{ selectedTableDetail.id }} Fields</h4>
            <InputText
              v-model="fieldSearchTerm"
              type="text"
              placeholder="Search fields..."
              size="small"
              class="w-full mb-2"
            />
            <div class="flex flex-col gap-1 text-xs max-h-40 overflow-y-auto">
              <div
                v-for="field in filteredFields"
                :key="field.id"
                class="py-1 px-2 rounded hover:bg-slate-200 cursor-pointer"
                @click="insertFieldAtCursor(field.id)"
                :title="`${field.label} (${field.dataType})`"
              >
                <div class="flex justify-between items-center">
                  <span class="font-mono truncate">{{ field.id }}</span>
                  <span class="text-gray-400 ml-1 shrink-0">{{ field.dataType }}</span>
                </div>
                <div class="text-gray-400 truncate">{{ field.label }}</div>
              </div>
            </div>

            <!-- Joins -->
            <div v-if="selectedTableDetail.joins?.length" class="mt-2">
              <h4>Joins ({{ selectedTableDetail.joins.length }})</h4>
              <InputText
                v-model="joinSearchTerm"
                type="text"
                placeholder="Search joins..."
                size="small"
                class="w-full mb-2"
              />
              <div class="flex flex-col gap-1 text-xs max-h-32 overflow-y-auto">
                <div
                  v-for="join in filteredJoins"
                  :key="join.id"
                  class="py-1 px-2 rounded hover:bg-slate-200 cursor-pointer"
                  @click="insertJoinAtCursor(join)"
                  :title="getJoinTooltip(join)"
                >
                  <div class="font-mono truncate text-blue-600">{{ join.label }}</div>
                  <div class="text-gray-400 truncate">
                    {{ join.cardinality }} · {{ join.joinType }}
                    <span v-if="join.sourceTargetType"> → {{ join.sourceTargetType.id }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </ExpandableSidebar>

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
              class="h-full"
              :style="{ height: `${contentHeight}px` }"
            >
              <vue-splitter is-horizontal data-ignore class="h-full">
                <template #top-pane>
                  <MonacoCodeEditor
                    v-model="file.code"
                    language="sql"
                    :readonly="file.isExecuting"
                    :completion-items="sqlCompletionItems"
                    :ref="(el: any) => setEditorRef(file.id, el)"
                  />
                </template>
                <template #bottom-pane>
                  <div class="results-pane h-full flex flex-col">
                    <!-- Results toolbar -->
                    <div class="flex items-center gap-2 px-3 py-1 bg-slate-100 border-b text-xs">
                      <span v-if="file.results.length > 0" class="text-green-600">
                        {{ file.results.length }} rows returned
                      </span>
                      <span v-else-if="file.error" class="text-red-500">
                        {{ file.error }}
                      </span>
                      <span v-else class="text-gray-400">
                        Run a query to see results
                      </span>
                      <button
                        v-if="file.results.length > 0"
                        class="ml-auto px-2 py-1 rounded hover:bg-slate-200"
                        @click="copyResults(file)"
                        title="Copy as JSON"
                      >
                        <i class="pi pi-clipboard text-xs"></i>
                      </button>
                      <button
                        v-if="file.results.length > 0"
                        class="px-2 py-1 rounded hover:bg-slate-200"
                        @click="copyResultsCSV(file)"
                        title="Copy as CSV"
                      >
                        CSV
                      </button>
                    </div>
                    <!-- Results table -->
                    <div class="flex-1 overflow-auto">
                      <table v-if="file.results.length > 0" class="results-table w-full text-xs">
                        <thead>
                          <tr>
                            <th v-for="col in file.columns" :key="col" class="sticky top-0">
                              {{ col }}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="(row, idx) in file.results" :key="idx">
                            <td v-for="col in file.columns" :key="col">
                              {{ row[col] ?? '' }}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      <div v-else-if="file.error" class="p-4 text-red-500 text-sm">
                        {{ file.error }}
                      </div>
                    </div>
                  </div>
                </template>
              </vue-splitter>
            </div>
          </template>
        </MTabs>

        <div
          v-if="openTabs.length === 0 && files.length > 0"
          class="flex-1 flex items-center justify-center text-gray-500"
        >
          <div class="text-center">
            <i class="pi pi-folder-open text-4xl mb-2"></i>
            <p>No tabs open</p>
            <p class="text-sm">Click a file in the sidebar to open it</p>
          </div>
        </div>

        <div
          v-else-if="files.length === 0"
          class="flex-1 flex items-center justify-center text-gray-500"
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
import { onBeforeUnmount, onMounted, ref, watch, computed } from "vue";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { Button } from "primevue";
import { InputText } from "primevue";
import VueSplitter from "@rmp135/vue-splitter";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import ViewHeader from "../components/ViewHeader.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MCard from "../components/universal/card/MCard.vue";
import MTabs from "../components/universal/tabs/MTabs.vue";
import MInput from "../components/universal/input/MInput.vue";
import { generateId } from "../utils/utilities";

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
    joinPairs?: Array<{
      id: string;
      label: string;
    }>;
  };
}

interface TableDetail {
  id: string;
  label: string;
  fields: FieldInfo[];
  joins: JoinInfo[];
}

// ============================================================================
// State
// ============================================================================

const files = ref<QueryFile[]>([]);
const openTabs = ref<string[]>([]);
const activeFileId = ref("");
const fileSearchTerm = ref("");
const isRestoring = ref(true);

// Tables state
const tables = ref<TableInfo[]>([]);
const tableSearchTerm = ref("");
const selectedTableId = ref("");
const selectedTableDetail = ref<TableDetail | null>(null);
const fieldSearchTerm = ref("");
const joinSearchTerm = ref("");
const isLoadingTables = ref(false);
const tableDetailCache = ref<Record<string, TableDetail>>({});

// Editor refs for inserting text at cursor
const editorRefs = ref<Record<string, any>>({});

const setEditorRef = (fileId: string, el: any) => {
  if (el) {
    editorRefs.value[fileId] = el;
  }
};

// ============================================================================
// Computed
// ============================================================================

const persistedState = computed(() => ({
  files: files.value.map(f => ({
    id: f.id,
    name: f.name,
    code: f.code
  })),
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
  if (!term) return files.value;
  return files.value.filter((f) => f.name.toLowerCase().includes(term));
});

const filteredTables = computed(() => {
  const term = tableSearchTerm.value.toLowerCase();
  if (!term) return tables.value;
  return tables.value.filter(
    (t) =>
      t.id.toLowerCase().includes(term) ||
      t.label.toLowerCase().includes(term)
  );
});

const filteredFields = computed(() => {
  if (!selectedTableDetail.value?.fields) return [];
  const term = fieldSearchTerm.value.toLowerCase();
  const fields = selectedTableDetail.value.fields.filter((f) => f.isColumn);
  if (!term) return fields;
  return fields.filter(
    (f) =>
      f.id.toLowerCase().includes(term) ||
      f.label.toLowerCase().includes(term)
  );
});

const filteredJoins = computed(() => {
  if (!selectedTableDetail.value?.joins) return [];
  const term = joinSearchTerm.value.toLowerCase();
  if (!term) return selectedTableDetail.value.joins;
  return selectedTableDetail.value.joins.filter(
    (j) =>
      j.id.toLowerCase().includes(term) ||
      j.label.toLowerCase().includes(term)
  );
});

const currentFile = computed(() =>
  files.value.find((f) => f.id === activeFileId.value)
);

// SQL completion items built from tables + fields
const sqlCompletionItems = computed(() => {
  const items: Array<{
    label: string;
    kind?: string;
    insertText?: string;
    documentation?: string;
    detail?: string;
  }> = [];

  // SQL keywords
  const keywords = [
    "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE", "BETWEEN",
    "IS", "NULL", "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "LEFT OUTER JOIN",
    "ON", "AS", "ORDER BY", "GROUP BY", "HAVING", "LIMIT", "OFFSET",
    "COUNT", "SUM", "AVG", "MIN", "MAX", "DISTINCT", "CASE", "WHEN",
    "THEN", "ELSE", "END", "UNION", "UNION ALL", "INSERT", "UPDATE",
    "DELETE", "CREATE", "ALTER", "DROP", "EXISTS", "COALESCE", "NULLIF",
    "CAST", "UPPER", "LOWER", "TRIM", "SUBSTRING", "LENGTH", "REPLACE",
    "TO_DATE", "TO_CHAR", "NVL", "NVL2", "DECODE", "BUILTIN.DF", "BUILTIN.CF"
  ];

  keywords.forEach((kw) => {
    items.push({
      label: kw,
      kind: "Keyword",
      insertText: kw,
      detail: "SQL Keyword"
    });
  });

  // Table names
  tables.value.forEach((table) => {
    items.push({
      label: table.id,
      kind: "Class",
      insertText: table.id,
      documentation: table.label,
      detail: "Table"
    });
  });

  // Fields from selected table
  if (selectedTableDetail.value?.fields) {
    selectedTableDetail.value.fields
      .filter((f) => f.isColumn)
      .forEach((field) => {
        items.push({
          label: field.id,
          kind: "Field",
          insertText: field.id,
          documentation: `${field.label} (${field.dataType})`,
          detail: `Field · ${field.dataType}`
        });
      });
  }

  // Fields from cached table details
  Object.values(tableDetailCache.value).forEach((detail) => {
    if (detail.id === selectedTableDetail.value?.id) return;
    detail.fields
      .filter((f) => f.isColumn)
      .forEach((field) => {
        items.push({
          label: `${detail.id}.${field.id}`,
          kind: "Field",
          insertText: `${detail.id}.${field.id}`,
          documentation: `${field.label} (${field.dataType})`,
          detail: `${detail.id} · ${field.dataType}`
        });
      });
  });

  return items;
});

// ============================================================================
// File Management
// ============================================================================

const addNewFile = () => {
  const newId = generateId();
  files.value.push({
    id: newId,
    name: `query${newId}`,
    code: "SELECT\n  id,\n  entityid\nFROM\n  customer\nWHERE\n  ROWNUM <= 10",
    results: [],
    columns: [],
    error: "",
    isExecuting: false
  });
  openTabs.value.push(newId);
  activeFileId.value = newId;
};

const openFileInTab = (fileId: string) => {
  if (!openTabs.value.includes(fileId)) {
    openTabs.value.push(fileId);
  }
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

const removeFileByTab = ({ tabId, nextTabId }: { tabId: string; nextTabId: string | null }) => {
  openTabs.value = openTabs.value.filter((id) => id !== tabId);
  if (activeFileId.value === tabId) {
    activeFileId.value = nextTabId || openTabs.value[0] || files.value[0]?.id || "";
  }
};

// ============================================================================
// Table Operations
// ============================================================================

const fetchTables = async () => {
  isLoadingTables.value = true;
  try {
    const response = await callApi(RequestRoutes.FETCH_SUITEQL_TABLES) as ApiResponse;
    const data = response.message;
    if (data?.data) {
      tables.value = data.data.map((t: any) => ({
        id: t.id,
        label: t.label,
        type: t.type,
        isAvailable: t.isAvailable
      }));
    } else if (Array.isArray(data)) {
      tables.value = data.map((t: any) => ({
        id: t.id,
        label: t.label,
        type: t.type,
        isAvailable: t.isAvailable
      }));
    }
  } catch (error) {
    console.error("Failed to fetch tables:", error);
  } finally {
    isLoadingTables.value = false;
  }
};

const selectTable = async (table: TableInfo) => {
  selectedTableId.value = table.id;
  fieldSearchTerm.value = "";
  joinSearchTerm.value = "";

  // Check cache
  const cachedDetail = tableDetailCache.value[table.id];
  if (cachedDetail) {
    selectedTableDetail.value = cachedDetail;
    return;
  }

  try {
    const response = await callApi(RequestRoutes.FETCH_SUITEQL_TABLE_DETAIL, {
      tableName: table.id
    }) as ApiResponse;
    const data = response.message;
    const detail: TableDetail = {
      id: data?.data?.id || data?.id || table.id,
      label: data?.data?.label || data?.label || table.label,
      fields: (data?.data?.fields || data?.fields || []).map((f: any) => ({
        id: f.id,
        label: f.label,
        dataType: f.dataType,
        fieldType: f.fieldType,
        isColumn: f.isColumn
      })),
      joins: (data?.data?.joins || data?.joins || []).map((j: any) => ({
        id: j.id,
        label: j.label,
        joinType: j.joinType,
        cardinality: j.cardinality,
        fieldId: j.fieldId,
        sourceTargetType: j.sourceTargetType
      }))
    };
    tableDetailCache.value[table.id] = detail;
    selectedTableDetail.value = detail;
  } catch (error) {
    console.error("Failed to fetch table detail:", error);
  }
};

// Auto-detect table from FROM clause and load its details
const detectTableFromQuery = (sql: string) => {
  const fromMatch = sql.match(/\bFROM\s+(\w+)/i);
  if (fromMatch && fromMatch[1]) {
    const tableName = fromMatch[1];
    const table = tables.value.find(
      (t) => t.id.toLowerCase() === tableName.toLowerCase()
    );
    if (table && selectedTableId.value !== table.id) {
      selectTable(table);
    }
  }
};

// ============================================================================
// Query Execution
// ============================================================================

const runCurrentQuery = async () => {
  const file = currentFile.value;
  if (!file) return;

  file.isExecuting = true;
  file.results = [];
  file.columns = [];
  file.error = "";

  // Auto-detect table
  detectTableFromQuery(file.code);

  try {
    const response = await callApi(RequestRoutes.RUN_SUITEQL_QUERY, {
      sql: file.code
    }) as ApiResponse;

    if (response.status === "error") {
      file.error = response.message || "Query execution failed";
      return;
    }

    const results = response.message;
    if (Array.isArray(results) && results.length > 0) {
      file.columns = Object.keys(results[0]);
      file.results = results;
    } else if (Array.isArray(results)) {
      file.results = [];
      file.columns = [];
      file.error = "Query returned 0 rows";
    } else {
      file.error = "Unexpected response format";
    }
  } catch (error: any) {
    file.error = `Execution failed: ${error.message || error}`;
  } finally {
    file.isExecuting = false;
  }
};

// ============================================================================
// Helper Functions
// ============================================================================

const insertFieldAtCursor = (fieldId: string) => {
  const file = currentFile.value;
  if (!file) return;
  // Append to code if no cursor control
  file.code = file.code + (file.code.endsWith("\n") ? "" : "\n") + "  " + fieldId;
};

const insertJoinAtCursor = (join: JoinInfo) => {
  if (!join.sourceTargetType) return;
  const joinPair = join.sourceTargetType.joinPairs?.[0];
  const joinClause = joinPair
    ? `\n${join.joinType === "AUTOMATIC" ? "INNER" : "LEFT"} JOIN ${join.sourceTargetType.id} ON ${joinPair.label}`
    : `\n-- JOIN ${join.sourceTargetType.id} (${join.label})`;

  const file = currentFile.value;
  if (!file) return;
  file.code += joinClause;
};

const getJoinTooltip = (join: JoinInfo): string => {
  const pairs = join.sourceTargetType?.joinPairs?.map((p) => p.label).join(", ") || "";
  return `${join.label}\n${join.cardinality} · ${join.joinType}\n${pairs}`;
};

const copyResults = async (file: QueryFile) => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(file.results, null, 2));
  } catch { /* silent */ }
};

const copyResultsCSV = async (file: QueryFile) => {
  if (file.results.length === 0) return;
  const header = file.columns.join(",");
  const rows = file.results.map((r) =>
    file.columns.map((c) => {
      const val = r[c] ?? "";
      return typeof val === "string" && val.includes(",") ? `"${val}"` : val;
    }).join(",")
  );
  try {
    await navigator.clipboard.writeText([header, ...rows].join("\n"));
  } catch { /* silent */ }
};

// ============================================================================
// Persistence
// ============================================================================

type SaveStatus = "idle" | "saving" | "saved" | "error";
const saveStatus = ref<SaveStatus>("idle");
let saveTimeout: number | undefined;

const STORAGE_KEY_FILES = "suiteql_cachedFiles";
const STORAGE_KEY_TABS = "suiteql_cachedOpenTabs";
const STORAGE_KEY_ACTIVE = "suiteql_cachedActiveTab";

const saveAllFiles = (state: any) => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;

  saveStatus.value = "saving";
  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = window.setTimeout(() => {
    chrome.storage.local.set(
      {
        [STORAGE_KEY_FILES]: state.files,
        [STORAGE_KEY_TABS]: state.openTabs,
        [STORAGE_KEY_ACTIVE]: state.activeTab
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

// Watch for code changes to auto-detect tables
watch(
  () => currentFile.value?.code,
  (newCode) => {
    if (newCode && tables.value.length > 0) {
      detectTableFromQuery(newCode);
    }
  }
);

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(() => {
  // Fetch tables on mount
  fetchTables();

  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    isRestoring.value = false;
    return;
  }

  chrome.storage.local.get(
    [STORAGE_KEY_FILES, STORAGE_KEY_TABS, STORAGE_KEY_ACTIVE],
    (result) => {
      try {
        const restoredFiles = Array.isArray(result[STORAGE_KEY_FILES])
          ? result[STORAGE_KEY_FILES].map((f: any) => ({
              id: f.id || generateId(),
              name: f.name || "query.sql",
              code: f.code || "",
              results: [],
              columns: [],
              error: "",
              isExecuting: false
            }))
          : [];

        files.value = restoredFiles;

        let cachedTabs: string[] = [];
        if (Array.isArray(result[STORAGE_KEY_TABS])) {
          cachedTabs = result[STORAGE_KEY_TABS];
        } else if (result[STORAGE_KEY_TABS] && typeof result[STORAGE_KEY_TABS] === "object") {
          cachedTabs = Object.values(result[STORAGE_KEY_TABS]);
        }

        const validTabs = cachedTabs.filter((id: string) =>
          restoredFiles.some((file: QueryFile) => file.id === id)
        );
        openTabs.value = validTabs;

        const active = result[STORAGE_KEY_ACTIVE];
        activeFileId.value =
          typeof active === "string" && openTabs.value.includes(active)
            ? active
            : openTabs.value[0] || "";
      } catch (error) {
        console.error("Restore failed:", error);
        openTabs.value = [];
        activeFileId.value = "";
        chrome.storage.local.remove([STORAGE_KEY_TABS, STORAGE_KEY_ACTIVE]);
      }

      isRestoring.value = false;
    }
  );
});

onBeforeUnmount(() => {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const filesData = files.value.map((f) => ({
        id: f.id,
        name: f.name,
        code: f.code
      }));
      chrome.storage.local.set({
        [STORAGE_KEY_FILES]: filesData,
        [STORAGE_KEY_TABS]: openTabs.value,
        [STORAGE_KEY_ACTIVE]: activeFileId.value
      });
    }
  } catch (error) {
    console.error(error);
  }
});
</script>

<style scoped>
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

.sidebar-section p {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-slate-600);
}

.sidebar-section code {
  background: var(--p-slate-200);
  padding: 0.125rem 0.25rem;
  border-radius: 2px;
  font-size: 0.7rem;
}

.file-item {
  font-size: 0.875rem;
}

.file-item:hover .opacity-0 {
  opacity: 1;
}

.table-item {
  border-left: 2px solid transparent;
  transition: border-color 0.15s;
}

.table-item:hover {
  border-left-color: var(--p-slate-400);
}

.sidebar-section :deep(.p-inputtext) {
  font-size: 0.75rem;
}

.sidebar-section :deep(.max-h-32) {
  max-height: 8rem;
}

/* Results table */
.results-pane {
  background: #1e1e1e;
  color: #d4d4d4;
}

.results-table {
  border-collapse: collapse;
  font-family: 'Consolas', 'Monaco', monospace;
}

.results-table th {
  background: #2d2d2d;
  color: #569cd6;
  padding: 6px 12px;
  text-align: left;
  font-weight: 600;
  border-bottom: 1px solid #404040;
  white-space: nowrap;
}

.results-table td {
  padding: 4px 12px;
  border-bottom: 1px solid #333;
  white-space: nowrap;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.results-table tr:hover td {
  background: #2a2d2e;
}

.results-table tr:nth-child(even) td {
  background: #252526;
}

.results-table tr:nth-child(even):hover td {
  background: #2a2d2e;
}
</style>
