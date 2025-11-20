<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Button, Checkbox } from "primevue";
import TagSelector from "../components/TagSelector.vue";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";

const loading = ref(false);
const props = defineProps<{
  vhOffset: number;
}>();

// Example tag data
const availableTags = [
  { id: 1, label: "Web Development" },
  { id: 2, label: "API Development" },
  { id: 3, label: "Cloud Computing" },
  { id: 4, label: "UX Design" },
  { id: 5, label: "Team Management" },
  { id: 6, label: "Quality Assurance" },
  { id: 7, label: "Data Analysis" },
  { id: 8, label: "Cybersecurity" },
  { id: 9, label: "Networking" },
  { id: 10, label: "Database Administration" },
];

// Tag groups (each independent)
const whitelist = ref<{ id: string | number; label: string }[]>([]);
const blacklist = ref<{ id: string | number; label: string }[]>([]);
const sublistWhitelist = ref<{ id: string | number; label: string }[]>([]);
const sublistBlacklist = ref<{ id: string | number; label: string }[]>([]);

// Export options
const exportConfig = ref<string[]>(["FieldID", "Text"]);

const getCustomRecordUrl = async (recordId: number) => {
  const response = await callApi(RequestRoutes.CUSTOM_RECORD_URL, { recordId });
  if (!response) return;
  const { message: url } = response as ApiResponse;
  window.open(url, "_blank");
};

const exportRecord = () => {
  console.log("Export with config:", exportConfig.value);
  const data = {
    name: "Alice",
    age: 30,
    tags: ["vue", "javascript", "frontend"],
  };

  // Convert to JSON string
  const jsonString = JSON.stringify(data, null, 2);

  // Create a Blob (file-like object)
  const blob = new Blob([jsonString], { type: "application/json" });

  // Create a temporary download link
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "record.json";
  link.click();

  // Cleanup
  URL.revokeObjectURL(url);
};

onMounted(async () => {
  loading.value = true;
  loading.value = false;
});
</script>

<template>
  <header class="flex justify-between items-center mb-4">
    <h1 class="text-2xl font-semibold tracking-wide text-slate-700">
      ::EXPORT-RECORD
    </h1>
    <Button
      label="Export"
      icon="pi pi-download"
      class="bg-[var(--p-slate-500)] text-white hover:opacity-90 transition w-fit"
      @click="exportRecord"
    />
  </header>

  <!-- Export Config Section -->
  <section class="card-section">
    <h2 class="section-title">Include Fields</h2>
    <div class="flex flex-wrap gap-4">
      <div
        v-for="(option, idx) in ['FieldID', 'FieldName', 'Text', 'Value']"
        :key="idx"
        class="flex items-center gap-2"
      >
        <Checkbox
          v-model="exportConfig"
          :inputId="`config-${idx}`"
          :value="option"
        />
        <label
          :for="`config-${idx}`"
          class="text-sm font-medium text-slate-700"
        >
          {{ option }}
        </label>
      </div>
    </div>
  </section>

  <!-- Tag Filters -->
  <section
    class="tag-sections"
    :style="{ height: `${vhOffset}vh` }"
    data-ignore
  >
    <div class="tag-card">
      <h2 class="section-title">Field Whitelist</h2>
      <TagSelector
        v-model="whitelist"
        :availableTags="availableTags"
        :tagName="'Whitelist'"
      />
    </div>

    <div class="tag-card">
      <h2 class="section-title">Field Blacklist</h2>
      <TagSelector
        v-model="blacklist"
        :availableTags="availableTags"
        :tagName="'Blacklist'"
      />
    </div>

    <div class="tag-card">
      <h2 class="section-title">Sublist Field Whitelist</h2>
      <TagSelector
        v-model="sublistWhitelist"
        :availableTags="availableTags"
        :tagName="'Whitelist'"
      />
    </div>

    <div class="tag-card">
      <h2 class="section-title">Sublist Field Blacklist</h2>
      <TagSelector
        v-model="sublistBlacklist"
        :availableTags="availableTags"
        :tagName="'Blacklist'"
      />
    </div>
  </section>
</template>

<style scoped>
.card-section {
  background: white;
  padding: 1.5rem;
  border-radius: 1rem;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #1e293b;
}

.tag-sections {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: auto;
  padding: 0.5rem;
}

.tag-card {
  background: white;
  padding: 1.25rem;
  border-radius: 1rem;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
</style>
