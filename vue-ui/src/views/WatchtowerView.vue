<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Button, InputText, Tag, useToast } from "primevue";
import { useRoute } from "vue-router";
import VueSplitter from "@rmp135/vue-splitter";
import { callApi, getNetsuiteEnvironment } from "../utils/api";
import { RequestRoutes } from "../types/request";
import {
  addWatchedRecord,
  captureRecordSnapshot,
  diffRecordSnapshots,
  listRecordSnapshots,
  listWatchedRecords,
  removeWatchedRecord,
  setWatchError,
  type RecordChange,
  type RecordSnapshot,
  type WatchedRecord
} from "../utils/recordWatchDb";
import {
  getWorkspaceState,
  saveWorkspaceState
} from "../utils/workspaceState";

const props = defineProps<{ vhOffset: number }>();
const toast = useToast();
const route = useRoute();
const environment = ref("unknown");
const watches = ref<WatchedRecord[]>([]);
const selected = ref<WatchedRecord | null>(null);
const snapshots = ref<RecordSnapshot[]>([]);
const selectedSnapshotId = ref<number | null>(null);
const search = ref("");
const recordType = ref("");
const recordId = ref("");
const label = ref("");
const loading = ref(true);
const adding = ref(false);
const scanning = ref(new Set<string>());
const scanningAll = ref(false);
const listPanePercent = ref(32);
let splitStateLoaded = false;
let splitSaveTimer = 0;

const filteredWatches = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return watches.value;
  return watches.value.filter((watch) =>
    `${watch.label} ${watch.recordType} ${watch.recordId}`
      .toLowerCase()
      .includes(needle)
  );
});

const selectedSnapshot = computed(
  () =>
    snapshots.value.find((snapshot) => snapshot.id === selectedSnapshotId.value) ??
    snapshots.value[0] ??
    null
);

const previousSnapshot = computed(() => {
  const current = selectedSnapshot.value;
  if (!current) return null;
  const index = snapshots.value.findIndex((snapshot) => snapshot.id === current.id);
  return index >= 0 ? snapshots.value[index + 1] ?? null : null;
});

const selectedChanges = computed<RecordChange[]>(() => {
  if (!selectedSnapshot.value || !previousSnapshot.value) return [];
  return diffRecordSnapshots(
    previousSnapshot.value.data,
    selectedSnapshot.value.data
  );
});

const changeSummary = computed(() => ({
  added: selectedChanges.value.filter((change) => change.kind === "added").length,
  removed: selectedChanges.value.filter((change) => change.kind === "removed").length,
  changed: selectedChanges.value.filter((change) => change.kind === "changed").length
}));

const loadWatches = async () => {
  loading.value = true;
  try {
    environment.value = await getNetsuiteEnvironment().catch(() => "unknown");
    watches.value = await listWatchedRecords(environment.value);
    if (selected.value) {
      selected.value =
        watches.value.find((watch) => watch.key === selected.value?.key) ?? null;
    }
  } finally {
    loading.value = false;
  }
};

const loadSplitState = async () => {
  const state = await getWorkspaceState<{ listPanePercent?: number }>(
    "watchtower-layout",
    environment.value
  );
  const saved = Number(state?.listPanePercent);
  if (Number.isFinite(saved)) {
    listPanePercent.value = Math.min(55, Math.max(20, saved));
  }
  splitStateLoaded = true;
};

const selectWatch = async (watch: WatchedRecord) => {
  selected.value = watch;
  snapshots.value = await listRecordSnapshots(watch.key);
  selectedSnapshotId.value = snapshots.value[0]?.id ?? null;
};

const fetchRecord = async (watch: Pick<WatchedRecord, "recordType" | "recordId">) => {
  const response = await callApi(RequestRoutes.LOAD_RECORD_JSON, {
    type: watch.recordType,
    id: watch.recordId,
    includeSublists: true
  });
  if (response?.status === "error") throw new Error(String(response.message));
  return response.message;
};

