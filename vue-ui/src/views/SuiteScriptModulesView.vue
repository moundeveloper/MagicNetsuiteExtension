<template>
  <div class="modules-view">
    <ViewHeader />

    <!-- Toolbar (search + filters in header, like LogSearchView) -->
    <MPanel
      v-if="!isLoading && moduleCount > 0"
      outline
      toggleable
      header="Search & Filters"
      box-shadow
    >
      <template #header>
        <div class="panel-header-row">
          <div class="panel-header-left">
            <InputText
              v-model="searchQuery"
              placeholder="Search methods, objects..."
              class="toolbar-search"
              @input="onSearch"
            />
            <MultiSelect
              v-model="filterModules"
              :options="moduleOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="All Modules"
              class="toolbar-filter"
              :maxSelectedLabels="1"
              selectedItemsLabel="{0} modules"
              filter
              :virtualScrollerOptions="{ itemSize: 38 }"
              @change="runSearch"
            />
            <MultiSelect
              v-model="filterTypes"
              :options="typeOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="All Types"
              class="toolbar-filter"
              :maxSelectedLabels="2"
              filter
              @change="runSearch"
            />
          </div>
          <div class="panel-header-right">
            <span class="result-count"
              >{{ displayedMembers.length }} results</span
            >
            <Button
              size="small"
              outlined
              @click="startScrape"
              :loading="isScraping"
              title="Re-load modules from NetSuite"
            >
              <i class="pi pi-refresh" />
              Update
            </Button>
          </div>
        </div>
      </template>
    </MPanel>

    <!-- Module filter panel -->
    <MPanel
      v-if="!isLoading && moduleCount > 0"
      outline
      toggleable
      header="Modules"
      box-shadow
    >
      <template #header>
        <span class="filter-panel-label">
          Modules
          <span v-if="filterModules.length" class="filter-panel-count"
            >{{ filterModules.length }} selected</span
          >
        </span>
      </template>
      <div class="module-tags">
        <button
          v-for="mod in modules"
          :key="mod.name"
          class="module-tag"
          :class="{ active: filterModules.includes(mod.name) }"
          @click="toggleModuleFilter(mod.name)"
        >
          {{ mod.name }}
          <span class="tag-count">{{ mod.memberCount }}</span>
        </button>
      </div>
    </MPanel>

    <!-- Results MCard (like LogSearchView) -->
    <MCard
      flex
      direction="column"
      autoHeight
      outlined
      elevated
      :style="{ height: `${vhOffset}vh` }"
    >
      <template #default="{ contentHeight }">
        <div class="results-area" :style="{ height: `${contentHeight}px` }">
          <!-- Onboarding: no modules loaded yet -->
          <div
            v-if="
              !isLoading && moduleCount === 0 && !isScraping && !isProcessing
            "
            class="onboarding"
          >
            <div class="onboarding-content">
              <i class="pi pi-book onboarding-icon" />
              <h3 class="onboarding-title">SuiteScript Module Documentation</h3>
              <p class="onboarding-desc">
                Load all SuiteScript 2.x module docs — methods, parameters,
                errors, and code examples — directly from NetSuite.
              </p>

              <div v-if="scrapeState.error" class="page-hint page-hint-error">
                <i class="pi pi-exclamation-triangle" />
                {{ scrapeState.error }}
              </div>

              <Button @click="startScrape" :loading="isScraping">
                <i class="pi pi-cloud-download" />
                {{ scrapeState.error ? "Retry" : "Load from NetSuite" }}
              </Button>
            </div>
          </div>

          <!-- First-time scraping + import progress -->
          <div
            v-else-if="moduleCount === 0 && (isScraping || isProcessing)"
            class="loading-state"
          >
            <div class="scrape-progress">
              <MLoader text="" />
              <p class="scrape-label">
                Loading
                <strong>{{ scrapeState.currentModule || "..." }}</strong>
              </p>
              <div class="progress-bar-track">
                <div
                  class="progress-bar-fill"
                  :style="{
                    width:
                      scrapeState.total > 0
                        ? `${(scrapeState.current / scrapeState.total) * 100}%`
                        : '2%'
                  }"
                />
              </div>
              <p class="scrape-count">
                {{ scrapeState.current }} / {{ scrapeState.total }} modules
              </p>
              <Button
                size="small"
                severity="secondary"
                outlined
                @click="cancelScrape"
                >Cancel</Button
              >
            </div>
          </div>

          <!-- Initial load spinner (only before scraping starts) -->
          <div
            v-else-if="isLoading && moduleCount === 0 && !isScraping"
            class="loading-state"
          >
            <MLoader text="Loading..." />
          </div>

          <!-- Update progress (when re-scraping with existing data) -->
          <div
            v-else-if="(isScraping || isProcessing) && moduleCount > 0"
            class="loading-state"
          >
            <div class="scrape-progress">
              <MLoader text="" />
              <p class="scrape-label">
                {{ isProcessing ? "Saving modules..." : "Updating" }}
                <strong v-if="!isProcessing">{{
                  scrapeState.currentModule || "..."
                }}</strong>
              </p>
              <div class="progress-bar-track">
                <div
                  class="progress-bar-fill"
                  :style="{
                    width:
                      scrapeState.total > 0
                        ? `${(scrapeState.current / scrapeState.total) * 100}%`
                        : '2%'
                  }"
                />
              </div>
              <p class="scrape-count">
                {{ scrapeState.current }} / {{ scrapeState.total }} modules
              </p>
              <Button
                v-if="!isProcessing"
                size="small"
                severity="secondary"
                outlined
                @click="cancelScrape"
                >Cancel</Button
              >
            </div>
          </div>

          <!-- Results list -->
          <template v-else>
            <div v-if="displayedMembers.length === 0" class="empty-state">
              <i class="pi pi-search empty-icon" />
              <p class="empty-title">No matching members</p>
              <p class="empty-sub">Try a different search term or filter.</p>
            </div>

            <div
              v-for="member in displayedMembers"
              :key="member.id"
              class="member-card"
              :class="{ expanded: expandedId === member.id }"
            >
              <div class="member-header" @click="toggleExpand(member.id)">
                <div class="member-info">
                  <span
                    class="member-type-badge"
                    :class="memberTypeClass(member.memberType)"
                    >{{ member.memberType }}</span
                  >
                  <span class="member-name">{{ member.name }}</span>
                </div>
                <div class="member-meta">
                  <span class="member-module">{{ member.moduleName }}</span>
                  <span v-if="member.returnType" class="member-return"
                    >&rarr; {{ member.returnType }}</span
                  >
                  <i class="pi pi-chevron-down expand-icon" />
                </div>
              </div>
              <p class="member-description">{{ member.description }}</p>

              <div
                v-if="expandedId === member.id && expandedDetail"
                class="member-detail"
                @click.stop
              >
                <div
                  v-if="expandedDetail.details?.overview"
                  class="detail-section"
                >
                  <h4 class="detail-heading">Overview</h4>
                  <div class="overview-list">
                    <template
                      v-for="(val, key) in expandedDetail.details.overview"
                      :key="key"
                    >
                      <div class="overview-item">
                        <span class="overview-label">{{ key }}</span>
                        <span class="overview-value">{{ val }}</span>
                      </div>
                    </template>
                  </div>
                </div>

                <div
                  v-if="expandedDetail.details?.parameters?.length"
                  class="detail-section"
                >
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
                      <tr
                        v-for="(param, i) in expandedDetail.details.parameters"
                        :key="i"
                      >
                        <td class="param-name">{{ param.Parameter }}</td>
                        <td class="param-type">{{ param.Type }}</td>
                        <td class="param-req">
                          {{ param["Required / Optional"] }}
                        </td>
                        <td>{{ param.Description }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div
                  v-if="expandedDetail.details?.errors?.length"
                  class="detail-section"
                >
                  <h4 class="detail-heading">Errors</h4>
                  <table class="params-table">
                    <thead>
                      <tr>
                        <th>Error Code</th>
                        <th>Thrown If</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="(err, i) in expandedDetail.details.errors"
                        :key="i"
                      >
                        <td class="error-code">{{ err["Error Code"] }}</td>
                        <td>{{ err["Thrown If"] }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div
                  v-if="expandedDetail.details?.notes?.length"
                  class="detail-section"
                >
                  <h4 class="detail-heading">Notes</h4>
                  <ul class="notes-list">
                    <li
                      v-for="(note, i) in expandedDetail.details.notes"
                      :key="i"
                    >
                      {{ note }}
                    </li>
                  </ul>
                </div>

                <div
                  v-if="expandedDetail.details?.syntax"
                  class="detail-section"
                >
                  <h4 class="detail-heading">Syntax</h4>
                  <CodeViewer
                    :code="expandedDetail.details.syntax"
                    language="javascript"
                    :auto-height="true"
                  />
                </div>

                <div
                  v-if="expandedDetail.details?.enumValues?.length"
                  class="detail-section"
                >
                  <h4 class="detail-heading">
                    Values
                    <span class="enum-count-badge">{{
                      expandedDetail.details.enumValues.length
                    }}</span>
                  </h4>
                  <InputText
                    v-model="enumSearch"
                    placeholder="Filter values..."
                    class="enum-search-input"
                  />
                  <div class="enum-values-grid">
                    <span
                      v-for="val in filteredEnumValues"
                      :key="val"
                      class="enum-value-tag"
                      >{{ val }}</span
                    >
                    <span
                      v-if="filteredEnumValues.length === 0"
                      class="enum-no-match"
                      >No matches</span
                    >
                  </div>
                </div>

                <div v-if="expandedDetail.scriptTypes" class="detail-section">
                  <span class="script-types-label"
                    >Supported Script Types:</span
                  >
                  <span class="script-types-value">{{
                    expandedDetail.scriptTypes
                  }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </template>
    </MCard>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import ViewHeader from "../components/ViewHeader.vue";
import MCard from "../components/universal/card/MCard.vue";
import MLoader from "../components/universal/patterns/MLoader.vue";
import MPanel from "../components/universal/panels/MPanel.vue";
import CodeViewer from "../components/CodeViewer.vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import MultiSelect from "primevue/multiselect";
import {
  importModules,
  getModuleCount,
  getAllModules,
  searchMembers,
  getMemberById,
  type StoredModule,
  type StoredMember,
  type ModuleSearchResult
} from "../utils/modulesDb";
import { useModuleScraper } from "../composables/useModuleScraper";

const props = defineProps<{ vhOffset: number }>();

// ── Scraper ────────────────────────────────
const {
  state: scrapeState,
  scrape,
  cancel: cancelScrapePort,
  reset: resetScraper
} = useModuleScraper();
const isScraping = computed(
  () =>
    scrapeState.value.status === "connecting" ||
    scrapeState.value.status === "scraping"
);

// ── State ──────────────────────────────────
const isLoading = ref(true);
const isProcessing = ref(false);
const moduleCount = ref(0);
const modules = ref<StoredModule[]>([]);
const searchQuery = ref("");
const filterModules = ref<string[]>([]);
const filterTypes = ref<string[]>([]);
const displayedMembers = ref<ModuleSearchResult[]>([]);
const expandedId = ref<number | null>(null);
const expandedDetail = ref<StoredMember | null>(null);
const enumSearch = ref("");

const filteredEnumValues = computed(() => {
  const vals = expandedDetail.value?.details?.enumValues ?? [];
  if (!enumSearch.value.trim()) return vals;
  const q = enumSearch.value.toLowerCase();
  return vals.filter((v) => v.toLowerCase().includes(q));
});

let searchDebounce: ReturnType<typeof setTimeout> | null = null;

// ── Options ────────────────────────────────
const moduleOptions = computed(() =>
  modules.value.map((m) => ({
    label: `${m.name} (${m.memberCount})`,
    value: m.name
  }))
);

const typeOptions = [
  { label: "Method", value: "Method" },
  { label: "Object", value: "Object" },
  { label: "Property", value: "Property" },
  { label: "Enum", value: "Enum" }
];

// ── Lifecycle ──────────────────────────────
onMounted(async () => {
  moduleCount.value = await getModuleCount();
  if (moduleCount.value > 0) {
    modules.value = await getAllModules();
    await runSearch();
  }
  isLoading.value = false;
});

// ── Search ─────────────────────────────────
const onSearch = () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => runSearch(), 200);
};

const runSearch = async () => {
  displayedMembers.value = await searchMembers(searchQuery.value, {
    moduleName: filterModules.value.length ? filterModules.value : undefined,
    memberType: filterTypes.value.length ? filterTypes.value : undefined,
    limit: 100
  });
};

// ── Expand / Detail ────────────────────────
const toggleExpand = async (id: number) => {
  if (expandedId.value === id) {
    expandedId.value = null;
    expandedDetail.value = null;
    enumSearch.value = "";
    return;
  }
  expandedId.value = id;
  enumSearch.value = "";
  expandedDetail.value = (await getMemberById(id)) ?? null;
};

const memberTypeClass = (type: string) => {
  const map: Record<string, string> = {
    Method: "type-method",
    Object: "type-object",
    Property: "type-property",
    Enum: "type-enum"
  };
  return map[type] || "";
};

const toggleModuleFilter = (name: string) => {
  const idx = filterModules.value.indexOf(name);
  filterModules.value =
    idx === -1
      ? [...filterModules.value, name]
      : filterModules.value.filter((n) => n !== name);
  runSearch();
};

// ── Scrape ─────────────────────────────────
const startScrape = async () => {
  resetScraper();

  let rawModules;
  try {
    rawModules = await scrape();
  } catch {
    return;
  }

  isProcessing.value = true;
  try {
    await importModules(rawModules);
    moduleCount.value = await getModuleCount();
    modules.value = await getAllModules();
    await runSearch();
  } finally {
    isProcessing.value = false;
  }
};

const cancelScrape = () => {
  cancelScrapePort();
};
</script>

<style scoped>
.modules-view {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: 100%;
}

.modules-container {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ── Onboarding ── */
.onboarding {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.onboarding-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 2rem;
  max-width: 380px;
  text-align: center;
}

.onboarding-icon {
  font-size: 2.5rem;
  color: var(--p-slate-300);
}
.onboarding-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--p-slate-700);
  margin: 0;
}
.onboarding-desc {
  font-size: 0.8rem;
  color: var(--p-slate-500);
  margin: 0;
  line-height: 1.5;
}

