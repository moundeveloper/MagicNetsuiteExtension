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
            class="p-2 rounded bg-slate-600 hover:bg-slate-500 transition-colors text-[var(--p-slate-50)]"
            :disabled="isRendering"
            :title="isRendering ? 'Rendering...' : 'Render'"
            @click="renderTemplate"
          >
            <i class="pi pi-play text-sm"></i>
          </button>
        </template>

        <template #default>
          <div class="sidebar-section">
            <h4>Actions</h4>
            <Button
              class="w-full"
              :loading="isRendering"
              :disabled="isRendering"
              @click="renderTemplate"
              title="Render (Ctrl+Enter)"
            >
              <i class="pi pi-play font-medium"></i>
              <span class="flex-1 text-left">{{ isRendering ? "Rendering..." : "Render" }}</span>
              <kbd class="render-kbd">Ctrl+↵</kbd>
            </Button>
          </div>

          <div class="sidebar-section">
            <h4>Record Context</h4>
            <div class="context-mode-grid">
              <Button
                size="small"
                :severity="contextMode === 'freestyle' ? 'primary' : 'secondary'"
                :outlined="contextMode !== 'freestyle'"
                @click="setContextMode('freestyle')"
              >
                Freestyle
              </Button>
              <Button
                size="small"
                :severity="contextMode === 'transaction' ? 'primary' : 'secondary'"
                :outlined="contextMode !== 'transaction'"
                @click="setContextMode('transaction')"
              >
                Transaction
              </Button>
              <Button
                size="small"
                :severity="contextMode === 'customrecord' ? 'primary' : 'secondary'"
                :outlined="contextMode !== 'customrecord'"
                @click="setContextMode('customrecord')"
              >
                Custom
              </Button>
            </div>

            <template v-if="contextMode !== 'freestyle'">
              <Select
                v-model="selectedRecordType"
                :options="recordTypeOptions"
                optionLabel="name"
                placeholder="Record type"
                size="small"
                class="w-full"
                :loading="recordTypesLoading"
                filter
                @change="loadRecords"
              />

              <div class="flex gap-2">
                <InputText
                  v-model="recordSearch"
                  size="small"
                  class="flex-1 min-w-0"
                  placeholder="Search records"
                  @keydown.enter="loadRecords"
                />
                <Button
                  size="small"
                  icon="pi pi-search"
                  :loading="recordsLoading"
                  @click="loadRecords"
                />
              </div>

              <Select
                v-model="selectedRecord"
                :options="recordRows"
                optionLabel="label"
                placeholder="Record"
                size="small"
                class="w-full"
                :loading="recordsLoading"
                filter
              />

              <div v-if="selectedRecord" class="text-xs text-slate-500">
                {{ selectedRecord.meta || `ID: ${selectedRecord.id}` }}
              </div>
            </template>
            <div v-if="recordListError" class="text-xs text-red-500">
              {{ recordListError }}
            </div>
          </div>

          <div class="sidebar-section">
            <ServerComponentsPanel
              ref="serverComponentsPanelRef"
              title="Server"
              :show-all-ready="false"
              :show-deploy="false"
              auto-check
            />
          </div>

          <div class="sidebar-section">
            <h4>Reference</h4>
            <Button
              size="small"
              severity="secondary"
              outlined
              class="w-full"
              @click="openFreemarkerReference"
            >
              <i class="pi pi-external-link"></i>
              <span class="flex-1 text-left">FreeMarker Docs</span>
            </Button>
          </div>
        </template>
      </ExpandableSidebar>

      <div class="workspace">
        <div class="pane">
          <div class="pane-toolbar">
            <span>Template</span>
            <span class="muted">Advanced PDF/HTML FreeMarker</span>
          </div>
          <MonacoCodeEditor
            v-model="template"
            language="xml"
            :readonly="isRendering"
            :config="{ autoSizing: true, minimap: true, validateTags: false }"
            @ctrl-enter="renderTemplate"
          />
        </div>

        <div class="pane">
          <div class="pane-toolbar">
            <span>PDF Preview</span>
            <span v-if="lastRenderedAt" class="muted">{{ lastRenderedAt }}</span>
          </div>

          <div v-if="renderError" class="render-error">
            {{ renderError }}
          </div>

          <div v-else-if="!renderedPdfUrl" class="preview-empty">
            Run the template to generate a PDF preview.
          </div>

          <iframe
            v-else
            class="render-frame"
            title="Rendered FreeMarker PDF"
            :src="renderedPdfUrl"
          ></iframe>
        </div>
      </div>
    </template>
  </MCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Button, InputText, Select, useToast } from "primevue";
