<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onDeactivated,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from "vue";
import {
  VueFlow,
  Handle,
  Position,
  MarkerType,
  useVueFlow,
  type Node,
  type Edge,
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import MSelect from "../components/universal/input/MSelect.vue";
import ScriptRunnerPanel from "../features/architecture/ScriptRunnerPanel.vue";
import { projectArchitecture } from "../features/architecture/canvas";
import {
  resolveSource,
  type RuntimeResult,
} from "../features/architecture/runtime/types";
import {
  artifactKinds,
  createExample,
  indexFiles,
  parseProject,
  type Artifact,
  type Project,
} from "../features/architecture/model";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/controls/dist/style.css";
import "@vue-flow/minimap/dist/style.css";

const props = defineProps<{ vhOffset: number }>();
const STORAGE_KEY = "magic-netsuite:architecture-workbench:v1";
const message = ref("");
const storageStatus = ref("Saved locally");
function restore(): Project {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return parseProject(saved);
  } catch {
    message.value =
      "The saved workspace could not be loaded. Showing the example; import an exported project to recover it.";
  }
  return createExample();
}
const project = ref<Project>(restore());
const query = ref("");
const kind = ref("All artifacts");
const inspectorTab = ref("Overview");
const dockTab = ref("Timeline");
const workspaceMode = ref("Architecture");
const workspaceRevision = ref(0);
const runtimeResult = ref<RuntimeResult>();
const selectedId = ref(project.value.artifacts[0]?.id ?? "");
const selectedEdgeId = ref("");
const focusOnly = ref(false);
const runtimeOnly = ref(false);
const showExplorer = ref(true);
const showInspector = ref(true);
const fileInput = ref<HTMLInputElement>();
const sourceInput = ref<HTMLInputElement>();
const folderInput = ref<HTMLInputElement>();
const nodes = shallowRef<Node[]>([]);
const edges = shallowRef<Edge[]>([]);
const cursor = ref(-1);
const playing = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
const flowId = `architecture-${crypto.randomUUID()}`;
const { fitView, setCenter, viewport } = useVueFlow({ id: flowId });
const icons: Record<string, string> = {
  Record: "pi-database",
  Script: "pi-code",
  Deployment: "pi-bolt",
  Module: "pi-file",
  Search: "pi-search",
  File: "pi-folder",
  Workflow: "pi-sitemap",
  Task: "pi-clock",
  Integration: "pi-globe",
  Role: "pi-shield",
  List: "pi-list",
};
const selected = computed(() =>
  project.value.artifacts.find((a) => a.id === selectedId.value),
);
const selectedEdge = computed(
  () =>
    architecture.value.relationships.find(
      (e) => e.id === selectedEdgeId.value,
    ) || project.value.relationships.find((e) => e.id === selectedEdgeId.value),
);
const architecture = computed(() => projectArchitecture(project.value));
const selectedCanvasIds = computed(
  () =>
    architecture.value.representatives.get(selectedId.value) ||
    new Set<string>(),
);
const executingCanvasIds = computed(
  () =>
    architecture.value.representatives.get(
      currentEvent.value?.artifactId || "",
    ) || new Set<string>(),
);
const currentEvent = computed(() => project.value.trace[cursor.value]);
const connections = computed(() =>
  project.value.relationships.filter(
    (e) => e.source === selectedId.value || e.target === selectedId.value,
  ),
);
const units = computed(() =>
  project.value.trace
    .slice(0, cursor.value + 1)
    .reduce((total, e) => total + e.units, 0),
);
const filtered = computed(() => {
  const neighbors = new Set([
    selectedId.value,
    ...connections.value.flatMap((e) => [e.source, e.target]),
  ]);
  const touched = new Set(project.value.trace.map((e) => e.artifactId));
  return project.value.artifacts.filter(
    (a) =>
      (kind.value === "All artifacts" || a.kind === kind.value) &&
      `${a.name} ${a.id} ${Object.values(a.metadata).join(" ")}`
        .toLowerCase()
        .includes(query.value.toLowerCase()) &&
      (!focusOnly.value || neighbors.has(a.id)) &&
      (!runtimeOnly.value || touched.has(a.id)),
  );
});
const canvasArtifacts = computed(() => {
  const graph = architecture.value;
  const neighbors = new Set(selectedCanvasIds.value);
  for (const e of graph.relationships)
    if (
      selectedCanvasIds.value.has(e.source) ||
      selectedCanvasIds.value.has(e.target)
    ) {
      neighbors.add(e.source);
      neighbors.add(e.target);
    }
  const touched = new Set(
    project.value.trace.flatMap((e) => [
      ...(graph.representatives.get(e.artifactId) || []),
    ]),
  );
  return graph.artifacts.filter(
    (a) =>
      (kind.value === "All artifacts" || a.kind === kind.value) &&
      `${a.name} ${a.id} ${Object.values(a.metadata).join(" ")}`
        .toLowerCase()
        .includes(query.value.toLowerCase()) &&
      (!focusOnly.value || neighbors.has(a.id)) &&
      (!runtimeOnly.value || touched.has(a.id)),
  );
});
const diagnostics = computed(() => [
  {
    title: "Local SuiteScript runtime · approximate behavior",
    detail:
      "Use Code & Run to edit and execute imported SuiteScript in an isolated worker. SuiteQL and network responses require explicit fixtures. Unsupported operations are reported, including errors caught by scripts.",
  },
  ...(project.value.diagnostics ?? []).map((detail) => ({
    title: "Import diagnostic",
    detail,
  })),
  ...(runtimeResult.value?.diagnostics ?? []).map((detail) => ({
    title: "Runtime diagnostic",
    detail,
  })),
  ...project.value.relationships
    .filter((e) => e.provenance === "Inferred")
    .map((e) => ({
      title: `Verify ${e.label}`,
      detail: `${e.path ?? e.source}${e.line ? `:${e.line}` : ""} — ${e.evidence}`,
    })),
]);

