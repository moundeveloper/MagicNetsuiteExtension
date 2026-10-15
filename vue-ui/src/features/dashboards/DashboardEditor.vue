<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import MSelect from "../../components/universal/input/MSelect.vue";
import DashboardNode from "./DashboardNode.vue";
import {
  dashboardCatalog,
  dashboardCommand,
  validateDashboard,
  type Dashboard,
  type DashboardDefinition,
} from "./api";
const MonacoCodeEditor = defineAsyncComponent(
  () => import("../../components/MonacoCodeEditor.vue"),
);
const props = defineProps<{
  dashboard?: Dashboard;
  initial: DashboardDefinition;
}>();
const emit = defineEmits<{ close: []; saved: [dashboard: Dashboard] }>();
const source = ref(JSON.stringify(props.initial, null, 2));
const tab = ref("definition");
const actionId = ref(props.initial.actions[0]?.id || "");
const stepId = ref(props.initial.actions[0]?.steps[0]?.id || "");
const error = ref("");
const saving = ref(false);
const parsed = computed<DashboardDefinition | null>(() => {
  try {
    return JSON.parse(source.value);
  } catch {
    return null;
  }
});
const validation = computed(() => {
  try {
    validateDashboard(parsed.value);
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
});
const actions = computed(() =>
  Array.isArray(parsed.value?.actions) ? parsed.value!.actions : [],
);
const action = computed(() =>
  actions.value.find((a) => a.id === actionId.value),
);
const steps = computed(() =>
  Array.isArray(action.value?.steps) ? action.value!.steps : [],
);
const step = computed(
  () => steps.value.find((s) => s.id === stepId.value) || steps.value[0],
);
const editCode = (code: string) => {
  if (!parsed.value || !step.value) return;
  const d = JSON.parse(source.value) as DashboardDefinition;
  const s = d.actions
    .find((a) => a.id === actionId.value)
    ?.steps.find((s) => s.id === step.value!.id);
  if (s) {
    if (s.codeFile) (d.sourceFiles ??= {})[s.codeFile] = code;
    else s.code = code;
    source.value = JSON.stringify(d, null, 2);
  }
};
const componentSource = ref(JSON.stringify(props.initial.components, null, 2));
const editComponents = (value: string) => {
  componentSource.value = value;
  try {
    const components = JSON.parse(value);
    const d = JSON.parse(source.value);
    d.components = components;
    source.value = JSON.stringify(d, null, 2);
    error.value = "";
  } catch {
    error.value = "Custom components must be valid JSON.";
  }
};
const setTab = (value: string) => {
  if (value === "components" && parsed.value)
    componentSource.value = JSON.stringify(parsed.value.components, null, 2);
  tab.value = value;
};
const save = async () => {
  error.value = "";
  saving.value = true;
  try {
    if (tab.value === "components") JSON.parse(componentSource.value);
    validateDashboard(parsed.value);
    const result = props.dashboard
      ? await dashboardCommand<Dashboard>("update", {
          dashboardId: props.dashboard.id,
          expectedRevision: props.dashboard.revision,
          patch: parsed.value,
          verbose: true,
        })
      : await dashboardCommand<Dashboard>("create", {
          definition: parsed.value,
          verbose: true,
        });
    emit("saved", result);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <Dialog
    visible
    modal
    :header="dashboard ? `Edit ${dashboard.title}` : 'Create dashboard'"
    :style="{ width: 'min(1200px,96vw)' }"
    @update:visible="
      (v) => {
        if (!v) emit('close');
      }
    "
  >
    <div class="editor-toolbar">
      <button
        v-for="item in [
          'definition',
          'actions',
          'components',
          'preview',
          'catalog',
        ]"
        :key="item"
        :class="{ active: tab === item }"
        @click="setTab(item)"
      >
        {{ item }}</button
      ><span class="muted"
        >{{ parsed?.mode || "Choose a mode in the definition" }} ·
        {{ actions.length }} actions</span
      >
    </div>
    <div class="editor-body">
      <template v-if="tab === 'definition'"
        ><p class="editor-help">
          Edit metadata, state, layout and actions. Bind values with
          <code>{"$bind":"state.field"}</code> or
          <code>{"$bind":"results.actionId.result.field"}</code>. Saving never
          runs code.
        </p>
        <MonacoCodeEditor
          v-model="source"
          language="json"
          :options="{
            minimap: { enabled: false },
            fontSize: 13,
            occurrencesHighlight: 'off',
            selectionHighlight: false,
          }"
      /></template>
      <template v-else-if="tab === 'actions'">
        <div class="action-toolbar">
          <MSelect
            v-model="actionId"
            :options="actions.map((a) => ({ label: a.title, value: a.id }))"
            placeholder="Choose action"
          /><MSelect
            v-model="stepId"
            :options="
              steps.map((s) => ({
                label: `${s.id} · ${s.domain}`,
                value: s.id,
              }))
            "
            placeholder="Choose step"
          /><span class="muted"
            >{{ action?.risk }} · {{ step?.modules?.join(", ") }}</span
          >
        </div>
        <p class="editor-help">
          Code reads <code>input</code>, <code>previous</code>,
          <code>steps</code> and <code>context.modules</code>. Return JSON.
          Server steps run synchronously. Add actions, steps, schemas and module
          declarations in Definition.
        </p>
        <MonacoCodeEditor
          v-if="step"
          :model-value="
            step.codeFile
              ? parsed?.sourceFiles?.[step.codeFile] || ''
              : step.code || ''
          "
          language="javascript"
          :options="{
            minimap: { enabled: false },
            fontSize: 13,
            occurrencesHighlight: 'off',
            selectionHighlight: false,
          }"
          @update:model-value="editCode"
        />
        <p v-else class="muted">
          Add an action in Definition or ask Claude to create one.
        </p>
      </template>
      <template v-else-if="tab === 'components'"
        ><p class="editor-help">
          Create reusable components as
          <code>{"Name":{"description":"…","template":[nodes]}}</code>. Use
          <code>custom:Name</code> in layout and
          <code>{"$bind":"props.label"}</code> in its template. The richText
          component supports sanitized HTML/SVG for custom visuals.
        </p>
        <MonacoCodeEditor
          :model-value="componentSource"
          language="json"
          :options="{
            minimap: { enabled: false },
            fontSize: 13,
            occurrencesHighlight: 'off',
            selectionHighlight: false,
          }"
          @update:model-value="editComponents"
      /></template>
      <div v-else-if="tab === 'preview'" class="editor-preview">
        <p class="editor-help">
          Preview uses initial state. Save and open the dashboard to run
          actions.
        </p>
        <template v-if="parsed && !validation"
          ><DashboardNode
            v-for="node in parsed.layout"
            :key="node.id"
            :node="node"
            :definition="parsed"
            :scope="{ state: parsed.initialState, results: {}, props: {} }"
            :busy="{ preview: true }"
        /></template>
        <pre v-else>{{ validation }}</pre>
      </div>
      <div v-else class="editor-catalog">
        <article v-for="entry in dashboardCatalog" :key="entry.type">
          <code>{{ entry.type }}</code
          ><strong>{{ entry.component }}</strong>
          <p>{{ entry.props }}</p>
          <p>
            Events: {{ entry.events.join(", ") || "none" }} · Slots:
            {{ entry.slots.join(", ") || "none" }}
          </p>
          <details>
            <summary>Props schema</summary>
            <pre>{{ JSON.stringify(entry.propsSchema, null, 2) }}</pre>
          </details>
        </article>
      </div>
    </div>
    <pre v-if="error || validation" class="editor-error" role="alert">{{
      error || validation
    }}</pre>
    <template #footer
      ><span class="muted">{{
        dashboard
          ? `Editing revision ${dashboard.revision}`
          : "Saved locally in your extension"
      }}</span
      ><Button
        label="Cancel"
        severity="secondary"
        :disabled="saving"
        @click="emit('close')" /><Button
        :label="dashboard ? 'Save dashboard' : 'Create dashboard'"
        :loading="saving"
        :disabled="Boolean(validation)"
        @click="save"
    /></template>
  </Dialog>
