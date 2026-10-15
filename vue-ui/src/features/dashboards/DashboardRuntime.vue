<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import { useToast } from "primevue/usetoast";
import DashboardNode from "./DashboardNode.vue";
import {
  applyStatePatch,
  dashboardCommand,
  readPath,
  resolveBindings,
  validateActionInput,
  type Dashboard,
} from "./api";
const props = withDefaults(
  defineProps<{ dashboard: Dashboard; active?: boolean; preview?: boolean }>(),
  { active: true, preview: false },
);
const toast = useToast();
const root = ref<HTMLElement>();
const state = reactive<Record<string, unknown>>({});
const results = reactive<Record<string, unknown>>({});
const errors = reactive<Record<string, string>>({});
const busy = reactive<Record<string, boolean>>({});
const startedRevision = ref(props.dashboard.revision);
const pending = ref<{ id: string; input: any; revision: number } | null>(null);
const feedback = ref("");
const visible = ref(!document.hidden);
const scope = computed(() => ({ state, results, errors, busy }));
const hasBusy = computed(() => Object.values(busy).some(Boolean));
const stale = computed(
  () => startedRevision.value !== props.dashboard.revision,
);
const automatic = computed(
  () => props.active && visible.value && !props.preview && !stale.value,
);
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
let loadStarted = false;
const clearTimer = () => {
  if (timer) clearTimeout(timer);
  timer = undefined;
};
const patchState = (patch: Record<string, unknown>) => {
  const next = JSON.parse(JSON.stringify(state));
  applyStatePatch(next, patch);
  validateActionInput(props.dashboard.stateSchema, next, "state");
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, next);
};
const patchFromNode = (patch: Record<string, unknown>) => {
  try {
    patchState(patch);
  } catch (e) {
    errors.state = e instanceof Error ? e.message : String(e);
  }
};
const reset = () => {
  for (const obj of [state, results, errors, busy])
    for (const key of Object.keys(obj)) delete obj[key];
  Object.assign(
    state,
    JSON.parse(JSON.stringify(props.dashboard.initialState)),
  );
  startedRevision.value = props.dashboard.revision;
  pending.value = null;
};
watch(
  () => props.dashboard.revision,
  (revision, old) => {
    if (old === undefined) {
      reset();
      return;
    }
    if (hasBusy.value) return;
    for (const [key, value] of Object.entries(props.dashboard.initialState))
      if (!(key in state)) state[key] = JSON.parse(JSON.stringify(value));
    for (const key of Object.keys(results)) delete results[key];
    startedRevision.value = revision;
    pending.value = null;
  },
  { immediate: true },
);
const interpolate = (text: string, input: any, result?: any) =>
  text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) =>
    String(readPath({ input, result, state }, path) ?? ""),
  );
