<template>
  <div class="review-app">
    <header class="topbar">
      <div class="title-block">
        <span class="title-icon"><FileCode2 :size="18" /></span>
        <div>
          <strong>{{ state.title || "Template Flow" }}</strong>
          <span :title="state.templateFile">{{ state.templateFile || "invoice_template.ftl" }}</span>
        </div>
      </div>

      <div class="context-controls">
        <label>
          <span>Record type</span>
          <CustomSelect :model-value="state.recordType" :options="recordTypeOptions" placeholder="Record type" @update:model-value="selectRecordType" />
        </label>
        <label>
          <span>Record ID</span>
          <CustomSelect id-prefix="recordId" :model-value="state.recordId" :options="recordIdOptions" :placeholder="recordOptionsLoading ? 'Loading records…' : 'Enter or select ID'" editable @update:model-value="selectRecordId" />
        </label>
      </div>

      <div class="topbar-status">
        <span class="status-chip" :class="statusTone"><component :is="statusIcon" :size="13" />{{ statusLabel }}</span>
        <span class="updated">Updated {{ formattedUpdatedAt }}</span>
        <button class="icon-button" type="button" title="End and close review" aria-label="End and close review" @click="endReview"><X :size="15" /></button>
      </div>
    </header>

    <nav class="workflow" aria-label="Template workflow">
      <button
        v-for="step in workflowSteps"
        :key="step.id"
        type="button"
        class="workflow-step"
        :class="{ active: selectedStep === step.id, complete: step.complete, available: step.available }"
        :disabled="!step.available"
        @click="selectStep(step.id)"
      >
        <span class="step-icon"><component :is="step.icon" :size="15" /></span>
        <span class="step-copy"><strong>{{ step.label }}</strong><small>{{ step.detail }}</small></span>
        <Check v-if="step.complete" class="step-check" :size="14" />
        <ChevronRight v-else class="step-arrow" :size="14" />
      </button>
    </nav>

    <main class="workspace">
      <section class="reference-panel">
        <header class="panel-header">
          <div><ImageIcon :size="15" /><strong>Source reference</strong><span>Original design</span></div>
          <span class="panel-actions">
            <span v-if="referenceSrc" class="zoom-tools">
              <button class="icon-button" type="button" title="Zoom reference out" @click="changeReferenceZoom(-0.1)"><ZoomOut :size="14" /></button>
              <button class="zoom-value" type="button" title="Fit reference" @click="fitReference">{{ Math.round(referenceScale * 100) }}%</button>
              <button class="icon-button" type="button" title="Zoom reference in" @click="changeReferenceZoom(0.1)"><ZoomIn :size="14" /></button>
              <button class="icon-button" type="button" title="Pan reference" :class="{ active: referencePanMode }" @click="referencePanMode = !referencePanMode"><Hand :size="14" /></button>
            </span>
            <button class="icon-button" type="button" title="Choose reference image" @click="referenceFileInput?.click()"><ImagePlus :size="15" /></button>
            <button class="icon-button" type="button" title="Open reference at full size" :disabled="!referenceSrc" @click="referenceModal = true"><Maximize2 :size="15" /></button>
          </span>
        </header>
        <div ref="referenceViewport" class="reference-canvas" :class="{ 'pan-mode': referencePanMode, panning: isReferencePanning }" id="referenceArtifact" tabindex="0" @wheel.prevent="zoomReferenceWheel" @pointerdown="beginReferencePan" @pointermove="moveReferencePan" @pointerup="endReferencePan" @pointercancel="endReferencePan" @dragover.prevent @drop.prevent="handleReferenceDrop" @paste="handleReferencePaste">
          <div v-if="referenceSrc && !referenceLoadFailed" class="reference-image-holder" :style="referenceHolderStyle">
            <img id="referenceImage" :src="referenceSrc" alt="Source template reference" @load="handleReferenceLoad" @error="referenceLoadFailed = true" />
          </div>
          <div v-else class="empty-state">
            <ImageOff :size="30" />
            <strong>{{ referenceSrc ? "Reference image could not be loaded" : "Reference image missing" }}</strong>
            <p>{{ referenceSrc ? "Choose the image again." : "Drop, paste, or choose the source image." }}</p>
            <button class="choose-reference" type="button" @click="referenceFileInput?.click()"><ImagePlus :size="14" />Choose image</button>
          </div>
          <input ref="referenceFileInput" class="visually-hidden" type="file" accept="image/*" @change="handleReferenceInput" />
        </div>
      </section>

      <section class="artifact-panel">
        <header class="artifact-tabs" role="tablist" aria-label="Generated artifacts">
          <button type="button" :class="{ active: activeView === 'html' }" @click="selectArtifactView('html')">
            <Monitor :size="14" />HTML preview
          </button>
          <button type="button" :disabled="!state.freemarker && !isConverting" :class="{ active: activeView === 'freemarker' }" @click="selectArtifactView('freemarker')">
            <Braces :size="14" />FreeMarker
          </button>
          <button type="button" :disabled="!state.pdfDataUrl" :class="{ active: activeView === 'pdf' }" @click="selectArtifactView('pdf')">
            <Printer :size="14" />NetSuite PDF
          </button>
          <span class="artifact-spacer" />
          <span v-if="activeView === 'html'" class="zoom-tools">
            <button class="icon-button" type="button" title="Zoom out" @click="changeHtmlZoom(-0.1)"><ZoomOut :size="14" /></button>
            <button class="zoom-value" type="button" title="Fit page" @click="fitHtmlPage">{{ Math.round(paperScale * 100) }}%</button>
            <button class="icon-button" type="button" title="Zoom in" @click="changeHtmlZoom(0.1)"><ZoomIn :size="14" /></button>
            <button class="icon-button" type="button" title="Pan page" :class="{ active: panMode }" @click="panMode = !panMode"><Hand :size="14" /></button>
          </span>
          <button class="icon-button tab-action" type="button" title="Open current artifact" @click="artifactModal = true">
            <Maximize2 :size="14" />
          </button>
        </header>

        <div class="artifact-stage">
          <div v-show="activeView === 'html'" class="page-stage" id="htmlArtifact">
            <div ref="htmlViewport" class="page-viewport" :class="{ 'pan-mode': panMode, panning: isPanning }" @wheel.prevent="zoomHtmlWheel" @pointerdown="beginPan" @pointermove="movePan" @pointerup="endPan" @pointercancel="endPan">
              <div class="page-canvas">
                <div class="paper-holder" :style="paperHolderStyle">
                  <div class="paper-scale" :style="paperScaleStyle">
                    <iframe ref="htmlFrame" id="htmlFrame" sandbox="allow-same-origin" :srcdoc="state.html" @load="fitHtmlPage" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-show="activeView === 'freemarker'" class="code-stage">
            <div v-if="isConverting" class="empty-state converting">
              <LoaderCircle class="spin" :size="30" />
              <strong>Generating FreeMarker</strong>
              <p>Applying BFO-safe conversion rules and preparing the NetSuite print render.</p>
            </div>
            <template v-else-if="state.freemarker">
              <div class="code-toolbar">
                <span><FileJson2 :size="14" />{{ state.templateFile }}</span>
                <button type="button" @click="copyFreemarker"><Copy :size="14" />Copy</button>
              </div>
              <pre id="freemarkerArtifact"><code>{{ state.freemarker }}</code></pre>
            </template>
            <div v-else class="empty-state"><LockKeyhole :size="28" /><strong>FreeMarker is not generated yet</strong><p>Approve the HTML design to continue.</p></div>
          </div>

          <div v-show="activeView === 'pdf'" class="pdf-stage" id="pdfArtifact">
            <iframe v-if="state.pdfDataUrl" id="pdfFrame" :src="state.pdfDataUrl" title="NetSuite PDF preview" />
            <div v-else class="empty-state"><FileWarning :size="30" /><strong>No PDF preview yet</strong><p>{{ state.renderError || "Approve HTML and select a NetSuite record to render." }}</p></div>
          </div>

          <div v-if="state.renderError" class="render-error"><CircleAlert :size="15" /><span>{{ state.renderError }}</span></div>
        </div>
      </section>

      <aside class="history-panel">
        <header><span><History :size="15" /><strong>Review history</strong></span><span class="history-count">{{ comments.length }}</span></header>
        <div class="history-list">
          <section v-for="(thread, index) in historyThreads" :key="thread.root.id || `${thread.root.time}-${index}`" class="history-thread">
            <article class="history-request">
              <span class="avatar" :class="{ ai: !thread.root.isYou }">{{ thread.root.initials || "ME" }}</span>
              <div><strong>{{ thread.root.name || "You" }}</strong><time>{{ thread.root.time }}</time><p>{{ thread.root.text }}</p></div>
            </article>
            <article v-for="reply in thread.replies" :key="reply.id || reply.time" class="history-response">
              <span class="avatar ai">{{ reply.initials || "AI" }}</span>
              <div><strong>{{ reply.name || "Magic AI" }}</strong><time>{{ reply.time }}</time><p>{{ reply.text }}</p></div>
            </article>
          </section>
          <div v-if="!comments.length" class="history-empty"><MessageSquareText :size="22" /><span>No feedback submitted yet.</span></div>
        </div>
      </aside>
    </main>

    <footer class="review-bar">
      <div class="review-copy">
        <span class="stage-label"><component :is="reviewStageIcon" :size="14" />{{ reviewStageLabel }}</span>
        <div class="composer">
          <textarea ref="feedbackEl" v-model="state.feedback" :placeholder="feedbackPlaceholder" :disabled="isWaitingForAgent" @keydown="handleComposerKeydown" />
          <div v-if="isWaitingForAgent" class="composer-waiting"><LoaderCircle class="spin" :size="15" /><span>Fixes submitted. Waiting for the agent to update the {{ isFreemarkerStage ? "FreeMarker/PDF" : "HTML" }} preview…</span></div>
          <div class="composer-toolbar">
            <span>
              <button type="button" title="Bulleted list" @click="insertFeedback('- ')"><List :size="15" /></button>
              <button type="button" title="To-do list" @click="insertFeedback('- [ ] ')"><ListChecks :size="15" /></button>
            </span>
            <button class="composer-send" type="button" title="Send fixes (Enter)" :disabled="!state.feedback.trim() || isWaitingForAgent" @click="sendFixes"><ArrowUp :size="16" /></button>
          </div>
        </div>
      </div>
      <div class="approval-row">
        <button class="button primary" type="button" :disabled="!canApprove" @click="approveCurrentStage">
          <LoaderCircle v-if="isConverting" class="spin" :size="15" />
          <BadgeCheck v-else :size="15" />
          {{ approveLabel }}
        </button>
      </div>
    </footer>

    <div v-if="referenceModal" class="modal" @keydown.esc="referenceModal = false">
      <button class="modal-backdrop" type="button" aria-label="Close" @click="referenceModal = false" />
      <section class="modal-dialog"><header><strong>Source reference</strong><button class="icon-button" type="button" @click="referenceModal = false"><X :size="16" /></button></header><div><img :src="referenceSrc" alt="Source template reference" /></div></section>
    </div>

    <div v-if="artifactModal" class="modal" @keydown.esc="artifactModal = false">
      <button class="modal-backdrop" type="button" aria-label="Close" @click="artifactModal = false" />
      <section class="modal-dialog artifact-dialog"><header><strong>{{ activeArtifactLabel }}</strong><button class="icon-button" type="button" @click="artifactModal = false"><X :size="16" /></button></header><div class="modal-artifact">
        <iframe v-if="activeView === 'html'" sandbox="allow-same-origin" :srcdoc="state.html" />
        <pre v-else-if="activeView === 'freemarker'"><code>{{ state.freemarker }}</code></pre>
        <iframe v-else :src="state.pdfDataUrl" />
      </div></section>
    </div>

    <div class="toast" :class="{ show: toast }"><CircleCheck :size="15" />{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import {
  ArrowUp, BadgeCheck, Braces, Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Copy,
  FileCode2, FileJson2, FileWarning, History, Image as ImageIcon, ImageOff, LoaderCircle,
  Hand, ImagePlus, List, ListChecks, LockKeyhole, Maximize2, MessageSquareText, Monitor, Printer, X, ZoomIn, ZoomOut,
} from "@lucide/vue";

type ReviewStatus = "html_review" | "html_changes_requested" | "html_approved" | "converting" | "freemarker_review" | "freemarker_changes_requested" | "freemarker_approved" | "render_error" | "done";
type ReviewComment = { id?: string; parentId?: string; initials: string; name: string; time: string; text: string; color?: string; isYou?: boolean };
type ReviewState = {
  reviewId: string; title: string; templateFile: string; recordType: string; recordId: string;
  recordTypeOptions: string[]; recordIdOptions: string[]; recordTypeLabels: Record<string, string>; recordIdLabels: Record<string, string>; html: string; freemarker: string;
  pdfDataUrl: string; renderError: string; sessionId: string; referenceImageDataUrl: string;
  referenceImageUrl: string; feedback: string; comments: ReviewComment[]; status: ReviewStatus;
  version: number; updatedAt: string;
};
type SelectOption = { value: string; label: string };
type ArtifactView = "html" | "freemarker" | "pdf";
type WorkflowStage = "reference" | "html" | "freemarker" | "pdf" | "final";

declare global {
  interface Window {
    __MAGIC_TEMPLATE_REVIEW_INITIAL__?: Partial<ReviewState>;
    __magicTemplateReviewSet?: (value: Partial<ReviewState>) => void;
    __magicTemplateReviewGet?: () => ReviewState;
    __magicTemplateReviewAction?: (value: Record<string, unknown>) => Promise<Record<string, unknown> | void>;
  }
}

const CustomSelect = defineComponent({
  props: { modelValue: { type: String, default: "" }, options: { type: Array as () => SelectOption[], default: () => [] }, placeholder: { type: String, default: "Select" }, idPrefix: { type: String, default: "recordType" }, editable: { type: Boolean, default: false } },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const open = ref(false);
    const root = ref<HTMLElement | null>(null);
    const label = computed(() => props.options.find((option) => option.value === props.modelValue)?.label || props.placeholder);
    const closeOutside = (event: PointerEvent) => { if (root.value && !root.value.contains(event.target as Node)) open.value = false; };
    onMounted(() => document.addEventListener("pointerdown", closeOutside));
    onBeforeUnmount(() => document.removeEventListener("pointerdown", closeOutside));
    return () => h("div", { ref: root, class: ["review-select", { open: open.value }] }, [
      props.editable
        ? h("div", { class: "review-select-editable" }, [
            h("input", { value: props.modelValue, placeholder: props.placeholder, title: props.modelValue, onFocus: () => { open.value = true; }, onInput: (event: Event) => emit("update:modelValue", (event.target as HTMLInputElement).value) }),
            h("button", { type: "button", title: "Show record IDs", onClick: () => { open.value = !open.value; } }, [h(ChevronDown, { size: 14 })]),
          ])
        : h("button", { type: "button", class: "review-select-trigger", title: label.value, "aria-expanded": open.value, onClick: () => { open.value = !open.value; }, onKeydown: (event: KeyboardEvent) => { if (event.key === "Escape") open.value = false; } }, [h("span", label.value), h(ChevronDown, { size: 14 })]),
      h("div", { class: "review-select-menu", role: "listbox" }, props.options.map((option) => h("button", { type: "button", role: "option", title: option.label, "aria-selected": option.value === props.modelValue, onClick: () => { emit("update:modelValue", option.value); open.value = false; } }, option.label))),
    ]);
  },
});

