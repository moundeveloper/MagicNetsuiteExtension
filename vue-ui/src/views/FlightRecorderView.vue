<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Button, InputText, Select, Tag, useToast } from "primevue";
import { callApi, getNetsuiteEnvironment } from "../utils/api";
import {
  clearActivities,
  deleteActivity,
  isReplaySafe,
  listActivities,
  type ActivityEntry,
  type ActivityKind,
  type ActivityStatus
} from "../utils/activityRecorderDb";

const props = defineProps<{ vhOffset: number }>();
const toast = useToast();
const activities = ref<ActivityEntry[]>([]);
const selected = ref<ActivityEntry | null>(null);
const loading = ref(true);
const replaying = ref(false);
const environment = ref("unknown");
const search = ref("");
const status = ref<ActivityStatus | "all">("all");
const kind = ref<ActivityKind | "all">("all");
const accountScope = ref<"current" | "all">("current");

const statusOptions = [
  { label: "All statuses", value: "all" },
  { label: "Success", value: "success" },
  { label: "Errors", value: "error" }
];
const kindOptions = [
  { label: "All activity", value: "all" },
  { label: "Reads", value: "read" },
  { label: "Writes", value: "write" },
  { label: "Executions", value: "execute" },
  { label: "System", value: "system" }
];
const accountOptions = [
  { label: "Current account", value: "current" },
  { label: "All accounts", value: "all" }
];

const load = async () => {
  loading.value = true;
  try {
    environment.value = await getNetsuiteEnvironment().catch(() => "unknown");
    activities.value = await listActivities({
      environment:
        accountScope.value === "current" ? environment.value : undefined,
      status: status.value,
      kind: kind.value,
      query: search.value,
      limit: 750
    });
    if (
      selected.value?.id &&
      !activities.value.some((entry) => entry.id === selected.value?.id)
    ) {
      selected.value = null;
    }
  } finally {
    loading.value = false;
  }
};

let searchTimer = 0;
watch([status, kind, accountScope], () => void load());
watch(search, () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void load(), 180);
});

const stats = computed(() => {
  const total = activities.value.length;
  const errors = activities.value.filter((entry) => entry.status === "error").length;
  const writes = activities.value.filter((entry) => entry.kind === "write").length;
  const average = total
    ? Math.round(
        activities.value.reduce((sum, entry) => sum + entry.durationMs, 0) / total
      )
    : 0;
  const slowest = activities.value.reduce(
    (max, entry) => Math.max(max, entry.durationMs),
    0
  );
  return { total, errors, writes, average, slowest };
});

const formatDuration = (duration: number) =>
  duration < 1000 ? `${duration} ms` : `${(duration / 1000).toFixed(2)} s`;

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(timestamp);