const addWatch = async () => {
  const type = recordType.value.trim();
  const id = recordId.value.trim();
  if (!type || !id) return;
  adding.value = true;
  try {
    const data = await fetchRecord({ recordType: type, recordId: id });
    const key = await addWatchedRecord({
      environment: environment.value,
      recordType: type,
      recordId: id,
      label: label.value,
      data
    });
    recordType.value = "";
    recordId.value = "";
    label.value = "";
    await loadWatches();
    const watch = watches.value.find((item) => item.key === key);
    if (watch) await selectWatch(watch);
    toast.add({
      severity: "success",
      summary: "Record added to Watchtower",
      detail: `${type} #${id}`,
      life: 2500
    });
  } catch (error) {
    toast.add({
      severity: "error",
      summary: "Could not watch record",
      detail: error instanceof Error ? error.message : String(error),
      life: 4000
    });
  } finally {
    adding.value = false;
  }
};

const scanWatch = async (watch: WatchedRecord, quiet = false) => {
  if (scanning.value.has(watch.key)) return;
  scanning.value = new Set(scanning.value).add(watch.key);
  try {
    const data = await fetchRecord(watch);
    const result = await captureRecordSnapshot(watch.key, data);
    if (!quiet) {
      toast.add({
        severity: result.changed ? "warn" : "success",
        summary: result.changed
          ? `${result.changes.length} changes detected`
          : "No changes detected",
        detail: watch.label,
        life: 2600
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setWatchError(watch.key, message);
    if (!quiet) {
      toast.add({
        severity: "error",
        summary: "Scan failed",
        detail: message,
        life: 4000
      });
    }
  } finally {
    const next = new Set(scanning.value);
    next.delete(watch.key);
    scanning.value = next;
    await loadWatches();
    if (selected.value?.key === watch.key) {
      const refreshed = watches.value.find((item) => item.key === watch.key);
      if (refreshed) await selectWatch(refreshed);
    }
  }
};

const openRecordFromRoute = async () => {
  const type = String(route.query.type || "").trim();
  const id = String(route.query.id || "").trim();
  if (!type || !id) return;

  let watch = watches.value.find(
    (item) =>
      item.recordType.toLowerCase() === type.toLowerCase() &&
      item.recordId === id
  );

  if (!watch) {
    try {
      const data = await fetchRecord({ recordType: type, recordId: id });
      const key = await addWatchedRecord({
        environment: environment.value,
        recordType: type,
        recordId: id,
        data
      });
      await loadWatches();
      watch = watches.value.find((item) => item.key === key);
    } catch (error) {
      toast.add({
        severity: "error",
        summary: "Could not open record in Watchtower",
        detail: error instanceof Error ? error.message : String(error),
        life: 4000
      });
      return;
    }
  }

  if (!watch) return;
  await selectWatch(watch);
  if (route.query.scan === "1") {
    await scanWatch(watch);
  }
};

const scanAll = async () => {
  if (scanningAll.value || !watches.value.length) return;
  scanningAll.value = true;
  let changed = 0;
  let failed = 0;
  for (const watch of watches.value) {
    try {
      const data = await fetchRecord(watch);
      const result = await captureRecordSnapshot(watch.key, data);
      if (result.changed) changed += 1;
    } catch (error) {
      failed += 1;
      await setWatchError(
        watch.key,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  scanningAll.value = false;
  await loadWatches();
  if (selected.value) {
    const refreshed = watches.value.find((item) => item.key === selected.value?.key);
    if (refreshed) await selectWatch(refreshed);
  }
  toast.add({
    severity: failed ? "warn" : changed ? "info" : "success",
    summary: changed ? `${changed} watched records changed` : "Watchtower scan complete",
    detail: failed ? `${failed} records could not be checked.` : "All records checked.",
    life: 3500
  });
};

const removeWatch = async (watch: WatchedRecord) => {
  await removeWatchedRecord(watch.key);
  if (selected.value?.key === watch.key) {
    selected.value = null;
    snapshots.value = [];
    selectedSnapshotId.value = null;
  }
  await loadWatches();
};

const formatTime = (timestamp?: number | null) => {
  if (!timestamp) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
};

const formatValue = (value: unknown) => {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value || '""';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const cleanPath = (path: string) =>
  path
    .replace(/^body\./, "")
    .replace(/\.value$/, " · value")
    .replace(/\.text$/, " · text")
    .replace(/^sublists\./, "Sublist · ");

const handleChanged = () => void loadWatches();
const handleEnvironmentChanged = async () => {
  selected.value = null;
  snapshots.value = [];
  selectedSnapshotId.value = null;
  await loadWatches();
};

watch(selectedSnapshotId, () => {
  // Computed diff follows the selected historical snapshot.
});

watch(listPanePercent, (value) => {
  if (!splitStateLoaded) return;
  window.clearTimeout(splitSaveTimer);
  splitSaveTimer = window.setTimeout(() => {
    void saveWorkspaceState("watchtower-layout", environment.value, {
      listPanePercent: value
    });
  }, 200);
});

watch(
  () => [route.query.type, route.query.id, route.query.scan],
  () => void openRecordFromRoute()
);

onMounted(async () => {
  await loadWatches();
  await loadSplitState();
  await openRecordFromRoute();
  window.addEventListener("magic-netsuite-watchtower-changed", handleChanged);
  window.addEventListener(
    "magic-netsuite-environment-changed",
    handleEnvironmentChanged
  );
});

onBeforeUnmount(() => {
  window.clearTimeout(splitSaveTimer);
  window.removeEventListener("magic-netsuite-watchtower-changed", handleChanged);
  window.removeEventListener(
    "magic-netsuite-environment-changed",
    handleEnvironmentChanged
  );
});
</script>

<template>
  <section class="watchtower" :style="{ height: `${props.vhOffset}vh` }">
    <header class="watchtower-header">
      <div>
        <span class="eyebrow"><i class="pi pi-eye"></i> NETSUITE CHANGE MONITOR</span>
        <h1>Watchtower</h1>
        <p>Pin important records, rescan them, and inspect exactly what changed over time.</p>
      </div>
      <Button
        icon="pi pi-refresh"
        label="Scan all"
        :loading="scanningAll"
        :disabled="!watches.length"
        @click="scanAll"
      />
    </header>

    <form class="add-watch" @submit.prevent="addWatch">
      <InputText v-model="recordType" placeholder="Record type, e.g. customer" />
      <InputText v-model="recordId" placeholder="Internal ID" />
      <InputText v-model="label" placeholder="Optional label" />
      <Button
        type="submit"
        icon="pi pi-plus"
        label="Watch record"
        :loading="adding"
        :disabled="!recordType.trim() || !recordId.trim()"
      />
    </form>

    <VueSplitter
      v-model:percent="listPanePercent"
      :initial-percent="32"
      data-ignore
      class="watchtower-layout"
    >
      <template #left-pane>
      <aside class="watch-list">
        <label class="watch-search">
          <i class="pi pi-search"></i>
          <input v-model="search" placeholder="Filter watched records…" />
        </label>

        <div v-if="loading" class="watch-empty">
          <i class="pi pi-spin pi-spinner"></i>
          Loading watches…
        </div>
        <div v-else-if="!filteredWatches.length" class="watch-empty">
          <i class="pi pi-eye-slash"></i>
          <strong>No watched records</strong>
          <span>Add one above or from Record Detail.</span>
        </div>
        <button
          v-for="watch in filteredWatches"
          v-else
          :key="watch.key"
          class="watch-card"
          :class="{
            active: selected?.key === watch.key,
            changed: watch.changeCount > 0,
            failed: Boolean(watch.error)
          }"
          @click="selectWatch(watch)"
        >
          <span class="watch-icon"><i class="pi pi-database"></i></span>
          <span class="watch-copy">
            <span class="watch-title">
              <strong>{{ watch.label }}</strong>
              <Tag
                v-if="watch.changeCount"
                :value="`${watch.changeCount} changes`"
                severity="warn"
                rounded
              />
              <Tag v-else-if="watch.error" value="Error" severity="danger" rounded />
            </span>
            <small>{{ watch.recordType }} #{{ watch.recordId }}</small>
            <small>Checked {{ formatTime(watch.lastCheckedAt) }}</small>
          </span>
          <i class="pi pi-chevron-right"></i>
        </button>
      </aside>
      </template>

      <template #right-pane>
      <main class="watch-detail">
        <div v-if="!selected" class="detail-empty">
          <i class="pi pi-binoculars"></i>
          <strong>Select a watched record</strong>
          <span>Snapshot history and field-level changes will appear here.</span>
        </div>

        <template v-else>
          <header class="detail-heading">
            <div>
              <span>{{ selected.recordType }} #{{ selected.recordId }}</span>
              <h2>{{ selected.label }}</h2>
            </div>
            <div class="detail-actions">
              <Button
                icon="pi pi-refresh"
                label="Scan now"
                size="small"
                :loading="scanning.has(selected.key)"
                @click="scanWatch(selected)"
              />
              <Button
                icon="pi pi-trash"
                severity="danger"
                outlined
                size="small"
                title="Stop watching"
                @click="removeWatch(selected)"
              />
            </div>
          </header>

          <p v-if="selected.error" class="watch-error">
            <i class="pi pi-exclamation-triangle"></i>
            {{ selected.error }}
          </p>

          <div class="snapshot-strip">
            <button
              v-for="(snapshot, index) in snapshots"
              :key="snapshot.id"
              :class="{ active: selectedSnapshot?.id === snapshot.id }"
              @click="selectedSnapshotId = snapshot.id ?? null"
            >
              <i :class="index === snapshots.length - 1 ? 'pi pi-flag' : 'pi pi-clock'"></i>
              <span>
                <strong>{{ index === snapshots.length - 1 ? "Baseline" : formatTime(snapshot.capturedAt) }}</strong>
                <small>
                  {{ snapshot.changeCount ? `${snapshot.changeCount} changes` : "Initial snapshot" }}
                </small>
              </span>
            </button>
          </div>

          <div v-if="selectedSnapshot && previousSnapshot" class="change-overview">
            <span><strong>{{ selectedChanges.length }}</strong> total</span>
            <span class="added"><strong>{{ changeSummary.added }}</strong> added</span>
            <span class="changed"><strong>{{ changeSummary.changed }}</strong> changed</span>
            <span class="removed"><strong>{{ changeSummary.removed }}</strong> removed</span>
            <small>
              Compared with {{ formatTime(previousSnapshot.capturedAt) }}
            </small>
          </div>

          <div v-if="!previousSnapshot" class="detail-empty compact">
            <i class="pi pi-flag"></i>
            <strong>Baseline captured</strong>
            <span>Run another scan later to reveal changes.</span>
          </div>
          <div v-else-if="!selectedChanges.length" class="detail-empty compact">
            <i class="pi pi-check-circle"></i>
            <strong>No differences in this snapshot</strong>
          </div>
          <div v-else class="change-list">
            <article
              v-for="change in selectedChanges"
              :key="change.path"
              :class="change.kind"
            >
              <header>
                <Tag :value="change.kind" :severity="change.kind === 'removed' ? 'danger' : change.kind === 'added' ? 'success' : 'warn'" />
                <code>{{ cleanPath(change.path) }}</code>
              </header>
              <div class="value-diff">
                <div>
                  <span>Before</span>
                  <pre>{{ formatValue(change.before) }}</pre>
                </div>
                <i class="pi pi-arrow-right"></i>
                <div>
                  <span>After</span>
                  <pre>{{ formatValue(change.after) }}</pre>
                </div>
              </div>
            </article>
          </div>
        </template>
      </main>
      </template>
    </VueSplitter>
  </section>
</template>

<style scoped>
.watchtower {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 0.7rem;
  overflow: hidden;
  color: #172033;
}

.watchtower-header,
.add-watch,
.watchtower-layout {
  border: 1px solid var(--p-slate-200);
  border-radius: 11px;
  background: rgb(255 255 255 / 92%);
}

.watchtower-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1rem;
  background: linear-gradient(120deg, #f8fafc, #eef8ff 55%, #f4f0ff);
}

.eyebrow {
  color: #596985;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.11em;
}

.watchtower-header h1 {
  margin: 0.15rem 0;
  font-size: 1.45rem;
}

.watchtower-header p {
  margin: 0;
  color: var(--p-slate-500);
  font-size: 0.73rem;
}

.add-watch {
  display: grid;
  grid-template-columns: 1fr 0.55fr 1fr auto;
  gap: 0.55rem;
  padding: 0.55rem;
}

.watchtower-layout {
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.watchtower :deep(.watchtower-layout > .splitter) {
  width: 6px !important;
  background: var(--p-slate-200);
  cursor: col-resize;
  transition: background-color 0.15s ease;
}

.watchtower :deep(.watchtower-layout > .splitter:hover),
.watchtower :deep(.watchtower-layout > .splitter.active) {
  background: var(--p-purple-400);
}

.watch-list {
  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow-y: auto;
  border-right: 1px solid var(--p-slate-200);
}

.watch-search {
  position: sticky;
  z-index: 1;
  top: 0;
  padding: 0.6rem;
  background: white;
}

.watch-search i {
  position: absolute;
  top: 50%;
  left: 1.25rem;
  transform: translateY(-50%);
  color: var(--p-slate-400);
}

.watch-search input {
  width: 100%;
  padding: 0.58rem 0.7rem 0.58rem 2rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  outline: none;
}

.watch-card {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.65rem;
  padding: 0.72rem;
  border: 0;
  border-top: 1px solid #edf1f5;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.watch-card:hover,
.watch-card.active {
  background: #f3f6fb;
}

.watch-card.active {
  box-shadow: inset 3px 0 #6558d5;
}

.watch-icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border-radius: 8px;
  background: #e8ecff;
  color: #5c50cf;
}

.watch-card.changed .watch-icon {
  background: #fff2cc;
  color: #a16207;
}

.watch-card.failed .watch-icon {
  background: #fee2e2;
  color: #b91c1c;
}

.watch-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.18rem;
}

.watch-title {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
}

.watch-title strong {
  overflow: hidden;
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.watch-copy small {
  color: var(--p-slate-500);
  font-size: 0.65rem;
}

.watch-empty,
.detail-empty {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 0.45rem;
  padding: 1rem;
  color: var(--p-slate-500);
  text-align: center;
}

.watch-empty > i,
.detail-empty > i {
  font-size: 1.7rem;
  color: var(--p-slate-400);
}

.watch-empty span,
.detail-empty span {
  font-size: 0.68rem;
}

.watch-detail {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.detail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8rem 0.9rem;
  border-bottom: 1px solid var(--p-slate-200);
}

.detail-heading span {
  color: #6d61d6;
  font-size: 0.63rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.detail-heading h2 {
  margin: 0.15rem 0 0;
  font-size: 1rem;
}

.detail-actions {
  display: flex;
  gap: 0.45rem;
}

.watch-error {
  margin: 0.55rem 0.8rem 0;
  padding: 0.55rem;
  border: 1px solid var(--p-red-200);
  border-radius: 7px;
  background: var(--p-red-50);
  color: var(--p-red-700);
  font-size: 0.7rem;
}

.snapshot-strip {
  display: flex;
  flex-shrink: 0;
  gap: 0.45rem;
  overflow-x: auto;
  padding: 0.65rem 0.8rem;
  border-bottom: 1px solid var(--p-slate-200);
}

.snapshot-strip button {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: max-content;
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: #fafbfd;
  color: inherit;
  cursor: pointer;
}

.snapshot-strip button.active {
  border-color: #8b7ee8;
  background: #f0edff;
}

.snapshot-strip span {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.snapshot-strip strong {
  font-size: 0.67rem;
}

.snapshot-strip small {
  color: var(--p-slate-500);
  font-size: 0.6rem;
}

.change-overview {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding: 0.55rem 0.8rem;
  border-bottom: 1px solid var(--p-slate-200);
  font-size: 0.68rem;
}

.change-overview .added { color: #15803d; }
.change-overview .changed { color: #a16207; }
.change-overview .removed { color: #b91c1c; }
.change-overview small {
  margin-left: auto;
  color: var(--p-slate-500);
}

.detail-empty.compact {
  min-height: 180px;
}

.change-list {
  min-height: 0;
  overflow-y: auto;
  padding: 0.75rem;
}

.change-list article {
  margin-bottom: 0.6rem;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
}

.change-list article > header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--p-slate-200);
  background: #f8fafc;
}

.change-list code {
  overflow: hidden;
  color: #344056;
  font-size: 0.67rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value-diff {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem;
}

.value-diff > div {
  min-width: 0;
}

.value-diff span {
  color: var(--p-slate-500);
  font-size: 0.6rem;
  text-transform: uppercase;
}

.value-diff pre {
  max-height: 100px;
  margin: 0.2rem 0 0;
  overflow: auto;
  padding: 0.45rem;
  border-radius: 5px;
  background: #242b38;
  color: #e5edf8;
  font: 0.65rem/1.45 "JetBrains Mono", monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 880px) {
  .add-watch {
    grid-template-columns: 1fr 0.6fr;
  }

}
</style>
