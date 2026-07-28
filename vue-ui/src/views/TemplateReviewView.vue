<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch
} from "vue";
import { useRoute } from "vue-router";
import MSelect from "../components/universal/input/MSelect.vue";
import {
  ApiRequestType,
  callApi,
  type ApiResponse
} from "../utils/api";
import { RequestRoutes } from "../types/request";

type ReviewStatus =
  | "html_review"
  | "html_changes_requested"
  | "html_approved"
  | "converting"
  | "freemarker_review"
  | "freemarker_changes_requested"
  | "freemarker_approved"
  | "render_error"
  | "done";

type ReviewComment = {
  id?: string;
  parentId?: string;
  initials: string;
  name: string;
  time: string;
  text: string;
  color?: "blue" | "purple" | "green";
  isYou?: boolean;
};

type ReviewState = {
  reviewId: string;
  title: string;
  templateFile: string;
  recordType: string;
  recordId: string;
  recordTypeOptions: string[];
  recordIdOptions: string[];
  recordTypeLabels: Record<string, string>;
  recordIdLabels: Record<string, string>;
  html: string;
  freemarker: string;
  pdfDataUrl: string;
  renderError: string;
  sessionId: string;
  referenceImageDataUrl: string;
  referenceImageUrl: string;
  feedback: string;
  comments: ReviewComment[];
  status: ReviewStatus;
  version: number;
  renderedVersion: number;
  updatedAt: string;
};

const STORAGE_KEY = "magic_netsuite_template_review_state";
const route = useRoute();
const requestedReviewId = String(route.params.reviewId || "");
const extensionIconUrl = chrome.runtime.getURL("icons/icon32.png");
const loading = ref(true);
const busy = ref(false);
const contextLoading = ref(false);
const loadError = ref("");
const contextError = ref("");
const activeArtifact = ref<"html" | "freemarker" | "pdf">("html");
const referenceInput = ref<HTMLInputElement | null>(null);
const htmlFrame = ref<HTMLIFrameElement | null>(null);
const pdfFrame = ref<HTMLIFrameElement | null>(null);
const referenceImage = ref<HTMLImageElement | null>(null);
const pdfLoadedUrl = ref("");

const state = reactive<ReviewState>({
  reviewId: "",
  title: "NetSuite Template Review",
  templateFile: "invoice_template.ftl",
  recordType: "invoice",
  recordId: "",
  recordTypeOptions: ["invoice"],
  recordIdOptions: [],
  recordTypeLabels: { invoice: "Invoice" },
  recordIdLabels: {},
  html: "",
  freemarker: "",
  pdfDataUrl: "",
  renderError: "",
  sessionId: "",
  referenceImageDataUrl: "",
  referenceImageUrl: "",
  feedback: "",
  comments: [],
  status: "html_review",
  version: 0,
  renderedVersion: 0,
  updatedAt: ""
});

const TRANSACTION_TYPES: Record<string, string> = {
  salesorder: "SalesOrd",
  invoice: "CustInvc",
  purchaseorder: "PurchOrd",
  vendorbill: "VendBill",
  estimate: "Estimate",
  creditmemo: "CustCred",
  journalentry: "Journal",
  itemfulfillment: "ItemShip",
  cashsale: "CashSale"
};

const pendingStatuses = new Set<ReviewStatus>([
  "html_review",
  "html_changes_requested",
  "html_approved",
  "converting",
  "freemarker_review",
  "freemarker_changes_requested",
  "render_error"
]);

