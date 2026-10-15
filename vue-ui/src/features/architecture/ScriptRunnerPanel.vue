<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onDeactivated,
  ref,
  watch,
} from "vue";
import MonacoCodeEditor from "../../components/MonacoCodeEditor.vue";
import MSelect from "../../components/universal/input/MSelect.vue";
import type { Project } from "./model";
import {
  defaultScenario,
  parseScenario,
  resolveSource,
  type RuntimeResult,
} from "./runtime/types";
import { startExecution } from "./runtime/client";

const props = defineProps<{ project: Project; selectedId: string }>();
const emit = defineEmits<{
  code: [source: string];
  scenario: [text: string];
  reindex: [];
  finished: [result: RuntimeResult];
  create: [name: string, scriptType: string];
}>();
const resolved = computed(() => resolveSource(props.project, props.selectedId));
const source = computed({
  get: () => resolved.value.module?.source ?? "",
  set: (text: string) => {
    result.value = undefined;
    emit("code", text);
  },
});
const scenarioText = ref(
  props.project.scenarioText ||
    JSON.stringify(
      defaultScenario(
        resolved.value.script?.metadata.scriptType ||
          resolved.value.module?.metadata.scriptType,
      ),
      null,
      2,
    ),
);
const scenarioError = ref("");
const parsed = computed(() => {
  try {
    return parseScenario(scenarioText.value);
  } catch {
    return null;
  }
});
const entryPoints = [
  "inspect",
  "execute",
  "onRequest",
  "get",
  "post",
  "put",
  "delete",
  "pipeline",
  "userEvent",
];
const entry = computed({
  get: () => parsed.value?.entryPoint ?? "",
  set: (value: string | number | null | undefined) => {
    if (parsed.value)
      scenarioText.value = JSON.stringify(
        { ...parsed.value, entryPoint: value },
        null,
        2,
      );
  },
});
const tab = ref("Scenario");
const result = ref<RuntimeResult>();
const resultSource = ref("");
const busy = ref(false);
let cancel: (() => void) | undefined;
const newName = ref("my_script.js");
const newType = ref("ScheduledScript");
const showNew = ref(false);
const error = ref("");
const fixtureInput = ref<HTMLInputElement>();

watch(scenarioText, (text) => emit("scenario", text));
watch(
  () => props.project.scenarioText,
  (text) => {
    if (text !== undefined && text !== scenarioText.value)
      scenarioText.value = text;
  },
);
function resetScenario() {
  scenarioText.value = JSON.stringify(
    defaultScenario(
      resolved.value.script?.metadata.scriptType ||
        resolved.value.module?.metadata.scriptType,
    ),
    null,
    2,
  );
  scenarioError.value = "";
}
async function run() {
  if (busy.value) return;
  error.value = "";
  scenarioError.value = "";
  let scenario;
  try {
    scenario = parseScenario(scenarioText.value);
  } catch (e) {
    scenarioError.value = e instanceof Error ? e.message : String(e);
    tab.value = "Scenario";
    return;
  }
  emit("reindex");
  await nextTick();
  busy.value = true;
  result.value = undefined;
  resultSource.value = `${resolved.value.module?.path || props.selectedId} · ${scenario.entryPoint}`;
  try {
    const execution = startExecution({
      project: props.project,
      artifactId: props.selectedId,
      scenario,
    });
    cancel = execution.cancel;
    result.value = await execution.result;
    emit("finished", result.value);
    tab.value =
      result.value.status === "unsupported" ? "Diagnostics" : "Output";
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
    cancel = undefined;
  }
}
function stop() {
  cancel?.();
}
function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importScenario(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024)
      throw new Error("Scenario exceeds 10 MB.");
    const text = await file.text();
    parseScenario(text);
    scenarioText.value = text;
    scenarioError.value = "";
  } catch (e) {
    scenarioError.value = e instanceof Error ? e.message : String(e);
  }
  input.value = "";
}
function create() {
  if (!newName.value.trim()) return;
  emit("create", newName.value.trim(), newType.value);
  showNew.value = false;
  void nextTick(resetScenario);
}
onBeforeUnmount(stop);
onDeactivated(stop);
</script>

