<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import MCard from "../components/universal/card/MCard.vue";
import MSelect from "../components/universal/input/MSelect.vue";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import {
  deleteCustomTool,
  executeCustomToolDraft,
  getCustomTools,
  getAvailableCustomToolModules,
  getCustomToolModulePath,
  normalizeCustomToolName,
  saveCustomTool,
  saveCustomToolTestState,
  validateCustomTool,
  type CustomToolDraft,
  type CustomToolDomain,
  type CustomToolModule,
  type CustomToolRecord,
  type CustomToolRisk,
  type CustomToolStatus
} from "../utils/customToolsDb";

defineProps<{ vhOffset: number }>();

type EditorTab = "code" | "schema" | "test";
type ToolForm = {
  id?: string;
  name: string;
  displayName: string;
  description: string;
  tags: string;
  modules: CustomToolModule[];
  domain: CustomToolDomain;
  schemaText: string;
  code: string;
  status: CustomToolStatus;
  risk: CustomToolRisk;
  enabled: boolean;
};

const defaultSchema = `{
  "type": "object",
  "properties": {
    "customerId": {
      "type": "number",
      "description": "Customer internal ID"
    }
  },
  "required": ["customerId"]
}`;

const defaultCode = `const customerId = Number(input.customerId);
const customer = record.load({
  type: record.Type.CUSTOMER,
  id: customerId,
  isDynamic: false
});

return {
  id: customerId,
  entityId: customer.getValue({ fieldId: 'entityid' }),
  email: customer.getValue({ fieldId: 'email' })
};`;
const defaultTestInput = '{\n  "customerId": 123\n}';
const emptyTestOutput = "This tool has not been tested yet.";

const blankForm = (): ToolForm => ({
  name: "get_customer_summary",
  displayName: "Get Customer Summary",
  description: "Load a customer and return a compact identity summary.",
  tags: "customer, summary, record",
  modules: ["record"],
  domain: "both",
  schemaText: defaultSchema,
  code: defaultCode,
  status: "active",
  risk: "read",
  enabled: true
});

const tools = ref<CustomToolRecord[]>([]);
const selectedId = ref<string | null>(null);
const form = ref<ToolForm>(blankForm());
const search = ref("");
const editorTab = ref<EditorTab>("code");
const guideVisible = ref(false);
const refreshing = ref(false);
const saving = ref(false);
const running = ref(false);
const statusText = ref("");
const errors = ref<string[]>([]);
const testInput = ref(defaultTestInput);
const testOutput = ref(emptyTestOutput);
const testExecutionDomain = ref<"client" | "server">("client");

const statusOptions = ["draft", "active"];
const editorTabs: EditorTab[] = ["code", "schema", "test"];
const riskOptions = [
  { label: "Read-only", value: "read" },
  { label: "May write", value: "write" }
];
const domainOptions = [
  { label: "Client", value: "client" },
  { label: "Server", value: "server" },
  { label: "Client & server", value: "both" }
];
const testDomainOptions = [
  { label: "Client", value: "client" },
  { label: "Server", value: "server" }
];

const filteredTools = computed(() => {
  const query = search.value.trim().toLowerCase();
  return tools.value.filter((tool) =>
    !query || `${tool.name} ${tool.displayName} ${tool.description} ${tool.tags.join(" ")}`.toLowerCase().includes(query)
  );
});

const selectedTool = computed(() => tools.value.find((tool) => tool.id === selectedId.value));
const activeCount = computed(() => tools.value.filter((tool) => tool.enabled && tool.status === "active").length);
const availableModules = computed(() => getAvailableCustomToolModules(form.value.domain));
const effectiveTestDomain = computed<"client" | "server">(() =>
  form.value.domain === "both" ? testExecutionDomain.value : form.value.domain
);