const isFreemarkerStage = computed(() =>
  [
    "converting",
    "freemarker_review",
    "freemarker_changes_requested",
    "freemarker_approved",
    "render_error"
  ].includes(state.status)
);
const isWaitingForAgent = computed(() =>
  ["html_changes_requested", "freemarker_changes_requested"].includes(
    state.status
  )
);
const referenceSrc = computed(
  () => state.referenceImageDataUrl || state.referenceImageUrl
);
const canApprove = computed(
  () =>
    !busy.value &&
    !isWaitingForAgent.value &&
    state.status !== "converting" &&
    state.status !== "done" &&
    state.status !== "freemarker_approved" &&
    Boolean(state.recordId) &&
    !(isFreemarkerStage.value && state.renderError)
);
const statusLabel = computed(() => {
  const labels: Record<ReviewStatus, string> = {
    html_review: "HTML review",
    html_changes_requested: "Waiting for HTML fixes",
    html_approved: "HTML approved",
    converting: "Converting in NetSuite",
    freemarker_review: "FreeMarker / PDF review",
    freemarker_changes_requested: "Waiting for FreeMarker fixes",
    freemarker_approved: "Final approval complete",
    render_error: "Render needs attention",
    done: "Review ended"
  };
  return labels[state.status];
});
const recordTypeOptions = computed(() =>
  state.recordTypeOptions.map((value) => ({
    value,
    label: state.recordTypeLabels[value] || value
  }))
);
const recordIdOptions = computed(() =>
  state.recordIdOptions.map((value) => ({
    value,
    label: state.recordIdLabels[value] || `#${value}`
  }))
);

const normalizeRows = (response: ApiResponse): Record<string, unknown>[] => {
  const message = response?.message;
  if (Array.isArray(message)) return message as Record<string, unknown>[];
  if (Array.isArray(message?.results)) {
    return message.results as Record<string, unknown>[];
  }
  return [];
};

const recordQueries = (recordType: string): string[] => {
  const cleanType = recordType.replace(/[^a-z0-9_]/gi, "");
  const transactionType = TRANSACTION_TYPES[cleanType];
  if (transactionType) {
    return [
      `SELECT id, tranid, BUILTIN.DF(entity) AS entity, trandate FROM transaction WHERE type = '${transactionType}' AND ROWNUM <= 100 ORDER BY id DESC`
    ];
  }
  return [
    `SELECT id, name FROM ${cleanType} WHERE ROWNUM <= 100 ORDER BY id DESC`,
    `SELECT id, entityid, altname FROM ${cleanType} WHERE ROWNUM <= 100 ORDER BY id DESC`,
    `SELECT id, scriptid, name FROM ${cleanType} WHERE ROWNUM <= 100 ORDER BY id DESC`,
    `SELECT id FROM ${cleanType} WHERE ROWNUM <= 100 ORDER BY id DESC`
  ];
};

const rowLabel = (row: Record<string, unknown>): string => {
  const primary = String(
    row.tranid ??
      row.name ??
      row.entityid ??
      row.altname ??
      row.scriptid ??
      ""
  ).trim();
  const secondary = String(row.entity ?? row.trandate ?? "").trim();
  const id = String(row.id ?? row.ID ?? "").trim();
  return [primary || `#${id}`, secondary].filter(Boolean).join(" · ");
};

const currentStoredState = async (): Promise<ReviewState | null> => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY];
  return value && typeof value === "object" ? (value as ReviewState) : null;
};

const applyIncomingState = async (value: ReviewState): Promise<void> => {
  if (!value || value.reviewId !== requestedReviewId) return;
  Object.assign(state, value);
  if (!Array.isArray(state.comments)) state.comments = [];
  if (state.status === "freemarker_review") {
    activeArtifact.value = state.pdfDataUrl ? "pdf" : "freemarker";
  } else if (isFreemarkerStage.value) {
    activeArtifact.value = "freemarker";
  }
  await markRendered(value.version);
};

