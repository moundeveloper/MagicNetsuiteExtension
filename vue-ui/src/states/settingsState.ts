// settingsState.ts
import { reactive, ref, watch } from "vue";

export type AiProvider = "ollama" | "opencode" | "copilot" | "openrouter";
export type CompactionMode = "auto" | "ask";

export interface ShortcutsSettings {
  extensionToggle: string; // fixed, display only
  drawerOpen: string; // configurable, default "ctrl+k"
  modulesSearch: string; // configurable, default "ctrl+m"
  newDashboardTab: string; // configurable, default "ctrl+alt+n"
  reopenClosedTab: string; // configurable, default "ctrl+alt+t"
  elementScreenshotShortcut: string; // configurable, default "ctrl+shift+s"
  openOnCustomizationPage: boolean;
  dashboardPreviewEnabled: boolean;
  flightRecorderEnabled: boolean;
  preferredFeatures: string[]; // array of route names that are preferred
  // AI provider settings
  aiProvider: AiProvider;
  ollamaBaseUrl: string;
  ollamaModel: string;
  opencodeBaseUrl: string;
  opencodeModel: string;
  // GitHub Copilot
  githubToken: string;
  copilotModel: string;
  // OpenRouter
  openrouterApiKey: string;
  openrouterModel: string;
  /** Whether to auto-compact or ask the user first when context limit nears */
  compactionMode: CompactionMode;
  /** Token threshold at which context compaction triggers */
  compactionThreshold: number;
  /** Preferred NetSuite account ID for MCP server tab selection (e.g. "9937091_SB1") */
  mcpPreferredAccount: string;
  /** Whether the MCP server native messaging bridge is enabled */
  mcpEnabled: boolean;
  /** Names of MCP tools that are disabled and should be hidden from AI clients */
  mcpDisabledTools: string[];
  /** Deployed Suitelet URL used for server-side MCP routing */
  mcpSuiteletDeploymentUrl: string;
  /** Enable extended thinking / reasoning mode for supported models */
  thinkingMode: boolean;
  /** Max thinking token budget — used for Claude extended thinking via Copilot */
  thinkingBudget: number;
  /** Max LLM/tool iterations for the main agent loop */
  agentMainStepLimit: number;
  /** Max LLM/tool iterations for isolated sub-agent/delegated runs */
  agentSubagentStepLimit: number;
}

type SecretSettings = Pick<
  ShortcutsSettings,
  "githubToken" | "openrouterApiKey"
>;

type SyncedSettings = Omit<ShortcutsSettings, keyof SecretSettings>;

type StoredSettingsResult = {
  magic_netsuite_settings?: Omit<Partial<ShortcutsSettings>, "aiProvider"> & {
    aiProvider?: AiProvider | "puter";
  };
};

type StoredSecretSettingsResult = {
  magic_netsuite_secrets?: Partial<SecretSettings>;
};

const SETTINGS_KEY = "magic_netsuite_settings";
const SECRETS_KEY = "magic_netsuite_secrets";
const SAVE_DEBOUNCE_MS = 150;

const defaultSettings: ShortcutsSettings = {
  extensionToggle: "Alt+Shift+U",
  drawerOpen: "ctrl+k",
  modulesSearch: "ctrl+m",
  newDashboardTab: "ctrl+alt+n",
  reopenClosedTab: "ctrl+alt+t",
  elementScreenshotShortcut: "ctrl+shift+s",
  openOnCustomizationPage: true,
  dashboardPreviewEnabled: false,
  flightRecorderEnabled: false,
  preferredFeatures: [],
  aiProvider: "openrouter",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  opencodeBaseUrl: "http://localhost:4096",
  opencodeModel: "",
  githubToken: "",
  copilotModel: "gpt-4o",
  openrouterApiKey: "",
  openrouterModel: "openrouter/free",
  compactionMode: "auto",
  compactionThreshold: 80000,
  mcpPreferredAccount: "",
  mcpEnabled: true,
  mcpDisabledTools: [],
  mcpSuiteletDeploymentUrl: "",
  thinkingMode: false,
  thinkingBudget: 8000,
  agentMainStepLimit: 25,
  agentSubagentStepLimit: 15
};

const settings = reactive<ShortcutsSettings>({ ...defaultSettings });
const isSettingsLoaded = ref(false);
let isLoaded = false;
let loadPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const toPlainSettings = (): ShortcutsSettings =>
  JSON.parse(JSON.stringify(settings)) as ShortcutsSettings;

const toSyncedSettings = (value: ShortcutsSettings): SyncedSettings => {
  const { githubToken: _githubToken, openrouterApiKey: _openrouterApiKey, ...synced } =
    value;
  return synced;
};

const toSecretSettings = (value: ShortcutsSettings): SecretSettings => ({
  githubToken: value.githubToken,
  openrouterApiKey: value.openrouterApiKey
});

const saveSettings = async () => {
  if (!isLoaded) return;
  const plain = toPlainSettings();
  try {
    await Promise.all([
      chrome.storage.sync.set({
        [SETTINGS_KEY]: toSyncedSettings(plain)
      }),
      chrome.storage.local.set({
        [SECRETS_KEY]: toSecretSettings(plain)
      })
    ]);
  } catch {
    // Extension context may have been invalidated (e.g. after extension reload in dev mode).
  }
};