const defaults = (): ReviewState => ({
  reviewId: "", title: "Template Flow", templateFile: "invoice_template.ftl", recordType: "invoice", recordId: "",
  recordTypeOptions: ["invoice"], recordIdOptions: [], recordTypeLabels: { invoice: "Invoice" }, recordIdLabels: {}, html: "", freemarker: "", pdfDataUrl: "", renderError: "", sessionId: "",
  referenceImageDataUrl: "", referenceImageUrl: "", feedback: "", comments: [], status: "html_review", version: 0, updatedAt: new Date().toISOString(),
});
const initial = { ...defaults(), ...(window.__MAGIC_TEMPLATE_REVIEW_INITIAL__ || {}) };
const state = reactive<ReviewState>({ ...initial, comments: Array.isArray(initial.comments) ? initial.comments : [], recordTypeOptions: initial.recordTypeOptions || ["invoice"], recordIdOptions: initial.recordIdOptions || [] });

const activeView = ref<ArtifactView>(state.pdfDataUrl ? "pdf" : state.freemarker || state.status === "converting" ? "freemarker" : "html");
const htmlFrame = ref<HTMLIFrameElement | null>(null);
const htmlViewport = ref<HTMLDivElement | null>(null);
const referenceViewport = ref<HTMLDivElement | null>(null);
const feedbackEl = ref<HTMLTextAreaElement | null>(null);
const referenceFileInput = ref<HTMLInputElement | null>(null);
const paperScale = ref(0.72);
const referenceScale = ref(1);
const referenceNaturalSize = reactive({ width: 0, height: 0 });
const panMode = ref(false);
const isPanning = ref(false);
const panOrigin = reactive({ x: 0, y: 0, left: 0, top: 0 });
const referencePanMode = ref(false);
const isReferencePanning = ref(false);
const referencePanOrigin = reactive({ x: 0, y: 0, left: 0, top: 0 });
const referenceModal = ref(false);
const referenceLoadFailed = ref(false);
const artifactModal = ref(false);
const recordOptionsLoading = ref(false);
const toast = ref("");
let toastTimer = 0;
let resizeObserver: ResizeObserver | null = null;
let referenceResizeObserver: ResizeObserver | null = null;

