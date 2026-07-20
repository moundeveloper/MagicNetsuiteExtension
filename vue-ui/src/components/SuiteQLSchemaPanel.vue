<template>
  <aside class="schema-panel" aria-label="SuiteQL schema documentation">
    <header class="schema-panel__header">
      <div class="schema-panel__heading">
        <i class="pi pi-database" />
        <div>
          <strong>SuiteQL Schema</strong>
          <span>Explore records and relationships</span>
        </div>
      </div>
      <div class="schema-panel__header-actions">
        <button
          type="button"
          title="Refresh schema"
          aria-label="Refresh schema"
          :disabled="isLoadingTables"
          @click="$emit('refresh')"
        >
          <i
            class="pi"
            :class="isLoadingTables ? 'pi-spin pi-spinner' : 'pi-refresh'"
          />
        </button>
        <button
          type="button"
          title="Close schema panel"
          aria-label="Close schema panel"
          @click="$emit('close')"
        >
          <i class="pi pi-times" />
        </button>
      </div>
    </header>

    <div v-if="selectedTable" class="schema-breadcrumb">
      <button type="button" title="Back to all tables" @click="showTables">
        <i class="pi pi-chevron-left" />
        <span>All tables</span>
      </button>
      <i class="pi pi-angle-right" />
      <strong :title="selectedTable.id">{{ selectedTable.id }}</strong>
    </div>

    <div v-if="activeTab !== 'overview'" class="schema-panel__search">
      <i class="pi pi-search" />
      <input
        :value="search"
        type="search"
        :placeholder="searchPlaceholder"
        aria-label="Search SuiteQL schema"
        @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
      />
      <button
        v-if="search"
        type="button"
        title="Clear search"
        aria-label="Clear schema search"
        @click="$emit('update:search', '')"
      >
        <i class="pi pi-times" />
      </button>
    </div>

    <nav
      v-if="selectedTable"
      class="schema-panel__tabs"
      aria-label="Table documentation sections"
    >
      <button
        v-for="tab in detailTabs"
        :key="tab.id"
        type="button"
        :class="{ 'schema-panel__tab--active': activeTab === tab.id }"
        @click="selectDetailTab(tab.id)"
      >
        <i :class="tab.icon" />
        <span>{{ tab.label }}</span>
        <small v-if="tab.count !== null">{{ tab.count }}</small>
      </button>
    </nav>

    <div class="schema-panel__body">
      <section v-if="activeTab === 'tables' || !selectedTable" class="table-browser">
        <div
          v-if="queryTables.length"
          class="query-structure"
          aria-label="Tables referenced by the current query"
        >
          <div class="schema-section-heading">
            <span>Current query structure</span>
            <small>{{ queryTables.length }} tables</small>
          </div>
          <div class="query-structure__flow">
            <template v-for="(table, index) in queryTables" :key="table.id">
              <button
                type="button"
                :title="`${table.id} — ${table.label}`"
                @click="chooseTable(table)"
              >
                <i class="pi pi-table" />
                <span>{{ table.id }}</span>
              </button>
              <i
                v-if="index < queryTables.length - 1"
                class="pi pi-arrow-right query-structure__arrow"
              />
            </template>
          </div>
          <p>
            These records appear in the active query. Select one to inspect its
            columns and documented connections.
          </p>
        </div>

        <div class="schema-section-heading all-tables-heading">
          <span>All SuiteQL tables</span>
          <small>{{ filteredTables.length }} of {{ tables.length }}</small>
        </div>

        <div v-if="isLoadingTables" class="schema-panel__empty">
          <i class="pi pi-spin pi-spinner" />
          <span>Loading tables…</span>
        </div>
        <div v-else class="schema-list">
          <button
            v-for="table in filteredTables"
            :key="table.id"
            type="button"
            class="schema-table-item"
            :class="{ referenced: queryTableIds.includes(table.id) }"
            :title="`${table.id} — ${table.label}`"
            @click="chooseTable(table)"
          >
            <i class="pi pi-table" />
            <span>
              <strong>{{ table.id }}</strong>
              <small>{{ table.label }}</small>
            </span>
            <span
              v-if="queryTableIds.includes(table.id)"
              class="schema-context-badge"
            >
              In query
            </span>
            <i class="pi pi-chevron-right schema-item-chevron" />
          </button>
        </div>
        <div
          v-if="!isLoadingTables && filteredTables.length === 0"
          class="schema-panel__empty"
        >
          <i class="pi pi-search" />
          <strong>No matching tables</strong>
          <span>Try a table ID or display label.</span>
        </div>
      </section>

      <section v-else-if="activeTab === 'overview'" class="table-detail-view">
        <div class="table-identity">
          <div class="table-identity__icon"><i class="pi pi-table" /></div>
          <div>
            <strong :title="selectedTable.id">{{ selectedTable.id }}</strong>
            <span :title="selectedTable.label">{{ selectedTable.label }}</span>
          </div>
          <span class="table-kind">{{ selectedTable.type || "Record" }}</span>
        </div>

        <div v-if="isLoadingDetail" class="schema-panel__empty">
          <i class="pi pi-spin pi-spinner" />
          <span>Loading table structure…</span>
        </div>
        <template v-else>
          <div class="schema-stat-grid">
            <button type="button" @click="selectDetailTab('fields')">
              <i class="pi pi-list" />
              <strong>{{ selectedFields.length }}</strong>
              <span>Columns</span>
            </button>
            <button type="button" @click="selectDetailTab('joins')">
              <i class="pi pi-sitemap" />
              <strong>{{ selectedJoins.length }}</strong>
              <span>Connections</span>
            </button>
          </div>

          <div class="schema-section">
            <div class="schema-section-heading">
              <span>Field structure</span>
              <small>{{ fieldTypeGroups.length }} data types</small>
            </div>
            <div v-if="fieldTypeGroups.length" class="field-type-groups">
              <div v-for="group in fieldTypeGroups" :key="group.type">
                <span>{{ group.type }}</span>
                <div><i :style="{ width: `${group.percent}%` }" /></div>
                <strong>{{ group.count }}</strong>
              </div>
            </div>
            <p v-else class="schema-section__empty-copy">
              No column metadata is available for this table.
            </p>
          </div>

          <div class="schema-section relationship-map">
            <div class="schema-section-heading">
              <span>Relationship map</span>
              <small>Source → target</small>
            </div>
            <div v-if="selectedJoins.length" class="relationship-map__list">
              <button
                v-for="join in selectedJoins.slice(0, 8)"
                :key="`${join.tableId}_${join.id}`"
                type="button"
                :title="join.sourceTargetType?.label || join.sourceTargetType?.id"
                @click="openJoinTarget(join)"
              >
                <span class="relationship-node source">{{ selectedTable.id }}</span>
                <span class="relationship-edge">
                  <small>{{ normalizedJoinType(join.joinType) }}</small>
                  <i class="pi pi-arrow-right" />
                </span>
                <span class="relationship-node target">
                  {{ join.sourceTargetType?.id || "Unknown" }}
                </span>
              </button>
              <button
                v-if="selectedJoins.length > 8"
                type="button"
                class="relationship-map__more"
                @click="selectDetailTab('joins')"
              >
                View {{ selectedJoins.length - 8 }} more connections
              </button>
            </div>
            <p v-else class="schema-section__empty-copy">
              No documented joins originate from this table.
            </p>
          </div>
        </template>
      </section>

      <section v-else-if="activeTab === 'fields'" class="table-detail-view">
        <div class="schema-section-intro">
          <strong>Fields on {{ selectedTable.id }}</strong>
          <span>
            Column IDs are used in SELECT, WHERE, GROUP BY, and ORDER BY clauses.
          </span>
        </div>
        <div v-if="isLoadingDetail" class="schema-panel__empty">
          <i class="pi pi-spin pi-spinner" />
          <span>Loading fields…</span>
        </div>
        <div v-else class="schema-list field-list">
          <article
            v-for="field in filteredFields"
            :key="`${field.tableId}_${field.id}`"
            class="schema-field-item"
          >
            <div class="schema-field-item__topline">
              <code :title="field.id">{{ field.id }}</code>
              <span>{{ field.dataType || "Unknown" }}</span>
            </div>
            <strong :title="field.label">{{ field.label }}</strong>
            <small v-if="field.fieldType && field.fieldType !== field.dataType">
              NetSuite field type: {{ field.fieldType }}
            </small>
          </article>
        </div>
        <div
          v-if="!isLoadingDetail && filteredFields.length === 0"
          class="schema-panel__empty"
        >
          <i class="pi pi-search" />
          <strong>No matching fields</strong>
          <span>Try a column ID, label, or data type.</span>
        </div>
      </section>

      <section v-else class="table-detail-view">
        <div class="schema-section-intro">
          <strong>Connections from {{ selectedTable.id }}</strong>
          <span>
            Each relationship shows its target record and the condition NetSuite
            exposes for joining them.
          </span>
        </div>
        <div class="schema-list join-list">
          <article
            v-for="join in filteredJoins"
            :key="`${join.tableId}_${join.id}`"
            class="schema-join-item"
          >
            <div class="join-direction">
              <button
                type="button"
                :title="selectedTable.label"
                @click="selectDetailTab('overview')"
              >
                {{ selectedTable.id }}
              </button>
              <span>
                <small>{{ normalizedJoinType(join.joinType) }}</small>
                <i class="pi pi-arrow-right" />
              </span>
              <button
                type="button"
                :title="join.sourceTargetType?.label || join.sourceTargetType?.id"
                @click="openJoinTarget(join)"
              >
                {{ join.sourceTargetType?.id || "Unknown target" }}
              </button>
            </div>
            <div class="join-summary">
              <strong>{{ join.label }}</strong>
              <span>{{ readableCardinality(join.cardinality) }}</span>
            </div>
            <div class="join-condition">
              <span>Join condition</span>
              <code>
                {{
                  join.sourceTargetType?.joinPairs?.[0]?.label ||
                  "Not documented by NetSuite"
                }}
              </code>
            </div>
          </article>
        </div>
        <div v-if="filteredJoins.length === 0" class="schema-panel__empty">
          <i class="pi pi-sitemap" />
          <strong>No matching connections</strong>
          <span>This table has no documented relationships matching the search.</span>
        </div>
      </section>
    </div>

    <footer class="schema-panel__footer">
      <span v-if="activeTab === 'tables'">{{ tables.length }} tables available</span>
      <span v-else-if="activeTab === 'overview'">Table overview</span>
      <span v-else-if="activeTab === 'fields'">{{ filteredFields.length }} columns</span>
      <span v-else>{{ filteredJoins.length }} connections</span>
      <span>Read-only documentation</span>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";

