<template>
  <section class="trace-panel" aria-label="SuiteQL execution trace">
    <div v-if="!plan" class="trace-empty">
      <i class="pi pi-sitemap" />
      <strong>No execution trace yet</strong>
      <span>Use Trace query to run each logical input and join stage.</span>
    </div>

    <template v-else>
      <header class="trace-summary">
        <div>
          <i class="pi pi-info-circle" />
          <span>
            Actual intermediate SuiteQL queries · logical trace, not a private
            NetSuite optimizer plan
          </span>
        </div>
        <strong v-if="isRunning">
          <i class="pi pi-spin pi-spinner" /> Tracing…
        </strong>
        <strong v-else>{{ completedCount }} / {{ executableCount }} stages</strong>
      </header>

      <div v-if="plan.warnings.length" class="trace-warnings">
        <span v-for="warning in plan.warnings" :key="warning">
          {{ warning }}
        </span>
      </div>

      <div class="trace-workspace">
        <nav class="trace-stage-list" aria-label="Execution stages">
          <button
            v-for="traceStage in plan.stages"
            :key="traceStage.id"
            type="button"
            class="trace-stage"
            :class="{
              'trace-stage--active': selectedStageId === traceStage.id,
              'trace-stage--warning': multiplication(traceStage),
            }"
            :title="traceStage.title"
            @click="selectedStageId = traceStage.id"
          >
            <span class="trace-stage__sequence">
              <i
                v-if="traceStage.status === 'running'"
                class="pi pi-spin pi-spinner"
              />
              <i
                v-else-if="traceStage.status === 'success'"
                class="pi pi-check"
              />
              <i
                v-else-if="traceStage.status === 'error'"
                class="pi pi-times"
              />
              <i
                v-else-if="traceStage.status === 'skipped'"
                class="pi pi-minus"
              />
              <span v-else>{{ traceStage.sequence }}</span>
            </span>
            <span class="trace-stage__content">
              <small>{{ kindLabel(traceStage.kind) }}</small>
              <strong>{{ traceStage.title }}</strong>
              <span v-if="multiplication(traceStage)" class="trace-growth">
                <i class="pi pi-arrow-up-right" />
                {{ formatFactor(multiplication(traceStage)!) }}× left rows
              </span>
            </span>
            <span class="trace-stage__count">
              <template v-if="traceStage.rowCount !== null">
                {{ traceStage.rowCount.toLocaleString() }}
              </template>
              <template v-else>—</template>
              <small>rows</small>
            </span>
          </button>
        </nav>

        <article v-if="selectedStage" class="trace-detail">
          <header class="trace-detail__header">
            <div>
              <span>{{ kindLabel(selectedStage.kind) }}</span>
              <strong :title="selectedStage.title">{{ selectedStage.title }}</strong>
            </div>
            <div class="trace-detail__metrics">
              <span>
                <strong>{{ rowCountLabel(selectedStage) }}</strong>
                rows
              </span>
              <span>
                <strong>{{ selectedStage.rows.length }}</strong>
                sampled
              </span>
            </div>
          </header>

          <p class="trace-detail__description">{{ selectedStage.description }}</p>

          <div
            v-if="multiplication(selectedStage)"
            class="trace-multiplication"
          >
            <i class="pi pi-exclamation-triangle" />
            <div>
              <strong>Row multiplication detected</strong>
              <span>
                This join produced
                {{ formatFactor(multiplication(selectedStage)!) }}× as many rows
                as its left input. Repeated selected values may be multiple valid
                matches—not duplicate records. Check the right-source filters and
                the ON condition.
              </span>
            </div>
          </div>

          <div v-if="selectedStage.note" class="trace-note">
            <i class="pi pi-info-circle" />
            <span>{{ selectedStage.note }}</span>
          </div>

          <div v-if="selectedStage.error" class="trace-error">
            {{ selectedStage.error }}
          </div>

          <details class="trace-sql">
            <summary>Executed SQL</summary>
            <pre>{{ selectedStage.sql || "This stage is not independently executable." }}</pre>
          </details>

          <div class="trace-results">
            <table v-if="selectedStage.rows.length">
              <thead>
                <tr>
                  <th v-for="column in selectedStage.columns" :key="column">
                    {{ column }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in selectedStage.rows" :key="index">
                  <td
                    v-for="column in selectedStage.columns"
                    :key="column"
                    :title="String(row[column] ?? '')"
                  >
                    {{ row[column] ?? "" }}
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-else class="trace-results__empty">
              <i
                :class="
                  selectedStage.status === 'running'
                    ? 'pi pi-spin pi-spinner'
                    : 'pi pi-table'
                "
              />
              <span>{{ emptyMessage(selectedStage) }}</span>
            </div>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  getSuiteQLTraceMultiplication,
  type SuiteQLTracePlan,
  type SuiteQLTraceStage,
  type SuiteQLTraceStageKind,
} from "../utils/suiteqlTrace";