const persistPatch = async (
  patch: Partial<ReviewState>
): Promise<ReviewState> => {
  const current = await currentStoredState();
  if (!current || current.reviewId !== requestedReviewId) {
    throw new Error("This review is no longer active.");
  }
  const next: ReviewState = {
    ...current,
    ...patch,
    version: current.version + 1,
    updatedAt: new Date().toISOString()
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  await applyIncomingState(next);
  return next;
};

async function markRendered(expectedVersion = state.version): Promise<void> {
  await nextTick();
  await new Promise<void>((resolve) =>
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => resolve())
    )
  );
  const current = await currentStoredState();
  if (
    !current ||
    current.reviewId !== requestedReviewId ||
    Number(current.version) !== Number(expectedVersion) ||
    Number(current.renderedVersion) >= Number(current.version)
  ) {
    return;
  }
  if (
    referenceSrc.value &&
    (!referenceImage.value?.complete ||
      !referenceImage.value?.naturalWidth)
  ) {
    return;
  }
  if (
    activeArtifact.value === "html" &&
    (!htmlFrame.value ||
      htmlFrame.value.contentDocument?.readyState !== "complete")
  ) {
    return;
  }
  if (
    activeArtifact.value === "pdf" &&
    (!pdfFrame.value || pdfLoadedUrl.value !== state.pdfDataUrl)
  ) {
    return;
  }
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...current,
      renderedVersion: current.version
    }
  });
}

const handlePdfLoaded = () => {
  pdfLoadedUrl.value = state.pdfDataUrl;
  void markRendered(state.version);
};

const refreshNetSuiteContext = async (
  recordType = state.recordType
): Promise<void> => {
  if (!recordType || contextLoading.value) return;
  contextLoading.value = true;
  contextError.value = "";
  try {
    const typeResponse = await callApi(RequestRoutes.GET_ALL_RECORD_TYPES);
    const typeRows = normalizeRows(typeResponse);
    const typeLabels: Record<string, string> = {};
    const typeIds = new Set<string>([recordType]);
    for (const row of typeRows) {
      const id = String(row.id ?? row.ID ?? row.scriptId ?? "")
        .trim()
        .toLowerCase();
      if (!id) continue;
      typeIds.add(id);
      typeLabels[id] = String(row.name ?? row.Name ?? row.label ?? id);
    }

    let rows: Record<string, unknown>[] = [];
    let lastError = "";
    for (const sql of recordQueries(recordType)) {
      try {
        const response = await callApi(
          RequestRoutes.RUN_SUITEQL_QUERY,
          { sql, limit: 100 },
          ApiRequestType.NORMAL
        );
        rows = normalizeRows(response);
        if (rows.length || sql.startsWith("SELECT id FROM")) break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    const recordLabels: Record<string, string> = {};
    const recordIds: string[] = [];
    for (const row of rows) {
      const id = String(row.id ?? row.ID ?? "").trim();
      if (!id) continue;
      recordIds.push(id);
      recordLabels[id] = rowLabel(row);
    }
    if (state.recordId && !recordIds.includes(state.recordId)) {
      recordIds.unshift(state.recordId);
    }
    await persistPatch({
      recordTypeOptions: [...typeIds].sort((a, b) => a.localeCompare(b)),
      recordTypeLabels: typeLabels,
      recordIdOptions: recordIds,
      recordIdLabels: recordLabels
    });
    if (!recordIds.length && lastError) contextError.value = lastError;
  } catch (error) {
    contextError.value =
      error instanceof Error ? error.message : "Could not refresh NetSuite data.";
  } finally {
    contextLoading.value = false;
  }
};

const changeRecordType = async (value: string | number | null) => {
  const recordType = String(value || "");
  if (!recordType || recordType === state.recordType) return;
  await persistPatch({ recordType, recordId: "" });
  await refreshNetSuiteContext(recordType);
};

const changeRecordId = async (value: string | number | null) => {
  await persistPatch({ recordId: String(value || "") });
};

const handleRecordIdInput = (event: Event) => {
  void changeRecordId((event.target as HTMLInputElement).value);
};

const sendFixes = async () => {
  const feedback = state.feedback.trim();
  if (!feedback || busy.value) return;
  busy.value = true;
  try {
    const comment: ReviewComment = {
      id: `request_${Date.now().toString(36)}`,
      initials: "ME",
      name: "You",
      time: new Date().toLocaleString(),
      text: feedback,
      isYou: true
    };
    await persistPatch({
      feedback,
      comments: [comment, ...state.comments],
      status: isFreemarkerStage.value
        ? "freemarker_changes_requested"
        : "html_changes_requested"
    });
  } finally {
    busy.value = false;
  }
};

const approve = async () => {
  if (!canApprove.value) return;
  busy.value = true;
  try {
    await persistPatch({
      feedback: "",
      status: isFreemarkerStage.value
        ? "freemarker_approved"
        : "html_approved"
    });
    if (!isFreemarkerStage.value) activeArtifact.value = "freemarker";
  } finally {
    busy.value = false;
  }
};

const endReview = async () => {
  if (busy.value) return;
  busy.value = true;
  try {
    await persistPatch({ status: "done", feedback: "" });
    window.close();
  } finally {
    busy.value = false;
  }
};

const addReference = () => referenceInput.value?.click();
const handleReferenceFile = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => {
    const value = typeof reader.result === "string" ? reader.result : "";
    if (value) {
      void persistPatch({
        referenceImageDataUrl: value,
        referenceImageUrl: ""
      });
    }
  };
  reader.readAsDataURL(file);
};

const storageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
) => {
  if (areaName !== "local") return;
  const next = changes[STORAGE_KEY]?.newValue as ReviewState | undefined;
  if (next?.reviewId === requestedReviewId) void applyIncomingState(next);
};

