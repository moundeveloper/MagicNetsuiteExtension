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
              <Button @click="runCurrentQuery" :disabled="currentFile?.isExecuting" class="w-full">
                <i class="pi pi-play font-medium"></i>
                {{ currentFile?.isExecuting ? "Running..." : "Run Query" }}
              </Button>
              <Button @click="fetchTables" :disabled="isLoadingTables" severity="secondary" class="w-full">
                <i class="pi pi-refresh font-medium"></i>
                {{ isLoadingTables ? "Loading..." : "Refresh Tables" }}
              </Button>
              <div class="text-xs">
                <span v-if="saveStatus === 'saving'" class="text-yellow-500">Syncing…</span>
                <span v-else-if="saveStatus === 'saved'" class="text-green-500">✓ Saved</span>
                <span v-else-if="saveStatus === 'error'" class="text-red-500">Save failed</span>
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
            <div class="flex flex-col gap-1 overflow-y-auto pr-1" style="max-height: calc(90vh - 300px)">
              <div
                v-for="file in filteredFiles"
                :key="file.id"
                class="file-item flex items-center gap-2 py-2 px-3 rounded cursor-pointer hover:bg-slate-200 transition-colors group"
                :class="{ 'bg-slate-200': activeFileId === file.id }"
                @click="openFileInTab(file.id)"
              >
                <i class="pi pi-database text-xs" style="color: var(--p-slate-600)"></i>
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
              <!-- Editor toolbar -->
              <div
                class="editor-toolbar shrink-0 flex items-center gap-2 px-3 py-1.5 border-b"
                style="background: #2d2d2d; border-color: #404040"
              >
                <Button size="small" @click="runCurrentQuery" :disabled="file.isExecuting">
                  <i class="pi pi-play text-xs mr-1"></i>
                  {{ file.isExecuting ? "Running..." : "Run" }}
                </Button>
                <Button size="small" severity="secondary" @click="formatCurrentSQL(file.id)">
                  <i class="pi pi-align-left text-xs mr-1"></i>
                  Format
                </Button>
                <div class="w-px h-4 mx-1" style="background: #555"></div>
                <Button size="small" severity="secondary" @click="openInRunQuickScript(file)">
                  <i class="pi pi-external-link text-xs mr-1"></i>
                  Open in Script Runner
                </Button>
                <span v-if="file.isExecuting" class="text-xs ml-auto" style="color: #fbbf24">Executing…</span>
              </div>

              <!-- Editor + bottom panel splitter -->
              <div class="flex-1 min-h-0">
                <vue-splitter is-horizontal data-ignore class="h-full">
                  <template #top-pane>
                    <MonacoCodeEditor
                      v-model="file.code"
                      language="sql"
                      :readonly="file.isExecuting"
                      :ref="(el: any) => setEditorRef(file.id, el)"
                      @change="onCodeChange(file.id, $event)"
                    />
                  </template>
                  <template #bottom-pane>
                    <!-- Bottom schema/results panel -->
                    <div class="bottom-panel h-full flex flex-col" style="background: #1e1e1e">
                      <!-- Tab bar -->
                      <div
                        class="bottom-tabbar shrink-0 flex items-center border-b"
                        style="background: #252526; border-color: #404040; min-height: 34px"
                      >
                        <button
                          v-for="btab in bottomTabDefs"
                          :key="btab.id"
                          class="bottom-tab px-4 py-2 text-xs whitespace-nowrap transition-colors"
                          :class="
                            bottomTab === btab.id
                              ? 'tab-active'
                              : 'tab-inactive'
                          "
                          @click="bottomTab = btab.id; schemaSearch = ''"
                        >
                          {{ btab.label }}
                        </button>

                        <!-- Right side of tab bar -->
                        <div class="ml-auto flex items-center gap-2 px-3">
                          <span
                            v-if="file.results.length > 0 && bottomTab === 'results'"
                            class="text-xs font-mono"
                            style="color: #4ec9b0"
                          >
                            {{ file.results.length }} rows
                          </span>
                          <span
                            v-else-if="file.error && bottomTab === 'results'"
                            class="text-xs"
                            style="color: #f48771"
                          >Error</span>
                          <template v-if="bottomTab === 'results' && file.results.length > 0">
                            <button class="schema-action-btn" @click="copyResults(file)">JSON</button>
                            <button class="schema-action-btn" @click="copyResultsCSV(file)">CSV</button>
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
                          <table v-if="file.results.length > 0" class="results-table w-full">
                            <thead>
                              <tr>
                                <th v-for="col in file.columns" :key="col">{{ col }}</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr v-for="(row, idx) in file.results" :key="idx">
                                <td v-for="col in file.columns" :key="col">{{ row[col] ?? '' }}</td>
                              </tr>
                            </tbody>
                          </table>
                          <div
                            v-else-if="file.error"
                            class="p-4 text-sm font-mono whitespace-pre-wrap"
                            style="color: #f48771"
                          >{{ file.error }}</div>
                          <div
                            v-else
                            class="flex flex-col items-center justify-center h-full gap-2"
                            style="color: #6b7280"
                          >
                            <i class="pi pi-table text-2xl"></i>
                            <span class="text-sm">Run a query to see results</span>
                            <span class="text-xs opacity-60">Ctrl+Enter</span>
                          </div>
                        </div>

                        <!-- Tables -->
                        <div v-show="bottomTab === 'tables'" class="p-3">
                          <div
                            v-if="isLoadingTables"
                            class="flex items-center justify-center py-10 gap-2"
                            style="color: #9d9d9d"
                          >
                            <i class="pi pi-spin pi-spinner"></i>
                            Loading tables…
                          </div>
                          <div v-else class="tables-grid">
                            <div
                              v-for="table in filteredSchemaTables"
                              :key="table.id"
                              class="table-card"
                              :class="{ 'table-card-selected': selectedTableId === table.id }"
                              @click="handleTableClick(table)"
                              :title="table.label"
                            >
                              <div class="table-card-id">{{ table.id }}</div>
                              <div class="table-card-label">{{ table.label }}</div>
                            </div>
                          </div>
                          <div
                            v-if="!isLoadingTables && filteredSchemaTables.length === 0"
                            class="text-center py-10 text-sm"
                            style="color: #6b7280"
                          >
                            No tables match "{{ schemaSearch }}"
                          </div>
                        </div>

                        <!-- Fields -->
                        <div v-show="bottomTab === 'fields'">
                          <div
                            v-if="!selectedTableDetail && !isLoadingDetail"
                            class="flex flex-col items-center justify-center py-10 gap-2"
                            style="color: #6b7280"
                          >
                            <i class="pi pi-table text-2xl"></i>
                            <span class="text-sm">
                              Select a table from the
                              <button
                                class="underline"
                                style="color: #569cd6"
                                @click="bottomTab = 'tables'"
                              >Tables</button>
                              tab
                            </span>
                          </div>
                          <div
                            v-else-if="isLoadingDetail"
                            class="flex items-center justify-center py-10 gap-2"
                            style="color: #9d9d9d"
                          >
                            <i class="pi pi-spin pi-spinner"></i>
                            Loading fields…
                          </div>
                          <table v-else-if="filteredSchemaFields.length > 0" class="schema-table w-full">
                            <thead>
                              <tr>
                                <th>Column ID</th>
                                <th>Label</th>
                                <th>Data Type</th>
                                <th>Field Type</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr
                                v-for="field in filteredSchemaFields"
                                :key="field.id"
                                class="schema-row"
                                @click="insertAtCursor(field.id)"
                                :title="`Click to insert '${field.id}' at cursor`"
                              >
                                <td class="font-mono" style="color: #9cdcfe">{{ field.id }}</td>
                                <td style="color: #d4d4d4">{{ field.label }}</td>
                                <td class="font-mono text-xs" style="color: #dcdcaa">{{ field.dataType }}</td>
                                <td class="text-xs" style="color: #6b7280">{{ field.fieldType }}</td>
                              </tr>
                            </tbody>
                          </table>
                          <div
                            v-else-if="selectedTableDetail"
                            class="text-center py-6 text-sm"
                            style="color: #6b7280"
                          >
                            No fields match "{{ schemaSearch }}"
                          </div>
                        </div>

                        <!-- Joins -->
                        <div v-show="bottomTab === 'joins'">
                          <div
                            v-if="!selectedTableDetail"
                            class="flex flex-col items-center justify-center py-10 gap-2"
                            style="color: #6b7280"
                          >
                            <i class="pi pi-sitemap text-2xl"></i>
                            <span class="text-sm">
                              Select a table from the
                              <button
                                class="underline"
                                style="color: #569cd6"
                                @click="bottomTab = 'tables'"
                              >Tables</button>
                              tab
                            </span>
                          </div>
                          <table v-else-if="filteredSchemaJoins.length > 0" class="schema-table w-full">
                            <thead>
                              <tr>
                                <th>Join / Relation</th>
                                <th>Target Table</th>
                                <th>Cardinality</th>
                                <th>Type</th>
                                <th>Condition</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr
                                v-for="join in filteredSchemaJoins"
                                :key="join.id"
                                class="schema-row"
                                @click="insertJoinAtCursor(join)"
                                :title="`Click to insert JOIN for '${join.label}'`"
                              >
                                <td style="color: #4fc1ff">{{ join.label }}</td>
                                <td class="font-mono" style="color: #d4d4d4">{{ join.sourceTargetType?.id || '–' }}</td>
                                <td class="text-xs font-mono" style="color: #dcdcaa">{{ join.cardinality }}</td>
                                <td class="text-xs" style="color: #6b7280">{{ join.joinType }}</td>
                                <td class="font-mono text-xs" style="color: #5a5a5a; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                                  {{ join.sourceTargetType?.joinPairs?.[0]?.label || '–' }}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                          <div
                            v-else-if="selectedTableDetail && selectedTableDetail.joins?.length === 0"
                            class="text-center py-6 text-sm"
                            style="color: #6b7280"
                          >
                            No joins available for this table
                          </div>
                          <div
                            v-else-if="selectedTableDetail"
                            class="text-center py-6 text-sm"
                            style="color: #6b7280"
                          >
                            No joins match "{{ schemaSearch }}"
                          </div>
                        </div>

                      </div>
                    </div>
                  </template>
                </vue-splitter>
              </div>
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
import {
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  computed,
  nextTick
} from "vue";
import { useRouter } from "vue-router";
import * as monaco from "monaco-editor";
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

