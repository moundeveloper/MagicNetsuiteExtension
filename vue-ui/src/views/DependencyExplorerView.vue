<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import { VueFlow, type Edge, type Node } from "@vue-flow/core";
import { Button, InputText, Tag, useToast } from "primevue";
import VueSplitter from "@rmp135/vue-splitter";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import { callApi, getNetsuiteEnvironment } from "../utils/api";
import { RequestRoutes } from "../types/request";
import {
  dependencyNodeKey,
  getDependencyScanMeta,
  loadDependencyNodes,
  parseSuiteScriptDependencies,
  parseSuiteScriptSemantics,
  resolveDependencyGraph,
  saveDependencyScan,
  type DependencyScanMeta,
  type ScriptConnection,
  type ScriptDependencyNode
} from "../utils/scriptDependencyDb";

type ScriptRow = {
  id: number;
  name: string;
  scriptid: string;
  scripttype: string;
  scriptfile: string;
};

type ScriptFile = {
  id: number;
  fileId: number | null;
  scriptFile: string | null;
};

type CabinetFile = {
  id: number | string;
  name: string;
  url: string;
  filetype?: string;
};

type DeploymentRow = {
  scriptid?: string;
  deploymentid?: string | number;
  id?: number;
};

const props = defineProps<{ vhOffset: number }>();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const environment = ref("unknown");
const nodes = ref<ScriptDependencyNode[]>([]);
const scanMeta = ref<DependencyScanMeta | null>(null);
const selectedKey = ref("");
const query = ref("");
const scanning = ref(false);
const scanProgress = ref({ done: 0, total: 0 });
const graphRef = ref<InstanceType<typeof VueFlow> | null>(null);
const MIN_INDEX_PANE_PERCENT = 15;
const indexPanePercent = ref(25);
const sourcePanePercent = ref(62);
const navigationHistory = ref<string[]>([]);
const navigationIndex = ref(-1);
const selectedEvidence = ref<{
  title: string;
  sourceKey: string;
  line?: number;
  evidence: string;
} | null>(null);

const nodeMap = computed(
  () => new Map(nodes.value.map((node) => [node.key, node]))
);
const selected = computed(() => nodeMap.value.get(selectedKey.value) ?? null);
const evidenceNode = computed(() =>
  selectedEvidence.value
    ? nodeMap.value.get(selectedEvidence.value.sourceKey) ?? null
    : null
);
const evidenceHighlight = computed(() => {
  const evidence = selectedEvidence.value;
  if (!evidence?.line) return null;
  return {
    startLine: evidence.line,
    endLine:
      evidence.line + Math.max(0, evidence.evidence.split(/\r?\n/).length - 1)
  };
});

watch(indexPanePercent, (percent) => {
  if (percent < MIN_INDEX_PANE_PERCENT) {
    indexPanePercent.value = MIN_INDEX_PANE_PERCENT;
  }
});
const historyEntries = computed(() =>
  navigationHistory.value
    .map((key, index) => ({
      key,
      index,
      node: nodeMap.value.get(key)
    }))
    .filter(
      (
        entry
      ): entry is {
        key: string;
        index: number;
        node: ScriptDependencyNode;
      } => Boolean(entry.node)
    )
);
const canGoBack = computed(() => navigationIndex.value > 0);
const canGoForward = computed(
  () => navigationIndex.value < navigationHistory.value.length - 1
);
const outgoingConnections = computed(() => selected.value?.connections ?? []);
const selectedRecordTypes = computed(() => [
  ...new Set((selected.value?.recordUsage ?? []).map((usage) => usage.recordType))
]);
const selectedExternalTargets = computed(() => [
  ...new Set(
    (selected.value?.connections ?? [])
      .filter((connection) => connection.kind === "external-http")
      .map((connection) => connection.targetRef)
  )
]);
const dependents = computed(() =>
  selected.value
    ? nodes.value.filter((node) =>
        (node.connections ?? []).some(
          (connection) => connection.targetKey === selected.value!.key
        )
      )
    : []
);
const dependencies = computed(() =>
  [...new Set(
    (selected.value?.connections ?? [])
      .map((connection) => connection.targetKey)
      .filter((key): key is string => Boolean(key))
  )]
    .map((key) => nodeMap.value.get(key))
    .filter((node): node is ScriptDependencyNode => Boolean(node))
);

const filteredNodes = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return nodes.value;
  return nodes.value.filter((node) =>
    `${node.name} ${node.scriptId} ${node.scriptType} ${node.fileName}`
      .toLowerCase()
      .includes(needle)
  );
});

const cycleKeys = computed(() => {
  const cycles = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (key: string, path: string[]) => {
    if (visiting.has(key)) {
      const start = path.indexOf(key);
      path.slice(start).forEach((item) => cycles.add(item));
      cycles.add(key);
      return;
    }
    if (visited.has(key)) return;
    visiting.add(key);
    const node = nodeMap.value.get(key);
    (node?.connections ?? [])
      .map((connection) => connection.targetKey)
      .filter((target): target is string => Boolean(target))
      .forEach((dependency) => walk(dependency, [...path, key]));
    visiting.delete(key);
    visited.add(key);
  };
  nodes.value.forEach((node) => walk(node.key, []));
  return cycles;
});