const referenceSrc = computed(() => state.referenceImageDataUrl || state.referenceImageUrl || "");
const comments = computed(() => state.comments || []);
const historyThreads = computed(() => {
  const all = comments.value;
  const childIds = new Set(all.map((comment) => comment.parentId).filter(Boolean));
  const roots = all.filter((comment) => !comment.parentId);
  return roots.map((root) => ({
    root,
    replies: root.id ? all.filter((comment) => comment.parentId === root.id) : [],
  })).filter((thread) => thread.root.isYou || !childIds.has(thread.root.id));
});
const isConverting = computed(() => state.status === "converting" || state.status === "html_approved");
const isWaitingForAgent = computed(() => state.status === "html_changes_requested" || state.status === "freemarker_changes_requested");
const isFreemarkerStage = computed(() => ["freemarker_review", "freemarker_changes_requested", "freemarker_approved", "render_error"].includes(state.status));
const currentStage = computed<WorkflowStage>(() => state.status === "freemarker_approved" || state.status === "done" ? "final" : state.pdfDataUrl ? "pdf" : isFreemarkerStage.value ? "freemarker" : isConverting.value ? "freemarker" : "html");
const selectedStep = ref<WorkflowStage>(activeView.value === "pdf" ? "pdf" : activeView.value === "freemarker" ? "freemarker" : "html");
const statusLabel = computed(() => ({ html_review: "HTML review", html_changes_requested: "HTML fixes", html_approved: "HTML approved", converting: "Generating FreeMarker", freemarker_review: "FreeMarker review", freemarker_changes_requested: "FreeMarker fixes", freemarker_approved: "Final approved", render_error: "Render needs attention", done: "Complete" }[state.status]));
const statusTone = computed(() => state.status.includes("changes") || state.status === "render_error" ? "warning" : state.status === "freemarker_approved" || state.status === "done" ? "success" : "active");
const statusIcon = computed(() => statusTone.value === "warning" ? CircleAlert : statusTone.value === "success" ? CircleCheck : isConverting.value ? LoaderCircle : Monitor);
const reviewStageIcon = computed(() => isFreemarkerStage.value ? Braces : Monitor);
const reviewStageLabel = computed(() => isFreemarkerStage.value ? "FreeMarker & PDF review" : "HTML design review");
const feedbackPlaceholder = computed(() => isFreemarkerStage.value ? "Describe FreeMarker or NetSuite PDF corrections…" : "Describe visual HTML corrections…");
const approveLabel = computed(() => isConverting.value ? "Generating…" : isFreemarkerStage.value ? "Approve final template" : "Approve HTML & generate FreeMarker");
const canApprove = computed(() => !isConverting.value && !isWaitingForAgent.value && (isFreemarkerStage.value ? Boolean(state.freemarker && state.pdfDataUrl && !state.renderError) : Boolean(state.html)));
const activeArtifactLabel = computed(() => activeView.value === "html" ? "Rendered HTML" : activeView.value === "freemarker" ? "FreeMarker source" : "NetSuite PDF");
const paperScaleStyle = computed(() => ({ transform: `scale(${paperScale.value})`, width: "816px", height: "1056px" }));
const paperHolderStyle = computed(() => ({ width: `${Math.round(816 * paperScale.value)}px`, height: `${Math.round(1056 * paperScale.value)}px` }));
const referenceHolderStyle = computed(() => ({
  width: `${Math.round(referenceNaturalSize.width * referenceScale.value)}px`,
  height: `${Math.round(referenceNaturalSize.height * referenceScale.value)}px`,
}));

