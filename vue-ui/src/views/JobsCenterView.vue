<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import MSelect from "../components/universal/input/MSelect.vue";
import MLoader from "../components/universal/patterns/MLoader.vue";
import JobProgress from "../components/jobs/JobProgress.vue";
import JobStatusBadge from "../components/jobs/JobStatusBadge.vue";
import {
  canRequestJobCancel,
  canRequestJobRetry,
  clearCompletedJobs,
  requestJobAction,
  type Job,
  type JobStatus,
} from "../utils/jobsDb";
import { useJobs } from "../composables/useJobs";

const route = useRoute();
const router = useRouter();

const { jobs, loading, error, refresh: load } = useJobs();
const actionError = ref("");
const query = ref("");
const statusFilter = ref<JobStatus | "all">("all");
const environmentFilter = ref("all");
const selectedId = ref(
  typeof route.query.job === "string" ? route.query.job : "",
);
const busyId = ref("");

const statusOptions = [
  { label: "All statuses", value: "all" },
  { label: "Queued", value: "queued" },
  { label: "Running", value: "running" },
  { label: "Succeeded", value: "succeeded" },
  { label: "Failed", value: "failed" },
  { label: "Cancelled", value: "cancelled" },
  { label: "Retry requested", value: "retry-requested" },
  { label: "Cancel requested", value: "cancel-requested" },
];

const environmentOptions = computed(() => [
  { label: "All environments", value: "all" },
  ...Array.from(new Set(jobs.value.map((job) => job.environment)))
    .sort()
    .map((environment) => ({ label: environment, value: environment })),
]);

const filteredJobs = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return jobs.value.filter((job) => {
    if (statusFilter.value !== "all" && job.status !== statusFilter.value) {
      return false;
    }
    if (
      environmentFilter.value !== "all" &&
      job.environment !== environmentFilter.value
    ) {
      return false;
    }
    return (
      !needle ||
      `${job.title} ${job.kind ?? ""} ${job.account} ${job.environment} ${job.error ?? ""}`
        .toLowerCase()
        .includes(needle)
    );
  });
});

const selectedJob = computed(
  () => jobs.value.find((job) => job.id === selectedId.value) ?? null,
);

const activeCount = computed(
  () =>
    jobs.value.filter((job) =>
      ["queued", "running", "retry-requested", "cancel-requested"].includes(
        job.status,
      ),
    ).length,
);

const completedCount = computed(
  () =>
    jobs.value.filter((job) =>
      ["succeeded", "failed", "cancelled"].includes(job.status),
    ).length,
);

const selectJob = (job: Job) => {
  selectedId.value = job.id;
};

watch(selectedId, (job) => {
  const nextQuery = { ...route.query };
  if (job) nextQuery.job = job;
  else delete nextQuery.job;
  void router.replace({ query: nextQuery });
});

watch(
  () => route.query.job,
  (job) => {
    selectedId.value = typeof job === "string" ? job : "";
  },
);

const formatDate = (timestamp?: number) => {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(timestamp);
};

const formatResult = (result: unknown) => {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
};

const requestAction = async (job: Job, action: "retry" | "cancel") => {
  busyId.value = job.id;
  actionError.value = "";
  try {
    const accepted = await requestJobAction(job.id, action);
    if (!accepted) {
      actionError.value = `The ${action} request is no longer valid for this job.`;
    }
    await load();
  } catch (cause) {
    actionError.value =
      cause instanceof Error ? cause.message : `Could not request ${action}.`;
  } finally {
    busyId.value = "";
  }
};

const clearCompleted = async () => {
  actionError.value = "";
  try {
    await clearCompletedJobs();
    selectedId.value = "";
    await load();
  } catch (cause) {
    actionError.value =
      cause instanceof Error
        ? cause.message
        : "Completed jobs could not be cleared.";
  }
};

const openSource = (job: Job) => {
  if (job.sourcePath) void router.push(job.sourcePath);
};

watch(jobs, () => {
  if (selectedId.value && !selectedJob.value) selectedId.value = "";
});
</script>