</template>

<style scoped>
.editor-toolbar,
.action-toolbar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 0.8rem;
}
.editor-toolbar button {
  text-transform: capitalize;
  background: transparent;
  color: var(--p-text-muted-color);
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 0.5rem 0.8rem;
  cursor: pointer;
}
.editor-toolbar button.active {
  background: var(--p-highlight-background);
  color: var(--p-highlight-color);
  border-color: var(--p-content-border-color);
}
.editor-toolbar .muted {
  margin-left: auto;
}
.muted,
.editor-help {
  color: var(--p-text-muted-color);
  font-size: 0.78rem;
}
.editor-help {
  line-height: 1.8;
  margin: 0 0 0.8rem;
}
.editor-body {
  height: 58vh;
  display: flex;
  flex-direction: column;
  min-height: 300px;
}
.editor-body :deep(.monaco-editor-container) {
  flex: 1;
  min-height: 0;
}
.editor-error {
  color: var(--p-red-400);
  white-space: pre-wrap;
  font-size: 0.75rem;
  max-height: 100px;
  overflow: auto;
}
.editor-preview,
.editor-catalog {
  overflow: auto;
  padding: 0.5rem;
}
.editor-preview {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.editor-catalog {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 0.8rem;
}
.editor-catalog article {
  padding: 1rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
}
.editor-catalog strong {
  display: block;
  font-size: 0.8rem;
  margin: 0.5rem 0;
}
.editor-catalog p {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
  line-height: 1.6;
}
.action-toolbar :deep(.m-select) {
  min-width: 170px;
}
</style>
