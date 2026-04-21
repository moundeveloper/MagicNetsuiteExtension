<script setup lang="ts">
import ViewHeader from "../components/ViewHeader.vue";
import { useSettings } from "../states/settingsState";
import { ref, watch } from "vue";
import InputText from "primevue/inputtext";
import Checkbox from "primevue/checkbox";
import Select from "primevue/select";
import Button from "primevue/button";
import { COPILOT_CLIENT_ID, fetchCopilotModels } from "../composables/useAiProvider";

const { settings } = useSettings();

const providerOptions = [
  { label: "Puter (auto-select model)", value: "puter" },
  { label: "Ollama (local)", value: "ollama" },
  { label: "OpenCode (opencode serve)", value: "opencode" },
  { label: "GitHub Copilot", value: "copilot" }
];

const compactionModeOptions = [
  { label: "Auto (compact automatically)", value: "auto" },
  { label: "Ask me first", value: "ask" }
];

// ── GitHub Copilot device auth flow ──

type CopilotAuthStep = "idle" | "polling" | "done" | "error";

const copilotAuthStep = ref<CopilotAuthStep>("idle");
const copilotDeviceCode = ref("");
const copilotUserCode = ref("");
const copilotVerificationUrl = ref("");
const copilotAuthError = ref("");

const copilotModels = ref<Array<{ id: string; name: string }>>([]);
const copilotModelsFetchState = ref<"idle" | "loading" | "error">("idle");
const copilotModelsFetchError = ref("");

let pollTimer: ReturnType<typeof setTimeout> | null = null;

const stopPolling = () => {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
};

const startCopilotAuth = async () => {
  stopPolling();
  copilotAuthStep.value = "polling";
  copilotAuthError.value = "";

  try {
    const res = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        scope: "read:user"
      })
    });

    if (!res.ok) throw new Error(`GitHub device code request failed (${res.status})`);

    const data = (await res.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      interval: number;
      expires_in: number;
    };

    copilotDeviceCode.value = data.device_code;
    copilotUserCode.value = data.user_code;
    copilotVerificationUrl.value = data.verification_uri;

    const intervalMs = (data.interval ?? 5) * 1000;
    const expiresAt = Date.now() + data.expires_in * 1000;

    const poll = async () => {
      if (Date.now() > expiresAt) {
        copilotAuthStep.value = "error";
        copilotAuthError.value = "Device code expired. Please try again.";
        return;
      }

      try {
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            client_id: COPILOT_CLIENT_ID,
            device_code: copilotDeviceCode.value,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code"
          })
        });

        const tokenData = (await tokenRes.json()) as {
          access_token?: string;
          error?: string;
        };

        if (tokenData.access_token) {
          settings.githubToken = tokenData.access_token;
          copilotAuthStep.value = "done";
          fetchCopilotModelList();
          return;
        }

        if (tokenData.error === "authorization_pending" || tokenData.error === "slow_down") {
          pollTimer = setTimeout(poll, intervalMs);
          return;
        }

        throw new Error(tokenData.error ?? "Unknown error during token exchange");
      } catch (err) {
        copilotAuthStep.value = "error";
        copilotAuthError.value = err instanceof Error ? err.message : String(err);
      }
    };

    pollTimer = setTimeout(poll, intervalMs);
  } catch (err) {
    copilotAuthStep.value = "error";
    copilotAuthError.value = err instanceof Error ? err.message : String(err);
  }
};

const disconnectCopilot = () => {
  stopPolling();
  settings.githubToken = "";
  settings.copilotModel = "gpt-4o";
  copilotAuthStep.value = "idle";
  copilotModels.value = [];
};

const copyUserCode = () => {
  navigator.clipboard.writeText(copilotUserCode.value).catch(() => {});
};

const fetchCopilotModelList = async () => {
  if (!settings.githubToken) return;
  copilotModelsFetchState.value = "loading";
  copilotModelsFetchError.value = "";

  try {
    const models = await fetchCopilotModels(settings.githubToken);
    copilotModels.value = models;
    copilotModelsFetchState.value = "idle";

    if (!settings.copilotModel && models.length > 0) {
      const firstModel = models[0];
      if (firstModel) settings.copilotModel = firstModel.id;
    }
  } catch (err) {
    copilotModelsFetchError.value = err instanceof Error ? err.message : String(err);
    copilotModelsFetchState.value = "error";
  }
};