const graphKeys = computed(() => {
  if (!selected.value) return new Set<string>();
  return new Set([
    selected.value.key,
    ...(selected.value.connections ?? [])
      .map((connection) => connection.targetKey)
      .filter((key): key is string => Boolean(key)),
    ...dependents.value.map((node) => node.key)
  ]);
});

const graphNodes = computed<Node[]>(() => {
  const related = nodes.value.filter((node) => graphKeys.value.has(node.key));
  const selectedNode = selected.value;
  const canvasCenterX = 560;
  const scriptLaneGap = 460;
  const scriptStartY = 70;
  const scriptRowGap = 135;
  const recordStartY = 440;
  const recordRowGap = 118;
  const externalStartY = 440;
  const externalRowGap = 118;
  const scriptNodes: Node[] = related.map((node) => {
    const isSelected = node.key === selectedNode?.key;
    const isDependency = selectedNode?.connections?.some(
      (connection) => connection.targetKey === node.key
    );
    const index = isSelected
      ? 0
      : isDependency
        ? dependencies.value.findIndex((item) => item.key === node.key)
        : dependents.value.findIndex((item) => item.key === node.key);
    const side = isSelected ? 0 : isDependency ? 1 : -1;
    const nodeLabel = node.scriptId || node.name;
    const nodeWidth = Math.min(
      380,
      Math.max(220, 80 + nodeLabel.length * 7)
    );
    return {
      id: node.key,
      label: nodeLabel,
      position: isSelected
        ? { x: canvasCenterX, y: 225 }
        : {
            x: canvasCenterX + side * scriptLaneGap,
            y: scriptStartY + Math.max(0, index) * scriptRowGap
          },
      style: {
        width: `${nodeWidth}px`,
        maxWidth: "380px",
        whiteSpace: "normal",
        lineHeight: "1.35",
        borderRadius: "9px",
        padding: "10px",
        border: isSelected
          ? "2px solid #6d5dfc"
          : cycleKeys.value.has(node.key)
            ? "2px solid #ef4444"
            : "1px solid #cbd5e1",
        background: isSelected
          ? "#ede9fe"
          : isDependency
            ? "#eff6ff"
            : "#f0fdf4",
        color: "#253047",
        fontSize: "11px",
        fontFamily: "JetBrains Mono"
      }
    };
  });
  const recordNodes: Node[] = selectedRecordTypes.value.map(
    (recordType, index) => ({
      id: `record:${recordType}`,
      label: recordType,
      position: {
        x: canvasCenterX - 250 + (index % 2) * 500,
        y: recordStartY + Math.floor(index / 2) * recordRowGap
      },
      style: {
        width: "230px",
        borderRadius: "18px",
        padding: "9px",
        border: "1px solid #f59e0b",
        background: "#fffbeb",
        color: "#92400e",
        fontSize: "11px",
        fontFamily: "JetBrains Mono"
      }
    })
  );
  const externalNodes: Node[] = selectedExternalTargets.value.map(
    (target, index) => {
      const host = target.match(/^https?:\/\/([^/]+)/i)?.[1] ?? target;
      return {
        id: `external:${target}`,
        label: host,
        position: {
          x: canvasCenterX + 660,
          y: externalStartY + index * externalRowGap
        },
        style: {
          width: "250px",
          borderRadius: "18px",
          padding: "9px",
          border: "1px solid #06b6d4",
          background: "#ecfeff",
          color: "#155e75",
          fontSize: "11px",
          fontFamily: "JetBrains Mono"
        }
      };
    }
  );
  return [...scriptNodes, ...recordNodes, ...externalNodes];
});

const graphEdges = computed<Edge[]>(() => {
  const edges: Edge[] = [];
  for (const node of nodes.value) {
    if (!graphKeys.value.has(node.key)) continue;
    for (const connection of node.connections ?? []) {
      const target =
        connection.kind === "external-http"
          ? `external:${connection.targetRef}`
          : connection.targetKey;
      if (
        !target ||
        (connection.kind !== "external-http" && !graphKeys.value.has(target))
      ) continue;
      const color =
        connection.kind === "module"
          ? "#8b7ee8"
            : connection.kind === "client-script"
            ? "#0ea5e9"
            : connection.kind === "external-http"
              ? "#06b6d4"
            : connection.kind.includes("task")
              ? "#f59e0b"
              : "#10b981";
      edges.push({
        id: `${node.key}->${target}:${connection.kind}`,
        source: node.key,
        target,
        animated: node.key === selected.value?.key,
        type: "smoothstep",
        label: connection.kind,
        labelStyle: { fontSize: 9, fill: color },
        style: { stroke: color }
      });
    }
  }
  const recordOperations = new Map<string, Set<string>>();
  for (const usage of selected.value?.recordUsage ?? []) {
    const operations =
      recordOperations.get(usage.recordType) ?? new Set<string>();
    operations.add(usage.operation);
    recordOperations.set(usage.recordType, operations);
  }
  for (const [recordType, operations] of recordOperations) {
    const label = [...operations].join(" · ");
    edges.push({
      id: `${selected.value!.key}->record:${recordType}`,
      source: selected.value!.key,
      target: `record:${recordType}`,
      type: "smoothstep",
      label,
      labelStyle: { fontSize: 9, fill: "#b45309" },
      style: { stroke: "#f59e0b", strokeDasharray: "5 3" }
    });
  }
  return edges;
});

