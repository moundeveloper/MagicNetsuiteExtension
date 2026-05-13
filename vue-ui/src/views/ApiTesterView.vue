<template>
  <div v-if="!isAdmin" class="admin-guard">
    <i class="pi pi-lock text-4xl text-gray-400 mb-3"></i>
    <p class="text-gray-500 text-sm">Access restricted to admins.</p>
  </div>

  <MCard v-else flex autoHeight direction="row" gap="0.5" padding="" outlined elevated :style="{ height: '90vh' }">
    <!-- ═══ SIDEBAR: History ═══ -->
    <ExpandableSidebar expandedWidth="220px" :defaultExpanded="true">
      <template #collapsed>
        <button class="p-2 rounded bg-slate-600 hover:opacity-100 hover:bg-slate-500 transition-opacity duration-150 text-[var(--p-slate-50)]" title="History">
          <i class="pi pi-history text-sm"></i>
        </button>
      </template>
      <template #default>
        <div class="sidebar-section">
          <h4>History</h4>
          <div class="history-list">
            <div
              v-for="entry in history"
              :key="entry.id"
              class="history-item"
              :title="`${entry.method} ${entry.url}`"
              @click="loadFromHistory(entry)"
            >
              <span class="method-badge" :class="methodClass(entry.method)">{{ entry.method }}</span>
              <span class="history-url">{{ entry.url }}</span>
              <span v-if="entry.status" class="history-status" :class="statusClass(entry.status)">{{ entry.status }}</span>
            </div>
            <div v-if="history.length === 0" class="text-gray-400 text-xs text-center mt-4 px-2">
              No history yet
            </div>
          </div>
          <Button v-if="history.length > 0" size="small" text class="mt-2 w-full" @click="clearHistory">
            <i class="pi pi-trash text-xs mr-1"></i> Clear
          </Button>
        </div>
      </template>
    </ExpandableSidebar>

    <!-- ═══ MAIN AREA ═══ -->
    <div class="api-main">
      <!-- URL bar -->
      <div class="url-bar">
        <Select
          v-model="method"
          :options="HTTP_METHODS"
          size="small"
          class="method-select"
          :pt="{ overlay: { style: { zIndex: '10000' } } }"
        />
        <InputText
          v-model="url"
          placeholder="https://your-account.app.netsuite.com/..."
          size="small"
          class="url-input"
          @keydown.enter="sendRequest"
        />
        <Button size="small" @click="sendRequest" :loading="isLoading" :disabled="!url.trim()">
          <i class="pi pi-send text-xs mr-1"></i> Send
        </Button>
      </div>

      <!-- Request config tabs -->
      <div class="request-section">
        <div class="tab-bar">
          <button
            v-for="tab in REQUEST_TABS"
            :key="tab"
            :class="['tab-btn', { active: activeRequestTab === tab }]"
            @click="activeRequestTab = tab"
          >
            {{ tab }}
            <span v-if="tab === 'Params' && activeParams.length > 0" class="tab-badge">{{ activeParams.length }}</span>
            <span v-if="tab === 'Headers' && activeHeaders.length > 0" class="tab-badge">{{ activeHeaders.length }}</span>
          </button>
        </div>

        <!-- Params -->
        <div v-if="activeRequestTab === 'Params'" class="kv-editor">
          <div class="kv-header-row">
            <span>Key</span><span>Value</span><span></span>
          </div>
          <div v-for="(row, i) in params" :key="i" class="kv-row">
            <InputText v-model="row.key" placeholder="key" size="small" class="kv-input" />
            <InputText v-model="row.value" placeholder="value" size="small" class="kv-input" />
            <button class="kv-remove" @click="removeParam(i)" title="Remove">
              <i class="pi pi-times text-xs"></i>
            </button>
          </div>
          <Button text size="small" class="mt-1" @click="addParam">
            <i class="pi pi-plus text-xs mr-1"></i> Add
          </Button>
        </div>

        <!-- Headers -->
        <div v-if="activeRequestTab === 'Headers'" class="kv-editor">
          <div class="kv-header-row">
            <span>Key</span><span>Value</span><span></span>
          </div>
          <div v-for="(row, i) in headers" :key="i" class="kv-row">
            <InputText v-model="row.key" placeholder="key" size="small" class="kv-input" />
            <InputText v-model="row.value" placeholder="value" size="small" class="kv-input" />
            <button class="kv-remove" @click="removeHeader(i)" title="Remove">
              <i class="pi pi-times text-xs"></i>
            </button>
          </div>
          <Button text size="small" class="mt-1" @click="addHeader">
            <i class="pi pi-plus text-xs mr-1"></i> Add
          </Button>
        </div>

        <!-- Body -->
        <div v-if="activeRequestTab === 'Body'" class="body-editor">
          <div class="body-type-bar">
            <Select
              v-model="bodyType"
              :options="BODY_TYPES"
              size="small"
              class="body-type-select"
              :pt="{ overlay: { style: { zIndex: '10000' } } }"
            />
          </div>
          <textarea
            v-model="body"
            class="body-textarea"
            placeholder="Request body..."
            spellcheck="false"
            :disabled="bodyType === 'none'"
          />
        </div>
      </div>

      <!-- Response panel -->
      <div class="response-section">
        <div v-if="!response && !isLoading" class="response-empty">
          <i class="pi pi-send text-3xl text-gray-300 mb-2"></i>
          <p class="text-gray-400 text-sm">Send a request to see the response.</p>
        </div>

        <div v-else-if="isLoading" class="response-empty">
          <i class="pi pi-spin pi-spinner text-2xl text-indigo-400 mb-2"></i>
          <p class="text-gray-400 text-sm">Sending request...</p>
        </div>

        <div v-else-if="response" class="response-body">
          <div class="response-meta">
            <span class="status-badge" :class="statusClass(response.status)">
              {{ response.status }} {{ response.statusText }}
            </span>
            <span class="response-duration">{{ response.duration }}ms</span>
            <span v-if="response.error" class="text-red-500 text-xs ml-2">{{ response.error }}</span>
          </div>

          <div class="tab-bar mt-1">
            <button
              v-for="tab in RESPONSE_TABS"
              :key="tab"
              :class="['tab-btn', { active: activeResponseTab === tab }]"
              @click="activeResponseTab = tab"
            >
              {{ tab }}
            </button>
            <div class="ml-auto flex gap-1">
              <button class="fmt-btn" :class="{ active: responseFormat === 'pretty' }" @click="responseFormat = 'pretty'">Pretty</button>
              <button class="fmt-btn" :class="{ active: responseFormat === 'raw' }" @click="responseFormat = 'raw'">Raw</button>
              <button class="fmt-btn ml-1" @click="copyResponse" title="Copy response">
                <i class="pi pi-copy text-xs"></i>
              </button>
            </div>
          </div>

          <!-- Response Body -->
          <div v-if="activeResponseTab === 'Body'" class="response-content">
            <pre class="response-pre">{{ formattedResponseBody }}</pre>
          </div>

          <!-- Response Headers -->
          <div v-else-if="activeResponseTab === 'Headers'" class="response-content">
            <div v-for="(value, key) in response.headers" :key="key" class="header-row">
              <span class="header-key">{{ key }}</span>
              <span class="header-value">{{ value }}</span>
            </div>
            <div v-if="Object.keys(response.headers).length === 0" class="text-gray-400 text-xs text-center mt-4">
              No response headers
            </div>
          </div>
        </div>
      </div>
    </div>
  </MCard>
