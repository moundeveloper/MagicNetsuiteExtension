<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { debounce } from "lodash";
import { callApi, closePanel, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import MSelect from "../components/universal/input/MSelect.vue";

type RecordTypeOption = {
  id: string;
  name: string;
};

type RecordRow = {
  id: string;
  label: string;
  meta: string;
};

const props = defineProps<{ vhOffset: number }>();
const route = useRoute();
const router = useRouter();

const recordTypes = ref<RecordTypeOption[]>([]);
const selectedRecordType = ref("");
const typeFilter = ref("");
const query = ref("");
const records = ref<RecordRow[]>([]);
const loadingTypes = ref(false);
const loadingRecords = ref(false);
const error = ref("");
const page = ref(1);
const pageSize = ref(25);
const totalCount = ref(0);
const resultSource = ref("");
let searchRequestId = 0;
let ignoreNextQueryWatch = false;
const pageSizeOptions = [
  { label: "25", value: 25 },
  { label: "50", value: 50 },
  { label: "100", value: 100 }
];

const TRANSACTION_TYPES: Record<string, string> = {
  salesorder: "SalesOrd",
  invoice: "CustInvc",
  purchaseorder: "PurchOrd",
  vendorbill: "VendBill",
  estimate: "Estimate",
  creditmemo: "CustCred",
  journalentry: "Journal",
  itemfulfillment: "ItemShip",
  cashsale: "CashSale"
};
const SEARCH_ONLY_RECORD_TYPES = new Set(["lead", "prospect"]);
const ENTITY_SUITEQL_TYPES = new Set([
  "customer",
  "contact",
  "vendor",
  "partner"
]);

const filteredRecordTypes = computed(() => {
  const needle = typeFilter.value.trim().toLowerCase();
  if (!needle) return recordTypes.value;
  return recordTypes.value.filter((type) =>
    `${type.name} ${type.id}`.toLowerCase().includes(needle)
  );
});

const selectedType = computed(() =>
  recordTypes.value.find((type) => type.id === selectedRecordType.value)
);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(totalCount.value / pageSize.value))
);
const firstVisibleRecord = computed(() =>
  totalCount.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1
);
const lastVisibleRecord = computed(() =>
  Math.min(totalCount.value, page.value * pageSize.value)
);

