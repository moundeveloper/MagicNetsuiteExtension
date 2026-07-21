<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Button, InputText, useToast } from "primevue";
import MSelect from "../components/universal/input/MSelect.vue";

type AnalyzerHeader = { name: string; value: string };
type AnalyzerEntry = {
  id: string;
  kind: "request" | "download";
  startedAt: number;
  state?: string;
  method?: string;
  url?: string;
  finalUrl?: string;
  filename?: string;
  mime?: string;
  statusCode?: number;
  requestType?: string;
  requestId?: string;
  downloadId?: number;
  tabId?: number;
  initiator?: string | null;
  documentUrl?: string | null;
  referrer?: string | null;
  ip?: string | null;
  fromCache?: boolean;
  totalBytes?: number;
  bytesReceived?: number;
  fileSize?: number;
  danger?: string;
  error?: string | null;
  erased?: boolean;
  requestBody?: unknown;
  requestHeaders?: AnalyzerHeader[];
  responseHeaders?: AnalyzerHeader[];
  redirects?: Array<{ at: number; from: string; to: string; statusCode: number }>;
  [key: string]: unknown;
};

type AnalyzerState = { enabled: boolean; entries: AnalyzerEntry[] };

defineProps<{ vhOffset: number }>();

const toast = useToast();
const enabled = ref(false);
const entries = ref<AnalyzerEntry[]>([]);
const selected = ref<AnalyzerEntry | null>(null);
const loading = ref(true);
const changing = ref(false);
const search = ref("");
const kindFilter = ref("all");
const stateFilter = ref("all");

const kindOptions = [
  { label: "All events", value: "all" },
  { label: "Requests", value: "request" },
  { label: "Downloads", value: "download" }
];

const stateOptions = [
  { label: "All states", value: "all" },
  { label: "Complete", value: "complete" },
  { label: "In progress", value: "in_progress" },
  { label: "Errors", value: "error" }
];

const message = <T,>(payload: Record<string, unknown>) =>
  chrome.runtime.sendMessage(payload) as Promise<T>;

const applyState = (state: AnalyzerState) => {
  enabled.value = Boolean(state?.enabled);
  entries.value = Array.isArray(state?.entries) ? state.entries : [];
  if (selected.value) {
    selected.value = entries.value.find((entry) => entry.id === selected.value?.id) ?? null;
  }
};

const load = async () => {
  loading.value = true;
  try {
    applyState(await message<AnalyzerState>({ type: "DOWNLOAD_ANALYZER_GET_STATE" }));
  } finally {
    loading.value = false;
  }
};

const toggleCapture = async () => {
  changing.value = true;
  try {
    applyState(
      await message<AnalyzerState>({
        type: "DOWNLOAD_ANALYZER_SET_ENABLED",
        enabled: !enabled.value
      })
    );
    toast.add({
      severity: enabled.value ? "success" : "info",
      summary: enabled.value ? "Capture enabled" : "Capture stopped",
      detail: enabled.value
        ? "NetSuite requests and downloads are now being recorded locally."
        : "Existing analyzer entries were kept.",
      life: 2600
    });
  } finally {
    changing.value = false;
  }
};

const clear = async () => {
  applyState(await message<AnalyzerState>({ type: "DOWNLOAD_ANALYZER_CLEAR" }));
  selected.value = null;
};

const filteredEntries = computed(() => {
  const query = search.value.trim().toLowerCase();
  return entries.value.filter((entry) => {
    if (kindFilter.value !== "all" && entry.kind !== kindFilter.value) return false;
    if (stateFilter.value !== "all") {
      const normalizedState = entry.error ? "error" : entry.state;
      if (normalizedState !== stateFilter.value) return false;
    }
    if (!query) return true;
    return [
      entry.method,
      entry.url,
      entry.finalUrl,
      entry.filename,
      entry.mime,
      entry.statusCode,
      entry.requestType,
      entry.error
    ].some((value) => String(value ?? "").toLowerCase().includes(query));
  });
});

const stats = computed(() => ({
  requests: entries.value.filter((entry) => entry.kind === "request").length,
  downloads: entries.value.filter((entry) => entry.kind === "download").length,
  errors: entries.value.filter((entry) => entry.error || entry.state === "error").length,
  attachments: entries.value.filter((entry) =>
    entry.responseHeaders?.some(
      (header) =>
        header.name.toLowerCase() === "content-disposition" &&
        header.value.toLowerCase().includes("attachment")
    )
  ).length
}));