const unique = (values: string[], current = "") => [...new Set([current, ...(values || [])].filter(Boolean))];
const recordTypeOptions = computed(() => unique(state.recordTypeOptions, state.recordType).map((value) => ({ value, label: state.recordTypeLabels?.[value] || ({ invoice: "Invoice", salesorder: "Sales Order", purchaseorder: "Purchase Order", creditmemo: "Credit Memo" } as Record<string, string>)[value.toLowerCase()] || value })));
const recordIdOptions = computed(() => [{ value: "", label: "Select record" }, ...unique(state.recordIdOptions, state.recordId).map((value) => ({ value, label: state.recordIdLabels?.[value] ? `${state.recordIdLabels[value]} · #${value}` : `Record #${value}` }))]);
const formattedUpdatedAt = computed(() => { try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.updatedAt)); } catch { return "just now"; } });
const workflowSteps = computed(() => [
  { id: "reference" as const, label: "Reference", detail: referenceSrc.value ? "Source loaded" : "Missing image", icon: ImageIcon, available: true, complete: Boolean(referenceSrc.value) },
  { id: "html" as const, label: "HTML", detail: currentStage.value === "html" ? "Reviewing design" : "Approved", icon: Monitor, available: true, complete: Boolean(state.freemarker) },
  { id: "freemarker" as const, label: "FreeMarker", detail: isConverting.value ? "Generating" : state.freemarker ? "Review source" : "Waiting", icon: Braces, available: Boolean(state.freemarker) || isConverting.value, complete: Boolean(state.pdfDataUrl) },
  { id: "pdf" as const, label: "NetSuite PDF", detail: state.pdfDataUrl ? "Print rendered" : "Waiting", icon: Printer, available: Boolean(state.pdfDataUrl), complete: Boolean(state.pdfDataUrl) && state.status === "freemarker_approved" },
  { id: "final" as const, label: "Final", detail: state.status === "freemarker_approved" ? "Approved" : "Pending", icon: BadgeCheck, available: state.status === "freemarker_approved", complete: state.status === "freemarker_approved" },
]);

