<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { useSettings } from "../states/settingsState";
import { callApi } from "../utils/api";
import { RequestRoutes } from "../types/request";
import Select from "primevue/select";
import Button from "primevue/button";
import ToggleSwitch from "primevue/toggleswitch";
import MCard from "../components/universal/card/MCard.vue";

const props = defineProps<{ vhOffset: number }>();

const { settings } = useSettings();

// ── Safe chrome.runtime wrapper ──
// Guards every sendMessage call against "Extension context invalidated" which
// occurs when the extension is reloaded while the side panel is still open.
const safeSendMessage = <T = unknown>(msg: Record<string, unknown>): Promise<T | null> =>
  new Promise((resolve) => {
    try {
      // chrome.runtime.id becomes undefined when the context is invalidated
      if (!chrome.runtime?.id) { resolve(null); return; }
      chrome.runtime.sendMessage(msg, (resp: T) => {
        // Consume lastError to suppress Chrome's "unchecked" console warning
        void chrome.runtime.lastError;
        resolve(resp ?? null);
      });
    } catch {
      resolve(null);
    }
  });

// ── MCP Connection status ──

const mcpStatus = ref<"connected" | "disconnected" | "checking">("checking");
let statusPollTimer: ReturnType<typeof setInterval> | null = null;

interface McpConnectionDetail {
  id: string;
  label: string;
  state: "open" | "closed";
  error?: string | null;
}

interface McpDedicatedTabInfo {
  tabId: number;
  accountId: string;
}

const mcpConnections = ref<McpConnectionDetail[]>([]);
const mcpDedicatedTab = ref<McpDedicatedTabInfo | null>(null);

const nativeBridge = computed(() => mcpConnections.value[0] ?? null);
const nativeBridgeError = computed(() => nativeBridge.value?.error || "");

const checkMcpStatus = async () => {
  try {
    const resp = await safeSendMessage<{
      status: string;
      connections: McpConnectionDetail[];
      dedicatedTab: McpDedicatedTabInfo | null;
    }>({ type: "MCP_STATUS" });
    mcpStatus.value = resp?.status === "connected" ? "connected" : "disconnected";
    mcpConnections.value = resp?.connections ?? [];
    mcpDedicatedTab.value = resp?.dedicatedTab ?? null;
  } catch {
    mcpStatus.value = "disconnected";
    mcpConnections.value = [];
    mcpDedicatedTab.value = null;
  }
};

const connectMcp = async () => {
  mcpStatus.value = "checking";
  try {
    const resp = await safeSendMessage<{
      status: string;
      connections: McpConnectionDetail[];
      dedicatedTab: McpDedicatedTabInfo | null;
    }>({ type: "MCP_CONNECT" });
    mcpStatus.value = resp?.status === "connected" ? "connected" : "disconnected";
    mcpConnections.value = resp?.connections ?? [];
    mcpDedicatedTab.value = resp?.dedicatedTab ?? null;
  } catch {
    mcpStatus.value = "disconnected";
  }
};

const disconnectMcp = async () => {
  mcpStatus.value = "checking";
  try {
    await safeSendMessage({ type: "MCP_DISCONNECT" });
  } catch { /* context may be invalidated — ignore */ }
  mcpStatus.value = "disconnected";
  mcpConnections.value = [];
};

// Watch settings.mcpEnabled to trigger connect/disconnect and manage poll intervals
watch(
  () => settings.mcpEnabled,
  (enabled) => {
    if (enabled) {
      connectMcp();
      if (!statusPollTimer) statusPollTimer = setInterval(checkMcpStatus, 5000);
      if (!usagePollTimer) usagePollTimer = setInterval(fetchUsage, 10000);
    } else {
      disconnectMcp();
      // Stop all polling — no background activity while disabled
      if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; }
      if (usagePollTimer) { clearInterval(usagePollTimer); usagePollTimer = null; }
    }
  }
);

// ── Account fetching ──

interface AccountInfo {
  id: string;
  name: string;
  type: string;
  isCurrent: boolean;
}