const escapeSuiteQL = (value: string) => value.replace(/'/g, "''");
const isNumeric = (value: string) => /^\d+$/.test(value.trim());

const buildSearchQueries = (recordType: string, searchText: string) => {
  const cleanType = recordType.replace(/[^a-z0-9_]/gi, "");
  const cleanQuery = searchText.trim();

  if (TRANSACTION_TYPES[cleanType]) {
    const conditions = [`type = '${TRANSACTION_TYPES[cleanType]}'`];
    if (cleanQuery) {
      const search = escapeSuiteQL(cleanQuery);
      conditions.push(
        isNumeric(cleanQuery)
          ? `(id = ${Number(cleanQuery)} OR LOWER(tranid) LIKE LOWER('%${search}%'))`
          : `LOWER(tranid) LIKE LOWER('%${search}%')`
      );
    }
    return [
      `SELECT id, tranid, BUILTIN.DF(entity) AS entity, trandate FROM transaction WHERE ${conditions.join(" AND ")} ORDER BY id DESC`
    ];
  }

  if (ENTITY_SUITEQL_TYPES.has(cleanType)) {
    const conditions: string[] = [];
    if (cleanQuery) {
      const search = escapeSuiteQL(cleanQuery);
      conditions.push(
        isNumeric(cleanQuery)
          ? `(id = ${Number(cleanQuery)} OR LOWER(entityid) LIKE LOWER('%${search}%') OR LOWER(altname) LIKE LOWER('%${search}%'))`
          : `(LOWER(entityid) LIKE LOWER('%${search}%') OR LOWER(altname) LIKE LOWER('%${search}%'))`
      );
    }
    return [
      `SELECT id, entityid, altname FROM ${cleanType}${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""} ORDER BY id DESC`
    ];
  }

  const where = (fields: string[]) => {
    const conditions: string[] = [];
    if (cleanQuery) {
      const search = escapeSuiteQL(cleanQuery);
      const matches = fields.map(
        (field) => `LOWER(${field}) LIKE LOWER('%${search}%')`
      );
      if (isNumeric(cleanQuery)) matches.unshift(`id = ${Number(cleanQuery)}`);
      conditions.push(`(${matches.join(" OR ")})`);
    }
    return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  };

  return [
    `SELECT id, name FROM ${cleanType} ${where(["name"])} ORDER BY id DESC`,
    `SELECT id, entityid, altname FROM ${cleanType} ${where(["entityid", "altname"])} ORDER BY id DESC`,
    `SELECT id, scriptid, name FROM ${cleanType} ${where(["scriptid", "name"])} ORDER BY id DESC`,
    `SELECT id FROM ${cleanType} ORDER BY id DESC`
  ];
};

const normalizeRows = (payload: any): Record<string, any>[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
};

const rowLabel = (row: Record<string, any>) =>
  String(
    row.name ??
      row.companyname ??
      row.entityid ??
      row.altname ??
      row.tranid ??
      row.scriptid ??
      row.displayname ??
      `#${row.id ?? ""}`
  ).trim();

const rowMeta = (row: Record<string, any>) =>
  [
    row.tranid,
    row.entityid,
    row.entity,
    row.trandate,
    row.scriptid,
    row.email
  ]
    .filter((value) => value !== undefined && value !== null && value !== "")
    .join(" · ");

const loadRecordTypes = async () => {
  loadingTypes.value = true;
  error.value = "";
  try {
    const response = await callApi(RequestRoutes.GET_ALL_RECORD_TYPES);
    if (response?.status === "error") throw new Error(String(response.message));
    const rows = Array.isArray(response?.message) ? response.message : [];
    recordTypes.value = rows
      .map((row: any) => ({
        id: String(row.id ?? "").toLowerCase(),
        name: String(row.name ?? row.id ?? "")
      }))
      .filter((row: RecordTypeOption) => row.id)
      .sort((a: RecordTypeOption, b: RecordTypeOption) =>
        a.name.localeCompare(b.name)
      );
    const requestedType = String(route.query.type ?? "").toLowerCase();
    const requestedQuery = String(route.query.q ?? "");
    selectedRecordType.value =
      recordTypes.value.find((type) => type.id === requestedType)?.id ??
      recordTypes.value.find((type) => type.id === "customer")?.id ??
      recordTypes.value[0]?.id ??
      "";
    if (requestedQuery) query.value = requestedQuery;
    if (selectedRecordType.value) await searchRecords();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loadingTypes.value = false;
  }
};

const searchRecords = async () => {
  if (!selectedRecordType.value) return;
  const requestId = ++searchRequestId;
  loadingRecords.value = true;
  error.value = "";

  let lastError = "";
  if (!SEARCH_ONLY_RECORD_TYPES.has(selectedRecordType.value)) {
    for (const sql of buildSearchQueries(selectedRecordType.value, query.value)) {
      try {
        const response = await callApi(RequestRoutes.RUN_SUITEQL_QUERY, {
          sql,
          limit: pageSize.value,
          offset: (page.value - 1) * pageSize.value
        });
        if (requestId !== searchRequestId) return;
        if (response?.status === "error") {
          lastError = String(response.message);
          continue;
        }
        const rows = normalizeRows(response?.message);
        records.value = rows.map((row) => ({
          id: String(row.id),
          label: rowLabel(row),
          meta: rowMeta(row)
        }));
        totalCount.value = Number(response?.message?.totalCount ?? rows.length);
        resultSource.value = "SuiteQL";
        loadingRecords.value = false;
        return;
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : String(cause);
      }
    }
  }

  try {
    const fallbackResponse = await callApi(RequestRoutes.SEARCH_RECORDS, {
      recordType: selectedRecordType.value,
      searchText: query.value,
      pageIndex: page.value - 1,
      pageSize: pageSize.value
    });
    if (requestId !== searchRequestId) return;
    if (fallbackResponse?.status === "error") {
      throw new Error(String(fallbackResponse.message));
    }
    const rows = normalizeRows(fallbackResponse?.message);
    records.value = rows.map((row) => ({
      id: String(row.id),
      label: rowLabel(row),
      meta: rowMeta(row)
    }));
    totalCount.value = Number(fallbackResponse?.message?.totalCount ?? rows.length);
    resultSource.value = "N/search";
    error.value = "";
  } catch (cause) {
    if (requestId !== searchRequestId) return;
    records.value = [];
    totalCount.value = 0;
    resultSource.value = "";
    const fallbackError = cause instanceof Error ? cause.message : String(cause);
    error.value =
      fallbackError ||
      lastError ||
      `NetSuite could not list ${selectedType.value?.name ?? selectedRecordType.value}. You can still open a known internal ID below.`;
  } finally {
    if (requestId === searchRequestId) loadingRecords.value = false;
  }
};

const selectType = async (recordType: string) => {
  debouncedSearch.cancel();
  selectedRecordType.value = recordType;
  if (query.value) ignoreNextQueryWatch = true;
  query.value = "";
  page.value = 1;
  records.value = [];
  await searchRecords();
};

const runSearchNow = async () => {
  debouncedSearch.cancel();
  page.value = 1;
  await searchRecords();
};

const debouncedSearch = debounce(() => {
  page.value = 1;
  void searchRecords();
}, 450);

const previousPage = async () => {
  if (page.value <= 1 || loadingRecords.value) return;
  page.value -= 1;
  await searchRecords();
};

const nextPage = async () => {
  if (page.value >= pageCount.value || loadingRecords.value) return;
  page.value += 1;
  await searchRecords();
};

const changePageSize = async () => {
  page.value = 1;
  await searchRecords();
};

const openDetails = (recordId: string) => {
  router.push({
    name: "RecordDetail",
    params: {
      recordType: selectedRecordType.value,
      recordId
    }
  });
};

const openInNetSuite = async (recordId: string) => {
  try {
    const response = (await callApi(RequestRoutes.GET_RECORD_URL, {
      type: selectedRecordType.value,
      id: recordId,
      isEditMode: false
    })) as ApiResponse;
    if (response?.status === "error") throw new Error(String(response.message));
    window.open(String(response.message), "_blank");
    closePanel();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
};

const openKnownId = (target: "details" | "netsuite") => {
  const id = query.value.trim();
  if (!isNumeric(id)) {
    error.value = "Enter a numeric internal ID first.";
    return;
  }
  if (target === "details") openDetails(id);
  else void openInNetSuite(id);
};

watch(query, () => {
  if (ignoreNextQueryWatch) {
    ignoreNextQueryWatch = false;
    return;
  }
  searchRequestId += 1;
  debouncedSearch();
});
watch(
  () => route.query,
  async (nextQuery) => {
    const requestedType = String(nextQuery.type ?? "").toLowerCase();
    const requestedSearch = String(nextQuery.q ?? "");
    if (!requestedType && !requestedSearch) return;
    if (
      selectedRecordType.value === requestedType &&
      query.value === requestedSearch
    ) {
      return;
    }
    if (requestedType && recordTypes.value.some((type) => type.id === requestedType)) {
      selectedRecordType.value = requestedType;
    }
    query.value = requestedSearch;
    page.value = 1;
    await searchRecords();
  }
);
onMounted(loadRecordTypes);
onBeforeUnmount(() => debouncedSearch.cancel());
</script>

<template>
  <section class="records-view" :style="{ height: `${props.vhOffset}vh` }">
    <aside class="record-types">
      <div class="pane-title">
        <div>
          <strong>Record types</strong>
          <small>{{ recordTypes.length }} standard and custom types</small>
        </div>
        <button title="Refresh record types" :disabled="loadingTypes" @click="loadRecordTypes">
          <i :class="loadingTypes ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" />
        </button>
      </div>
      <label class="search-box">
        <i class="pi pi-search" />
        <input v-model="typeFilter" placeholder="Filter record types" />
      </label>
      <div class="type-list">
        <button
          v-for="type in filteredRecordTypes"
          :key="type.id"
          :class="{ active: selectedRecordType === type.id }"
          @click="selectType(type.id)"
        >
          <span>{{ type.name }}</span>
          <small>{{ type.id }}</small>
        </button>
      </div>
    </aside>

    <main class="records-main">
      <header class="records-toolbar">
        <div class="current-type">
          <i class="pi pi-database" />
          <span>
            <strong>{{ selectedType?.name || "Records" }}</strong>
            <small>{{ selectedRecordType }}</small>
          </span>
        </div>
        <label class="search-box record-search">
          <i class="pi pi-search" />
          <input
            v-model="query"
            placeholder="ID, name, transaction number, script ID"
            @keydown.enter.prevent="runSearchNow"
          />
        </label>
        <button class="primary-action" :disabled="loadingRecords" @click="runSearchNow">
          <i :class="loadingRecords ? 'pi pi-spin pi-spinner' : 'pi pi-search'" />
          Search
        </button>
      </header>

      <p v-if="error" class="error-banner">{{ error }}</p>

      <div class="records-table">
        <div v-if="loadingRecords" class="loading-state">
          <i class="pi pi-spin pi-spinner" />
          Loading records…
        </div>
        <table>
          <thead>
            <tr>
              <th>Record</th>
              <th>Type</th>
              <th>Internal ID</th>
              <th class="actions-heading">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="record in records" :key="record.id">
              <td>
                <span class="record-name">
                  <i class="pi pi-database" />
                  <span>
                    <strong>{{ record.label }}</strong>
                    <small v-if="record.meta">{{ record.meta }}</small>
                  </span>
                </span>
              </td>
              <td><code>{{ selectedRecordType }}</code></td>
              <td>#{{ record.id }}</td>
              <td class="row-actions">
                <button title="Open in NetSuite" @click="openInNetSuite(record.id)">
                  <i class="pi pi-external-link" />
                  NetSuite
                </button>
                <button title="View all body fields and sublists" @click="openDetails(record.id)">
                  <i class="pi pi-eye" />
                  Details
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!loadingRecords && records.length === 0" class="empty-state">
          <i class="pi pi-search" />
          <strong>No records listed</strong>
          <span>Search this type, or enter a known internal ID and open it directly.</span>
          <div>
            <button @click="openKnownId('netsuite')">
              <i class="pi pi-external-link" /> Open ID in NetSuite
            </button>
            <button @click="openKnownId('details')">
              <i class="pi pi-eye" /> View ID details
            </button>
          </div>
        </div>
      </div>
      <footer class="pagination-bar">
        <span>
          {{ firstVisibleRecord }}–{{ lastVisibleRecord }} of {{ totalCount }}
          <small v-if="resultSource">via {{ resultSource }}</small>
        </span>
        <label>
          Rows
          <MSelect
            v-model="pageSize"
            class="page-size-select"
            size="small"
            :options="pageSizeOptions"
            :disabled="loadingRecords"
            @update:model-value="changePageSize"
          />
        </label>
        <div>
          <button :disabled="page <= 1 || loadingRecords" @click="previousPage">
            <i class="pi pi-angle-left" />
          </button>
          <span>Page {{ page }} / {{ pageCount }}</span>
          <button :disabled="page >= pageCount || loadingRecords" @click="nextPage">
            <i class="pi pi-angle-right" />
          </button>
        </div>
      </footer>
    </main>
  </section>
</template>

<style scoped>
.records-view {
  display: grid;
  grid-template-columns: 270px minmax(0, 1fr);
  min-height: 430px;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 10px;
  background: white;
}

.record-types,
.records-main {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
}

.record-types {
  border-right: 1px solid var(--p-slate-200);
  background: #f8fafc;
}

.pane-title,
.records-toolbar {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  min-height: 58px;
  padding: 0.65rem 0.8rem;
  border-bottom: 1px solid var(--p-slate-200);
}

.pane-title {
  justify-content: space-between;
}

.pane-title div,
.current-type span,
.record-name > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.pane-title small,
.current-type small,
.record-name small {
  color: var(--p-slate-500);
  font-size: 0.7rem;
}

button {
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  background: white;
  color: var(--p-slate-600);
  cursor: pointer;
}

button:hover:not(:disabled) {
  border-color: var(--p-purple-300);
  color: var(--p-purple-700);
}

.pane-title button {
  width: 30px;
  height: 30px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0.65rem;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: white;
  color: var(--p-slate-400);
}

.search-box input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  color: var(--p-slate-700);
  background: transparent;
  font: inherit;
}

.type-list {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.25rem;
  overflow: auto;
  padding: 0 0.55rem 0.65rem;
}

.type-list button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0.5rem 0.6rem;
  text-align: left;
}