const props = defineProps<{
  plan: SuiteQLTracePlan | null;
  isRunning: boolean;
}>();

const selectedStageId = ref("");

watch(
  () => props.plan,
  (plan) => {
    if (!plan?.stages.length) {
      selectedStageId.value = "";
      return;
    }
    const currentExists = plan.stages.some(
      (stage) => stage.id === selectedStageId.value,
    );
    if (!currentExists) selectedStageId.value = plan.stages[0]!.id;
  },
  { immediate: true },
);

watch(
  () => props.plan?.stages.map((stage) => stage.status).join(","),
  () => {
    const running = props.plan?.stages.find((stage) => stage.status === "running");
    if (running) selectedStageId.value = running.id;
  },
);

const selectedStage = computed(() =>
  props.plan?.stages.find((stage) => stage.id === selectedStageId.value),
);

const executableCount = computed(
  () => props.plan?.stages.filter((stage) => stage.executable).length ?? 0,
);

const completedCount = computed(
  () =>
    props.plan?.stages.filter((stage) =>
      ["success", "error"].includes(stage.status),
    ).length ?? 0,
);

const kindLabel = (kind: SuiteQLTraceStageKind) =>
  ({
    subquery: "Subquery",
    source: "Filtered source",
    join: "Join",
    final: "Final projection",
  })[kind];

const multiplication = (stage: SuiteQLTraceStage) =>
  props.plan ? getSuiteQLTraceMultiplication(props.plan, stage) : null;

const formatFactor = (factor: number) =>
  factor >= 10 ? factor.toFixed(0) : factor.toFixed(1).replace(/\.0$/, "");

const rowCountLabel = (stage: SuiteQLTraceStage) =>
  stage.rowCount === null ? "—" : stage.rowCount.toLocaleString();

const emptyMessage = (stage: SuiteQLTraceStage) => {
  if (stage.status === "running") return "Executing this stage…";
  if (stage.status === "skipped") return "This stage depends on an outer row.";
  if (stage.status === "error") return "This intermediate query could not run.";
  if (stage.status === "success") return "This stage returned no rows.";
  return "Waiting to execute this stage.";
};
</script>

<style scoped>
.trace-panel {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: #fbfcfd;
  color: #27323a;
}

.trace-empty,
.trace-results__empty {
  display: flex;
  height: 100%;
  min-height: 7rem;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 0.35rem;
  color: #8a949b;
  font-size: 0.68rem;
}

