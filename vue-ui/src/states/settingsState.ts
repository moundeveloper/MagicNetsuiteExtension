// settingsState.ts
import { onMounted, reactive, ref, watch } from "vue";

export type AiProvider = "ollama" | "opencode" | "copilot" | "openrouter";
export type CompactionMode = "auto" | "ask";

export interface ShortcutsSettings {
  extensionToggle: string; // fixed, display only
  drawerOpen: string; // configurable, default "ctrl+k"
  modulesSearch: string; // configurable, default "ctrl+m"
  elementScreenshotShortcut: string; // configurable, default "ctrl+shift+s"
  openOnCustomizationPage: boolean;
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
  /** Enable extended thinking / reasoning mode for supported models */
  thinkingMode: boolean;
  /** Max thinking token budget — used for Claude extended thinking via Copilot */
  thinkingBudget: number;
  /** Max LLM/tool iterations for the main agent loop */
  agentMainStepLimit: number;
  /** Max LLM/tool iterations for isolated sub-agent/delegated runs */
  agentSubagentStepLimit: number;
}

const defaultSettings: ShortcutsSettings = {
  extensionToggle: "Alt+Shift+U",
  drawerOpen: "ctrl+k",
  modulesSearch: "ctrl+m",
  elementScreenshotShortcut: "ctrl+shift+s",
  openOnCustomizationPage: true,
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
  thinkingMode: false,
  thinkingBudget: 8000,
  agentMainStepLimit: 25,
  agentSubagentStepLimit: 15
};

const settings = reactive<ShortcutsSettings>({ ...defaultSettings });
const isSettingsLoaded = ref(false);
let isLoaded = false;

export function useSettings() {
  const loadSettings = async () => {
    try {
      const result = await chrome.storage.sync.get(["magic_netsuite_settings"]);
      
      if (result.magic_netsuite_settings) {
        const stored = result.magic_netsuite_settings;
        
        settings.preferredFeatures = Array.isArray(stored.preferredFeatures)
          ? [...stored.preferredFeatures]
          : [];
        settings.drawerOpen = stored.drawerOpen || defaultSettings.drawerOpen;
        settings.modulesSearch = stored.modulesSearch || defaultSettings.modulesSearch;
        settings.elementScreenshotShortcut = stored.elementScreenshotShortcut || defaultSettings.elementScreenshotShortcut;
        settings.openOnCustomizationPage = stored.openOnCustomizationPage ?? defaultSettings.openOnCustomizationPage;
        settings.aiProvider = stored.aiProvider === "puter" || !stored.aiProvider
          ? defaultSettings.aiProvider
          : stored.aiProvider;
        settings.ollamaBaseUrl = stored.ollamaBaseUrl || defaultSettings.ollamaBaseUrl;
        settings.ollamaModel = stored.ollamaModel || defaultSettings.ollamaModel;
        settings.opencodeBaseUrl = stored.opencodeBaseUrl || defaultSettings.opencodeBaseUrl;
        settings.opencodeModel = stored.opencodeModel ?? defaultSettings.opencodeModel;
        settings.githubToken = stored.githubToken ?? defaultSettings.githubToken;
        settings.copilotModel = stored.copilotModel || defaultSettings.copilotModel;
        settings.openrouterApiKey = stored.openrouterApiKey ?? defaultSettings.openrouterApiKey;
        settings.openrouterModel = stored.openrouterModel || defaultSettings.openrouterModel;
        settings.compactionMode = stored.compactionMode ?? defaultSettings.compactionMode;
        settings.compactionThreshold = stored.compactionThreshold ?? defaultSettings.compactionThreshold;
        settings.mcpPreferredAccount = stored.mcpPreferredAccount ?? defaultSettings.mcpPreferredAccount;
        settings.mcpEnabled = stored.mcpEnabled ?? defaultSettings.mcpEnabled;
        settings.mcpDisabledTools = Array.isArray(stored.mcpDisabledTools)
          ? [...stored.mcpDisabledTools]
          : [];
        settings.thinkingMode = stored.thinkingMode ?? defaultSettings.thinkingMode;
        settings.thinkingBudget = stored.thinkingBudget ?? defaultSettings.thinkingBudget;
        settings.agentMainStepLimit = stored.agentMainStepLimit ?? defaultSettings.agentMainStepLimit;
        settings.agentSubagentStepLimit = stored.agentSubagentStepLimit ?? defaultSettings.agentSubagentStepLimit;
      }
      isLoaded = true;
      isSettingsLoaded.value = true;
    } catch (error) {
      isLoaded = true;
      isSettingsLoaded.value = true;
    }
  };

  const saveSettings = async () => {
    if (!isLoaded) {
      return;
    }
    try {
      await chrome.storage.sync.set({ magic_netsuite_settings: JSON.parse(JSON.stringify(settings)) });
    } catch {
      // Extension context may have been invalidated (e.g. after extension reload in dev mode)
    }
  };

  watch(
    () => settings,
    () => {
      saveSettings();
    },
    { deep: true }
  );

  onMounted(() => {
    loadSettings();
  });

  return {
    settings: settings,
    isSettingsLoaded
  };
}