function setWorkspaceMode(mode: string) {
  workspaceMode.value = mode;
  showInspector.value = mode === "Architecture";
}
function updateSource(source: string) {
  const { module } = resolveSource(project.value, selectedId.value);
  if (module) {
    module.source = source;
    project.value.trace = [];
    project.value.traceLabel =
      "Source edited · run again to capture a current trace";
    runtimeResult.value = undefined;
  }
}
function reindexSources() {
  const files = new Map<string, string>();
  for (const a of project.value.artifacts)
    if (a.path && a.source !== undefined) files.set(a.path, a.source);
  if (!files.size) return;
  const next = indexFiles(
    [...files].map(([path, content]) => ({ path, content })),
    project.value,
  );
  next.name = project.value.name;
  project.value = next;
}
function acceptRuntime(result: RuntimeResult) {
  stop();
  cursor.value = -1;
  runtimeResult.value = result;
  project.value.trace = result.trace;
  project.value.traceLabel = `${result.status} · ${result.fidelity} · ${result.behaviorPack} · actual source execution`;
  const module = project.value.artifacts.find(
    (a) => a.id === result.trace[0]?.artifactId,
  );
  if (module)
    for (const target of new Set(result.trace.map((e) => e.artifactId))) {
      if (target === module.id) continue;
      const id = `observed:${module.id}:${target}`;
      if (!project.value.relationships.some((e) => e.id === id))
        project.value.relationships.push({
          id,
          source: module.id,
          target,
          label: "Runtime observation",
          provenance: "Observed",
          evidence: `Observed during local ${result.behaviorPack} execution. ${result.fidelity}; not real-account conformance.`,
        });
    }
}
function createScript(name: string, type: string) {
  const filename =
    name
      .replace(/\\/g, "/")
      .split("/")
      .pop()!
      .replace(/[^a-zA-Z0-9_.-]/g, "_")
      .replace(/\.(?:js|ts)$/, "") + ".js";
  const path = `SuiteScripts/Workbench/${filename}`,
    id = `file:${path}`;
  if (project.value.artifacts.some((a) => a.id === id)) {
    message.value =
      "A source file with that name already exists. Select it to edit.";
    selectedId.value = id;
    return;
  }
  const templates: Record<string, string> = {
    ScheduledScript:
      "return { execute: () => { log.audit({ title: 'Local run', details: 'Hello from SuiteScript 2.1' }); } };",
    Restlet:
      "return { get: (params) => ({ ok: true, params }), post: (body) => ({ received: body }) };",
    Suitelet:
      "return { onRequest: (context) => { context.response.write(JSON.stringify({ ok: true, method: context.request.method })); } };",
    UserEventScript:
      "return { beforeSubmit: (context) => { log.audit({ title: context.type, details: context.newRecord.getFields() }); }, afterSubmit: (context) => { log.audit({ title: 'Saved', details: context.newRecord.id }); } };",
    MapReduceScript:
      "return { getInputData: () => [1, 2, 3], map: (context) => context.write({ key: 'total', value: context.value }), reduce: (context) => context.write({ key: context.key, value: context.values.reduce((sum, value) => sum + Number(value), 0) }), summarize: (summary) => summary.output.iterator().each((key, value) => { log.audit(key, value); return true; }) };",
  };
  const source = `/**\n * @NApiVersion 2.1\n * @NScriptType ${type}\n */\ndefine(['N/log'], (log) => {\n  ${templates[type]}\n});\n`;
  const files = project.value.artifacts
    .filter((a) => a.path && a.source !== undefined)
    .map((a) => ({ path: a.path!, content: a.source! }));
  files.push({ path, content: source });
  const next = indexFiles(files, project.value);
  next.name = project.value.name;
  project.value = next;
  selectedId.value = id;
  query.value = "";
  kind.value = "All artifacts";
  focusOnly.value = false;
  runtimeOnly.value = false;
}