const selectNode = async (
  key: string,
  historyMode: "push" | "replace" | "preserve" = "push"
) => {
  if (!nodeMap.value.has(key)) return;
  if (historyMode === "replace") {
    navigationHistory.value = [key];
    navigationIndex.value = 0;
  } else if (historyMode === "push") {
    const current = navigationHistory.value[navigationIndex.value];
    if (current !== key) {
      navigationHistory.value = [
        ...navigationHistory.value.slice(0, navigationIndex.value + 1),
        key
      ];
      navigationIndex.value = navigationHistory.value.length - 1;
    }
  }
  selectedKey.value = key;
  selectedEvidence.value = null;
  await nextTick();
  graphRef.value?.fitView({ padding: 0.2 });
};

const navigateHistory = async (index: number) => {
  const key = navigationHistory.value[index];
  if (!key || !nodeMap.value.has(key)) return;
  navigationIndex.value = index;
  await selectNode(key, "preserve");
};

const goBack = () => {
  if (canGoBack.value) void navigateHistory(navigationIndex.value - 1);
};

const goForward = () => {
  if (canGoForward.value) void navigateHistory(navigationIndex.value + 1);
};

const showEvidence = (
  title: string,
  item: { evidence: string; line?: number },
  sourceKey = selectedKey.value
) => {
  selectedEvidence.value = {
    title,
    sourceKey,
    line: item.line,
    evidence: item.evidence
  };
};

const openConnection = async (connection: ScriptConnection) => {
  const sourceKey = selectedKey.value;
  if (connection.targetKey) {
    await selectNode(connection.targetKey);
  }
  showEvidence(connectionLabel(connection.kind), connection, sourceKey);
};

const handleGraphNodeClick = (node: Node) => {
  const id = node.id;
  if (id.startsWith("record:")) {
    const recordType = id.slice("record:".length);
    const usage = (selected.value?.recordUsage ?? []).find(
      (item) => item.recordType === recordType
    );
    if (usage) showEvidence(`${usage.operation} ${usage.recordType}`, usage);
    return;
  }
  if (id.startsWith("external:")) {
    const targetRef = id.slice("external:".length);
    const connection = (selected.value?.connections ?? []).find(
      (item) =>
        item.kind === "external-http" && item.targetRef === targetRef
    );
    if (connection) {
      showEvidence(connectionLabel(connection.kind), connection);
    }
    return;
  }
  void selectNode(id);
};

const loadCached = async () => {
  environment.value = await getNetsuiteEnvironment().catch(() => "unknown");
  const [cachedNodes, cachedMeta] = await Promise.all([
    loadDependencyNodes(environment.value),
    getDependencyScanMeta(environment.value)
  ]);
  nodes.value = cachedNodes;
  scanMeta.value = cachedMeta ?? null;
  const focus = Number(route.query.scriptId || 0);
  const focused = nodes.value.find((node) => node.scriptInternalId === focus);
  if (focused) await selectNode(focused.key, "replace");
  else if (nodes.value[0]) await selectNode(nodes.value[0].key, "replace");
};

