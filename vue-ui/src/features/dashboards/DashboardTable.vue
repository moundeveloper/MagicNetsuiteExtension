<script setup lang="ts">
import { computed, h, reactive, ref, watch } from "vue";
import Button from "primevue/button";
import MInput from "../../components/universal/input/MInput.vue";
import MSelect from "../../components/universal/input/MSelect.vue";
import MTableStatic from "../../components/universal/table/MTableStatic.vue";
import MTableColumnStatic from "../../components/universal/table/MTableColumnStatic.vue";
import DashboardNode from "./DashboardNode.vue";
import {
  dashboardCommand,
  resolveBindings,
  type DashboardDefinition,
  type DashboardNode as Node,
} from "./api";
import {
  formatDashboardCell,
  reconcileSelection,
  rowIdentity,
  tableRows,
} from "./tableModel";
const props = defineProps<{
  rows: Record<string, any>[];
  columns: Record<string, any>[];
  options: Record<string, any>;
  value?: any;
  definition: DashboardDefinition;
  scope: Record<string, unknown>;
  busy: Record<string, boolean>;
  nodeSlots?: Record<string, Node[]>;
}>();
const emit = defineEmits<{
  selectionChange: [value: any];
  change: [path: string, value: unknown];
  run: [id: string, input?: any];
  event: [name: string, payload: any];
  patch: [patch: Record<string, unknown>];
}>();
const query = ref("");
const filters = reactive<Record<string, string>>({});
const sortField = ref("");
const sortOrder = ref("asc");
const page = ref(1);
const pageSize = ref(Number(props.options.pageSize) || 25);
const error = ref("");
const key = computed(() => props.options.rowKey || "id");
const selection = computed(() => props.options.selection || "none");
const selected = computed(() =>
  selection.value === "multiple"
    ? Array.isArray(props.value)
      ? props.value
      : []
    : props.value
      ? [props.value]
      : [],
);
const identities = computed(
  () =>
    new Set(
      selected.value.map((r: Record<string, unknown>) =>
        rowIdentity(r, key.value),
      ),
    ),
);
const validKeys = computed(
  () =>
    props.rows.every((r) => r[key.value] !== undefined) &&
    new Set(props.rows.map((r) => rowIdentity(r, key.value))).size ===
      props.rows.length,
);
const filtered = computed(() =>
  tableRows(
    props.rows,
    props.columns,
    query.value,
    filters,
    sortField.value,
    sortOrder.value,
  ),
);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(filtered.value.length / pageSize.value)),
);
const visible = computed(() =>
  props.options.pagination === false
    ? filtered.value
    : filtered.value.slice(
        (page.value - 1) * pageSize.value,
        page.value * pageSize.value,
      ),
);
const sizes = computed(() =>
  [
    ...new Set([
      pageSize.value,
      ...(props.options.pageSizes || [10, 25, 50, 100]),
    ]),
  ].map((value) => ({ label: `${value} rows`, value })),
);
watch(
  [query, () => JSON.stringify(filters), pageSize, sortField, sortOrder],
  () => {
    page.value = 1;
  },
);
watch(pageCount, (count) => {
  page.value = Math.min(page.value, count);
});
watch(
  () => props.rows,
  () => {
    if (selection.value === "none" || !validKeys.value) return;
    const next = reconcileSelection(
      props.rows,
      props.value,
      key.value,
      selection.value === "multiple",
    );
    if (JSON.stringify(next) !== JSON.stringify(props.value))
      emit("selectionChange", next);
  },
);
const select = (row: Record<string, any>) => {
  if (!validKeys.value) return;
  let next: any = row;
  if (selection.value === "multiple") {
    const id = rowIdentity(row, key.value);
    next = identities.value.has(id)
      ? selected.value.filter(
          (r: Record<string, unknown>) => rowIdentity(r, key.value) !== id,
        )
      : [...selected.value, row];
  } else if (identities.value.has(rowIdentity(row, key.value))) next = null;
  emit("selectionChange", next);
  emit("event", "selectionChange", { value: next, rows: props.rows });
};
const selectAll = (clear = false) => {
  const next = clear ? [] : filtered.value;
  emit("selectionChange", next);
  emit("event", "selectionChange", { value: next, rows: props.rows });
};
const sort = (field: string) => {
  sortOrder.value =
    sortField.value === field && sortOrder.value === "asc" ? "desc" : "asc";
  sortField.value = field;
  emit("event", "sort", { field, order: sortOrder.value });
};
const movePage = (delta: number) => {
  page.value = Math.min(pageCount.value, Math.max(1, page.value + delta));
  emit("event", "page", { page: page.value, pageSize: pageSize.value });
};
const rowScope = (row: Record<string, any>, value?: unknown) => ({
  ...props.scope,
  item: row,
  index: props.rows.indexOf(row),
  slot: { row, value },
});
const slotNodes = (nodes: Node[], row: Record<string, any>, value?: unknown) =>
  nodes.map((n) =>
    h(DashboardNode, {
      key: n.id,
      node: n,
      definition: props.definition,
      scope: rowScope(row, value),
      busy: props.busy,
      onChange: (path: string, v: unknown) => emit("change", path, v),
      onRun: (id: string, input?: any) => emit("run", id, input),
      onPatch: (patch: Record<string, unknown>) => emit("patch", patch),
    }),
  );
