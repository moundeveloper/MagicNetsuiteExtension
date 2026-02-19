// settingsState.ts
import { onMounted, reactive, watch } from "vue";

export interface ShortcutsSettings {
  extensionToggle: string; // fixed, display only
  drawerOpen: string; // configurable, default "ctrl+k"
  openOnCustomizationPage: boolean;
  preferredFeatures: string[]; // array of route names that are preferred
}

const defaultSettings: ShortcutsSettings = {
  extensionToggle: "Alt+Shift+U",
  drawerOpen: "ctrl+k",
  openOnCustomizationPage: true,
  preferredFeatures: []
};

const settings = reactive<ShortcutsSettings>(defaultSettings);

export function useSettings() {
  const loadSettings = async () => {
    try {
      console.log("[loadSettings]");
      const result = await chrome.storage.sync.get(["magic_netsuite_settings"]);
      if (result.magic_netsuite_settings) {
        Object.assign(settings, {
          ...defaultSettings,
          ...result.magic_netsuite_settings
        });
      }
    } catch (error) {
      console.log("[loadSettings] error", "Storage not available");
    }
  };

  const saveSettings = async () => {
    console.log("[saveSettings]", settings);
    await chrome.storage.sync.set({ magic_netsuite_settings: settings });
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
    settings: settings
  };
}
