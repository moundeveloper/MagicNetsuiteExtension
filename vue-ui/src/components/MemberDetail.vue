<script setup lang="ts">
import { ref, computed } from "vue";
import CodeViewer from "./CodeViewer.vue";
import InputText from "primevue/inputtext";
import type { MemberDetails } from "../utils/modulesDb";

interface Props {
  details: MemberDetails | null;
  scriptTypes?: string;
}

const props = defineProps<Props>();

const enumSearch = ref("");

const filteredEnumValues = computed(() => {
  const values = props.details?.enumValues ?? [];
  const q = enumSearch.value.trim().toLowerCase();
  return q ? values.filter((v) => v.toLowerCase().includes(q)) : values;
});
</script>

<template>
  <div class="member-detail-sections">
    <!-- Overview -->
    <div v-if="details?.overview" class="detail-section">
      <h4 class="detail-heading">Overview</h4>
      <div class="overview-list">
        <div
          v-for="(val, key) in details.overview"
          :key="key"
          class="overview-item"
        >
          <span class="overview-label">{{ key }}</span>
          <span class="overview-value">{{ val }}</span>
        </div>
      </div>
    </div>

    <!-- Parameters -->
    <div v-if="details?.parameters?.length" class="detail-section">
      <h4 class="detail-heading">Parameters</h4>
      <table class="params-table">
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Type</th>
            <th>Required</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(param, i) in details.parameters" :key="i">
            <td class="param-name">{{ param.Parameter }}</td>
            <td class="param-type">{{ param.Type }}</td>
            <td class="param-req">{{ param["Required / Optional"] }}</td>
            <td>{{ param.Description }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Errors -->
    <div v-if="details?.errors?.length" class="detail-section">
      <h4 class="detail-heading">Errors</h4>
      <table class="params-table">
        <thead>
          <tr>
            <th>Error Code</th>
            <th>Thrown If</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(err, i) in details.errors" :key="i">
            <td class="error-code">{{ err["Error Code"] }}</td>
            <td>{{ err["Thrown If"] }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Notes -->
    <div v-if="details?.notes?.length" class="detail-section">
      <h4 class="detail-heading">Notes</h4>
      <ul class="notes-list">
        <li v-for="(note, i) in details.notes" :key="i">{{ note }}</li>
      </ul>
    </div>

    <!-- Syntax -->
    <div v-if="details?.syntax" class="detail-section">
      <h4 class="detail-heading">Syntax</h4>
      <CodeViewer :code="details.syntax" language="javascript" :auto-height="true" />
    </div>

    <!-- Enum values -->
    <div v-if="details?.enumValues?.length" class="detail-section">
      <h4 class="detail-heading">
        Values
        <span class="enum-count-badge">{{ details.enumValues.length }}</span>
      </h4>
      <InputText
        v-model="enumSearch"
        placeholder="Filter values..."
        class="enum-search-input"
      />
      <div class="enum-values-grid">
        <span v-for="val in filteredEnumValues" :key="val" class="enum-value-tag">{{ val }}</span>
        <span v-if="filteredEnumValues.length === 0" class="enum-no-match">No matches</span>
      </div>
    </div>

    <!-- Script types -->
    <div v-if="scriptTypes" class="detail-section">
      <span class="script-types-label">Supported Script Types:</span>
      <span class="script-types-value">{{ scriptTypes }}</span>
    </div>
  </div>
</template>

<style scoped>
.member-detail-sections {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.detail-heading {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--p-slate-500);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
}

.overview-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.72rem;
}

.overview-item {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.5rem 0.6rem;
  background: var(--p-slate-50);
  border-left: 3px solid var(--p-slate-300);
  border-radius: 0 4px 4px 0;
}

.overview-label {
  font-weight: 600;
  color: var(--p-slate-500);
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.overview-value {
  color: var(--p-slate-700);
  line-height: 1.5;
}

.params-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.7rem;
}

.params-table th {
  text-align: left;
  padding: 0.3rem 0.4rem;
  background: var(--p-slate-100);
  color: var(--p-slate-600);
  font-weight: 600;
  border-bottom: 1px solid var(--p-slate-200);
}

.params-table td {
  padding: 0.3rem 0.4rem;
  color: var(--p-slate-600);
  border-bottom: 1px solid var(--p-slate-100);
  vertical-align: top;
}

.param-name {
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
  color: var(--p-slate-700);
  white-space: nowrap;
}

.param-type {
  font-family: "JetBrains Mono", monospace;
  color: var(--p-blue-600);
  white-space: nowrap;
}

.param-req {
  white-space: nowrap;
}

.error-code {
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
  color: var(--p-red-600);
  white-space: nowrap;
}

.notes-list {
  margin: 0;
  padding-left: 1.2rem;
  font-size: 0.72rem;
  color: var(--p-slate-600);
  line-height: 1.5;
}

.enum-count-badge {
  display: inline-block;
  font-size: 0.6rem;
  font-weight: 500;
  background: var(--p-slate-200);
  color: var(--p-slate-600);
  border-radius: 0.2rem;
  padding: 0.1rem 0.35rem;
  margin-left: 0.4rem;
  vertical-align: middle;
}

.enum-search-input {
  width: 100%;
  font-size: 0.72rem !important;
  padding: 0.3rem 0.5rem !important;
  height: auto !important;
}

.enum-values-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  max-height: 150px;
  overflow-y: auto;
  padding: 0.1rem 0;
}

.enum-value-tag {
  display: inline-block;
  padding: 0.18rem 0.5rem;
  background: var(--p-slate-100);
  color: var(--p-slate-700);
  border: 1px solid var(--p-slate-300);
  border-radius: 0.2rem;
  font-size: 0.67rem;
  font-family: "JetBrains Mono", monospace;
  white-space: nowrap;
}

.enum-no-match {
  font-size: 0.7rem;
  color: var(--p-slate-400);
  font-style: italic;
}

.script-types-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--p-slate-600);
}

.script-types-value {
  font-size: 0.7rem;
  color: var(--p-slate-500);
  margin-left: 0.3rem;
}
</style>