.page-hint {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--p-slate-600);
  background: var(--p-slate-100);
  border: 1px solid var(--p-slate-200);
  border-radius: 0.4rem;
  padding: 0.5rem 0.75rem;
  text-align: left;
  line-height: 1.4;
}

.page-hint-error {
  background: #fef2f2;
  border-color: #fecaca;
  color: #dc2626;
}

/* ── Loading / First scrape ── */
.loading-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.scrape-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  width: 260px;
}

.scrape-label {
  font-size: 0.8rem;
  color: var(--p-slate-600);
  margin: 0;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.progress-bar-track {
  width: 100%;
  height: 4px;
  background: var(--p-slate-200);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--p-slate-500);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.scrape-count {
  font-size: 0.7rem;
  color: var(--p-slate-400);
  margin: 0;
}

.panel-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
}

.panel-header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
}

.toolbar-search {
  flex: 1;
  min-width: 180px;
  max-width: 300px;
}

.toolbar-filter {
  min-width: 140px;
  max-width: 180px;
}

.panel-header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}

.result-count {
  font-size: 0.75rem;
  color: var(--p-slate-500);
  white-space: nowrap;
}

.filter-panel-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-slate-600);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.filter-panel-count {
  font-size: 0.62rem;
  font-weight: 500;
  background: var(--p-slate-200);
  color: var(--p-slate-600);
  border-radius: 0.2rem;
  padding: 0.1rem 0.35rem;
}