function selectStep(step: WorkflowStage) {
  selectedStep.value = step;
  if (step === "reference") { referenceModal.value = true; return; }
  if (step === "html") activeView.value = "html";
  if (step === "freemarker" && (state.freemarker || isConverting.value)) activeView.value = "freemarker";
  if ((step === "pdf" || step === "final") && state.pdfDataUrl) activeView.value = "pdf";
}
function selectArtifactView(view: ArtifactView) {
  activeView.value = view;
  selectedStep.value = view;
}
function fitHtmlPage() {
  const viewport = htmlViewport.value;
  if (!viewport) return;
  paperScale.value = Math.max(0.25, Math.min(1, (viewport.clientWidth - 36) / 816, (viewport.clientHeight - 36) / 1056));
  try { const doc = htmlFrame.value?.contentDocument; if (doc) { doc.documentElement.style.overflow = "hidden"; if (doc.body) doc.body.style.overflow = "hidden"; } } catch { /* same-origin best effort */ }
}
function changeHtmlZoom(delta: number) { paperScale.value = Math.max(0.25, Math.min(2, Number((paperScale.value + delta).toFixed(2)))); }
function zoomHtmlWheel(event: WheelEvent) { changeHtmlZoom(event.deltaY < 0 ? 0.1 : -0.1); }
function beginPan(event: PointerEvent) {
  if (!panMode.value || !htmlViewport.value) return;
  isPanning.value = true;
  panOrigin.x = event.clientX; panOrigin.y = event.clientY; panOrigin.left = htmlViewport.value.scrollLeft; panOrigin.top = htmlViewport.value.scrollTop;
  htmlViewport.value.setPointerCapture(event.pointerId);
}
function movePan(event: PointerEvent) {
  if (!isPanning.value || !htmlViewport.value) return;
  htmlViewport.value.scrollLeft = panOrigin.left - (event.clientX - panOrigin.x);
  htmlViewport.value.scrollTop = panOrigin.top - (event.clientY - panOrigin.y);
}
function endPan(event: PointerEvent) { if (isPanning.value) htmlViewport.value?.releasePointerCapture(event.pointerId); isPanning.value = false; }
function fitReference() {
  const viewport = referenceViewport.value;
  if (!viewport || !referenceNaturalSize.width || !referenceNaturalSize.height) return;
  referenceScale.value = Math.max(0.1, Math.min(1,
    (viewport.clientWidth - 28) / referenceNaturalSize.width,
    (viewport.clientHeight - 28) / referenceNaturalSize.height,
  ));
  nextTick(() => { if (viewport) { viewport.scrollLeft = 0; viewport.scrollTop = 0; } });
}
function handleReferenceLoad(event: Event) {
  const image = event.target as HTMLImageElement;
  referenceLoadFailed.value = false;
  referenceNaturalSize.width = image.naturalWidth;
  referenceNaturalSize.height = image.naturalHeight;
  nextTick(fitReference);
}
function changeReferenceZoom(delta: number) { referenceScale.value = Math.max(0.1, Math.min(4, Number((referenceScale.value + delta).toFixed(2)))); }
function zoomReferenceWheel(event: WheelEvent) {
  if (!referenceSrc.value) return;
  changeReferenceZoom(event.deltaY < 0 ? 0.1 : -0.1);
}
function beginReferencePan(event: PointerEvent) {
  if (!referencePanMode.value || !referenceViewport.value) return;
  isReferencePanning.value = true;
  referencePanOrigin.x = event.clientX; referencePanOrigin.y = event.clientY;
  referencePanOrigin.left = referenceViewport.value.scrollLeft; referencePanOrigin.top = referenceViewport.value.scrollTop;
  referenceViewport.value.setPointerCapture(event.pointerId);
}
function moveReferencePan(event: PointerEvent) {
  if (!isReferencePanning.value || !referenceViewport.value) return;
  referenceViewport.value.scrollLeft = referencePanOrigin.left - (event.clientX - referencePanOrigin.x);
  referenceViewport.value.scrollTop = referencePanOrigin.top - (event.clientY - referencePanOrigin.y);
}
function endReferencePan(event: PointerEvent) {
  if (isReferencePanning.value) referenceViewport.value?.releasePointerCapture(event.pointerId);
  isReferencePanning.value = false;
}
function notify(message: string) { toast.value = message; window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { toast.value = ""; }, 2200); }
function actionPayload(status: ReviewStatus) { return { status, feedback: state.feedback, recordType: state.recordType, recordId: state.recordId, comments: state.comments }; }
function appendComment() { if (!state.feedback.trim()) return; state.comments = [{ id: `request_${Date.now().toString(36)}`, initials: "ME", name: "You", time: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date()), text: state.feedback.trim(), isYou: true }, ...state.comments]; }
function sendFixes() {
  if (!state.feedback.trim()) { feedbackEl.value?.focus(); notify("Add review notes before sending fixes."); return; }
  const submittedFeedback = state.feedback.trim();
  appendComment();
  const status: ReviewStatus = isFreemarkerStage.value ? "freemarker_changes_requested" : "html_changes_requested";
  window.__magicTemplateReviewAction?.({ ...actionPayload(status), feedback: submittedFeedback });
  state.feedback = "";
  state.status = status;
}
function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  sendFixes();
}
async function selectRecordType(value: string) {
  if (!value || value === state.recordType || recordOptionsLoading.value) return;
  state.recordType = value;
  state.recordId = "";
  recordOptionsLoading.value = true;
  try {
    const result = await window.__magicTemplateReviewAction?.({ action: "record_options_requested", recordType: value });
    if (Array.isArray(result?.recordTypeOptions)) state.recordTypeOptions = result.recordTypeOptions as string[];
    if (Array.isArray(result?.recordIdOptions)) state.recordIdOptions = result.recordIdOptions as string[];
    if (result?.recordTypeLabels && typeof result.recordTypeLabels === "object") state.recordTypeLabels = result.recordTypeLabels as Record<string, string>;
    if (result?.recordIdLabels && typeof result.recordIdLabels === "object") state.recordIdLabels = result.recordIdLabels as Record<string, string>;
    if (result?.ok === false) notify(String(result.message || "Could not load NetSuite records."));
  } catch { notify("Could not load NetSuite records. You can still enter an ID."); }
  finally { recordOptionsLoading.value = false; }
}
function selectRecordId(value: string) {
  state.recordId = value;
  window.__magicTemplateReviewAction?.({ action: "context_updated", recordType: state.recordType, recordId: value });
}
async function endReview() {
  state.status = "done";
  try { await window.__magicTemplateReviewAction?.({ action: "end_review" }); } catch { window.close(); }
}
function approveCurrentStage() {
  if (!canApprove.value) { notify(!state.recordId ? "Select a NetSuite record before continuing." : "Resolve the current render issue before approval."); return; }
  const status: ReviewStatus = isFreemarkerStage.value ? "freemarker_approved" : "html_approved";
  window.__magicTemplateReviewAction?.(actionPayload(status));
  state.status = status === "html_approved" ? "converting" : "freemarker_approved";
  if (status === "html_approved") activeView.value = "freemarker";
}
function insertFeedback(prefix: string) {
  const textarea = feedbackEl.value;
  const start = textarea?.selectionStart ?? state.feedback.length;
  const end = textarea?.selectionEnd ?? start;
  const needsNewline = start > 0 && state.feedback[start - 1] !== "\n";
  state.feedback = `${state.feedback.slice(0, start)}${needsNewline ? "\n" : ""}${prefix}${state.feedback.slice(end)}`;
  nextTick(() => { textarea?.focus(); const cursor = start + (needsNewline ? 1 : 0) + prefix.length; textarea?.setSelectionRange(cursor, cursor); });
}
function setReferenceFile(file: File) {
  if (!file.type.startsWith("image/")) { notify("Choose an image file."); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = typeof reader.result === "string" ? reader.result : "";
    if (!dataUrl) return;
    state.referenceImageDataUrl = dataUrl;
    state.referenceImageUrl = "";
    referenceLoadFailed.value = false;
    window.__magicTemplateReviewAction?.({ action: "reference_updated", referenceImageDataUrl: dataUrl });
    notify("Reference image added.");
  };
  reader.readAsDataURL(file);
}
function handleReferenceInput(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (file) setReferenceFile(file); }
function handleReferenceDrop(event: DragEvent) { const file = event.dataTransfer?.files?.[0]; if (file) setReferenceFile(file); }
function handleReferencePaste(event: ClipboardEvent) { const file = [...(event.clipboardData?.files || [])].find((entry) => entry.type.startsWith("image/")); if (file) { event.preventDefault(); setReferenceFile(file); } }
async function copyFreemarker() { await navigator.clipboard.writeText(state.freemarker); notify("FreeMarker copied."); }

