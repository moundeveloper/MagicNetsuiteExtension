<script setup lang="ts">
import { computed, ref, useId } from "vue";
import Button from "primevue/button";
import DOMPurify from "dompurify";
import MCard from "../../components/universal/card/MCard.vue";
import MInput from "../../components/universal/input/MInput.vue";
import MSelect from "../../components/universal/input/MSelect.vue";
import DashboardTable from "./DashboardTable.vue";
import {
  readPath,
  resolveBindings,
  validateActionInput,
  type DashboardDefinition,
  type DashboardNode,
} from "./api";
const props = defineProps<{
  node: DashboardNode;
  definition: DashboardDefinition;
  scope: Record<string, unknown>;
  busy: Record<string, boolean>;
  depth?: number;
}>();
const emit = defineEmits<{
  change: [path: string, value: unknown];
  run: [actionId: string, input?: any];
  patch: [patch: Record<string, unknown>];
}>();
const p = computed<Record<string, any>>(() =>
  resolveBindings(
    { ...custom.value?.defaults, ...props.node.props },
    props.scope,
    true,
  ),
);
const instanceId = useId();
const boundPath = computed(() => resolveBindings(props.node.bind, props.scope));
const actionId = computed(() =>
  resolveBindings(props.node.actionId, props.scope),
);
const defaults = computed(
  () => props.node.slots?.default || props.node.children || [],
);
const repeatItems = computed(() =>
  Array.isArray(p.value.items)
    ? p.value.items.slice(0, Math.min(1000, p.value.maxItems || 1000))
    : [],
);
const suppliedSlot = computed(
  () =>
    ((props.scope.$slots || {}) as Record<string, DashboardNode[]>)[
      p.value.name || "default"
    ],
);
const suppliedScope = computed(() => ({
  ...((props.scope.$slotScope || props.scope) as Record<string, unknown>),
  slot: p.value.scope || {},
  item: props.scope.item,
  index: props.scope.index,
}));
const value = computed(() =>
  typeof boundPath.value === "string"
    ? readPath(props.scope, boundPath.value)
    : undefined,
);
const visible = computed(
  () =>
    props.node.visible === undefined ||
    Boolean(resolveBindings(props.node.visible, props.scope)),
);
const custom = computed(
  () => props.definition.components[props.node.type.slice(7)],
);
const customError = computed(() => {
  if (!custom.value?.propsSchema) return "";
  try {
    validateActionInput(custom.value.propsSchema, p.value, "component props");
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
});
const customScope = computed(() => ({
  ...props.scope,
  props: p.value,
  $slots: props.node.slots || {},
  $slotScope: props.scope,
  $emit: (name: string, event: any) => dispatch(name, event),
}));
const tab = ref("");
const activeTab = computed(
  () =>
    defaults.value.find(
      (n) => n.id === (value.value || tab.value || p.value.value),
    ) || defaults.value[0],
);
const text = (v: unknown) =>
  v === undefined || v === null
    ? "—"
    : typeof v === "object"
      ? JSON.stringify(v, null, 2)
      : String(v);
const rows = computed(() => (Array.isArray(p.value.rows) ? p.value.rows : []));
const columns = computed(() =>
  Array.isArray(p.value.columns)
    ? p.value.columns
    : Object.keys(rows.value[0] || {}).map((field) => ({
        field,
        label: field,
      })),
);
const chartMax = computed(() =>
  Math.max(
    1,
    ...rows.value.map((row) => Number(row[p.value.valueField || "value"]) || 0),
  ),
);
const safeHtml = computed(() =>
  DOMPurify.sanitize(String(p.value.html || ""), {
    USE_PROFILES: { html: true, svg: true },
    FORBID_TAGS: [
      "select",
      "option",
      "style",
      "iframe",
      "form",
      "input",
      "button",
      "textarea",
      "a",
    ],
    FORBID_ATTR: ["style", "src", "href", "xlink:href"],
  }),
);
const dispatch = (name: string, event: any = {}) => {
  const scope = { ...props.scope, props: p.value, event };
  if (typeof props.scope.$emit === "function")
    (props.scope.$emit as Function)(name, event);
  const handlers = props.node.events?.[name];
  for (const handler of Array.isArray(handlers)
    ? handlers
    : handlers
      ? [handlers]
      : []) {
    if (handler.setState)
      emit("patch", resolveBindings(handler.setState, scope));
    if (handler.actionId) {
      const action = props.definition.actions.find(
        (a) => a.id === handler.actionId,
      );
      emit(
        "run",
        handler.actionId,
        resolveBindings(
          handler.input === undefined ? action?.input : handler.input,
          scope,
        ),
      );
    }
  }
};
const change = (v: unknown) => {
  if (typeof boundPath.value === "string") emit("change", boundPath.value, v);
  dispatch("change", { value: v });
};
const run = () => {
  dispatch("click", { value: value.value });
  if (typeof actionId.value === "string") {
    const action = props.definition.actions.find(
      (a) => a.id === actionId.value,
    );
    emit(
      "run",
      actionId.value,
      resolveBindings(
        props.node.input === undefined ? action?.input : props.node.input,
        props.scope,
      ),
    );
  }
};
</script>

<template>
  <div
    v-if="visible && (depth || 0) < 14"
    class="dashboard-node"
    :class="[
      `node-${node.type.replace(':', '-')}`,
      `tone-${p.tone || 'default'}`,
    ]"
    :style="[
      node.style,
      node.type === 'repeat' ? { flexDirection: p.direction || 'column' } : {},
    ]"
  >
    <template v-if="node.type.startsWith('custom:')">
      <p v-if="customError" class="component-error" role="alert">
        {{ node.type }}: {{ customError }}
      </p>
      <template v-else
        ><DashboardNode
          v-for="child in custom?.template"
          :key="child.id"
          :node="child"
          :definition="definition"
          :scope="customScope"
          :busy="busy"
          :depth="(depth || 0) + 1"
          @change="(path, v) => emit('change', path, v)"
          @run="(id, input) => emit('run', id, input)"
          @patch="(v) => emit('patch', v)"
      /></template>
    </template>
    <MCard
      v-else-if="node.type === 'card'"
      :outlined="p.outlined !== false"
      :elevated="p.elevated"
      flex
      direction="column"
      :gap="p.gap || '0.65rem'"
      :padding="p.padding || '0.8rem'"
      class="dashboard-card"
    >
      <DashboardNode
        v-for="child in node.slots?.header"
        :key="child.id"
        :node="child"
        :definition="definition"
        :scope="scope"
        :busy="busy"
        :depth="(depth || 0) + 1"
        @change="(path, v) => emit('change', path, v)"
        @run="(id, input) => emit('run', id, input)"
        @patch="(v) => emit('patch', v)"
      />
      <div v-if="!node.slots?.header && (p.title || p.description)">
        <h3>{{ p.title }}</h3>
        <p v-if="p.description" class="muted">{{ p.description }}</p>
      </div>
      <DashboardNode
        v-for="child in defaults"
        :key="child.id"
        :node="child"
        :definition="definition"
        :scope="scope"
        :busy="busy"
        :depth="(depth || 0) + 1"
        @change="(path, v) => emit('change', path, v)"
        @run="(id, input) => emit('run', id, input)"
        @patch="(v) => emit('patch', v)"
      />
      <DashboardNode
        v-for="child in node.slots?.footer"
        :key="child.id"
        :node="child"
        :definition="definition"
        :scope="scope"
        :busy="busy"
        :depth="(depth || 0) + 1"
        @change="(path, v) => emit('change', path, v)"
        @run="(id, input) => emit('run', id, input)"
        @patch="(v) => emit('patch', v)"
      />
    </MCard>
    <div
      v-else-if="node.type === 'grid' || node.type === 'stack'"
      :class="node.type === 'grid' ? 'node-grid-layout' : 'node-stack-layout'"
      :style="
        node.type === 'grid'
          ? {
              '--dashboard-columns': Math.max(
                1,
                Math.min(12, Number(p.columns) || 2),
              ),
              gap: p.gap || '0.8rem',
            }
          : {
              flexDirection: p.direction === 'row' ? 'row' : 'column',
              gap: p.gap || '0.8rem',
              flexWrap: p.wrap === false ? 'nowrap' : 'wrap',
            }
      "
    >
      <DashboardNode
        v-for="child in defaults"
        :key="child.id"
        :node="child"
        :definition="definition"
        :scope="scope"
        :busy="busy"
        :depth="(depth || 0) + 1"
        @change="(path, v) => emit('change', path, v)"
        @run="(id, input) => emit('run', id, input)"
        @patch="(v) => emit('patch', v)"
      />
    </div>
    <template v-else-if="node.type === 'tabs'">
      <div class="node-tabs" role="tablist">
        <button
          v-for="child in defaults"
          :id="`tab-${instanceId}-${child.id}`"
          :key="child.id"
          role="tab"
          :aria-selected="activeTab?.id === child.id"
          :aria-controls="`panel-${instanceId}-${child.id}`"
          @click="
            tab = child.id;
            change(child.id);
          "
        >
          {{ child.props?.title || child.id }}
        </button>
      </div>
      <div
        v-if="activeTab"
        :id="`panel-${instanceId}-${activeTab.id}`"
        role="tabpanel"
        :aria-labelledby="`tab-${instanceId}-${activeTab.id}`"
      >
        <DashboardNode
          :key="activeTab.id"
          :node="activeTab"
          :definition="definition"
          :scope="scope"
          :busy="busy"
          :depth="(depth || 0) + 1"
          @change="(path, v) => emit('change', path, v)"
          @run="(id, input) => emit('run', id, input)"
          @patch="(v) => emit('patch', v)"
        />
      </div>
    </template>
    <template v-else-if="node.type === 'repeat'"
      ><div
        v-for="(item, index) in repeatItems"
        :key="p.keyField ? String(item?.[p.keyField]) : index"
        class="repeat-item"
      >
        <DashboardNode
          v-for="child in defaults"
          :key="child.id"
          :node="child"
          :definition="definition"
          :scope="{ ...scope, item, index }"
          :busy="busy"
          :depth="(depth || 0) + 1"
          @change="(path, v) => emit('change', path, v)"
          @run="(id, input) => emit('run', id, input)"
          @patch="(v) => emit('patch', v)"
        />
      </div>
      <template v-if="!repeatItems.length"
        ><DashboardNode
          v-for="child in node.slots?.empty"
          :key="child.id"
          :node="child"
          :definition="definition"
          :scope="scope"
          :busy="busy"
          :depth="(depth || 0) + 1"
          @change="(path, v) => emit('change', path, v)"
          @run="(id, input) => emit('run', id, input)"
          @patch="(v) => emit('patch', v)"
        />
        <p v-if="!node.slots?.empty" class="muted">
          {{ p.emptyText || "No items." }}
        </p></template
      ></template
    >
    <template v-else-if="node.type === 'slot'"
      ><DashboardNode
        v-for="child in suppliedSlot || defaults"
        :key="child.id"
        :node="child"
        :definition="definition"
        :scope="suppliedSlot ? suppliedScope : scope"
        :busy="busy"
        :depth="(depth || 0) + 1"
        @change="(path, v) => emit('change', path, v)"
        @run="(id, input) => emit('run', id, input)"
        @patch="(v) => emit('patch', v)"
    /></template>
    <p
      v-else-if="node.type === 'text'"
      class="node-text"
      :class="{ muted: p.tone === 'muted' }"
    >
      {{ text(p.text) }}
    </p>
    <MCard v-else-if="node.type === 'metric'" outlined class="node-metric"
      ><span class="muted">{{ p.label }}</span
      ><strong>{{ text(p.value) }}</strong
      ><small v-if="p.hint" class="muted">{{ p.hint }}</small
      ><DashboardNode
        v-for="child in [...defaults, ...(node.slots?.footer || [])]"
        :key="child.id"
        :node="child"
        :definition="definition"
        :scope="scope"
        :busy="busy"
        :depth="(depth || 0) + 1"
        @change="(path, v) => emit('change', path, v)"
        @run="(id, input) => emit('run', id, input)"
        @patch="(v) => emit('patch', v)"
    /></MCard>
    <span v-else-if="node.type === 'badge'" class="node-badge">{{
      text(p.text)
    }}</span>
    <label v-else-if="node.type === 'input'" class="node-field"
      ><span>{{ p.label }}</span
      ><MInput
        :model-value="
          value === undefined || value === null ? '' : String(value)
        "
        :type="['number', 'date'].includes(p.inputType) ? p.inputType : 'text'"
        :placeholder="p.placeholder"
        :disabled="p.disabled"
        :readonly="p.readonly"
        outlined
        @keydown.enter="dispatch('enter', { value })"
        @update:model-value="
          (v) => change(p.inputType === 'number' && v !== '' ? Number(v) : v)
        "
    /></label>
    <label v-else-if="node.type === 'textarea'" class="node-field"
      ><span>{{ p.label }}</span
      ><textarea
        :value="value === undefined || value === null ? '' : String(value)"
        :placeholder="p.placeholder"
        :rows="p.rows || 4"
        :disabled="p.disabled"
        :readonly="p.readonly"
        @input="change(($event.target as HTMLTextAreaElement).value)"
      />
    </label>
    <div v-else-if="node.type === 'select'" class="node-field">
      <span>{{ p.label }}</span
      ><MSelect
        :model-value="value as string | number | null"
        :options="Array.isArray(p.options) ? p.options : []"
        :placeholder="p.placeholder"
        :searchable="p.searchable !== false"
        :disabled="p.disabled"
        @update:model-value="change"
      />
    </div>
    <label v-else-if="node.type === 'toggle'" class="node-toggle"
      ><input
        type="checkbox"
        :checked="Boolean(value)"
        :disabled="p.disabled"
        @change="change(($event.target as HTMLInputElement).checked)"
      />{{ p.label }}</label
    >
    <Button
      v-else-if="node.type === 'button'"
      :label="
        p.label || definition.actions.find((a) => a.id === actionId)?.title
      "
      :icon="typeof p.icon === 'string' ? p.icon : undefined"
      :loading="
        busy[actionId || ''] ||
        Object.entries(node.events || {}).some(
          ([event, handlers]) =>
            event === 'click' &&
            (Array.isArray(handlers) ? handlers : [handlers]).some(
              (h) => busy[h.actionId || ''],
            ),
        )
      "
      :disabled="p.disabled || Object.values(busy).some(Boolean)"
      :severity="p.severity"
      :outlined="p.outlined"
      :text="p.text"
      :size="p.size || 'small'"
      @click="run"
      ><template v-if="defaults.length" #default
        ><DashboardNode
          v-for="child in defaults"
          :key="child.id"
          :node="child"
          :definition="definition"
          :scope="scope"
          :busy="busy"
          :depth="(depth || 0) + 1" /></template
    ></Button>
    <DashboardTable
      v-else-if="node.type === 'table'"
      :rows="rows"
      :columns="columns"
      :options="p"
      :value="value"
      :definition="definition"
      :scope="scope"
      :busy="busy"
      :node-slots="node.slots"
      class="node-table"
      @selection-change="
        (v) => {
          if (typeof boundPath === 'string') emit('change', boundPath, v);
        }
      "
      @change="(path, v) => emit('change', path, v)"
      @run="(id, input) => emit('run', id, input)"
      @event="dispatch"
      @patch="(v) => emit('patch', v)"
    />
    <div v-else-if="node.type === 'json'">
      <h4 v-if="p.label">{{ p.label }}</h4>
      <pre class="node-json">{{ text(p.value) }}</pre>
    </div>
    <label v-else-if="node.type === 'progress'" class="node-field"
      ><span
        >{{ p.label }} ·
        {{ Math.max(0, Math.min(100, Number(p.value) || 0)) }}%</span
      ><progress :value="Number(p.value) || 0" max="100"
    /></label>
    <div v-else-if="node.type === 'barChart'" class="node-chart">
      <h4>{{ p.label }}</h4>
      <div v-for="(row, i) in rows" :key="i" class="chart-row">
        <span>{{ row[p.labelField || "label"] }}</span>
        <div class="chart-track">
          <div
            class="chart-bar"
            :style="{
              width: `${(Math.max(0, Number(row[p.valueField || 'value']) || 0) / chartMax) * 100}%`,
            }"
          />
        </div>
        <strong>{{ row[p.valueField || "value"] }}</strong>
      </div>
      <p v-if="!rows.length" class="muted">No data yet.</p>
    </div>
    <div
      v-else-if="node.type === 'richText'"
      class="node-rich-text"
      v-html="safeHtml"
    />
    <hr v-else-if="node.type === 'divider'" />
  </div>