interface RoleInfo {
  id: string;
  name: string;
}

const accounts = ref<AccountInfo[]>([]);
const roles = ref<RoleInfo[]>([]);
const accountsFetchState = ref<"idle" | "loading" | "error">("idle");
const accountsFetchError = ref("");

const fetchAccounts = async () => {
  accountsFetchState.value = "loading";
  accountsFetchError.value = "";
  accounts.value = [];
  roles.value = [];

  try {
    const response = await callApi(RequestRoutes.FETCH_ACCOUNTS);

    if (response.status === "error") {
      throw new Error(response.message || "Failed to fetch accounts");
    }

    const data = response.message;

    if (data?.error) {
      throw new Error(data.error);
    }

    accounts.value = data?.accounts ?? [];
    roles.value = data?.roles ?? [];
    accountsFetchState.value = "idle";
  } catch (err) {
    accountsFetchError.value = err instanceof Error ? err.message : String(err);
    accountsFetchState.value = "error";
  }
};

const accountOptions = () =>
  accounts.value.map((acc) => ({
    label: `${acc.name} (${acc.id}) [${acc.type}]${acc.isCurrent ? " - Current" : ""}`,
    value: acc.id
  }));

// ── MCP Tools list ──

interface McpTool {
  name: string;
  description: string;
}

const mcpTools = ref<McpTool[]>([]);
const toolsLoading = ref(false);
const toolFilter = ref("");

const filteredTools = computed(() => {
  const q = toolFilter.value.trim().toLowerCase();
  if (!q) return mcpTools.value;
  return mcpTools.value.filter(
    (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
  );
});

const fetchMcpTools = async () => {
  toolsLoading.value = true;
  try {
    const tools = await safeSendMessage<McpTool[]>({ type: "MCP_GET_TOOLS" });
    mcpTools.value = tools ?? [];
  } catch {
    mcpTools.value = [];
  } finally {
    toolsLoading.value = false;
  }
};

// ── Tool enable / disable ──

const isToolEnabled = (name: string) =>
  !settings.mcpDisabledTools.includes(name);

const enabledCount = computed(() =>
  mcpTools.value.filter((t) => isToolEnabled(t.name)).length
);

const toggleTool = (name: string) => {
  const idx = settings.mcpDisabledTools.indexOf(name);
  if (idx === -1) {
    settings.mcpDisabledTools = [...settings.mcpDisabledTools, name];
  } else {
    settings.mcpDisabledTools = settings.mcpDisabledTools.filter((n) => n !== name);
  }
};

const disableAll = () => {
  settings.mcpDisabledTools = mcpTools.value.map((t) => t.name);
};

const enableAll = () => {
  settings.mcpDisabledTools = [];
};

// ── MCP Usage Tracking ──

interface UsageEntry {
  tool: string;
  timestamp: string;
  success: boolean;
  error: string | null;
}

interface ToolStats {
  calls: number;
  errors: number;
}

const usageLog = ref<UsageEntry[]>([]);
const usageStats = ref<Record<string, ToolStats>>({});
const usageFetching = ref(false);
let usagePollTimer: ReturnType<typeof setInterval> | null = null;

const totalCalls = computed(() => usageLog.value.length);
const totalErrors = computed(() => usageLog.value.filter((e) => !e.success).length);

const fetchUsage = async () => {
  usageFetching.value = true;
  try {
    const resp = await safeSendMessage<{ log: UsageEntry[]; stats: Record<string, ToolStats> }>({ type: "MCP_USAGE" });
    usageLog.value = resp?.log ?? [];
    usageStats.value = resp?.stats ?? {};
  } catch {
    // ignore — context may be invalidated
  } finally {
    usageFetching.value = false;
  }
};

const clearUsage = async () => {
  try {
    await safeSendMessage({ type: "MCP_USAGE_CLEAR" });
  } catch { /* ignore */ }
  usageLog.value = [];
  usageStats.value = {};
};

const formatTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
};