watch(
  () => state.status,
  (status) => {
    if (status === "freemarker_review") {
      activeArtifact.value = state.pdfDataUrl ? "pdf" : "freemarker";
    }
  }
);

onMounted(async () => {
  document.title = "Magic NetSuite · Template Review";
  chrome.storage.onChanged.addListener(storageListener);
  const initial = await currentStoredState();
  if (!initial || initial.reviewId !== requestedReviewId) {
    loadError.value =
      "This template review could not be recovered. Start the review again from the agent.";
    loading.value = false;
    return;
  }
  await applyIncomingState(initial);
  loading.value = false;
  if (pendingStatuses.has(initial.status)) {
    void refreshNetSuiteContext(initial.recordType);
  }
});

onBeforeUnmount(() => {
  chrome.storage.onChanged.removeListener(storageListener);
});
</script>

<template>
  <div class="review-shell">
    <div v-if="loading" class="review-centered">
      <i class="pi pi-spin pi-spinner"></i>
      <span>Restoring template review…</span>
    </div>

    <div v-else-if="loadError" class="review-centered review-error">
      <i class="pi pi-exclamation-triangle"></i>
      <strong>Review unavailable</strong>
      <span>{{ loadError }}</span>
    </div>

    <template v-else>
      <header class="review-header">
        <div class="review-brand">
          <img :src="extensionIconUrl" alt="" />
          <div>
            <strong :title="state.title">{{ state.title }}</strong>
            <span :title="state.templateFile">{{ state.templateFile }}</span>
          </div>
        </div>

        <div class="review-context">
          <label>
            <span>Record type</span>
            <MSelect
              :model-value="state.recordType"
              :options="recordTypeOptions"
              option-label="label"
              option-value="value"
              size="small"
              searchable
              :loading="contextLoading"
              @update:model-value="changeRecordType"
            />
          </label>
          <label>
            <span>Record</span>
            <MSelect
              v-if="recordIdOptions.length || contextLoading"
              :model-value="state.recordId"
              :options="recordIdOptions"
              option-label="label"
              option-value="value"
              placeholder="Select a record"
              size="small"
              searchable
              :loading="contextLoading"
              @update:model-value="changeRecordId"
            />
            <input
              v-else
              class="record-id-input"
              type="text"
              :value="state.recordId"
              placeholder="Enter record ID"
              @change="handleRecordIdInput"
            />
          </label>
          <button
            class="icon-button"
            type="button"
            title="Refresh NetSuite records"
            :disabled="contextLoading"
            @click="refreshNetSuiteContext()"
          >
            <i :class="['pi', contextLoading ? 'pi-spin pi-spinner' : 'pi-refresh']"></i>
          </button>
        </div>

        <div class="review-header-actions">
          <span class="status-pill" :class="`status-${state.status}`">
            {{ statusLabel }}
          </span>
          <button class="quiet-button" type="button" :disabled="busy" @click="endReview">
            End review
          </button>
        </div>
      </header>

      <p v-if="contextError" class="context-error" :title="contextError">
        <i class="pi pi-exclamation-circle"></i>
        {{ contextError }}
      </p>

      <main class="review-workspace">
        <section class="reference-pane">
          <div class="pane-header">
            <div>
              <strong>Reference</strong>
              <span>Original design</span>
            </div>
            <button class="icon-button" type="button" title="Replace reference image" @click="addReference">
              <i class="pi pi-image"></i>
            </button>
            <input
              ref="referenceInput"
              class="hidden-input"
              type="file"
              accept="image/*"
              @change="handleReferenceFile"
            />
          </div>
          <div class="reference-stage">
            <img
              v-if="referenceSrc"
              ref="referenceImage"
              :src="referenceSrc"
              alt="Template reference"
              @load="markRendered()"
            />
            <div v-else class="empty-pane">
              <i class="pi pi-image"></i>
              <strong>No reference image</strong>
              <button class="quiet-button" type="button" @click="addReference">
                Add image
              </button>
            </div>
          </div>
        </section>

        <section class="artifact-pane">
          <div class="artifact-tabs">
            <button
              type="button"
              :class="{ active: activeArtifact === 'html' }"
              @click="activeArtifact = 'html'"
            >
              HTML
            </button>
            <button
              type="button"
              :class="{ active: activeArtifact === 'freemarker' }"
              :disabled="!state.freemarker && state.status === 'html_review'"
              @click="activeArtifact = 'freemarker'"
            >
              FreeMarker
            </button>
            <button
              type="button"
              :class="{ active: activeArtifact === 'pdf' }"
              :disabled="!state.pdfDataUrl"
              @click="activeArtifact = 'pdf'"
            >
              NetSuite PDF
            </button>
          </div>

          <div class="artifact-stage">
            <iframe
              v-if="activeArtifact === 'html'"
              ref="htmlFrame"
              id="templateReviewHtmlFrame"
              class="html-frame"
              sandbox="allow-same-origin"
              :srcdoc="state.html"
              title="HTML template preview"
              @load="markRendered()"
            />
            <pre
              v-else-if="activeArtifact === 'freemarker' && state.freemarker"
              class="code-preview"
            ><code>{{ state.freemarker }}</code></pre>
            <div v-else-if="activeArtifact === 'freemarker'" class="empty-pane">
              <i :class="['pi', state.status === 'converting' ? 'pi-spin pi-spinner' : 'pi-lock']"></i>
              <strong>
                {{ state.status === "converting" ? "Converting with NetSuite…" : "FreeMarker is not generated yet" }}
              </strong>
              <span>Approve the HTML design to continue.</span>
            </div>
            <iframe
              v-else-if="state.pdfDataUrl"
              ref="pdfFrame"
              id="templateReviewPdfFrame"
              class="pdf-frame"
              :src="state.pdfDataUrl"
              title="NetSuite PDF preview"
              @load="handlePdfLoaded"
            />
            <div v-else class="empty-pane">
              <i class="pi pi-file-pdf"></i>
              <strong>No PDF preview yet</strong>
            </div>
          </div>

          <div v-if="state.renderError" class="render-error">
            <i class="pi pi-exclamation-triangle"></i>
            <span>{{ state.renderError }}</span>
          </div>
        </section>

        <aside class="feedback-pane">
          <div class="pane-header">
            <div>
              <strong>Review</strong>
              <span>Approval and feedback</span>
            </div>
          </div>

          <div class="review-summary">
            <span class="summary-icon">
              <i :class="['pi', isWaitingForAgent ? 'pi-clock' : 'pi-comments']"></i>
            </span>
            <div>
              <strong>{{ statusLabel }}</strong>
              <span v-if="isWaitingForAgent">The agent is applying your requested changes.</span>
              <span v-else>Compare the rendered output with the reference.</span>
            </div>
          </div>

          <label class="feedback-field">
            <span>Requested changes</span>
            <textarea
              v-model="state.feedback"
              :disabled="busy || isWaitingForAgent || state.status === 'done'"
              placeholder="Describe what should change…"
              @keydown.ctrl.enter.prevent="sendFixes"
            ></textarea>
          </label>

          <div class="feedback-actions">
            <button
              class="secondary-button"
              type="button"
              :disabled="busy || isWaitingForAgent || !state.feedback.trim()"
              @click="sendFixes"
            >
              <i class="pi pi-send"></i>
              Send fixes
            </button>
            <button
              class="primary-button"
              type="button"
              :disabled="!canApprove"
              :title="!state.recordId ? 'Select a NetSuite record before approval' : 'Approve current stage'"
              @click="approve"
            >
              <i :class="['pi', busy ? 'pi-spin pi-spinner' : 'pi-check']"></i>
              {{ isFreemarkerStage ? "Final approve" : "Approve HTML" }}
            </button>
          </div>

          <div class="history">
            <strong>History</strong>
            <div v-if="!state.comments.length" class="history-empty">
              No feedback submitted yet.
            </div>
            <article v-for="comment in state.comments" :key="comment.id || `${comment.time}-${comment.text}`">
              <span class="avatar">{{ comment.initials }}</span>
              <div>
                <header>
                  <strong>{{ comment.name }}</strong>
                  <time>{{ comment.time }}</time>
                </header>
                <p>{{ comment.text }}</p>
              </div>
            </article>
          </div>
        </aside>
      </main>
    </template>
  </div>
