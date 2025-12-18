// settingsState.ts
import { ref, readonly, onMounted } from "vue";

export interface ShortcutsSettings {
  extensionToggle: string; // fixed, display only
  drawerOpen: string; // configurable, default "ctrl+k"
}

const defaultSettings: ShortcutsSettings = {
  extensionToggle: "Alt+Shift+U",
  drawerOpen: "ctrl+k"
};

const settings = ref<ShortcutsSettings>(defaultSettings);

export function useSettings() {
  const loadSettings = async () => {
    const result = await chrome.storage.sync.get(['shortcuts']);
    if (result.shortcuts) {
      settings.value = { ...defaultSettings, ...result.shortcuts };
    }
  };

  const saveSettings = async () => {
    await chrome.storage.sync.set({ shortcuts: settings.value });
  };

  const updateDrawerShortcut = (newShortcut: string) => {
    settings.value.drawerOpen = newShortcut.toLowerCase();
    saveSettings();
  };

  onMounted(() => {
    loadSettings();
  });

  return {
    settings: readonly(settings),
    updateDrawerShortcut,
    loadSettings,
    saveSettings
  };
}