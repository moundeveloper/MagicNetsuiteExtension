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

    <div class="schema-panel__controls">
      <div class="schema-panel__search">
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
      <MSelect
        v-if="activeTab === 'fields'"
        v-model="fieldTypeFilter"
        class="schema-panel__filter"
        :options="fieldTypeOptions"
        option-label="label"
        option-value="value"
        size="small"
        aria-label="Filter fields by data type"
      />
      <MSelect
        v-else-if="activeTab === 'joins'"
        v-model="relationshipTypeFilter"
        class="schema-panel__filter"
        :options="relationshipTypeOptions"
        option-label="label"
        option-value="value"
        size="small"
        aria-label="Filter joins by relationship type"
      />
    </div>

    <Transition name="copy-feedback">
      <div v-if="copyFeedback" class="schema-copy-feedback" role="status" aria-live="polite">
        <i class="pi pi-check-circle" />
        <span>{{ copyFeedback }}</span>
      </div>
    </Transition>

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
          v-if="queryStructure.nodes.length"
          class="query-structure"
          aria-label="Tables referenced by the current query"
        >
          <div class="schema-section-heading">
            <span>Current query structure</span>
            <small>
              {{ queryStructure.nodes.length }} tables ·
              {{ queryStructure.edges.length }} joins
            </small>
          </div>
          <div class="query-structure__source">
            <span>FROM</span>
            <button
              type="button"
              :title="queryStructure.nodes[0]?.table"
              @click="openQueryNode(queryStructure.nodes[0])"
            >
              <strong>{{ queryStructure.nodes[0]?.table }}</strong>
              <small v-if="queryStructure.nodes[0]?.alias !== queryStructure.nodes[0]?.table">
                alias {{ queryStructure.nodes[0]?.alias }}
              </small>
            </button>
          </div>
          <div class="query-structure__joins">
            <article
              v-for="edge in queryStructure.edges"
              :key="`${edge.sourceAlias}-${edge.targetAlias}`"
              :class="{ 'query-join--warning': !edge.hasCondition }"
            >
              <div class="query-join__type">
                <span>{{ edge.joinType }} JOIN</span>
                <small v-if="!edge.hasCondition">Missing ON condition</small>
              </div>
              <div class="query-join__nodes">
                <button type="button" @click="openQueryTable(edge.sourceTable)">
                  <strong>{{ edge.sourceAlias }}</strong>
                  <small>{{ edge.sourceTable }}</small>
                </button>
                <i class="pi pi-arrow-right" />
                <button type="button" @click="openQueryTable(edge.targetTable)">
                  <strong>{{ edge.targetAlias }}</strong>
                  <small>{{ edge.targetTable }}</small>
                </button>
              </div>
              <div v-if="edge.fieldPairs.length" class="query-join__mappings">
                <div
                  v-for="pair in edge.fieldPairs"
                  :key="`${pair.leftAlias}.${pair.leftField}-${pair.rightAlias}.${pair.rightField}`"
                >
                  <code>{{ pair.leftAlias }}.{{ pair.leftField }}</code>
                  <span>=</span>
                  <code>{{ pair.rightAlias }}.{{ pair.rightField }}</code>
                </div>
              </div>
              <code v-else-if="edge.condition" class="query-join__condition">
                {{ edge.condition }}
              </code>
            </article>
          </div>
          <p>
            Aliases and field mappings above come directly from the active SQL.
            Select a table to compare the query with NetSuite metadata.
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

      <section v-else-if="activeTab === 'fields'" class="table-detail-view">
        <div v-if="isLoadingDetail" class="schema-panel__empty">
          <i class="pi pi-spin pi-spinner" />
          <span>Loading fields…</span>
        </div>
        <div v-else class="schema-list field-list">
          <button
            v-for="field in filteredFields"
            :key="`${field.tableId}_${field.id}`"
            type="button"
            class="schema-field-item"
            :class="{ 'schema-field-item--copied': copiedValue === field.id }"
            :title="`Copy ${field.id}`"
            @click="copyValue(field.id)"
          >
            <div class="schema-field-item__topline">
              <code :title="field.id">{{ field.id }}</code>
              <span>
                <template v-if="copiedValue === field.id">
                  <i class="pi pi-check" /> Copied
                </template>
                <template v-else>
                  {{ field.dataType || "Unknown" }} <i class="pi pi-copy" />
                </template>
              </span>
            </div>
            <strong :title="field.label">{{ field.label }}</strong>
            <small v-if="field.fieldType && field.fieldType !== field.dataType">
              NetSuite field type: {{ field.fieldType }}
            </small>
          </button>
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
        <details class="relationship-legend">
          <summary><i class="pi pi-info-circle" /> How relationships work</summary>
          <div class="relationship-legend__content">
            <p>
              The relationship type tells you where NetSuite gets the field mapping.
              Cardinality tells you whether a join can multiply rows. Neither one
              chooses the SQL join type; use the copy buttons on a relationship to
              decide which side's unmatched rows to keep.
            </p>
            <section>
              <h4>Relationship types</h4>
              <article v-for="item in relationshipLegend" :key="item.term">
                <strong>{{ item.term }}</strong>
                <span>{{ item.description }}</span>
                <code>{{ item.example }}</code>
              </article>
            </section>
            <section>
              <h4>Cardinality and row count</h4>
              <article v-for="item in cardinalityLegend" :key="item.term">
                <strong>{{ item.term }}</strong>
                <span>{{ item.description }}</span>
              </article>
            </section>
            <section>
              <h4>SQL join choice</h4>
              <article v-for="item in sqlJoinLegend" :key="item.term">
                <strong>{{ item.term }}</strong>
                <span>{{ item.description }}</span>
              </article>
            </section>
          </div>
        </details>
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
                @click="selectDetailTab('fields')"
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
            <div class="join-copy-actions" aria-label="Copy completed SQL join">
              <span>Copy completed join</span>
              <div>
                <button
                  v-for="joinKeyword in sqlJoinKeywords"
                  :key="joinKeyword.value"
                  type="button"
                  :disabled="!canCopyJoin(join, joinKeyword.value)"
                  :title="joinCopyTitle(join, joinKeyword.value)"
                  :class="{
                    copied: copiedValue === joinCopyKey(join, joinKeyword.value)
                  }"
                  @click="copyJoin(join, joinKeyword.value)"
                >
                  <i
                    :class="
                      copiedValue === joinCopyKey(join, joinKeyword.value)
                        ? 'pi pi-check'
                        : 'pi pi-copy'
                    "
                  />
                  {{
                    copiedValue === joinCopyKey(join, joinKeyword.value)
                      ? "Copied"
                      : joinKeyword.label
                  }}
                </button>
              </div>
            </div>
            <div class="join-condition">
              <span>Documented field mapping</span>
              <template v-if="join.sourceTargetType?.joinPairs?.length">
                <div
                  v-for="pair in join.sourceTargetType.joinPairs"
                  :key="pair.id"
                  class="join-condition__pair"
                >
                  <code>{{ pair.label }}</code>
                  <small v-if="pair.id">Metadata ID: {{ pair.id }}</small>
                </div>
              </template>
              <code v-else>Not documented by NetSuite</code>
              <small v-if="join.fieldId" class="join-condition__field">
                Relationship field: {{ join.fieldId }}
              </small>
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
      <span v-else-if="activeTab === 'fields'">{{ filteredFields.length }} columns</span>
      <span v-else>{{ filteredJoins.length }} connections</span>
      <span>Read-only documentation</span>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import MSelect from "./universal/input/MSelect.vue";

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