// ============================================================================
// SQL Keywords
// ============================================================================

const SQL_KEYWORDS = [
  "SELECT", "DISTINCT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE",
  "BETWEEN", "IS NULL", "IS NOT NULL", "INNER JOIN", "LEFT JOIN",
  "LEFT OUTER JOIN", "RIGHT JOIN", "RIGHT OUTER JOIN", "FULL OUTER JOIN",
  "CROSS JOIN", "JOIN", "ON", "ORDER BY", "GROUP BY", "HAVING",
  "LIMIT", "OFFSET", "UNION", "UNION ALL", "CASE", "WHEN", "THEN", "ELSE",
  "END", "COUNT", "SUM", "AVG", "MIN", "MAX", "AS", "NULL", "ROWNUM",
  "COALESCE", "NULLIF", "CAST", "UPPER", "LOWER", "TRIM", "LENGTH",
  "SUBSTRING", "REPLACE", "TO_DATE", "TO_CHAR", "NVL", "NVL2", "DECODE",
  "BUILTIN.DF", "BUILTIN.CF", "EXISTS", "ALL", "ANY", "SOME", "ASC", "DESC"
];

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
const selectedTableId = ref("");
const selectedTableDetail = ref<TableDetail | null>(null);
const tableDetailCache = ref<Record<string, TableDetail>>({});

