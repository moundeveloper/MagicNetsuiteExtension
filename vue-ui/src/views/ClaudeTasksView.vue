<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import MSelect from "../components/universal/input/MSelect.vue";
import MessageContentRenderer from "../components/MessageContentRenderer.vue";

defineProps<{ vhOffset: number }>();

type CliEvent = Record<string, any>;
type ClaudeRun = {
  runId: string;
  prompt: string;
  cwd?: string;
  model?: string;
  permissionMode?: string;
  maxTurns?: number;
  status: string;
  startedAt?: string;
  finishedAt?: string;
  liveText?: string;
  result?: string;
  error?: string;
  sessionId?: string;
  costUsd?: number;
  durationMs?: number;
  turns?: number;
  events?: CliEvent[];
};

const prompt = ref("");
const cwd = ref("");
const model = ref("default");
const permissionMode = ref("plan");
const maxTurns = ref("12");
const runs = ref<ClaudeRun[]>([]);
const selectedRunId = ref("");
const busy = ref(false);
const error = ref("");
const nativeConnected = ref(false);
const activityEl = ref<HTMLElement | null>(null);

const modelOptions = [
  { label: "Subscription default", value: "default" },
  { label: "Sonnet", value: "sonnet" },
  { label: "Opus", value: "opus" },
  { label: "Haiku", value: "haiku" }
];
const permissionOptions = [
  { label: "Plan only", value: "plan" },
  { label: "Ask normally", value: "default" },
  { label: "Accept edits", value: "acceptEdits" },
  { label: "Don't ask", value: "dontAsk" }
];

const selectedRun = computed(() => runs.value.find((run) => run.runId === selectedRunId.value) || runs.value[0]);
const isRunning = computed(() => ["starting", "running"].includes(selectedRun.value?.status || ""));
const renderedOutput = computed(() => selectedRun.value?.liveText || selectedRun.value?.result || "");
const visibleEvents = computed(() => (selectedRun.value?.events || []).filter((event) => event.type !== "process_started"));

async function send<T = any>(message: Record<string, unknown>): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

async function refresh(selectNewest = false) {
  error.value = "";
  const response = await send<any>({ type: "CLAUDE_CLI_GET_STATE" });
  if (!response?.ok) throw new Error(response?.error || "Could not load Claude CLI runs.");
  runs.value = response.runs || [];
  nativeConnected.value = Boolean(response.nativeConnected);
  if (selectNewest || !runs.value.some((run) => run.runId === selectedRunId.value)) {
    selectedRunId.value = runs.value[0]?.runId || "";
  }
}

async function startRun() {
  if (!prompt.value.trim()) {
    error.value = "Enter a task for Claude.";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    const response = await send<any>({
      type: "CLAUDE_CLI_START",
      prompt: prompt.value,
      cwd: cwd.value.trim(),
      model: model.value,
      permissionMode: permissionMode.value,
      maxTurns: Number(maxTurns.value) || 12
    });
    if (!response?.ok) throw new Error(response?.error || "Claude CLI failed to start.");
    selectedRunId.value = response.runId;
    await refresh();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    busy.value = false;
  }
}

async function cancelRun() {
  if (!selectedRun.value) return;
  const response = await send<any>({ type: "CLAUDE_CLI_CANCEL", runId: selectedRun.value.runId });
  if (!response?.ok) error.value = response?.error || "Could not cancel the run.";
}

async function clearRun() {
  if (!selectedRun.value || isRunning.value) return;
  const response = await send<any>({ type: "CLAUDE_CLI_CLEAR", runId: selectedRun.value.runId });
  if (!response?.ok) error.value = response?.error || "Could not clear the run.";
  await refresh(true);
}

function textDelta(event: CliEvent) {
  return event?.type === "stream_event"
    && event.event?.type === "content_block_delta"
    && event.event?.delta?.type === "text_delta"
    ? String(event.event.delta.text || "")
    : "";
}