const scheduleSave = () => {
  if (!isLoaded) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveSettings();
  }, SAVE_DEBOUNCE_MS);
};

const loadSettings = async () => {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const [result, secretResult] = await Promise.all([
        chrome.storage.sync.get<StoredSettingsResult>([SETTINGS_KEY]),
        chrome.storage.local.get<StoredSecretSettingsResult>([SECRETS_KEY])
      ]);
      
      if (result.magic_netsuite_settings) {
        const stored = result.magic_netsuite_settings;
        
        settings.preferredFeatures = Array.isArray(stored.preferredFeatures)
          ? [...stored.preferredFeatures]
          : [];
        settings.drawerOpen = stored.drawerOpen || defaultSettings.drawerOpen;
        settings.modulesSearch = stored.modulesSearch || defaultSettings.modulesSearch;
        settings.newDashboardTab =
          stored.newDashboardTab || defaultSettings.newDashboardTab;
        settings.reopenClosedTab =
          stored.reopenClosedTab || defaultSettings.reopenClosedTab;
        settings.elementScreenshotShortcut = stored.elementScreenshotShortcut || defaultSettings.elementScreenshotShortcut;
        settings.openOnCustomizationPage = stored.openOnCustomizationPage ?? defaultSettings.openOnCustomizationPage;
        settings.dashboardPreviewEnabled = stored.dashboardPreviewEnabled ?? defaultSettings.dashboardPreviewEnabled;
        settings.flightRecorderEnabled =
          stored.flightRecorderEnabled ??
          defaultSettings.flightRecorderEnabled;
        settings.aiProvider = stored.aiProvider === "puter" || !stored.aiProvider
          ? defaultSettings.aiProvider
          : stored.aiProvider;
        settings.ollamaBaseUrl = stored.ollamaBaseUrl || defaultSettings.ollamaBaseUrl;
        settings.ollamaModel = stored.ollamaModel || defaultSettings.ollamaModel;
        settings.opencodeBaseUrl = stored.opencodeBaseUrl || defaultSettings.opencodeBaseUrl;
        settings.opencodeModel = stored.opencodeModel ?? defaultSettings.opencodeModel;
        settings.copilotModel = stored.copilotModel || defaultSettings.copilotModel;
        settings.openrouterModel = stored.openrouterModel || defaultSettings.openrouterModel;
        settings.compactionMode = stored.compactionMode ?? defaultSettings.compactionMode;
        settings.compactionThreshold = stored.compactionThreshold ?? defaultSettings.compactionThreshold;
        settings.mcpPreferredAccount = stored.mcpPreferredAccount ?? defaultSettings.mcpPreferredAccount;
        settings.mcpEnabled = stored.mcpEnabled ?? defaultSettings.mcpEnabled;
        settings.mcpDisabledTools = Array.isArray(stored.mcpDisabledTools)
          ? [...stored.mcpDisabledTools]
          : [];
        settings.mcpSuiteletDeploymentUrl =
          stored.mcpSuiteletDeploymentUrl ?? defaultSettings.mcpSuiteletDeploymentUrl;
        settings.thinkingMode = stored.thinkingMode ?? defaultSettings.thinkingMode;
        settings.thinkingBudget = stored.thinkingBudget ?? defaultSettings.thinkingBudget;
        settings.agentMainStepLimit = stored.agentMainStepLimit ?? defaultSettings.agentMainStepLimit;
        settings.agentSubagentStepLimit = stored.agentSubagentStepLimit ?? defaultSettings.agentSubagentStepLimit;
      }

      const stored = result.magic_netsuite_settings;
      const localSecrets = secretResult.magic_netsuite_secrets;
      settings.githubToken =
        localSecrets?.githubToken ??
        stored?.githubToken ??
        defaultSettings.githubToken;
      settings.openrouterApiKey =
        localSecrets?.openrouterApiKey ??
        stored?.openrouterApiKey ??
        defaultSettings.openrouterApiKey;

      if (stored?.githubToken !== undefined || stored?.openrouterApiKey !== undefined) {
        await Promise.all([
          chrome.storage.local.set({
            [SECRETS_KEY]: toSecretSettings(toPlainSettings())
          }),
          chrome.storage.sync.set({
            [SETTINGS_KEY]: toSyncedSettings(toPlainSettings())
          })
        ]);
      }

      isLoaded = true;
      isSettingsLoaded.value = true;
    } catch {
      isLoaded = true;
      isSettingsLoaded.value = true;
    }
  })();
  return loadPromise;
};

watch(settings, scheduleSave, { deep: true });

export function useSettings() {
  void loadSettings();
  return {
    settings,
    isSettingsLoaded
  };
}

export const isFlightRecorderEnabled = () =>
  settings.flightRecorderEnabled === true;

export const setFlightRecorderEnabled = async (enabled: boolean) => {
  settings.flightRecorderEnabled = enabled;
  if (!isLoaded) return;
  await saveSettings();
};
