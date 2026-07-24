<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Button, Tag, useToast } from "primevue";
import { debounce } from "lodash";
import { useRoute, useRouter } from "vue-router";
import MSelect from "../components/universal/input/MSelect.vue";
import { callApi, getNetsuiteEnvironment } from "../utils/api";
import { RequestRoutes } from "../types/request";
import {
  addWatchedRecord,
  listWatchedRecords,
  removeWatchedRecord,
  type WatchedRecord
} from "../utils/recordWatchDb";
import {
  buildSystemNoteQuery,
  buildSystemNoteStreamsQuery,
  formatSystemNoteField,
  groupSystemNotes,
  normalizeSystemNoteRows,
  normalizeSystemNoteStreams,
  type SystemNoteStream,
  type SystemNoteRow
} from "../utils/systemNoteHistory";
import {
  buildRecordLookupQueries,
  normalizeRecordLookupRow,
  normalizeRecordLookupRows,
  SEARCH_ONLY_RECORD_TYPES,
  type RecordLookupRow
} from "../utils/recordLookup";

type RecordTypeOption = {
  id: string;
  name: string;
};

type RecordSelectOption = {
  label: string;
  value: string;
  name: string;
};

const props = defineProps<{
  vhOffset: number;
  tabFullPath?: string;
  tabActive?: boolean;
}>();
const route = useRoute();
const router = useRouter();
const ownRoute = computed(() =>
  router.resolve(props.tabFullPath || route.fullPath)
);
const toast = useToast();

const environment = ref("unknown");
const savedRecords = ref<WatchedRecord[]>([]);
const savedLoading = ref(true);
const historyLoading = ref(false);
const streamLoading = ref(false);
const error = ref("");
const recordType = ref("");
const recordId = ref("");
const recordTypes = ref<RecordTypeOption[]>([]);
const recordTypesLoading = ref(false);
const recordOptions = ref<RecordSelectOption[]>([]);
const recordsLoading = ref(false);
const recordLookupError = ref("");
const recordSearchQuery = ref("");
const savedSearch = ref("");
const selectedRecord = ref<{
  recordType: string;
  recordId: string;
  label: string;
} | null>(null);
const notes = ref<SystemNoteRow[]>([]);
const detectedStreams = ref<SystemNoteStream[]>([]);
const selectedStreamKey = ref("");
const textFilter = ref("");
const actorFilter = ref("all");
const contextFilter = ref("all");
const periodFilter = ref("all");
const resultLimit = ref("1000");
let recordSearchRequestId = 0;

const recordTypeOptions = computed(() =>
  recordTypes.value.map((type) => ({
    label: `${type.name} · ${type.id}`,
    value: type.id
  }))
);

const selectedRecordOption = computed(() =>
  recordOptions.value.find((option) => option.value === recordId.value)
);

const limitOptions = [
  { label: "Last 250 notes", value: "250" },
  { label: "Last 500 notes", value: "500" },
  { label: "Last 1,000 notes", value: "1000" },
  { label: "Last 2,500 notes", value: "2500" }
];

const periodOptions = [
  { label: "All retained history", value: "all" },
  { label: "Last 7 days", value: "7" },
  { label: "Last 30 days", value: "30" },
  { label: "Last 90 days", value: "90" },
  { label: "Last year", value: "365" }
];

const filteredSavedRecords = computed(() => {
  const needle = savedSearch.value.trim().toLowerCase();
  if (!needle) return savedRecords.value;
  return savedRecords.value.filter((record) =>
    `${record.label} ${record.recordType} ${record.recordId}`
      .toLowerCase()
      .includes(needle)
  );
});

const selectedSavedRecord = computed(() => {
  const current = selectedRecord.value;
  if (!current) return null;
  return (
    savedRecords.value.find(
      (record) =>
        record.recordType.toLowerCase() === current.recordType.toLowerCase() &&
        record.recordId === current.recordId
    ) ?? null
  );
});

const streams = computed(() => detectedStreams.value);

const streamOptions = computed(() =>
  streams.value.map((stream) => ({
    label: `${stream.record} · ${stream.count} note${stream.count === 1 ? "" : "s"}`,
    value: stream.key
  }))
);

const selectedStream = computed(
  () =>
    streams.value.find((stream) => stream.key === selectedStreamKey.value) ??
    null
);

const streamRows = computed(() => notes.value);

const actorOptions = computed(() => [
  { label: "All people", value: "all" },
  ...[...new Set(streamRows.value.map((row) => row.changedBy))]
    .sort((a, b) => a.localeCompare(b))
    .map((actor) => ({ label: actor, value: actor }))
]);

const contextOptions = computed(() => [
  { label: "All contexts", value: "all" },
  ...[...new Set(streamRows.value.map((row) => row.context))]
    .sort((a, b) => a.localeCompare(b))
    .map((context) => ({ label: context, value: context }))
]);