type QueryNode = {
  table: string;
  alias: string;
  role: "source" | "join";
};

type QueryStructure = {
  nodes: QueryNode[];
  edges: Array<{
    sourceAlias: string;
    targetAlias: string;
    sourceTable: string;
    targetTable: string;
    joinType: string;
    condition: string;
    fieldPairs: Array<{
      leftAlias: string;
      leftField: string;
      rightAlias: string;
      rightField: string;
    }>;
    hasCondition: boolean;
  }>;
};

const props = defineProps<{
  activeTab: SchemaTab;
  search: string;
  tables: TableInfo[];
  fields: FieldRow[];
  joins: JoinRow[];
  queryTableIds: string[];
  queryStructure: QueryStructure;
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

const selectedFields = computed(() =>
  props.fields.filter((field) => field.tableId === props.selectedTableId)
);

const selectedJoins = computed(() =>
  props.joins.filter((join) => join.tableId === props.selectedTableId)
);

const fieldTypeFilter = ref("all");
const relationshipTypeFilter = ref("all");
const copiedValue = ref("");
const copyFeedback = ref("");

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
  return selectedFields.value.filter(
    (field) =>
      (fieldTypeFilter.value === "all" ||
        (field.dataType || field.fieldType || "Unknown") === fieldTypeFilter.value) &&
      (!term ||
        field.id.toLowerCase().includes(term) ||
        field.label.toLowerCase().includes(term) ||
        field.dataType.toLowerCase().includes(term) ||
        field.fieldType.toLowerCase().includes(term))
  );
});