const scanAccount = async () => {
  scanning.value = true;
  scanProgress.value = { done: 0, total: 0 };
  try {
    const scriptsResponse = await callApi(RequestRoutes.SCRIPTS);
    if (scriptsResponse?.status === "error") {
      throw new Error(String(scriptsResponse.message));
    }
    const scripts = (scriptsResponse.message ?? []) as ScriptRow[];
    scanProgress.value.total = scripts.length;
    const files: ScriptFile[] = [];
    const deployments: DeploymentRow[] = [];
    const batchSize = 20;
    for (let index = 0; index < scripts.length; index += batchSize) {
      const batch = scripts.slice(index, index + batchSize);
      const response = await callApi(RequestRoutes.SCRIPT_FILES, {
        scriptIds: batch.map((script) => Number(script.id))
      });
      if (response?.status !== "error" && Array.isArray(response?.message)) {
        files.push(...response.message);
      }
      const deploymentsResponse = await callApi(
        RequestRoutes.SCRIPT_DEPLOYMENTS,
        { scriptIds: batch.map((script) => Number(script.id)) }
      );
      if (
        deploymentsResponse?.status !== "error" &&
        Array.isArray(deploymentsResponse?.message)
      ) {
        deployments.push(...deploymentsResponse.message);
      }
      scanProgress.value.done = Math.min(index + batch.length, scripts.length);
    }

    const filesByScript = new Map(files.map((file) => [Number(file.id), file]));
    const deploymentTargets: Record<string, string> = {};
    for (const deployment of deployments) {
      const scriptInternalId = Number(deployment.id);
      const targetKey = dependencyNodeKey(environment.value, scriptInternalId);
      if (deployment.scriptid) {
        deploymentTargets[String(deployment.scriptid).toLowerCase()] = targetKey;
      }
      if (deployment.deploymentid != null) {
        deploymentTargets[String(deployment.deploymentid).toLowerCase()] =
          targetKey;
      }
    }
    const scannedAt = Date.now();
    const unresolved: Array<
      Omit<
        ScriptDependencyNode,
        "resolvedDependencies" | "unresolvedDependencies"
      >
    > = scripts.map((script) => {
      const file = filesByScript.get(Number(script.id));
      const source = String(file?.scriptFile || "");
      const semantics = parseSuiteScriptSemantics(source);
      return {
        key: dependencyNodeKey(environment.value, Number(script.id)),
        environment: environment.value,
        scriptInternalId: Number(script.id),
        scriptId: String(script.scriptid || ""),
        name: String(script.name || ""),
        scriptType: String(script.scripttype || ""),
        fileName: String(script.scriptfile || ""),
        fileId: file?.fileId != null ? Number(file.fileId) : null,
        imports: parseSuiteScriptDependencies(source),
        connections: semantics.connections,
        recordUsage: semantics.recordUsage,
        source,
        scannedAt
      };
    });

    const attachedRefs = new Set<string>();
    for (const node of unresolved) {
      for (const connection of node.connections) {
        if (
          connection.kind === "client-script" ||
          connection.kind === "html-file"
        ) {
          attachedRefs.add(connection.targetRef);
        }
      }
    }

    const attachedNodes: typeof unresolved = [];
    for (const targetRef of attachedRefs) {
      const name = targetRef.replace(/\\/g, "/").split("/").pop() || targetRef;
      try {
        const findResponse = await callApi(RequestRoutes.FIND_FILE, { name });
        const payload = findResponse.message as {
          files?: CabinetFile[] | { results?: CabinetFile[] };
        };
        const rows = Array.isArray(payload?.files)
          ? payload.files
          : payload?.files?.results ?? [];
        const file =
          rows.find((item) => item.name.toLowerCase() === name.toLowerCase()) ??
          rows[0];
        if (!file?.id || !file.url) continue;
        const contentResponse = await callApi(RequestRoutes.FETCH_FILE_CONTENT, {
          fileUrl: file.url
        });
        const contentPayload = contentResponse.message as {
          content?: string;
          binary?: boolean;
        };
        if (contentPayload?.binary) continue;
        const source = String(contentPayload?.content ?? "");
        const semantics = parseSuiteScriptSemantics(source);
        attachedNodes.push({
          key: `${environment.value}::file::${file.id}`,
          environment: environment.value,
          scriptInternalId: -Number(file.id),
          scriptId: "",
          name: file.name,
          scriptType: /\.html?$/i.test(file.name)
            ? "HTML Client"
            : "Client Module",
          nodeType: /\.html?$/i.test(file.name) ? "html-file" : "client-file",
          fileName: file.name,
          fileId: Number(file.id),
          imports: parseSuiteScriptDependencies(source),
          connections: semantics.connections,
          recordUsage: semantics.recordUsage,
          source,
          scannedAt
        });
      } catch {
        // Keep the parent connection unresolved when the File Cabinet lookup fails.
      }
    }

    nodes.value = resolveDependencyGraph(
      [...unresolved, ...attachedNodes],
      deploymentTargets
    );
    await saveDependencyScan(environment.value, nodes.value);
    scanMeta.value =
      (await getDependencyScanMeta(environment.value)) ?? null;
    const focus = Number(route.query.scriptId || 0);
    const target =
      nodes.value.find((node) => node.scriptInternalId === focus) ??
      nodes.value[0];
    if (target) await selectNode(target.key, "replace");
    toast.add({
      severity: "success",
      summary: "Dependency scan complete",
      detail: `${nodes.value.length} scripts mapped`,
      life: 3000
    });
  } catch (error) {
    toast.add({
      severity: "error",
      summary: "Dependency scan failed",
      detail: error instanceof Error ? error.message : String(error),
      life: 4500
    });
  } finally {
    scanning.value = false;
  }
};

const openScript = (node: ScriptDependencyNode) =>
  node.nodeType && node.nodeType !== "script"
    ? router.push("/better-filecabinet")
    : router.push(`/scripts/${node.scriptInternalId}`);

const connectionTarget = (targetKey?: string) =>
  targetKey ? nodeMap.value.get(targetKey) ?? null : null;