// Bottom panel
const bottomTab = ref("results");
const schemaSearch = ref("");

// Editor refs
const editorRefs = ref<Record<string, any>>({});

// Monaco completion disposable
let sqlCompletionDisposable: monaco.IDisposable | null = null;

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

const bottomTabDefs = computed(() => {
  const defs: { id: string; label: string }[] = [
    { id: "results", label: "Results" },
    {
      id: "tables",
      label: `Tables${tables.value.length ? ` (${tables.value.length})` : ""}`
    }
  ];
  if (selectedTableDetail.value) {
    defs.push({
      id: "fields",
      label: `Fields · ${selectedTableDetail.value.id}`
    });
    if (selectedTableDetail.value.joins?.length) {
      defs.push({
        id: "joins",
        label: `Joins (${selectedTableDetail.value.joins.length}) · ${selectedTableDetail.value.id}`
      });
    }
  }
  return defs;
});

const filteredSchemaTables = computed(() => {
  const term = schemaSearch.value.toLowerCase();
  if (!term) return tables.value;
  return tables.value.filter(
    (t) =>
      t.id.toLowerCase().includes(term) ||
      t.label.toLowerCase().includes(term)
  );
});

const filteredSchemaFields = computed(() => {
  if (!selectedTableDetail.value?.fields) return [];
  const fields = selectedTableDetail.value.fields.filter((f) => f.isColumn);
  const term = schemaSearch.value.toLowerCase();
  if (!term) return fields;
  return fields.filter(
    (f) =>
      f.id.toLowerCase().includes(term) ||
      f.label.toLowerCase().includes(term)
  );
});