</template>

<style scoped>
.review-shell {
  --review-accent: #4f46e5;
  --review-accent-border: #a5b4fc;
  --review-accent-surface: #f1f4fe;
  width: 100%;
  height: 100vh;
  min-height: 620px;
  overflow: hidden;
  background: #e9eef5;
  color: var(--p-slate-700);
}

.review-centered {
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  color: var(--p-slate-500);
}

.review-centered > i {
  color: var(--review-accent);
  font-size: 1.35rem;
}

.review-error {
  text-align: center;
}

.review-error span {
  max-width: 36rem;
}

.review-header {
  display: grid;
  height: 56px;
  grid-template-columns: minmax(220px, 1fr) minmax(430px, 1.4fr) minmax(280px, 1fr);
  align-items: center;
  gap: 0.75rem;
  border-bottom: 1px solid var(--p-slate-300);
  background: #ffffff;
  padding: 0.45rem 0.7rem;
}

.review-brand,
.review-header-actions,
.review-context {
  display: flex;
  min-width: 0;
  align-items: center;
}

.review-brand {
  gap: 0.55rem;
}

.review-brand img {
  width: 28px;
  height: 28px;
}

.review-brand div,
.pane-header div,
.review-summary div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.review-brand strong,
.review-brand span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-brand strong {
  color: var(--p-slate-800);
  font-size: 0.82rem;
}