.type-list button.active {
  border-color: var(--p-purple-300);
  background: var(--p-purple-50);
  color: var(--p-purple-800);
}

.type-list small {
  color: var(--p-slate-400);
  font-size: 0.68rem;
}

.records-toolbar {
  flex-wrap: wrap;
}

.current-type {
  display: flex;
  min-width: 180px;
  align-items: center;
  gap: 0.6rem;
}

.current-type > i,
.record-name > i {
  color: var(--p-purple-600);
}

.record-search {
  flex: 1;
  margin: 0;
}

.primary-action {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 36px;
  padding: 0 0.85rem;
  border-color: var(--p-purple-200);
  background: var(--p-purple-50);
  color: var(--p-purple-700);
}

.primary-action:hover:not(:disabled) {
  border-color: var(--p-purple-300);
  background: var(--p-purple-100);
  color: var(--p-purple-800);
}

.error-banner {
  margin: 0.6rem 0.75rem 0;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--p-red-200);
  border-radius: 7px;
  background: var(--p-red-50);
  color: var(--p-red-700);
  font-size: 0.78rem;
}

.records-table {
  position: relative;
  min-height: 0;
  flex: 1;
  overflow: auto;
  margin: 0.75rem 0.75rem 0;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
}

.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 1rem;
  min-height: 42px;
  margin: 0 0.75rem 0.75rem;
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--p-slate-200);
  border-top: 0;
  border-radius: 0 0 8px 8px;
  background: #f8fafc;
  color: var(--p-slate-500);
  font-size: 0.72rem;
}