const connectionLabel = (kind: string) =>
  ({
    module: "imports module",
    "client-script": "attaches client script",
    "scheduled-task": "submits scheduled script",
    "map-reduce-task": "submits map/reduce",
    suitelet: "calls Suitelet",
    restlet: "calls RESTlet",
    "external-http": "calls external service"
  })[kind] ?? kind;

const formatTime = (timestamp?: number) =>
  timestamp
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(timestamp)
    : "Never";

onMounted(async () => {
  await loadCached();
  if (!nodes.value.length && route.query.scriptId) await scanAccount();
});
</script>

<template>
  <section class="dependency-explorer" :style="{ height: `${props.vhOffset}vh` }">
    <header class="explorer-header">
      <div>
        <span class="eyebrow"><i class="pi pi-share-alt"></i> SUITESCRIPT IMPACT MAP</span>
        <h1>Dependency Explorer</h1>
        <p>See what each script uses—and what may be affected before you change it.</p>
      </div>
      <div class="scan-actions">
        <span v-if="scanMeta">Last scan {{ formatTime(scanMeta.scannedAt) }}</span>
        <Button
          icon="pi pi-refresh"
          :label="scanning ? `${scanProgress.done}/${scanProgress.total}` : 'Scan account'"
          :loading="scanning"
          @click="scanAccount"
        />
      </div>
    </header>

    <VueSplitter
      v-model:percent="indexPanePercent"
      :initial-percent="25"
      class="explorer-layout"
    >
      <template #left-pane>
        <aside class="script-index">
        <label class="script-search">
          <i class="pi pi-search"></i>
          <InputText v-model="query" placeholder="Find a script or module…" />
          <button
            v-if="query"
            type="button"
            aria-label="Clear script search"
            title="Clear search"
            @click="query = ''"
          >
            <i class="pi pi-times"></i>
          </button>
        </label>
        <div class="script-list">
          <div v-if="!nodes.length && !scanning" class="empty">
            <i class="pi pi-sitemap"></i>
            <strong>No dependency map yet</strong>
            <span>Scan this account to build one.</span>
          </div>
          <button
            v-for="node in filteredNodes"
            :key="node.key"
            :class="{ active: selectedKey === node.key }"
            @click="selectNode(node.key, 'replace')"
          >
            <span>
              <strong>{{ node.name || node.scriptId }}</strong>
              <small>{{ node.scriptId }} · {{ node.scriptType }}</small>
            </span>
            <span class="node-badges">
              <Tag
                v-if="cycleKeys.has(node.key)"
                value="cycle"
                severity="danger"
                rounded
              />
              <b>{{ (node.connections ?? []).length }}</b>
            </span>
          </button>
        </div>
        </aside>
      </template>

      <template #right-pane>
        <main class="impact-workspace">
        <div v-if="!selected" class="empty">
          <i class="pi pi-share-alt"></i>
          Select a script to inspect its impact.
        </div>
        <template v-else>
          <VueSplitter
            v-model:percent="sourcePanePercent"
            class="impact-content-splitter"
            :class="{ 'no-source': !selectedEvidence }"
          >
            <template #left-pane>
              <div class="impact-primary">
          <div class="impact-heading">
            <div>
              <span>{{ selected.scriptType }}</span>
              <h2>{{ selected.name }}</h2>
              <code>{{ selected.scriptId }} · {{ selected.fileName }}</code>
            </div>
            <Button
              :label="selected.nodeType && selected.nodeType !== 'script' ? 'Open File Cabinet' : 'Open Script'"
              :icon="selected.nodeType && selected.nodeType !== 'script' ? 'pi pi-folder-open' : 'pi pi-code'"
              size="small"
              outlined
              @click="openScript(selected)"
            />
          </div>

          <div class="impact-stats">
            <article>
              <span>Script connections</span>
              <strong>{{ outgoingConnections.length }}</strong>
            </article>
            <article>
              <span>Potentially impacted</span>
              <strong>{{ dependents.length }}</strong>
            </article>
            <article>
              <span>Record types used</span>
              <strong>{{ selectedRecordTypes.length }}</strong>
            </article>
            <article :class="{ danger: cycleKeys.has(selected.key) }">
              <span>Circular dependency</span>
              <strong>{{ cycleKeys.has(selected.key) ? "Yes" : "No" }}</strong>
            </article>
          </div>

          <nav class="graph-history" aria-label="Diagram navigation history">
            <button
              title="Back"
              :disabled="!canGoBack"
              @click="goBack"
            >
              <i class="pi pi-arrow-left"></i>
            </button>
            <button
              title="Forward"
              :disabled="!canGoForward"
              @click="goForward"
            >
              <i class="pi pi-arrow-right"></i>
            </button>
            <div class="history-trail">
              <template v-for="entry in historyEntries" :key="`${entry.index}:${entry.key}`">
                <i v-if="entry.index > 0" class="pi pi-angle-right"></i>
                <button
                  :class="{ current: entry.index === navigationIndex }"
                  :title="entry.node.name"
                  @click="navigateHistory(entry.index)"
                >
                  {{ entry.node.scriptId || entry.node.name }}
                </button>
              </template>
            </div>
          </nav>

          <div class="graph-stage">
            <div class="graph-shell">
              <VueFlow
                ref="graphRef"
                :nodes="graphNodes"
                :edges="graphEdges"
                fit-view
                :min-zoom="0.2"
                :max-zoom="2"
                @node-click="handleGraphNodeClick($event.node)"
              >
                <Background pattern-color="#cbd5e1" :gap="18" />
                <MiniMap />
                <Controls position="top-left" />
              </VueFlow>
            </div>

          </div>

          <div class="relationship-lists">
            <section>
              <h3>Calls & attachments</h3>
              <button
                v-for="connection in outgoingConnections"
                :key="`${connection.kind}:${connection.targetRef}:${connection.deploymentRef || ''}`"
                :class="{ unresolved: !connection.targetKey && connection.kind !== 'external-http' }"
                @click="openConnection(connection)"
              >
                <i
                  :class="
                    connection.kind === 'client-script'
                      ? 'pi pi-desktop'
                      : connection.kind.includes('task')
                        ? 'pi pi-send'
                        : connection.kind === 'suitelet' || connection.kind === 'restlet' || connection.kind === 'external-http'
                          ? 'pi pi-link'
                          : 'pi pi-arrow-right'
                  "
                ></i>
                <span>
                  <strong>
                    {{ connectionTarget(connection.targetKey)?.name || connection.targetRef }}
                  </strong>
                  <small>
                    {{ connectionLabel(connection.kind) }}
                    <template v-if="connection.deploymentRef">
                      · {{ connection.deploymentRef }}
                    </template>
                    <template v-if="!connection.targetKey && connection.kind !== 'external-http'"> · unresolved</template>
                  </small>
                </span>
              </button>
              <p v-if="!outgoingConnections.length">No script connections detected.</p>
            </section>
            <section>
              <h3>Called or used by</h3>
              <button
                v-for="node in dependents"
                :key="node.key"
                @click="selectNode(node.key)"
              >
                <i class="pi pi-exclamation-circle"></i>
                <span><strong>{{ node.name }}</strong><small>{{ node.scriptId }}</small></span>
              </button>
              <p v-if="!dependents.length">No other scanned scripts depend on this file.</p>
            </section>
            <section>
              <h3>Record usage</h3>
              <div
                v-for="usage in selected.recordUsage ?? []"
                :key="`${usage.operation}:${usage.recordType}`"
                class="record-usage"
                :class="{ active: selectedEvidence?.evidence === usage.evidence }"
                @click="showEvidence(`${usage.operation} ${usage.recordType}`, usage)"
              >
                <Tag
                  :value="usage.operation"
                  :severity="
                    usage.operation === 'load' || usage.operation === 'copy' || usage.operation === 'lookup' || usage.operation === 'search' || usage.operation === 'suiteql'
                      ? 'info'
                      : usage.operation === 'delete'
                        ? 'danger'
                        : 'warn'
                  "
                />
                <code>{{ usage.recordType }}</code>
              </div>
              <p v-if="!(selected.recordUsage ?? []).length">No static record operations detected.</p>
            </section>
            <section>
              <h3>Unresolved modules</h3>
              <code v-for="item in selected.unresolvedDependencies" :key="item">{{ item }}</code>
              <p v-if="!selected.unresolvedDependencies.length">All local modules resolved.</p>
            </section>
          </div>
              </div>
            </template>

            <template #right-pane>
              <aside v-if="selectedEvidence" class="source-evidence">
                <header>
                  <span>
                    <strong>{{ selectedEvidence.title }}</strong>
                    <small>
                      {{ evidenceNode?.fileName || evidenceNode?.name }}
                      <template v-if="selectedEvidence.line">
                        · Line {{ selectedEvidence.line }}
                      </template>
                    </small>
                  </span>
                  <button title="Collapse source inspector" @click="selectedEvidence = null">
                    <i class="pi pi-angle-right"></i>
                  </button>
                </header>
                <div class="source-editor">
                  <MonacoCodeEditor
                    :key="selectedEvidence.sourceKey"
                    :model-value="evidenceNode?.source || selectedEvidence.evidence"
                    language="javascript"
                    readonly
                    :highlight-range="evidenceHighlight"
                    :options="{
                      fontSize: 12,
                      minimap: { enabled: false },
                      lineNumbersMinChars: 3,
                      folding: true,
                      renderLineHighlight: 'none',
                      wordWrap: 'off'
                    }"
                    :config="{
                      autoSizing: true,
                      minimap: false,
                      validateTags: false,
                      formatOnMount: false
                    }"
                  />
                </div>
              </aside>
            </template>
          </VueSplitter>

        </template>
        </main>
      </template>
    </VueSplitter>
  </section>