function onRuntimeMessage(message: any) {
  if (message?.type !== "CLAUDE_CLI_EVENT") return;
  const run = runs.value.find((item) => item.runId === message.runId);
  if (!run) {
    refresh().catch(() => {});
    return;
  }
  const event = message.event || {};
  const delta = textDelta(event);
  if (delta) run.liveText = `${run.liveText || ""}${delta}`;
  else if (event.type !== "stream_event") run.events = [...(run.events || []), event].slice(-300);

  if (event.type === "process_started") run.status = "running";
  if (event.type === "system" && event.subtype === "init") run.sessionId = event.session_id;
  if (event.type === "result") {
    run.result = event.result;
    run.costUsd = event.total_cost_usd;
    run.durationMs = event.duration_ms;
    run.turns = event.num_turns;
    run.status = event.is_error ? "failed" : "completed";
  }
  if (event.type === "process_error") {
    run.error = event.message;
    run.status = "failed";
  }
  if (event.type === "process_exit") {
    run.status = event.cancelled ? "cancelled" : event.exitCode === 0 ? "completed" : "failed";
    run.finishedAt = event.finishedAt;
  }
  nextTick(() => activityEl.value?.scrollTo({ top: activityEl.value.scrollHeight, behavior: "smooth" }));
}

function eventTitle(event: CliEvent) {
  if (event.type === "assistant") return "Assistant message";
  if (event.type === "user") return "Tool result / user event";
  if (event.type === "system") return event.subtype ? `System · ${event.subtype}` : "System";
  if (event.type === "result") return event.is_error ? "Run failed" : "Run result";
  if (event.type === "stderr") return "CLI error output";
  if (event.type === "process_error") return "Process error";
  if (event.type === "process_exit") return `Process exited · ${event.exitCode ?? "unknown"}`;
  return String(event.type || "Event").replace(/_/g, " ");
}

function eventSummary(event: CliEvent) {
  if (typeof event.message === "string") return event.message;
  if (event.result) return String(event.result);
  const blocks = event.message?.content || event.content;
  if (Array.isArray(blocks)) {
    return blocks.map((block: any) => block.text || block.name || block.type).filter(Boolean).join(" · ");
  }
  return "";
}

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "—";
}

onMounted(() => {
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  refresh(true).catch((cause) => { error.value = cause.message || String(cause); });
});
onUnmounted(() => chrome.runtime.onMessage.removeListener(onRuntimeMessage));
</script>