const openRecord = async (
  row: Record<string, any>,
  column: Record<string, any>,
) => {
  try {
    error.value = "";
    const type = resolveBindings(column.recordType, rowScope(row));
    const url = await dashboardCommand<string>("recordUrl", {
      dashboardId: props.definition.name,
      recordType: type,
      recordId: row[column.recordIdField || key.value],
    });
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname.endsWith(".netsuite.com")
    )
      throw new Error("NetSuite returned an invalid record URL.");
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
};
const Body = () =>
  h(
    MTableStatic,
    {
      rows: visible.value,
      sortField: sortField.value,
      sortOrder: sortOrder.value,
      onSort: sort,
    },
    {
      default: () => [
        ...(selection.value === "none"
          ? []
          : [
              h(
                MTableColumnStatic,
                {
                  field: "__selection",
                  label: "Select",
                  width: "60px",
                  searchable: false,
                },
                {
                  default: ({ row }: any) =>
                    h("input", {
                      type:
                        selection.value === "multiple" ? "checkbox" : "radio",
                      checked: identities.value.has(
                        rowIdentity(row, key.value),
                      ),
                      disabled: !validKeys.value,
                      "aria-label": `Select row ${row[key.value]}`,
                      onChange: () => select(row),
                    }),
                },
              ),
            ]),
        ...props.columns.map((column) =>
          h(
            MTableColumnStatic,
            {
              key: column.field,
              field: column.field,
              label: column.label || column.field,
              width: column.width,
              sortable:
                props.options.sortable !== false && column.sortable !== false,
            },
            {
              default: ({ row, value }: any) => {
                const nodes = props.nodeSlots?.[`cell:${column.field}`];
                if (nodes) return slotNodes(nodes, row, value);
                if (column.actionId)
                  return h(Button, {
                    label: formatDashboardCell(value, column),
                    size: "small",
                    loading: props.busy[column.actionId],
                    disabled: Object.values(props.busy).some(Boolean),
                    onClick: () =>
                      emit(
                        "run",
                        column.actionId,
                        resolveBindings(
                          column.input ?? { $bind: "item" },
                          rowScope(row),
                        ),
                      ),
                  });
                if (column.recordType)
                  return h(
                    "button",
                    {
                      class: "dashboard-record-link",
                      onClick: () => openRecord(row, column),
                    },
                    formatDashboardCell(value, column),
                  );
                if (column.format === "badge")
                  return h(
                    "span",
                    {
                      class: `dashboard-cell-badge tone-${column.tone || "default"}`,
                    },
                    formatDashboardCell(value, column),
                  );
                return h(
                  "span",
                  { onClick: () => emit("event", "rowClick", { row, value }) },
                  formatDashboardCell(value, column),
                );
              },
            },
          ),
        ),
        ...(props.nodeSlots?.rowActions
          ? [
              h(
                MTableColumnStatic,
                { field: "__actions", label: "Actions" },
                {
                  default: ({ row }: any) =>
                    slotNodes(props.nodeSlots!.rowActions!, row),
                },
              ),
            ]
          : []),
      ],
      empty: () =>
        props.nodeSlots?.empty
          ? slotNodes(props.nodeSlots.empty, {})
          : h(
              "p",
              { class: "table-empty" },
              props.options.emptyText || "No rows.",
            ),
    },
  );