.module-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.module-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.45rem;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.2rem;
  background: white;
  color: var(--p-slate-600);
  font-size: 0.67rem;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s ease;
  font-family: "JetBrains Mono", monospace;
}

.module-tag:hover {
  background: var(--p-slate-100);
  border-color: var(--p-slate-400);
}

.module-tag.active {
  background: var(--p-slate-700);
  color: white;
  border-color: var(--p-slate-700);
}

.tag-count {
  font-size: 0.6rem;
  opacity: 0.65;
}

/* ── Results ── */
.results-area {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem 0.75rem;
  padding-left: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-height: 0;
}

/* ── Empty ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  color: var(--p-slate-400);
  gap: 0.4rem;
}

.empty-icon {
  font-size: 2rem;
  color: var(--p-slate-300);
}
.empty-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--p-slate-600);
  margin: 0;
}
.empty-sub {
  font-size: 0.8rem;
  margin: 0;
}

/* ── Member card ── */
.member-card {
  background: white;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.35rem;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.member-card:hover {
  border-color: var(--p-slate-300);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}
.member-card.expanded {
  border-color: var(--p-blue-300);
}

.member-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.6rem 0.75rem;
  cursor: pointer;
  user-select: none;
}

.expand-icon {
  font-size: 0.6rem;
  color: var(--p-slate-300);
  transition:
    transform 0.2s ease,
    color 0.15s ease;
  flex-shrink: 0;
}