// Auto-fetch models when switching to copilot with an existing token
watch(
  () => settings.aiProvider,
  (provider) => {
    if (provider === "copilot" && settings.githubToken && copilotModels.value.length === 0) {
      fetchCopilotModelList();
    }
  },
  { immediate: true }
);

// ── OpenCode model fetching ──

interface OpenCodeModel {
  label: string;
  value: string; // "providerID/modelID"
}

const opencodeModels = ref<OpenCodeModel[]>([]);
const opencodeFetchState = ref<"idle" | "loading" | "error">("idle");
const opencodeFetchError = ref("");

const fetchOpenCodeModels = async () => {
  const baseUrl = settings.opencodeBaseUrl || "http://localhost:4096";
  opencodeFetchState.value = "loading";
  opencodeFetchError.value = "";
  opencodeModels.value = [];

  try {
    const res = await fetch(`${baseUrl}/provider`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as Record<string, unknown>;

    // `connected` may be an array of IDs or absent — build a Set defensively
    const connectedRaw = data.connected;
    const connected = new Set<string>(
      Array.isArray(connectedRaw) ? (connectedRaw as string[]) : []
    );

    // `all` may be an array or an object keyed by provider ID
    const allRaw = data.all;
    const providerList: Array<{ id: string; name?: string; models?: unknown }> =
      Array.isArray(allRaw)
        ? (allRaw as Array<{ id: string; name?: string; models?: unknown }>)
        : Object.entries(allRaw as Record<string, unknown>).map(([id, v]) => ({
            id,
            ...((v as object) ?? {})
          }));

    const toModelArray = (
      raw: unknown,
      _providerId: string
    ): Array<{ id: string; name?: string }> => {
      if (Array.isArray(raw)) {
        return raw as Array<{ id: string; name?: string }>;
      }
      if (raw && typeof raw === "object") {
        return Object.entries(raw as Record<string, unknown>).map(([id, v]) => ({
          id,
          name: (v as { name?: string })?.name ?? id,
          ...(typeof v === "object" && v !== null ? (v as object) : {})
        }));
      }
      return [];
    };

    const models: OpenCodeModel[] = [];
    for (const provider of providerList) {
      // If no connected list is present, show all providers
      if (connected.size > 0 && !connected.has(provider.id)) continue;
      const providerLabel = provider.name ?? provider.id;
      for (const model of toModelArray(provider.models, provider.id)) {
        models.push({
          label: `${providerLabel} / ${model.name ?? model.id}`,
          value: `${provider.id}/${model.id}`
        });
      }
    }

    opencodeModels.value = models;
    opencodeFetchState.value = "idle";

    // Auto-select first model if none chosen yet
    const firstModel = models[0];
    if (!settings.opencodeModel && firstModel) {
      settings.opencodeModel = firstModel.value;
    }
  } catch (err) {
    opencodeFetchError.value = err instanceof Error ? err.message : String(err);
    opencodeFetchState.value = "error";
  }
};

// Auto-fetch when switching to opencode provider
watch(
  () => settings.aiProvider,
  (provider) => {
    if (provider === "opencode" && opencodeModels.value.length === 0) {
      fetchOpenCodeModels();
    }
  },
  { immediate: true }
);

// Re-fetch when base URL changes (debounced)
let opencodeUrlDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => settings.opencodeBaseUrl,
  () => {
    if (settings.aiProvider !== "opencode") return;
    if (opencodeUrlDebounceTimer) clearTimeout(opencodeUrlDebounceTimer);
    opencodeUrlDebounceTimer = setTimeout(() => {
      fetchOpenCodeModels();
    }, 600);
  }
);

// ── Ollama model fetching ──

interface OllamaModel {
  name: string;
  model: string;
  details: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

const ollamaModels = ref<OllamaModel[]>([]);
const ollamaFetchState = ref<"idle" | "loading" | "error">("idle");
const ollamaFetchError = ref("");

const fetchOllamaModels = async () => {
  const baseUrl = settings.ollamaBaseUrl || "http://localhost:11434";
  ollamaFetchState.value = "loading";
  ollamaFetchError.value = "";
  ollamaModels.value = [];

  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const data = (await res.json()) as { models: OllamaModel[] };
    ollamaModels.value = data.models ?? [];
    ollamaFetchState.value = "idle";
  } catch (err) {
    ollamaFetchError.value = err instanceof Error ? err.message : String(err);
    ollamaFetchState.value = "error";
  }
};