</script>
<template>
  <div class="dashboard-data-table">
    <div class="table-toolbar">
      <MInput
        v-if="options.searchable !== false"
        v-model="query"
        type="search"
        placeholder="Search all rows…"
        outlined
      /><span v-if="selection !== 'none'" class="table-count"
        >{{ selected.length }} selected</span
      ><template v-if="selection === 'multiple'"
        ><Button
          label="Select all"
          size="small"
          text
          :disabled="!validKeys"
          @click="selectAll()" /><Button
          label="Clear"
          size="small"
          text
          @click="selectAll(true)" /></template
      ><DashboardNode
        v-for="n in nodeSlots?.toolbar"
        :key="n.id"
        :node="n"
        :definition="definition"
        :scope="scope"
        :busy="busy"
        @change="(path, v) => emit('change', path, v)"
        @run="(id, input) => emit('run', id, input)"
        @patch="(v) => emit('patch', v)"
      />
    </div>
    <p v-if="error" role="alert" class="table-error">{{ error }}</p>
    <p
      v-if="selection !== 'none' && !validKeys"
      role="alert"
      class="table-error"
    >
      Selection requires a unique {{ key }} on every row.
    </p>
    <div
      v-if="options.filterable !== false"
      class="table-filters"
      :style="{
        gridTemplateColumns: `${selection !== 'none' ? '60px ' : ''}${columns.map((c) => c.width || 'minmax(100px,1fr)').join(' ')}${nodeSlots?.rowActions ? ' 1fr' : ''}`,
      }"
    >
      <span v-if="selection !== 'none'" /><MInput
        v-for="col in columns"
        :key="col.field"
        v-model="filters[col.field]"
        :disabled="col.filterable === false"
        :placeholder="`Filter ${col.label || col.field}`"
        outlined
      /><span v-if="nodeSlots?.rowActions" />
    </div>
    <div class="table-body"><Body /></div>
    <div v-if="options.pagination !== false" class="table-pagination">
      <span>{{ filtered.length }} rows · page {{ page }} / {{ pageCount }}</span
      ><MSelect v-model="pageSize" :options="sizes" size="small" /><Button
        icon="pi pi-angle-left"
        aria-label="Previous page"
        size="small"
        text
        :disabled="page === 1"
        @click="movePage(-1)"
      /><Button
        icon="pi pi-angle-right"
        aria-label="Next page"
        size="small"
        text
        :disabled="page >= pageCount"
        @click="movePage(1)"
      />
    </div>
  </div>
</template>
<style scoped>
.dashboard-data-table {
  min-width: 0;
}
.table-toolbar,
.table-pagination {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
  font-size: 0.75rem;
}
.table-toolbar {
  margin-bottom: 0.6rem;
}
.table-toolbar :deep(.m-input) {
  flex: 1;
  max-width: 320px;
}
.table-count {
  color: var(--p-text-muted-color);
}
.table-filters {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  overflow: auto;
}
.table-filters :deep(.m-input) {
  min-width: 0;
  width: 100%;
  font-size: 0.7rem;
  padding: 0.4rem;
}
.table-body {
  overflow: auto;
}
.table-pagination {
  justify-content: flex-end;
  margin-top: 0.5rem;
}
.table-pagination > span {
  margin-right: auto;
  color: var(--p-text-muted-color);
}
.table-pagination :deep(.m-select) {
  width: 110px;
}
.table-error {
  color: var(--p-red-400);
  font-size: 0.75rem;
}
.dashboard-data-table :deep(.dashboard-record-link) {
  background: none;
  border: 0;
  color: var(--p-primary-color);
  cursor: pointer;
  text-decoration: underline;
}
.dashboard-data-table :deep(.dashboard-cell-badge) {
  padding: 0.2rem 0.5rem;
  border-radius: 20px;
  background: var(--p-highlight-background);
  font-size: 0.7rem;
}
.dashboard-data-table :deep(.dashboard-cell-badge.tone-success) {color:var(--p-green-500);}
.dashboard-data-table :deep(.dashboard-cell-badge.tone-warning) {color:var(--p-orange-500);}
.dashboard-data-table :deep(.dashboard-cell-badge.tone-danger) {color:var(--p-red-500);}
.dashboard-data-table :deep(.dashboard-cell-badge.tone-info) {color:var(--p-blue-500);}
.dashboard-data-table :deep(.m-table-sort) {
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  display: flex;
  gap: 0.4rem;
  align-items: center;
}
.table-empty {
  color: var(--p-text-muted-color);
  font-size: 0.8rem;
}
</style>