</template>

<script lang="ts" setup>
import { ref, computed } from "vue";
import { Button, InputText, Select } from "primevue";
import MCard from "../components/universal/card/MCard.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import { callApi } from "../utils/api";
import { RequestRoutes } from "../types/request";

// ── Admin guard ─────────────────────────────────────────────────────────────
const privilegeLevel = import.meta.env.VITE_PRIVILEGE_LEVEL;
const isAdmin = privilegeLevel === "ADMIN";

// ── Constants ────────────────────────────────────────────────────────────────
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const BODY_TYPES = ["none", "raw (JSON)", "raw (text)", "form-urlencoded"];
const REQUEST_TABS = ["Params", "Headers", "Body"];
const RESPONSE_TABS = ["Body", "Headers"];

// ── Types ────────────────────────────────────────────────────────────────────
type KVRow = { key: string; value: string };

type HistoryEntry = {
  id: string;
  method: string;
  url: string;
  timestamp: number;
  status: number | null;
};

type HttpResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
  url: string;
  error?: string;
};

// ── State ────────────────────────────────────────────────────────────────────
const method = ref("GET");
const url = ref("");
const params = ref<KVRow[]>([{ key: "", value: "" }]);
const headers = ref<KVRow[]>([{ key: "", value: "" }]);
const body = ref("");
const bodyType = ref("none");