const filteredJoins = computed(() => {
  const term = props.search.trim().toLowerCase();
  return selectedJoins.value.filter(
    (join) =>
      (relationshipTypeFilter.value === "all" ||
        (join.joinType || "Unknown") === relationshipTypeFilter.value) &&
      (!term ||
        join.id.toLowerCase().includes(term) ||
        join.label.toLowerCase().includes(term) ||
        join.cardinality.toLowerCase().includes(term) ||
        (join.sourceTargetType?.id ?? "").toLowerCase().includes(term) ||
        (join.sourceTargetType?.label ?? "").toLowerCase().includes(term))
  );
});

const detailTabs = computed(() => [
  { id: "fields" as const, label: "Fields", icon: "pi pi-list", count: selectedFields.value.length },
  { id: "joins" as const, label: "Joins", icon: "pi pi-sitemap", count: selectedJoins.value.length }
]);

const knownFieldDataTypes = [
  "BOOLEAN",
  "CURRENCY",
  "DATE",
  "DATETIME",
  "DURATION",
  "FLOAT",
  "INTEGER",
  "N/A",
  "PERCENT",
  "STRING",
  "Unknown"
];

const knownRelationshipTypes = ["AUTOMATIC", "INVERSE", "POLYMORPHIC", "Unknown"];

const fieldTypeOptions = computed(() => [
  { label: "All field types", value: "all" },
  ...[
    ...new Set([
      ...knownFieldDataTypes,
      ...props.fields.map((field) => field.dataType || field.fieldType || "Unknown")
    ])
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ label: value, value }))
]);

const relationshipTypeOptions = computed(() => [
  { label: "All relationships", value: "all" },
  ...[
    ...new Set([
      ...knownRelationshipTypes,
      ...props.joins.map((join) => join.joinType || "Unknown")
    ])
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ label: readableLabel(value), value }))
]);

const sqlJoinKeywords = [
  { label: "Inner", value: "INNER JOIN" },
  { label: "Left", value: "LEFT OUTER JOIN" },
  { label: "Right", value: "RIGHT OUTER JOIN" },
  { label: "Full", value: "FULL OUTER JOIN" },
  { label: "Cross", value: "CROSS JOIN" }
];

const relationshipLegend = [
  {
    term: "Automatic",
    description: "The source record owns a field that stores the target record's ID. This is the usual lookup/select-field relationship.",
    example: "Transaction.entity = Customer.id"
  },
  {
    term: "Inverse",
    description: "The target record owns the reference back to the source. Joining it commonly returns child rows and can repeat the source row.",
    example: "Customer.id = Transaction.entity"
  },
  {
    term: "Polymorphic",
    description: "One source field can refer to different record types. This entry is one valid target; use its exact documented mapping instead of assuming every stored ID belongs to that table.",
    example: "TransactionLine.entity = Customer.id (one possible target)"
  }
];

const cardinalityLegend = [
  { term: "N:1", description: "Many source rows may match one target row. A source row normally produces at most one match." },
  { term: "1:N", description: "One source row may match many target rows, so the join can duplicate that source row in the result." },
  { term: "N:M", description: "Both sides may have multiple matches. Expect row multiplication and verify totals after joining." }
];

const sqlJoinLegend = [
  { term: "Inner", description: "Keep only rows where the documented condition matches on both sides." },
  { term: "Left", description: "Keep every row from the current source table, even when the target has no match." },
  { term: "Right", description: "Keep every target row, even when the current source table has no match." },
  { term: "Full", description: "Keep unmatched rows from both the source and target tables." },
  { term: "Cross", description: "Pair every source row with every target row; it deliberately has no ON condition and can create a huge result." }
];

const searchPlaceholder = computed(() => {
  if (props.activeTab === "fields") return `Search fields in ${props.selectedTableId}…`;
  if (props.activeTab === "joins") return `Search connections from ${props.selectedTableId}…`;
  return "Search tables by ID or label…";
});