</template>

<style scoped>
.dependency-explorer {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 0.3rem;
  overflow: hidden;
  color: #1f2937;
}
.explorer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.32rem 0.55rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: linear-gradient(120deg, #f8fafc, #eef2ff, #f0fdf4);
}
.eyebrow { color: #596985; font-size: .5rem; font-weight: 800; letter-spacing: .08em; }
.explorer-header h1 { margin: .02rem 0 0; font-size: .98rem; line-height: 1.1; }
.explorer-header p { display: none; }
.scan-actions { display: flex; align-items: center; gap: .7rem; }
.scan-actions > span { color: var(--p-slate-500); font-size: .65rem; }
.explorer-header :deep(.p-button) {
  min-height: 1.9rem;
  padding: .28rem .6rem;
  font-size: .72rem;
}
.explorer-layout {
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 11px;
  background: rgb(255 255 255 / 92%);
}
.explorer-layout :deep(> .splitter-pane),
.impact-content-splitter :deep(> .splitter-pane) {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.explorer-layout :deep(> .splitter-pane > *),
.impact-content-splitter :deep(> .splitter-pane > *) {
  width: 100%;
  height: 100%;
  min-height: 0;
}
.explorer-layout :deep(> .splitter),
.impact-content-splitter :deep(> .splitter) {
  position: relative;
  z-index: 6;
  width: 7px;
  border-inline: 2px solid white;
  background: #cbd5e1;
  transition: background-color .15s ease;
}
.explorer-layout :deep(> .splitter:hover),
.explorer-layout :deep(> .splitter.active),
.impact-content-splitter :deep(> .splitter:hover),
.impact-content-splitter :deep(> .splitter.active) {
  background: #7c6ee6;
}
.script-index { display: flex; width: 100%; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; border-right: 1px solid var(--p-slate-200); }
.script-search { position: relative; z-index: 2; display: block; flex: 0 0 auto; padding: .5rem; border-bottom: 1px solid #edf1f5; background: white; }
.script-search i { position: absolute; z-index: 1; top: 50%; left: 1.25rem; transform: translateY(-50%); color: var(--p-slate-400); }
.script-search > button {
  position: absolute;
  z-index: 2;
  top: 50%;
  right: .85rem;
  display: grid;
  width: 1.35rem;
  height: 1.35rem;
  place-items: center;
  padding: 0;
  transform: translateY(-50%);
  border: 0;
  border-radius: 999px;
  background: #eef2f7;
  color: #64748b;
  cursor: pointer;
}
.script-search > button:hover { background: #e2e8f0; color: #334155; }
.script-search > button i {
  position: static;
  transform: none;
  color: inherit;
  font-size: .65rem;
}
.script-index :deep(input) { width: 100%; padding-left: 2rem; padding-right: 2.1rem; }
.script-list { min-height: 0; flex: 1; overflow-y: auto; }
.script-list > button {
  display: flex; width: 100%; align-items: center; justify-content: space-between; gap: .5rem;
  padding: .65rem .75rem; border: 0; border-top: 1px solid #edf1f5; background: transparent;
  color: inherit; text-align: left; cursor: pointer;
}
.script-list > button:hover, .script-list > button.active { background: #f3f5fb; }
.script-list > button.active { box-shadow: inset 3px 0 #6558d5; }
.script-list button > span:first-child { display: flex; min-width: 0; flex-direction: column; gap: .18rem; }
.script-index strong {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: .72rem;
  line-height: 1.25;
}
.script-index small {
  min-width: 0;
  color: var(--p-slate-500);
  font-size: .61rem;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.node-badges { display: flex; flex: 0 0 auto; align-items: center; gap: .35rem; }
.node-badges b { display: grid; min-width: 1.4rem; height: 1.4rem; place-items: center; border-radius: 999px; background: #e8e7ff; color: #5548c7; font-size: .65rem; }
.impact-workspace { display: flex; width: 100%; height: 100%; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; }
.impact-content-splitter { width: 100%; height: 100%; min-height: 0; }
.impact-content-splitter.no-source {
  grid-template-columns: minmax(0, 1fr) 0 0 !important;
}
.impact-content-splitter.no-source :deep(> .splitter),
.impact-content-splitter.no-source :deep(> .splitter-pane:last-child) {
  display: none;
}
.impact-primary {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}
.impact-heading { display: flex; align-items: center; justify-content: space-between; gap: .55rem; padding: .34rem .55rem; border-bottom: 1px solid var(--p-slate-200); }
.impact-heading span { color: #6558d5; font-size: .54rem; font-weight: 800; text-transform: uppercase; }
.impact-heading h2 { margin: .04rem 0; font-size: .82rem; line-height: 1.15; }
.impact-heading code { color: var(--p-slate-500); font-size: .58rem; }
.impact-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .32rem; padding: .3rem .45rem; border-bottom: 1px solid var(--p-slate-200); }
.impact-stats article { display: grid; gap: 0; padding: .25rem .4rem; border: 1px solid #e4e9f1; border-radius: 6px; background: #fafbfd; }
.impact-stats span { color: var(--p-slate-500); font-size: .49rem; text-transform: uppercase; }
.impact-stats strong { font-size: .78rem; }
.impact-stats article.danger { border-color: #fecaca; background: #fff5f5; color: #b91c1c; }
.graph-history {
  display: flex;
  min-height: 28px;
  flex: 0 0 auto;
  align-items: center;
  gap: .28rem;
  padding: .18rem .38rem;
  overflow: hidden;
  border-bottom: 1px solid var(--p-slate-200);
  background: #fbfcfe;
}
.graph-history > button {
  display: grid;
  width: 1.38rem;
  height: 1.38rem;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid #dce3ec;
  border-radius: 6px;
  background: white;
  color: #53627a;
  cursor: pointer;
}
.graph-history > button:disabled { opacity: .35; cursor: default; }
.history-trail {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: .18rem;
  overflow-x: auto;
  scrollbar-width: thin;
}
.history-trail > i { flex: 0 0 auto; color: #a6b1c2; font-size: .65rem; }
.history-trail > button {
  max-width: 190px;
  flex: 0 0 auto;
  overflow: hidden;
  padding: .22rem .42rem;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  font: .61rem "JetBrains Mono", monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.history-trail > button:hover { background: #eef2f7; color: #334155; }
.history-trail > button.current {
  border-color: #c4b5fd;
  background: #ede9fe;
  color: #5548c7;
  font-weight: 800;
}
.graph-stage {
  min-height: 300px;
  flex: 1;
  overflow: hidden;
}
.graph-shell { width: 100%; height: 100%; min-width: 0; min-height: 300px; background: #f8fafc; }
.graph-shell :deep(.vue-flow__node) {
  height: auto;
  min-height: 42px;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: center;
}
.relationship-lists { display: grid; max-height: 210px; grid-template-columns: repeat(4, minmax(0, 1fr)); overflow: hidden; border-top: 1px solid var(--p-slate-200); }
.relationship-lists section { min-width: 0; overflow-y: auto; padding: 0 .65rem .65rem; border-right: 1px solid var(--p-slate-200); }
.relationship-lists h3 {
  position: sticky;
  z-index: 2;
  top: 0;
  margin: 0 0 .45rem;
  padding: .65rem 0 .45rem;
  border-bottom: 1px solid #edf1f5;
  background: white;
  font-size: .7rem;
}
.relationship-lists button { display: flex; width: 100%; align-items: center; gap: .45rem; padding: .4rem; border: 0; border-radius: 5px; background: transparent; text-align: left; cursor: pointer; }
.relationship-lists button:hover { background: #f1f5f9; }
.relationship-lists button.unresolved { color: #a16207; cursor: default; }
.relationship-lists button span { display: flex; min-width: 0; flex-direction: column; }
.relationship-lists button strong { overflow: hidden; font-size: .65rem; text-overflow: ellipsis; white-space: nowrap; }
.relationship-lists button small, .relationship-lists p { color: var(--p-slate-500); font-size: .6rem; }
.relationship-lists section > code { display: block; margin-bottom: .3rem; padding: .3rem; border-radius: 4px; background: #f1f5f9; font-size: .61rem; }
.record-usage { display: flex; align-items: center; gap: .4rem; margin-bottom: .35rem; padding: .28rem; border: 1px solid transparent; border-radius: 5px; cursor: pointer; }
.record-usage:hover, .record-usage.active { border-color: #93c5fd; background: #eff6ff; }
.record-usage code { overflow: hidden; font-size: .62rem; text-overflow: ellipsis; white-space: nowrap; }
.source-evidence {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid #93c5fd;
  background: #2e3440;
}
.source-evidence header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: .42rem .65rem;
  border-bottom: 1px solid #465166;
  background: #222936;
  color: #e2e8f0;
}
.source-evidence header span { display: flex; min-width: 0; flex-direction: column; gap: .12rem; }
.source-evidence header strong { font-size: .67rem; }
.source-evidence header small { overflow: hidden; color: #94a3b8; font-size: .58rem; text-overflow: ellipsis; white-space: nowrap; }
.source-evidence header button { border: 0; background: transparent; color: #94a3b8; cursor: pointer; }
.source-editor {
  position: relative;
  width: 100%;
  min-height: 0;
  flex: 1 1 0;
  overflow: hidden;
}
.source-editor :deep(.monaco-editor-container),
.source-editor :deep(.monaco-editor-container.full-height) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100% !important;
}
.empty { display: flex; min-height: 0; flex: 1; align-items: center; justify-content: center; flex-direction: column; gap: .45rem; padding: 1rem; color: var(--p-slate-500); text-align: center; }
.empty > i { font-size: 1.7rem; color: var(--p-slate-400); }
.empty span { font-size: .65rem; }
@media (max-width: 950px) {
  .impact-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
