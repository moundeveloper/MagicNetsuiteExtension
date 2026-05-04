<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { useSettings } from "../states/settingsState";
import { callApi } from "../utils/api";
import { RequestRoutes } from "../types/request";
import Select from "primevue/select";
import Button from "primevue/button";

const props = defineProps<{ vhOffset: number }>();

const { settings } = useSettings();

// ── MCP Connection status ──

const mcpStatus = ref<"connected" | "disconnected" | "checking">("checking");
let statusPollTimer: ReturnType<typeof setInterval> | null = null;

const checkMcpStatus = async () => {
  try {
    const response = await new Promise<{ status: string }>((resolve) => {
      chrome.runtime.sendMessage({ type: "MCP_STATUS" }, (resp) => {
        resolve(resp ?? { status: "disconnected" });
      });
    });
    mcpStatus.value = response.status === "connected" ? "connected" : "disconnected";
  } catch {
    mcpStatus.value = "disconnected";
  }
};

const connectMcp = async () => {
  mcpStatus.value = "checking";
  try {
    const response = await new Promise<{ status: string }>((resolve) => {
      chrome.runtime.sendMessage({ type: "MCP_CONNECT" }, (resp) => {
        resolve(resp ?? { status: "disconnected" });
      });
    });
    mcpStatus.value = response.status === "connected" ? "connected" : "disconnected";
  } catch {
    mcpStatus.value = "disconnected";
  }
};

const disconnectMcp = async () => {
  mcpStatus.value = "checking";
  try {
    await new Promise<void>((resolve) => {
      chrome.runtime.sendMessage({ type: "MCP_DISCONNECT" }, () => {
        resolve();
      });
    });
    mcpStatus.value = "disconnected";
  } catch {
    mcpStatus.value = "disconnected";
  }
};

// Toggle MCP enabled and connect/disconnect accordingly
const toggleMcpEnabled = async () => {
  if (settings.mcpEnabled) {
    await connectMcp();
  } else {
    await disconnectMcp();
  }
};

// Watch settings.mcpEnabled to trigger connect/disconnect
watch(
  () => settings.mcpEnabled,
  (enabled) => {
    if (enabled) {
      connectMcp();
    } else {
      disconnectMcp();
    }
  }
);

// ── Account fetching ──

interface AccountInfo {
  id: string;
  name: string;
  type: string;
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
    accountsFetchError.value =
      err instanceof Error ? err.message : String(err);
    accountsFetchState.value = "error";
  }
};

const accountOptions = () =>
  accounts.value.map((acc) => ({
    label: `${acc.name} (${acc.id}) [${acc.type}]`,
    value: acc.id
  }));

// ── MCP Tools list ──

const mcpTools = [
  {
    name: "ping",
    description: "Ping the Chrome extension. Returns pong."
  },
  {
    name: "suiteql_search_tables",
    description:
      "Search available SuiteQL tables by keyword. Returns table IDs and labels matching the search term."
  },
  {
    name: "suiteql_get_table_fields",
    description:
      "Get all columns/fields for a specific SuiteQL table. Returns field IDs, labels, and data types."
  },
  {
    name: "suiteql_get_table_joins",
    description:
      "Get available joins/relationships for a specific SuiteQL table."
  },
  {
    name: "suiteql_execute_query",
    description:
      "Execute a SuiteQL query and return the results (limited to 5 rows for preview)."
  },
  {
    name: "suiteql_discover_field_values",
    description:
      "Sample DISTINCT actual values for a specific column in a table."
  }
];

onMounted(() => {
  checkMcpStatus();
  fetchAccounts();
  // Poll status every 5s
  statusPollTimer = setInterval(checkMcpStatus, 5000);
});

onBeforeUnmount(() => {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
});
</script>

<template>
  <div
    :style="{ height: `${vhOffset}vh` }"
    class="flex flex-col gap-4 overflow-y-auto p-2"
  >
    <!-- MCP Connection Section -->
    <div class="mcp-section">
      <h2>MCP Server</h2>
      <p class="section-description">
        The MCP server allows AI assistants (OpenCode, Claude, etc.) to interact
        with your NetSuite account via a WebSocket bridge.
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
            <template v-if="mcpStatus === 'connected'">Connected</template>
            <template v-else-if="mcpStatus === 'checking'">
              <i class="pi pi-spin pi-spinner" /> Checking...
            </template>
            <template v-else>Disconnected</template>
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
            <i :class="settings.mcpEnabled ? 'pi pi-power-off' : 'pi pi-play'" />
            {{ settings.mcpEnabled ? "Disable" : "Enable" }}
          </Button>
        </div>
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
      <h2>Available Tools</h2>
      <p class="section-description">
        These tools are exposed to AI assistants via the MCP protocol.
      </p>

      <div class="tools-list">
        <div v-for="tool in mcpTools" :key="tool.name" class="tool-card">
          <div class="tool-name">
            <i class="pi pi-wrench" />
            <code>{{ tool.name }}</code>
          </div>
          <div class="tool-description">{{ tool.description }}</div>
        </div>
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
        </div>
        <div
          v-for="acc in accounts"
          :key="acc.id"
          class="accounts-row"
          :class="{ active: acc.id === settings.mcpPreferredAccount }"
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
        </div>
      </div>
    </div>
  </div>
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
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
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

.tools-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.tool-card {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.4rem;
  background: var(--surface-card);
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

.col-id code {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.75rem;
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
</style>
