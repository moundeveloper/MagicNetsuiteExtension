<template>
  <aside class="schema-panel" aria-label="SuiteQL schema documentation">
    <header class="schema-panel__header">
      <div class="schema-panel__heading">
        <i class="pi pi-database" />
        <div>
          <strong>SuiteQL Schema</strong>
          <span>Tables, fields and joins</span>
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
          <i class="pi" :class="isLoadingTables ? 'pi-spin pi-spinner' : 'pi-refresh'" />
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

    <div class="schema-panel__search">
      <i class="pi pi-search" />
      <input
        :value="search"
        type="search"
        placeholder="Search schema…"
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

    <nav class="schema-panel__tabs" aria-label="Schema sections">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        :class="{ 'schema-panel__tab--active': activeTab === tab.id }"
        @click="selectTab(tab.id)"
      >
        <i :class="tab.icon" />
        <span>{{ tab.label }}</span>
        <small>{{ tab.count }}</small>
      </button>
    </nav>

    <div
      v-if="activeTab !== 'tables' && queryTableIds.length > 1"
      class="schema-panel__context"
    >
      <span>Context tables</span>
      <div>
        <button
          type="button"
          :class="{ active: !tableFilter }"
          @click="$emit('update:tableFilter', '')"
        >
          All
        </button>
        <button
          v-for="tableId in queryTableIds"
          :key="tableId"
          type="button"
          :class="{ active: tableFilter === tableId }"
          :title="tableId"
          @click="$emit('update:tableFilter', tableId)"
        >
          {{ tableId }}
        </button>
      </div>
    </div>

    <div class="schema-panel__body">
      <div v-if="activeTab === 'tables'" class="schema-list">
        <div v-if="isLoadingTables" class="schema-panel__empty">
          <i class="pi pi-spin pi-spinner" />
          <span>Loading tables…</span>
        </div>
        <button
          v-for="table in filteredTables"
          v-else
          :key="table.id"
          type="button"
          class="schema-table-item"
          :class="{
            selected: selectedTableId === table.id,
            referenced: queryTableIds.includes(table.id)
          }"
          :title="`${table.id} — ${table.label}`"
          @click="$emit('select-table', table)"
        >
          <i class="pi pi-table" />
          <span>
            <strong>{{ table.id }}</strong>
            <small>{{ table.label }}</small>
          </span>
          <span v-if="queryTableIds.includes(table.id)" class="schema-query-badge">
            Context
          </span>
          <i class="pi pi-chevron-right schema-item-chevron" />
        </button>
        <div
          v-if="!isLoadingTables && filteredTables.length === 0"
          class="schema-panel__empty"
        >
          <i class="pi pi-search" />
          <strong>No matching tables</strong>
          <span>Try a table ID or display label.</span>
        </div>
      </div>

      <div v-else-if="activeTab === 'fields'" class="schema-list">
        <div v-if="!hasTableContext && !isLoadingDetail" class="schema-panel__empty">
          <i class="pi pi-table" />
          <strong>Select a table</strong>
          <span>Choose a table to inspect its available columns.</span>
          <button type="button" @click="selectTab('tables')">Browse tables</button>
        </div>
        <div v-else-if="isLoadingDetail" class="schema-panel__empty">
          <i class="pi pi-spin pi-spinner" />
          <span>Loading fields…</span>
        </div>
        <button
          v-for="field in filteredFields"
          v-else
          :key="`${field.tableId}_${field.id}`"
          type="button"
          class="schema-detail-item"
          :title="`Insert ${field.id} into the query`"
          @click="$emit('insert-field', field.id)"
        >
          <span class="schema-detail-item__topline">
            <strong>{{ field.id }}</strong>
            <span class="schema-type-badge">{{ field.dataType || 'Unknown' }}</span>
          </span>
          <span class="schema-detail-item__description">{{ field.label }}</span>
          <span v-if="showSourceTable" class="schema-detail-item__source">
            <i class="pi pi-table" /> {{ field.tableId }}
          </span>
          <span class="schema-insert-hint"><i class="pi pi-plus" /> Insert field</span>
        </button>
        <div
          v-if="hasTableContext && !isLoadingDetail && filteredFields.length === 0"
          class="schema-panel__empty"
        >
          <i class="pi pi-search" />
          <strong>No matching fields</strong>
          <span>Try a column ID, label, or data type.</span>
        </div>
      </div>

      <div v-else class="schema-list">
        <div v-if="!hasTableContext" class="schema-panel__empty">
          <i class="pi pi-sitemap" />
          <strong>Select a table</strong>
          <span>Choose a table to inspect its available relationships.</span>
          <button type="button" @click="selectTab('tables')">Browse tables</button>
        </div>
        <button
          v-for="join in filteredJoins"
          v-else
          :key="`${join.tableId}_${join.id}`"
          type="button"
          class="schema-detail-item schema-join-item"
          :title="`Insert join to ${join.sourceTargetType?.id || join.label}`"
          @click="$emit('insert-join', join)"
        >
          <span class="schema-detail-item__topline">
            <strong>{{ join.label }}</strong>
            <span class="schema-cardinality-badge">{{ join.cardinality || 'Relation' }}</span>
          </span>
          <span class="schema-join-target">
            <span>{{ join.tableId }}</span>
            <i class="pi pi-arrow-right" />
            <span>{{ join.sourceTargetType?.id || 'Unknown target' }}</span>
          </span>
          <span class="schema-detail-item__description schema-condition">
            {{ join.sourceTargetType?.joinPairs?.[0]?.label || 'Join condition not documented' }}
          </span>
          <span class="schema-insert-hint"><i class="pi pi-plus" /> Insert join</span>
        </button>
        <div
          v-if="hasTableContext && filteredJoins.length === 0"
          class="schema-panel__empty"
        >
          <i class="pi pi-sitemap" />
          <strong>No matching joins</strong>
          <span>This table has no documented relationships matching the search.</span>
        </div>
      </div>
    </div>

    <footer class="schema-panel__footer">
      <span v-if="activeTab === 'tables'">{{ filteredTables.length }} tables</span>
      <span v-else-if="activeTab === 'fields'">{{ filteredFields.length }} fields</span>
      <span v-else>{{ filteredJoins.length }} joins</span>
      <span>Click an item to insert it</span>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";

