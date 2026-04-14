<script setup lang="ts">
import ViewHeader from "../components/ViewHeader.vue";
import { useSettings } from "../states/settingsState";
import { ref, watch } from "vue";
import InputText from "primevue/inputtext";
import Checkbox from "primevue/checkbox";
import Select from "primevue/select";
import Button from "primevue/button";

const { settings } = useSettings();

const providerOptions = [
  { label: "Puter (auto-select model)", value: "puter" },
  { label: "Ollama (local)", value: "ollama" }
];

const compactionModeOptions = [
  { label: "Auto (compact automatically)", value: "auto" },
  { label: "Ask me first", value: "ask" }
];

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

    <!-- Ollama-specific options -->
    <template v-if="settings.aiProvider === 'ollama'">
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
</style>