const relativeTime = (timestamp: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const pretty = (value: unknown) => {
  if (value === undefined) return "No data";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const copyJson = async (value: unknown, label: string) => {
  await navigator.clipboard.writeText(pretty(value));
  toast.add({
    severity: "success",
    summary: `${label} copied`,
    life: 1800
  });
};

const replay = async () => {
  if (!selected.value || !isReplaySafe(selected.value.route)) return;
  replaying.value = true;
  try {
    const response = await callApi(
      selected.value.route,
      selected.value.payload,
      selected.value.mode as any
    );
    toast.add({
      severity: response?.status === "error" ? "error" : "success",
      summary: response?.status === "error" ? "Replay failed" : "Request replayed",
      detail: selected.value.route,
      life: 3000
    });
  } catch (error) {
    toast.add({
      severity: "error",
      summary: "Replay failed",
      detail: error instanceof Error ? error.message : String(error),
      life: 4000
    });
  } finally {
    replaying.value = false;
    await load();
  }
};

const removeSelected = async () => {
  if (!selected.value?.id) return;
  await deleteActivity(selected.value.id);
  selected.value = null;
  await load();
};

const clearVisibleAccount = async () => {
  await clearActivities(
    accountScope.value === "current" ? environment.value : undefined
  );
  selected.value = null;
  await load();
};

const exportVisible = () => {
  const blob = new Blob([JSON.stringify(activities.value, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `netsuite-flight-recorder-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const statusSeverity = (entry: ActivityEntry) =>
  entry.status === "success" ? "success" : "danger";

const kindIcon = (entry: ActivityEntry) =>
  ({
    read: "pi pi-search",
    write: "pi pi-pencil",
    execute: "pi pi-bolt",
    system: "pi pi-cog"
  })[entry.kind];

const handleChanged = () => void load();
const handleEnvironmentChanged = () => void load();

onMounted(() => {
  void load();
  window.addEventListener("magic-netsuite-activity-changed", handleChanged);
  window.addEventListener(
    "magic-netsuite-environment-changed",
    handleEnvironmentChanged
  );
});

onBeforeUnmount(() => {
  window.clearTimeout(searchTimer);
  window.removeEventListener("magic-netsuite-activity-changed", handleChanged);
  window.removeEventListener(
    "magic-netsuite-environment-changed",
    handleEnvironmentChanged
  );
});
</script>

<template>
  <section class="flight-recorder" :style="{ height: `${vhOffset}vh` }">
    <header class="recorder-hero">
      <div>
        <div class="eyebrow">
          <span class="live-dot"></span>
          LIVE NETSUITE TELEMETRY
        </div>
        <h1>Flight Recorder</h1>
        <p>
          Inspect what the extension asks NetSuite to do, how long it takes,
          and exactly where requests fail.
        </p>
      </div>
      <div class="hero-actions">
        <Button
          icon="pi pi-download"
          label="Export"
          severity="secondary"
          outlined
          :disabled="!activities.length"
          @click="exportVisible"
        />
        <Button
          icon="pi pi-trash"
          label="Clear"
          severity="danger"
          outlined
          :disabled="!activities.length"
          @click="clearVisibleAccount"
        />
      </div>
    </header>

    <div class="stats-grid">
      <article>
        <span>Captured</span>
        <strong>{{ stats.total }}</strong>
        <small>visible requests</small>
      </article>
      <article>
        <span>Average latency</span>
        <strong>{{ formatDuration(stats.average) }}</strong>
        <small>slowest {{ formatDuration(stats.slowest) }}</small>
      </article>
      <article :class="{ danger: stats.errors > 0 }">
        <span>Failures</span>
        <strong>{{ stats.errors }}</strong>
        <small>{{ stats.total ? Math.round((stats.errors / stats.total) * 100) : 0 }}% error rate</small>
      </article>
      <article>
        <span>Changes</span>
        <strong>{{ stats.writes }}</strong>
        <small>write operations</small>
      </article>
    </div>

    <div class="toolbar">
      <span class="search-box">
        <i class="pi pi-search"></i>
        <InputText v-model="search" placeholder="Search routes, payloads, errors…" />
      </span>
      <Select v-model="status" :options="statusOptions" option-label="label" option-value="value" />
      <Select v-model="kind" :options="kindOptions" option-label="label" option-value="value" />
      <Select v-model="accountScope" :options="accountOptions" option-label="label" option-value="value" />
      <Button icon="pi pi-refresh" severity="secondary" text title="Refresh" @click="load" />
    </div>

    <div class="recorder-body">
      <div class="timeline">
        <div v-if="loading" class="empty-state">
          <i class="pi pi-spin pi-spinner"></i>
          Loading recorder…
        </div>
        <div v-else-if="!activities.length" class="empty-state">
          <i class="pi pi-wave-pulse"></i>
          <strong>No activity captured yet</strong>
          <span>Use any extension feature and requests will appear here live.</span>
        </div>
        <button
          v-for="entry in activities"
          v-else
          :key="entry.id"
          class="timeline-entry"
          :class="{ selected: selected?.id === entry.id, failed: entry.status === 'error' }"
          @click="selected = entry"
        >
          <span class="kind-icon"><i :class="kindIcon(entry)"></i></span>
          <span class="entry-main">
            <span class="entry-title">
              <strong>{{ entry.route }}</strong>
              <Tag :value="entry.status" :severity="statusSeverity(entry)" rounded />
            </span>
            <span class="entry-meta">
              {{ entry.kind }} · {{ formatDuration(entry.durationMs) }} ·
              {{ relativeTime(entry.startedAt) }}
            </span>
            <span v-if="entry.error" class="entry-error">{{ entry.error }}</span>
          </span>
          <i class="pi pi-chevron-right"></i>
        </button>
      </div>

      <aside class="inspector" :class="{ empty: !selected }">
        <template v-if="selected">
          <div class="inspector-heading">
            <div>
              <span>REQUEST INSPECTOR</span>
              <h2>{{ selected.route }}</h2>
            </div>
            <Button icon="pi pi-times" severity="secondary" text @click="selected = null" />
          </div>

          <div class="request-facts">
            <div><span>Status</span><Tag :value="selected.status" :severity="statusSeverity(selected)" /></div>
            <div><span>Type</span><strong>{{ selected.kind }}</strong></div>
            <div><span>Duration</span><strong>{{ formatDuration(selected.durationMs) }}</strong></div>
            <div><span>Started</span><strong>{{ formatTime(selected.startedAt) }}</strong></div>
            <div class="wide"><span>Account</span><strong>{{ selected.environment }}</strong></div>
          </div>

          <div v-if="selected.error" class="error-callout">
            <i class="pi pi-exclamation-triangle"></i>
            <span>{{ selected.error }}</span>
          </div>

          <section class="json-section">
            <header>
              <span>Payload</span>
              <button @click="copyJson(selected.payload, 'Payload')"><i class="pi pi-copy"></i> Copy</button>
            </header>
            <pre>{{ pretty(selected.payload) }}</pre>
          </section>

          <section class="json-section">
            <header>
              <span>Response</span>
              <button @click="copyJson(selected.response, 'Response')"><i class="pi pi-copy"></i> Copy</button>
            </header>
            <pre>{{ pretty(selected.response) }}</pre>
          </section>

          <div class="inspector-actions">
            <Button
              icon="pi pi-replay"
              label="Replay request"
              :loading="replaying"
              :disabled="!isReplaySafe(selected.route)"
              @click="replay"
            />
            <Button icon="pi pi-trash" severity="danger" outlined @click="removeSelected" />
          </div>
          <p v-if="!isReplaySafe(selected.route)" class="replay-note">
            Replay is disabled for writes and executions to prevent accidental changes.
          </p>
        </template>
        <template v-else>
          <i class="pi pi-search"></i>
          <strong>Select a request</strong>
          <span>Payload, response, timing, and safe replay appear here.</span>
        </template>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.flight-recorder {
  --ink: #172033;
  --muted: #73809a;
  --line: #dbe3ee;
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 0.3rem;
  overflow: hidden;
  color: var(--ink);
}

.recorder-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
  padding: 0.32rem 0.55rem;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: linear-gradient(120deg, #f8fafc 0%, #eef4ff 55%, #f7f3ff 100%);
}

.eyebrow {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  color: #516078;
  font-size: 0.5rem;
  font-weight: 800;
  letter-spacing: 0.09em;
}

.live-dot {
  width: 0.36rem;
  height: 0.36rem;
  border-radius: 999px;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgb(34 197 94 / 15%);
}

.recorder-hero h1 {
  margin: 0.02rem 0 0;
  font-size: 0.98rem;
  line-height: 1.1;
}

.recorder-hero p {
  display: none;
}

.hero-actions,
.toolbar {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.recorder-hero :deep(.p-button) {
  min-height: 1.9rem;
  padding: 0.28rem 0.6rem;
  font-size: 0.72rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.32rem;
}

.stats-grid article {
  display: grid;
  gap: 0;
  padding: 0.25rem 0.42rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgb(255 255 255 / 88%);
}

.stats-grid span,
.request-facts span {
  color: var(--muted);
  font-size: 0.49rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stats-grid strong {
  font-size: 0.78rem;
}

.stats-grid small {
  color: var(--muted);
  font-size: 0.52rem;
}

.stats-grid article.danger {
  border-color: #fecaca;
  background: #fff7f7;
}

.toolbar {
  padding: 0.3rem;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: rgb(255 255 255 / 90%);
}

.search-box {
  position: relative;
  flex: 1;
}

.search-box i {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 0.75rem;
  transform: translateY(-50%);
  color: var(--muted);
}

.search-box :deep(input) {
  width: 100%;
  padding-left: 2.25rem;
}

.recorder-body {
  display: grid;
  grid-template-columns: minmax(370px, 0.85fr) minmax(430px, 1.15fr);
  min-height: 0;
  flex: 1;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgb(255 255 255 / 90%);
}

.timeline {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  padding-block: 0.35rem;
  border-right: 1px solid var(--line);
}

.timeline > .empty-state {
  min-height: calc(100% - 0.7rem);
  flex: 1;
}

.timeline-entry {
  display: grid;
  width: 100%;
  grid-template-columns: 2.2rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.65rem;
  padding: 0.72rem 0.85rem;
  border: 0;
  border-bottom: 1px solid #edf1f6;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.timeline-entry:hover,
.timeline-entry.selected {
  background: #f1f5fb;
}

.timeline-entry.selected {
  box-shadow: inset 3px 0 #6d5dfc;
}

.timeline-entry.failed .kind-icon {
  color: #dc2626;
  background: #fee2e2;
}

.kind-icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border-radius: 8px;
  background: #e9edff;
  color: #5b50cf;
}

.entry-main {
  min-width: 0;
}

.entry-title,
.entry-meta,
.entry-error {
  display: flex;
  align-items: center;
}

.entry-title {
  justify-content: space-between;
  gap: 0.5rem;
}

.entry-title strong {
  overflow: hidden;
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-meta {
  margin-top: 0.18rem;
  color: var(--muted);
  font-size: 0.67rem;
}

.entry-error {
  margin-top: 0.25rem;
  overflow: hidden;
  color: #b91c1c;
  font-size: 0.66rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inspector {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
}

.inspector.empty,
.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 0.55rem;
  color: var(--muted);
  text-align: center;
}

.inspector.empty > i,
.empty-state > i {
  font-size: 1.7rem;
  color: #9aa7bc;
}

.inspector-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.inspector-heading span {
  color: #7468d9;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.11em;
}

.inspector-heading h2 {
  margin: 0.18rem 0 0;
  font-size: 1.05rem;
}

.request-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.65rem;
  margin: 1rem 0;
}

.request-facts > div {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.6rem;
  border: 1px solid #e5eaf2;
  border-radius: 8px;
  background: #fafbfd;
}

.request-facts .wide {
  grid-column: 1 / -1;
}

.request-facts strong {
  overflow: hidden;
  font-size: 0.72rem;
  text-overflow: ellipsis;
}

.error-callout {
  display: flex;
  gap: 0.55rem;
  margin-bottom: 0.75rem;
  padding: 0.65rem;
  border: 1px solid #fecaca;
  border-radius: 8px;
  background: #fff1f2;
  color: #b91c1c;
  font-size: 0.72rem;
}

.json-section {
  margin-top: 0.75rem;
  overflow: hidden;
  border: 1px solid #dfe5ee;
  border-radius: 9px;
}

.json-section header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.45rem 0.65rem;
  border-bottom: 1px solid #dfe5ee;
  background: #f7f9fc;
  font-size: 0.7rem;
  font-weight: 700;
}

.json-section button {
  border: 0;
  background: transparent;
  color: #6458d2;
  font-size: 0.66rem;
  cursor: pointer;
}

.json-section pre {
  max-height: 230px;
  margin: 0;
  overflow: auto;
  padding: 0.75rem;
  background: #202735;
  color: #dce5f3;
  font: 0.68rem/1.55 "JetBrains Mono", monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.inspector-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.85rem;
}

.replay-note {
  margin: 0.45rem 0 0;
  color: var(--muted);
  font-size: 0.65rem;
}

@media (max-width: 900px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .recorder-body {
    grid-template-columns: minmax(290px, 0.8fr) minmax(330px, 1.2fr);
  }

  .toolbar {
    flex-wrap: wrap;
  }

  .search-box {
    flex-basis: 100%;
  }
}
</style>