const visibleRows = computed(() => {
  const needle = textFilter.value.trim().toLowerCase();
  const periodDays =
    periodFilter.value === "all" ? null : Number(periodFilter.value);
  const cutoff =
    periodDays === null ? null : Date.now() - periodDays * 24 * 60 * 60 * 1000;

  return streamRows.value.filter((row) => {
    if (actorFilter.value !== "all" && row.changedBy !== actorFilter.value) {
      return false;
    }
    if (contextFilter.value !== "all" && row.context !== contextFilter.value) {
      return false;
    }
    if (
      cutoff !== null &&
      (row.timestamp === null || row.timestamp < cutoff)
    ) {
      return false;
    }
    if (!needle) return true;
    return [
      row.field,
      formatSystemNoteField(row.field),
      row.oldValue,
      row.newValue,
      row.changedBy,
      row.role,
      row.context
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
});

const events = computed(() => groupSystemNotes(visibleRows.value));

const summary = computed(() => {
  const timestamps = streamRows.value
    .map((row) => row.timestamp)
    .filter((value): value is number => value !== null);
  return {
    notes: selectedStream.value?.count ?? streamRows.value.length,
    fields: new Set(streamRows.value.map((row) => row.field)).size,
    people: new Set(streamRows.value.map((row) => row.changedBy)).size,
    first: timestamps.length ? Math.min(...timestamps) : null,
    latest: timestamps.length ? Math.max(...timestamps) : null
  };
});

const toRecordSelectOption = (row: RecordLookupRow): RecordSelectOption => ({
  label: `#${row.id} · ${row.label}`,
  value: row.id,
  name: row.label
});

const keepSelectedRecordOption = (options: RecordSelectOption[]) => {
  const current = selectedRecord.value;
  if (
    current &&
    current.recordType.toLowerCase() === recordType.value.toLowerCase() &&
    !options.some((option) => option.value === current.recordId)
  ) {
    return [
      {
        label: `#${current.recordId} · ${current.label}`,
        value: current.recordId,
        name: current.label
      },
      ...options
    ];
  }
  const selectedId = recordId.value;
  if (
    !selectedId ||
    options.some((option) => option.value === selectedId)
  ) {
    return options;
  }
  const existing = recordOptions.value.find(
    (option) => option.value === selectedId
  );
  if (!existing) return options;
  return [existing, ...options];
};

const loadRecordTypes = async () => {
  recordTypesLoading.value = true;
  recordLookupError.value = "";
  try {
    const response = await callApi(RequestRoutes.GET_ALL_RECORD_TYPES);
    if (response?.status === "error") throw new Error(String(response.message));
    const rows = Array.isArray(response?.message) ? response.message : [];
    const availableTypes = rows
      .map((row: any) => ({
        id: String(row.id ?? "").toLowerCase(),
        name: String(row.name ?? row.id ?? "")
      }))
      .filter((row: RecordTypeOption) => row.id);
    if (!availableTypes.some((type: RecordTypeOption) => type.id === "script")) {
      availableTypes.push({ id: "script", name: "Script" });
    }
    recordTypes.value = availableTypes.sort(
      (a: RecordTypeOption, b: RecordTypeOption) =>
        a.name.localeCompare(b.name)
    );
  } catch (cause) {
    recordLookupError.value =
      cause instanceof Error ? cause.message : String(cause);
  } finally {
    recordTypesLoading.value = false;
  }
};

const loadRecordOptions = async (searchText = "") => {
  const currentType = recordType.value.trim().toLowerCase();
  if (!currentType) {
    recordOptions.value = [];
    return;
  }

  const requestId = ++recordSearchRequestId;
  recordsLoading.value = true;
  recordLookupError.value = "";
  let lastError = "";

  if (!SEARCH_ONLY_RECORD_TYPES.has(currentType)) {
    for (const sql of buildRecordLookupQueries(currentType, searchText)) {
      try {
        const response = await callApi(RequestRoutes.RUN_SUITEQL_QUERY, {
          sql,
          limit: 100,
          offset: 0
        });
        if (requestId !== recordSearchRequestId) return;
        if (response?.status === "error") {
          lastError = String(response.message);
          continue;
        }
        const rows = normalizeRecordLookupRows(response?.message)
          .map(normalizeRecordLookupRow)
          .filter((row) => row.id);
        recordOptions.value = keepSelectedRecordOption(
          rows.map(toRecordSelectOption)
        );
        recordsLoading.value = false;
        return;
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : String(cause);
      }
    }
  }

  try {
    const response = await callApi(RequestRoutes.SEARCH_RECORDS, {
      recordType: currentType,
      searchText,
      pageIndex: 0,
      pageSize: 100
    });
    if (requestId !== recordSearchRequestId) return;
    if (response?.status === "error") throw new Error(String(response.message));
    const rows = normalizeRecordLookupRows(response?.message)
      .map(normalizeRecordLookupRow)
      .filter((row) => row.id);
    recordOptions.value = keepSelectedRecordOption(
      rows.map(toRecordSelectOption)
    );
  } catch (cause) {
    if (requestId !== recordSearchRequestId) return;
    recordOptions.value = keepSelectedRecordOption([]);
    const fallbackError = cause instanceof Error ? cause.message : String(cause);
    recordLookupError.value =
      fallbackError ||
      lastError ||
      "NetSuite could not list records for this record type.";
  } finally {
    if (requestId === recordSearchRequestId) recordsLoading.value = false;
  }
};

const debouncedRecordSearch = debounce((query: string) => {
  void loadRecordOptions(query);
}, 350);

const handleRecordTypeChange = (value: string | number | null) => {
  debouncedRecordSearch.cancel();
  recordType.value = String(value ?? "");
  recordId.value = "";
  recordOptions.value = [];
  recordSearchQuery.value = "";
  recordLookupError.value = "";
  if (recordType.value) void loadRecordOptions();
};

const handleRecordSearch = (query: string) => {
  recordSearchQuery.value = query;
  debouncedRecordSearch(query);
};

const loadSavedRecords = async () => {
  savedLoading.value = true;
  try {
    environment.value = await getNetsuiteEnvironment().catch(() => "unknown");
    savedRecords.value = await listWatchedRecords(environment.value);
  } finally {
    savedLoading.value = false;
  }
};

const chooseInitialStream = (preferredLabel = "") => {
  const available = streams.value;
  if (!available.length) {
    selectedStreamKey.value = "";
    return;
  }
  const label = preferredLabel.toLowerCase();
  const preferred =
    available.find((stream) => {
      const candidate = stream.record.toLowerCase();
      return label && (candidate.includes(label) || label.includes(candidate));
    }) ?? available[0]!;
  selectedStreamKey.value = preferred.key;
};

const loadRecordLabel = async (
  type: string,
  id: string
): Promise<string> => {
  try {
    const response = await callApi(RequestRoutes.LOAD_RECORD_JSON, {
      type,
      id,
      includeSublists: false
    });
    if (response?.status === "error") return "";
    const body = (
      response.message as {
        body?: Record<string, { text?: unknown; value?: unknown }>;
      }
    )?.body;
    if (!body) return "";
    const preferredFields = [
      "tranid",
      "entityid",
      "companyname",
      "periodname",
      "itemid",
      "title",
      "scriptid",
      "name",
      "altname"
    ];
    for (const fieldId of preferredFields) {
      const field = body[fieldId];
      const value = field?.text ?? field?.value;
      if (value !== null && value !== undefined && String(value).trim()) {
        return String(value).trim();
      }
    }
  } catch {
    // System-note history can still be shown when the record body is unavailable.
  }
  return "";
};

const loadSelectedStream = async () => {
  const current = selectedRecord.value;
  const streamKey = selectedStreamKey.value;
  if (!current || !streamKey) {
    notes.value = [];
    return;
  }
  streamLoading.value = true;
  error.value = "";
  try {
    const response = await callApi(RequestRoutes.RUN_SUITEQL_QUERY, {
      sql: buildSystemNoteQuery(
        current.recordId,
        Number(resultLimit.value),
        streamKey
      ),
      limit: Number(resultLimit.value)
    });
    if (response?.status === "error") {
      throw new Error(String(response.message));
    }
    notes.value = normalizeSystemNoteRows(response);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    notes.value = [];
  } finally {
    streamLoading.value = false;
  }
};

const openHistory = async ({
  type,
  id,
  label = ""
}: {
  type: string;
  id: string;
  label?: string;
}) => {
  const cleanType = type.trim();
  const cleanId = id.trim();
  if (!cleanType) {
    error.value = "Enter the NetSuite record type.";
    return;
  }
  if (!/^\d+$/.test(cleanId)) {
    error.value = "Record internal ID must be a positive number.";
    return;
  }

  const keepCurrentLookupResults =
    recordType.value.trim().toLowerCase() === cleanType.toLowerCase();
  const currentLookupResults = keepCurrentLookupResults
    ? recordOptions.value
    : [];

  selectedRecord.value = {
    recordType: cleanType,
    recordId: cleanId,
    label: label || `${cleanType} #${cleanId}`
  };
  recordType.value = cleanType;
  recordId.value = cleanId;
  if (!keepCurrentLookupResults) recordSearchQuery.value = "";
  recordOptions.value = keepSelectedRecordOption(currentLookupResults);
  const recordOptionsRefresh = loadRecordOptions(recordSearchQuery.value);
  historyLoading.value = true;
  error.value = "";
  notes.value = [];
  detectedStreams.value = [];
  selectedStreamKey.value = "";
  textFilter.value = "";
  actorFilter.value = "all";
  contextFilter.value = "all";

  try {
    const [streamResponse, discoveredLabel] = await Promise.all([
      callApi(RequestRoutes.RUN_SUITEQL_QUERY, {
        sql: buildSystemNoteStreamsQuery(cleanId),
        limit: 100
      }),
      label ? Promise.resolve(label) : loadRecordLabel(cleanType, cleanId),
      recordOptionsRefresh
    ]);
    if (streamResponse?.status === "error") {
      throw new Error(String(streamResponse.message));
    }
    detectedStreams.value = normalizeSystemNoteStreams(streamResponse);
    chooseInitialStream(discoveredLabel);
    await loadSelectedStream();
    const chosen = streams.value.find(
      (stream) => stream.key === selectedStreamKey.value
    );
    if (chosen && selectedRecord.value) {
      selectedRecord.value.label = chosen.record;
      recordOptions.value = keepSelectedRecordOption(
        recordOptions.value.filter((option) => option.value !== cleanId)
      );
    }
    await router.replace({
      path: "/watchtower",
      query: {
        type: cleanType,
        id: cleanId,
        ...(selectedRecord.value?.label
          ? { label: selectedRecord.value.label }
          : {})
      }
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    historyLoading.value = false;
  }
};

const openFromForm = () =>
  openHistory({
    type: recordType.value,
    id: recordId.value,
    label: selectedRecordOption.value?.name
  });

const refreshHistory = () => {
  const current = selectedRecord.value;
  if (!current) return;
  void openHistory({
    type: current.recordType,
    id: current.recordId,
    label: current.label
  });
};

const saveCurrentRecord = async () => {
  const current = selectedRecord.value;
  if (!current || selectedSavedRecord.value) return;
  const selectedStream = streams.value.find(
    (stream) => stream.key === selectedStreamKey.value
  );
  await addWatchedRecord({
    environment: environment.value,
    recordType: current.recordType,
    recordId: current.recordId,
    label: selectedStream?.record || current.label
  });
  await loadSavedRecords();
  toast.add({
    severity: "success",
    summary: "Saved to Record History",
    detail: "This record is now available from the saved list.",
    life: 2400
  });
};

const removeSavedRecord = async (record: WatchedRecord) => {
  await removeWatchedRecord(record.key);
  await loadSavedRecords();
  toast.add({
    severity: "info",
    summary: "Removed from saved records",
    detail: record.label,
    life: 2000
  });
};

const handleChanged = () => void loadSavedRecords();

const handleEnvironmentChanged = async () => {
  debouncedRecordSearch.cancel();
  recordSearchRequestId += 1;
  selectedRecord.value = null;
  recordType.value = "";
  recordId.value = "";
  recordOptions.value = [];
  notes.value = [];
  detectedStreams.value = [];
  selectedStreamKey.value = "";
  await Promise.all([loadSavedRecords(), loadRecordTypes()]);
};

const formatDate = (timestamp: number | null, fallback = "") => {
  if (timestamp === null) return fallback || "Unknown date";
  const includesTime = /(?:T|\d{1,2}:\d{2})/.test(fallback);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(includesTime ? { timeStyle: "short" as const } : {})
  }).format(timestamp);
};

const formatShortDate = (timestamp: number | null) => {
  if (timestamp === null) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(timestamp);
};

const formatValue = (value: string) => (value === "" ? "Empty" : value);

const changeKind = (row: SystemNoteRow) => {
  if (!row.oldValue && row.newValue) return "added";
  if (row.oldValue && !row.newValue) return "cleared";
  return "changed";
};

watch(selectedStreamKey, (value, previous) => {
  actorFilter.value = "all";
  contextFilter.value = "all";
  const selectedStream = streams.value.find(
    (stream) => stream.key === selectedStreamKey.value
  );
  if (selectedStream && selectedRecord.value) {
    selectedRecord.value.label = selectedStream.record;
  }
  if (value && previous && !historyLoading.value) {
    void loadSelectedStream();
  }
});

watch(resultLimit, () => {
  if (selectedRecord.value) refreshHistory();
});

watch(
  () => ownRoute.value.fullPath,
  () => {
    const { type, id, label } = ownRoute.value.query;
    if (!type || !id) return;
    if (
      selectedRecord.value?.recordType.toLowerCase() ===
        String(type).toLowerCase() &&
      selectedRecord.value?.recordId === String(id)
    ) {
      return;
    }
    void openHistory({
      type: String(type),
      id: String(id),
      label: String(label || "")
    });
  }
);

onMounted(async () => {
  await Promise.all([loadSavedRecords(), loadRecordTypes()]);
  const type = String(ownRoute.value.query.type || "").trim();
  const id = String(ownRoute.value.query.id || "").trim();
  const label = String(ownRoute.value.query.label || "").trim();
  if (type && id) await openHistory({ type, id, label });
  window.addEventListener("magic-netsuite-watchtower-changed", handleChanged);
  window.addEventListener(
    "magic-netsuite-environment-changed",
    handleEnvironmentChanged
  );
});

onBeforeUnmount(() => {
  debouncedRecordSearch.cancel();
  recordSearchRequestId += 1;
  window.removeEventListener("magic-netsuite-watchtower-changed", handleChanged);
  window.removeEventListener(
    "magic-netsuite-environment-changed",
    handleEnvironmentChanged
  );
});
</script>

<template>
  <section class="record-history" :style="{ height: `${props.vhOffset}vh` }">
    <header class="history-header">
      <div class="heading-copy">
        <span class="eyebrow">
          <i class="pi pi-history" />
          NETSUITE SYSTEM NOTES
        </span>
        <h1>Record History</h1>
        <p>Inspect changes NetSuite retained before and after this extension was installed.</p>
      </div>
      <div class="header-actions">
        <MSelect
          v-model="resultLimit"
          :options="limitOptions"
          option-label="label"
          option-value="value"
          size="small"
          aria-label="System note result limit"
        />
        <Button
          icon="pi pi-refresh"
          label="Refresh"
          size="small"
          outlined
          :loading="historyLoading || streamLoading"
          :disabled="!selectedRecord"
          @click="refreshHistory"
        />
      </div>
    </header>

    <form class="record-lookup" @submit.prevent="openFromForm">
      <label>
        <span>Record type</span>
        <MSelect
          v-model="recordType"
          :options="recordTypeOptions"
          option-label="label"
          option-value="value"
          placeholder="Select a record type…"
          search-placeholder="Search record types…"
          empty-label="No record types found"
          searchable
          :loading="recordTypesLoading"
          @update:model-value="handleRecordTypeChange"
        />
      </label>
      <label>
        <span>Record</span>
        <MSelect
          v-model="recordId"
          :options="recordOptions"
          option-label="label"
          option-value="value"
          placeholder="Select a record…"
          search-placeholder="Search by internal ID or name…"
          :empty-label="
            recordSearchQuery
              ? 'No matching records'
              : 'No records available'
          "
          searchable
          :filter-options="false"
          :loading="recordsLoading"
          :disabled="!recordType"
          @search="handleRecordSearch"
        />
      </label>
      <Button
        type="submit"
        icon="pi pi-search"
        label="Open history"
        size="small"
        :loading="historyLoading"
        :disabled="!recordType.trim() || !recordId.trim()"
      />
      <p v-if="recordLookupError" class="lookup-error">
        <i class="pi pi-exclamation-triangle" />
        {{ recordLookupError }}
      </p>
    </form>

    <div class="history-workspace">
      <aside class="saved-pane">
        <div class="pane-heading">
          <div>
            <strong>Saved records</strong>
            <small>{{ savedRecords.length }} quick links</small>
          </div>
        </div>

        <label class="saved-search">
          <i class="pi pi-search" />
          <input v-model="savedSearch" placeholder="Filter saved records…" />
        </label>

        <div v-if="savedLoading" class="pane-empty">
          <i class="pi pi-spin pi-spinner" />
          Loading…
        </div>
        <div v-else-if="!filteredSavedRecords.length" class="pane-empty">
          <i class="pi pi-bookmark" />
          <strong>No saved records</strong>
          <span>Open any record history and save it for quick access.</span>
        </div>
        <div v-else class="saved-list">
          <div
            v-for="record in filteredSavedRecords"
            :key="record.key"
            class="saved-record"
            :class="{ active: selectedSavedRecord?.key === record.key }"
          >
            <button
              class="saved-record-main"
              :title="record.label"
              @click="
                openHistory({
                  type: record.recordType,
                  id: record.recordId,
                  label: record.label
                })
              "
            >
              <span class="record-icon"><i class="pi pi-database" /></span>
              <span class="record-copy">
                <strong>{{ record.label }}</strong>
                <small>{{ record.recordType }} #{{ record.recordId }}</small>
              </span>
            </button>
            <button
              class="remove-record"
              title="Remove from saved records"
              @click="removeSavedRecord(record)"
            >
              <i class="pi pi-times" />
            </button>
          </div>
        </div>
      </aside>

      <main class="history-detail">
        <div v-if="!selectedRecord && !historyLoading" class="detail-empty">
          <span class="empty-icon"><i class="pi pi-history" /></span>
          <strong>Open a record to see its complete audit trail</strong>
          <span>
            System notes are read directly from NetSuite. No baseline or previous scan is required.
          </span>
        </div>

        <div v-else-if="historyLoading" class="detail-empty">
          <span class="empty-icon"><i class="pi pi-spin pi-spinner" /></span>
          <strong>Loading system notes</strong>
          <span>Reading the retained history for {{ recordType }} #{{ recordId }}…</span>
        </div>

        <template v-else-if="selectedRecord">
          <header class="record-heading">
            <div class="record-heading-copy">
              <span>{{ selectedRecord.recordType }} #{{ selectedRecord.recordId }}</span>
              <h2 :title="selectedRecord.label">{{ selectedRecord.label }}</h2>
            </div>
            <Button
              v-if="!selectedSavedRecord"
              icon="pi pi-bookmark"
              label="Save record"
              size="small"
              outlined
              @click="saveCurrentRecord"
            />
            <Tag
              v-else
              icon="pi pi-bookmark-fill"
              value="Saved"
              severity="secondary"
            />
          </header>

          <p v-if="error" class="error-banner">
            <i class="pi pi-exclamation-triangle" />
            {{ error }}
          </p>

          <div v-if="notes.length" class="summary-strip">
            <div>
              <strong>{{ summary.notes.toLocaleString() }}</strong>
              <span>system notes</span>
            </div>
            <div>
              <strong>{{ summary.fields.toLocaleString() }}</strong>
              <span>fields touched</span>
            </div>
            <div>
              <strong>{{ summary.people.toLocaleString() }}</strong>
              <span>people / actors</span>
            </div>
            <div>
              <strong>{{ formatShortDate(summary.first) }}</strong>
              <span>first retained change</span>
            </div>
            <div>
              <strong>{{ formatShortDate(summary.latest) }}</strong>
              <span>latest change</span>
            </div>
          </div>

          <div v-if="notes.length" class="history-filters">
            <label v-if="streams.length > 1" class="stream-filter">
              <span>Record stream</span>
              <MSelect
                v-model="selectedStreamKey"
                :options="streamOptions"
                option-label="label"
                option-value="value"
                size="small"
              />
            </label>
            <label class="text-filter">
              <span>Find changes</span>
              <span class="input-with-icon">
                <i class="pi pi-search" />
                <input
                  v-model="textFilter"
                  placeholder="Field, value, person…"
                />
              </span>
            </label>
            <label>
              <span>Person</span>
              <MSelect
                v-model="actorFilter"
                :options="actorOptions"
                option-label="label"
                option-value="value"
                size="small"
              />
            </label>
            <label>
              <span>Context</span>
              <MSelect
                v-model="contextFilter"
                :options="contextOptions"
                option-label="label"
                option-value="value"
                size="small"
              />
            </label>
            <label>
              <span>Period</span>
              <MSelect
                v-model="periodFilter"
                :options="periodOptions"
                option-label="label"
                option-value="value"
                size="small"
              />
            </label>
          </div>

          <p v-if="streams.length > 1" class="stream-notice">
            <i class="pi pi-info-circle" />
            Internal ID #{{ selectedRecord.recordId }} exists in {{ streams.length }}
            NetSuite record streams. Only the selected stream is shown.
          </p>

          <div v-if="streamLoading" class="detail-empty compact">
            <span class="empty-icon"><i class="pi pi-spin pi-spinner" /></span>
            <strong>Loading selected record stream</strong>
          </div>

          <div v-else-if="!notes.length && !error" class="detail-empty compact">
            <span class="empty-icon"><i class="pi pi-inbox" /></span>
            <strong>No system notes found</strong>
            <span>
              NetSuite returned no retained changes for this internal ID, or your role cannot access them.
            </span>
          </div>

          <div v-else-if="!events.length" class="detail-empty compact">
            <span class="empty-icon"><i class="pi pi-filter-slash" /></span>
            <strong>No changes match these filters</strong>
            <span>Clear or broaden the filters to restore the timeline.</span>
          </div>

          <section v-else class="timeline" aria-label="Record change timeline">
            <article v-for="event in events" :key="event.key" class="history-event">
              <span class="timeline-marker">
                <i class="pi pi-pencil" />
              </span>
              <div class="event-content">
                <header class="event-heading">
                  <div>
                    <strong>{{ event.changedBy }}</strong>
                    <span>{{ formatDate(event.timestamp, event.date) }}</span>
                  </div>
                  <div class="event-meta">
                    <Tag
                      v-if="event.role"
                      :value="event.role"
                      severity="secondary"
                    />
                    <Tag :value="event.context" severity="info" />
                    <span>
                      {{ event.changes.length }}
                      field{{ event.changes.length === 1 ? "" : "s" }}
                    </span>
                  </div>
                </header>

                <div class="change-table">
                  <div
                    v-for="change in event.changes"
                    :key="change.id"
                    class="change-row"
                  >
                    <div class="field-cell">
                      <span class="change-kind" :class="changeKind(change)">
                        {{ changeKind(change) }}
                      </span>
                      <strong :title="change.field">
                        {{ formatSystemNoteField(change.field) }}
                      </strong>
                      <small v-if="change.lineId || change.lineTransactionId">
                        Line {{ change.lineId || change.lineTransactionId }}
                      </small>
                    </div>
                    <div class="value-cell old-value">
                      <span>Before</span>
                      <p :title="change.oldValue">{{ formatValue(change.oldValue) }}</p>
                    </div>
                    <i class="pi pi-arrow-right change-arrow" />
                    <div class="value-cell new-value">
                      <span>After</span>
                      <p :title="change.newValue">{{ formatValue(change.newValue) }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </article>
          </section>
        </template>
      </main>
    </div>
  </section>
</template>

<style scoped>
.record-history {
  --history-border: var(--p-slate-200);
  --history-muted: var(--p-slate-500);
  --history-surface: #fff;
  --history-subtle: var(--p-slate-50);
  --history-accent: #2563a8;
  --history-accent-soft: #eaf3fb;
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 0.625rem;
  overflow: hidden;
  color: var(--p-slate-900);
}

.history-header,
.record-lookup,
.history-workspace {
  border: 1px solid var(--history-border);
  border-radius: 0.375rem;
  background: var(--history-surface);
}

.history-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 0.8rem;
}

.heading-copy {
  min-width: 0;
}

.eyebrow {
  color: var(--history-accent);
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.09em;
}

.eyebrow i {
  margin-right: 0.25rem;
}

.history-header h1 {
  margin: 0.08rem 0;
  font-size: 1.25rem;
  line-height: 1.3;
}

.history-header p {
  margin: 0;
  color: var(--history-muted);
  font-size: 0.72rem;
}

.header-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.4rem;
}

.header-actions :deep(.m-select) {
  width: 10.75rem;
}

.record-lookup {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: minmax(14rem, 0.8fr) minmax(18rem, 1.2fr) auto;
  align-items: end;
  gap: 0.5rem;
  padding: 0.5rem;
}

.record-lookup label,
.history-filters label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.22rem;
  color: var(--p-slate-600);
  font-size: 0.65rem;
  font-weight: 650;
}

.record-lookup :deep(input),
.record-lookup :deep(button) {
  height: 2rem;
}

.lookup-error {
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  gap: 0.35rem;
  margin: 0;
  color: var(--p-red-700);
  font-size: 0.65rem;
}

.history-workspace {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(14rem, 22%) minmax(0, 1fr);
  overflow: hidden;
}

.saved-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid var(--history-border);
  background: var(--history-subtle);
}