const perform = async (
  id: string,
  input: any,
  revision: number,
  quiet = false,
) => {
  if (hasBusy.value || disposed) return;
  busy[id] = true;
  delete errors[id];
  clearTimer();
  try {
    const response = await dashboardCommand("run", {
      dashboardId: props.dashboard.id,
      actionId: id,
      input,
      expectedRevision: revision,
    });
    if (!disposed && props.dashboard.revision === revision) {
      if (response.setState && Object.keys(response.setState).length)
        patchState(response.setState);
      results[id] = response;
      if (!quiet) {
        const action = props.dashboard.actions.find((a) => a.id === id);
        feedback.value = interpolate(
          action?.successMessage || `${action?.title || id} completed.`,
          input,
          response.result,
        );
        toast.add({
          severity: "success",
          summary: action?.title || id,
          detail: feedback.value,
          life: 3500,
        });
      }
    }
  } catch (e) {
    if (!disposed) {
      errors[id] = e instanceof Error ? e.message : String(e);
      if (!quiet)
        toast.add({
          severity: "error",
          summary: "Action failed",
          detail: errors[id],
          life: 6000,
        });
    }
  } finally {
    busy[id] = false;
    scheduleRefresh();
  }
};
const requestRun = (id: string, override?: any) => {
  if (hasBusy.value || stale.value || props.preview) return;
  const action = props.dashboard.actions.find((a) => a.id === id);
  if (!action) {
    errors[id] = "Action was not found in this dashboard.";
    return;
  }
  const input = resolveBindings(
    override === undefined ? (action.input ?? {}) : override,
    scope.value,
  );
  try {
    validateActionInput(action.inputSchema, input);
  } catch (e) {
    errors[id] = e instanceof Error ? e.message : String(e);
    return;
  }
  if (action.risk === "write")
    pending.value = { id, input, revision: props.dashboard.revision };
  else void perform(id, input, props.dashboard.revision);
};
const confirmation = computed(() => {
  const action = props.dashboard.actions.find(
    (a) => a.id === pending.value?.id,
  );
  return interpolate(
    action?.confirmation || `Run ${action?.title || "this action"}?`,
    pending.value?.input,
  );
});
const confirmRun = () => {
  const action = pending.value;
  pending.value = null;
  if (action) void perform(action.id, action.input, action.revision);
};
function scheduleRefresh() {
  clearTimer();
  const refresh = props.dashboard.refresh;
  if (!automatic.value || hasBusy.value || pending.value || !refresh) return;
  timer = setTimeout(() => {
    if (!automatic.value) return;
    const action = props.dashboard.actions.find(
      (a) => a.id === refresh.actionId,
    );
    if (action?.risk === "read")
      void perform(
        action.id,
        resolveBindings(action.input ?? {}, scope.value),
        props.dashboard.revision,
        true,
      );
  }, refresh.everyMs);
}
async function startAutomatic() {
  if (automatic.value && !loadStarted) {
    loadStarted = true;
    for (const id of props.dashboard.onLoad || []) {
      if (!automatic.value || hasBusy.value) break;
      const action = props.dashboard.actions.find((a) => a.id === id);
      if (action?.risk === "read")
        await perform(
          id,
          resolveBindings(action.input ?? {}, scope.value),
          props.dashboard.revision,
          true,
        );
    }
  }
  scheduleRefresh();
}
watch(
  [automatic, () => props.dashboard.refresh, () => Boolean(pending.value)],
  () => {
    void startAutomatic();
  },
  { flush: "post" },
);
const visibility = () => {
  visible.value = !document.hidden;
};
const renderListener = (
  message: any,
  _sender: any,
  respond: (value: any) => void,
) => {
  if (
    message.type !== "DASHBOARD_RENDER_VIEW" ||
    message.dashboardId !== props.dashboard.id ||
    !props.active ||
    !root.value
  )
    return;
  respond({
    id: props.dashboard.id,
    revision: props.dashboard.revision,
    source: props.preview ? "preview-view" : "live-view",
    text: root.value.innerText.slice(0, 60000),
    truncated: root.value.innerText.length > 60000,
    mode: props.dashboard.mode,
    account: props.dashboard.account || null,
    busy: hasBusy.value,
  });
};
onMounted(() => {
  document.addEventListener("visibilitychange", visibility);
  globalThis.chrome?.runtime?.onMessage?.addListener(renderListener);
  void startAutomatic();
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimer();
  document.removeEventListener("visibilitychange", visibility);
  globalThis.chrome?.runtime?.onMessage?.removeListener(renderListener);
});
</script>
<template>
  <section ref="root" class="dashboard-runtime">
    <div v-if="preview" class="runtime-notice">
      Render preview · initial state · actions paused
    </div>
    <div v-if="stale" class="runtime-notice" role="status">
      This dashboard changed during execution. Reload its state to run the
      latest actions.
      <Button
        label="Reload state"
        size="small"
        :disabled="hasBusy"
        @click="reset"
      />
    </div>
    <div
      v-for="(error, id) in errors"
      :key="id"
      class="runtime-error"
      role="alert"
    >
      <i class="pi pi-exclamation-circle" /><strong>{{
        dashboard.actions.find((a) => a.id === id)?.title || id
      }}</strong
      ><span>{{ error }}</span>
    </div>
    <div v-if="hasBusy" class="runtime-notice" role="status">
      <i class="pi pi-spin pi-spinner" />Running action…
    </div>
    <div v-else-if="feedback" class="runtime-feedback" role="status">
      {{ feedback }}
    </div>
    <DashboardNode
      v-for="node in dashboard.layout"
      :key="node.id"
      :node="node"
      :definition="dashboard"
      :scope="scope"
      :busy="busy"
      @change="(path, value) => patchFromNode({ [path]: value })"
      @patch="patchFromNode"
      @run="requestRun"
    />
    <div v-if="!dashboard.layout.length" class="runtime-empty">
      Your canvas is ready. Use Edit dashboard or ask Claude to add components
      and actions.
    </div>
    <Dialog
      :visible="Boolean(pending)"
      modal
      :header="confirmation"
      :style="{ width: 'min(520px,90vw)' }"
      @update:visible="
        (v) => {
          if (!v) pending = null;
        }
      "
    >
      <p>
        Account: {{ dashboard.account || "currently routed NetSuite account" }}
      </p>
      <details>
        <summary>Action input</summary>
        <pre>{{ JSON.stringify(pending?.input, null, 2) }}</pre>
      </details>
      <p
        v-if="
          (dashboard.actions.find((a) => a.id === pending?.id)?.steps.length ||
            0) > 1
        "
      >
        Steps run in order. If a later step fails, earlier changes remain.
      </p>
      <template #footer
        ><Button
          label="Cancel"
          severity="secondary"
          @click="pending = null" /><Button
          label="Run action"
          @click="confirmRun"
      /></template>
    </Dialog>
  </section>
</template>
<style scoped>
.dashboard-runtime {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  container-type: inline-size;
}
.runtime-notice,
.runtime-error {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem;
  border-radius: 8px;
  font-size: 0.78rem;
  background: var(--p-content-hover-background);
}
.runtime-feedback {
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
}
.runtime-error {
  color: var(--p-red-400);
  border: 1px solid var(--p-red-400);
  flex-wrap: wrap;
}
.runtime-error span {
  flex-basis: 100%;
  white-space: pre-wrap;
}
.runtime-empty {
  padding: 4rem 1rem;
  text-align: center;
  color: var(--p-text-muted-color);
}
pre {
  white-space: pre-wrap;
  max-height: 220px;
  overflow: auto;
}
p {
  line-height: 1.6;
}
</style>