</template>

<style scoped>
.dashboard-node {
  min-width: 0;
}
.node-repeat {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.repeat-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.tone-success {
  color: var(--p-green-500);
}
.tone-warning {
  color: var(--p-orange-500);
}
.tone-danger {
  color: var(--p-red-500);
}
.tone-info {
  color: var(--p-blue-500);
}
h3,
h4,
p {
  margin: 0;
}
h3 {
  font-size: 0.95rem;
}
h4 {
  font-size: 0.8rem;
  margin-bottom: 0.5rem;
}
.muted {
  color: var(--p-text-muted-color);
  font-size: 0.78rem;
  line-height: 1.6;
}
.node-field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.8rem;
}
.node-field textarea {
  background: var(--p-content-background);
  color: var(--p-text-color);
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  padding: 0.65rem;
  resize: vertical;
}
.node-grid-layout {
  display: grid;
  grid-template-columns: repeat(var(--dashboard-columns), minmax(0, 1fr));
  gap: 1rem;
}
.node-stack-layout {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}
.node-stack-layout > .dashboard-node {
  flex: 1;
}
.node-metric strong {
  display: block;
  font-size: 2rem;
  letter-spacing: -0.04em;
  margin: 0.4rem 0;
}
.component-error {
  color: var(--p-red-400);
  font-size: 0.8rem;
}
.node-badge {
  display: inline-flex;
  padding: 0.3rem 0.65rem;
  border-radius: 20px;
  background: var(--p-highlight-background);
  color: var(--p-highlight-color);
  font-size: 0.75rem;
}
.tone-success .node-badge {
  color: var(--p-green-500);
}
.tone-warning .node-badge {
  color: var(--p-orange-500);
}
.tone-danger .node-badge {
  color: var(--p-red-500);
}
.tone-info .node-badge {
  color: var(--p-blue-500);
}
.node-json {
  white-space: pre-wrap;
  overflow: auto;
  max-height: 400px;
  font:
    12px/1.7 "JetBrains Mono",
    monospace;
  background: var(--p-content-hover-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  padding: 1rem;
}
.node-text {
  white-space: pre-wrap;
  line-height: 1.6;
}
.node-toggle {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.node-field progress {
  width: 100%;
  accent-color: var(--p-primary-color);
}
.node-tabs {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--p-content-border-color);
}
.node-tabs button {
  padding: 0.6rem;
  background: transparent;
  border: 0;
  color: var(--p-text-muted-color);
  cursor: pointer;
}
.node-tabs button[aria-selected="true"] {
  color: var(--p-primary-color);
  border-bottom: 2px solid var(--p-primary-color);
}
.chart-row {
  display: grid;
  grid-template-columns: minmax(60px, 1fr) 3fr 50px;
  gap: 1rem;
  align-items: center;
  font-size: 0.8rem;
  margin: 0.8rem 0;
}
.chart-track {
  background: var(--p-content-hover-background);
  border-radius: 4px;
  height: 14px;
}
.chart-bar {
  height: 100%;
  background: var(--p-primary-color);
  border-radius: 4px;
  transition: width 0.25s;
}
.node-rich-text {
  overflow: hidden;
}
.node-rich-text :deep(svg) {
  max-width: 100%;
}
hr {
  border: 0;
  border-top: 1px solid var(--p-content-border-color);
}
@container (max-width:600px) {
  .node-grid-layout {
    grid-template-columns: 1fr;
  }
}
</style>
