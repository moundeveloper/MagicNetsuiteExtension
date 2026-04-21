// settingsState.ts
import { onMounted, reactive, ref, watch } from "vue";

export type AiProvider = "puter" | "ollama" | "opencode" | "copilot";
export type CompactionMode = "auto" | "ask";

export interface ShortcutsSettings {
  extensionToggle: string; // fixed, display only
  drawerOpen: string; // configurable, default "ctrl+k"
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
  /** Whether to auto-compact or ask the user first when context limit nears */
  compactionMode: CompactionMode;
  /** Token threshold at which context compaction triggers */
  compactionThreshold: number;
}

const defaultSettings: ShortcutsSettings = {
  extensionToggle: "Alt+Shift+U",
  drawerOpen: "ctrl+k",
  openOnCustomizationPage: true,
  preferredFeatures: [],
  aiProvider: "puter",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  opencodeBaseUrl: "http://localhost:4096",
  opencodeModel: "",
  githubToken: "",
  copilotModel: "gpt-4o",
  compactionMode: "auto",
  compactionThreshold: 80000
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
        settings.openOnCustomizationPage = stored.openOnCustomizationPage ?? defaultSettings.openOnCustomizationPage;
        settings.aiProvider = stored.aiProvider ?? defaultSettings.aiProvider;
        settings.ollamaBaseUrl = stored.ollamaBaseUrl || defaultSettings.ollamaBaseUrl;
        settings.ollamaModel = stored.ollamaModel || defaultSettings.ollamaModel;
        settings.opencodeBaseUrl = stored.opencodeBaseUrl || defaultSettings.opencodeBaseUrl;
        settings.opencodeModel = stored.opencodeModel ?? defaultSettings.opencodeModel;
        settings.githubToken = stored.githubToken ?? defaultSettings.githubToken;
        settings.copilotModel = stored.copilotModel || defaultSettings.copilotModel;
        settings.compactionMode = stored.compactionMode ?? defaultSettings.compactionMode;
        settings.compactionThreshold = stored.compactionThreshold ?? defaultSettings.compactionThreshold;
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
    await chrome.storage.sync.set({ magic_netsuite_settings: JSON.parse(JSON.stringify(settings)) });
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