// Auto-fetch when switching to ollama provider
watch(
  () => settings.aiProvider,
  (provider) => {
    if (provider === "ollama" && ollamaModels.value.length === 0) {
      fetchOllamaModels();
    }
  },
  { immediate: true }
);

// Re-fetch when base URL changes (debounced)
let urlDebounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => settings.ollamaBaseUrl,
  () => {
    if (settings.aiProvider !== "ollama") return;
    if (urlDebounceTimer) clearTimeout(urlDebounceTimer);
    urlDebounceTimer = setTimeout(() => {
      fetchOllamaModels();
    }, 600);
  }
);

const modelLabel = (m: OllamaModel) => {
  const size = m.details?.parameter_size ?? "";
  const quant = m.details?.quantization_level ?? "";
  const tag = [size, quant].filter(Boolean).join(" · ");
  return tag ? `${m.name}  (${tag})` : m.name;
};
</script>

<template>
  <ViewHeader />

  <!-- Shortcuts section -->
  <div class="settings-section">
    <h2>Shortcuts</h2>
    <div class="shortcut-item">
      <label for="extension-toggle">Toggle Extension:</label>
      <span>{{ settings.extensionToggle }}</span>
      <small>(Fixed, change in Chrome extensions settings)</small>
    </div>
    <div class="shortcut-item">
      <label for="drawer-open">Open Navigation Drawer:</label>
      <InputText
        id="drawer-open"
        v-model="settings.drawerOpen"
        placeholder="e.g., ctrl+k"
      />
    </div>
    <div class="shortcut-item">
      <label for="customization-open">Open On Customization Page:</label>
      <Checkbox
        id="customization-open"
        v-model="settings.openOnCustomizationPage"
        binary
      />
    </div>
  </div>

  <!-- AI Provider section -->
  <div class="settings-section">
    <h2>AI Provider</h2>

    <div class="shortcut-item">
      <label for="ai-provider">Provider:</label>
      <Select
        id="ai-provider"
        v-model="settings.aiProvider"
        :options="providerOptions"
        option-label="label"
        option-value="value"
        placeholder="Select provider"
        class="provider-select"
      />
    </div>

    <div class="shortcut-item">
      <label for="compaction-mode">Context Compaction:</label>
      <Select
        id="compaction-mode"
        v-model="settings.compactionMode"
        :options="compactionModeOptions"
        option-label="label"
        option-value="value"
        placeholder="Select mode"
        class="provider-select"
      />
    </div>

    <div class="shortcut-item">
      <label for="compaction-threshold">Compaction Threshold (tokens):</label>
      <InputText
        id="compaction-threshold"
        :model-value="String(settings.compactionThreshold)"
        @update:model-value="(v: string | undefined) => { const n = parseInt(v ?? '', 10); if (!isNaN(n) && n > 0) settings.compactionThreshold = n; }"
        placeholder="e.g., 80000"
        class="threshold-input"
      />
    </div>

    <!-- GitHub Copilot options -->
    <template v-if="settings.aiProvider === 'copilot'">

      <!-- Already connected -->
      <template v-if="settings.githubToken">
        <div class="shortcut-item">
          <label>Status:</label>
          <span class="auth-connected">
            <i class="pi pi-check-circle" /> Connected to GitHub
          </span>
          <Button size="small" severity="danger" outlined @click="disconnectCopilot">
            Disconnect
          </Button>
        </div>

        <!-- Model selector -->
        <div class="shortcut-item">
          <label for="copilot-model">Model:</label>

          <template v-if="copilotModelsFetchState === 'loading'">
            <span class="fetch-status">
              <i class="pi pi-spin pi-spinner" /> Fetching models…
            </span>
          </template>

          <template v-else-if="copilotModelsFetchState === 'error'">
            <span class="fetch-error">
              <i class="pi pi-exclamation-triangle" /> {{ copilotModelsFetchError }}
            </span>
            <InputText
              id="copilot-model"
              v-model="settings.copilotModel"
              placeholder="e.g., gpt-4o"
            />
          </template>

          <template v-else-if="copilotModels.length > 0">
            <Select
              id="copilot-model"
              v-model="settings.copilotModel"
              :options="copilotModels"
              option-label="name"
              option-value="id"
              placeholder="Select a model"
              class="model-select"
              filter
            />
          </template>

          <template v-else>
            <InputText
              id="copilot-model"
              v-model="settings.copilotModel"
              placeholder="e.g., gpt-4o"
            />
            <Button
              size="small"
              severity="secondary"
              :loading="false"
              @click="fetchCopilotModelList"
              title="Fetch model list"
            >
              <i class="pi pi-refresh" />
            </Button>
          </template>
        </div>
      </template>

      <!-- Not connected — device auth flow -->
      <template v-else>
        <template v-if="copilotAuthStep === 'idle' || copilotAuthStep === 'error'">
          <div class="shortcut-item">
            <label>Status:</label>
            <span class="auth-disconnected">
              <i class="pi pi-times-circle" /> Not connected
            </span>
            <Button size="small" @click="startCopilotAuth">
              Connect with GitHub
            </Button>
          </div>
          <p v-if="copilotAuthStep === 'error'" class="fetch-error" style="margin-bottom:1rem">
            <i class="pi pi-exclamation-triangle" /> {{ copilotAuthError }}
          </p>
        </template>

        <template v-else-if="copilotAuthStep === 'polling'">
          <div class="device-auth-box">
            <p class="device-auth-instruction">
              1. Open
              <a :href="copilotVerificationUrl" target="_blank">{{ copilotVerificationUrl }}</a>
              in your browser
            </p>
            <p class="device-auth-instruction">2. Enter this code:</p>
            <div class="device-code-row">
              <span class="device-code">{{ copilotUserCode }}</span>
              <Button size="small" severity="secondary" outlined @click="copyUserCode" title="Copy code">
                <i class="pi pi-copy" />
              </Button>
            </div>
            <p class="fetch-status" style="margin-top:0.5rem">
              <i class="pi pi-spin pi-spinner" /> Waiting for authorization…
            </p>
            <Button
              size="small"
              severity="secondary"
              outlined
              style="margin-top:0.5rem"
              @click="() => { stopPolling(); copilotAuthStep = 'idle'; }"
            >
              Cancel
            </Button>
          </div>
        </template>
      </template>

      <p class="provider-hint">
        Uses your GitHub Copilot subscription directly — no OpenCode required.
        Requires an active
        <a href="https://github.com/features/copilot" target="_blank">GitHub Copilot</a>
        subscription.
      </p>
    </template>

    <!-- Ollama-specific options -->
    <template v-else-if="settings.aiProvider === 'ollama'">
      <div class="shortcut-item">
        <label for="ollama-url">Ollama Base URL:</label>
        <InputText
          id="ollama-url"
          v-model="settings.ollamaBaseUrl"
          placeholder="http://localhost:11434"
          class="url-input"
        />
        <Button
          size="small"
          severity="secondary"
          :loading="ollamaFetchState === 'loading'"
          @click="fetchOllamaModels"
          title="Refresh model list"
        >
          <i class="pi pi-refresh" />
        </Button>
      </div>

      <!-- Model selector -->
      <div class="shortcut-item">
        <label for="ollama-model">Model:</label>

        <template v-if="ollamaFetchState === 'loading'">
          <span class="fetch-status">
            <i class="pi pi-spin pi-spinner" /> Fetching models…
          </span>
        </template>

        <template v-else-if="ollamaFetchState === 'error'">
          <span class="fetch-error">
            <i class="pi pi-exclamation-triangle" /> {{ ollamaFetchError }}
          </span>
          <!-- Fall back to free-text input -->
          <InputText
            id="ollama-model"
            v-model="settings.ollamaModel"
            placeholder="e.g., llama3.2"
          />
        </template>

        <template v-else-if="ollamaModels.length > 0">
          <Select
            id="ollama-model"
            v-model="settings.ollamaModel"
            :options="ollamaModels"
            :option-label="modelLabel"
            option-value="name"
            placeholder="Select a model"
            class="model-select"
            filter
          />
        </template>

        <template v-else>
          <!-- Endpoint reachable but returned no models -->
          <InputText
            id="ollama-model"
            v-model="settings.ollamaModel"
            placeholder="No models found — type manually"
          />
        </template>
      </div>

      <p class="provider-hint">
        Tool calling requires a model that supports it (e.g.
        <code>llama3.1</code>, <code>qwen2.5-coder</code>,
        <code>mistral-nemo</code>). this command is required to open ollama
        locally:
        <code
          >[System.Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*",
          "User")</code
        >
      </p>
    </template>

    <template v-else-if="settings.aiProvider === 'puter'">
      <p class="provider-hint">
        Puter automatically selects the best available model. No API key
        required.
      </p>
    </template>

    <!-- OpenCode server options -->
    <template v-else-if="settings.aiProvider === 'opencode'">
      <div class="shortcut-item">
        <label for="opencode-url">OpenCode Server URL:</label>
        <InputText
          id="opencode-url"
          v-model="settings.opencodeBaseUrl"
          placeholder="http://localhost:4096"
          class="url-input"
        />
        <Button
          size="small"
          severity="secondary"
          :loading="opencodeFetchState === 'loading'"
          @click="fetchOpenCodeModels"
          title="Refresh model list"
        >
          <i class="pi pi-refresh" />
        </Button>
      </div>

      <!-- Model selector -->
      <div class="shortcut-item">
        <label for="opencode-model">Model:</label>

        <template v-if="opencodeFetchState === 'loading'">
          <span class="fetch-status">
            <i class="pi pi-spin pi-spinner" /> Fetching models…
          </span>
        </template>

        <template v-else-if="opencodeFetchState === 'error'">
          <span class="fetch-error">
            <i class="pi pi-exclamation-triangle" /> {{ opencodeFetchError }}
          </span>
          <InputText
            id="opencode-model"
            v-model="settings.opencodeModel"
            placeholder="e.g., github-copilot/claude-sonnet-4.6"
          />
        </template>

        <template v-else-if="opencodeModels.length > 0">
          <Select
            id="opencode-model"
            v-model="settings.opencodeModel"
            :options="opencodeModels"
            option-label="label"
            option-value="value"
            placeholder="Select a model"
            class="model-select"
            filter
          />
        </template>

        <template v-else>
          <InputText
            id="opencode-model"
            v-model="settings.opencodeModel"
            placeholder="No models found — type manually (providerID/modelID)"
          />
        </template>
      </div>

      <p class="provider-hint">
        Start a local server with <code>opencode serve</code> (default port 4096).
        Only connected providers and their models are shown.
      </p>
    </template>
  </div>