onMounted(() => {
  checkMcpStatus();
  fetchAccounts();
  fetchMcpTools();
  if (settings.mcpEnabled) {
    fetchUsage();
    // Poll status every 5s and usage every 10s only while enabled
    statusPollTimer = setInterval(checkMcpStatus, 5000);
    usagePollTimer = setInterval(fetchUsage, 10000);
  }
});

onBeforeUnmount(() => {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
  if (usagePollTimer) {
    clearInterval(usagePollTimer);
    usagePollTimer = null;
  }
});
</script>

<template>
  <MCard outlined elevated flex direction="column" autoHeight>
    <div
      class="flex flex-col gap-4 overflow-y-auto p-2"
      style="flex: 1; min-height: 0"
    >
      <!-- MCP Connection Section -->
      <div class="mcp-section">
        <h2>MCP Server</h2>
        <p class="section-description">
          The MCP server allows <strong>locally-running</strong> AI assistants
          (OpenCode, Claude Desktop, etc.) to interact with your NetSuite
          account through one Chrome Native Messaging bridge.
        </p>

        <div class="connection-bar">
          <div class="connection-status">
            <span
              class="status-dot"
              :class="{
                connected: mcpStatus === 'connected',
                disconnected: mcpStatus === 'disconnected',
                checking: mcpStatus === 'checking'
              }"
            />
            <span class="status-text">
              <template v-if="mcpStatus === 'connected'">
                Native bridge connected
              </template>
              <template v-else-if="mcpStatus === 'checking'">
                <i class="pi pi-spin pi-spinner" /> Checking...
              </template>
              <template v-else>Native bridge disconnected</template>
            </span>
          </div>

          <div class="connection-actions">
            <Button
              v-if="settings.mcpEnabled"
              size="small"
              severity="secondary"
              outlined
              @click="connectMcp"
              :disabled="mcpStatus === 'checking'"
              title="Reconnect"
            >
              <i class="pi pi-refresh" />
              Reconnect
            </Button>
            <Button
              :size="'small'"
              :severity="settings.mcpEnabled ? 'danger' : 'success'"
              :outlined="settings.mcpEnabled"
              @click="settings.mcpEnabled = !settings.mcpEnabled"
            >
              <i
                :class="settings.mcpEnabled ? 'pi pi-power-off' : 'pi pi-play'"
              />
              {{ settings.mcpEnabled ? "Disable" : "Enable" }}
            </Button>
          </div>
        </div>

        <div v-if="nativeBridge" class="native-bridge-detail">
          <div
            class="connection-item"
            :class="{ 'conn-open': nativeBridge.state === 'open', 'conn-closed': nativeBridge.state === 'closed' }"
            :title="nativeBridge.error ?? ''"
          >
            <span
              class="status-dot small"
              :class="nativeBridge.state === 'open' ? 'connected' : 'disconnected'"
            />
            <code class="conn-label">{{ nativeBridge.label }}</code>
            <span class="conn-state">{{ nativeBridge.state === 'open' ? 'Ready' : 'Closed' }}</span>
          </div>
          <span class="native-bridge-note">MCP clients share this bridge.</span>
        </div>

        <div v-if="nativeBridgeError" class="native-bridge-error">
          <i class="pi pi-exclamation-triangle" />
          <span>{{ nativeBridgeError }}</span>
        </div>

        <!-- Dedicated MCP tab indicator -->
        <div v-if="mcpDedicatedTab" class="dedicated-tab-info">
          <i class="pi pi-bookmark" />
          <span>
            Dedicated MCP tab active (account: <strong>{{ mcpDedicatedTab.accountId }}</strong>)
          </span>
        </div>
      </div>

      <!-- Account Preference Section -->
      <div class="mcp-section">
        <h2>Account Preference</h2>
        <p class="section-description">
          Select which NetSuite account the MCP server should target. The
          extension will find a connected tab matching this account instead of
          using the active tab.
        </p>

        <div class="setting-row">
          <label for="mcp-account">Preferred Account:</label>

          <template v-if="accountsFetchState === 'loading'">
            <span class="fetch-status">
              <i class="pi pi-spin pi-spinner" /> Fetching accounts...
            </span>
          </template>

          <template v-else-if="accountsFetchState === 'error'">
            <span class="fetch-error">
              <i class="pi pi-exclamation-triangle" />
              {{ accountsFetchError }}
            </span>
            <Button
              size="small"
              severity="secondary"
              @click="fetchAccounts"
              title="Retry"
            >
              <i class="pi pi-refresh" />
            </Button>
          </template>

          <template v-else-if="accounts.length > 0">
            <Select
              id="mcp-account"
              v-model="settings.mcpPreferredAccount"
              :options="accountOptions()"
              option-label="label"
              option-value="value"
              placeholder="Select an account (empty = active tab)"
              class="account-select"
              showClear
              filter
            />
            <Button
              size="small"
              severity="secondary"
              @click="fetchAccounts"
              title="Refresh accounts"
            >
              <i class="pi pi-refresh" />
            </Button>
          </template>

          <template v-else>
            <span class="fetch-status">No accounts found</span>
            <Button
              size="small"
              severity="secondary"
              @click="fetchAccounts"
              title="Retry"
            >
              <i class="pi pi-refresh" />
            </Button>
          </template>
        </div>

        <div v-if="settings.mcpPreferredAccount" class="current-preference">
          <i class="pi pi-check-circle" />
          <span>
            MCP will target account:
            <strong>{{ settings.mcpPreferredAccount }}</strong>
          </span>
        </div>
        <div v-else class="current-preference fallback">
          <i class="pi pi-info-circle" />
          <span>No account selected -- MCP will use the active tab</span>
        </div>
      </div>

      <!-- Available Tools Section -->
      <div class="mcp-section">
        <div class="section-header">
          <h2>
            Available Tools
            <span class="tools-enabled-count">
              {{ enabledCount }} / {{ mcpTools.length }} enabled
            </span>
          </h2>
          <div class="tools-header-actions">
            <Button
              size="small"
              severity="secondary"
              outlined
              :disabled="enabledCount === mcpTools.length"
              @click="enableAll"
              title="Enable all tools"
            >
              Enable all
            </Button>
            <Button
              size="small"
              severity="secondary"
              outlined
              :disabled="enabledCount === 0"
              @click="disableAll"
              title="Disable all tools"
            >
              Disable all
            </Button>
            <Button
              size="small"
              severity="secondary"
              outlined
              :loading="toolsLoading"
              @click="fetchMcpTools"
              title="Refresh tools list"
            >
              <i class="pi pi-refresh" />
            </Button>
          </div>
        </div>
        <p class="section-description">
          These tools are exposed to AI assistants via the MCP protocol. Toggle individual tools to control what the AI can access.
        </p>

        <div v-if="toolsLoading" class="fetch-status">
          <i class="pi pi-spin pi-spinner" /> Loading tools...
        </div>
        <template v-else>
          <div class="tools-filter-row">
            <i class="pi pi-search tools-filter-icon" />
            <input
              v-model="toolFilter"
              class="tools-filter-input"
              type="text"
              placeholder="Filter tools…"
            />
            <span v-if="toolFilter" class="tools-filter-count">
              {{ filteredTools.length }} / {{ mcpTools.length }}
            </span>
          </div>
          <div v-if="mcpTools.length === 0" class="usage-empty">
            No tools found. Make sure the MCP server is enabled.
          </div>
          <div v-else-if="filteredTools.length === 0" class="usage-empty">
            No tools match "{{ toolFilter }}".
          </div>
          <div v-else class="tools-list">
            <div
              v-for="tool in filteredTools"
              :key="tool.name"
              class="tool-card"
              :class="{ 'tool-disabled': !isToolEnabled(tool.name) }"
            >
              <div class="tool-card-header">
                <div class="tool-name">
                  <i class="pi pi-wrench" />
                  <code>{{ tool.name }}</code>
                  <span v-if="!isToolEnabled(tool.name)" class="tool-disabled-badge">Disabled</span>
                </div>
                <ToggleSwitch
                  :modelValue="isToolEnabled(tool.name)"
                  @update:modelValue="toggleTool(tool.name)"
                  class="tool-toggle"
                />
              </div>
              <div class="tool-description">{{ tool.description }}</div>
            </div>
          </div>
        </template>
      </div>

      <!-- Usage Tracking Section -->
      <div class="mcp-section">
        <div class="section-header">
          <h2>Tool Usage</h2>
          <Button
            size="small"
            severity="secondary"
            outlined
            :disabled="totalCalls === 0"
            @click="clearUsage"
            title="Clear usage log"
          >
            <i class="pi pi-trash" /> Clear
          </Button>
        </div>
        <p class="section-description">
          Tool calls made by AI agents through the MCP server this session.
        </p>

        <!-- Summary stats -->
        <div class="usage-stats">
          <div class="usage-stat">
            <span class="stat-value">{{ totalCalls }}</span>
            <span class="stat-label">Total calls</span>
          </div>
          <div class="usage-stat error" v-if="totalErrors > 0">
            <span class="stat-value">{{ totalErrors }}</span>
            <span class="stat-label">Errors</span>
          </div>
          <div
            v-for="(stat, toolName) in usageStats"
            :key="toolName"
            class="usage-stat tool-stat"
          >
            <span class="stat-value">{{ stat.calls }}</span>
            <span class="stat-label">
              <code>{{ toolName }}</code>
              <span v-if="stat.errors > 0" class="stat-errors">
                ({{ stat.errors }} err)
              </span>
            </span>
          </div>
        </div>

        <!-- Call log -->
        <div v-if="usageLog.length > 0" class="usage-log">
          <div class="usage-log-header">
            <span class="log-col-time">Time</span>
            <span class="log-col-tool">Tool</span>
            <span class="log-col-status">Status</span>
            <span class="log-col-error">Error</span>
          </div>
          <div
            v-for="(entry, i) in usageLog"
            :key="i"
            class="usage-log-row"
            :class="{ 'log-error': !entry.success }"
          >
            <span class="log-col-time">{{ formatTime(entry.timestamp) }}</span>
            <span class="log-col-tool"><code>{{ entry.tool }}</code></span>
            <span class="log-col-status">
              <span v-if="entry.success" class="log-ok">
                <i class="pi pi-check" /> OK
              </span>
              <span v-else class="log-fail">
                <i class="pi pi-times" /> Fail
              </span>
            </span>
            <span class="log-col-error" :title="entry.error ?? ''">
              {{ entry.error ?? "" }}
            </span>
          </div>
        </div>
        <div v-else class="usage-empty">
          No tool calls recorded yet. AI agents will appear here when they use the MCP tools.
        </div>
      </div>

      <!-- Accounts Table -->
      <div v-if="accounts.length > 0" class="mcp-section">
        <h2>Available Accounts</h2>
        <div class="accounts-table">
          <div class="accounts-header">
            <span class="col-id">Account ID</span>
            <span class="col-name">Name</span>
            <span class="col-type">Type</span>
            <span class="col-status">Status</span>
          </div>
          <div
            v-for="acc in accounts"
            :key="acc.id"
            class="accounts-row"
            :class="{
              active: acc.id === settings.mcpPreferredAccount,
              current: acc.isCurrent
            }"
          >
            <span class="col-id">
              <code>{{ acc.id }}</code>
            </span>
            <span class="col-name">{{ acc.name }}</span>
            <span class="col-type">
              <span class="type-badge" :class="acc.type.toLowerCase()">
                {{ acc.type }}
              </span>
            </span>
            <span class="col-status">
              <span v-if="acc.isCurrent" class="current-badge">
                <i class="pi pi-check-circle" /> Logged in
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  </MCard>
</template>