<template>
  <main class="jobs-view">
    <header class="jobs-header">
      <div class="heading">
        <span class="heading-icon"><i class="pi pi-list-check"></i></span>
        <div>
          <h1>Jobs Center</h1>
          <p>Durable background work and operation history</p>
        </div>
      </div>
      <div class="header-metrics" aria-label="Job summary">
        <span
          ><strong>{{ activeCount }}</strong> active</span
        >
        <span
          ><strong>{{ completedCount }}</strong> completed</span
        >
      </div>
    </header>

    <section class="jobs-toolbar" aria-label="Job filters">
      <label class="search-control">
        <span class="sr-only">Search jobs</span>
        <i class="pi pi-search"></i>
        <input
          v-model="query"
          type="search"
          placeholder="Search jobs, accounts, errors…"
        />
      </label>
      <MSelect
        v-model="statusFilter"
        :options="statusOptions"
        option-label="label"
        option-value="value"
        size="small"
        class="toolbar-select"
      />
      <MSelect
        v-model="environmentFilter"
        :options="environmentOptions"
        option-label="label"
        option-value="value"
        size="small"
        class="toolbar-select environment-select"
      />
      <button
        type="button"
        class="button"
        :disabled="completedCount === 0"
        title="Remove succeeded, failed, and cancelled jobs"
        @click="clearCompleted"
      >
        <i class="pi pi-trash"></i>
        Clear completed
      </button>
      <button
        type="button"
        class="icon-button"
        title="Refresh jobs"
        @click="load"
      >
        <i class="pi pi-refresh" :class="{ 'pi-spin': loading }"></i>
      </button>
    </section>

    <p v-if="actionError" class="inline-error" role="alert">
      <i class="pi pi-exclamation-triangle"></i>{{ actionError }}
    </p>

    <section class="jobs-content">
      <div class="jobs-list-pane">
        <div v-if="loading && jobs.length === 0" class="state-panel">
          <MLoader />
          <p>Loading durable jobs…</p>
        </div>

        <div v-else-if="error" class="state-panel error-state" role="alert">
          <i class="pi pi-exclamation-circle"></i>
          <strong>Jobs are unavailable</strong>
          <p>{{ error }}</p>
          <button type="button" class="button" @click="load">Try again</button>
        </div>

        <div v-else-if="jobs.length === 0" class="state-panel empty-state">
          <span class="empty-icon"><i class="pi pi-inbox"></i></span>
          <strong>No jobs recorded yet</strong>
          <p>
            Background operations will appear here as features register them.
            History stays available across navigation and extension restarts.
          </p>
        </div>

        <div
          v-else-if="filteredJobs.length === 0"
          class="state-panel empty-state"
        >
          <span class="empty-icon"><i class="pi pi-filter-slash"></i></span>
          <strong>No matching jobs</strong>
          <p>Adjust the search or filters to see more history.</p>
        </div>

        <ul v-else class="jobs-list">
          <li v-for="job in filteredJobs" :key="job.id">
            <button
              type="button"
              class="job-row"
              :class="{ selected: selectedId === job.id }"
              :aria-pressed="selectedId === job.id"
              @click="selectJob(job)"
            >
              <span class="status-icon" :class="`status-${job.status}`">
                <i
                  class="pi"
                  :class="{
                    'pi-clock': job.status === 'queued',
                    'pi-spin pi-spinner': job.status === 'running',
                    'pi-check': job.status === 'succeeded',
                    'pi-times': job.status === 'failed',
                    'pi-ban': job.status === 'cancelled',
                    'pi-replay': job.status === 'retry-requested',
                    'pi-stop-circle': job.status === 'cancel-requested',
                  }"
                ></i>
              </span>
              <span class="job-primary">
                <span class="job-title" :title="job.title">{{
                  job.title
                }}</span>
                <span class="job-meta">
                  {{ job.environment }} · {{ job.account }}
                  <template v-if="job.kind"> · {{ job.kind }}</template>
                </span>
                <JobProgress
                  class="row-progress"
                  :progress="job.progress"
                  :indeterminate="job.indeterminate"
                  :label="`${job.title} progress`"
                />
              </span>
              <span class="job-secondary">
                <JobStatusBadge :status="job.status" />
                <time :datetime="new Date(job.updatedAt).toISOString()">
                  {{ formatDate(job.updatedAt) }}
                </time>
              </span>
            </button>
          </li>
        </ul>
      </div>

      <aside class="details-pane" :class="{ empty: !selectedJob }">
        <template v-if="selectedJob">
          <div class="details-heading">
            <div>
              <span class="eyebrow">Job details</span>
              <h2 :title="selectedJob.title">{{ selectedJob.title }}</h2>
            </div>
            <button
              type="button"
              class="icon-button"
              title="Close details"
              @click="selectedId = ''"
            >
              <i class="pi pi-times"></i>
            </button>
          </div>

          <div class="detail-status">
            <JobStatusBadge :status="selectedJob.status" />
            <span>{{ selectedJob.progress }}%</span>
          </div>
          <JobProgress
            class="details-progress"
            :progress="selectedJob.progress"
            :indeterminate="selectedJob.indeterminate"
            :label="`${selectedJob.title} progress`"
          />

          <dl class="details-grid">
            <div>
              <dt>Environment</dt>
              <dd>{{ selectedJob.environment }}</dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>{{ selectedJob.account }}</dd>
            </div>
            <div>
              <dt>Attempt</dt>
              <dd>{{ selectedJob.attempt }}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{{ formatDate(selectedJob.createdAt) }}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{{ formatDate(selectedJob.startedAt) }}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{{ formatDate(selectedJob.finishedAt) }}</dd>
            </div>
          </dl>

          <div v-if="selectedJob.error" class="result-block error-block">
            <span>Error</span>
            <pre>{{ selectedJob.error }}</pre>
          </div>
          <div v-if="selectedJob.result !== undefined" class="result-block">
            <span>Result</span>
            <pre>{{ formatResult(selectedJob.result) }}</pre>
          </div>

          <p
            v-if="
              ['retry-requested', 'cancel-requested'].includes(
                selectedJob.status,
              )
            "
            class="request-note"
          >
            <i class="pi pi-info-circle"></i>
            This request is recorded. The originating feature must acknowledge
            it before work restarts or stops.
          </p>

          <div class="details-actions">
            <button
              v-if="selectedJob.sourcePath"
              type="button"
              class="button button-primary"
              @click="openSource(selectedJob)"
            >
              <i class="pi pi-external-link"></i>
              Open source
            </button>
            <button
              v-if="canRequestJobRetry(selectedJob.status)"
              type="button"
              class="button"
              :disabled="busyId === selectedJob.id"
              @click="requestAction(selectedJob, 'retry')"
            >
              <i class="pi pi-replay"></i>
              Request retry
            </button>
            <button
              v-if="canRequestJobCancel(selectedJob.status)"
              type="button"
              class="button danger-button"
              :disabled="busyId === selectedJob.id"
              @click="requestAction(selectedJob, 'cancel')"
            >
              <i class="pi pi-stop-circle"></i>
              Request cancel
            </button>
          </div>
        </template>
        <div v-else class="details-placeholder">
          <i class="pi pi-arrow-left"></i>
          <p>
            Select a job to inspect its result, timestamps, and available
            actions.
          </p>
        </div>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.jobs-view {
  --jobs-accent: #4f46e5;
  --jobs-accent-border: #a5b4fc;
  --jobs-accent-surface: #f1f4fe;
  --jobs-icon-surface: #e0e7ff;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  color: var(--p-slate-800, #1e293b);
  background: var(--p-slate-50, #f8fafc);
}

.jobs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--p-slate-200, #e2e8f0);
  background: #fff;
}