</template>

<style scoped>
.settings-section {
  margin-top: 2rem;
}

.settings-section h2 {
  font-size: 1.5rem;
  margin-bottom: 1rem;
}

.shortcut-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.shortcut-item label {
  min-width: 200px;
  font-weight: 500;
}

.shortcut-item span {
  font-family: monospace;
  background: var(--surface-section);
  padding: 0.5rem;
  border-radius: 0.25rem;
}

.shortcut-item small {
  font-size: 0.875rem;
}

.provider-select {
  min-width: 220px;
}

.url-input {
  flex: 1;
  max-width: 360px;
}

.threshold-input {
  max-width: 140px;
}

.model-select {
  min-width: 280px;
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

.auth-connected {
  font-size: 0.85rem;
  color: var(--p-green-600);
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  padding: 0;
}

.auth-disconnected {
  font-size: 0.85rem;
  color: var(--p-slate-500);
  display: flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  padding: 0;
}

.device-auth-box {
  margin-bottom: 1rem;
  padding: 1rem;
  background: var(--surface-section);
  border-radius: 0.5rem;
  border: 1px solid var(--p-slate-200);
}

.device-auth-instruction {
  margin: 0 0 0.5rem 0;
  font-size: 0.9rem;
}

.device-auth-instruction a {
  color: var(--p-primary-color);
}

.device-code-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.device-code {
  font-family: "JetBrains Mono", monospace;
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  background: var(--p-slate-100);
  padding: 0.4rem 0.8rem;
  border-radius: 0.35rem;
  color: var(--p-slate-900);
}

.provider-hint {
  font-size: 0.8rem;
  color: var(--p-slate-500);
  margin: 0 0 1rem 0;
  padding: 0.5rem 0.75rem;
  background: var(--p-slate-50);
  border-left: 3px solid var(--p-slate-300);
  border-radius: 0 0.25rem 0.25rem 0;
}

.provider-hint code {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.775rem;
  background: var(--p-slate-200);
  padding: 1px 4px;
  border-radius: 3px;
}

.provider-hint a {
  color: var(--p-primary-color);
}
</style>