function rebuild() {
  const ids = new Set(canvasArtifacts.value.map((a) => a.id));
  nodes.value = canvasArtifacts.value.map((a) => ({
    id: a.id,
    type: "artifact",
    position: { ...a.position },
    data: a,
    selected: selectedCanvasIds.value.has(a.id),
  }));
  edges.value = architecture.value.relationships
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      type: "smoothstep",
      markerEnd: MarkerType.ArrowClosed,
      selected: e.id === selectedEdgeId.value,
      animated: playing.value && executingCanvasIds.value.has(e.target),
      style: {
        stroke: e.id === selectedEdgeId.value ? "#7c6ee6" : "#93a4b8",
        strokeWidth: e.id === selectedEdgeId.value ? 2.5 : 1.5,
      },
      labelStyle: { fill: "#64748b", fontSize: 10 },
      labelBgStyle: { fill: "#f8fafc", fillOpacity: 0.95 },
    }));
}
watch(
  [canvasArtifacts, architecture, selectedId, selectedEdgeId, cursor, playing],
  rebuild,
  {
    immediate: true,
    deep: true,
  },
);
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project.value));
    storageStatus.value = "Saved locally";
  } catch {
    storageStatus.value = "Not saved · export a backup";
    message.value =
      "Browser storage is unavailable or full. Export the project to keep your changes.";
  }
}
watch(
  project,
  () => {
    storageStatus.value = "Saving…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 350);
  },
  { deep: true },
);
function stop() {
  clearInterval(timer);
  timer = undefined;
  playing.value = false;
}
function step() {
  if (cursor.value >= project.value.trace.length - 1) {
    stop();
    return;
  }
  cursor.value++;
  if (currentEvent.value) selectedId.value = currentEvent.value.artifactId;
  if (cursor.value === project.value.trace.length - 1) stop();
}
function play() {
  if (playing.value) {
    stop();
    return;
  }
  if (!project.value.trace.length) return;
  if (cursor.value >= project.value.trace.length - 1) cursor.value = -1;
  playing.value = true;
  step();
  if (playing.value) timer = setInterval(step, 900);
}
function resetTrace() {
  stop();
  cursor.value = -1;
}
function selectArtifact(artifact: Artifact, center = false) {
  selectedId.value = artifact.id;
  selectedEdgeId.value = "";
  showInspector.value = true;
  const canvasArtifact = architecture.value.artifacts.find((a) =>
    selectedCanvasIds.value.has(a.id),
  );
  if (center && canvasArtifact)
    void nextTick(() =>
      setCenter(
        canvasArtifact.position.x + 120,
        canvasArtifact.position.y + 55,
        {
          zoom: 1,
          duration: 300,
        },
      ),
    );
}
function persistPositions(event: { nodes: Node[] }) {
  for (const node of event.nodes) {
    const artifact = project.value.artifacts.find((a) => a.id === node.id);
    if (artifact) artifact.position = { ...node.position };
  }
}
function arrange() {
  canvasArtifacts.value.forEach((a, index) => {
    const original = project.value.artifacts.find((item) => item.id === a.id)!;
    original.position = {
      x: (index % 4) * 310,
      y: Math.floor(index / 4) * 190,
    };
  });
  void nextTick(() => fitView({ padding: 0.18, duration: 300 }));
}
function replaceProject(value: Project) {
  stop();
  workspaceRevision.value++;
  runtimeResult.value = undefined;
  cursor.value = -1;
  project.value = value;
  selectedId.value = value.artifacts[0]?.id ?? "";
  selectedEdgeId.value = "";
  query.value = "";
  kind.value = "All artifacts";
  focusOnly.value = false;
  runtimeOnly.value = false;
  void nextTick(() => fitView({ padding: 0.16 }));
}
async function importFiles(event: Event, format: "project" | "source") {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []).filter((f) => {
    if (format === "project") return true;
    const path = f.webkitRelativePath.replace(/\\/g, "/");
    if (/(?:^|\/)(?:node_modules|\.git)\//.test(path)) return false;
    if (/\.(js|ts|xml)$/i.test(f.name)) return true;
    return (
      /\.(html?|json|csv|txt|ftl|svg)$/i.test(f.name) &&
      (!path || /(?:FileCabinet|SuiteScripts)\//.test(path))
    );
  });
  if (!files.length) {
    message.value = "No supported files selected.";
    return;
  }
  try {
    if (
      files.length > 1000 ||
      files.reduce((sum, f) => sum + f.size, 0) > 20 * 1024 * 1024
    )
      throw new Error(
        "Choose up to 1,000 source files totaling at most 20 MB.",
      );
    const contents = await Promise.all(
      files.map(async (f) => ({
        path: f.webkitRelativePath || f.name,
        content: await f.text(),
      })),
    );
    const value =
      format === "project"
        ? parseProject(contents[0]!.content)
        : indexFiles(contents, project.value);
    replaceProject(value);
    message.value = `Imported ${value.artifacts.length} artifacts and ${value.relationships.length} relationships. Source files were not executed.`;
  } catch (error) {
    message.value = error instanceof Error ? error.message : "Import failed.";
  } finally {
    input.value = "";
  }
}
function exportProject() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(project.value, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "architecture.workbench.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
onActivated(() => {
  void nextTick(() => fitView({ padding: 0.16 }));
});
onDeactivated(() => {
  stop();
  clearTimeout(saveTimer);
  save();
});
onBeforeUnmount(() => {
  stop();
  clearTimeout(saveTimer);
  save();
});
</script>

<template>
  <section
    class="workbench"
    :style="{ height: `${props.vhOffset}vh` }"
    aria-label="Architecture Workbench"
  >
    <header class="workbench-header">
      <div class="brand-icon"><i class="pi pi-sitemap" /></div>
      <div class="title">
        <div class="eyebrow">SUITEGRAPH <span>LOCAL WORKSPACE</span></div>
        <h1>Architecture Workbench</h1>
      </div>
      <span class="save-status"
        ><i class="pi pi-circle-fill" />{{ storageStatus }}</span
      >
      <div class="header-actions">
        <button @click="sourceInput?.click()">
          <i class="pi pi-file-import" /> Import source
        </button>
        <button
          @click="folderInput?.click()"
          title="Import a SuiteCloud project folder"
        >
          <i class="pi pi-folder-open" /> SDF folder
        </button>
        <button @click="fileInput?.click()">Open project</button>
        <button class="primary" @click="exportProject">
          <i class="pi pi-download" /> Export
        </button>
      </div>
      <input
        ref="fileInput"
        hidden
        type="file"
        accept=".json"
        @change="importFiles($event, 'project')"
      />
      <input
        ref="sourceInput"
        hidden
        type="file"
        accept=".js,.ts,.xml,.html,.json,.csv,.ftl"
        multiple
        @change="importFiles($event, 'source')"
      />
      <input
        ref="folderInput"
        hidden
        type="file"
        webkitdirectory
        multiple
        @change="importFiles($event, 'source')"
      />
    </header>

    <div class="scenario-bar">
      <label class="project-name"
        ><span>PROJECT</span
        ><input v-model="project.name" aria-label="Project name"
      /></label>
      <label class="release"
        ><span>TARGET RELEASE</span
        ><MSelect
          v-model="project.release"
          :options="['2026.1', '2026.2']"
          size="small"
      /></label>
      <div class="scenario-detail">
        <span>EXECUTION</span><strong>SuiteScript sandbox</strong>
      </div>
      <div class="scenario-detail fidelity">
        <span>FIDELITY</span><strong>Unverified / approximate</strong>
      </div>
      <div class="playback">
        <button
          title="Reset trace cursor"
          aria-label="Reset trace cursor"
          :disabled="cursor < 0"
          @click="resetTrace"
        >
          <i class="pi pi-replay" />
        </button>
        <button
          :disabled="
            !project.trace.length ||
            playing ||
            cursor >= project.trace.length - 1
          "
          @click="step"
        >
          <i class="pi pi-step-forward" /> Step
        </button>
        <button class="primary" :disabled="!project.trace.length" @click="play">
          <i :class="playing ? 'pi pi-pause' : 'pi pi-play'" />{{
            playing
              ? "Pause"
              : cursor >= 0 && cursor < project.trace.length - 1
                ? "Continue"
                : "Replay trace"
          }}
        </button>
      </div>
    </div>
    <div v-if="message" class="notice" role="status">
      <i class="pi pi-info-circle" />{{ message
      }}<button aria-label="Dismiss message" @click="message = ''">
        <i class="pi pi-times" />
      </button>
    </div>

    <div class="workbench-body">
      <aside v-if="showExplorer" class="explorer">
        <div class="pane-title">
          ARCHITECTURE <span>{{ project.artifacts.length }}</span
          ><button
            title="Hide explorer"
            aria-label="Hide explorer"
            @click="showExplorer = false"
          >
            <i class="pi pi-angle-double-left" />
          </button>
        </div>
        <div class="explorer-filters">
          <label class="search"
            ><i class="pi pi-search" /><input
              v-model="query"
              placeholder="Find an artifact…"
              aria-label="Find an artifact" /></label
          ><MSelect
            v-model="kind"
            :options="['All artifacts', ...artifactKinds]"
            size="small"
          />
        </div>
        <div class="artifact-list">
          <button
            v-for="artifact in filtered"
            :key="artifact.id"
            :class="{ active: selectedId === artifact.id }"
            @click="selectArtifact(artifact, true)"
          >
            <i :class="['pi', icons[artifact.kind]]" /><span
              ><strong>{{ artifact.name }}</strong
              ><small
                >{{ artifact.kind }} ·
                {{ artifact.metadata.scriptId || artifact.id }}</small
              ></span
            >
          </button>
          <p v-if="!filtered.length" class="empty">
            No artifacts match these filters.
          </p>
        </div>
        <div class="explorer-footer">
          <i class="pi pi-lock" /><span
            >Local files only.<br />No connection to NetSuite.</span
          >
        </div>
      </aside>

      <main class="center-pane">
        <div class="workspace-modes" role="tablist" aria-label="Workbench mode">
          <button
            v-for="mode in ['Architecture', 'Code & Run']"
            :key="mode"
            role="tab"
            :aria-selected="workspaceMode === mode"
            :class="{ active: workspaceMode === mode }"
            @click="setWorkspaceMode(mode)"
          >
            {{ mode }}
          </button>
          <span v-if="workspaceMode === 'Code & Run'"
            >Select a script, edit its code, configure a scenario, then Run
            locally.</span
          >
        </div>
        <ScriptRunnerPanel
          :key="workspaceRevision"
          v-show="workspaceMode === 'Code & Run'"
          :project="project"
          :selected-id="selectedId"
          @code="updateSource"
          @scenario="project.scenarioText = $event"
          @reindex="reindexSources"
          @finished="acceptRuntime"
          @create="createScript"
        />
        <div v-show="workspaceMode === 'Architecture'" class="canvas-toolbar">
          <button
            v-if="!showExplorer"
            title="Show explorer"
            aria-label="Show explorer"
            @click="showExplorer = true"
          >
            <i class="pi pi-list" />
          </button>
          <strong><i class="pi pi-share-alt" /> Architecture</strong
          ><span class="count"
            >{{ canvasArtifacts.length }} nodes · {{ edges.length }} edges</span
          >
          <div class="toolbar-spacer" />
          <button
            :class="{ active: focusOnly }"
            :aria-pressed="focusOnly"
            title="Show selected artifact and immediate neighbors"
            @click="focusOnly = !focusOnly"
          >
            Focus
          </button>
          <button
            :class="{ active: runtimeOnly }"
            :aria-pressed="runtimeOnly"
            :disabled="!project.trace.length"
            @click="runtimeOnly = !runtimeOnly"
          >
            Trace path
          </button>
          <button @click="arrange" title="Arrange visible artifacts in a grid">
            <i class="pi pi-th-large" /> Arrange
          </button>
          <button
            @click="fitView({ padding: 0.16, duration: 300 })"
            title="Fit graph"
            aria-label="Fit graph"
          >
            <i class="pi pi-expand" />
          </button>
          <button
            v-if="!showInspector"
            @click="showInspector = true"
            title="Show inspector"
            aria-label="Show inspector"
          >
            <i class="pi pi-sliders-h" />
          </button>
        </div>
        <div v-show="workspaceMode === 'Architecture'" class="graph-stage">
          <VueFlow
            :id="flowId"
            v-model:nodes="nodes"
            v-model:edges="edges"
            :min-zoom="0.15"
            :max-zoom="2"
            fit-view-on-init
            :nodes-connectable="false"
            :delete-key-code="null"
            :snap-to-grid="true"
            :snap-grid="[16, 16]"
            @node-click="selectArtifact($event.node.data)"
            @edge-click="
              selectedEdgeId = $event.edge.id;
              showInspector = true;
            "
            @node-drag-stop="persistPositions"
          >
            <Background :gap="20" pattern-color="#c9d3e1" />
            <Controls :show-interactive="false" position="bottom-left" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              :node-color="() => '#a5a0d7'"
            />
            <template #node-artifact="{ data, selected: isSelected }">
              <div
                class="artifact-node"
                :class="[
                  {
                    selected: isSelected,
                    executing: executingCanvasIds.has(data.id),
                    compact: viewport.zoom < 0.5,
                  },
                  `kind-${data.kind.toLowerCase()}`,
                ]"
              >
                <Handle type="target" :position="Position.Left" />
                <div class="node-kind">
                  <i :class="['pi', icons[data.kind]]" />{{ data.kind
                  }}<i
                    v-if="executingCanvasIds.has(data.id)"
                    class="pi pi-bolt node-pulse"
                  />
                </div>
                <strong>{{ data.name }}</strong
                ><small v-if="viewport.zoom >= 0.5">{{
                  data.metadata.scriptId ||
                  data.metadata.recordType ||
                  data.metadata.transport ||
                  data.id
                }}</small>
                <div v-if="viewport.zoom >= 0.8" class="node-footer">
                  <span>{{
                    data.metadata.scriptType ||
                    data.metadata.status ||
                    data.metadata.apiVersion ||
                    "Architecture artifact"
                  }}</span
                  ><i class="pi pi-arrow-up-right" />
                </div>
                <Handle type="source" :position="Position.Right" />
              </div>
            </template>
          </VueFlow>
          <div v-if="!canvasArtifacts.length" class="graph-empty">
            No matching artifacts. Clear the search or filters to restore the
            graph.
          </div>
          <div class="graph-caption">
            <span class="legend-dot" />{{
              project.trace.length
                ? "Example / imported architecture"
                : "Local architecture index"
            }}<span>Drag to arrange · Shift + drag to select</span>
          </div>
        </div>

        <section
          v-show="workspaceMode === 'Architecture'"
          class="debug-dock"
          aria-label="Trace and diagnostics"
        >
          <div class="dock-tabs" role="tablist" aria-label="Debug dock">
            <button
              v-for="tab in [
                'Timeline',
                'Event details',
                'Governance',
                'Diagnostics',
              ]"
              :key="tab"
              :class="{ active: dockTab === tab }"
              role="tab"
              :aria-selected="dockTab === tab"
              @click="dockTab = tab"
            >
              {{ tab
              }}<span v-if="tab === 'Diagnostics'">{{
                diagnostics.length
              }}</span></button
            ><small>{{
              project.trace.length
                ? `${Math.max(0, cursor + 1)} / ${project.trace.length} events`
                : "No trace loaded"
            }}</small>
          </div>
          <div class="dock-content">
            <template v-if="dockTab === 'Timeline'">
              <div class="trace-label">
                <i class="pi pi-info-circle" />{{ project.traceLabel }}
              </div>
              <div class="timeline">
                <button
                  v-for="(event, index) in project.trace"
                  :key="event.id"
                  :class="{
                    current: cursor === index,
                    visited: cursor > index,
                  }"
                  @click="
                    stop();
                    cursor = index;
                    selectedId = event.artifactId;
                  "
                >
                  <span class="event-number">{{
                    String(index + 1).padStart(2, "0")
                  }}</span
                  ><strong>{{ event.label }}</strong
                  ><small>+{{ event.at }} ms · {{ event.units }} units</small>
                </button>
              </div>
              <p v-if="!project.trace.length" class="empty">
                Select a script and open Code &amp; Run to capture a local
                execution trace, or import a workbench project containing a
                saved trace.
              </p>
            </template>
            <div v-else-if="dockTab === 'Event details'" class="event-details">
              <template v-if="currentEvent"
                ><strong>{{ currentEvent.label }}</strong>
                <p>{{ currentEvent.detail }}</p>
                <code
                  >{{ currentEvent.context }} · {{ currentEvent.role }}</code
                ></template
              >
              <p v-else class="empty">
                Select an event in the timeline or step through the trace.
              </p>
            </div>
            <div v-else-if="dockTab === 'Governance'" class="governance">
              <strong
                >{{ units
                }}<small>recorded units through current event</small></strong
              >
              <p>
                Local runs charge modeled API costs and enforce entry-point
                budgets. Values are approximate and come from the selected
                trace; imported traces retain their original provenance. No real
                account usage is consumed.
              </p>
            </div>
            <div v-else class="diagnostic-list">
              <article v-for="(item, index) in diagnostics" :key="index">
                <i class="pi pi-exclamation-triangle" />
                <div>
                  <strong>{{ item.title }}</strong>
                  <p>{{ item.detail }}</p>
                </div>
              </article>
            </div>
          </div>
        </section>
      </main>

      <aside v-if="showInspector" class="inspector">
        <div class="pane-title">
          INSPECTOR<button
            title="Hide inspector"
            aria-label="Hide inspector"
            @click="showInspector = false"
          >
            <i class="pi pi-angle-double-right" />
          </button>
        </div>
        <template v-if="selectedEdge">
          <div class="inspector-heading">
            <span class="type-badge">RELATIONSHIP</span>
            <h2>{{ selectedEdge.label }}</h2>
            <p>{{ selectedEdge.provenance }} provenance</p>
          </div>
          <div class="inspector-content">
            <dl>
              <dt>From</dt>
              <dd>
                {{
                  project.artifacts.find((a) => a.id === selectedEdge?.source)
                    ?.name
                }}
              </dd>
              <dt>To</dt>
              <dd>
                {{
                  project.artifacts.find((a) => a.id === selectedEdge?.target)
                    ?.name
                }}
              </dd>
              <dt>Why this edge exists</dt>
              <dd>{{ selectedEdge.evidence }}</dd>
              <dt v-if="selectedEdge.path">Source location</dt>
              <dd v-if="selectedEdge.path">
                {{ selectedEdge.path
                }}{{ selectedEdge.line ? `:${selectedEdge.line}` : "" }}
              </dd>
            </dl>
            <button
              v-if="
                project.artifacts.find((a) => a.id === selectedEdge?.source)
                  ?.source
              "
              @click="
                selectedId = selectedEdge.source;
                selectedEdgeId = '';
                inspectorTab = 'Source';
              "
            >
              Reveal source <i class="pi pi-arrow-right" />
            </button>
          </div>
        </template>
        <template v-else-if="selected">
          <div class="inspector-heading">
            <span class="type-badge"
              ><i :class="['pi', icons[selected.kind]]" />{{
                selected.kind
              }}</span
            >
            <h2>{{ selected.name }}</h2>
            <code>{{ selected.id }}</code>
          </div>
          <div class="inspector-tabs" role="tablist" aria-label="Inspector">
            <button
              v-for="tab in ['Overview', 'Source', 'Connections']"
              :key="tab"
              :class="{ active: inspectorTab === tab }"
              role="tab"
              :aria-selected="inspectorTab === tab"
              @click="inspectorTab = tab"
            >
              {{ tab }}
            </button>
          </div>
          <div class="inspector-content">
            <template v-if="inspectorTab === 'Overview'"
              ><h3>Configuration</h3>
              <dl>
                <template v-for="(value, key) in selected.metadata" :key="key"
                  ><dt>{{ key }}</dt>
                  <dd>{{ value || "Not specified" }}</dd></template
                >
              </dl>
              <template v-if="selected.schema?.length">
                <h3>Fields and parameters ({{ selected.schema.length }})</h3>
                <dl>
                  <template v-for="field in selected.schema" :key="field.id">
                    <dt>{{ field.label || field.id }}</dt>
                    <dd>
                      <code>{{ field.id }}</code
                      ><br />{{ field.type }} ·
                      {{ field.required ? "Required" : "Optional"
                      }}<span v-if="field.reference">
                        · {{ field.reference }}</span
                      >
                    </dd>
                  </template>
                </dl>
              </template>
              <label class="notes-label"
                >Artifact notes<textarea
                  v-model="selected.description"
                  placeholder="Document the intent of this artifact…"
                  rows="3"
                /></label
              ><label class="notes-label"
                >Architecture decision<textarea
                  v-model="project.notes"
                  rows="5"
                  placeholder="Why is this architecture designed this way?"
                /></label
            ></template>
            <template v-else-if="inspectorTab === 'Source'"
              ><button
                v-if="resolveSource(project, selectedId).module"
                @click="setWorkspaceMode('Code & Run')"
              >
                <i class="pi pi-code" /> Edit and run SuiteScript
              </button>
              <p class="source-path">
                {{ selected.path || "No source file attached" }}
              </p>
              <pre
                v-if="selected.source"
                class="source-code"
              ><code><span v-for="(line, index) in selected.source.split('\n')" :key="index"><b>{{ index + 1 }}</b>{{ line }}