const chooseTable = (table: TableInfo) => {
  emit("update:search", "");
  fieldTypeFilter.value = "all";
  relationshipTypeFilter.value = "all";
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

const writeClipboard = async (value: string) => {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = value;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    const copied = document.execCommand("copy");
    fallback.remove();
    return copied;
  }
};

const showCopied = (key: string, message: string) => {
  copiedValue.value = key;
  copyFeedback.value = message;
  window.setTimeout(() => {
    if (copiedValue.value === key) copiedValue.value = "";
    if (copyFeedback.value === message) copyFeedback.value = "";
  }, 1800);
};

const copyValue = async (value: string) => {
  if (!(await writeClipboard(value))) {
    copyFeedback.value = "Could not copy to the clipboard";
    return;
  }
  showCopied(value, `Field ${value} copied`);
};

const joinCondition = (join: JoinRow) => {
  const documented = (join.sourceTargetType?.joinPairs ?? [])
    .map((pair) => pair.label.trim())
    .filter(Boolean);
  if (documented.length) return documented.join(" AND ");

  const targetId = join.sourceTargetType?.id;
  if (!selectedTable.value || !targetId || !join.fieldId) return "";
  if (join.joinType === "INVERSE") {
    return `${selectedTable.value.id}.id = ${targetId}.${join.fieldId}`;
  }
  return `${selectedTable.value.id}.${join.fieldId} = ${targetId}.id`;
};

const completedJoin = (join: JoinRow, keyword: string) => {
  const targetId = join.sourceTargetType?.id;
  if (!targetId) return "";
  if (keyword === "CROSS JOIN") return `${keyword} ${targetId}`;
  const condition = joinCondition(join);
  return condition ? `${keyword} ${targetId} ON ${condition}` : "";
};

const joinCopyKey = (join: JoinRow, keyword: string) =>
  `${join.tableId}:${join.id}:${keyword}`;

const canCopyJoin = (join: JoinRow, keyword: string) =>
  Boolean(completedJoin(join, keyword));

const joinCopyTitle = (join: JoinRow, keyword: string) => {
  const clause = completedJoin(join, keyword);
  return clause ? `Copy: ${clause}` : "NetSuite did not document enough information to build this join";
};

const copyJoin = async (join: JoinRow, keyword: string) => {
  const clause = completedJoin(join, keyword);
  if (!clause) return;
  if (!(await writeClipboard(clause))) {
    copyFeedback.value = "Could not copy to the clipboard";
    return;
  }
  const key = joinCopyKey(join, keyword);
  showCopied(key, `${readableLabel(keyword)} clause copied`);
};

function readableLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

const openJoinTarget = (join: JoinRow) => {
  const targetId = join.sourceTargetType?.id;
  if (!targetId) return;
  const target = props.tables.find(
    (table) => table.id.toLowerCase() === targetId.toLowerCase()
  );
  if (target) chooseTable(target);
};

const openQueryTable = (tableId: string) => {
  const table = props.tables.find(
    (item) => item.id.toLowerCase() === tableId.toLowerCase()
  );
  if (table) chooseTable(table);
};