.pane-heading {
  display: flex;
  min-height: 2.75rem;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.65rem;
  border-bottom: 1px solid var(--history-border);
}

.pane-heading div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.pane-heading strong {
  font-size: 0.76rem;
}

.pane-heading small {
  color: var(--history-muted);
  font-size: 0.64rem;
}

.saved-search {
  position: relative;
  display: block;
  margin: 0.5rem;
}

.saved-search i,
.input-with-icon i {
  position: absolute;
  top: 50%;
  left: 0.62rem;
  transform: translateY(-50%);
  color: var(--p-slate-400);
  font-size: 0.72rem;
}

.saved-search input,
.input-with-icon input {
  width: 100%;
  height: 1.95rem;
  padding: 0 0.55rem 0 1.75rem;
  border: 1px solid var(--history-border);
  border-radius: 0.25rem;
  outline: none;
  background: var(--history-surface);
  color: inherit;
  font-size: 0.72rem;
}

.saved-search input:focus,
.input-with-icon input:focus {
  border-color: var(--history-accent);
  box-shadow: 0 0 0 1px rgb(37 99 168 / 16%);
}

.saved-list {
  min-height: 0;
  overflow-y: auto;
}

.saved-record {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 1.8rem;
  border: 1px solid transparent;
  border-bottom-color: var(--history-border);
}

