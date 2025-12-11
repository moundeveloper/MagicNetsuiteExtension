<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { Button, Checkbox, Panel } from "primevue";
import TagSelector from "../components/TagSelector.vue";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";

const loading = ref(false);
const props = defineProps<{
  vhOffset: number;
}>();

// Field data structures
const bodyFields = ref<{ id: string; label: string }[]>([]);
const sublists = ref<{ id: string; label: string }[]>([]);
const sublistFieldsMap = ref<Record<string, { id: string; label: string }[]>>(
  {}
);

// Body field filters
const bodyWhitelist = ref<{ id: string; label: string }[]>([]);
const bodyBlacklist = ref<{ id: string; label: string }[]>([]);

// Sublist filters
const sublistWhitelist = ref<{ id: string; label: string }[]>([]);
const sublistBlacklist = ref<{ id: string; label: string }[]>([]);

// Sublist field filters (per sublist)
const sublistFieldWhitelists = ref<
  Record<string, { id: string; label: string }[]>
>({});
const sublistFieldBlacklists = ref<
  Record<string, { id: string; label: string }[]>
>({});

// Export options
const exportConfig = ref<string[]>(["fieldId", "fieldName", "text", "value"]);

const exportRecord = async () => {
  console.log("Exporting with config...");

  const config: any = {
    include: exportConfig.value.length > 0 ? exportConfig.value : null,
  };

  // Body field filters
  if (bodyWhitelist.value.length > 0) {
    config.whiteListFields = bodyWhitelist.value.map((f) => f.id);
  }
  if (bodyBlacklist.value.length > 0) {
    config.blackListFields = bodyBlacklist.value.map((f) => f.id);
  }

  // Sublist filters
  if (sublistWhitelist.value.length > 0) {
    config.whiteListSublists = sublistWhitelist.value.map((s) => s.id);
  }
  if (sublistBlacklist.value.length > 0) {
    config.blackListSublists = sublistBlacklist.value.map((s) => s.id);
  }

  // Aggregate sublist field filters from all sublists
  const allWhitelistFields = new Set<string>();
  const allBlacklistFields = new Set<string>();

  for (const fields of Object.values(sublistFieldWhitelists.value)) {
    fields.forEach((f) => allWhitelistFields.add(f.id));
  }
  for (const fields of Object.values(sublistFieldBlacklists.value)) {
    fields.forEach((f) => allBlacklistFields.add(f.id));
  }

  if (allWhitelistFields.size > 0) {
    config.whiteListSublistFields = Array.from(allWhitelistFields);
  }
  if (allBlacklistFields.size > 0) {
    config.blackListSublistFields = Array.from(allBlacklistFields);
  }

  console.log("Final config:", config);

  // Call API with config
  const response = await callApi(RequestRoutes.EXPORT_RECORD, { config });

  if (!response) return;

  const { message: data } = response as ApiResponse;

  // Convert to JSON string and download
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "record-export.json";
  link.click();
  URL.revokeObjectURL(url);
};

const loadFields = async () => {
  console.log("Loading fields...");

  const { message: fields } = await callApi(RequestRoutes.EXPORT_RECORD, {
    config: {
      include: ["fieldId", "fieldName"],
    },
  });

  const { body, sublists: sublistData } = fields;

  type FieldInfo = {
    fieldId: string;
    fieldName: string;
  };

  type SublistRow = Record<string, FieldInfo>;
  type Sublists = Record<string, SublistRow[]>;
  type FieldMap = Record<string, FieldInfo>;

  // Map body fields
  if (body && typeof body === "object") {
    bodyFields.value = Object.entries(body)
      .filter(([, value]: [string, any]) => {
        return (
          value &&
          typeof value.fieldName === "string" &&
          value.fieldName.trim() !== ""
        );
      })
      .map(([key, value]: [string, any]) => ({
        id: key,
        label: value.fieldName,
      }));
  }

  // Map sublists and their fields
  if (sublistData && typeof sublistData === "object") {
    const sublistList: { id: string; label: string }[] = [];
    const fieldsMap: Record<string, { id: string; label: string }[]> = {};
    const whitelists: Record<string, { id: string; label: string }[]> = {};
    const blacklists: Record<string, { id: string; label: string }[]> = {};

    for (const [sublistId, rows] of Object.entries(sublistData as Sublists)) {
      // Add sublist to list
      sublistList.push({
        id: sublistId,
        label: sublistId.charAt(0).toUpperCase() + sublistId.slice(1), // Capitalize
      });

      // Extract unique fields from this sublist
      const fieldSet = new Set<string>();
      const fields: { id: string; label: string }[] = [];

      if (Array.isArray(rows)) {
        for (const row of rows) {
          for (const [fieldId, fieldInfo] of Object.entries(row)) {
            if (
              fieldInfo &&
              typeof fieldInfo.fieldName === "string" &&
              fieldInfo.fieldName.trim() !== "" &&
              !fieldSet.has(fieldId)
            ) {
              fieldSet.add(fieldId);
              fields.push({
                id: fieldId,
                label: fieldInfo.fieldName,
              });
            }
          }
        }
      }

      fieldsMap[sublistId] = fields;
      whitelists[sublistId] = [];
      blacklists[sublistId] = [];
    }

    sublists.value = sublistList;
    sublistFieldsMap.value = fieldsMap;
    sublistFieldWhitelists.value = whitelists;
    sublistFieldBlacklists.value = blacklists;
  }

  console.log("Loaded:", {
    bodyFields: bodyFields.value,
    sublists: sublists.value,
    sublistFieldsMap: sublistFieldsMap.value,
  });
};

