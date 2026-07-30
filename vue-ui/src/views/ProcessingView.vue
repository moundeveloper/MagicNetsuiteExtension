<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import ExecutionStandby from "../components/execution/ExecutionStandby.vue";
import JobProgress from "../components/jobs/JobProgress.vue";
import JobStatusBadge from "../components/jobs/JobStatusBadge.vue";
import MLoader from "../components/universal/patterns/MLoader.vue";
import { useJobs } from "../composables/useJobs";
import { getNetsuiteEnvironment } from "../utils/api";
import { isTerminalJobStatus, type Job } from "../utils/jobsDb";

const TERMINAL_DISPLAY_MS = 8_000;
const { jobs, loading, error, activeJobs, refresh } = useJobs();
const now = ref(Date.now());
const environment = ref("unknown");
const environmentError = ref("");
let clockTimer: ReturnType<typeof setInterval> | null = null;

const focusedJob = computed(() => activeJobs.value[0] ?? null);
const queuedJobs = computed(() => activeJobs.value.slice(1));
const recentTerminalJob = computed(() => {
  const recent = jobs.value
    .filter(
      (job) =>
        isTerminalJobStatus(job.status) &&
        now.value - (job.finishedAt ?? job.updatedAt) < TERMINAL_DISPLAY_MS,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return recent[0] ?? null;
});

const displayJob = computed(() => focusedJob.value ?? recentTerminalJob.value);
const account = computed(() => {
  const current = displayJob.value;
  if (current?.account && current.account !== "unknown") return current.account;
  const hostname = environment.value.split(".")[0] ?? "";
  return hostname
    ? hostname.toUpperCase().replace(/-/g, "_")
    : "No account";
});
const environmentType = computed(() => {
  if (environment.value === "unknown") return "Disconnected";
  return /-sb\d+\.|_sb\d+/i.test(environment.value)
    ? "Sandbox"
    : "Production";
});
const connectionLabel = computed(() =>
  environmentError.value || environment.value === "unknown"
    ? "Connection unavailable"
    : "Worker connected",
);
const elapsed = computed(() => {
  const job = displayJob.value;
  if (!job) return "—";
  const start = job.startedAt ?? job.createdAt;
  const end = job.finishedAt ?? now.value;
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
});

const operationMessage = computed(() => {
  const job = displayJob.value;
  if (!job) return "";
  if (job.message) return job.message;
  const result =
    job.result && typeof job.result === "object"
      ? (job.result as Record<string, unknown>)
      : null;
  if (typeof result?.message === "string") return result.message;
  if (typeof result?.phase === "string") {
    return result.phase.replace(/-/g, " ");
  }
  if (job.status === "succeeded") return "Operation completed successfully";
  if (job.status === "failed") return job.error || "Operation failed";
  if (job.status === "cancelled") return "Operation cancelled";
  if (job.status === "cancel-requested") {
    return "Waiting for the producer to acknowledge cancellation";
  }
  if (job.status === "retry-requested") {
    return "Waiting for the producer to acknowledge retry";
  }
  return "Operation in progress";
});

const isIndeterminate = (job: Job) =>
  Boolean(job.indeterminate) ||
  (job.status === "running" && job.progress <= 0);

const refreshEnvironment = async () => {
  environmentError.value = "";
  try {
    environment.value = await getNetsuiteEnvironment();
    if (environment.value === "unknown") {
      environmentError.value = "No authenticated NetSuite worker was found.";
    }
  } catch (cause) {
    environment.value = "unknown";
    environmentError.value =
      cause instanceof Error ? cause.message : "Worker connection failed.";
  }
};

const openJobsCenter = () => {
  chrome.runtime
    .sendMessage({ type: "OPEN_VIEW", view: "Jobs Center" })
    .catch(() => undefined);
};

onMounted(() => {
  clockTimer = setInterval(() => {
    now.value = Date.now();
  }, 1_000);
  window.addEventListener(
    "magic-netsuite-environment-changed",
    refreshEnvironment,
  );
  void refreshEnvironment();
});

onBeforeUnmount(() => {
  if (clockTimer) clearInterval(clockTimer);
  window.removeEventListener(
    "magic-netsuite-environment-changed",
    refreshEnvironment,
  );
});
</script>

<template>
  <main class="execution-view">
    <header class="execution-header">
      <div class="execution-heading">
        <span class="execution-heading__icon">
          <i class="pi pi-bolt"></i>
        </span>
        <div>
          <h1>Execution Monitor</h1>
          <p>Authenticated NetSuite work handled by this reserved tab</p>
        </div>
      </div>
      <button type="button" class="jobs-link" @click="openJobsCenter">
        <i class="pi pi-list-check"></i>
        Open Jobs Center
      </button>
    </header>

    <section class="worker-strip" aria-label="Execution worker connection">
      <span class="worker-account" :title="environment">
        <i class="pi pi-building"></i>
        <span>
          <strong>{{ account }}</strong>
          <small>{{ environmentType }}</small>
        </span>
      </span>
      <span
        class="connection-state"
        :class="{ disconnected: environment === 'unknown' }"
        role="status"
      >
        <i
          class="pi"
          :class="
            environment === 'unknown'
              ? 'pi-exclamation-circle'
              : 'pi-check-circle'
          "
        ></i>
        {{ connectionLabel }}
      </span>
    </section>

    <section v-if="loading && jobs.length === 0" class="execution-state">
      <MLoader text="Loading execution state…" />
    </section>

    <section v-else-if="error" class="execution-state execution-error" role="alert">
      <i class="pi pi-exclamation-triangle"></i>
      <strong>Execution state is unavailable</strong>
      <p>{{ error }}</p>
      <button type="button" class="secondary-button" @click="refresh">
        Try again
      </button>
    </section>

    <template v-else-if="displayJob">
      <section
        class="active-operation"
        :class="`status-${displayJob.status}`"
        role="status"
        aria-live="polite"
      >
        <div class="operation-heading">
          <div>
            <span class="eyebrow">
              {{ focusedJob ? "Current operation" : "Recent operation" }}
            </span>
            <h2 :title="displayJob.title">{{ displayJob.title }}</h2>
          </div>
          <JobStatusBadge :status="displayJob.status" />
        </div>

        <JobProgress
          :progress="displayJob.progress"
          :indeterminate="isIndeterminate(displayJob)"
          :label="`${displayJob.title} progress`"
        />

        <dl class="operation-facts">
          <div>
            <dt>Elapsed</dt>
            <dd>{{ elapsed }}</dd>
          </div>
          <div>
            <dt>Progress</dt>
            <dd>
              {{
                isIndeterminate(displayJob)
                  ? "Working"
                  : `${displayJob.progress}%`
              }}
            </dd>
          </div>
          <div>
            <dt>Environment</dt>
            <dd :title="displayJob.environment">
              {{ displayJob.environment }}
            </dd>
          </div>
        </dl>

        <p
          class="operation-message"
          :class="{ 'operation-message--error': displayJob.status === 'failed' }"
        >
          <i
            class="pi"
            :class="
              displayJob.status === 'failed'
                ? 'pi-exclamation-circle'
                : 'pi-info-circle'
            "
          ></i>
          {{ operationMessage }}
        </p>
      </section>

      <section v-if="queuedJobs.length" class="operation-queue">
        <header>
          <strong>Queued operations</strong>
          <span>{{ queuedJobs.length }}</span>
        </header>
        <ul>
          <li v-for="job in queuedJobs" :key="job.id">
            <span class="queue-title" :title="job.title">{{ job.title }}</span>
            <JobStatusBadge :status="job.status" />
          </li>
        </ul>
      </section>
    </template>

    <ExecutionStandby v-else />
  </main>
</template>

<style scoped>
.execution-view {
  --ui-violet: #4f46e5;
  --ui-violet-border: #a5b4fc;
  --ui-violet-surface: #f1f4fe;
  --ui-violet-icon-surface: #e0e7ff;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.75rem;
  color: var(--p-slate-800, #1e293b);
  background: var(--p-slate-50, #f8fafc);
  box-sizing: border-box;
}

.execution-header,
.worker-strip,
.operation-heading,
.operation-queue header,
.operation-queue li {
  display: flex;
  align-items: center;
}

.execution-header {
  justify-content: space-between;
  gap: 1rem;
}

.execution-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.6rem;
}

.execution-heading__icon {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 0.375rem;
  color: var(--ui-violet);
  background: var(--ui-violet-icon-surface);
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  font-size: 1rem;
}

.execution-heading p {
  margin-top: 0.1rem;
  color: var(--p-slate-500, #64748b);
  font-size: 0.72rem;
}

.jobs-link,
.secondary-button {
  display: inline-flex;
  height: 1.9rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0 0.65rem;
  border: 1px solid var(--p-slate-300, #cbd5e1);
  border-radius: 0.3rem;
  color: var(--p-slate-700, #334155);
  background: #fff;
  font: inherit;
  font-size: 0.74rem;
  white-space: nowrap;
  cursor: pointer;
}

.jobs-link:hover,
.secondary-button:hover {
  border-color: var(--ui-violet-border);
  color: var(--ui-violet);
  background: var(--ui-violet-surface);
}

.jobs-link:focus-visible,
.secondary-button:focus-visible {
  outline: 2px solid var(--ui-violet-border);
  outline-offset: 1px;
}

.worker-strip {
  min-height: 2.75rem;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--p-slate-200, #e2e8f0);
  border-radius: 0.375rem;
  background: #fff;
}

.worker-account,
.connection-state {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.45rem;
}

.worker-account > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.worker-account strong,
.worker-account small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.worker-account strong {
  font-size: 0.76rem;
}

.worker-account small {
  color: var(--p-slate-500, #64748b);
  font-size: 0.64rem;
}

.connection-state {
  color: #166534;
  font-size: 0.7rem;
  white-space: nowrap;
}

.connection-state.disconnected {
  color: #991b1b;
}

.execution-state {
  display: flex;
  min-height: 16rem;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 0.5rem;
  color: var(--p-slate-500, #64748b);
  text-align: center;
}

.execution-state p {
  max-width: 30rem;
  font-size: 0.75rem;
}

.execution-error > i {
  color: #b91c1c;
  font-size: 1.5rem;
}

.active-operation {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  padding: 0.8rem;
  border: 1px solid var(--ui-violet-border);
  border-radius: 0.375rem;
  background: #fff;
}

.active-operation.status-failed {
  border-color: #fecaca;
}

.operation-heading {
  justify-content: space-between;
  gap: 0.75rem;
}

.operation-heading > div {
  min-width: 0;
}

.eyebrow {
  color: var(--p-slate-500, #64748b);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

h2 {
  overflow: hidden;
  margin-top: 0.12rem;
  font-size: 0.92rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  border-top: 1px solid var(--p-slate-200, #e2e8f0);
  border-left: 1px solid var(--p-slate-200, #e2e8f0);
}

.operation-facts > div {
  min-width: 0;
  padding: 0.45rem;
  border-right: 1px solid var(--p-slate-200, #e2e8f0);
  border-bottom: 1px solid var(--p-slate-200, #e2e8f0);
}

.operation-facts dt {
  color: var(--p-slate-500, #64748b);
  font-size: 0.62rem;
}

.operation-facts dd {
  overflow: hidden;
  margin: 0.12rem 0 0;
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-message {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  padding: 0.5rem;
  color: #3730a3;
  background: var(--ui-violet-surface);
  font-size: 0.72rem;
  line-height: 1.4;
}

.operation-message--error {
  color: #991b1b;
  background: #fef2f2;
}

.operation-queue {
  overflow: hidden;
  border: 1px solid var(--p-slate-200, #e2e8f0);
  border-radius: 0.375rem;
  background: #fff;
}

.operation-queue header {
  justify-content: space-between;
  padding: 0.45rem 0.65rem;
  border-bottom: 1px solid var(--p-slate-200, #e2e8f0);
  font-size: 0.72rem;
}

.operation-queue header span {
  color: var(--p-slate-500, #64748b);
}

.operation-queue ul {
  max-height: 9rem;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.operation-queue li {
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.45rem 0.65rem;
}

.operation-queue li + li {
  border-top: 1px solid var(--p-slate-100, #f1f5f9);
}

.queue-title {
  overflow: hidden;
  min-width: 0;
  color: var(--p-slate-700, #334155);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 560px) {
  .execution-heading p {
    display: none;
  }

  .jobs-link {
    width: 1.9rem;
    padding: 0;
    font-size: 0;
  }

  .jobs-link i {
    font-size: 0.8rem;
  }

  .operation-facts {
    grid-template-columns: 1fr;
  }
}
</style>