.review-brand span,
.pane-header span,
.review-summary span {
  color: var(--p-slate-500);
  font-size: 0.68rem;
}

.review-context {
  justify-content: center;
  gap: 0.4rem;
}

.review-context label {
  display: grid;
  min-width: 0;
  flex: 1;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.35rem;
}

.review-context label > span {
  color: var(--p-slate-500);
  font-size: 0.66rem;
  white-space: nowrap;
}

.record-id-input {
  width: 100%;
  min-width: 0;
  min-height: 1.9rem;
  border: 1px solid var(--p-slate-300);
  border-radius: 5px;
  background: #ffffff;
  color: var(--p-slate-800);
  font: inherit;
  font-size: 0.72rem;
  outline: none;
  padding: 0.3rem 0.5rem;
}

.record-id-input:focus {
  border-color: var(--review-accent-border);
  box-shadow: 0 0 0 2px var(--review-accent-surface);
}

.review-header-actions {
  justify-content: flex-end;
  gap: 0.45rem;
}

.status-pill {
  max-width: 180px;
  overflow: hidden;
  border: 1px solid var(--p-slate-300);
  border-radius: 999px;
  background: var(--p-slate-100);
  color: var(--p-slate-600);
  font-size: 0.65rem;
  font-weight: 700;
  padding: 0.25rem 0.55rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-html_review,
.status-freemarker_review {
  border-color: var(--review-accent-border);
  background: var(--review-accent-surface);
  color: var(--review-accent);
}

.status-html_changes_requested,
.status-freemarker_changes_requested,
.status-converting {
  border-color: #fcd34d;
  background: #fffbeb;
  color: #92400e;
}

.status-freemarker_approved,
.status-done {
  border-color: #86efac;
  background: #f0fdf4;
  color: #166534;
}

.status-render_error {
  border-color: #fca5a5;
  background: #fef2f2;
  color: #b91c1c;
}

.context-error {
  display: flex;
  height: 28px;
  align-items: center;
  gap: 0.4rem;
  overflow: hidden;
  border-bottom: 1px solid #fcd34d;
  background: #fffbeb;
  color: #92400e;
  font-size: 0.67rem;
  padding: 0 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.review-workspace {
  display: grid;
  height: calc(100vh - 56px);
  min-height: 0;
  grid-template-columns: minmax(260px, 0.82fr) minmax(460px, 1.8fr) minmax(280px, 0.9fr);
  gap: 1px;
  background: var(--p-slate-300);
}

.context-error + .review-workspace {
  height: calc(100vh - 84px);
}

.reference-pane,
.artifact-pane,
.feedback-pane {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: #ffffff;
}

.pane-header {
  display: flex;
  height: 42px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-bottom: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  padding: 0.35rem 0.55rem;
}

.pane-header strong,
.history > strong {
  color: var(--p-slate-800);
  font-size: 0.72rem;
}

.reference-stage,
.artifact-stage {
  display: flex;
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
  overflow: auto;
  background: #e9eef5;
  padding: 0.7rem;
}

.reference-stage img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.15);
}