const activeRequestTab = ref("Params");
const activeResponseTab = ref("Body");
const responseFormat = ref<"pretty" | "raw">("pretty");

const isLoading = ref(false);
const response = ref<HttpResponse | null>(null);
const history = ref<HistoryEntry[]>([]);

// ── Computed ─────────────────────────────────────────────────────────────────
const activeParams = computed(() => params.value.filter((r) => r.key.trim()));
const activeHeaders = computed(() => headers.value.filter((r) => r.key.trim()));

const formattedResponseBody = computed(() => {
  if (!response.value) return "";
  if (responseFormat.value === "raw") return response.value.body;
  try {
    return JSON.stringify(JSON.parse(response.value.body), null, 2);
  } catch {
    return response.value.body;
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────
const buildUrl = (): string => {
  const base = url.value.trim();
  const qp = activeParams.value;
  if (!qp.length) return base;
  try {
    const u = new URL(base);
    qp.forEach(({ key, value }) => u.searchParams.set(key, value));
    return u.toString();
  } catch {
    const query = qp
      .map(({ key, value }) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    return base.includes("?") ? `${base}&${query}` : `${base}?${query}`;
  }
};

const buildHeaders = (): Record<string, string> => {
  const result: Record<string, string> = {};
  activeHeaders.value.forEach(({ key, value }) => {
    result[key.trim()] = value;
  });
  if (bodyType.value === "raw (JSON)" && body.value) {
    result["Content-Type"] = result["Content-Type"] ?? "application/json";
  } else if (bodyType.value === "form-urlencoded" && body.value) {
    result["Content-Type"] =
      result["Content-Type"] ?? "application/x-www-form-urlencoded";
  }
  return result;
};

const buildBody = (): string | undefined => {
  if (bodyType.value === "none" || !body.value) return undefined;
  return body.value;
};

// ── Actions ──────────────────────────────────────────────────────────────────
const sendRequest = async () => {
  if (!url.value.trim()) return;
  isLoading.value = true;
  response.value = null;

  const finalUrl = buildUrl();

  try {
    const apiResponse = await callApi(RequestRoutes.EXECUTE_HTTP_REQUEST, {
      method: method.value,
      url: finalUrl,
      headers: buildHeaders(),
      body: buildBody()
    });

    if (apiResponse.status === "ok") {
      response.value = apiResponse.message as HttpResponse;
      history.value.unshift({
        id: crypto.randomUUID(),
        method: method.value,
        url: finalUrl,
        timestamp: Date.now(),
        status: response.value.status
      });
      if (history.value.length > 50) history.value.pop();
    } else {
      response.value = {
        status: 0,
        statusText: "Error",
        headers: {},
        body: String(apiResponse.message),
        duration: 0,
        url: finalUrl,
        error: String(apiResponse.message)
      };
    }
  } finally {
    isLoading.value = false;
    activeResponseTab.value = "Body";
  }
};

const loadFromHistory = (entry: HistoryEntry) => {
  method.value = entry.method;
  url.value = entry.url;
  params.value = [{ key: "", value: "" }];
};

const clearHistory = () => {
  history.value = [];
};

const copyResponse = () => {
  navigator.clipboard.writeText(formattedResponseBody.value);
};

// ── KV helpers ───────────────────────────────────────────────────────────────
const addParam = () => params.value.push({ key: "", value: "" });
const removeParam = (i: number) => params.value.splice(i, 1);
const addHeader = () => headers.value.push({ key: "", value: "" });
const removeHeader = (i: number) => headers.value.splice(i, 1);

// ── CSS helpers ───────────────────────────────────────────────────────────────
const statusClass = (status: number): string => {
  if (status >= 200 && status < 300) return "status-ok";
  if (status >= 300 && status < 400) return "status-redirect";
  if (status >= 400 && status < 500) return "status-client-error";
  if (status >= 500) return "status-server-error";
  return "status-unknown";
};

const methodClass = (m: string): string => {
  const map: Record<string, string> = {
    GET: "method-get",
    POST: "method-post",
    PUT: "method-put",
    PATCH: "method-patch",
    DELETE: "method-delete"
  };
  return map[m] ?? "method-other";
};
</script>

<style scoped>
/* ── Admin guard ─────────────────────────────────────────────────────────── */
.admin-guard {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 90vh;
  gap: 0.5rem;
}

/* ── Main layout ─────────────────────────────────────────────────────────── */
.api-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

/* ── Sidebar ─────────────────────────────────────────────────────────────── */
.sidebar-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 0.75rem 0.5rem;
  overflow: hidden;
}

.sidebar-section h4 {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-slate-400);
  margin: 0 0 0.5rem 0;
}

.history-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-height: 0;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.4rem;
  border-radius: 0.25rem;
  cursor: pointer;
  font-size: 0.7rem;
  overflow: hidden;
  transition: background 0.12s;
}

.history-item:hover {
  background: var(--p-slate-200);
}

.history-url {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--p-slate-600);
  font-size: 0.65rem;
}