.pagination-bar label,
.pagination-bar div {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.pagination-bar > span {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.pagination-bar small {
  color: var(--p-purple-600);
}

.page-size-select {
  width: 72px;
}

.pagination-bar button {
  width: 28px;
  height: 28px;
}

.pagination-bar button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

table {
  width: 100%;
  border-collapse: collapse;
}

thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

th,
td {
  padding: 0.62rem 0.75rem;
  border-bottom: 1px solid var(--p-slate-100);
  color: var(--p-slate-600);
  text-align: left;
}

th {
  background: #f8fafc;
  color: var(--p-slate-500);
  font-size: 0.68rem;
  text-transform: uppercase;
}

tbody tr:hover {
  background: var(--p-purple-50);
}

.record-name {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.record-name strong {
  color: var(--p-slate-800);
}

.actions-heading,
.row-actions {
  text-align: right;
  white-space: nowrap;
}

.row-actions button,
.empty-state button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: 0.35rem;
  padding: 0.38rem 0.55rem;
}

.loading-state {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: rgb(255 255 255 / 82%);
  color: var(--p-slate-500);
}

.empty-state {
  display: flex;
  min-height: 260px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 0.45rem;
  color: var(--p-slate-500);
}

.empty-state > i {
  font-size: 2rem;
  color: var(--p-slate-300);
}

.empty-state div {
  margin-top: 0.5rem;
}

@media (max-width: 760px) {
  .records-view {
    grid-template-columns: 1fr;
    grid-template-rows: 210px minmax(0, 1fr);
  }

  .record-types {
    border-right: 0;
    border-bottom: 1px solid var(--p-slate-200);
  }
}
</style>
