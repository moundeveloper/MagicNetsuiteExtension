// settingsState.ts
import { onMounted, reactive, watch } from "vue";

export interface ShortcutsSettings {
  extensionToggle: string; // fixed, display only
  drawerOpen: string; // configurable, default "ctrl+k"
  openOnCustomizationPage: boolean;
}

const defaultSettings: ShortcutsSettings = {
  extensionToggle: "Alt+Shift+U",
  drawerOpen: "ctrl+k",
  openOnCustomizationPage: true,
};

const settings = reactive<ShortcutsSettings>(defaultSettings);

export function useSettings() {
  const loadSettings = async () => {
    const result = await chrome.storage.sync.get(["magic_netsuite_settings"]);
    if (result.magic_netsuite_settings) {
      Object.assign(settings, {
        ...defaultSettings,
        ...result.magic_netsuite_settings,
      });
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
    { deep: true },
  );

  onMounted(() => {
    loadSettings();
  });

  return {
    settings: settings,
  };
}
