<script setup lang="ts">
import { useRoute } from "vue-router";
import { useFormattedRouteName } from "../composables/useFormattedRouteName";
import { useSettings } from "../states/settingsState";
import { ref } from "vue";
import { InputText } from "primevue";

const { formattedRouteName } = useFormattedRouteName();
const { settings, updateDrawerShortcut } = useSettings();

const drawerShortcutInput = ref(settings.value.drawerOpen);

const handleDrawerShortcutChange = () => {
  updateDrawerShortcut(drawerShortcutInput.value);
};
</script>

<template>
  <h1>{{ formattedRouteName }}</h1>
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
        v-model="drawerShortcutInput"
        @blur="handleDrawerShortcutChange"
        placeholder="e.g., ctrl+k"
      />
    </div>
  </div>
</template>

<style scoped>
h1 {
  font-weight: 600;
  color: var(--text-color);
}

.table-custom {
  flex: 1;
}

.settings-section {
  margin-top: 2rem;
}

.settings-section h2 {
  font-size: 1.5rem;
  margin-bottom: 1rem;
  color: var(--text-color);
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
  color: var(--text-color-secondary);
  font-size: 0.875rem;
}
</style>