watch(() => state.status, (status) => {
  if (status === "converting") { activeView.value = "freemarker"; selectedStep.value = "freemarker"; }
  if (status === "freemarker_review") { activeView.value = state.pdfDataUrl ? "pdf" : "freemarker"; selectedStep.value = state.pdfDataUrl ? "pdf" : "freemarker"; }
  if (status === "freemarker_approved" || status === "done") selectedStep.value = "final";
});
watch(() => state.html, () => nextTick(fitHtmlPage));
watch(referenceSrc, () => { referenceLoadFailed.value = false; referenceNaturalSize.width = 0; referenceNaturalSize.height = 0; });
onMounted(() => {
  window.__magicTemplateReviewSet = (next) => { const wasWaiting = isWaitingForAgent.value; Object.assign(state, next || {}); if (!Array.isArray(state.comments)) state.comments = []; if (wasWaiting && !isWaitingForAgent.value) state.feedback = ""; nextTick(() => { fitHtmlPage(); if (state.status === "freemarker_review") activeView.value = state.pdfDataUrl ? "pdf" : "freemarker"; }); };
  window.__magicTemplateReviewGet = () => JSON.parse(JSON.stringify(state));
  resizeObserver = new ResizeObserver(fitHtmlPage); if (htmlViewport.value) resizeObserver.observe(htmlViewport.value); nextTick(fitHtmlPage);
  referenceResizeObserver = new ResizeObserver(fitReference); if (referenceViewport.value) referenceResizeObserver.observe(referenceViewport.value);
});
onBeforeUnmount(() => { resizeObserver?.disconnect(); referenceResizeObserver?.disconnect(); window.clearTimeout(toastTimer); });
</script>