.history-status {
  font-size: 0.65rem;
  font-weight: 600;
  flex-shrink: 0;
}

/* ── URL bar ─────────────────────────────────────────────────────────────── */
.url-bar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--p-slate-200);
  flex-shrink: 0;
}

.method-select {
  width: 7rem;
  flex-shrink: 0;
}

.url-input {
  flex: 1;
  min-width: 0;
  font-size: 0.8rem;
}

/* ── Request section ─────────────────────────────────────────────────────── */
.request-section {
  flex-shrink: 0;
  border-bottom: 1px solid var(--p-slate-200);
}

/* ── Response section ────────────────────────────────────────────────────── */
.response-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.response-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--p-slate-400);
}

.response-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding: 0.5rem 0.75rem;
}

/* ── Shared tab bar ──────────────────────────────────────────────────────── */
.tab-bar {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 0 0.5rem;
  flex-shrink: 0;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.4rem 0.6rem;
  font-size: 0.75rem;
  color: var(--p-slate-500);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.12s, border-color 0.12s;
  margin-bottom: -1px;
}

.tab-btn:hover {
  color: var(--p-slate-700);
}

.tab-btn.active {
  color: var(--p-indigo-600);
  border-bottom-color: var(--p-indigo-500);
  font-weight: 500;
}

.tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--p-indigo-100);
  color: var(--p-indigo-700);
  border-radius: 999px;
  font-size: 0.6rem;
  font-weight: 600;
  min-width: 1rem;
  height: 1rem;
  padding: 0 0.2rem;
}