<style scoped>
.mcp-section {
  margin-bottom: 0.5rem;
}

.mcp-section h2 {
  font-size: 1.2rem;
  margin-bottom: 0.35rem;
}

.section-description {
  font-size: 0.8rem;
  color: var(--p-slate-500);
  margin-bottom: 0.75rem;
  line-height: 1.4;
}

/* ── Connection bar ── */

.connection-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.4rem;
  background: var(--surface-card);
}

.connection-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.connected {
  background: var(--p-green-500);
  box-shadow: 0 0 6px var(--p-green-400);
}

.status-dot.disconnected {
  background: var(--p-red-400);
}

.status-dot.checking {
  background: var(--p-orange-400);
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.status-text {
  font-size: 0.85rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.connection-actions {
  display: flex;
  gap: 0.5rem;
}

/* ── Native bridge detail ── */

.native-bridge-detail {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.5rem;
}

.connection-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.3rem;
  font-size: 0.75rem;
  background: var(--surface-card);
}

.connection-item.conn-open {
  border-color: var(--p-green-300);
  background: var(--p-green-50);
}

.connection-item.conn-closed {
  border-color: var(--p-red-200);
  opacity: 0.6;
}

.status-dot.small {
  width: 7px;
  height: 7px;
}

.conn-label {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.7rem;
  color: var(--p-primary-color);
}

.conn-state {
  font-size: 0.7rem;
  color: var(--p-slate-500);
}

.native-bridge-note {
  font-size: 0.72rem;
  color: var(--p-slate-500);
}

.native-bridge-error {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.5rem;
  padding: 0.35rem 0.6rem;
  border-radius: 0.35rem;
  font-size: 0.75rem;
  background: var(--p-red-50);
  color: var(--p-red-700);
  border-left: 3px solid var(--p-red-400);
}

.native-bridge-error i {
  font-size: 0.7rem;
  flex-shrink: 0;
}

/* ── Dedicated MCP tab ── */

.dedicated-tab-info {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.5rem;
  padding: 0.35rem 0.6rem;
  border-radius: 0.35rem;
  font-size: 0.78rem;
  background: var(--p-blue-50);
  color: var(--p-blue-700);
  border-left: 3px solid var(--p-blue-400);
}

.dedicated-tab-info i {
  font-size: 0.7rem;
}

/* ── Settings rows ── */

.setting-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.setting-row label {
  min-width: 140px;
  font-weight: 500;
  font-size: 0.85rem;
}

.account-select {
  min-width: 280px;
  max-width: 400px;
  flex: 1;
}

.current-preference {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  padding: 0.4rem 0.65rem;
  border-radius: 0.35rem;
  background: var(--p-green-50);
  color: var(--p-green-700);
  border-left: 3px solid var(--p-green-400);
}

.current-preference.fallback {
  background: var(--p-slate-50);
  color: var(--p-slate-600);
  border-left-color: var(--p-slate-300);
}

.fetch-status {
  font-size: 0.8rem;
  color: var(--p-slate-500);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.fetch-error {
  font-size: 0.8rem;
  color: var(--p-red-600);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

/* ── Tools ── */

.tools-filter-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.4rem;
  background: var(--surface-card);
}

.tools-filter-icon {
  font-size: 0.7rem;
  color: var(--p-slate-400);
  flex-shrink: 0;
}

.tools-filter-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 0.8rem;
  color: var(--p-slate-700);
}

.tools-filter-input::placeholder {
  color: var(--p-slate-400);
}

.tools-filter-count {
  font-size: 0.7rem;
  color: var(--p-slate-400);
  flex-shrink: 0;
}

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 320px;
  overflow-y: auto;
}