.member-card.expanded .expand-icon {
  transform: rotate(180deg);
  color: var(--p-slate-500);
}

.member-info {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  flex: 1;
}

.member-type-badge {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 0.2rem;
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  flex-shrink: 0;
}

.type-method {
  background: #dbeafe;
  color: #1d4ed8;
}
.type-object {
  background: #f3e8ff;
  color: #7c3aed;
}
.type-property {
  background: #dcfce7;
  color: #16a34a;
}
.type-enum {
  background: #fef3c7;
  color: #d97706;
}

.member-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-slate-800);
  font-family: "JetBrains Mono", monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.member-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
}

.member-module {
  font-size: 0.65rem;
  color: var(--p-slate-400);
  font-weight: 500;
}
.member-return {
  font-size: 0.65rem;
  color: var(--p-slate-500);
  font-family: "JetBrains Mono", monospace;
}

.member-description {
  font-size: 0.75rem;
  color: var(--p-slate-500);
  margin: 0;
  padding: 0 0.75rem 0.6rem;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.member-card.expanded .member-description {
  -webkit-line-clamp: unset;
}

/* ── Detail (expanded) ── */
.member-detail {
  margin: 0 0.75rem 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--p-slate-200);
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  cursor: auto;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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

.syntax-block {
  background: var(--p-slate-800);
  color: var(--p-slate-100);
  padding: 0.75rem;
  border-radius: 0.25rem;
  font-size: 0.7rem;
  font-family: "JetBrains Mono", monospace;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
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