.heading,
.header-metrics,
.jobs-toolbar,
.detail-status,
.details-actions {
  display: flex;
  align-items: center;
}

.heading {
  gap: 0.65rem;
  min-width: 0;
}
.heading-icon {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  border-radius: 0.375rem;
  color: var(--jobs-accent);
  background: var(--jobs-icon-surface);
}

h1,
h2,
p {
  margin: 0;
}
h1 {
  font-size: 1rem;
  line-height: 1.25;
}
.heading p {
  margin-top: 0.1rem;
  color: var(--p-slate-500, #64748b);
  font-size: 0.75rem;
}
.header-metrics {
  gap: 0.75rem;
  color: var(--p-slate-500, #64748b);
  font-size: 0.75rem;
  white-space: nowrap;
}
.header-metrics strong {
  color: var(--p-slate-800, #1e293b);
}

.jobs-toolbar {
  gap: 0.5rem;
  padding: 0.55rem 1rem;
  border-bottom: 1px solid var(--p-slate-200, #e2e8f0);
  background: #fff;
}

.search-control {
  position: relative;
  flex: 1 1 14rem;
  max-width: 26rem;
}

.search-control i {
  position: absolute;
  top: 50%;
  left: 0.65rem;
  transform: translateY(-50%);
  color: var(--p-slate-400, #94a3b8);
  font-size: 0.72rem;
}

.search-control input {
  width: 100%;
  height: 1.9rem;
  padding: 0 0.65rem 0 1.8rem;
  border: 1px solid var(--p-slate-300, #cbd5e1);
  border-radius: 0.3rem;
  outline: none;
  color: inherit;
  background: #fff;
  font: inherit;
  font-size: 0.78rem;
  box-sizing: border-box;
}

.search-control input:focus {
  border-color: var(--jobs-accent-border);
  box-shadow: 0 0 0 2px var(--jobs-accent-surface);
}

.toolbar-select {
  width: 10rem;
  flex: 0 0 auto;
}
.environment-select {
  width: 11rem;
}

.button,
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.9rem;
  border: 1px solid var(--p-slate-300, #cbd5e1);
  border-radius: 0.3rem;
  color: var(--p-slate-700, #334155);
  background: #fff;
  font: inherit;
  font-size: 0.76rem;
  white-space: nowrap;
  cursor: pointer;
}

.button {
  gap: 0.35rem;
  padding: 0 0.65rem;
}
.icon-button {
  width: 1.9rem;
  padding: 0;
  flex: 0 0 auto;
}
.button:hover:not(:disabled),
.icon-button:hover:not(:disabled) {
  border-color: var(--jobs-accent-border);
  color: var(--jobs-accent);
  background: var(--jobs-accent-surface);
}
.button:focus-visible,
.icon-button:focus-visible,
.job-row:focus-visible {
  outline: 2px solid var(--jobs-accent-border);
  outline-offset: 1px;
}
.button:disabled,
.icon-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.button-primary {
  border-color: var(--jobs-accent);
  color: #fff;
  background: var(--jobs-accent);
}
.button-primary:hover:not(:disabled) {
  color: #fff;
  background: #4338ca;
}
.danger-button {
  color: #b91c1c;
}

.inline-error {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 1rem;
  border-bottom: 1px solid #fecaca;
  color: #991b1b;
  background: #fef2f2;
  font-size: 0.76rem;
}

.jobs-content {
  display: grid;
  grid-template-columns: minmax(22rem, 1fr) minmax(18rem, 25rem);
  flex: 1;
  min-height: 0;
}

.jobs-list-pane {
  min-width: 0;
  overflow: auto;
}
.jobs-list {
  margin: 0;
  padding: 0.45rem;
  list-style: none;
}
.jobs-list li + li {
  margin-top: 0.25rem;
}

.job-row {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  min-height: 4.25rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid transparent;
  border-radius: 0.35rem;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.job-row:hover {
  background: #fff;
  border-color: var(--p-slate-200, #e2e8f0);
}
.job-row.selected {
  border-color: var(--jobs-accent-border);
  color: var(--jobs-accent);
  background: var(--jobs-accent-surface);
}

.status-icon {
  display: grid;
  place-items: center;
  width: 1.85rem;
  height: 1.85rem;
  border-radius: 0.3rem;
  color: var(--p-slate-500, #64748b);
  background: var(--p-slate-100, #f1f5f9);
}
.selected .status-icon {
  color: var(--jobs-accent);
  background: var(--jobs-icon-surface);
}
.status-icon.status-succeeded {
  color: #15803d;
  background: #dcfce7;
}
.status-icon.status-failed {
  color: #b91c1c;
  background: #fee2e2;
}
.status-icon.status-running {
  color: #0369a1;
  background: #e0f2fe;
}

.job-primary,
.job-secondary {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.job-primary {
  gap: 0.2rem;
}
.job-title {
  overflow: hidden;
  color: var(--p-slate-800, #1e293b);
  font-size: 0.82rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.job-meta {
  overflow: hidden;
  color: var(--p-slate-500, #64748b);
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.job-secondary {
  align-items: flex-end;
  gap: 0.35rem;
  margin-left: 0.5rem;
}
.job-secondary time {
  color: var(--p-slate-400, #94a3b8);
  font-size: 0.65rem;
  white-space: nowrap;
}

.row-progress {
  height: 0.2rem;
}

.details-pane {
  min-width: 0;
  overflow: auto;
  padding: 0.85rem;
  border-left: 1px solid var(--p-slate-200, #e2e8f0);
  background: #fff;
}
.details-pane.empty {
  display: grid;
  place-items: center;
}
.details-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}
.details-heading > div {
  min-width: 0;
}
.eyebrow {
  color: var(--p-slate-500, #64748b);
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
h2 {
  overflow: hidden;
  margin-top: 0.15rem;
  font-size: 0.95rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-status {
  justify-content: space-between;
  margin-top: 1rem;
  color: var(--p-slate-500, #64748b);
  font-size: 0.72rem;
}
.details-progress {
  height: 0.35rem;
  margin-top: 0.4rem;
}

.details-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  margin: 1rem 0;
  border-top: 1px solid var(--p-slate-200, #e2e8f0);
  border-left: 1px solid var(--p-slate-200, #e2e8f0);
}
.details-grid > div {
  min-width: 0;
  padding: 0.5rem;
  border-right: 1px solid var(--p-slate-200, #e2e8f0);
  border-bottom: 1px solid var(--p-slate-200, #e2e8f0);
}
.details-grid dt {
  color: var(--p-slate-500, #64748b);
  font-size: 0.64rem;
}
.details-grid dd {
  overflow: hidden;
  margin: 0.15rem 0 0;
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-block {
  margin-top: 0.75rem;
}
.result-block > span {
  color: var(--p-slate-500, #64748b);
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
}
.result-block pre {
  max-height: 12rem;
  overflow: auto;
  margin: 0.3rem 0 0;
  padding: 0.55rem;
  border: 1px solid var(--p-slate-200, #e2e8f0);
  border-radius: 0.3rem;
  color: var(--p-slate-700, #334155);
  background: var(--p-slate-50, #f8fafc);
  font-size: 0.68rem;
  white-space: pre-wrap;
  word-break: break-word;
}
.error-block pre {
  border-color: #fecaca;
  color: #991b1b;
  background: #fef2f2;
}
.request-note {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.85rem;
  padding: 0.5rem;
  color: #3730a3;
  background: var(--jobs-accent-surface);
  font-size: 0.7rem;
  line-height: 1.4;
}
.details-actions {
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 1rem;
}

.state-panel,
.details-placeholder {
  display: flex;
  min-height: 16rem;
  padding: 2rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  color: var(--p-slate-500, #64748b);
  text-align: center;
}
.state-panel p,
.details-placeholder p {
  max-width: 28rem;
  font-size: 0.76rem;
  line-height: 1.5;
}
.state-panel strong {
  color: var(--p-slate-700, #334155);
  font-size: 0.85rem;
}
.empty-icon {
  display: grid;
  place-items: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.375rem;
  color: var(--jobs-accent);
  background: var(--jobs-icon-surface);
}
.error-state > i {
  color: #b91c1c;
  font-size: 1.5rem;
}
.details-placeholder {
  min-height: 0;
  padding: 1rem;
}
.details-placeholder > i {
  color: var(--jobs-accent);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 780px) {
  .header-metrics {
    display: none;
  }
  .jobs-toolbar {
    flex-wrap: wrap;
  }
  .search-control {
    max-width: none;
    flex-basis: 100%;
  }
  .toolbar-select,
  .environment-select {
    flex: 1 1 9rem;
    width: auto;
  }
  .jobs-content {
    grid-template-columns: 1fr;
    overflow: auto;
  }
  .jobs-list-pane {
    overflow: visible;
  }
  .details-pane {
    border-top: 1px solid var(--p-slate-200, #e2e8f0);
    border-left: 0;
  }
  .details-pane.empty {
    display: none;
  }
}
</style>