<template>
  <section class="script-runner" aria-label="SuiteScript Code and Run">
    <div class="runner-actions">
      <button @click="showNew = !showNew" :disabled="busy">
        <i class="pi pi-plus" /> New SuiteScript
      </button>
      <button :disabled="!resolved.module || busy" @click="emit('reindex')">
        Re-index sources
      </button>
      <button
        :disabled="!resolved.module"
        @click="
          download(
            resolved.module?.path?.split('/').pop() || 'script.js',
            source,
            'text/javascript',
          )
        "
      >
        Download code
      </button>
      <span class="spacer" />
      <label class="entry-select"
        >Entry point
        <MSelect
          v-model="entry"
          :options="entryPoints"
          :disabled="busy || !parsed"
          size="small"
      /></label>
      <button v-if="busy" @click="stop"><i class="pi pi-stop" /> Stop</button>
      <button
        v-else
        class="run-button"
        :disabled="!resolved.module"
        @click="run"
      >
        <i class="pi pi-play" /> Run locally
      </button>
    </div>
    <div v-if="showNew" class="new-script">
      <label
        >File name<input v-model="newName" placeholder="my_script.js"
      /></label>
      <label
        >Script type<MSelect
          v-model="newType"
          :options="[
            'ScheduledScript',
            'Restlet',
            'Suitelet',
            'UserEventScript',
            'MapReduceScript',
          ]"
          size="small"
      /></label>
      <button @click="create">Create script</button>
    </div>
    <div class="execution-note">
      <i class="pi pi-shield" /> QuickJS / WASM · isolated worker · 64 MB ·
      5-second CPU deadline · network denied · approximate local behavior
    </div>
    <div v-if="error || scenarioError" role="alert" class="run-error">
      {{ error || scenarioError }}
    </div>
    <div v-if="resolved.module" class="code-pane">
      <header>
        <strong>{{ resolved.module.path }}</strong
        ><span>{{
          resolved.deployment?.id || resolved.script?.id || "Direct module run"
        }}</span
        ><small
          >Edits save in this workspace. Original files are unchanged.</small
        >
      </header>
      <MonacoCodeEditor
        :key="resolved.module.id"
        v-model="source"
        language="javascript"
        :readonly="busy"
        :config="{ autoSizing: true, minimap: false, formatOnMount: false }"
        :options="{ fontSize: 12, wordWrap: 'off' }"
        @ctrl-enter="run"
      />
    </div>
    <div v-else class="runner-empty">
      <h3>Select a script to edit and execute</h3>
      <p>
        Choose a source module, script record, or deployment in the explorer.
        Import a SuiteCloud folder or create a SuiteScript above.
      </p>
    </div>
    <div class="result-pane">
      <div class="result-tabs" role="tablist" aria-label="Runtime results">
        <button
          v-for="name in [
            'Scenario',
            'Output',
            'Logs',
            'Record diffs',
            'Tasks',
            'Diagnostics',
          ]"
          :key="name"
          role="tab"
          :aria-selected="tab === name"
          :class="{ active: tab === name }"
          @click="tab = name"
        >
          {{ name
          }}<span v-if="name === 'Logs' && result"
            >({{ result.logs.length }})</span
          >
        </button>
        <strong
          v-if="result"
          class="run-status"
          :class="result.status"
          :title="resultSource"
          >{{ result.status }} · {{ result.fidelity }}</strong
        >
      </div>
      <div v-show="tab === 'Scenario'" class="scenario-editor">
        <div class="fixture-actions">
          <button :disabled="busy" @click="resetScenario">
            Defaults for selected script</button
          ><button :disabled="busy" @click="fixtureInput?.click()">
            Import scenario</button
          ><button @click="download('scenario.json', scenarioText)">
            Export scenario</button
          ><button
            v-if="result"
            @click="
              download('run-result.json', JSON.stringify(result, null, 2))
            "
          >
            Export run</button
          ><input
            ref="fixtureInput"
            hidden
            type="file"
            accept=".json"
            @change="importScenario"
          />
        </div>
        <p>
          Set input, script parameters, user/role, records, virtual files, exact
          SuiteQL results and service fixtures. Each run starts from this
          snapshot. Run “inspect” to list module exports without calling an
          entry point.
        </p>
        <textarea
          v-model="scenarioText"
          :disabled="busy"
          aria-label="Scenario JSON"
          spellcheck="false"
        />
      </div>
      <div v-if="tab !== 'Scenario'" class="result-content">
        <p v-if="result">Executed {{ resultSource }}</p>
        <p v-if="!result">Run a script to inspect its results.</p>
        <template v-else-if="tab === 'Output'"
          ><p v-if="result.error" class="run-error">{{ result.error }}</p>
          <pre>{{
            JSON.stringify(
              { value: result.value, response: result.response },
              null,
              2,
            )
          }}</pre>
        </template>
        <template v-else-if="tab === 'Logs'"
          ><p v-if="!result.logs.length">No logs emitted.</p>
          <article v-for="(log, i) in result.logs" :key="i">
            <strong :class="{ 'run-error': log.level === 'error' }"
              >{{ log.level.toUpperCase() }} · {{ log.title }}</strong
            >
            <pre>{{ JSON.stringify(log.details, null, 2) }}</pre>
          </article></template
        >
        <template v-else-if="tab === 'Record diffs'"
          ><p v-if="!result.diffs.length">No record changes.</p>
          <article v-for="(diff, i) in result.diffs" :key="i">
            <strong>{{ diff.type }} #{{ diff.id }}</strong>
            <pre>{{
              JSON.stringify(
                { before: diff.before, after: diff.after },
                null,
                2,
              )
            }}</pre>
          </article></template
        >
        <pre v-else-if="tab === 'Tasks'">{{
          JSON.stringify(result.tasks, null, 2)
        }}</pre>
        <template v-else
          ><p>{{ result.behaviorPack }} · {{ result.fidelity }}</p>
          <p v-if="!result.diagnostics.length">
            No unsupported behavior was reached in this run. This is not
            NetSuite conformance certification.
          </p>
          <p v-for="(diagnostic, i) in result.diagnostics" :key="i">
            {{ diagnostic }}
          </p></template
        >
      </div>
    </div>
  </section>