const filteredSchemaJoins = computed(() => {
  if (!selectedTableDetail.value?.joins) return [];
  const term = schemaSearch.value.toLowerCase();
  if (!term) return selectedTableDetail.value.joins;
  return selectedTableDetail.value.joins.filter(
    (j) =>
      j.id.toLowerCase().includes(term) ||
      j.label.toLowerCase().includes(term) ||
      (j.sourceTargetType?.id ?? "").toLowerCase().includes(term)
  );
});

// ============================================================================
// Context-Aware Monaco Completions
// ============================================================================

const getTableDetailByName = (tableName: string): TableDetail | null => {
  const lower = tableName.toLowerCase();
  for (const detail of Object.values(tableDetailCache.value)) {
    if (detail.id.toLowerCase() === lower) return detail;
  }
  return null;
};

const registerContextAwareCompletions = () => {
  if (sqlCompletionDisposable) {
    sqlCompletionDisposable.dispose();
    sqlCompletionDisposable = null;
  }

  sqlCompletionDisposable = monaco.languages.registerCompletionItemProvider(
    "sql",
    {
      triggerCharacters: [" ", "\n", ",", "."],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn
        );

        const fullText = model.getValue();
        const textBeforeCursor = model.getValueInRange(
          new monaco.Range(1, 1, position.lineNumber, position.column)
        );

        // After FROM or JOIN → suggest table names only
        const isAfterFromOrJoin = /\b(?:FROM|JOIN)\s+\w*$/i.test(
          textBeforeCursor
        );

        // Extract tables referenced in the full query
        const referencedTables = new Set<string>();
        for (const m of fullText.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)) {
          if (m[1]) referencedTables.add(m[1]);
        }

        const suggestions: monaco.languages.CompletionItem[] = [];

        if (isAfterFromOrJoin) {
          tables.value.forEach((t) => {
            suggestions.push({
              label: { label: t.id, description: t.label },
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: t.id,
              documentation: { value: `**${t.id}**\n\n${t.label}` },
              detail: "NetSuite Table",
              range,
              sortText: `0${t.id}`
            });
          });
        } else {
          // Keywords first
          SQL_KEYWORDS.forEach((kw) => {
            suggestions.push({
              label: kw,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: kw,
              detail: "SQL Keyword",
              range,
              sortText: `0${kw}`
            });
          });

          // Fields from all tables referenced in query
          for (const tableName of referencedTables) {
            const detail = getTableDetailByName(tableName);
            if (detail) {
              detail.fields
                .filter((f) => f.isColumn)
                .forEach((field) => {
                  suggestions.push({
                    label: {
                      label: field.id,
                      description: field.dataType
                    },
                    kind: monaco.languages.CompletionItemKind.Field,
                    insertText: field.id,
                    documentation: {
                      value: `**${field.label}**\n\nType: \`${field.dataType}\`\nTable: \`${detail.id}\``
                    },
                    detail: `${detail.id} · ${field.dataType}`,
                    range,
                    sortText: `1${field.id}`
                  });
                });
            }
          }

          // All table names (lower priority)
          tables.value.forEach((t) => {
            suggestions.push({
              label: { label: t.id, description: t.label },
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: t.id,
              detail: "NetSuite Table",
              range,
              sortText: `2${t.id}`
            });
          });
        }

        return { suggestions };
      }
    }
  );
};