const displayUrl = (entry: AnalyzerEntry) => entry.finalUrl || entry.url || "";

const displayName = (entry: AnalyzerEntry) => {
  if (entry.filename) return entry.filename.split(/[\\/]/).pop() || entry.filename;
  try {
    const url = new URL(displayUrl(entry));
    return url.pathname.split("/").filter(Boolean).pop() || url.hostname;
  } catch {
    return entry.kind === "download" ? `Download ${entry.downloadId}` : "NetSuite request";
  }
};

const formatTime = (timestamp: number) => {
  const value = new Date(timestamp);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(value);
  return `${time}.${String(value.getMilliseconds()).padStart(3, "0")}`;
};

const formatBytes = (value: unknown) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

const statusLabel = (entry: AnalyzerEntry) => {
  if (entry.error) return "error";
  if (entry.kind === "request" && entry.statusCode) return String(entry.statusCode);
  return String(entry.state || "pending").replace("_", " ");
};

const pretty = (value: unknown) => JSON.stringify(value ?? null, null, 2);

const copy = async (value: unknown, label: string) => {
  await navigator.clipboard.writeText(typeof value === "string" ? value : pretty(value));
  toast.add({ severity: "success", summary: `${label} copied`, life: 1600 });
};

const exportEntries = () => {
  const blob = new Blob([pretty(entries.value)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `netsuite-download-analyzer-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

let refreshTimer = 0;
const runtimeListener = (runtimeMessage: { type?: string }) => {
  if (runtimeMessage.type !== "DOWNLOAD_ANALYZER_UPDATED") return;
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void load(), 120);
};

onMounted(() => {
  void load();
  chrome.runtime.onMessage.addListener(runtimeListener);
});

onBeforeUnmount(() => {
  window.clearTimeout(refreshTimer);
  chrome.runtime.onMessage.removeListener(runtimeListener);
});
</script>

<template>
  <section class="download-analyzer" :style="{ height: `${vhOffset}vh` }">
    <header class="analyzer-header">
      <div class="analyzer-title">
        <span class="capture-dot" :class="{ active: enabled }"></span>
        <div>
          <h1>Download Analyzer</h1>
          <p>Inspect the request chain and final browser download NetSuite creates.</p>
        </div>
      </div>
      <div class="header-actions">
        <Button
          :icon="enabled ? 'pi pi-stop' : 'pi pi-circle-fill'"
          :label="enabled ? 'Stop capture' : 'Start capture'"
          severity="secondary"
          outlined
          :loading="changing"
          @click="toggleCapture"
        />
        <Button
          icon="pi pi-download"
          label="Export"
          severity="secondary"
          outlined
          :disabled="!entries.length"
          @click="exportEntries"
        />
        <Button
          icon="pi pi-trash"
          label="Clear"
          severity="danger"
          outlined
          :disabled="!entries.length"
          @click="clear"
        />
      </div>
    </header>

    <div class="summary-strip">
      <span><strong>{{ stats.requests }}</strong> requests</span>
      <span><strong>{{ stats.downloads }}</strong> downloads</span>
      <span><strong>{{ stats.attachments }}</strong> attachments</span>
      <span :class="{ danger: stats.errors }"><strong>{{ stats.errors }}</strong> errors</span>
      <span class="capture-state">
        {{ enabled ? "Recording NetSuite traffic" : "Capture is off" }}
      </span>
    </div>

    <div class="analyzer-toolbar">
      <span class="search-box">
        <i class="pi pi-search"></i>
        <InputText v-model="search" placeholder="Search URL, filename, MIME, status…" />
      </span>
      <MSelect
        v-model="kindFilter"
        :options="kindOptions"
        option-label="label"
        option-value="value"
        size="small"
        class="toolbar-select"
      />
      <MSelect
        v-model="stateFilter"
        :options="stateOptions"
        option-label="label"
        option-value="value"
        size="small"
        class="toolbar-select"
      />
      <Button icon="pi pi-refresh" severity="secondary" text title="Refresh" @click="load" />
    </div>

    <div class="analyzer-body">
      <div class="event-list">
        <div v-if="loading" class="empty-state">
          <i class="pi pi-spin pi-spinner"></i>
          Loading analyzer…
        </div>
        <div v-else-if="!filteredEntries.length" class="empty-state">
          <i class="pi pi-download"></i>
          <strong>{{ enabled ? "Waiting for a NetSuite download" : "Start capture, then download a file" }}</strong>
          <span>Navigation downloads, redirects, headers, and final URLs appear here.</span>
        </div>
        <button
          v-for="entry in filteredEntries"
          v-else
          :key="entry.id"
          type="button"
          class="event-row"
          :class="{ selected: selected?.id === entry.id, failed: entry.error }"
          @click="selected = entry"
        >
          <span class="event-icon">
            <i :class="entry.kind === 'download' ? 'pi pi-download' : 'pi pi-arrow-right-arrow-left'"></i>
          </span>
          <span class="event-main">
            <span class="event-heading">
              <strong :title="displayName(entry)">{{ displayName(entry) }}</strong>
              <span class="event-status">{{ statusLabel(entry) }}</span>
            </span>
            <span class="event-url" :title="displayUrl(entry)">{{ entry.method || entry.kind }} · {{ displayUrl(entry) }}</span>
            <span class="event-meta">
              {{ formatTime(entry.startedAt) }}
              <template v-if="entry.mime"> · {{ entry.mime }}</template>
              <template v-if="entry.totalBytes !== undefined"> · {{ formatBytes(entry.totalBytes) }}</template>
            </span>
          </span>
          <i class="pi pi-chevron-right row-chevron"></i>
        </button>
      </div>

      <aside class="inspector" :class="{ empty: !selected }">
        <template v-if="selected">
          <header class="inspector-header">
            <div>
              <span>{{ selected.kind === "download" ? "DOWNLOAD" : "REQUEST" }} INSPECTOR</span>
              <h2 :title="displayName(selected)">{{ displayName(selected) }}</h2>
            </div>
            <Button icon="pi pi-times" severity="secondary" text title="Close inspector" @click="selected = null" />
          </header>

          <div class="facts">
            <div><span>Status</span><strong>{{ statusLabel(selected) }}</strong></div>
            <div><span>Started</span><strong>{{ formatTime(selected.startedAt) }}</strong></div>
            <div v-if="selected.method"><span>Method</span><strong>{{ selected.method }}</strong></div>
            <div v-if="selected.requestType"><span>Request type</span><strong>{{ selected.requestType }}</strong></div>
            <div v-if="selected.mime"><span>MIME</span><strong>{{ selected.mime }}</strong></div>
            <div v-if="selected.totalBytes !== undefined"><span>Size</span><strong>{{ formatBytes(selected.totalBytes) }}</strong></div>
          </div>

          <section class="value-section">
            <header><span>Original URL</span><button type="button" @click="copy(selected.url || '', 'URL')"><i class="pi pi-copy"></i> Copy</button></header>
            <code>{{ selected.url || "—" }}</code>
          </section>

          <section v-if="selected.finalUrl && selected.finalUrl !== selected.url" class="value-section">
            <header><span>Final URL</span><button type="button" @click="copy(selected.finalUrl, 'Final URL')"><i class="pi pi-copy"></i> Copy</button></header>
            <code>{{ selected.finalUrl }}</code>
          </section>

          <section v-if="selected.referrer || selected.documentUrl || selected.initiator" class="value-section">
            <header><span>Source</span></header>
            <dl>
              <template v-if="selected.referrer"><dt>Referrer</dt><dd>{{ selected.referrer }}</dd></template>
              <template v-if="selected.documentUrl"><dt>Document</dt><dd>{{ selected.documentUrl }}</dd></template>
              <template v-if="selected.initiator"><dt>Initiator</dt><dd>{{ selected.initiator }}</dd></template>
            </dl>
          </section>

          <section v-if="selected.redirects?.length" class="value-section">
            <header><span>Redirect chain</span><button type="button" @click="copy(selected.redirects, 'Redirect chain')"><i class="pi pi-copy"></i> Copy</button></header>
            <div v-for="redirect in selected.redirects" :key="`${redirect.at}-${redirect.to}`" class="redirect-row">
              <strong>{{ redirect.statusCode }}</strong>
              <span :title="redirect.to">{{ redirect.from }} → {{ redirect.to }}</span>
            </div>
          </section>

          <section v-if="selected.requestHeaders?.length" class="value-section">
            <header><span>Request headers</span><button type="button" @click="copy(selected.requestHeaders, 'Request headers')"><i class="pi pi-copy"></i> Copy</button></header>
            <dl><template v-for="header in selected.requestHeaders" :key="`${header.name}-${header.value}`"><dt>{{ header.name }}</dt><dd>{{ header.value }}</dd></template></dl>
          </section>

          <section v-if="selected.responseHeaders?.length" class="value-section">
            <header><span>Response headers</span><button type="button" @click="copy(selected.responseHeaders, 'Response headers')"><i class="pi pi-copy"></i> Copy</button></header>
            <dl><template v-for="header in selected.responseHeaders" :key="`${header.name}-${header.value}`"><dt>{{ header.name }}</dt><dd>{{ header.value }}</dd></template></dl>
          </section>

          <section v-if="selected.requestBody" class="json-section">
            <header><span>Request body</span><button type="button" @click="copy(selected.requestBody, 'Request body')"><i class="pi pi-copy"></i> Copy</button></header>
            <pre>{{ pretty(selected.requestBody) }}</pre>
          </section>

          <section v-if="selected.error" class="error-box"><i class="pi pi-exclamation-triangle"></i>{{ selected.error }}</section>
        </template>
        <template v-else>
          <i class="pi pi-search"></i>
          <strong>Select an event</strong>
          <span>URLs, redirects, headers, request data, and browser download details appear here.</span>
        </template>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.download-analyzer {
  --ink: #27323a;
  --muted: #62696e;
  --line: #dbe3ea;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 0.35rem;
  overflow: hidden;
  color: var(--ink);
}

.analyzer-header,
.summary-strip,
.analyzer-toolbar,
.analyzer-body {
  border: 1px solid var(--line);
  background: #fbfcfd;
}

.analyzer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.45rem 0.65rem;
  border-radius: 6px;
}

.analyzer-title,
.header-actions,
.analyzer-toolbar,
.event-heading,
.inspector-header,
.value-section header {
  display: flex;
  align-items: center;
}

.analyzer-title { gap: 0.55rem; min-width: 0; }
.capture-dot { width: 0.55rem; height: 0.55rem; border-radius: 50%; background: #8a949b; flex-shrink: 0; }
.capture-dot.active { background: #16a34a; box-shadow: 0 0 0 3px rgb(22 163 74 / 12%); }
.analyzer-title h1 { margin: 0; font-size: 0.95rem; }
.analyzer-title p { margin: 0.1rem 0 0; color: var(--muted); font-size: 0.68rem; }
.header-actions { gap: 0.35rem; flex-shrink: 0; }
.header-actions :deep(.p-button) { min-height: 1.9rem; padding: 0.28rem 0.55rem; font-size: 0.7rem; white-space: nowrap; }

.summary-strip { display: flex; align-items: center; gap: 1rem; min-height: 1.9rem; padding: 0.25rem 0.65rem; border-radius: 5px; color: var(--muted); font-size: 0.68rem; }
.summary-strip strong { color: var(--ink); }
.summary-strip .danger, .error-box { color: #b91c1c; }
.capture-state { margin-left: auto; }

.analyzer-toolbar { gap: 0.4rem; padding: 0.3rem; border-radius: 5px; }
.search-box { position: relative; flex: 1; min-width: 180px; }
.search-box i { position: absolute; z-index: 1; left: 0.65rem; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: 0.72rem; }
.search-box :deep(input) { width: 100%; height: 1.9rem; padding-left: 1.85rem; font-size: 0.75rem; }
.toolbar-select { width: 145px; flex-shrink: 0; }

.analyzer-body { display: grid; grid-template-columns: minmax(330px, 0.9fr) minmax(390px, 1.1fr); flex: 1; min-height: 0; overflow: hidden; border-radius: 6px; }
.event-list { min-height: 0; overflow-y: auto; border-right: 1px solid var(--line); background: white; }
.event-row { display: grid; grid-template-columns: 1.8rem minmax(0, 1fr) auto; align-items: center; gap: 0.5rem; width: 100%; padding: 0.5rem 0.6rem; border: 0; border-bottom: 1px solid #edf1f4; background: white; color: inherit; text-align: left; cursor: pointer; }
.event-row:hover, .event-row.selected { background: #faf7ff; }
.event-row.selected { box-shadow: inset 3px 0 #7b2ff7; }
.event-icon { display: grid; place-items: center; width: 1.65rem; height: 1.65rem; border: 1px solid #d8c6ff; border-radius: 5px; background: #faf7ff; color: #7b2ff7; }
.event-main { min-width: 0; }
.event-heading { justify-content: space-between; gap: 0.4rem; }
.event-heading strong, .event-url, .inspector-header h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event-heading strong { font-size: 0.73rem; }
.event-status { flex-shrink: 0; padding: 0.08rem 0.3rem; border: 1px solid var(--line); border-radius: 4px; color: var(--muted); font-size: 0.58rem; text-transform: uppercase; }
.event-row.failed .event-status { border-color: #fecaca; color: #b91c1c; }
.event-url, .event-meta { display: block; color: var(--muted); font-size: 0.62rem; }
.event-url { margin-top: 0.12rem; }
.event-meta { margin-top: 0.08rem; }
.row-chevron { color: #8a949b; font-size: 0.65rem; }

.inspector { min-width: 0; min-height: 0; overflow-y: auto; padding: 0.7rem; background: #fbfcfd; }
.inspector.empty, .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.45rem; color: var(--muted); text-align: center; min-height: 100%; font-size: 0.72rem; }
.inspector.empty > i, .empty-state > i { color: #8a949b; font-size: 1.5rem; }
.inspector-header { justify-content: space-between; gap: 0.5rem; }
.inspector-header > div { min-width: 0; }
.inspector-header span { color: #7b2ff7; font-size: 0.58rem; font-weight: 700; letter-spacing: 0.08em; }
.inspector-header h2 { margin: 0.1rem 0 0; font-size: 0.9rem; }
.facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.35rem; margin: 0.55rem 0; }
.facts > div { min-width: 0; padding: 0.38rem 0.45rem; border: 1px solid var(--line); border-radius: 5px; background: white; }
.facts span, .value-section header span { display: block; color: var(--muted); font-size: 0.55rem; text-transform: uppercase; letter-spacing: 0.04em; }
.facts strong { display: block; margin-top: 0.1rem; overflow: hidden; font-size: 0.68rem; text-overflow: ellipsis; white-space: nowrap; }
.value-section, .json-section { margin-top: 0.45rem; overflow: hidden; border: 1px solid var(--line); border-radius: 5px; background: white; }
.value-section header, .json-section header { justify-content: space-between; padding: 0.32rem 0.45rem; border-bottom: 1px solid var(--line); background: #eef3f7; }
.value-section header button, .json-section header button { border: 0; background: transparent; color: #7b2ff7; font-size: 0.62rem; cursor: pointer; }
.value-section code { display: block; padding: 0.45rem; overflow-wrap: anywhere; color: var(--ink); font: 0.64rem/1.45 "JetBrains Mono", monospace; }
.value-section dl { display: grid; grid-template-columns: minmax(90px, 0.25fr) minmax(0, 0.75fr); margin: 0; padding: 0.35rem 0.45rem; gap: 0.2rem 0.55rem; font-size: 0.63rem; }
.value-section dt { color: var(--muted); }
.value-section dd { margin: 0; overflow-wrap: anywhere; }
.redirect-row { display: flex; gap: 0.45rem; padding: 0.35rem 0.45rem; border-bottom: 1px solid #edf1f4; font-size: 0.62rem; }
.redirect-row:last-child { border-bottom: 0; }
.redirect-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.json-section pre { max-height: 210px; margin: 0; overflow: auto; padding: 0.55rem; background: #27323a; color: #f3f6f8; font: 0.64rem/1.45 "JetBrains Mono", monospace; white-space: pre-wrap; word-break: break-word; }
.error-box { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.45rem; padding: 0.45rem; border: 1px solid #fecaca; border-radius: 5px; background: #fff7f7; font-size: 0.68rem; }

@media (max-width: 820px) {
  .analyzer-header { align-items: flex-start; }
  .analyzer-title p { display: none; }
  .analyzer-body { grid-template-columns: minmax(290px, 0.85fr) minmax(330px, 1.15fr); }
  .summary-strip { gap: 0.55rem; }
  .toolbar-select { width: 125px; }
}
</style>
