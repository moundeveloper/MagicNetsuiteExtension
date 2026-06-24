<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import VueSplitter from "@rmp135/vue-splitter";
import { callApi, closePanel, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { useMContextMenu } from "../composables/useMContextMenu";
import MContextMenu from "../components/universal/contextMenu/MContextMenu.vue";

type FieldValue = {
  value: unknown;
  text: unknown;
};

type RecordPayload = {
  id: string;
  type: string;
  body: Record<string, FieldValue>;
  sublists?: Record<string, Array<Record<string, FieldValue>>>;
};

const props = defineProps<{ vhOffset: number }>();
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const error = ref("");
const bodyRecord = ref<RecordPayload | null>(null);
const sublists = ref<Record<string, Array<Record<string, FieldValue>>>>({});
const bodyFilter = ref("");
const activeSublist = ref("");
const expandedValues = ref(new Set<string>());
const bodyPanePercent = ref(38);
const sublistNavPercent = ref(20);
const resolvedFieldCache = new Map<string, FieldValue>();
const { showContextMenu } = useMContextMenu();

const recordType = computed(() => String(route.params.recordType ?? ""));
const recordId = computed(() => String(route.params.recordId ?? ""));

const bodyFields = computed(() => {
  const needle = bodyFilter.value.trim().toLowerCase();
  return Object.entries(bodyRecord.value?.body ?? {})
    .map(([fieldId, data]) => ({ fieldId, ...data }))
    .filter((field) => {
      if (!needle) return true;
      return `${field.fieldId} ${formatValue(field.text)} ${formatValue(field.value)}`
        .toLowerCase()
        .includes(needle);
    })
    .sort((a, b) => a.fieldId.localeCompare(b.fieldId));
});

const sublistEntries = computed(() =>
  Object.entries(sublists.value)
    .map(([id, rows]) => ({ id, rows }))
    .sort((a, b) => a.id.localeCompare(b.id))
);

const activeRows = computed(() => sublists.value[activeSublist.value] ?? []);

const activeColumns = computed(() => {
  const ids = new Set<string>();
  for (const row of activeRows.value) {
    Object.keys(row).forEach((id) => ids.add(id));
  }
  return Array.from(ids);
});

const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const displayValue = (field?: FieldValue) => {
  if (!field) return "—";
  const text = formatValue(field.text);
  return text !== "—" ? text : formatValue(field.value);
};

const loadRecord = async () => {
  loading.value = true;
  error.value = "";
  bodyRecord.value = null;
  sublists.value = {};
  try {
    const response = await callApi(RequestRoutes.LOAD_RECORD_JSON, {
      type: recordType.value,
      id: recordId.value,
      includeSublists: true
    });
    if (response?.status === "error") {
      throw new Error(String(response.message));
    }
    bodyRecord.value = response.message as RecordPayload;
    sublists.value = bodyRecord.value?.sublists ?? {};
    activeSublist.value = sublistEntries.value[0]?.id ?? "";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
};

const openInNetSuite = async () => {
  try {
    const response = (await callApi(RequestRoutes.GET_RECORD_URL, {
      type: recordType.value,
      id: recordId.value,
      isEditMode: false
    })) as ApiResponse;
    if (response?.status === "error") throw new Error(String(response.message));
    window.open(String(response.message), "_blank");
    closePanel();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
};

const toggleExpanded = (key: string) => {
  const next = new Set(expandedValues.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedValues.value = next;
};

type FieldContext = {
  fieldId: string;
  snapshot?: FieldValue;
  sublistId?: string;
  line?: number;
};

const fieldCacheKey = (field: FieldContext) =>
  [
    recordType.value,
    recordId.value,
    field.sublistId ?? "body",
    field.line ?? "",
    field.fieldId
  ].join(":");

const resolveFieldData = async (field: FieldContext): Promise<FieldValue> => {
  const key = fieldCacheKey(field);
  const cached = resolvedFieldCache.get(key);
  if (cached) return cached;

  const response = await callApi(RequestRoutes.GET_RECORD_FIELD_DATA, {
    type: recordType.value,
    id: recordId.value,
    fieldId: field.fieldId,
    sublistId: field.sublistId,
    line: field.line
  });
  if (response?.status === "error") {
    throw new Error(String(response.message));
  }
  const resolved = response.message as FieldValue;
  resolvedFieldCache.set(key, resolved);
  return resolved;
};

const copyFieldPart = async (field: FieldContext, part: "value" | "text") => {
  try {
    const resolved = await resolveFieldData(field);
    await navigator.clipboard.writeText(formatValue(resolved?.[part]));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
};

const openFieldContextMenu = (event: MouseEvent, field: FieldContext) => {
  showContextMenu(event, field, [
    {
      label: "Copy field text",
      icon: "pi pi-copy",
      action: (target) => void copyFieldPart(target, "text")
    },
    {
      label: "Copy field value",
      icon: "pi pi-clone",
      action: (target) => void copyFieldPart(target, "value")
    },
    {
      label: "Copy field ID",
      icon: "pi pi-tag",
      action: (target) => void navigator.clipboard.writeText(target.fieldId)
    }
  ]);
};

onMounted(loadRecord);
</script>

<template>
  <section class="detail-view" :style="{ height: `${props.vhOffset}vh` }">
    <header class="detail-header">
      <button class="icon-button" title="Back to records" @click="router.push('/records')">
        <i class="pi pi-arrow-left" />
      </button>
      <div class="record-title">
        <i class="pi pi-database" />
        <div class="record-title-details">
          <strong>{{ recordType }} #{{ recordId }}</strong>
          <small>Body fields and sublists</small>
        </div>
      </div>
      <div class="header-actions">
        <button @click="loadRecord">
          <i :class="loading ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" />
          Refresh
        </button>
        <button class="primary-action" @click="openInNetSuite">
          <i class="pi pi-external-link" />
          Open in NetSuite
        </button>
      </div>
    </header>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <div v-if="loading && !bodyRecord" class="loading-state">
      <i class="pi pi-spin pi-spinner" />
      Loading every field and sublist…
    </div>

    <div v-else class="detail-content">
      <VueSplitter
        v-model:percent="bodyPanePercent"
        is-horizontal
        :initial-percent="38"
        data-ignore
        class="record-detail-splitter"
      >
        <template #top-pane>
          <section class="body-fields">
            <div class="section-heading">
              <span>
                <strong>Body fields</strong>
                <small>{{ bodyFields.length }} fields</small>
              </span>
              <label>
                <i class="pi pi-search" />
                <input v-model="bodyFilter" placeholder="Filter fields or values" />
              </label>
            </div>
            <div class="field-grid">
              <article
                v-for="field in bodyFields"
                :key="field.fieldId"
                @contextmenu.prevent="openFieldContextMenu($event, {
                  fieldId: field.fieldId,
                  snapshot: field
                })"
              >
                <div class="field-label">
                  <code>{{ field.fieldId }}</code>
                  <button
                    v-if="formatValue(field.value).length > 180 || formatValue(field.text).length > 180"
                    title="Expand value"
                    @click="toggleExpanded(`body:${field.fieldId}`)"
                  >
                    <i :class="expandedValues.has(`body:${field.fieldId}`) ? 'pi pi-minus' : 'pi pi-plus'" />
                  </button>
                </div>
                <strong :class="{ expanded: expandedValues.has(`body:${field.fieldId}`) }">
                  {{ displayValue(field) }}
                </strong>
                <small
                  v-if="formatValue(field.text) !== formatValue(field.value) && formatValue(field.value) !== '—'"
                  :class="{ expanded: expandedValues.has(`body:${field.fieldId}`) }"
                >
                  Raw: {{ formatValue(field.value) }}
                </small>
              </article>
            </div>
          </section>
        </template>

        <template #bottom-pane>
          <section class="sublists-section">
            <div class="section-heading">
              <span>
                <strong>Sublists</strong>
                <small>{{ sublistEntries.length }} sublists</small>
              </span>
            </div>
            <div class="sublist-layout">
              <VueSplitter
                v-model:percent="sublistNavPercent"
                :initial-percent="20"
                data-ignore
                class="sublist-splitter"
              >
                <template #left-pane>
                  <nav class="sublist-nav">
                    <button
                      v-for="sublist in sublistEntries"
                      :key="sublist.id"
                      :class="{ active: activeSublist === sublist.id }"
                      @click="activeSublist = sublist.id"
                    >
                      <span>{{ sublist.id }}</span>
                      <small>{{ sublist.rows.length }} rows</small>
                    </button>
                    <p v-if="sublistEntries.length === 0">This record has no sublists.</p>
                  </nav>
                </template>
                <template #right-pane>
                  <div class="sublist-table">
                    <table v-if="activeSublist">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th v-for="column in activeColumns" :key="column">{{ column }}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="(row, rowIndex) in activeRows" :key="rowIndex">
                          <td>{{ rowIndex + 1 }}</td>
                          <td
                            v-for="column in activeColumns"
                            :key="column"
                            :title="formatValue(row[column]?.value)"
                            @contextmenu.prevent="openFieldContextMenu($event, {
                              fieldId: column,
                              snapshot: row[column],
                              sublistId: activeSublist,
                              line: rowIndex
                            })"
                          >
                            <span>{{ displayValue(row[column]) }}</span>
                            <small
                              v-if="row[column] && formatValue(row[column].text) !== formatValue(row[column].value) && formatValue(row[column].value) !== '—'"
                            >
                              {{ formatValue(row[column].value) }}
                            </small>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <div v-else class="empty-state">
                      <i class="pi pi-list" />
                      Select a sublist to inspect its rows and values.
                    </div>
                  </div>
                </template>
              </VueSplitter>
            </div>
          </section>
        </template>
      </VueSplitter>
    </div>

    <MContextMenu />
  </section>
</template>

<style scoped>
.detail-view {
  display: flex;
  min-height: 430px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 10px;
  background: white;
}

.detail-header,
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.detail-header {
  min-height: 58px;
  padding: 0.65rem 0.8rem;
  border-bottom: 1px solid var(--p-slate-200);
}

.record-title,
.header-actions,
.section-heading > span {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.record-title {
  flex: 1;
}

.record-title > i {
  color: var(--p-purple-600);
  font-size: 1.15rem;
}

.record-title-details,
.section-heading > span {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.28rem;
}

.record-title small,
.section-heading small {
  color: var(--p-slate-500);
  font-size: 0.7rem;
}

button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 34px;
  padding: 0 0.7rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  background: white;
  color: var(--p-slate-600);
  cursor: pointer;
}

button:hover {
  border-color: var(--p-purple-300);
  color: var(--p-purple-700);
}

.icon-button {
  width: 34px;
  padding: 0;
}

.primary-action {
  background: var(--p-slate-800);
  color: white;
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

.loading-state,
.empty-state {
  display: flex;
  min-height: 240px;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  color: var(--p-slate-500);
}

.detail-content {
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.record-detail-splitter,
.sublist-splitter {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.body-fields,
.sublists-section {
  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  height: 100%;
}

.section-heading {
  min-height: 48px;
  padding: 0.55rem 0.75rem;
  border-bottom: 1px solid var(--p-slate-100);
  background: #f8fafc;
}

.section-heading label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: min(340px, 50%);
  padding: 0.38rem 0.55rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  background: white;
  color: var(--p-slate-400);
}

.section-heading input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.55rem;
  min-height: 0;
  overflow: auto;
  padding: 0.7rem;
}

.field-grid article {
  min-width: 0;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: white;
}

.field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.field-label code {
  color: var(--p-purple-700);
  font-size: 0.7rem;
}

.field-label button {
  width: 22px;
  min-height: 22px;
  padding: 0;
}

.field-grid article > strong,
.field-grid article > small {
  display: block;
  overflow: hidden;
  color: var(--p-slate-700);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-grid article > small {
  margin-top: 0.18rem;
  color: var(--p-slate-400);
  font-size: 0.68rem;
}

.field-grid .expanded {
  overflow-wrap: anywhere;
  white-space: normal;
}

.sublist-layout {
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.sublist-nav {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 0.3rem;
  overflow: auto;
  padding: 0.55rem;
  background: #f8fafc;
  height: 100%;
}

.sublist-nav button {
  align-items: flex-start;
  flex-direction: column;
  padding: 0.45rem 0.55rem;
}

.sublist-nav button.active {
  border-color: var(--p-purple-300);
  background: var(--p-purple-50);
  color: var(--p-purple-800);
}

.sublist-nav small {
  color: var(--p-slate-400);
}

.sublist-nav p {
  color: var(--p-slate-500);
  font-size: 0.75rem;
}

.sublist-table {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  height: 100%;
}

table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
}

thead {
  position: sticky;
  top: 0;
  z-index: 1;
}

th,
td {
  max-width: 320px;
  padding: 0.5rem 0.6rem;
  border-right: 1px solid var(--p-slate-100);
  border-bottom: 1px solid var(--p-slate-100);
  color: var(--p-slate-600);
  text-align: left;
  vertical-align: top;
}

th {
  background: #f8fafc;
  color: var(--p-slate-500);
  font-size: 0.68rem;
  text-transform: uppercase;
}

td span,
td small {
  display: block;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

td small {
  color: var(--p-slate-400);
  font-size: 0.66rem;
}

@media (max-width: 760px) {
  .detail-header {
    flex-wrap: wrap;
  }

  .header-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .sublist-layout {
    min-height: 0;
  }
}
</style>