// ============================================================================
// Editor Ref Setup (Ctrl+Enter + ref tracking)
// ============================================================================

const setEditorRef = (fileId: string, el: any) => {
  if (!el) return;
  editorRefs.value[fileId] = el;
  // Register Ctrl+Enter to run the query
  nextTick(() => {
    const editorInst =
      el.getEditor() as monaco.editor.IStandaloneCodeEditor | null;
    if (!editorInst) return;
    editorInst.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => runCurrentQuery()
    );
  });
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
    isExecuting: false
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
    activeFileId.value =
      openTabs.value[0] || files.value[0]?.id || "";
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
  } catch (error) {
    console.error("Failed to fetch tables:", error);
  } finally {
    isLoadingTables.value = false;
  }
};

const selectTable = async (table: TableInfo) => {
  selectedTableId.value = table.id;
  const cached = tableDetailCache.value[table.id];
  if (cached) {
    selectedTableDetail.value = cached;
    return;
  }

  isLoadingDetail.value = true;
  try {
    const response = (await callApi(
      RequestRoutes.FETCH_SUITEQL_TABLE_DETAIL,
      { tableName: table.id }
    )) as ApiResponse;
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
    tableDetailCache.value[table.id] = detail;
    selectedTableDetail.value = detail;
  } catch (error) {
    console.error("Failed to fetch table detail:", error);
  } finally {
    isLoadingDetail.value = false;
  }
};

// Click in the Tables tab: select + switch to Fields tab
const handleTableClick = (table: TableInfo) => {
  selectTable(table);
  bottomTab.value = "fields";
};

// Auto-detect table from FROM clause and load its detail
const detectAndLoadTableFromQuery = async (sql: string) => {
  if (!tables.value.length) return;
  const fromMatch = sql.match(/\bFROM\s+(\w+)/i);
  if (!fromMatch?.[1]) return;
  const tableName = fromMatch[1];
  const table = tables.value.find(
    (t) => t.id.toLowerCase() === tableName.toLowerCase()
  );
  if (!table || selectedTableId.value === table.id) return;
  await selectTable(table);
};

// ============================================================================
// Insert at Cursor
// ============================================================================

const insertAtCursor = (text: string) => {
  const editorEl = editorRefs.value[activeFileId.value];
  if (!editorEl) return;
  const editorInst =
    editorEl.getEditor() as monaco.editor.IStandaloneCodeEditor | null;
  if (!editorInst) return;
  const position = editorInst.getPosition();
  if (!position) return;
  editorInst.executeEdits("suiteql-insert", [
    {
      range: new monaco.Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        position.column
      ),
      text
    }
  ]);
  editorInst.focus();
};

const insertJoinAtCursor = (join: JoinInfo) => {
  if (!join.sourceTargetType) return;
  const joinPair = join.sourceTargetType.joinPairs?.[0];
  const joinKeyword =
    join.joinType === "INVERSE" ? "LEFT JOIN" : "INNER JOIN";
  const clause = joinPair
    ? `\n${joinKeyword} ${join.sourceTargetType.id}\n    ON ${joinPair.label}`
    : `\n${joinKeyword} ${join.sourceTargetType.id}\n    ON -- ${join.label}`;
  insertAtCursor(clause);
};

// ============================================================================
// Format SQL
// ============================================================================

