// settingsState.ts
import { onMounted, reactive, ref, watch } from "vue";

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