<style scoped>
:global(*) { box-sizing: border-box; }
:global(html), :global(body), :global(#app) { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #eef3f7; color: #27323a; font-family: Inter, "Segoe UI", sans-serif; font-size: 12px; }
button, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: .48; }
.review-app { width: 100vw; height: 100vh; display: grid; grid-template-rows: 58px 54px minmax(0,1fr) 184px; overflow: hidden; background: #eef3f7; }
.topbar { display: flex; align-items: center; gap: 24px; padding: 0 14px; border-bottom: 1px solid #dbe3ea; background: #fff; }
.title-block { min-width: 220px; display: flex; align-items: center; gap: 10px; }
.title-icon { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid #d8c6ff; border-radius: 6px; background: #faf7ff; color: #7b2ff7; }
.title-block > div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.title-block strong { font-size: 13px; }
.title-block span:last-child { max-width: 230px; color: #62696e; font: 10px/1.2 Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.context-controls { display: flex; align-items: center; gap: 10px; }
.context-controls label { display: flex; align-items: center; gap: 6px; color: #62696e; font-size: 10px; font-weight: 650; white-space: nowrap; }
:global(.review-select) { position: relative; width: 164px; }
:global(.review-select-trigger) { width: 100%; height: 30px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 9px; border: 1px solid #b4c4d3; border-radius: 5px; background: #fff; text-align: left; }
:global(.review-select-trigger span) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:global(.review-select-editable) { width: 100%; height: 30px; display: grid; grid-template-columns: minmax(0,1fr) 28px; border: 1px solid #b4c4d3; border-radius: 5px; background: #fff; overflow: hidden; }
:global(.review-select-editable input) { min-width: 0; padding: 0 8px; border: 0; outline: 0; font: inherit; }
:global(.review-select-editable button) { display: grid; place-items: center; padding: 0; border: 0; border-left: 1px solid #dbe3ea; background: #fbfcfd; color: #62696e; }
:global(.review-select.open .review-select-trigger) { border-color: #c6a7ff; box-shadow: 0 0 0 2px #faf7ff; color: #7b2ff7; }
:global(.review-select.open .review-select-editable) { border-color: #c6a7ff; box-shadow: 0 0 0 2px #faf7ff; }
:global(.review-select-menu) { position: absolute; z-index: 40; top: 34px; left: 0; right: 0; display: none; max-height: 220px; padding: 4px; overflow: auto; border: 1px solid #dbe3ea; border-radius: 5px; background: #fff; box-shadow: 0 10px 28px rgba(39,50,58,.16); }
:global(.review-select.open .review-select-menu) { display: grid; }
:global(.review-select-menu button) { min-height: 29px; padding: 0 8px; border: 1px solid transparent; border-radius: 4px; background: transparent; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:global(.review-select-menu button:hover), :global(.review-select-menu button[aria-selected="true"]) { border-color: #d8c6ff; background: #faf7ff; color: #7b2ff7; }
.topbar-status { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.status-chip { height: 26px; display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; border: 1px solid #d8c6ff; border-radius: 4px; background: #faf7ff; color: #7b2ff7; font-size: 10px; font-weight: 750; }
.status-chip.warning { border-color: #e8c98d; background: #fffaf0; color: #96620b; }
.status-chip.success { border-color: #a9d8c2; background: #f1fbf6; color: #267556; }
.updated { color: #8a949b; font-size: 10px; white-space: nowrap; }
.icon-button { width: 30px; height: 30px; display: inline-grid; place-items: center; padding: 0; border: 1px solid #dbe3ea; border-radius: 5px; background: #fff; color: #62696e; }
.icon-button:hover:not(:disabled) { border-color: #c6a7ff; background: #faf7ff; color: #7b2ff7; }
.workflow { display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: 5px; padding: 7px 14px; border-bottom: 1px solid #dbe3ea; background: #fbfcfd; }
.workflow-step { min-width: 0; height: 39px; display: grid; grid-template-columns: 27px minmax(0,1fr) 18px; align-items: center; gap: 7px; padding: 0 8px; border: 1px solid transparent; border-radius: 5px; background: transparent; text-align: left; color: #62696e; }
.workflow-step.available:hover, .workflow-step.active { border-color: #d8c6ff; background: #faf7ff; color: #7b2ff7; }
.step-icon { width: 25px; height: 25px; display: grid; place-items: center; border: 1px solid #dbe3ea; border-radius: 5px; background: #fff; }
.workflow-step.active .step-icon { border-color: #d8c6ff; color: #7b2ff7; }
.step-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.step-copy strong, .step-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step-copy strong { font-size: 11px; }.step-copy small { color: #8a949b; font-size: 9px; }
.step-check { color: #267556; }.step-arrow { color: #b4c4d3; }
.workspace { min-height: 0; display: grid; grid-template-columns: minmax(260px,30%) minmax(420px,1fr) 300px; gap: 8px; padding: 8px 14px; overflow: hidden; }
.reference-panel, .artifact-panel, .history-panel { min-width: 0; min-height: 0; display: flex; flex-direction: column; border: 1px solid #dbe3ea; border-radius: 6px; overflow: hidden; background: #fff; }
.panel-header, .artifact-tabs { height: 40px; flex: 0 0 40px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 8px 0 11px; border-bottom: 1px solid #dbe3ea; background: #fbfcfd; }
.panel-header > div { min-width: 0; display: flex; align-items: center; gap: 7px; }.panel-header strong { font-size: 11px; }.panel-header span { color: #8a949b; font-size: 9px; }
.panel-actions { display: flex; align-items: center; gap: 5px; }
.reference-canvas { position: relative; flex: 1; min-height: 0; display: grid; place-items: safe center; padding: 14px; overflow: auto; outline: 0; background: #eef3f7; }
.reference-canvas:focus { box-shadow: inset 0 0 0 2px #d8c6ff; }
.reference-image-holder { flex: 0 0 auto; min-width: 1px; min-height: 1px; }
.reference-canvas img { display: block; width: 100%; height: 100%; object-fit: fill; user-select: none; -webkit-user-drag: none; filter: drop-shadow(0 2px 5px rgba(39,50,58,.12)); }
.reference-canvas.pan-mode { cursor: grab; user-select: none; }.reference-canvas.panning { cursor: grabbing; }.reference-canvas.pan-mode img { pointer-events: none; }
.choose-reference { height: 30px; display: inline-flex; align-items: center; gap: 6px; margin-top: 5px; padding: 0 10px; border: 1px solid #d8c6ff; border-radius: 5px; background: #faf7ff; color: #7b2ff7; font-weight: 700; }
.visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); }
.artifact-tabs { justify-content: flex-start; padding: 0 7px; }
.artifact-tabs > button:not(.tab-action) { height: 31px; display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: #62696e; white-space: nowrap; }
.artifact-tabs > button.active { border-color: #d8c6ff; background: #faf7ff; color: #7b2ff7; }
.artifact-spacer { flex: 1; }.tab-action { flex: 0 0 30px; }
.zoom-tools { display: flex; align-items: center; gap: 3px; }
.zoom-tools .icon-button.active { border-color: #d8c6ff; background: #faf7ff; color: #7b2ff7; }
.zoom-value { min-width: 43px; height: 28px; padding: 0 5px; border: 1px solid #dbe3ea; border-radius: 5px; background: #fff; color: #62696e; font-size: 10px; }
.artifact-stage { position: relative; flex: 1; min-height: 0; overflow: hidden; background: #eef3f7; }
.page-stage, .code-stage, .pdf-stage { width: 100%; height: 100%; min-height: 0; }
.page-viewport { width: 100%; height: 100%; overflow: auto; }
.page-canvas { width: max-content; height: max-content; min-width: 100%; min-height: 100%; display: flex; align-items: safe center; justify-content: safe center; padding: 18px; }
.paper-holder { position: relative; flex: 0 0 auto; }
.paper-scale { position: absolute; top: 0; left: 0; transform-origin: top left; background: #fff; box-shadow: 0 2px 12px rgba(39,50,58,.18); }
.page-viewport.pan-mode { cursor: grab; user-select: none; }.page-viewport.panning { cursor: grabbing; }.page-viewport.pan-mode #htmlFrame { pointer-events: none; }
#htmlFrame { display: block; width: 816px; height: 1056px; border: 0; background: #fff; }
.code-stage { display: flex; flex-direction: column; padding: 10px; }
.code-toolbar { height: 34px; display: flex; align-items: center; justify-content: space-between; padding: 0 8px; border: 1px solid #dbe3ea; border-bottom: 0; border-radius: 5px 5px 0 0; background: #fbfcfd; }
.code-toolbar span, .code-toolbar button { display: inline-flex; align-items: center; gap: 6px; }.code-toolbar span { font: 10px Consolas, monospace; }.code-toolbar button { height: 25px; border: 1px solid #dbe3ea; border-radius: 4px; background: #fff; }
.code-stage pre { flex: 1; min-height: 0; margin: 0; padding: 13px; overflow: auto; border: 1px solid #dbe3ea; border-radius: 0 0 5px 5px; background: #fff; color: #27323a; font: 11px/1.52 "JetBrains Mono", Consolas, monospace; white-space: pre; }
.pdf-stage { padding: 10px; }.pdf-stage iframe { width: 100%; height: 100%; border: 1px solid #dbe3ea; border-radius: 5px; background: #fff; }
.empty-state { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 22px; color: #8a949b; text-align: center; }.empty-state strong { color: #62696e; }.empty-state p { max-width: 300px; margin: 0; line-height: 1.5; }
.converting { color: #7b2ff7; }.render-error { position: absolute; right: 12px; bottom: 12px; max-width: calc(100% - 24px); display: flex; align-items: center; gap: 7px; padding: 8px 10px; border: 1px solid #e8c98d; border-radius: 5px; background: #fffaf0; color: #96620b; box-shadow: 0 5px 16px rgba(39,50,58,.12); }
.history-panel header { height: 40px; display: flex; align-items: center; justify-content: space-between; padding: 0 10px 0 11px; border-bottom: 1px solid #dbe3ea; background: #fbfcfd; }.history-panel header span { display: flex; align-items: center; gap: 7px; }
.history-count { min-width: 21px; height: 21px; display: grid !important; place-items: center; border-radius: 4px; background: #faf7ff; color: #7b2ff7 !important; font-size: 9px !important; font-weight: 750; }
.history-list { flex: 1; min-height: 0; padding: 12px; overflow: auto; }.history-thread { padding: 4px 0 11px; border-bottom: 1px solid #eef3f7; }.history-list article { display: grid; grid-template-columns: 28px 1fr; gap: 8px; padding: 8px 0; }.history-response { position: relative; margin: 3px 0 0 18px; padding: 9px !important; border: 1px solid #e0e7ed; border-radius: 6px; background: #f8fafc; }.history-response::before { content: ""; position: absolute; top: -12px; left: -10px; width: 13px; height: 21px; border-left: 1px solid #c8d3dc; border-bottom: 1px solid #c8d3dc; border-radius: 0 0 0 6px; }.avatar { width: 27px; height: 27px; display: grid; place-items: center; border-radius: 50%; background: #faf7ff; color: #7b2ff7; font-size: 9px; font-weight: 800; }.history-list time { float: right; color: #8a949b; font-size: 8px; }.history-list p { margin: 5px 0 0; line-height: 1.4; }.history-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; color: #8a949b; }
.avatar.ai { background: #27323a; color: #fff; }
.review-bar { display: grid; grid-template-rows: minmax(0,1fr) 34px; gap: 7px; padding: 8px 14px 9px; border-top: 1px solid #dbe3ea; background: #fff; }
.review-copy { min-width: 0; display: grid; grid-template-rows: 19px minmax(0,1fr); }
.stage-label { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 750; color: #62696e; }
.composer { position: relative; min-height: 0; border: 1px solid #b4c4d3; border-radius: 6px; background: #fff; overflow: hidden; }
.composer:focus-within { border-color: #c6a7ff; box-shadow: 0 0 0 2px #faf7ff; }
.composer textarea { display: block; width: 100%; height: 100%; min-height: 104px; resize: none; padding: 10px 44px 32px 10px; border: 0; outline: 0; line-height: 1.45; }
.composer textarea:disabled { background: #fbfcfd; color: #8a949b; }
.composer-waiting { position: absolute; inset: 0 0 34px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; background: rgba(251,252,253,.92); color: #7b2ff7; font-weight: 650; text-align: center; }
.composer-toolbar { position: absolute; right: 6px; bottom: 5px; left: 6px; display: flex; align-items: center; justify-content: space-between; pointer-events: none; }
.composer-toolbar > * { pointer-events: auto; }
.composer-toolbar span { display: flex; align-items: center; gap: 3px; }
.composer-toolbar button { width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #62696e; }
.composer-toolbar button:hover:not(:disabled) { border-color: #d8c6ff; background: #faf7ff; color: #7b2ff7; }
.composer-toolbar .composer-send { border-color: #27323a; border-radius: 50%; background: #27323a; color: #fff; }
.composer-toolbar .composer-send:hover:not(:disabled) { border-color: #7b2ff7; background: #7b2ff7; color: #fff; }
.approval-row { display: flex; align-items: center; justify-content: flex-end; }
.button { height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 11px; border: 1px solid #b4c4d3; border-radius: 5px; background: #fff; white-space: nowrap; font-weight: 650; }
.button:hover:not(:disabled) { border-color: #c6a7ff; background: #faf7ff; color: #7b2ff7; }
.button.primary { min-width: 218px; border-color: #d8c6ff; background: #faf7ff; color: #7b2ff7; }
.modal { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 24px; }.modal-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: rgba(39,50,58,.55); }.modal-dialog { position: relative; width: min(980px,95vw); height: min(840px,92vh); display: grid; grid-template-rows: 42px minmax(0,1fr); border: 1px solid #b4c4d3; border-radius: 7px; overflow: hidden; background: #fff; box-shadow: 0 22px 60px rgba(39,50,58,.3); }.modal-dialog header { display: flex; align-items: center; justify-content: space-between; padding: 0 7px 0 12px; border-bottom: 1px solid #dbe3ea; }.modal-dialog > div { min-height: 0; display: grid; place-items: center; padding: 12px; overflow: auto; background: #eef3f7; }.modal-dialog img { max-width: 100%; max-height: 100%; object-fit: contain; }.artifact-dialog { width: min(1180px,96vw); }.modal-artifact iframe { width: 100%; height: 100%; border: 0; background: #fff; }.modal-artifact pre { align-self: stretch; justify-self: stretch; margin: 0; padding: 14px; overflow: auto; background: #fff; font: 11px/1.5 Consolas, monospace; }
.toast { position: fixed; z-index: 120; right: 18px; bottom: 124px; display: flex; align-items: center; gap: 7px; padding: 9px 11px; border: 1px solid #d8c6ff; border-radius: 5px; background: #faf7ff; color: #7b2ff7; opacity: 0; transform: translateY(8px); pointer-events: none; transition: .16s; box-shadow: 0 8px 24px rgba(39,50,58,.15); }.toast.show { opacity: 1; transform: none; }
.spin { animation: spin .8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1250px) { .updated { display: none; }.context-controls label > span { display: none; }.workspace { grid-template-columns: 260px minmax(390px,1fr) 260px; }.workflow-step { grid-template-columns: 27px minmax(0,1fr); }.step-arrow,.step-check { display: none; }.artifact-tabs > button:not(.tab-action) { padding: 0 6px; } }
</style>