</span></code></pre>
              <p v-else class="empty">
                Import SuiteScript or SDF files to inspect source. For script
                records, follow the “Loads source” connection to the module.
              </p></template
            >
            <template v-else
              ><button
                v-for="connection in connections"
                :key="connection.id"
                class="connection"
                @click="selectedEdgeId = connection.id"
              >
                <span
                  >{{ connection.label }} <i class="pi pi-arrow-right" /></span
                ><strong>{{
                  project.artifacts.find(
                    (a) =>
                      a.id ===
                      (connection.source === selectedId
                        ? connection.target
                        : connection.source),
                  )?.name
                }}</strong
                ><small
                  >{{ connection.provenance
                  }}{{
                    connection.line ? ` · line ${connection.line}` : ""
                  }}</small
                >
              </button>
              <p v-if="!connections.length" class="empty">
                No indexed relationships.
              </p></template
            >
          </div>
        </template>
        <p v-else class="empty">
          Select an artifact or relationship to inspect it.
        </p>
        <div class="inspector-footer">
          <i class="pi pi-info-circle" /> Local behavior pack v1. Approximate;
          no real-account conformance.
        </div>
      </aside>
    </div>
    <footer class="status-bar">
      <span><i class="pi pi-circle-fill" /> Local architecture workspace</span
      ><span>SuiteScript runtime: isolated QuickJS · local fixtures</span
      ><span
        >{{ project.release }} target ·
        {{ Math.round(viewport.zoom * 100) }}%</span
      >
    </footer>
  </section>