type SchemaTab = "tables" | "fields" | "joins";

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
  tableFilter: string;
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
  "update:tableFilter": [value: string];
  "select-table": [table: TableInfo];
  "insert-field": [fieldId: string];
  "insert-join": [join: JoinRow];
  refresh: [];
  close: [];
}>();

const hasTableContext = computed(
  () => props.queryTableIds.length > 0 || Boolean(props.selectedTableId)
);
const showSourceTable = computed(() => props.queryTableIds.length > 1);

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
  const fields = props.tableFilter
    ? props.fields.filter((field) => field.tableId === props.tableFilter)
    : props.fields;
  if (!term) return fields;
  return fields.filter(
    (field) =>
      field.id.toLowerCase().includes(term) ||
      field.label.toLowerCase().includes(term) ||
      field.tableId.toLowerCase().includes(term) ||
      field.dataType.toLowerCase().includes(term)
  );
});

const filteredJoins = computed(() => {
  const term = props.search.trim().toLowerCase();
  const joins = props.tableFilter
    ? props.joins.filter((join) => join.tableId === props.tableFilter)
    : props.joins;
  if (!term) return joins;
  return joins.filter(
    (join) =>
      join.id.toLowerCase().includes(term) ||
      join.label.toLowerCase().includes(term) ||
      join.tableId.toLowerCase().includes(term) ||
      (join.sourceTargetType?.id ?? "").toLowerCase().includes(term)
  );
});

const tabs = computed(() => [
  { id: "tables" as const, label: "Tables", icon: "pi pi-table", count: props.tables.length },
  { id: "fields" as const, label: "Fields", icon: "pi pi-list", count: props.fields.length },
  { id: "joins" as const, label: "Joins", icon: "pi pi-sitemap", count: props.joins.length }
]);