onMounted(async () => {
  loading.value = true;
  await loadFields();
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
      :loading="loading"
    />
  </header>

  <!-- Export Config Section -->
  <section class="card-section">
    <h2 class="section-title">Include Properties</h2>
    <div class="flex flex-wrap gap-4">
      <div
        v-for="(option, idx) in ['fieldId', 'fieldName', 'text', 'value']"
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
          class="text-sm font-medium text-slate-700 capitalize"
        >
          {{ option }}
        </label>
      </div>
    </div>
    <p class="text-xs text-slate-500 mt-1">
      Uncheck all for backward compatible mode (text values only)
    </p>
  </section>

  <!-- Filter Sections -->
  <section
    class="tag-sections"
    :style="{ height: `${vhOffset}vh` }"
    data-ignore
  >
    <!-- Body Field Filters -->
    <div class="filter-group">
      <h3 class="group-title">Body Fields</h3>

      <Panel toggleable collapsed>
        <template #header>
          <div class="flex items-center justify-between w-full pr-4">
            <span class="font-semibold">Whitelist</span>
            <span class="text-sm text-slate-500 font-normal">
              {{ bodyFields.length }} fields
            </span>
          </div>
        </template>
        <div class="panel-content-simple">
          <TagSelector
            v-model="bodyWhitelist"
            :availableTags="bodyFields"
            :tagName="'Body Field Whitelist'"
          />
          <p class="hint">Only these body fields will be exported</p>
        </div>
      </Panel>

      <Panel toggleable collapsed>
        <template #header>
          <div class="flex items-center justify-between w-full pr-4">
            <span class="font-semibold">Blacklist</span>
            <span class="text-sm text-slate-500 font-normal">
              {{ bodyFields.length }} fields
            </span>
          </div>
        </template>
        <div class="panel-content-simple">
          <TagSelector
            v-model="bodyBlacklist"
            :availableTags="bodyFields"
            :tagName="'Body Field Blacklist'"
          />
          <p class="hint">These body fields will be excluded</p>
        </div>
      </Panel>
    </div>

    <!-- Sublist Filters -->
    <div class="filter-group">
      <h3 class="group-title">Sublists</h3>

      <Panel toggleable collapsed>
        <template #header>
          <div class="flex items-center justify-between w-full pr-4">
            <span class="font-semibold">Sublist Whitelist</span>
            <span class="text-sm text-slate-500 font-normal">
              {{ sublists.length }} sublists
            </span>
          </div>
        </template>
        <div class="panel-content-simple">
          <TagSelector
            v-model="sublistWhitelist"
            :availableTags="sublists"
            :tagName="'Sublist Whitelist'"
          />
          <p class="hint">Only these sublists will be exported</p>
        </div>
      </Panel>

      <Panel toggleable collapsed>
        <template #header>
          <div class="flex items-center justify-between w-full pr-4">
            <span class="font-semibold">Sublist Blacklist</span>
            <span class="text-sm text-slate-500 font-normal">
              {{ sublists.length }} sublists
            </span>
          </div>
        </template>
        <div class="panel-content-simple">
          <TagSelector
            v-model="sublistBlacklist"
            :availableTags="sublists"
            :tagName="'Sublist Blacklist'"
          />
          <p class="hint">These sublists will be excluded</p>
        </div>
      </Panel>
    </div>

    <!-- Sublist Field Filters - Grouped by Sublist -->
    <div class="filter-group">
      <h3 class="group-title">Sublist Fields</h3>
      <p class="hint mb-3">
        Configure field filters for each sublist individually
      </p>

      <div
        v-for="sublist in sublists"
        :key="sublist.id"
        class="sublist-panel-container"
      >
        <Panel toggleable collapsed>
          <template #header>
            <div class="flex items-center justify-between w-full pr-4">
              <span class="font-semibold">{{ sublist.label }}</span>
              <span class="text-sm text-slate-500 font-normal">
                {{ sublistFieldsMap[sublist.id]?.length || 0 }} fields
              </span>
            </div>
          </template>
          <div class="panel-content">
            <!-- Whitelist for this sublist -->
            <div class="field-filter-section">
              <h4 class="filter-title">Field Whitelist</h4>
              <TagSelector
                v-model="sublistFieldWhitelists[sublist.id]!"
                :availableTags="sublistFieldsMap[sublist.id] || []"
                :tagName="`${sublist.label} Whitelist`"
              />
              <p class="hint">
                Only these fields will be included in {{ sublist.label }}
              </p>
            </div>

            <!-- Blacklist for this sublist -->
            <div class="field-filter-section">
              <h4 class="filter-title">Field Blacklist</h4>
              <TagSelector
                v-model="sublistFieldBlacklists[sublist.id]!"
                :availableTags="sublistFieldsMap[sublist.id] || []"
                :tagName="`${sublist.label} Blacklist`"
              />
              <p class="hint">
                These fields will be excluded from {{ sublist.label }}
              </p>
            </div>
          </div>
        </Panel>
      </div>
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
  margin-bottom: 1rem;
}

.section-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #1e293b;
}

.tag-sections {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  overflow-y: auto;
  padding: 0.5rem;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background: #f8fafc;
  border-radius: 1rem;
  border: 1px solid #e2e8f0;
}

.group-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: #334155;
  margin-bottom: 0.5rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid #cbd5e1;
}

.tag-card {
  background: white;
  padding: 1.25rem;
  border-radius: 0.75rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.hint {
  font-size: 0.75rem;
  color: #64748b;
  font-style: italic;
}

.panel-content-simple {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.5rem 0;
}

.sublist-panel-container {
  background: white;
  border-radius: 0.75rem;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.panel-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding: 0.5rem 0;
}

.field-filter-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.filter-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #475569;
  margin: 0;
}
</style>