.trace-empty i {
  color: var(--ui-violet, #4f46e5);
  font-size: 1.25rem;
}

.trace-empty strong {
  color: #27323a;
  font-size: 0.72rem;
}

.trace-summary {
  display: flex;
  min-height: 2rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px solid #dbe3ea;
  background: #f1f4fe;
  padding: 0 0.65rem;
  font-size: 0.59rem;
}

.trace-summary > div,
.trace-summary > strong {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.35rem;
}

.trace-summary span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-summary i,
.trace-summary strong {
  color: var(--ui-violet, #4f46e5);
}

.trace-warnings {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  border-bottom: 1px solid #e5eaf0;
  background: white;
  color: #62696e;
  padding: 0.28rem 0.65rem;
  font-size: 0.56rem;
}

.trace-workspace {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(13rem, 17rem) minmax(0, 1fr);
}

.trace-stage-list {
  min-height: 0;
  overflow-y: auto;
  border-right: 1px solid #dbe3ea;
  background: #f7f9fb;
  padding: 0.35rem;
}

.trace-stage {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 1.45rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  color: #27323a;
  cursor: pointer;
  padding: 0.38rem 0.45rem;
  text-align: left;
}

.trace-stage + .trace-stage {
  margin-top: 0.16rem;
}

.trace-stage:hover {
  border-color: #dbe3ea;
  background: white;
}

.trace-stage--active {
  border-color: #a5b4fc;
  outline: 1px solid #a5b4fc;
  outline-offset: -1px;
  background: #f1f4fe;
}

.trace-stage--warning:not(.trace-stage--active) {
  border-color: #f3c77b;
  background: #fffaf0;
}

.trace-stage__sequence {
  display: inline-flex;
  width: 1.35rem;
  height: 1.35rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.22rem;
  background: #e0e7ff;
  color: #4f46e5;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.55rem;
  font-weight: 700;
}

.trace-stage__sequence i {
  font-size: 0.55rem;
}

.trace-stage__content {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.trace-stage__content small {
  color: #8a949b;
  font-size: 0.5rem;
  text-transform: uppercase;
}

.trace-stage__content strong {
  overflow: hidden;
  font-size: 0.62rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-growth {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  color: #9a6700;
  font-size: 0.52rem;
}

.trace-growth i {
  font-size: 0.48rem;
}

.trace-stage__count {
  display: flex;
  flex-direction: column;
  color: #27323a;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.62rem;
  text-align: right;
}

.trace-stage__count small {
  color: #8a949b;
  font-size: 0.47rem;
}

.trace-detail {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: white;
}

.trace-detail__header {
  display: flex;
  min-height: 2.7rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px solid #e5eaf0;
  padding: 0.35rem 0.65rem;
}

.trace-detail__header > div:first-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.trace-detail__header > div:first-child span {
  color: #8a949b;
  font-size: 0.5rem;
  text-transform: uppercase;
}

.trace-detail__header > div:first-child strong {
  overflow: hidden;
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-detail__metrics {
  display: flex;
  flex: 0 0 auto;
  gap: 0.35rem;
}

.trace-detail__metrics > span {
  display: flex;
  min-width: 3.8rem;
  flex-direction: column;
  border-left: 1px solid #dbe3ea;
  color: #8a949b;
  padding-left: 0.45rem;
  font-size: 0.48rem;
  text-transform: uppercase;
}

.trace-detail__metrics strong {
  color: #27323a;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.66rem;
}

.trace-detail__description {
  margin: 0;
  border-bottom: 1px solid #eef3f7;
  color: #62696e;
  padding: 0.4rem 0.65rem;
  font-size: 0.6rem;
  line-height: 1.45;
}

.trace-multiplication,
.trace-note {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  gap: 0.45rem;
  margin: 0.4rem 0.65rem 0;
  border: 1px solid #f3c77b;
  border-radius: 0.25rem;
  background: #fffaf0;
  color: #724b00;
  padding: 0.4rem 0.5rem;
  font-size: 0.57rem;
}

.trace-multiplication > div {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.trace-multiplication i,
.trace-note i {
  margin-top: 0.08rem;
  font-size: 0.65rem;
}

.trace-note {
  border-color: #a5b4fc;
  background: #f1f4fe;
  color: #3730a3;
}

.trace-error {
  margin: 0.4rem 0.65rem 0;
  border: 1px solid #fecaca;
  border-radius: 0.25rem;
  background: #fff7f7;
  color: #b42318;
  padding: 0.4rem 0.5rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.55rem;
  white-space: pre-wrap;
}

.trace-sql {
  flex: 0 0 auto;
  margin: 0.4rem 0.65rem 0;
  border: 1px solid #dbe3ea;
  border-radius: 0.25rem;
  background: #f7f9fb;
  font-size: 0.57rem;
}

.trace-sql summary {
  cursor: pointer;
  color: #62696e;
  padding: 0.35rem 0.45rem;
  font-weight: 600;
}

.trace-sql pre {
  max-height: 5rem;
  margin: 0;
  overflow: auto;
  border-top: 1px solid #dbe3ea;
  color: #27323a;
  padding: 0.4rem 0.5rem;
  font-family: "JetBrains Mono", monospace;
  white-space: pre-wrap;
}

.trace-results {
  min-height: 0;
  flex: 1;
  overflow: auto;
  margin-top: 0.4rem;
  border-top: 1px solid #dbe3ea;
}

.trace-results table {
  width: 100%;
  border-collapse: collapse;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.58rem;
}

.trace-results th,
.trace-results td {
  overflow: hidden;
  max-width: 14rem;
  border-bottom: 1px solid #eef3f7;
  color: #27323a;
  padding: 0.3rem 0.5rem;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trace-results th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f7f9fb;
  color: #62696e;
  font-size: 0.53rem;
  text-transform: uppercase;
}

@media (max-width: 780px) {
  .trace-workspace {
    grid-template-columns: minmax(10rem, 13rem) minmax(0, 1fr);
  }
}
</style>