const formatSQL = (sql: string): string => {
  let result = sql.trim().replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");

  // Uppercase multi-word keywords first (order matters: longest first)
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

  const singleKeywords = [
    "SELECT", "FROM", "WHERE", "HAVING", "LIMIT", "OFFSET", "UNION",
    "JOIN", "ON", "AND", "OR", "NOT", "IN", "LIKE", "BETWEEN", "AS",
    "CASE", "WHEN", "THEN", "ELSE", "END", "DISTINCT", "NULL",
    "COUNT", "SUM", "AVG", "MIN", "MAX", "ROWNUM", "ASC", "DESC",
    "COALESCE", "NULLIF", "CAST", "UPPER", "LOWER", "TRIM"
  ];
  singleKeywords.forEach((kw) => {
    result = result.replace(new RegExp(`\\b(${kw})\\b`, "gi"), kw);
  });

  // Line break before main clauses
  [
    "FROM", "WHERE", "ORDER BY", "GROUP BY", "HAVING", "LIMIT",
    "OFFSET", "UNION ALL", "UNION"
  ].forEach((clause) => {
    result = result.replace(new RegExp(`\\b(${clause})\\b`, "g"), "\n$1");
  });

  // Line break before JOINs
  [
    "INNER JOIN", "LEFT OUTER JOIN", "RIGHT OUTER JOIN", "FULL OUTER JOIN",
    "LEFT JOIN", "RIGHT JOIN", "CROSS JOIN", "JOIN"
  ].forEach((j) => {
    result = result.replace(new RegExp(`\\b(${j})\\b`, "g"), "\n$1");
  });

  // Indent ON
  result = result.replace(/\bON\b/g, "\n    ON");

  // Format SELECT column list: each comma-separated item on its own line
  result = result.replace(
    /^(SELECT(?:\s+DISTINCT)?)(.*?)(?=\nFROM)/ms,
    (_, selectKw: string, cols: string) => {
      const items = cols
        .split(",")
        .map((item: string, idx: number) => {
          const trimmed = item.trim();
          return idx === 0 ? `\n    ${trimmed}` : `    ${trimmed}`;
        });
      return `${selectKw}${items.join(",\n")}`;
    }
  );

  result = result.replace(/^\n+/, "").trim().replace(/\n{3,}/g, "\n\n");
  return result;
};

const formatCurrentSQL = (fileId: string) => {
  const file = files.value.find((f) => f.id === fileId);
  if (!file) return;
  const editorEl = editorRefs.value[fileId];
  const editorInst = editorEl?.getEditor() as
    | monaco.editor.IStandaloneCodeEditor
    | null
    | undefined;
  const formatted = formatSQL(editorInst?.getValue() ?? file.code);
  if (editorInst) {
    editorInst.setValue(formatted);
  }
  file.code = formatted;
};

// ============================================================================
// Query Execution
// ============================================================================

const runCurrentQuery = async () => {
  const file = currentFile.value;
  if (!file || file.isExecuting) return;

  file.isExecuting = true;
  file.results = [];
  file.columns = [];
  file.error = "";
  bottomTab.value = "results";

  detectAndLoadTableFromQuery(file.code);

  try {
    const response = (await callApi(RequestRoutes.RUN_SUITEQL_QUERY, {
      sql: file.code
    })) as ApiResponse;

    if (response.status === "error") {
      file.error = response.message || "Query execution failed";
      return;
    }

    const results = response.message;
    if (Array.isArray(results) && results.length > 0) {
      file.columns = Object.keys(results[0]);
      file.results = results;
    } else if (Array.isArray(results)) {
      file.error = "Query returned 0 rows";
    } else {
      file.error = "Unexpected response format";
    }
  } catch (error: any) {
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
  const newFile = {
    id: newId,
    name: `sql_${file.name}`,
    code: wrappedCode
  };

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(
      ["cachedFiles", "cachedOpenTabs"],
      (result) => {
        const existingFiles = Array.isArray(result.cachedFiles)
          ? result.cachedFiles
          : [];
        const existingTabs = Array.isArray(result.cachedOpenTabs)
          ? result.cachedOpenTabs
          : [];
        chrome.storage.local.set(
          {
            cachedFiles: [...existingFiles, newFile],
            cachedOpenTabs: [...existingTabs, newId],
            cachedActiveTab: newId
          },
          () => router.push("/run-quick-script")
        );
      }
    );
  } else {
    router.push("/run-quick-script");
  }
};