.artifact-tabs {
  display: flex;
  height: 42px;
  flex-shrink: 0;
  align-items: end;
  gap: 0.15rem;
  border-bottom: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  padding: 0 0.45rem;
}

.artifact-tabs button {
  height: 34px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 5px 5px 0 0;
  background: transparent;
  color: var(--p-slate-500);
  cursor: pointer;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 0 0.7rem;
  white-space: nowrap;
}

.artifact-tabs button.active {
  border-color: var(--review-accent-border);
  background: var(--review-accent-surface);
  color: var(--review-accent);
}

.artifact-tabs button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.html-frame {
  display: block;
  width: min(816px, 100%);
  height: min(1056px, 100%);
  flex: 0 0 auto;
  border: 0;
  background: #ffffff;
  box-shadow: 0 2px 12px rgba(15, 23, 42, 0.18);
}

.pdf-frame {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #ffffff;
}

.code-preview {
  width: 100%;
  height: 100%;
  overflow: auto;
  background: #ffffff;
  color: var(--p-slate-800);
  font: 0.72rem/1.55 "JetBrains Mono", monospace;
  padding: 0.9rem;
  white-space: pre;
}

.empty-pane {
  display: flex;
  min-height: 160px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  color: var(--p-slate-500);
  text-align: center;
}

.empty-pane > i {
  color: var(--p-slate-400);
  font-size: 1.5rem;
}

.empty-pane strong {
  color: var(--p-slate-700);
  font-size: 0.76rem;
}