.tool-card {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.4rem;
  background: var(--surface-card);
  transition: opacity 0.15s;
}

.tool-card.tool-disabled {
  opacity: 0.5;
}

.tool-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.15rem;
}

.tool-name {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 600;
}

.tool-disabled-badge {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.1rem 0.35rem;
  border-radius: 0.25rem;
  background: var(--p-slate-200);
  color: var(--p-slate-500);
}

.tool-toggle {
  flex-shrink: 0;
}

.tool-name {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-weight: 600;
  margin-bottom: 0.15rem;
}

.tool-name code {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.8rem;
  color: var(--p-primary-color);
}

.tool-name i {
  font-size: 0.75rem;
  color: var(--p-slate-400);
}

.tool-description {
  font-size: 0.75rem;
  color: var(--p-slate-600);
  line-height: 1.3;
}

/* ── Accounts table ── */

.accounts-table {
  border: 1px solid var(--p-slate-200);
  border-radius: 0.4rem;
  overflow: hidden;
}

.accounts-header,
.accounts-row {
  display: flex;
  padding: 0.4rem 0.65rem;
  gap: 0.5rem;
}

.accounts-header {
  background: var(--p-slate-100);
  font-weight: 600;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--p-slate-600);
}

.accounts-row {
  border-top: 1px solid var(--p-slate-100);
  font-size: 0.8rem;
}