.saved-record:hover {
  background: var(--p-slate-100);
}

.saved-record.active {
  border-color: #8bb6dc;
  background: var(--history-accent-soft);
  color: #164f80;
}

.saved-record-main,
.remove-record {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.saved-record-main {
  display: grid;
  min-width: 0;
  grid-template-columns: 1.75rem minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.25rem 0.5rem 0.55rem;
  text-align: left;
}

.record-icon {
  display: grid;
  width: 1.65rem;
  height: 1.65rem;
  place-items: center;
  border: 1px solid #c8dff1;
  border-radius: 0.25rem;
  background: var(--history-accent-soft);
  color: var(--history-accent);
  font-size: 0.72rem;
}

.record-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.08rem;
}

.record-copy strong,
.record-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-copy strong {
  font-size: 0.72rem;
}

.record-copy small {
  color: var(--history-muted);
  font-size: 0.62rem;
}

.remove-record {
  opacity: 0;
  font-size: 0.68rem;
}

.saved-record:hover .remove-record,
.remove-record:focus-visible {
  opacity: 1;
}

.remove-record:hover {
  color: var(--p-red-600);
}

.history-detail {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.record-heading {
  display: flex;
  min-height: 3.4rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--history-border);
}

.record-heading-copy {
  min-width: 0;
}