// ============================================================================
// Code Change Handler
// ============================================================================

const onCodeChange = (fileId: string, newCode: string) => {
  if (fileId !== activeFileId.value) return;
  detectAndLoadTableFromQuery(newCode);
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

watch(persistedState, (state) => {
  if (isRestoring.value) return;
  saveAllFiles(state);
}, { deep: true });

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(() => {
  registerContextAwareCompletions();
  fetchTables();

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
              isExecuting: false
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
    }
  );
});

onBeforeUnmount(() => {
  if (sqlCompletionDisposable) {
    sqlCompletionDisposable.dispose();
    sqlCompletionDisposable = null;
  }
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

/* Bottom panel tab styles */
.bottom-tab {
  cursor: pointer;
  border-top: 2px solid transparent;
  user-select: none;
}

.tab-active {
  color: #ffffff;
  border-top-color: #569cd6;
  background: #1e1e1e;
}

.tab-inactive {
  color: #9d9d9d;
}

.tab-inactive:hover {
  color: #cccccc;
  background: #2d2d2d;
}

.schema-search-input {
  background: #3c3c3c;
  border: 1px solid #555;
  border-radius: 4px;
  color: #d4d4d4;
  font-size: 0.75rem;
  padding: 3px 8px;
  outline: none;
  width: 180px;
  font-family: inherit;
}

.schema-search-input::placeholder {
  color: #6b7280;
}

.schema-search-input:focus {
  border-color: #569cd6;
}

.schema-action-btn {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 3px;
  color: #9d9d9d;
  transition: all 0.15s;
  cursor: pointer;
}

.schema-action-btn:hover {
  color: #ffffff;
  background: #3c3c3c;
}

/* Results table */
.results-table {
  border-collapse: collapse;
  font-family: "Consolas", "Monaco", monospace;
  font-size: 0.75rem;
}

.results-table th {
  background: #2d2d2d;
  color: #569cd6;
  padding: 6px 14px;
  text-align: left;
  font-weight: 600;
  border-bottom: 1px solid #404040;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
}

.results-table td {
  padding: 4px 14px;
  border-bottom: 1px solid #2a2a2a;
  white-space: nowrap;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #d4d4d4;
}

.results-table tr:hover td {
  background: #2a2d2e;
}

.results-table tr:nth-child(even) td {
  background: #242424;
}

.results-table tr:nth-child(even):hover td {
  background: #2a2d2e;
}

/* Schema tables (fields / joins) */
.schema-table {
  border-collapse: collapse;
  font-size: 0.75rem;
}

.schema-table th {
  background: #2d2d2d;
  color: #9cdcfe;
  padding: 6px 14px;
  text-align: left;
  font-weight: 600;
  border-bottom: 1px solid #404040;
  position: sticky;
  top: 0;
  z-index: 1;
  white-space: nowrap;
}

.schema-row td {
  padding: 5px 14px;
  border-bottom: 1px solid #242424;
  cursor: pointer;
}

.schema-row:hover td {
  background: #2a2d2e;
}

.schema-row:hover td:first-child::after {
  content: " ↵";
  font-size: 0.65rem;
  color: #569cd6;
  opacity: 0.7;
}

/* Tables grid */
.tables-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 6px;
}

.table-card {
  padding: 8px 10px;
  border: 1px solid #404040;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s;
  background: #252526;
}

.table-card:hover {
  border-color: #569cd6;
  background: #2a2d2e;
}

.table-card-selected {
  border-color: #569cd6 !important;
  background: #1e3a5f !important;
}

.table-card-id {
  font-family: "Consolas", monospace;
  font-size: 0.7rem;
  font-weight: 600;
  color: #9cdcfe;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table-card-label {
  font-size: 0.65rem;
  color: #6b7280;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

/* Sidebar input styling */
.sidebar-section :deep(.p-inputtext) {
  font-size: 0.75rem;
}
</style>