.accounts-row.active {
  background: var(--p-green-50);
}

.col-id {
  flex: 0 0 130px;
}

.col-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.col-type {
  flex: 0 0 100px;
  text-align: right;
}

.col-status {
  flex: 0 0 90px;
  text-align: right;
}

.col-id code {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.75rem;
}

.current-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--p-green-700);
}

.current-badge i {
  font-size: 0.6rem;
}

.accounts-row.current {
  background: var(--p-green-50);
}

.type-badge {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 1rem;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.type-badge.production {
  background: var(--p-blue-100);
  color: var(--p-blue-700);
}

.type-badge.sandbox {
  background: var(--p-orange-100);
  color: var(--p-orange-700);
}

.type-badge.development {
  background: var(--p-purple-100);
  color: var(--p-purple-700);
}

/* ── Section header with action ── */

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.35rem;
}

.section-header h2 {
  margin-bottom: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tools-enabled-count {
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--p-slate-400);
}

.tools-header-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

/* ── Usage stats ── */

.usage-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.usage-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.4rem 0.75rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.4rem;
  background: var(--surface-card);
  min-width: 60px;
}

.usage-stat.error {
  border-color: var(--p-red-300);
  background: var(--p-red-50);
}

.usage-stat.tool-stat {
  min-width: 0;
  align-items: flex-start;
}