import MCard from "../components/universal/card/MCard.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import ServerComponentsPanel from "../components/ServerComponentsPanel.vue";
import { ApiRequestType, callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";

const STORAGE_KEY = "freemarkerRendererTemplate";
const CONTEXT_MODE_KEY = "freemarkerRendererContextMode";

const freestyleTemplate = `<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf>
  <head>
    <style>
      body { font-size: 10pt; }
      table { font-size: 9pt; table-layout: fixed; width: 100%; }
      th { font-weight: bold; font-size: 8pt; padding: 6px; background-color: #e3e3e3; color: #333333; }
      td { padding: 4px 6px; }
      .title { font-size: 24pt; }
    </style>
  </head>
  <body size="Letter">
    <table>
      <tr>
        <td><span class="title">FreeMarker Preview</span></td>
        <td align="right">\${.now?string("yyyy-MM-dd HH:mm:ss")}</td>
      </tr>
    </table>
    <br />
    <table>
      <tr>
        <th>Example</th>
        <th>Value</th>
      </tr>
      <#list ["One", "Two", "Three"] as row>
        <tr>
          <td>\${row}</td>
          <td>\${row_index + 1}</td>
        </tr>
      </#list>
    </table>
  </body>
</pdf>`;

const customRecordTemplate = `<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf>
  <head>
    <style>
      table { font-size: 9pt; table-layout: fixed; width: 100%; }
      th { font-weight: bold; font-size: 8pt; padding: 6px; background-color: #e3e3e3; color: #333333; }
      td { padding: 4px 6px; }
      b { font-weight: bold; color: #333333; }
    </style>
  </head>
  <body size="Letter">
    <table style="width: 100%; font-size: 10pt;">
      <tr>
        <td>
          <span style="font-size: 20pt;">\${record@title}</span>
        </td>
      </tr>
    </table>
    <br />
    <table>
      <tr>
        <td><b>\${record.id@label}</b></td>
        <td>\${record.id}</td>
        <td><b>\${record.name@label}</b></td>
        <td>\${record.name}</td>
      </tr>
      <tr>
        <td><b>\${record.externalid@label}</b></td>
        <td>\${record.externalid}</td>
        <td><b>\${record.isinactive@label}</b></td>
        <td>\${record.isinactive}</td>
      </tr>
    </table>
    <#if record.usernotes?has_content>
      <br />
      <table>
        <#list record.usernotes as note>
          <#if note_index == 0>
            <thead>
              <tr>
                <th>\${note.title@label}</th>
                <th>\${note.note@label}</th>
                <th>\${note.notedate@label}</th>
              </tr>
            </thead>
          </#if>
          <tr>
            <td>\${note.title}</td>
            <td>\${note.note}</td>
            <td>\${note.notedate}</td>
          </tr>
        </#list>
      </table>
    </#if>
  </body>
</pdf>`;

const transactionTemplate = `<?xml version="1.0"?>
<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
<pdf>
  <head>
    <style>
      table { font-size: 9pt; table-layout: fixed; width: 100%; }
      th { font-weight: bold; font-size: 8pt; padding: 6px; background-color: #e3e3e3; color: #333333; }
      td { padding: 4px 6px; }
      .title { font-size: 24pt; }
      .total { font-size: 18pt; background-color: #e3e3e3; }
    </style>
  </head>
  <body size="Letter">
    <table>
      <tr>
        <td><span class="title">\${record@title}</span></td>
        <td align="right">#\${record.tranid}<br />\${record.trandate}</td>
      </tr>
    </table>
    <br />
    <table>
      <tr>
        <th>\${record.entity@label}</th>
        <th>\${record.trandate@label}</th>
        <th>\${record.total@label}</th>
      </tr>
      <tr>
        <td>\${record.entity}</td>
        <td>\${record.trandate}</td>
        <td class="total" align="right">\${record.total}</td>
      </tr>
    </table>
    <#if record.item?has_content>
      <br />
      <table>
        <#list record.item as item>
          <#if item_index == 0>
            <thead>
              <tr>
                <th>\${item.quantity@label}</th>
                <th>\${item.item@label}</th>
                <th>\${item.rate@label}</th>
                <th>\${item.amount@label}</th>
              </tr>
            </thead>
          </#if>
          <tr>
            <td>\${item.quantity}</td>
            <td>\${item.item}<br />\${item.description}</td>
            <td align="right">\${item.rate}</td>
            <td align="right">\${item.amount}</td>
          </tr>
        </#list>
      </table>
    </#if>
  </body>
</pdf>`;

const defaultTemplate = freestyleTemplate;

type ContextMode = "freestyle" | "transaction" | "customrecord";

interface RecordTypeOption {
  id: string;
  name: string;
}

interface RecordListRow {
  id: string;
  label: string;
  meta: string;
  raw: Record<string, unknown>;
}

const TRANSACTION_RECORD_TYPES: Record<string, string> = {
  cashsale: "CashSale",
  creditmemo: "CustCred",
  customerdeposit: "CustDep",
  customerpayment: "CustPymt",
  estimate: "Estimate",
  invoice: "CustInvc",
  itemfulfillment: "ItemShip",
  journalentry: "Journal",
  opportunity: "Opprtnty",
  purchaseorder: "PurchOrd",
  returnauthorization: "RtnAuth",
  salesorder: "SalesOrd",
  vendorbill: "VendBill",
  vendorcredit: "VendCred"
};

const transactionRecordTypeOptions: RecordTypeOption[] = [
  { id: "estimate", name: "Estimate" },
  { id: "salesorder", name: "Sales Order" },
  { id: "invoice", name: "Invoice" },
  { id: "cashsale", name: "Cash Sale" },
  { id: "creditmemo", name: "Credit Memo" },
  { id: "customerpayment", name: "Customer Payment" },
  { id: "purchaseorder", name: "Purchase Order" },
  { id: "vendorbill", name: "Vendor Bill" },
  { id: "itemfulfillment", name: "Item Fulfillment" },
  { id: "journalentry", name: "Journal Entry" },
  { id: "opportunity", name: "Opportunity" }
];

const template = ref(defaultTemplate);
const renderedPdfUrl = ref("");
const renderError = ref("");
const isRendering = ref(false);
const lastRenderedAt = ref("");
const toast = useToast();
const contextMode = ref<ContextMode>("freestyle");
const customRecordTypes = ref<RecordTypeOption[]>([]);
const selectedRecordType = ref<RecordTypeOption | null>(null);
const selectedRecord = ref<RecordListRow | null>(null);
const recordSearch = ref("");
const recordRows = ref<RecordListRow[]>([]);
const recordTypesLoading = ref(false);
const recordsLoading = ref(false);
const recordListError = ref("");
const serverComponentsPanelRef = ref<InstanceType<typeof ServerComponentsPanel> | null>(null);

const recordTypeOptions = computed(() =>
  contextMode.value === "transaction"
    ? transactionRecordTypeOptions
    : customRecordTypes.value
);

const renderTemplate = async () => {
  if (!template.value.trim()) {
    renderError.value = "Template is empty.";
    return;
  }

  if (
    contextMode.value !== "freestyle" &&
    (!selectedRecordType.value || !selectedRecord.value)
  ) {
    renderError.value = "Select a record type and record, or switch to Freestyle.";
    return;
  }

  isRendering.value = true;
  renderError.value = "";

  try {
    const response = await callApi(
      RequestRoutes.RENDER_FREEMARKER_TEMPLATE,
      {
        template: template.value,
        recordType: contextMode.value === "freestyle" ? undefined : selectedRecordType.value?.id,
        recordId: contextMode.value === "freestyle" ? undefined : selectedRecord.value?.id
      },
      ApiRequestType.NORMAL
    );
    const result = (response as ApiResponse)?.message || response;

    if (!result?.success) {
      renderError.value = result?.error || "Template rendering failed.";
      return;
    }

    renderedPdfUrl.value = result.pdf
      ? `data:${result.mimeType || "application/pdf"};base64,${result.pdf}`
      : "";
    lastRenderedAt.value = new Date().toLocaleTimeString();
    await serverComponentsPanelRef.value?.check();
  } catch (err: any) {
    renderError.value = err?.message || String(err);
    toast.add({
      severity: "error",
      summary: "Render Failed",
      detail: renderError.value,
      life: 5000
    });
  } finally {
    isRendering.value = false;
  }
};

const openFreemarkerReference = () => {
  window.open("https://freemarker.apache.org/docs/index.html", "_blank");
};

const setContextMode = (mode: ContextMode) => {
  contextMode.value = mode;
  selectedRecordType.value = null;
  selectedRecord.value = null;
  recordRows.value = [];
  recordListError.value = "";
  localStorage.setItem(CONTEXT_MODE_KEY, mode);
  template.value =
    mode === "transaction"
      ? transactionTemplate
      : mode === "customrecord"
        ? customRecordTemplate
        : freestyleTemplate;
  if (mode === "customrecord" && customRecordTypes.value.length === 0) {
    void loadRecordTypes();
  }
};

const normalizeRecordTypeRow = (row: Record<string, unknown>): RecordTypeOption | null => {
  const rawId = String(row.id ?? row.ID ?? row.scriptId ?? "").trim();
  const rawName = String(row.name ?? row.Name ?? rawId).trim();
  if (!rawId || !rawName || !rawId.toLowerCase().startsWith("customrecord")) return null;
  return {
    id: rawId.toLowerCase(),
    name: rawName
  };
};

const loadRecordTypes = async () => {
  recordTypesLoading.value = true;
  recordListError.value = "";
  try {
    const response = await callApi(RequestRoutes.GET_ALL_RECORD_TYPES);
    const rows = Array.isArray(response.message) ? response.message : [];
    customRecordTypes.value = rows
      .map((row) => normalizeRecordTypeRow(row as Record<string, unknown>))
      .filter((row): row is RecordTypeOption => row !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err: any) {
    recordListError.value = err?.message || String(err);
  } finally {
    recordTypesLoading.value = false;
  }
};

const escapeSuiteQLString = (value: string): string =>
  value.replace(/'/g, "''");

const normalizeApiRows = (response: ApiResponse): Record<string, unknown>[] => {
  const message = response?.message;
  if (Array.isArray(message)) return message as Record<string, unknown>[];
  if (Array.isArray(message?.results)) return message.results as Record<string, unknown>[];
  return [];
};

const runSuiteQLRows = async (sql: string, limit = 100): Promise<Record<string, unknown>[]> => {
  const response = await callApi(
    RequestRoutes.RUN_SUITEQL_QUERY,
    { sql, limit },
    ApiRequestType.NORMAL
  );
  return normalizeApiRows(response);
};

const isNumericSearch = (value: string): boolean => /^\d+$/.test(value.trim());

const recordSearchClause = (fields: string[]): string => {
  const search = recordSearch.value.trim();
  if (!search) return "";
  const pieces: string[] = [];
  if (isNumericSearch(search)) pieces.push(`id = ${Number(search)}`);
  for (const field of fields) {
    pieces.push(`LOWER(${field}) LIKE LOWER('%${escapeSuiteQLString(search)}%')`);
  }
  return pieces.length ? ` AND (${pieces.join(" OR ")})` : "";
};

const mapRecordRows = (rows: Record<string, unknown>[]): RecordListRow[] =>
  rows
    .map((row) => {
      const id = String(row.id ?? row.ID ?? "");
      const label =
        String(row.name ?? row.entityid ?? row.altname ?? row.tranid ?? row.scriptid ?? "")
          .trim() || `#${id}`;
      const meta = Object.entries(row)
        .filter(([key, value]) => key.toLowerCase() !== "id" && value !== null && value !== undefined && value !== "")
        .slice(0, 3)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(" | ");
      return { id, label, meta, raw: row };
    })
    .filter((row) => row.id);

const buildRecordQueries = (recordType: string): string[] => {
  const transactionCode = TRANSACTION_RECORD_TYPES[recordType];
  if (transactionCode) {
    return [
      `SELECT id, tranid, BUILTIN.DF(entity) AS entity, trandate FROM transaction WHERE type = '${transactionCode}'${recordSearchClause(["tranid"])} ORDER BY id DESC`
    ];
  }

  const table = recordType.replace(/[^a-z0-9_]/gi, "");
  return [
    `SELECT id, name FROM ${table} WHERE 1 = 1${recordSearchClause(["name"])} ORDER BY id DESC`,
    `SELECT id, entityid, altname FROM ${table} WHERE 1 = 1${recordSearchClause(["entityid", "altname"])} ORDER BY id DESC`,
    `SELECT id, scriptid, name FROM ${table} WHERE 1 = 1${recordSearchClause(["scriptid", "name"])} ORDER BY id DESC`,
    `SELECT id FROM ${table} ORDER BY id DESC`
  ].map((query) => query.replace(/\s+/g, " ").trim());
};

const loadRecords = async () => {
  if (!selectedRecordType.value) return;
  recordsLoading.value = true;
  recordListError.value = "";
  selectedRecord.value = null;

  try {
    let rows: Record<string, unknown>[] = [];
    let lastError = "";
    for (const sql of buildRecordQueries(selectedRecordType.value.id)) {
      try {
        rows = await runSuiteQLRows(sql, 100);
        if (rows.length > 0 || sql.includes("SELECT id FROM")) break;
      } catch (err: any) {
        lastError = err?.message || String(err);
      }
    }
    if (rows.length === 0 && lastError) recordListError.value = lastError;
    recordRows.value = mapRecordRows(rows);
  } finally {
    recordsLoading.value = false;
  }
};

watch(template, (value) => {
  localStorage.setItem(STORAGE_KEY, value);
});

watch(contextMode, () => {
  if (!recordTypeOptions.value.includes(selectedRecordType.value as RecordTypeOption)) {
    selectedRecordType.value = null;
  }
});

onMounted(async () => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) template.value = saved;
  const savedMode = localStorage.getItem(CONTEXT_MODE_KEY);
  if (savedMode === "freestyle" || savedMode === "transaction" || savedMode === "customrecord") {
    contextMode.value = savedMode;
  }
  await loadRecordTypes();
});
</script>

<style scoped>
.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
  padding: 0.5rem;
}

.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  background: var(--p-slate-50);
}

.pane-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-height: 2.5rem;
  padding: 0 0.75rem;
  border-bottom: 1px solid var(--p-slate-200);
  color: var(--p-slate-700);
  font-size: 0.875rem;
  font-weight: 600;
}

.muted {
  color: var(--p-slate-500);
  font-size: 0.75rem;
  font-weight: 400;
}

.render-frame {
  flex: 1;
  width: 100%;
  min-height: 0;
  border: 0;
  background: white;
}

.render-error {
  flex: 1;
  overflow: auto;
  padding: 0.75rem;
  white-space: pre-wrap;
  color: var(--p-red-700);
  background: var(--p-red-50);
  font-family: "JetBrains Mono", monospace;
  font-size: 0.8125rem;
}

.preview-empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--p-slate-500);
  background: white;
  font-size: 0.875rem;
}

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

.context-mode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.375rem;
}

.context-mode-grid :deep(.p-button) {
  min-width: 0;
  padding-inline: 0.5rem;
}

.render-kbd {
  font-size: 0.6rem;
  font-family: "JetBrains Mono", monospace;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 3px;
  padding: 1px 4px;
  color: rgba(255, 255, 255, 0.8);
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

@media (max-width: 900px) {
  .workspace {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