.record-heading-copy > span {
  color: var(--history-muted);
  font-size: 0.65rem;
  text-transform: uppercase;
}

.record-heading h2 {
  overflow: hidden;
  margin: 0.08rem 0 0;
  font-size: 1rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-strip {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border-bottom: 1px solid var(--history-border);
  background: var(--history-subtle);
}

.summary-strip > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.08rem;
  padding: 0.45rem 0.65rem;
  border-right: 1px solid var(--history-border);
}

.summary-strip > div:last-child {
  border-right: 0;
}

.summary-strip strong {
  overflow: hidden;
  color: var(--p-slate-800);
  font-size: 0.8rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-strip span {
  overflow: hidden;
  color: var(--history-muted);
  font-size: 0.59rem;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.history-filters {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: minmax(11rem, 1.2fr) repeat(3, minmax(8rem, 0.7fr));
  align-items: end;
  gap: 0.4rem;
  padding: 0.45rem 0.65rem;
  border-bottom: 1px solid var(--history-border);
}

.history-filters:has(.stream-filter) {
  grid-template-columns: minmax(12rem, 1fr) minmax(11rem, 1fr) repeat(3, minmax(8rem, 0.65fr));
}

.history-filters :deep(.m-select),
.history-filters :deep(.m-select-trigger) {
  width: 100%;
}

.input-with-icon {
  position: relative;
  display: block;
}

.stream-notice,
.error-banner {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  padding: 0.4rem 0.7rem;
  border-bottom: 1px solid;
  font-size: 0.68rem;
}

.stream-notice {
  border-color: #bed7ed;
  background: #f0f7fd;
  color: #245c87;
}

.error-banner {
  border-color: var(--p-red-200);
  background: var(--p-red-50);
  color: var(--p-red-700);
}

.timeline {
  min-height: 0;
  padding: 0.65rem 0.75rem 1rem;
  overflow-y: auto;
  background: #fbfcfe;
}

.history-event {
  position: relative;
  display: grid;
  grid-template-columns: 1.75rem minmax(0, 1fr);
}

.history-event:not(:last-child)::before {
  position: absolute;
  top: 1.55rem;
  bottom: -0.1rem;
  left: 0.78rem;
  width: 1px;
  background: #cdd8e4;
  content: "";
}

.timeline-marker {
  z-index: 1;
  display: grid;
  width: 1.55rem;
  height: 1.55rem;
  place-items: center;
  border: 1px solid #aac7df;
  border-radius: 50%;
  background: #eef6fc;
  color: var(--history-accent);
  font-size: 0.62rem;
}

.event-content {
  min-width: 0;
  margin: 0 0 0.65rem 0.35rem;
  border: 1px solid var(--history-border);
  border-radius: 0.3rem;
  background: var(--history-surface);
}

.event-heading {
  display: flex;
  min-height: 2.4rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  padding: 0.38rem 0.55rem;
  border-bottom: 1px solid var(--history-border);
  background: var(--history-subtle);
}

.event-heading > div:first-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.event-heading strong {
  overflow: hidden;
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-heading span {
  color: var(--history-muted);
  font-size: 0.62rem;
}

.event-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 0.3rem;
}

.event-meta :deep(.p-tag) {
  max-width: 11rem;
  overflow: hidden;
  font-size: 0.58rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-row {
  display: grid;
  grid-template-columns: minmax(9rem, 0.8fr) minmax(8rem, 1fr) 1.4rem minmax(8rem, 1fr);
  align-items: stretch;
  border-bottom: 1px solid var(--history-border);
}

.change-row:last-child {
  border-bottom: 0;
}

.field-cell,
.value-cell {
  display: flex;
  min-width: 0;
  justify-content: center;
  flex-direction: column;
  padding: 0.42rem 0.55rem;
}

.field-cell {
  gap: 0.14rem;
  border-right: 1px solid var(--history-border);
}

.field-cell strong,
.field-cell small,
.value-cell p {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-cell strong {
  font-size: 0.69rem;
}

.field-cell small {
  color: var(--history-muted);
  font-size: 0.59rem;
}

.change-kind {
  align-self: flex-start;
  color: var(--p-slate-500);
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.change-kind.added {
  color: var(--p-green-700);
}

.change-kind.cleared {
  color: var(--p-red-700);
}

.value-cell > span {
  color: var(--history-muted);
  font-size: 0.56rem;
  font-weight: 650;
  text-transform: uppercase;
}

.value-cell p {
  margin: 0.12rem 0 0;
  color: var(--p-slate-700);
  font-family: var(--font-family);
  font-size: 0.68rem;
}

.old-value p {
  color: #8a3d3d;
}

.new-value p {
  color: #25603b;
}

.change-arrow {
  align-self: center;
  color: var(--p-slate-400);
  font-size: 0.65rem;
  text-align: center;
}

.detail-empty,
.pane-empty {
  display: flex;
  min-height: 0;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  color: var(--history-muted);
  text-align: center;
}

.detail-empty {
  flex: 1;
  gap: 0.35rem;
  padding: 2rem;
}

.detail-empty.compact {
  min-height: 12rem;
}

.empty-icon {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  margin-bottom: 0.25rem;
  border: 1px solid #c9dceb;
  border-radius: 50%;
  background: var(--history-accent-soft);
  color: var(--history-accent);
  font-size: 1rem;
}

.detail-empty strong {
  color: var(--p-slate-700);
  font-size: 0.82rem;
}

.detail-empty > span:last-child {
  max-width: 29rem;
  font-size: 0.7rem;
  line-height: 1.45;
}

.pane-empty {
  flex: 1;
  gap: 0.3rem;
  padding: 1rem;
  font-size: 0.68rem;
}

.pane-empty strong {
  color: var(--p-slate-700);
}

@media (max-width: 1050px) {
  .history-workspace {
    grid-template-columns: 13rem minmax(0, 1fr);
  }

  .summary-strip {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .summary-strip > div:nth-child(3) {
    border-right: 0;
  }

  .summary-strip > div:nth-child(n + 4) {
    display: none;
  }

  .history-filters,
  .history-filters:has(.stream-filter) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .change-row {
    grid-template-columns: minmax(8rem, 0.75fr) minmax(7rem, 1fr) 1.2rem minmax(7rem, 1fr);
  }
}
</style>