type SchemaTab = "tables" | "overview" | "fields" | "joins";

type TableInfo = {
  id: string;
  label: string;
  type: string;
  isAvailable?: boolean;
};

type FieldRow = {
  id: string;
  label: string;
  dataType: string;
  fieldType: string;
  isColumn: boolean;
  tableId: string;
};

type JoinRow = {
  id: string;
  label: string;
  cardinality: string;
  joinType: string;
  fieldId: string;
  tableId: string;
  sourceTargetType?: {
    id: string;
    label: string;
    joinPairs?: Array<{ id: string; label: string }>;
  };
};

const props = defineProps<{
  activeTab: SchemaTab;
  search: string;
  tables: TableInfo[];
  fields: FieldRow[];
  joins: JoinRow[];
  queryTableIds: string[];
  selectedTableId: string;
  isLoadingTables: boolean;
  isLoadingDetail: boolean;
}>();

const emit = defineEmits<{
  "update:activeTab": [value: SchemaTab];
  "update:search": [value: string];
  "select-table": [table: TableInfo];
  refresh: [];
  close: [];
}>();

const selectedTable = computed(
  () => props.tables.find((table) => table.id === props.selectedTableId) ?? null
);

const queryTables = computed(() =>
  props.queryTableIds
    .map((id) => props.tables.find((table) => table.id === id))
    .filter((table): table is TableInfo => Boolean(table))
);