const parseSchema = (): Record<string, unknown> => {
  const parsed = JSON.parse(form.value.schemaText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Input schema must be a JSON object.");
  return parsed;
};

const parseTestInput = (): Record<string, unknown> => {
  const parsed = JSON.parse(testInput.value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Test input must be a JSON object.");
  return parsed;
};

const toDraft = (): CustomToolDraft => ({
  id: form.value.id,
  name: normalizeCustomToolName(form.value.name),
  displayName: form.value.displayName.trim(),
  description: form.value.description.trim(),
  tags: form.value.tags.split(/[,\n]+/).map((tag) => tag.trim()).filter(Boolean),
  modules: form.value.modules,
  domain: form.value.domain,
  inputSchema: parseSchema(),
  code: form.value.code,
  status: form.value.status,
  risk: form.value.risk,
  enabled: form.value.enabled,
  testInput: parseTestInput()
});

const loadTools = async (refreshSelection = false) => {
  tools.value = await getCustomTools();
  if (selectedId.value) {
    const current = tools.value.find((tool) => tool.id === selectedId.value);
    if (current) {
      if (refreshSelection) selectTool(current);
      return;
    }
  }
  if (tools.value[0]) selectTool(tools.value[0]);
};

const refreshTools = async () => {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await loadTools(true);
    statusText.value = `Refreshed ${tools.value.length} custom tool${tools.value.length === 1 ? "" : "s"}`;
  } catch (error) {
    errors.value = [error instanceof Error ? error.message : String(error)];
  } finally {
    refreshing.value = false;
  }
};

const selectTool = (tool: CustomToolRecord) => {
  selectedId.value = tool.id;
  form.value = {
    id: tool.id,
    name: tool.name,
    displayName: tool.displayName,
    description: tool.description,
    tags: tool.tags.join(", "),
    modules: [...tool.modules],
    domain: tool.domain,
    schemaText: JSON.stringify(tool.inputSchema, null, 2),
    code: tool.code,
    status: tool.status,
    risk: tool.risk,
    enabled: tool.enabled
  };
  testInput.value = JSON.stringify(tool.testInput || {}, null, 2);
  testOutput.value = tool.lastTestResult === undefined
    ? emptyTestOutput
    : JSON.stringify({
        testedAt: tool.lastTestedAt,
        executionDomain: tool.lastTestDomain,
        output: tool.lastTestResult
      }, null, 2);
  testExecutionDomain.value = tool.lastTestDomain || (tool.domain === "server" ? "server" : "client");
  errors.value = [];
  statusText.value = "";
};

const createTool = () => {
  selectedId.value = null;
  form.value = blankForm();
  errors.value = [];
  statusText.value = "";
  editorTab.value = "code";
  testInput.value = defaultTestInput;
  testOutput.value = emptyTestOutput;
  testExecutionDomain.value = "client";
};

const toggleModule = (module: CustomToolModule) => {
  form.value.modules = form.value.modules.includes(module)
    ? form.value.modules.filter((item) => item !== module)
    : [...form.value.modules, module];
};

const validate = (): CustomToolDraft | null => {
  try {
    const draft = toDraft();
    errors.value = validateCustomTool(draft, tools.value);
    return errors.value.length ? null : draft;
  } catch (error) {
    errors.value = [error instanceof Error ? error.message : String(error)];
    return null;
  }
};

const save = async () => {
  const draft = validate();
  if (!draft || saving.value) return;
  saving.value = true;
  try {
    const saved = await saveCustomTool(draft);
    selectedId.value = saved.id;
    statusText.value = saved.status === "active" ? "Saved and available to AI" : "Draft saved";
    await loadTools();
  } catch (error) {
    errors.value = [error instanceof Error ? error.message : String(error)];
  } finally {
    saving.value = false;
  }
};

const remove = async () => {
  if (!selectedTool.value) return;
  if (!window.confirm(`Delete custom tool "${selectedTool.value.displayName}"?`)) return;
  await deleteCustomTool(selectedTool.value.id);
  selectedId.value = null;
  createTool();
  await loadTools();
};

const runTest = async () => {
  const draft = validate();
  if (!draft || running.value) return;
  editorTab.value = "test";
  running.value = true;
  testOutput.value = "Running in the authenticated NetSuite tab…";
  try {
    const input = parseTestInput();
    const result = await executeCustomToolDraft(draft, input, effectiveTestDomain.value);
    testOutput.value = JSON.stringify(result, null, 2);
    if (draft.id) await saveCustomToolTestState(draft.id, input, result, effectiveTestDomain.value);
  } catch (error) {
    const failure = { error: error instanceof Error ? error.message : String(error) };
    testOutput.value = JSON.stringify(failure, null, 2);
    if (form.value.id) {
      try { await saveCustomToolTestState(form.value.id, parseTestInput(), failure, effectiveTestDomain.value); } catch { /* Invalid input is already shown. */ }
    }
  } finally {
    running.value = false;
  }
};

const codeCompletions = computed(() => availableModules.value.map((module) => ({
  label: module,
  kind: "Variable",
  insertText: module,
  detail: `SuiteScript module ${getCustomToolModulePath(module)}`,
  documentation: `Available in the ${form.value.domain} execution domain when selected for this custom tool.`
})));

watch(() => form.value.domain, (domain) => {
  const allowed = new Set(getAvailableCustomToolModules(domain));
  form.value.modules = form.value.modules.filter((module) => allowed.has(module));
  if (domain !== "both") testExecutionDomain.value = domain;
});

onMounted(loadTools);
</script>

<template>
  <MCard flex autoHeight direction="column" gap="0" padding="" outlined elevated class="custom-tools-shell" :style="{ height: `${vhOffset}vh` }">
    <header class="tools-toolbar">
      <div class="toolbar-title">
        <i class="pi pi-wrench" />
        <strong>Custom Tools</strong>
        <span>{{ activeCount }} active / {{ tools.length }} total</span>
      </div>
      <div class="toolbar-actions">
        <InputText v-model="search" class="tool-search" placeholder="Search custom tools…" />
        <button type="button" class="quiet-btn" :disabled="refreshing" title="Reload custom tools and their latest test results" @click="refreshTools"><i :class="refreshing ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" /><span>{{ refreshing ? 'Refreshing' : 'Refresh' }}</span></button>
        <button type="button" class="quiet-btn" @click="guideVisible = true"><i class="pi pi-book" /><span>Implementation Guide</span></button>
        <button type="button" class="quiet-btn" @click="createTool"><i class="pi pi-plus" /><span>New Tool</span></button>
      </div>
    </header>

    <div class="tools-workspace">
      <aside class="tool-list">
        <button v-for="tool in filteredTools" :key="tool.id" type="button" class="tool-row" :class="{ active: tool.id === selectedId, muted: !tool.enabled }" @click="selectTool(tool)">
          <span class="tool-icon"><i class="pi pi-code" /></span>
          <span class="tool-row-copy">
            <strong :title="tool.displayName">{{ tool.displayName }}</strong>
            <small :title="tool.name">{{ tool.name }}</small>
            <span class="tool-row-tags">
              <span :class="`status-chip status-chip--${tool.status}`">{{ tool.status }}</span>
              <span class="status-chip">{{ tool.risk }}</span>
              <span class="status-chip">{{ tool.domain }}</span>
              <span class="status-chip">{{ tool.modules.length }} modules</span>
            </span>
          </span>
        </button>
        <div v-if="filteredTools.length === 0" class="empty-list"><i class="pi pi-search" /><span>No custom tools found.</span></div>
      </aside>

      <main class="tool-editor">
        <section class="tool-form">
          <div class="field-grid">
            <label><span>Display name</span><InputText v-model="form.displayName" class="field-control" /></label>
            <label><span>Tool name</span><InputText v-model="form.name" class="field-control mono" @blur="form.name = normalizeCustomToolName(form.name)" /></label>
            <label class="field-wide"><span>Description used by AI routing</span><InputText v-model="form.description" class="field-control" /></label>
            <label class="field-wide"><span>Tags</span><InputText v-model="form.tags" class="field-control" placeholder="customer, reconciliation, finance" /></label>
            <label><span>Status</span><MSelect v-model="form.status" :options="statusOptions" size="small" /></label>
            <label><span>Risk</span><MSelect v-model="form.risk" :options="riskOptions" option-label="label" option-value="value" size="small" /></label>
            <label><span>Execution domain</span><MSelect v-model="form.domain" :options="domainOptions" option-label="label" option-value="value" size="small" /></label>
          </div>

          <div class="modules-section">
            <div class="section-label"><span>SuiteScript modules</span><small>Showing modules supported in {{ form.domain }} execution.</small></div>
            <div class="module-grid">
              <button v-for="module in availableModules" :key="module" type="button" class="module-chip" :class="{ active: form.modules.includes(module) }" :title="getCustomToolModulePath(module)" @click="toggleModule(module)">{{ getCustomToolModulePath(module) }}</button>
            </div>
          </div>
        </section>

        <section class="code-workspace">
          <header class="editor-tabs">
            <button v-for="tab in editorTabs" :key="tab" type="button" :class="{ active: editorTab === tab }" @click="editorTab = tab">{{ tab === 'schema' ? 'Input Schema' : tab === 'test' ? 'Test & Output' : 'JavaScript' }}</button>
            <span class="editor-hint">Ctrl+S saves · Ctrl+Enter tests</span>
          </header>
          <div class="editor-host">
            <MonacoCodeEditor v-if="editorTab === 'code'" v-model="form.code" language="javascript" :completion-items="codeCompletions" :config="{ autoSizing: true, minimap: false, validateTags: false, formatOnMount: false }" @ctrl-s="save" @ctrl-enter="runTest" />
            <MonacoCodeEditor v-else-if="editorTab === 'schema'" v-model="form.schemaText" language="json" :config="{ autoSizing: true, minimap: false, validateTags: false, formatOnMount: false }" @ctrl-s="save" />
            <div v-else class="test-pane">
              <div class="test-column">
                <div class="test-pane-header"><span class="pane-label">Test input</span><MSelect v-if="form.domain === 'both'" v-model="testExecutionDomain" :options="testDomainOptions" option-label="label" option-value="value" size="small" /></div>
                <Textarea v-model="testInput" class="test-textarea" rows="12" />
              </div>
              <div class="test-column"><span class="pane-label">Result</span><pre class="test-output">{{ testOutput }}</pre></div>
            </div>
          </div>
        </section>

        <div v-if="errors.length" class="validation-strip"><i class="pi pi-exclamation-triangle" /><span>{{ errors.join(" · ") }}</span></div>
        <footer class="editor-footer">
          <label class="enabled-toggle"><input v-model="form.enabled" type="checkbox" /><span>Enabled</span></label>
          <span class="save-status">{{ statusText }}</span>
          <button v-if="selectedTool" type="button" class="danger-btn" @click="remove"><i class="pi pi-trash" /><span>Delete</span></button>
          <button type="button" class="quiet-btn" :disabled="running" @click="runTest"><i :class="running ? 'pi pi-spin pi-spinner' : 'pi pi-play'" /><span>{{ running ? 'Running' : 'Test Tool' }}</span></button>
          <button type="button" class="save-btn" :disabled="saving" @click="save"><i :class="saving ? 'pi pi-spin pi-spinner' : 'pi pi-check'" /><span>{{ saving ? 'Saving' : 'Save Tool' }}</span></button>
        </footer>
      </main>
    </div>
  </MCard>

  <Dialog v-model:visible="guideVisible" modal header="Custom Tool Implementation Guide" :style="{ width: 'min(860px, 94vw)' }">
    <article class="guide-doc">
      <p>Custom tools are JavaScript function bodies executed in NetSuite. Client tools run in the authenticated page; server tools run through the deployed Magic NetSuite Suitelet. The extension never evaluates tool source under its own Content Security Policy.</p>
      <h3>1. Define the contract</h3>
      <p>Use a lowercase machine name, a precise description, and a JSON Schema object. The schema tells the AI which arguments to provide and is validated before execution.</p>
      <pre>{ "type": "object", "properties": { "customerId": { "type": "number" } }, "required": ["customerId"] }</pre>
      <h3>2. Choose a domain and modules</h3>
      <p><strong>Client</strong> runs in page context, <strong>Server</strong> runs synchronously through the Suitelet, and <strong>Client &amp; server</strong> can run in either. The module picker follows Oracle's supported-script-type matrix; the combined domain shows only the intersection. Select every module used by the implementation. Modules are available by short name, such as <code>record</code>, and through <code>context.modules.record</code>. See the <a href="https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_4220488571.html" target="_blank" rel="noreferrer">Oracle SuiteScript 2.1 module matrix</a>.</p>
      <h3>3. Write a function body</h3>
      <pre>const customer = record.load({
  type: record.Type.CUSTOMER,
  id: Number(input.customerId)
});
return { entityId: customer.getValue({ fieldId: 'entityid' }) };</pre>
      <p><code>input</code> contains validated arguments. Return JSON-serializable data. Use <code>console.log()</code> for diagnostic output; captured logs are returned with the result.</p>
      <h3>4. Test, review, activate</h3>
      <p>Each tool owns its test input and latest output; switching tools loads that tool's saved test state. AI creation includes a concrete test case and immediately runs it through the test operation. Draft tools remain invisible to normal routing. Combined tools can be tested once in each domain. Set status to <strong>active</strong> when the schema, permissions, and output have been reviewed.</p>
      <h3>AI workflow</h3>
      <pre>magic_netsuite_search_custom_tools({ query: "customer summary" })
magic_netsuite_update_custom_tool({
  toolName: "get_customer_summary",
  description: "Return customer identity and contact details"
})
magic_netsuite_call_custom_tool({
  toolName: "get_customer_summary",
  input: { customerId: 123 },
  executionDomain: "client"
})</pre>
    </article>
  </Dialog>
</template>

<style scoped>
.custom-tools-shell { overflow: hidden; background: #fbfcfd; }
.tools-toolbar, .toolbar-title, .toolbar-actions, .editor-footer, .section-label { display: flex; align-items: center; gap: 8px; min-width: 0; }
.tools-toolbar { min-height: 48px; flex-shrink: 0; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #dbe3ea; background: #fbfcfd; }
.toolbar-title { color: #27323a; }
.toolbar-title > i { color: #7b2ff7; }
.toolbar-title > span { padding: 2px 7px; border: 1px solid #dbe3ea; border-radius: 999px; color: #62696e; font-size: .68rem; }
.tool-search { width: 230px; }
.tools-workspace { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.tool-list { display: flex; flex: 0 0 300px; min-height: 0; flex-direction: column; overflow-y: auto; border-right: 1px solid #dbe3ea; background: #f8fafc; }
.tool-row { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 8px; padding: 10px 12px; border: 0; border-bottom: 1px solid #dbe3ea; background: transparent; text-align: left; cursor: pointer; }
.tool-row:hover, .tool-row.active { outline: 1px solid #d8c6ff; outline-offset: -1px; background: #faf7ff; color: #7b2ff7; }
.tool-row.muted { opacity: .55; }
.tool-icon { color: #7b2ff7; }
.tool-row-copy { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.tool-row-copy strong, .tool-row-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tool-row-copy strong { color: #27323a; font-size: .8rem; }
.tool-row-copy small { color: #8a949b; font-family: "JetBrains Mono", monospace; font-size: .65rem; }
.tool-row-tags, .module-grid { display: flex; flex-wrap: wrap; gap: 4px; }
.status-chip, .module-chip { padding: 2px 6px; border: 1px solid #dbe3ea; border-radius: 999px; background: #fff; color: #62696e; font-size: .63rem; white-space: nowrap; }
.status-chip--active, .module-chip.active { border-color: #d8c6ff; background: #faf7ff; color: #7b2ff7; }
.status-chip--draft { color: #8a6a16; }
.empty-list { display: flex; min-height: 130px; align-items: center; justify-content: center; gap: 7px; color: #8a949b; font-size: .75rem; }
.tool-editor { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; background: white; }
.tool-form { flex-shrink: 0; padding: 10px 12px; border-bottom: 1px solid #dbe3ea; background: #fbfcfd; }
.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.field-grid label { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.field-grid label > span, .section-label > span, .pane-label { color: #62696e; font-size: .65rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; }
.field-wide { grid-column: 1 / -1; }
.field-control { width: 100%; min-height: 1.95rem; font-size: .78rem; }
.mono { font-family: "JetBrains Mono", monospace; }
.modules-section { margin-top: 9px; }
.section-label { justify-content: space-between; margin-bottom: 5px; }
.section-label small { overflow: hidden; color: #8a949b; font-size: .65rem; text-overflow: ellipsis; white-space: nowrap; }
.module-chip { cursor: pointer; border-radius: 5px; }
.code-workspace { display: flex; flex: 1; min-height: 0; flex-direction: column; }
.editor-tabs { display: flex; min-height: 34px; flex-shrink: 0; align-items: center; gap: 3px; padding: 3px 8px; border-bottom: 1px solid #dbe3ea; background: #eef3f7; }
.editor-tabs button { min-height: 27px; padding: 0 9px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #62696e; font: inherit; font-size: .7rem; cursor: pointer; }
.editor-tabs button.active { border-color: #d8c6ff; background: #faf7ff; color: #7b2ff7; }
.editor-hint { margin-left: auto; color: #8a949b; font-size: .65rem; }
.editor-host { flex: 1; min-height: 0; overflow: hidden; }
.test-pane { display: grid; height: 100%; grid-template-columns: 1fr 1fr; gap: 1px; background: #dbe3ea; }
.test-column { display: flex; min-width: 0; min-height: 0; flex-direction: column; gap: 6px; padding: 10px; background: #fbfcfd; }
.test-pane-header { display: flex; min-height: 30px; align-items: center; justify-content: space-between; gap: 8px; }
.test-textarea, .test-output { flex: 1; min-height: 0; width: 100%; overflow: auto; border: 1px solid #dbe3ea; border-radius: 5px; background: white; padding: 9px; font-family: "JetBrains Mono", monospace; font-size: .72rem; line-height: 1.5; white-space: pre-wrap; }
.validation-strip { display: flex; flex-shrink: 0; align-items: center; gap: 7px; padding: 6px 10px; border-top: 1px solid #f4c7c7; background: #fff7f7; color: #a33a3a; font-size: .7rem; }
.editor-footer { min-height: 46px; flex-shrink: 0; justify-content: flex-end; padding: 7px 10px; border-top: 1px solid #dbe3ea; background: #fbfcfd; }
.enabled-toggle { display: flex; align-items: center; gap: 5px; color: #62696e; font-size: .72rem; }
.enabled-toggle input { accent-color: #7b2ff7; }
.save-status { margin-right: auto; color: #62696e; font-size: .68rem; }
.quiet-btn, .save-btn, .danger-btn { display: inline-flex; min-height: 30px; align-items: center; gap: 6px; padding: 4px 9px; border: 1px solid #dbe3ea; border-radius: 5px; background: white; color: #62696e; font: inherit; font-size: .7rem; font-weight: 700; white-space: nowrap; cursor: pointer; }
.quiet-btn:hover, .save-btn:hover { border-color: #c6a7ff; background: #faf7ff; color: #7b2ff7; }
.save-btn { border-color: #d8c6ff; color: #7b2ff7; }
.danger-btn { border-color: #f1caca; color: #a33a3a; }
.quiet-btn:disabled, .save-btn:disabled { opacity: .55; cursor: default; }
.guide-doc { color: #27323a; font-size: .82rem; line-height: 1.6; }
.guide-doc h3 { margin: 14px 0 4px; font-size: .86rem; }
.guide-doc p { margin: 0 0 8px; color: #62696e; }
.guide-doc a { color: #7b2ff7; text-decoration-color: #d8c6ff; }
.guide-doc pre { overflow: auto; padding: 10px; border: 1px solid #dbe3ea; border-radius: 5px; background: #eef3f7; font-family: "JetBrains Mono", monospace; font-size: .72rem; white-space: pre-wrap; }
.guide-doc code { font-family: "JetBrains Mono", monospace; }
@media (max-width: 980px) { .tool-list { flex-basis: 240px; } .tool-search { width: 180px; } .editor-hint { display: none; } }
</style>