.empty-pane span {
  font-size: 0.67rem;
}

.render-error {
  display: flex;
  flex-shrink: 0;
  align-items: flex-start;
  gap: 0.45rem;
  border-top: 1px solid #fca5a5;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 0.68rem;
  line-height: 1.4;
  padding: 0.55rem 0.65rem;
}

.feedback-pane {
  padding-bottom: 0.5rem;
}

.review-summary {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.55rem;
  margin: 0.55rem;
  border: 1px solid var(--review-accent-border);
  border-radius: 6px;
  background: var(--review-accent-surface);
  padding: 0.5rem;
}

.summary-icon {
  display: inline-flex;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: #e0e7ff;
  color: var(--review-accent);
}

.review-summary strong {
  color: var(--p-slate-800);
  font-size: 0.7rem;
}

.feedback-field {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0 0.55rem;
}

.feedback-field > span {
  color: var(--p-slate-600);
  font-size: 0.68rem;
  font-weight: 700;
}

.feedback-field textarea {
  width: 100%;
  min-height: 105px;
  resize: vertical;
  border: 1px solid var(--p-slate-300);
  border-radius: 5px;
  background: #ffffff;
  color: var(--p-slate-800);
  font: inherit;
  font-size: 0.7rem;
  line-height: 1.45;
  outline: none;
  padding: 0.5rem;
}

.feedback-field textarea:focus {
  border-color: var(--review-accent-border);
  box-shadow: 0 0 0 2px var(--review-accent-surface);
}

.feedback-actions {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
  padding: 0.45rem 0.55rem 0.6rem;
}

.primary-button,
.secondary-button,
.quiet-button,
.icon-button {
  display: inline-flex;
  min-height: 1.9rem;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px solid var(--p-slate-300);
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.3rem 0.55rem;
  white-space: nowrap;
}

.primary-button {
  border-color: var(--review-accent);
  background: var(--review-accent);
  color: #ffffff;
}

.secondary-button,
.quiet-button,
.icon-button {
  background: #ffffff;
  color: var(--p-slate-600);
}

.secondary-button:hover:not(:disabled),
.quiet-button:hover:not(:disabled),
.icon-button:hover:not(:disabled) {
  border-color: var(--review-accent-border);
  background: var(--review-accent-surface);
  color: var(--review-accent);
}

.primary-button:disabled,
.secondary-button:disabled,
.quiet-button:disabled,
.icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.icon-button {
  width: 1.9rem;
  flex: 0 0 1.9rem;
  padding: 0;
}

.history {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 0.45rem;
  overflow: auto;
  border-top: 1px solid var(--p-slate-200);
  padding: 0.55rem;
}

.history-empty {
  color: var(--p-slate-400);
  font-size: 0.67rem;
}

.history article {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: 0.45rem;
}

.avatar {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: #e0e7ff;
  color: var(--review-accent);
  font-size: 0.6rem;
  font-weight: 800;
}

.history article header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.4rem;
}

.history article strong {
  color: var(--p-slate-700);
  font-size: 0.67rem;
}

.history article time {
  color: var(--p-slate-400);
  font-size: 0.56rem;
  white-space: nowrap;
}

.history article p {
  margin-top: 0.12rem;
  color: var(--p-slate-600);
  font-size: 0.66rem;
  line-height: 1.42;
  overflow-wrap: anywhere;
}

.hidden-input {
  display: none;
}

@media (max-width: 1050px) {
  .review-header {
    grid-template-columns: minmax(200px, 0.8fr) minmax(400px, 1.5fr) auto;
  }

  .review-workspace {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.55fr);
  }

  .feedback-pane {
    position: absolute;
    top: 56px;
    right: 0;
    bottom: 0;
    width: 300px;
    border-left: 1px solid var(--p-slate-300);
    box-shadow: -4px 0 14px rgba(15, 23, 42, 0.1);
  }
}
</style>