.stat-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--p-primary-color);
  line-height: 1.2;
}

.usage-stat.error .stat-value {
  color: var(--p-red-600);
}

.stat-label {
  font-size: 0.65rem;
  color: var(--p-slate-500);
  text-align: center;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.stat-label code {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.65rem;
  color: var(--p-primary-color);
}

.stat-errors {
  color: var(--p-red-500);
}

/* ── Usage log ── */

.usage-log {
  border: 1px solid var(--p-slate-200);
  border-radius: 0.4rem;
  overflow: hidden;
  font-size: 0.75rem;
  max-height: 220px;
  overflow-y: auto;
}

.usage-log-header {
  display: flex;
  gap: 0.5rem;
  padding: 0.35rem 0.65rem;
  background: var(--p-slate-100);
  font-weight: 600;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--p-slate-600);
  position: sticky;
  top: 0;
}

.usage-log-row {
  display: flex;
  gap: 0.5rem;
  padding: 0.3rem 0.65rem;
  border-top: 1px solid var(--p-slate-100);
  align-items: center;
}

.usage-log-row.log-error {
  background: var(--p-red-50);
}

.log-col-time {
  flex: 0 0 68px;
  color: var(--p-slate-500);
  font-size: 0.7rem;
}

.log-col-tool {
  flex: 0 0 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-col-tool code {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.7rem;
  color: var(--p-primary-color);
}

.log-col-status {
  flex: 0 0 50px;
}

.log-col-error {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--p-red-600);
  font-size: 0.7rem;
}

.log-ok {
  color: var(--p-green-600);
  font-size: 0.7rem;
  display: flex;
  align-items: center;
  gap: 0.2rem;
}

.log-fail {
  color: var(--p-red-600);
  font-size: 0.7rem;
  display: flex;
  align-items: center;
  gap: 0.2rem;
}

.usage-empty {
  font-size: 0.78rem;
  color: var(--p-slate-500);
  padding: 0.6rem 0;
  font-style: italic;
}
</style>