</template>

<style scoped>
.workspace-modes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 7px 10px;
  border-bottom: 1px solid var(--wb-border);
}
.workspace-modes .active {
  background: var(--ui-violet-surface, #f1f4fe);
  color: var(--ui-violet, #4f46e5);
  border-color: var(--ui-violet-border, #a5b4fc);
}
.workspace-modes span {
  font-size: 9px;
  color: var(--wb-muted);
}
.workbench {
  --wb-bg: var(--p-content-background, #fff);
  --wb-text: var(--p-text-color, #263347);
  --wb-muted: var(--p-text-muted-color, #718096);
  --wb-border: var(--p-content-border-color, #e0e5ed);
  --wb-soft: var(--p-slate-50, #f8fafc);
  display: flex;
  flex-direction: column;
  min-height: 580px;
  color: var(--wb-text);
  background: var(--wb-bg);
  overflow: hidden;
  border: 1px solid var(--wb-border);
  border-radius: 9px;
  font-family: inherit;
  font-size: 11px;
}
.workbench button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 7px 10px;
  border: 1px solid var(--wb-border);
  border-radius: 5px;
  background: var(--wb-bg);
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
  font-size: 10px;
}
.workbench button:hover:not(:disabled) {
  background: var(--wb-soft);
  border-color: #b7acd9;
}
.workbench button:focus-visible,
.workbench input:focus-visible,
.workbench textarea:focus-visible {
  outline: 2px solid #8272dc;
  outline-offset: 2px;
}
.workbench button:disabled {
  opacity: 0.4;
  cursor: default;
}
.workbench button.primary {
  background: var(--ui-button-accent, #8c9bff);
  color: #1e293b;
  border-color: var(--ui-button-accent, #8c9bff);
}
.workbench button.primary:hover:not(:disabled) {
  background: var(--ui-button-accent-hover, #7b8cf7);
}
.workbench-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 18px;
  border-bottom: 1px solid var(--wb-border);
  flex-wrap: wrap;
}
.brand-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  background: var(--ui-violet-icon-surface, #e0e7ff);
  color: var(--ui-violet, #4f46e5);
  border: 1px solid var(--ui-violet-border, #a5b4fc);
  border-radius: 10px;
  font-size: 19px;
}
.title h1 {
  font-size: 16px;
  font-weight: 700;
  margin: 2px 0 0;
  letter-spacing: -0.5px;
}
.eyebrow {
  color: #7965ba;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 1.4px;
}
.eyebrow span {
  margin-left: 8px;
  color: var(--wb-muted);
  letter-spacing: 0.8px;
  font-weight: 400;
}
.save-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  color: var(--wb-muted);
  font-size: 9px;
}
.save-status i {
  color: #51a797;
  font-size: 6px;
}
.header-actions {
  display: flex;
  gap: 7px;
  margin-left: auto;
}
.scenario-bar {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 10px 18px;
  background: var(--wb-soft);
  border-bottom: 1px solid var(--wb-border);
  flex-wrap: wrap;
}
.scenario-bar label,
.scenario-detail {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.scenario-bar label > span,
.scenario-detail > span {
  font-size: 8px;
  letter-spacing: 0.8px;
  color: var(--wb-muted);
}
.project-name {
  flex: 1;
  min-width: 200px;
  max-width: 330px;
}
.project-name input {
  background: transparent;
  border: 0;
  border-bottom: 1px solid transparent;
  color: inherit;
  font: inherit;
  font-weight: 600;
  width: 100%;
  padding: 4px 0;
}
.project-name input:focus {
  border-color: #8a7bd6;
  outline: none;
}
.release {
  width: 110px;
}
.scenario-detail strong {
  font-size: 10px;
  font-weight: 500;
}
.fidelity strong {
  color: #aa7527;
}
.playback {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.notice {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 15px;
  background: #f5f2ff;
  color: #625492;
}
.notice button {
  margin-left: auto;
  padding: 2px;
  border: 0;
  background: transparent;
}
.workbench-body {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
}
.explorer {
  width: 228px;
  min-width: 175px;
  max-width: 35%;
  resize: horizontal;
  overflow: auto;
  border-right: 1px solid var(--wb-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.pane-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 9px;
  letter-spacing: 0.7px;
  font-weight: 600;
  min-height: 43px;
  border-bottom: 1px solid var(--wb-border);
}
.pane-title > span {
  padding: 1px 5px;
  color: var(--wb-muted);
  border-radius: 4px;
  background: var(--wb-soft);
}
.pane-title button {
  margin-left: auto;
  padding: 2px;
  border: 0;
  color: var(--wb-muted);
}
.explorer-filters {
  display: grid;
  gap: 9px;
  padding: 12px;
}
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--wb-border);
  border-radius: 5px;
  padding: 7px;
  color: var(--wb-muted);
}
.search input {
  width: 100%;
  min-width: 0;
  color: inherit;
  font: inherit;
  font-size: 10px;
  background: transparent;
  border: 0;
  outline: none;
}
.artifact-list {
  overflow: auto;
  flex: 1;
  padding: 0 6px;
}
.artifact-list button {
  display: flex;
  text-align: left;
  justify-content: flex-start;
  width: 100%;
  border: 1px solid transparent;
  gap: 10px;
  padding: 10px 8px;
  margin-bottom: 3px;
}
.artifact-list button > i {
  color: #8a81ae;
  font-size: 14px;
}
.artifact-list button.active {
  background: #f1eefb;
  border-color: #e2dcf5;
  color: #5d4aa7;
}
.artifact-list span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.artifact-list strong,
.artifact-list small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 500;
}
.artifact-list small {
  color: var(--wb-muted);
  font-size: 8px;
}
.explorer-footer {
  display: flex;
  gap: 10px;
  align-items: center;
  color: var(--wb-muted);
  padding: 13px;
  border-top: 1px solid var(--wb-border);
  font-size: 9px;
}
.center-pane {
  display: flex;
  flex-direction: column;
  min-width: 240px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.canvas-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  min-height: 43px;
  border-bottom: 1px solid var(--wb-border);
  padding: 6px 10px;
}
.canvas-toolbar strong {
  display: flex;
  gap: 7px;
  align-items: center;
  font-size: 10px;
  font-weight: 500;
}
.canvas-toolbar strong i {
  color: #7964c7;
}
.canvas-toolbar button {
  padding: 4px 7px;
  font-size: 9px;
  border-color: transparent;
}
.canvas-toolbar .active {
  color: #6a56b8;
  background: #eeeafa;
}
.count {
  font-size: 8px;
  color: var(--wb-muted);
}
.toolbar-spacer {
  flex: 1;
}
.graph-stage {
  position: relative;
  flex: 1;
  min-height: 200px;
  background: #f8fafc;
}
.graph-caption {
  pointer-events: none;
  position: absolute;
  top: 12px;
  left: 15px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #7f8a9d;
  font-size: 8px;
}
.graph-caption span:last-child {
  margin-left: 14px;
}
.legend-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #8f80c9;
}
.graph-empty {
  position: absolute;
  inset: 40% 15% auto;
  text-align: center;
  color: var(--wb-muted);
}
.artifact-node {
  width: 242px;
  background: var(--wb-bg);
  border: 1px solid #d9dfea;
  border-radius: 9px;
  box-shadow: 0 3px 9px #233a5510;
  overflow: hidden;
}
.artifact-node.selected {
  border-color: #8b75d6;
  box-shadow: 0 0 0 3px #8b75d618;
}
.artifact-node.executing {
  border-color: #35a38c;
  box-shadow: 0 0 0 4px #35a38c20;
}
.node-kind {
  display: flex;
  gap: 7px;
  align-items: center;
  padding: 10px 12px 6px;
  color: #7760b7;
  text-transform: uppercase;
  font-size: 9px;
  letter-spacing: 0.5px;
}
.kind-record .node-kind {
  color: #4289a3;
}
.kind-integration .node-kind {
  color: #b08039;
}
.kind-deployment .node-kind {
  color: #549780;
}
.node-pulse {
  margin-left: auto;
}
.artifact-node > strong {
  display: block;
  padding: 0 12px 4px;
  font-size: 12px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.artifact-node > small {
  display: block;
  padding: 0 12px 12px;
  font-size: 8px;
  color: var(--wb-muted);
  overflow-wrap: anywhere;
}
.node-footer {
  display: flex;
  justify-content: space-between;
  background: var(--wb-soft);
  border-top: 1px solid var(--wb-border);
  padding: 6px 12px;
  color: var(--wb-muted);
  font-size: 8px;
}
.compact > strong {
  padding-bottom: 10px;
}
.artifact-node :deep(.vue-flow__handle) {
  width: 7px;
  height: 7px;
  background: #a494cf;
  border: 2px solid white;
}
:deep(.vue-flow__minimap) {
  width: 130px;
  height: 85px;
  border: 1px solid #dde2ec;
  border-radius: 6px;
  overflow: hidden;
}
:deep(.vue-flow__edge) {
  cursor: pointer;
}
:deep(.vue-flow__controls) {
  box-shadow: 0 2px 8px #20334b15;
}
.debug-dock {
  height: 195px;
  min-height: 125px;
  max-height: 55%;
  resize: vertical;
  overflow: auto;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--wb-border);
  flex-shrink: 0;
}
.dock-tabs {
  display: flex;
  align-items: center;
  gap: 5px;
  border-bottom: 1px solid var(--wb-border);
  padding: 0 10px;
}
.dock-tabs button,
.inspector-tabs button {
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  padding: 10px 8px;
  font-size: 9px;
  color: var(--wb-muted);
}
.dock-tabs button.active,
.inspector-tabs button.active {
  border-bottom-color: #7d65cd;
  color: #7154bc;
}
.dock-tabs button span {
  background: #f4ebd8;
  color: #a5772c;
  border-radius: 4px;
  padding: 0 4px;
  font-size: 8px;
}
.dock-tabs > small {
  margin-left: auto;
  font-size: 8px;
  white-space: nowrap;
  color: var(--wb-muted);
}
.dock-content {
  flex: 1;
  overflow: auto;
  padding: 11px 14px;
}
.trace-label {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--wb-muted);
  font-size: 9px;
  margin-bottom: 12px;
}
.timeline {
  display: flex;
  align-items: stretch;
  gap: 8px;
  overflow: auto;
  padding-bottom: 5px;
}
.timeline button {
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-width: 142px;
  padding: 8px 10px;
  text-align: left;
}
.timeline button.current {
  border-color: #8b75d6;
  background: #f4f0ff;
}
.timeline button.visited {
  border-color: #b7d6cf;
}
.event-number {
  font-size: 8px;
  color: #9182b9;
}
.timeline strong {
  font-size: 9px;
  font-weight: 500;
}
.timeline small {
  font-size: 8px;
  color: var(--wb-muted);
}
.event-details p,
.event-details code {
  display: block;
  margin-top: 8px;
  color: var(--wb-muted);
  font-size: 10px;
}
.governance {
  display: flex;
  gap: 25px;
  align-items: center;
}
.governance > strong {
  font-size: 30px;
  color: #7d65cd;
  flex-shrink: 0;
}
.governance small {
  display: block;
  color: var(--wb-muted);
  font-size: 9px;
  font-weight: 400;
}
.governance p {
  max-width: 500px;
  color: var(--wb-muted);
  font-size: 10px;
}
.diagnostic-list article {
  display: flex;
  gap: 9px;
  padding-bottom: 12px;
}
.diagnostic-list article > i {
  color: #b08a4c;
}
.diagnostic-list strong {
  font-size: 10px;
  font-weight: 500;
}
.diagnostic-list p {
  font-size: 9px;
  color: var(--wb-muted);
  margin-top: 4px;
  overflow-wrap: anywhere;
}
.inspector {
  width: 275px;
  min-width: 210px;
  max-width: 35%;
  border-left: 1px solid var(--wb-border);
  display: flex;
  flex-direction: column;
  overflow: auto;
}
.inspector-heading {
  padding: 16px 15px 13px;
}
.type-badge {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: #8470b9;
  background: #f2eef9;
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 8px;
  text-transform: uppercase;
}
.inspector-heading h2 {
  font-size: 14px;
  font-weight: 600;
  margin: 10px 0 5px;
  overflow-wrap: anywhere;
}
.inspector-heading code,
.inspector-heading p {
  font-size: 9px;
  color: var(--wb-muted);
  overflow-wrap: anywhere;
}
.inspector-tabs {
  display: flex;
  border-bottom: 1px solid var(--wb-border);
  padding: 0 8px;
}
.inspector-content {
  padding: 15px;
  overflow: auto;
  flex: 1;
  min-height: 0;
}
.inspector-content h3 {
  font-size: 10px;
  font-weight: 600;
  margin: 0 0 12px;
}
dl {
  margin: 0 0 18px;
}
dt {
  font-size: 9px;
  color: var(--wb-muted);
  margin-bottom: 3px;
}
dd {
  font-size: 10px;
  margin: 0 0 12px;
  overflow-wrap: anywhere;
}
.notes-label {
  display: block;
  font-size: 9px;
  margin-top: 15px;
  color: var(--wb-muted);
}
.notes-label textarea {
  display: block;
  width: 100%;
  resize: vertical;
  border: 1px solid var(--wb-border);
  border-radius: 5px;
  background: var(--wb-soft);
  color: var(--wb-text);
  font: inherit;
  font-size: 10px;
  line-height: 1.7;
  padding: 8px;
  margin-top: 6px;
}
.inspector-footer {
  padding: 11px 14px;
  border-top: 1px solid var(--wb-border);
  color: var(--wb-muted);
  font-size: 8px;
}
.source-path {
  font-size: 9px;
  color: var(--wb-muted);
  overflow-wrap: anywhere;
}
.source-code {
  margin-top: 12px;
  font-size: 10px;
  line-height: 1.7;
  overflow: auto;
}
.source-code b {
  display: inline-block;
  width: 28px;
  user-select: none;
  color: var(--wb-muted);
  font-weight: 400;
}
.connection {
  display: flex !important;
  width: 100%;
  flex-direction: column;
  align-items: flex-start !important;
  margin-bottom: 8px;
  text-align: left;
  white-space: normal !important;
}
.connection strong {
  font-size: 10px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.connection small {
  color: var(--wb-muted);
  font-size: 8px;
}
.empty {
  padding: 16px 6px;
  color: var(--wb-muted);
  font-size: 10px;
  line-height: 1.7;
}
.status-bar {
  display: flex;
  gap: 20px;
  padding: 6px 12px;
  border-top: 1px solid var(--wb-border);
  font-size: 8px;
  color: var(--wb-muted);
}
.status-bar span {
  display: flex;
  gap: 6px;
  align-items: center;
}
.status-bar i {
  font-size: 5px;
  color: #66a693;
}
.status-bar span:last-child {
  margin-left: auto;
}
@media (max-width: 1100px) {
  .save-status,
  .scenario-detail,
  .count {
    display: none;
  }
  .explorer {
    width: 180px;
  }
  .inspector {
    width: 220px;
  }
  .graph-caption span:last-child {
    display: none;
  }
  .workbench-header {
    padding: 10px;
  }
  .header-actions {
    flex-wrap: wrap;
  }
}
@media (max-width: 760px) {
  .workbench {
    min-height: 700px;
  }
  .workbench-body {
    overflow-x: auto;
  }
  .explorer {
    min-width: 155px;
  }
  .center-pane {
    min-width: 380px;
  }
  .inspector {
    min-width: 210px;
  }
  .scenario-bar {
    gap: 12px;
  }
  .status-bar span:nth-child(2) {
    display: none;
  }
}
</style>