const selectedFields = computed(() =>
  props.fields.filter((field) => field.tableId === props.selectedTableId)
);

const selectedJoins = computed(() =>
  props.joins.filter((join) => join.tableId === props.selectedTableId)
);

const filteredTables = computed(() => {
  const term = props.search.trim().toLowerCase();
  if (!term) return props.tables;
  return props.tables.filter(
    (table) =>
      table.id.toLowerCase().includes(term) ||
      table.label.toLowerCase().includes(term)
  );
});

const filteredFields = computed(() => {
  const term = props.search.trim().toLowerCase();
  if (!term) return selectedFields.value;
  return selectedFields.value.filter(
    (field) =>
      field.id.toLowerCase().includes(term) ||
      field.label.toLowerCase().includes(term) ||
      field.dataType.toLowerCase().includes(term) ||
      field.fieldType.toLowerCase().includes(term)
  );
});

const filteredJoins = computed(() => {
  const term = props.search.trim().toLowerCase();
  if (!term) return selectedJoins.value;
  return selectedJoins.value.filter(
    (join) =>
      join.id.toLowerCase().includes(term) ||
      join.label.toLowerCase().includes(term) ||
      join.cardinality.toLowerCase().includes(term) ||
      (join.sourceTargetType?.id ?? "").toLowerCase().includes(term) ||
      (join.sourceTargetType?.label ?? "").toLowerCase().includes(term)
  );
});