</template>

<style scoped>
.script-runner {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--wb-bg, white);
}
.runner-actions,
.fixture-actions,
.new-script {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--wb-border, #e2e8f0);
}
.script-runner button {
  cursor: pointer;
  border: 1px solid var(--wb-border, #e2e8f0);
  border-radius: 5px;
  padding: 6px 9px;
  font: inherit;
  font-size: 10px;
  white-space: nowrap;
  color: inherit;
  background: var(--wb-bg, white);
}
.script-runner button:disabled {
  opacity: 0.45;
  cursor: default;
}
.script-runner .run-button {
  background: var(--ui-button-accent, #8c9bff);
  color: #1e293b;
}
.spacer {
  flex: 1;
}
.entry-select {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 9px;
}
.entry-select :deep(.m-select) {
  min-width: 130px;
}
.new-script label {
  display: grid;
  gap: 5px;
}
.new-script input {
  padding: 6px;
  border: 1px solid var(--wb-border);
  color: inherit;
  background: transparent;
}
.execution-note {
  font-size: 9px;
  padding: 7px 12px;
  color: var(--wb-muted, #64748b);
  background: var(--wb-soft, #f8fafc);
}
.code-pane {
  min-height: 260px;
  height: 48%;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.code-pane header {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  font-size: 9px;
  overflow-wrap: anywhere;
}
.code-pane header small {
  margin-left: auto;
  color: var(--wb-muted);
}
.code-pane :deep(.monaco-editor-container) {
  flex: 1;
  min-height: 220px;
}
.runner-empty {
  padding: 30px;
  color: var(--wb-muted);
}
.runner-empty p {
  margin-top: 10px;
}
.result-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 260px;
  overflow: hidden;
  border-top: 1px solid var(--wb-border);
}
.result-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 5px 9px;
  border-bottom: 1px solid var(--wb-border);
}
.result-tabs button {
  border: 0;
  border-radius: 0;
  border-bottom: 2px solid transparent;
}
.result-tabs .active {
  color: var(--ui-violet, #4f46e5);
  border-bottom-color: var(--ui-violet-border, #a5b4fc);
}
.run-status {
  margin-left: auto;
  font-size: 9px;
  align-self: center;
  color: #428473;
}
.run-status.failed,
.run-status.unsupported,
.run-error {
  color: #ba4444;
}
.run-error {
  padding: 8px 12px;
}
.scenario-editor {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 220px;
}
.scenario-editor p {
  color: var(--wb-muted);
  padding: 8px 12px;
  font-size: 9px;
}
.scenario-editor textarea {
  flex: 1;
  resize: none;
  min-height: 140px;
  padding: 12px;
  background: #232a35;
  color: #e2e8f0;
  font: 11px/1.6 monospace;
  border: 0;
}
.result-content {
  padding: 12px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}
.result-content article {
  padding: 10px 0;
  border-bottom: 1px solid var(--wb-border);
}
.result-content pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 10px/1.6 monospace;
}
.result-content p {
  margin-bottom: 10px;
  font-size: 10px;
}
.script-runner button:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--ui-violet-border, #a5b4fc);
  outline-offset: 1px;
}
</style>