/* ── KV editor ───────────────────────────────────────────────────────────── */
.kv-editor {
  padding: 0.5rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.kv-header-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 0.4rem;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--p-slate-400);
  letter-spacing: 0.04em;
  padding: 0 0.1rem;
}

.kv-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 0.4rem;
  align-items: center;
}

.kv-input {
  width: 100%;
  font-size: 0.75rem;
}

.kv-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--p-slate-400);
  padding: 0.15rem 0.25rem;
  border-radius: 0.2rem;
  transition: color 0.12s, background 0.12s;
}

.kv-remove:hover {
  color: var(--p-red-500);
  background: var(--p-red-50);
}

/* ── Body editor ─────────────────────────────────────────────────────────── */
.body-editor {
  display: flex;
  flex-direction: column;
  padding: 0.5rem 0.75rem;
  gap: 0.4rem;
}

.body-type-bar {
  display: flex;
  align-items: center;
}

.body-type-select {
  width: 10rem;
}

.body-textarea {
  width: 100%;
  min-height: 80px;
  max-height: 140px;
  resize: vertical;
  font-family: "JetBrains Mono", "Fira Mono", monospace;
  font-size: 0.75rem;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.3rem;
  background: var(--p-slate-50);
  color: var(--p-slate-800);
  outline: none;
  transition: border-color 0.12s;
}

.body-textarea:focus {
  border-color: var(--p-indigo-400);
}

.body-textarea:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Response meta ───────────────────────────────────────────────────────── */
.response-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
  flex-shrink: 0;
}

.response-duration {
  font-size: 0.72rem;
  color: var(--p-slate-500);
}

/* ── Response content ────────────────────────────────────────────────────── */
.response-content {
  flex: 1;
  overflow: auto;
  min-height: 0;
}

.response-pre {
  font-family: "JetBrains Mono", "Fira Mono", monospace;
  font-size: 0.72rem;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--p-slate-700);
  padding: 0.4rem 0;
  margin: 0;
}

/* ── Response headers table ──────────────────────────────────────────────── */
.header-row {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 0.5rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--p-slate-100);
  font-size: 0.72rem;
}

.header-key {
  font-weight: 500;
  color: var(--p-indigo-700);
  word-break: break-all;
}

.header-value {
  color: var(--p-slate-600);
  word-break: break-all;
}

/* ── Format buttons ──────────────────────────────────────────────────────── */
.fmt-btn {
  background: none;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.25rem;
  font-size: 0.65rem;
  padding: 0.15rem 0.4rem;
  cursor: pointer;
  color: var(--p-slate-500);
  transition: all 0.12s;
}

.fmt-btn:hover {
  background: var(--p-slate-100);
  color: var(--p-slate-700);
}

.fmt-btn.active {
  background: var(--p-indigo-50);
  border-color: var(--p-indigo-300);
  color: var(--p-indigo-700);
}

/* ── Method badges ───────────────────────────────────────────────────────── */
.method-badge {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 0.1rem 0.3rem;
  border-radius: 0.2rem;
  flex-shrink: 0;
}

.method-get    { background: #dcfce7; color: #15803d; }
.method-post   { background: #fef9c3; color: #854d0e; }
.method-put    { background: #dbeafe; color: #1d4ed8; }
.method-patch  { background: #f3e8ff; color: #7e22ce; }
.method-delete { background: #fee2e2; color: #b91c1c; }
.method-other  { background: var(--p-slate-200); color: var(--p-slate-600); }

/* ── Status badges ───────────────────────────────────────────────────────── */
.status-badge {
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.15rem 0.5rem;
  border-radius: 0.25rem;
}

.status-ok           { background: #dcfce7; color: #15803d; }
.status-redirect     { background: #dbeafe; color: #1d4ed8; }
.status-client-error { background: #fef9c3; color: #92400e; }
.status-server-error { background: #fee2e2; color: #b91c1c; }
.status-unknown      { background: var(--p-slate-200); color: var(--p-slate-600); }
</style>