const detailTabs = computed(() => [
  { id: "overview" as const, label: "Overview", icon: "pi pi-th-large", count: null },
  { id: "fields" as const, label: "Fields", icon: "pi pi-list", count: selectedFields.value.length },
  { id: "joins" as const, label: "Joins", icon: "pi pi-sitemap", count: selectedJoins.value.length }
]);

const fieldTypeGroups = computed(() => {
  const counts = new Map<string, number>();
  for (const field of selectedFields.value) {
    const type = field.dataType || field.fieldType || "Unknown";
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const total = Math.max(selectedFields.value.length, 1);
  return [...counts.entries()]
    .map(([type, count]) => ({
      type,
      count,
      percent: Math.max(4, Math.round((count / total) * 100))
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
});

const searchPlaceholder = computed(() => {
  if (props.activeTab === "fields") return `Search fields in ${props.selectedTableId}…`;
  if (props.activeTab === "joins") return `Search connections from ${props.selectedTableId}…`;
  return "Search tables by ID or label…";
});

const chooseTable = (table: TableInfo) => {
  emit("update:search", "");
  emit("select-table", table);
};

const showTables = () => {
  emit("update:search", "");
  emit("update:activeTab", "tables");
};

const selectDetailTab = (tab: Exclude<SchemaTab, "tables">) => {
  emit("update:search", "");
  emit("update:activeTab", tab);
};

const openJoinTarget = (join: JoinRow) => {
  const targetId = join.sourceTargetType?.id;
  if (!targetId) return;
  const target = props.tables.find(
    (table) => table.id.toLowerCase() === targetId.toLowerCase()
  );
  if (target) chooseTable(target);
};

const normalizedJoinType = (value: string) => {
  if (!value) return "joins to";
  return value.replace(/_/g, " ").toLowerCase();
};

const readableCardinality = (value: string) => {
  if (!value) return "Cardinality not documented";
  return value.replace(/_/g, " ").toLowerCase();
};
</script>

<style scoped>
.schema-panel {
  display: flex;
  height: 100%;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid #dbe3ea;
  background: #fbfcfd;
  color: #27323a;
}

.schema-panel__header,
.schema-panel__heading,
.schema-panel__header-actions,
.schema-panel__search,
.schema-panel__tabs,
.schema-breadcrumb,
.schema-section-heading,
.schema-panel__footer,
.table-identity,
.schema-field-item__topline,
.join-summary {
  display: flex;
  align-items: center;
}

.schema-panel__header {
  min-height: 3rem;
  justify-content: space-between;
  gap: 0.5rem;
  border-bottom: 1px solid #dbe3ea;
  padding: 0.45rem 0.6rem 0.45rem 0.75rem;
}

.schema-panel__heading {
  min-width: 0;
  gap: 0.55rem;
}

.schema-panel__heading > i,
.table-identity__icon,
.bottom-panel-title i {
  color: #7b2ff7;
}

.schema-panel__heading > div,
.schema-table-item > span:nth-child(2),
.table-identity > div:nth-child(2) {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.schema-panel__heading strong {
  font-size: 0.78rem;
}

.schema-panel__heading span,
.schema-table-item small,
.table-identity span {
  overflow: hidden;
  color: #62696e;
  font-size: 0.63rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schema-panel__header-actions {
  gap: 0.15rem;
}

.schema-panel__header-actions button,
.schema-panel__search button {
  display: inline-flex;
  width: 1.75rem;
  height: 1.75rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  color: #62696e;
  cursor: pointer;
}

.schema-panel__header-actions button:hover:not(:disabled),
.schema-panel__search button:hover {
  border-color: #d8c6ff;
  background: #faf7ff;
  color: #7b2ff7;
}

.schema-panel__header-actions button:disabled {
  cursor: wait;
  opacity: 0.55;
}

.schema-breadcrumb {
  min-height: 1.9rem;
  gap: 0.25rem;
  border-bottom: 1px solid #dbe3ea;
  padding: 0 0.65rem;
  font-size: 0.62rem;
}

.schema-breadcrumb button {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.3rem;
  border: 0;
  background: transparent;
  color: #62696e;
  cursor: pointer;
  padding: 0;
}

.schema-breadcrumb button:hover {
  color: #7b2ff7;
}

.schema-breadcrumb > i {
  color: #8a949b;
  font-size: 0.55rem;
}

.schema-breadcrumb strong {
  overflow: hidden;
  color: #7b2ff7;
  font-family: "JetBrains Mono", monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schema-panel__search {
  gap: 0.4rem;
  margin: 0.5rem 0.65rem;
  border: 1px solid #b4c4d3;
  border-radius: 0.25rem;
  background: white;
  padding-left: 0.55rem;
}

.schema-panel__search:focus-within {
  border-color: #c6a7ff;
  box-shadow: 0 0 0 2px #faf7ff;
}

.schema-panel__search > i {
  color: #8a949b;
  font-size: 0.72rem;
}

.schema-panel__search input {
  width: 100%;
  min-width: 0;
  height: 2rem;
  border: 0;
  outline: 0;
  background: transparent;
  color: #27323a;
  font: inherit;
  font-size: 0.7rem;
}

.schema-panel__tabs {
  gap: 0.25rem;
  border-bottom: 1px solid #dbe3ea;
  padding: 0 0.65rem 0.5rem;
}

.schema-panel__tabs button {
  display: inline-flex;
  min-width: 0;
  height: 1.95rem;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  color: #62696e;
  cursor: pointer;
  font-size: 0.65rem;
  white-space: nowrap;
}

.schema-panel__tabs button:hover,
.schema-panel__tabs .schema-panel__tab--active {
  border-color: #d8c6ff;
  background: #faf7ff;
  color: #7b2ff7;
}

.schema-panel__tabs small {
  color: #8a949b;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.55rem;
}

.schema-panel__body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}

.table-browser,
.table-detail-view {
  padding: 0.45rem;
}

.schema-section-heading {
  justify-content: space-between;
  gap: 0.5rem;
  color: #62696e;
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
}

.schema-section-heading small {
  color: #8a949b;
  font-size: 0.55rem;
  font-weight: 400;
  text-transform: none;
}

.all-tables-heading {
  padding: 0.6rem 0.2rem 0.35rem;
}

.query-structure {
  border: 1px solid #d8c6ff;
  border-radius: 0.3rem;
  background: #faf7ff;
  padding: 0.55rem;
}

.query-structure__flow {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  overflow-x: auto;
  padding: 0.5rem 0 0.35rem;
}

.query-structure__flow button {
  display: inline-flex;
  overflow: hidden;
  max-width: 9rem;
  height: 1.8rem;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid #d8c6ff;
  border-radius: 0.25rem;
  background: white;
  color: #7b2ff7;
  cursor: pointer;
  padding: 0 0.45rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.58rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.query-structure__arrow {
  flex: 0 0 auto;
  color: #8a949b;
  font-size: 0.55rem;
}

.query-structure p,
.schema-section-intro span,
.schema-section__empty-copy {
  margin: 0;
  color: #62696e;
  font-size: 0.61rem;
  line-height: 1.45;
}

.schema-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.schema-table-item {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 2.7rem;
  align-items: center;
  gap: 0.5rem;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  color: #27323a;
  cursor: pointer;
  padding: 0.35rem 0.5rem;
  text-align: left;
}

.schema-table-item:hover,
.schema-table-item.referenced {
  border-color: #d8c6ff;
  background: #faf7ff;
}

.schema-table-item > i:first-child {
  color: #7b2ff7;
  font-size: 0.72rem;
}

.schema-table-item > span:nth-child(2) {
  flex: 1;
}

.schema-table-item strong,
.table-identity strong {
  overflow: hidden;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.67rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schema-context-badge,
.table-kind,
.schema-field-item__topline span,
.join-summary span {
  flex: 0 0 auto;
  border: 1px solid #d8c6ff;
  border-radius: 0.2rem;
  background: #faf7ff;
  color: #7b2ff7;
  padding: 0.12rem 0.3rem;
  font-size: 0.54rem;
}

.schema-item-chevron {
  color: #8a949b;
  font-size: 0.58rem;
}

.table-identity {
  gap: 0.55rem;
  border-bottom: 1px solid #dbe3ea;
  padding: 0.25rem 0.2rem 0.65rem;
}

.table-identity__icon {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid #d8c6ff;
  border-radius: 0.3rem;
  background: #faf7ff;
}

.table-identity > div:nth-child(2) {
  flex: 1;
}

.schema-stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
  margin: 0.55rem 0;
}

.schema-stat-grid button {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.05rem 0.45rem;
  align-items: center;
  border: 1px solid #dbe3ea;
  border-radius: 0.3rem;
  background: white;
  color: #27323a;
  cursor: pointer;
  padding: 0.45rem 0.55rem;
  text-align: left;
}

.schema-stat-grid button:hover {
  border-color: #d8c6ff;
  background: #faf7ff;
}

.schema-stat-grid i {
  grid-row: 1 / 3;
  color: #7b2ff7;
}

.schema-stat-grid strong {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.78rem;
}

.schema-stat-grid span {
  color: #62696e;
  font-size: 0.58rem;
}

.schema-section {
  border-top: 1px solid #dbe3ea;
  padding: 0.6rem 0.15rem;
}

.field-type-groups {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding-top: 0.45rem;
}

.field-type-groups > div {
  display: grid;
  grid-template-columns: minmax(5rem, 0.8fr) minmax(4rem, 1fr) 1.5rem;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.58rem;
}

.field-type-groups span {
  overflow: hidden;
  font-family: "JetBrains Mono", monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-type-groups div > div {
  height: 0.3rem;
  overflow: hidden;
  border-radius: 0.15rem;
  background: #eef3f7;
}

.field-type-groups div > div i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #c6a7ff;
}

.field-type-groups strong {
  color: #62696e;
  font-family: "JetBrains Mono", monospace;
  text-align: right;
}

.relationship-map__list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding-top: 0.45rem;
}

.relationship-map__list > button:not(.relationship-map__more) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4.3rem minmax(0, 1fr);
  align-items: center;
  gap: 0.25rem;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  cursor: pointer;
  padding: 0.3rem;
}

.relationship-map__list > button:hover {
  border-color: #d8c6ff;
  background: #faf7ff;
}

.relationship-node {
  overflow: hidden;
  border: 1px solid #dbe3ea;
  border-radius: 0.2rem;
  background: white;
  color: #27323a;
  padding: 0.25rem 0.35rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.55rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.relationship-node.source {
  border-color: #d8c6ff;
  color: #7b2ff7;
}

.relationship-edge {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  color: #8a949b;
}

.relationship-edge small {
  overflow: hidden;
  max-width: 100%;
  font-size: 0.48rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.relationship-edge i {
  color: #7b2ff7;
  font-size: 0.55rem;
}

.relationship-map__more {
  height: 1.8rem;
  border: 1px solid #d8c6ff;
  border-radius: 0.25rem;
  background: #faf7ff;
  color: #7b2ff7;
  cursor: pointer;
  font-size: 0.6rem;
}

.schema-section-intro {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  border-bottom: 1px solid #dbe3ea;
  padding: 0.2rem 0.2rem 0.6rem;
}

.schema-section-intro strong {
  overflow: hidden;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-list,
.join-list {
  padding-top: 0.4rem;
}

.schema-field-item,
.schema-join-item {
  border: 1px solid #dbe3ea;
  border-radius: 0.25rem;
  background: white;
  padding: 0.45rem 0.5rem;
}

.schema-field-item__topline,
.join-summary {
  min-width: 0;
  justify-content: space-between;
  gap: 0.5rem;
}

.schema-field-item code,
.join-condition code {
  overflow: hidden;
  color: #7b2ff7;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.64rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schema-field-item > strong {
  display: block;
  overflow: hidden;
  margin-top: 0.2rem;
  color: #27323a;
  font-size: 0.63rem;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schema-field-item > small {
  display: block;
  margin-top: 0.15rem;
  color: #8a949b;
  font-size: 0.55rem;
}

.join-direction {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4rem minmax(0, 1fr);
  align-items: center;
  gap: 0.25rem;
}

.join-direction button {
  overflow: hidden;
  height: 1.75rem;
  border: 1px solid #dbe3ea;
  border-radius: 0.2rem;
  background: #fbfcfd;
  color: #27323a;
  cursor: pointer;
  padding: 0 0.35rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.55rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.join-direction button:first-child {
  border-color: #d8c6ff;
  background: #faf7ff;
  color: #7b2ff7;
}

.join-direction > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  color: #8a949b;
}

.join-direction small {
  overflow: hidden;
  max-width: 100%;
  font-size: 0.46rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.join-direction i {
  color: #7b2ff7;
  font-size: 0.55rem;
}

.join-summary {
  margin-top: 0.45rem;
}

.join-summary strong {
  overflow: hidden;
  font-size: 0.62rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.join-condition {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.15rem;
  margin-top: 0.35rem;
  border-top: 1px solid #eef3f7;
  padding-top: 0.35rem;
}

.join-condition span {
  color: #8a949b;
  font-size: 0.52rem;
  text-transform: uppercase;
}

.join-condition code {
  color: #62696e;
  font-weight: 400;
}

.schema-panel__empty {
  display: flex;
  min-height: 10rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 1rem;
  color: #8a949b;
  text-align: center;
  font-size: 0.66rem;
}

.schema-panel__empty > i {
  color: #7b2ff7;
  font-size: 1rem;
}

.schema-panel__empty strong {
  color: #27323a;
  font-size: 0.7rem;
}

.schema-panel__footer {
  min-height: 1.8rem;
  justify-content: space-between;
  gap: 0.5rem;
  border-top: 1px solid #dbe3ea;
  color: #8a949b;
  padding: 0 0.65rem;
  font-size: 0.56rem;
}
</style>