const openQueryNode = (node: QueryNode | undefined) => {
  if (node) openQueryTable(node.table);
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

.schema-panel__controls {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.4rem;
  margin: 0.5rem 0.65rem;
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
  color: var(--p-slate-500);
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
  border-color: var(--p-slate-300);
  background: var(--m-slate-150);
  color: var(--p-slate-900);
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
  color: var(--p-slate-900);
}

.schema-breadcrumb > i {
  color: #8a949b;
  font-size: 0.55rem;
}

.schema-breadcrumb strong {
  overflow: hidden;
  color: var(--p-slate-600);
  font-family: "JetBrains Mono", monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schema-panel__search {
  min-width: 0;
  flex: 1;
  gap: 0.4rem;
  border: 1px solid #b4c4d3;
  border-radius: 0.25rem;
  background: white;
  padding-left: 0.55rem;
}

.schema-panel__filter {
  width: 8.8rem;
  flex: 0 0 8.8rem;
}

.schema-panel__filter :deep(.m-select-trigger) {
  height: 2rem;
  min-height: 2rem;
  border-color: #b4c4d3;
  border-radius: 0.25rem;
  font-size: 0.66rem;
}

.schema-panel__filter :deep(.m-select-trigger:focus),
.schema-panel__filter.is-open :deep(.m-select-trigger) {
  border-color: var(--p-slate-400);
  box-shadow: 0 0 0 2px var(--m-slate-150);
}

.schema-copy-feedback {
  display: flex;
  min-height: 1.8rem;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.4rem;
  margin: 0 0.65rem 0.4rem;
  border: 1px solid #d8c6ff;
  border-radius: 0.25rem;
  background: #faf7ff;
  color: #7b2ff7;
  padding: 0.3rem 0.5rem;
  font-size: 0.62rem;
  font-weight: 600;
}

.schema-copy-feedback i {
  font-size: 0.68rem;
}

.copy-feedback-enter-active,
.copy-feedback-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.copy-feedback-enter-from,
.copy-feedback-leave-to {
  transform: translateY(-0.2rem);
  opacity: 0;
}

.schema-panel__search:focus-within {
  border-color: var(--p-slate-400);
  box-shadow: 0 0 0 2px var(--m-slate-150);
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
  margin-top: 0.35rem;
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
  border-color: var(--p-slate-400);
  background: var(--m-slate-250);
  color: var(--p-slate-900);
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
  border: 1px solid var(--p-slate-300);
  border-radius: 0.3rem;
  background: var(--m-slate-150);
  padding: 0.55rem;
}

.query-structure__source {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0 0.35rem;
}

.query-structure__source > span {
  width: 2.6rem;
  flex: 0 0 auto;
  color: #62696e;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.52rem;
  font-weight: 700;
}

.query-structure__source button,
.query-join__nodes button {
  display: inline-flex;
  overflow: hidden;
  min-width: 0;
  flex-direction: column;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.25rem;
  background: white;
  color: var(--p-slate-900);
  cursor: pointer;
  padding: 0.3rem 0.45rem;
  font-family: "JetBrains Mono", monospace;
  text-align: left;
}

.query-structure__source button {
  flex: 1;
}

.query-structure__source strong,
.query-join__nodes strong {
  overflow: hidden;
  max-width: 100%;
  font-size: 0.6rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.query-structure__source small,
.query-join__nodes small {
  overflow: hidden;
  max-width: 100%;
  color: #8a949b;
  font-size: 0.5rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.query-structure__joins {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding-bottom: 0.4rem;
}

.query-structure__joins article {
  border: 1px solid #dbe3ea;
  border-radius: 0.25rem;
  background: white;
  padding: 0.4rem;
}

.query-structure__joins article.query-join--warning {
  border-color: #f3c77b;
  background: #fffaf0;
}

.query-join__type {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  margin-bottom: 0.3rem;
  color: #62696e;
  font-size: 0.52rem;
  font-weight: 700;
}

.query-join__type small {
  color: #9a6700;
  font-weight: 500;
}

.query-join__nodes {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 1rem minmax(0, 1fr);
  align-items: center;
  gap: 0.25rem;
}

.query-join__nodes button:last-child {
  border-color: #b4c4d3;
  color: #27323a;
}

.query-join__nodes > i {
  color: var(--p-slate-500);
  font-size: 0.55rem;
  text-align: center;
}

.query-join__mappings {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.35rem;
  border-top: 1px solid #eef3f7;
  padding-top: 0.35rem;
}

.query-join__mappings > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 0.3rem;
}

.query-join__mappings code,
.query-join__condition {
  overflow: hidden;
  color: #62696e;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.52rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.query-join__mappings code:last-child {
  text-align: right;
}

.query-join__mappings span {
  color: var(--p-slate-500);
  font-size: 0.55rem;
}

.query-join__condition {
  display: block;
  margin-top: 0.35rem;
  border-top: 1px solid #eef3f7;
  padding-top: 0.35rem;
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
  border-color: var(--p-slate-300);
  background: var(--m-slate-150);
}

.schema-table-item > i:first-child {
  color: var(--p-slate-500);
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
  border: 1px solid var(--p-slate-300);
  border-radius: 0.2rem;
  background: var(--m-slate-150);
  color: var(--p-slate-600);
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
  border: 1px solid var(--p-slate-300);
  border-radius: 0.3rem;
  background: var(--m-slate-150);
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
  border-color: var(--p-slate-300);
  background: var(--m-slate-150);
}

.schema-stat-grid i {
  grid-row: 1 / 3;
  color: var(--p-slate-500);
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
  background: var(--p-slate-400);
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
  border-color: var(--p-slate-300);
  background: var(--m-slate-150);
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
  border-color: var(--p-slate-300);
  background: var(--m-slate-150);
  color: var(--p-slate-900);
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
  color: var(--p-slate-500);
  font-size: 0.55rem;
}

.relationship-map__more {
  height: 1.8rem;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.25rem;
  background: var(--m-slate-150);
  color: var(--p-slate-900);
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

.relationship-legend {
  border: 1px solid #dbe3ea;
  border-radius: 0.25rem;
  background: white;
  padding: 0.45rem 0.5rem;
  font-size: 0.58rem;
}

.relationship-legend summary {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: #62696e;
  cursor: pointer;
  font-weight: 600;
  list-style: none;
}

.relationship-legend summary::-webkit-details-marker {
  display: none;
}

.relationship-legend summary::after {
  margin-left: auto;
  color: #8a949b;
  content: "+";
}

.relationship-legend[open] summary::after {
  content: "−";
}

.relationship-legend__content {
  margin: 0.55rem 0 0;
  border-top: 1px solid #eef3f7;
  padding-top: 0.5rem;
}

.relationship-legend__content > p {
  margin: 0 0 0.6rem;
  color: #62696e;
  line-height: 1.45;
}

.relationship-legend__content section + section {
  margin-top: 0.65rem;
}

.relationship-legend__content h4 {
  margin: 0 0 0.35rem;
  color: #27323a;
  font-size: 0.57rem;
  text-transform: uppercase;
}

.relationship-legend__content article {
  display: grid;
  grid-template-columns: 4.8rem minmax(0, 1fr);
  gap: 0.15rem 0.5rem;
  padding: 0.3rem 0;
}

.relationship-legend__content article + article {
  border-top: 1px solid #eef3f7;
}

.relationship-legend__content article strong {
  color: #27323a;
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
}

.relationship-legend__content article span {
  color: #62696e;
  line-height: 1.35;
}

.relationship-legend__content article code {
  grid-column: 2;
  overflow-wrap: anywhere;
  color: var(--p-slate-600);
  font-family: "JetBrains Mono", monospace;
  font-size: 0.52rem;
}

.schema-field-item,
.schema-join-item {
  border: 1px solid #dbe3ea;
  border-radius: 0.25rem;
  background: white;
  padding: 0.45rem 0.5rem;
}

.schema-field-item {
  width: 100%;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.join-copy-actions {
  margin-top: 0.4rem;
  border-top: 1px solid #eef3f7;
  padding-top: 0.4rem;
}

.join-copy-actions > span {
  display: block;
  margin-bottom: 0.3rem;
  color: #8a949b;
  font-size: 0.52rem;
  text-transform: uppercase;
}

.join-copy-actions > div {
  display: flex;
  flex-wrap: wrap;
  gap: 0.22rem;
}

.join-copy-actions button {
  display: inline-flex;
  height: 1.55rem;
  align-items: center;
  gap: 0.22rem;
  border: 1px solid #b4c4d3;
  border-radius: 0.22rem;
  background: white;
  color: #27323a;
  cursor: pointer;
  padding: 0 0.35rem;
  font-size: 0.52rem;
  white-space: nowrap;
}

.join-copy-actions button:hover:not(:disabled),
.join-copy-actions button.copied {
  border-color: var(--p-slate-400);
  background: var(--m-slate-150);
}

.join-copy-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.join-copy-actions button i {
  color: var(--p-slate-500);
  font-size: 0.5rem;
}

.schema-field-item:hover,
.schema-field-item--copied {
  border-color: var(--p-slate-400);
  background: var(--m-slate-150);
}

.schema-field-item__topline span {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.schema-field-item__topline span i {
  font-size: 0.52rem;
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
  color: var(--p-slate-600);
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
  border-color: var(--p-slate-300);
  background: var(--m-slate-150);
  color: var(--p-slate-900);
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
  color: var(--p-slate-500);
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

.join-condition__pair {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.1rem;
  border-left: 2px solid var(--p-slate-300);
  padding-left: 0.4rem;
}

.join-condition__pair small,
.join-condition__field {
  overflow: hidden;
  color: #8a949b;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.5rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.join-condition__field {
  margin-top: 0.15rem;
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
  color: var(--p-slate-500);
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