const selectTab = (tab: SchemaTab) => {
  emit("update:activeTab", tab);
  emit("update:search", "");
  emit("update:tableFilter", "");
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
.schema-detail-item__topline,
.schema-join-target,
.schema-panel__footer {
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

.schema-panel__heading > i {
  color: #7b2ff7;
}

.schema-panel__heading > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.schema-panel__heading strong {
  font-size: 0.78rem;
}

.schema-panel__heading span {
  overflow: hidden;
  color: #62696e;
  font-size: 0.65rem;
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

.schema-panel__search {
  gap: 0.4rem;
  margin: 0.55rem 0.65rem;
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
  font-size: 0.72rem;
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
  gap: 0.35rem;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  color: #62696e;
  cursor: pointer;
  font-size: 0.68rem;
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
  font-size: 0.58rem;
}

.schema-panel__context {
  border-bottom: 1px solid #dbe3ea;
  padding: 0.45rem 0.65rem;
}

.schema-panel__context > span {
  display: block;
  margin-bottom: 0.3rem;
  color: #62696e;
  font-size: 0.62rem;
  font-weight: 600;
  text-transform: uppercase;
}

.schema-panel__context > div {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
}

.schema-panel__context button {
  overflow: hidden;
  max-width: 9rem;
  flex: 0 0 auto;
  border: 1px solid #dbe3ea;
  border-radius: 0.25rem;
  background: white;
  color: #62696e;
  cursor: pointer;
  padding: 0.2rem 0.4rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.6rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schema-panel__context button.active,
.schema-panel__context button:hover {
  border-color: #d8c6ff;
  background: #faf7ff;
  color: #7b2ff7;
}

.schema-panel__body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}

.schema-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.4rem;
}

.schema-table-item,
.schema-detail-item {
  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  color: #27323a;
  cursor: pointer;
  text-align: left;
}

.schema-table-item {
  min-height: 2.7rem;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.5rem;
}

.schema-table-item:hover,
.schema-table-item.selected,
.schema-detail-item:hover {
  border-color: #d8c6ff;
  background: #faf7ff;
}

.schema-table-item.referenced:not(.selected) {
  outline: 1px solid #d8c6ff;
  outline-offset: -1px;
}

.schema-table-item > i:first-child {
  color: #7b2ff7;
  font-size: 0.75rem;
}

.schema-table-item > span:nth-child(2) {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.schema-table-item strong,
.schema-detail-item strong {
  overflow: hidden;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schema-table-item small,
.schema-detail-item__description {
  overflow: hidden;
  color: #62696e;
  font-size: 0.62rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schema-query-badge,
.schema-type-badge,
.schema-cardinality-badge {
  flex: 0 0 auto;
  border: 1px solid #d8c6ff;
  border-radius: 0.2rem;
  background: #faf7ff;
  color: #7b2ff7;
  padding: 0.12rem 0.3rem;
  font-size: 0.55rem;
}

.schema-item-chevron {
  color: #8a949b;
  font-size: 0.6rem;
}

.schema-detail-item {
  flex-direction: column;
  gap: 0.28rem;
  padding: 0.48rem 0.55rem;
}

.schema-detail-item__topline {
  min-width: 0;
  justify-content: space-between;
  gap: 0.5rem;
}

.schema-detail-item__topline strong {
  min-width: 0;
  color: #7b2ff7;
}

.schema-detail-item__source,
.schema-insert-hint {
  color: #8a949b;
  font-size: 0.58rem;
}

.schema-insert-hint {
  position: absolute;
  right: 0.5rem;
  bottom: 0.4rem;
  color: #7b2ff7;
  opacity: 0;
}

.schema-detail-item:hover .schema-insert-hint {
  opacity: 1;
}

.schema-join-target {
  min-width: 0;
  gap: 0.35rem;
  color: #62696e;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.6rem;
}

.schema-join-target span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schema-join-target i {
  flex: 0 0 auto;
  color: #7b2ff7;
  font-size: 0.55rem;
}

.schema-condition {
  padding-right: 4.5rem;
  font-family: "JetBrains Mono", monospace;
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
  font-size: 0.68rem;
}

.schema-panel__empty > i {
  color: #7b2ff7;
  font-size: 1rem;
}

.schema-panel__empty strong {
  color: #27323a;
  font-size: 0.72rem;
}

.schema-panel__empty button {
  height: 1.9rem;
  margin-top: 0.3rem;
  border: 1px solid #d8c6ff;
  border-radius: 0.25rem;
  background: #faf7ff;
  color: #7b2ff7;
  cursor: pointer;
  padding: 0 0.6rem;
  font-size: 0.65rem;
}

.schema-panel__footer {
  min-height: 1.8rem;
  justify-content: space-between;
  gap: 0.5rem;
  border-top: 1px solid #dbe3ea;
  color: #8a949b;
  padding: 0 0.65rem;
  font-size: 0.58rem;
}
</style>