<template>
  <main class="claude-tasks" :style="{ height: `calc(100vh - ${vhOffset}px)` }">
    <header class="view-toolbar">
      <div>
        <h1><i class="pi pi-terminal" /> Claude CLI</h1>
        <p>Run the installed <code>claude -p</code> command with your existing Claude subscription.</p>
      </div>
      <div class="toolbar-actions">
        <span class="connection" :class="{ connected: nativeConnected }"><i class="pi pi-circle-fill" /> {{ nativeConnected ? "Native host ready" : "Native host offline" }}</span>
        <button class="icon-button" title="Refresh runs" @click="refresh()"><i class="pi pi-refresh" /></button>
      </div>
    </header>

    <section class="workspace">
      <aside class="composer panel">
        <div class="panel-heading"><span>New task</span><span class="safe-label">CLI subscription</span></div>
        <label class="field grow"><span>Task</span><Textarea v-model="prompt" auto-resize placeholder="Ask Claude to inspect, explain, or change the current project…" /></label>
        <label class="field"><span>Working directory</span><InputText v-model="cwd" placeholder="Blank uses the native host directory" /></label>
        <div class="field-row">
          <label class="field"><span>Model</span><MSelect v-model="model" :options="modelOptions" option-label="label" option-value="value" size="small" /></label>
          <label class="field"><span>Permissions</span><MSelect v-model="permissionMode" :options="permissionOptions" option-label="label" option-value="value" size="small" /></label>
        </div>
        <label class="field turns"><span>Maximum turns</span><InputText v-model="maxTurns" type="number" min="1" max="100" /></label>
        <p class="hint"><i class="pi pi-shield" /> No Claude SDK or API key is used. Plan mode is the safe default; broader modes can edit files.</p>
        <p v-if="error" class="error"><i class="pi pi-exclamation-triangle" /> {{ error }}</p>
        <button class="primary-button" :disabled="busy || !prompt.trim()" @click="startRun"><i :class="busy ? 'pi pi-spin pi-spinner' : 'pi pi-play'" /> {{ busy ? "Starting…" : "Run with Claude" }}</button>

        <div class="history-heading"><span>Runs</span><span>{{ runs.length }}</span></div>
        <div class="run-list">
          <button v-for="run in runs" :key="run.runId" class="run-item" :class="{ selected: run.runId === selectedRun?.runId }" @click="selectedRunId = run.runId">
            <span class="run-prompt">{{ run.prompt }}</span>
            <span class="run-meta"><span class="status" :class="run.status">{{ run.status }}</span>{{ formatTime(run.startedAt) }}</span>
          </button>
          <div v-if="!runs.length" class="empty-small">No CLI runs yet.</div>
        </div>
      </aside>

      <section class="output panel">
        <div class="panel-heading output-heading">
          <div><span>Rendered output</span><small v-if="selectedRun">{{ selectedRun.model }} · {{ selectedRun.permissionMode }}</small></div>
          <div v-if="selectedRun" class="run-actions">
            <button v-if="isRunning" class="danger-button" @click="cancelRun"><i class="pi pi-stop" /> Cancel</button>
            <button v-else class="icon-button" title="Clear this run" @click="clearRun"><i class="pi pi-trash" /></button>
          </div>
        </div>
        <div class="rendered">
          <MessageContentRenderer v-if="renderedOutput" :content="renderedOutput" />
          <div v-else class="empty-state"><i class="pi pi-sparkles" /><strong>{{ selectedRun ? "Waiting for output" : "Run a task to begin" }}</strong><span>Streaming text and tool activity will appear here.</span></div>
        </div>
        <footer v-if="selectedRun" class="run-stats">
          <span>Started {{ formatTime(selectedRun.startedAt) }}</span><span v-if="selectedRun.turns != null">{{ selectedRun.turns }} turns</span><span v-if="selectedRun.durationMs != null">{{ (selectedRun.durationMs / 1000).toFixed(1) }}s</span><span v-if="selectedRun.costUsd != null">CLI reported ${{ selectedRun.costUsd.toFixed(4) }}</span><span v-if="selectedRun.sessionId">Session {{ selectedRun.sessionId.slice(0, 8) }}</span>
        </footer>
      </section>

      <aside class="activity panel">
        <div class="panel-heading"><span>Activity</span><span>{{ visibleEvents.length }}</span></div>
        <div ref="activityEl" class="event-list">
          <details v-for="(event, index) in visibleEvents" :key="index" class="event" :open="event.type === 'process_error' || event.type === 'stderr'">
            <summary><i class="pi pi-angle-right" /><span>{{ eventTitle(event) }}</span><small>{{ event.subtype || "" }}</small></summary>
            <p v-if="eventSummary(event)">{{ eventSummary(event) }}</p>
            <pre>{{ JSON.stringify(event, null, 2) }}</pre>
          </details>
          <div v-if="!visibleEvents.length" class="empty-small">Observable CLI and tool events appear here.</div>
        </div>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.claude-tasks { display: flex; flex-direction: column; min-height: 560px; color: var(--text-color, #e8e6ef); background: #111015; overflow: hidden; }
.view-toolbar { min-height: 58px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #302d38; background: #18161d; }
h1 { margin: 0; font-size: 15px; font-weight: 650; display: flex; gap: 8px; align-items: center; } h1 i { color: #b9afff; }
.view-toolbar p { margin: 3px 0 0; color: #9893a3; font-size: 11px; } code { color: #c9c1ff; }
.toolbar-actions, .run-actions { display: flex; align-items: center; gap: 8px; }
.connection { color: #8e8997; font-size: 10px; } .connection i { font-size: 6px; margin-right: 5px; color: #6f6879; } .connection.connected i { color: #8ec9a8; }
.workspace { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(230px, 290px) minmax(340px, 1fr) minmax(220px, 310px); gap: 1px; background: #302d38; }
.panel { min-width: 0; min-height: 0; background: #17151b; display: flex; flex-direction: column; }
.panel-heading { min-height: 38px; padding: 0 11px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #302d38; text-transform: uppercase; letter-spacing: .06em; font-size: 10px; font-weight: 700; color: #b6b0bf; }
.panel-heading small { display: block; text-transform: none; letter-spacing: 0; color: #77717f; font-weight: 400; margin-top: 2px; }
.safe-label { color: #aca2ee; font-size: 9px; }
.composer { padding-bottom: 10px; }
.field { padding: 9px 10px 0; display: flex; flex-direction: column; gap: 5px; min-width: 0; } .field > span { color: #9c96a5; font-size: 10px; }
.field.grow textarea { min-height: 105px; resize: vertical; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; } .turns { width: 120px; }
:deep(.p-inputtext), :deep(.p-textarea), :deep(.m-select) { width: 100%; border-color: #3a3642; background: #201e25; color: #ece9f2; font-size: 11px; border-radius: 4px; }
.hint, .error { margin: 9px 10px 0; font-size: 10px; line-height: 1.4; color: #898391; } .hint i { color: #a99fe9; } .error { color: #e69a9a; }
button { font: inherit; }
.primary-button, .danger-button, .icon-button { border: 1px solid #464050; border-radius: 4px; color: #e9e5ef; background: #25222b; cursor: pointer; }
.primary-button { margin: 10px 10px 0; padding: 8px 11px; border-color: #7066a3; background: #5d557f; font-size: 11px; font-weight: 650; } .primary-button:hover { background: #69608e; } button:disabled { opacity: .45; cursor: default; }
.icon-button { width: 28px; height: 28px; padding: 0; } .icon-button:hover { border-color: #756d82; background: #302c37; }
.danger-button { padding: 5px 8px; color: #efb1b1; font-size: 10px; }
.history-heading { margin-top: 12px; padding: 8px 10px 5px; display: flex; justify-content: space-between; color: #77717f; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; }
.run-list, .event-list { min-height: 0; overflow: auto; }
.run-list { border-top: 1px solid #292630; }
.run-item { width: 100%; padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; text-align: left; color: #d6d1db; background: transparent; border: 0; border-bottom: 1px solid #292630; cursor: pointer; }
.run-item:hover { background: #201e25; } .run-item.selected { background: #292535; box-shadow: inset 2px 0 #a99fe9; }
.run-prompt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.run-meta { display: flex; align-items: center; gap: 6px; color: #716b78; font-size: 9px; }
.status { padding: 1px 5px; border-radius: 8px; background: #383440; color: #aaa4b2; } .status.running, .status.starting { background: #3b3654; color: #c8c0ff; } .status.completed { background: #283a32; color: #9ed0b2; } .status.failed { background: #422d32; color: #e5a0aa; } .status.cancelled { color: #c5a978; }
.output-heading > div:first-child { min-width: 0; }
.rendered { flex: 1; min-height: 0; padding: 14px 16px; overflow: auto; background: #151319; }
.rendered :deep(*) { max-width: 100%; }
.empty-state { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; color: #77717f; font-size: 11px; } .empty-state i { color: #8d83c5; font-size: 22px; } .empty-state strong { color: #aaa4b2; }
.run-stats { min-height: 30px; padding: 0 10px; border-top: 1px solid #302d38; display: flex; align-items: center; gap: 12px; color: #77717f; font-size: 9px; overflow: auto; white-space: nowrap; }
.event-list { flex: 1; }
.event { border-bottom: 1px solid #292630; } .event summary { min-height: 35px; padding: 0 9px; display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; align-items: center; gap: 5px; cursor: pointer; color: #bbb5c3; font-size: 10px; list-style: none; } .event summary::-webkit-details-marker { display: none; } .event[open] summary i { transform: rotate(90deg); }
.event summary span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .event summary small { color: #746e7b; }
.event p { margin: 0; padding: 0 10px 7px 26px; color: #aaa4b2; font-size: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.event pre { margin: 0 8px 8px; padding: 8px; max-height: 240px; overflow: auto; border: 1px solid #312e38; border-radius: 3px; background: #111014; color: #aaa3b5; font: 9px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; }
.empty-small { padding: 14px 10px; text-align: center; color: #6f6976; font-size: 10px; }
@media (max-width: 920px) { .workspace { grid-template-columns: 250px minmax(320px, 1fr); } .activity { display: none; } }
@media (max-width: 640px) { .workspace { grid-template-columns: 1fr; overflow: auto; } .composer { min-height: 470px; } .output { min-height: 500px; } .view-toolbar p, .connection { display: none; } }
</style>
