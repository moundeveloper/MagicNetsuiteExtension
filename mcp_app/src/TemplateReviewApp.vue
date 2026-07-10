<template>
  <div class="review-app">
    <section class="meta">
      <div class="meta-item template-file">
        <span class="meta-label">Template File</span>
        <span class="meta-filename" :title="state.templateFile">{{ state.templateFile || "invoice_template.ftl" }}</span>
      </div>

      <div class="meta-item">
        <span class="meta-label">Record Type</span>
        <CustomSelect
          v-model="state.recordType"
          :options="recordTypeSelectOptions"
          placeholder="Record type"
        />
      </div>

      <div class="meta-item">
        <span class="meta-label">Record ID</span>
        <CustomSelect
          id-prefix="recordId"
          v-model="state.recordId"
          :options="recordIdSelectOptions"
          placeholder="Select record"
        />
      </div>

      <div class="updated">Last updated: {{ formattedUpdatedAt }}</div>
    </section>

    <main class="main">
      <aside class="steps" aria-label="Template review workflow">
        <button class="step" type="button">
          <span class="step-number">1</span><span><strong>Upload</strong></span><span class="state">OK</span>
        </button>
        <button class="step" type="button">
          <span class="step-number">2</span><span><strong>HTML</strong></span><span class="state">OK</span>
        </button>
        <button class="step" :class="{ active: !activeFtl && state.status !== 'done' }" type="button" id="reviewStep">
          <span class="step-number">3</span><span><strong>Review</strong><small>{{ activeFtl ? "Approved" : "You are here" }}</small></span><span />
        </button>
        <button class="step" :class="{ active: activeFtl, locked: !activeFtl && state.status !== 'done' }" type="button" id="ftlStep">
          <span class="step-number">4</span><span><strong>FreeMarker</strong><small>{{ activeFtl ? "Review output" : "" }}</small></span><span class="state">{{ activeFtl ? "OK" : "-" }}</span>
        </button>
        <button class="step" :class="{ active: activeFtl, locked: !activeFtl && state.status !== 'done' }" type="button" id="previewStep">
          <span class="step-number">5</span><span><strong>Preview</strong><small>{{ activeFtl ? "Rendered result" : "" }}</small></span><span class="state">{{ activeFtl ? "OK" : "-" }}</span>
        </button>
      </aside>

      <section class="content">
        <div class="review-panels">
          <section class="panel">
            <div class="panel-head">
              <h2>Reference <span>(Source Image)</span><span class="info">i</span></h2>
              <div class="tools">
                <button class="tool" type="button" data-ref="-10" title="Zoom out" @click="changeRefZoom(-10)">-</button>
                <button class="tool zoom" type="button" id="refZoom">{{ refZoom }}%</button>
                <button class="tool" type="button" data-ref="10" title="Zoom in" @click="changeRefZoom(10)">+</button>
                <button class="tool solo" type="button" id="openRef" title="Open reference" @click="openReference">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>
                </button>
              </div>
            </div>
            <div class="reference-body">
              <div class="reference-stage" id="reference">
                <div v-if="referenceSrc" class="ref-card" id="refCard" :style="{ transform: `scale(${refZoom / 100})` }">
                  <div class="doc-icon" />
                  <strong>Reference image loaded</strong>
                  <span>Invoice_reference.png</span>
                  <span>1.2 MB</span>
                  <button class="secondary" type="button" @click="modalOpen = true">View Full Size</button>
                </div>
                <div v-else class="ref-empty">
                  <div class="doc-icon" />
                  <strong>No reference image was passed.</strong><br />
                  The agent should pass referenceImagePath, referenceImageDataUrl, or referenceImageUrl from the prompt attachment.
                </div>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>Rendered HTML <span>(Live Preview)</span></h2>
              <div class="tools">
                <button class="tool" type="button" data-render="-10" title="Zoom out" @click="changeRenderZoom(-10)">-</button>
                <button class="tool zoom render-zoom" type="button" id="renderZoom" title="Fit preview" @click="fitHtmlFrame">{{ renderZoom }}%</button>
                <button class="tool" type="button" data-render="10" title="Zoom in" @click="changeRenderZoom(10)">+</button>
              </div>
            </div>
            <div class="render-body">
              <div ref="renderScroller" class="render-scroll">
                <div ref="htmlScaleWrap" class="iframe-scale-wrap" id="htmlScaleWrap">
                  <iframe
                    ref="htmlFrame"
                    id="htmlFrame"
                    sandbox="allow-same-origin"
                    :srcdoc="state.html"
                    :style="htmlFrameStyle"
                    @load="resizeHtmlFrame"
                  />
                </div>
              </div>
            </div>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h2>Actions &amp; FreeMarker Status</h2>
              <button class="tool solo" type="button" id="collapseStatus" title="Collapse status" @click="statusCollapsed = !statusCollapsed">
                {{ statusCollapsed ? "v" : "^" }}
              </button>
            </div>
            <div v-show="!statusCollapsed" class="status-body">
              <div class="status-card">
                <div class="row"><span>Review Status</span><strong class="badge" id="statusInline">{{ activeFtl ? "FTL Review" : "In Review" }}</strong></div>
                <div class="row"><span>Step</span><strong id="reviewStepNumber">{{ activeFtl ? "4 of 5" : "3 of 5" }}</strong></div>
                <div class="row"><span>Locked Until</span><strong id="lockedUntil">{{ activeFtl ? "Unlocked" : "Approval" }}</strong></div>
                <div class="row"><span>Next Step</span><strong id="nextStep">{{ activeFtl ? "Rendered Preview" : "FreeMarker Generation" }}</strong></div>
              </div>
              <div class="lockbox" id="lockbox">
                <svg v-if="activeFtl" viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5" /></svg>
                <svg v-else viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                <p>
                  <strong>{{ activeFtl ? "FreeMarker generation enabled." : "FreeMarker generation is locked." }}</strong>
                  {{ activeFtl ? "Review the rendered output, send fixes, or end the workflow." : "Approve this HTML to enable FreeMarker generation." }}
                </p>
              </div>

              <div class="comments-title"><h3>Comments History</h3><span class="count" id="count">{{ comments.length }}</span></div>
              <div class="comments" id="comments">
                <article v-for="(comment, index) in comments" :key="`${comment.time}-${index}`" class="comment">
                  <span class="avatar" :class="comment.color || 'blue'">{{ comment.initials || "ME" }}</span>
                  <div>
                    <div class="comment-top">
                      <strong>{{ comment.name || "You" }} <span v-if="comment.isYou" class="you">You</span></strong>
                      <time>{{ comment.time }}</time>
                    </div>
                    <p>{{ comment.text }}</p>
                  </div>
                </article>
              </div>
              <button class="add-comment" type="button" id="addComment" @click="focusFeedback">Add Comment</button>
              <div v-show="activeFtl && state.renderedResult" class="result-frame-wrap" id="resultFrameWrap">
                <iframe id="resultFrame" sandbox="allow-same-origin" :srcdoc="state.renderedResult" />
              </div>
              <pre v-show="activeFtl" id="freemarker">{{ state.freemarker || "Approve the HTML preview to generate the rendered FreeMarker result here." }}</pre>
            </div>
          </section>
        </div>

        <section class="notes">
          <div>
            <label for="feedback">Review notes</label>
            <span class="hint">Write fixes for the agent, or approve when the current stage is correct.</span>
            <div class="editor">
              <textarea
                ref="feedbackEl"
                id="feedback"
                v-model="state.feedback"
                maxlength="4000"
                placeholder="Write fixes for the agent here"
              />
              <div class="editor-tools">
                <span class="toolbar-buttons">
                  <button class="list-tool" type="button" id="bullets" @click="insertList('- ')">Bulleted list</button>
                  <button class="list-tool" type="button" id="numbers" @click="insertList('1. ')">Numbered list</button>
                </span>
                <span class="counter" id="counter">{{ (state.feedback || "").length }}/4000</span>
              </div>
            </div>
          </div>
          <div class="note-actions">
            <button type="button" class="action-btn" id="save" @click="saveDraft">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8" /><path d="M7 3v5h8" /></svg>
              <span>Save Draft</span>
            </button>
            <button type="button" class="action-btn" id="fixes" @click="sendFixes">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              <span>Send Fixes</span>
            </button>
            <button type="button" class="action-btn approve" id="approve" @click="approve">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5" /></svg>
              <span id="approveLabel">{{ activeFtl ? "Approve FTL" : "Approve & Generate FreeMarker" }}</span>
            </button>
            <button v-show="activeFtl" type="button" class="action-btn end" id="end" @click="endReview">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
              <span>End</span>
            </button>
          </div>
        </section>
      </section>
    </main>

    <div v-if="modalOpen" class="modal" id="modal">
      <div class="backdrop" @click="modalOpen = false" />
      <div class="dialog">
        <div class="dialog-head"><h2>Reference image</h2><button class="close" type="button" @click="modalOpen = false">x</button></div>
        <div class="dialog-body" id="modalImageWrap">
          <img v-if="referenceSrc" :src="referenceSrc" alt="Reference image" />
          <span v-else>No reference image available.</span>
        </div>
      </div>
    </div>
    <div class="toast" :class="{ show: toast }" id="toast">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

type ReviewStatus = "open" | "needs_changes" | "approved" | "ftl_review" | "done";
type ReviewComment = {
  initials: string;
  name: string;
  time: string;
  text: string;
  color: "blue" | "purple" | "green";
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
  html: string;
  freemarker: string;
  renderedResult: string;
  referenceImageDataUrl: string;
  referenceImageUrl: string;
  feedback: string;
  comments: ReviewComment[];
  status: ReviewStatus;
  version: number;
  updatedAt: string;
};
type SelectOption = { value: string; label: string };

declare global {
  interface Window {
    __MAGIC_TEMPLATE_REVIEW_INITIAL__?: Partial<ReviewState>;
    __magicTemplateReviewSet?: (value: Partial<ReviewState>) => void;
    __magicTemplateReviewGet?: () => ReviewState;
    __magicTemplateReviewAction?: (value: Record<string, unknown>) => void;
  }
}

const defaultState = (): ReviewState => ({
  reviewId: "",
  title: "NetSuite Template Review",
  templateFile: "invoice_template.ftl",
  recordType: "invoice",
  recordId: "",
  recordTypeOptions: ["invoice"],
  recordIdOptions: [],
  html: "",
  freemarker: "",
  renderedResult: "",
  referenceImageDataUrl: "",
  referenceImageUrl: "",
  feedback: "",
  comments: [],
  status: "open",
  version: 0,
  updatedAt: new Date().toISOString(),
});

const CustomSelect = defineComponent({
  props: {
    modelValue: { type: String, default: "" },
    options: { type: Array as () => SelectOption[], default: () => [] },
    placeholder: { type: String, default: "Select" },
    idPrefix: { type: String, default: "recordType" },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    const open = ref(false);
    const currentLabel = computed(() => props.options.find((option) => option.value === props.modelValue)?.label || props.placeholder);
    const choose = (value: string) => {
      emit("update:modelValue", value);
      open.value = false;
    };
    return () => h("div", { class: ["custom-select", { open: open.value }], "data-custom-select": "" }, [
      h("input", { type: "hidden", id: props.idPrefix, value: props.modelValue }),
      h("button", {
        class: "select-trigger",
        type: "button",
        "aria-haspopup": "listbox",
        "aria-expanded": open.value ? "true" : "false",
        title: currentLabel.value,
        onClick: () => { open.value = !open.value; },
      }, [
        h("span", { class: "select-value", id: `${props.idPrefix}Value` }, currentLabel.value),
        h("span", { class: "select-chevron", "aria-hidden": "true" }, "v"),
      ]),
      h("div", { class: "select-menu", role: "listbox", id: props.idPrefix === "recordId" ? "recordIdMenu" : undefined }, props.options.map((option) =>
        h("button", {
          type: "button",
          role: "option",
          "data-value": option.value,
          "aria-selected": option.value === props.modelValue ? "true" : "false",
          title: option.label,
          onClick: () => choose(option.value),
        }, option.label),
      )),
    ]);
  },
});

function unique(values: string[], current = "") {
  const out: string[] = [];
  if (current) out.push(current);
  values.forEach((value) => {
    if (value && !out.includes(value)) out.push(value);
  });
  return out;
}

function labelForRecordType(value: string) {
  return {
    invoice: "Invoice",
    salesorder: "Sales Order",
    purchaseorder: "Purchase Order",
    creditmemo: "Credit Memo",
    customerstatement: "Customer Statement",
  }[value.toLowerCase()] || value || "Select record";
}

const initial = { ...defaultState(), ...(window.__MAGIC_TEMPLATE_REVIEW_INITIAL__ || {}) };
const state = reactive<ReviewState>({
  ...initial,
  recordTypeOptions: Array.isArray(initial.recordTypeOptions) ? initial.recordTypeOptions : ["invoice"],
  recordIdOptions: Array.isArray(initial.recordIdOptions) ? initial.recordIdOptions : [],
  comments: Array.isArray(initial.comments) ? initial.comments : [],
});

const refZoom = ref(100);
const renderZoom = ref(100);
const htmlFrame = ref<HTMLIFrameElement | null>(null);
const htmlScaleWrap = ref<HTMLDivElement | null>(null);
const renderScroller = ref<HTMLDivElement | null>(null);
const feedbackEl = ref<HTMLTextAreaElement | null>(null);
const htmlFrameSize = reactive({ width: 1200, height: 1600 });
const modalOpen = ref(false);
const statusCollapsed = ref(false);
const toast = ref("");
let toastTimer = 0;

const activeFtl = computed(() => state.status === "ftl_review");
const referenceSrc = computed(() => state.referenceImageDataUrl || state.referenceImageUrl || "");
const comments = computed(() => Array.isArray(state.comments) ? state.comments : []);
const recordTypeSelectOptions = computed(() => unique(state.recordTypeOptions || [], state.recordType || "invoice").map((value) => ({
  value,
  label: labelForRecordType(value),
})));
const recordIdSelectOptions = computed(() => [
  { value: "", label: "Select record" },
  ...unique(state.recordIdOptions || [], state.recordId || "").map((value) => ({ value, label: value })),
]);
const formattedUpdatedAt = computed(() => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.updatedAt));
  } catch {
    return state.updatedAt || "";
  }
});
const htmlFrameStyle = computed(() => ({
  width: `${htmlFrameSize.width}px`,
  height: `${htmlFrameSize.height}px`,
  transform: `scale(${renderZoom.value / 100})`,
}));

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function notify(message: string) {
  toast.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = "";
  }, 2200);
}

function resizeHtmlFrame() {
  const frame = htmlFrame.value;
  const wrap = htmlScaleWrap.value;
  if (!frame || !wrap) return;
  let width = 1200;
  let height = 1600;
  try {
    const doc = frame.contentDocument;
    if (doc) {
      const root = doc.documentElement;
      const body = doc.body;
      width = Math.max(root.scrollWidth, body?.scrollWidth || 0, root.offsetWidth, body?.offsetWidth || 0, 800);
      height = Math.max(root.scrollHeight, body?.scrollHeight || 0, root.offsetHeight, body?.offsetHeight || 0, 1000);
      root.style.overflow = "hidden";
      if (body) body.style.overflow = "hidden";
    }
  } catch {
    /* best effort */
  }
  htmlFrameSize.width = width;
  htmlFrameSize.height = height;
  const scale = renderZoom.value / 100;
  wrap.style.width = `${Math.ceil(width * scale)}px`;
  wrap.style.height = `${Math.ceil(height * scale)}px`;
}

function fitHtmlFrame() {
  const scroller = renderScroller.value;
  if (!scroller) return;
  resizeHtmlFrame();
  const scale = Math.min(scroller.clientWidth / htmlFrameSize.width, scroller.clientHeight / htmlFrameSize.height);
  renderZoom.value = clamp(Math.floor(scale * 100), 25, 200);
  nextTick(resizeHtmlFrame);
}

function changeRenderZoom(delta: number) {
  renderZoom.value = clamp(renderZoom.value + delta, 25, 200);
  nextTick(resizeHtmlFrame);
}

function changeRefZoom(delta: number) {
  refZoom.value = clamp(refZoom.value + delta, 70, 160);
}

function actionPayload(status: ReviewStatus) {
  return {
    status,
    feedback: state.feedback || "",
    recordType: state.recordType || "",
    recordId: state.recordId || "",
    comments: state.comments || [],
  };
}

function appendFixComment(text: string) {
  if (!text.trim()) return;
  state.comments = [{
    initials: "ME",
    name: "You",
    time: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date()),
    text: text.trim(),
    color: "blue",
    isYou: true,
  }, ...comments.value];
}

function sendAction(status: ReviewStatus) {
  const payload = actionPayload(status);
  window.__magicTemplateReviewAction?.(payload);
}

function sendFixes() {
  if (!state.feedback.trim()) {
    focusFeedback();
    notify("Add review notes before sending fixes.");
    return;
  }
  appendFixComment(state.feedback);
  state.status = "needs_changes";
  sendAction("needs_changes");
}

function approve() {
  state.status = "approved";
  sendAction("approved");
}

function endReview() {
  state.status = "done";
  sendAction("done");
}

function focusFeedback() {
  feedbackEl.value?.focus();
}

function saveDraft() {
  localStorage.setItem("magic-template-review-draft", state.feedback || "");
  notify("Draft saved locally.");
}

function insertList(prefix: string) {
  const current = state.feedback || "";
  state.feedback = current ? `${current}\n${prefix}` : prefix;
  nextTick(focusFeedback);
}

function openReference() {
  if (referenceSrc.value) modalOpen.value = true;
  else notify("No reference image available.");
}

watch(() => state.html, () => nextTick(resizeHtmlFrame));
watch(renderZoom, () => nextTick(resizeHtmlFrame));

onMounted(() => {
  window.__magicTemplateReviewSet = (next: Partial<ReviewState>) => {
    Object.assign(state, next || {});
    if (!Array.isArray(state.comments)) state.comments = [];
    if (!Array.isArray(state.recordTypeOptions)) state.recordTypeOptions = ["invoice"];
    if (!Array.isArray(state.recordIdOptions)) state.recordIdOptions = [];
    nextTick(resizeHtmlFrame);
  };
  window.__magicTemplateReviewGet = () => JSON.parse(JSON.stringify(state));
  document.title = state.title || "NetSuite Template Review";
  nextTick(resizeHtmlFrame);
});

onBeforeUnmount(() => {
  window.clearTimeout(toastTimer);
});
</script>

<style scoped>
:global(*) { box-sizing: border-box; }
:global(html), :global(body), :global(#app) {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: #f7f9fc;
  color: #172238;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  font-size: 12px;
}
button, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
.review-app { width: 100vw; height: 100vh; min-width: 0; padding: 4px 10px; display: grid; grid-template-rows: 69px minmax(0, 1fr); overflow: hidden; background: #f7f9fc; }
.meta { height: 69px; padding: 10px 39px; display: flex; align-items: center; gap: 58px; border: 1px solid #dfe5ed; border-radius: 7px; background: #fff; box-shadow: 0 1px 2px rgba(23,34,56,.035); }
.meta-item { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
.meta-label { font-size: 11px; color: #66758a; }
.template-file { min-width: 150px; }
.meta-filename { display: block; max-width: 210px; color: #253149; font-size: 12px; font-weight: 700; line-height: 34px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.updated { margin-left: auto; color: #6f7d91; font-size: 11px; white-space: nowrap; }
.custom-select { position: relative; width: 178px; }
.select-trigger { width: 100%; height: 34px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 11px; border: 1px solid #d7dfe9; border-radius: 7px; background: #fff; color: #27344b; font-size: 12px; font-weight: 650; text-align: left; box-shadow: 0 1px 1px rgba(23,34,56,.02); }
.select-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.select-trigger:hover { border-color: #b9c5d6; }
.custom-select.open .select-trigger { border-color: #c6a7ff; box-shadow: 0 0 0 3px rgba(198,167,255,.18); }
.select-chevron { color: #718096; font-size: 14px; transition: transform .15s ease; }
.custom-select.open .select-chevron { transform: rotate(180deg); }
.select-menu { position: absolute; z-index: 30; left: 0; right: 0; top: 39px; display: none; max-height: 250px; overflow: auto; padding: 5px; border: 1px solid #d5deea; border-radius: 7px; background: #fff; box-shadow: 0 12px 28px rgba(23,34,56,.14); }
.custom-select.open .select-menu { display: grid; }
.select-menu button { min-height: 32px; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: #344158; font-size: 11px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.select-menu button:hover, .select-menu button[aria-selected="true"] { background: #faf7ff; color: #7b2ff7; }
.select-menu button[aria-selected="true"] { font-weight: 700; }
.main { min-height: 0; height: 100%; display: grid; grid-template-columns: 192px minmax(0,1fr); column-gap: 20px; overflow: hidden; }
.steps { height: 100%; min-height: 0; padding: 34px 6px 0; border: 1px solid #dfe5ed; border-top: 0; border-radius: 0 0 7px 7px; background: #fff; overflow: hidden; }
.step { position: relative; width: 100%; height: 62px; display: grid; grid-template-columns: 34px 1fr 24px; align-items: center; column-gap: 10px; padding: 0 10px; border: 1px solid transparent; border-radius: 7px; background: transparent; text-align: left; color: #5e6c80; }
.step:not(:last-child)::after { content: ""; position: absolute; left: 25px; top: 44px; width: 1px; height: 42px; background: #dde4ed; }
.step-number { width: 29px; height: 29px; display: grid; place-items: center; border: 1px solid #cbd5e2; border-radius: 50%; background: #fff; color: #607087; font-size: 12px; z-index: 1; }
.step strong { display: block; font-size: 12px; color: #536176; }
.step small { display: block; margin-top: 3px; color: #7b2ff7; font-size: 10px; }
.step .state { justify-self: end; color: #14916e; font-size: 10px; }
.step.active { background: #faf7ff; border-color: #d8c6ff; color: #7b2ff7; }
.step.active .step-number { border-color: #7b2ff7; background: #7b2ff7; color: #fff; }
.step.active strong { color: #7b2ff7; }
.step.locked .state { color: #8b97a8; }
.content { height: 100%; min-height: 0; padding-top: 15px; display: grid; grid-template-rows: minmax(0,1fr) 136px; overflow: hidden; min-width: 0; }
.review-panels { min-height: 0; display: grid; grid-template-columns: 36.7% 41% 22.3%; border: 1px solid #dfe5ed; border-bottom: 0; border-radius: 7px 7px 0 0; overflow: hidden; background: #fff; }
.panel { min-width: 0; display: flex; flex-direction: column; border-right: 1px solid #dfe5ed; background: #fff; }
.panel:last-child { border-right: 0; }
.panel-head { height: 49px; flex: 0 0 49px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 11px 0 15px; border-bottom: 1px solid #dfe5ed; background: #fff; }
.panel-head h2 { margin: 0; font-size: 12px; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.panel-head h2 span { color: #6f7d91; font-weight: 500; }
.info { display: inline-grid; place-items: center; width: 14px; height: 14px; margin-left: 4px; border: 1px solid #8e9aad; border-radius: 50%; font-size: 8px; color: #7f8b9b; vertical-align: 1px; }
.tools { display: flex; align-items: center; flex-shrink: 0; }
.tool { height: 28px; min-width: 28px; padding: 0 8px; border: 1px solid #dce3ec; background: #fff; color: #536176; }
.tool:first-child { border-radius: 5px 0 0 5px; }
.tool:last-child { border-radius: 0 5px 5px 0; }
.tool + .tool { border-left: 0; }
.tool.zoom { min-width: 46px; }
.tool.render-zoom { min-width: 58px; }
.tool.solo { border-radius: 5px !important; border-left: 1px solid #dce3ec !important; margin-left: 8px; }
.tool svg, .action-btn svg, .lockbox svg { width: 14px; height: 14px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.tool:hover, .secondary:hover, .action-btn:hover { border-color: #c6a7ff; background: #faf7ff; color: #7b2ff7; }
.reference-body, .render-body, .status-body { flex: 1; min-height: 0; overflow: hidden; }
.reference-body { padding: 0 9px 11px 10px; background: #fff; }
.reference-stage { height: 100%; display: grid; place-items: center; border: 1px solid #e0e6ee; border-radius: 6px; background: linear-gradient(#fbfcfe,#f7f9fc); overflow: auto; }
.ref-card { text-align: center; color: #748196; transform-origin: center; transition: transform .15s ease; }
.ref-card strong { display: block; margin-bottom: 7px; color: #66748a; font-size: 12px; }
.ref-card span { display: block; margin: 5px 0; font-size: 11px; }
.ref-empty { max-width: 270px; padding: 0 18px; text-align: center; color: #748196; line-height: 1.45; }
.doc-icon { width: 36px; height: 42px; margin: 0 auto 13px; border: 2px solid #98a4b5; border-radius: 3px; position: relative; }
.doc-icon:before { content: ""; position: absolute; left: 8px; right: 8px; top: 15px; height: 2px; background: #98a4b5; box-shadow: 0 6px 0 #98a4b5, 0 12px 0 #98a4b5; }
.secondary { height: 34px; padding: 0 14px; border: 1px solid #cfd8e4; border-radius: 6px; background: #fff; font-weight: 600; font-size: 11px; }
.ref-card .secondary { margin-top: 14px; }
.render-body { padding: 2px 10px 11px; background: #f8fafc; }
.render-scroll { height: 100%; overflow: auto; background: #fff; }
.iframe-scale-wrap { position: relative; min-width: 100%; min-height: 100%; }
iframe { display: block; width: 100%; height: 100%; min-height: 100%; border: 0; background: #fff; }
#htmlFrame { position: absolute; left: 0; top: 0; transform-origin: top left; }
.status-body { padding: 10px 18px 12px 23px; overflow: auto; display: block; }
.status-card { margin-bottom: 12px; padding: 14px; border: 1px solid #dde4ed; border-radius: 7px; background: #fcfdff; }
.row { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; color: #5e6d82; font-size: 11px; }
.row:last-child { margin-bottom: 0; }
.row strong { min-width: 0; text-align: right; color: #27344b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { padding: 4px 8px; border-radius: 4px; background: #faf7ff; color: #7b2ff7 !important; border: 1px solid #d8c6ff; }
.lockbox { display: grid; grid-template-columns: 23px 1fr; gap: 8px; margin: 0 0 20px; padding: 12px; border: 1px solid #d8c6ff; border-radius: 7px; background: #faf7ff; }
.lockbox svg { width: 20px; height: 20px; color: #7b2ff7; }
.lockbox p { margin: 0; color: #354158; font-size: 11px; line-height: 1.35; }
.lockbox strong { display: block; margin-bottom: 3px; }
.comments-title { display: flex; align-items: center; justify-content: space-between; margin: 0 0 14px; }
.comments-title h3 { margin: 0; font-size: 13px; }
.count { width: 25px; height: 25px; display: grid; place-items: center; border-radius: 6px; background: #eef1f6; font-size: 11px; font-weight: 700; color: #556276; }
.comments { display: flex; flex-direction: column; gap: 16px; }
.comment { display: grid; grid-template-columns: 33px 1fr; gap: 9px; }
.avatar { width: 31px; height: 31px; display: grid; place-items: center; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 800; background: #7b2ff7; }
.avatar.purple { background: #7862e6; }
.avatar.green { background: #66ae8b; }
.comment-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.comment-top strong { font-size: 11px; }
.comment-top time { font-size: 8px; color: #8592a3; white-space: nowrap; }
.you { margin-left: 4px; padding: 2px 5px; border-radius: 4px; background: #faf7ff; color: #7b2ff7; font-size: 8px; font-weight: 600; }
.comment p { margin: 6px 0 0; font-size: 10.5px; line-height: 1.4; color: #38445a; }
.add-comment { width: 100%; margin-top: 14px; height: 34px; border: 1px solid #cfd8e4; border-radius: 5px; background: #fff; font-size: 11px; font-weight: 600; }
.result-frame-wrap { display: block; min-height: 260px; border: 1px solid #dde4ed; border-radius: 7px; overflow: auto; background: #fff; }
.result-frame-wrap iframe { min-height: 520px; }
pre { min-height: 230px; margin: 0; padding: 10px; border: 1px solid #dde4ed; border-radius: 7px; color: #27323a; background: #fff; font: 11px/1.42 Consolas, "Courier New", monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.notes { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 20px; padding: 13px 18px 17px 14px; border: 1px solid #dfe5ed; border-radius: 0 0 7px 7px; background: #fff; }
.notes label { display: block; margin-bottom: 4px; font-size: 11px; font-weight: 750; }
.notes .hint { display: block; margin-bottom: 8px; color: #6f7d91; font-size: 9px; }
.editor { height: 67px; border: 1px solid #dce3ec; border-radius: 6px; overflow: hidden; }
.editor textarea { display: block; width: 100%; height: 40px; padding: 10px 11px 3px; border: 0; outline: 0; resize: none; font-size: 11px; }
.editor:focus-within { border-color: #c6a7ff; box-shadow: 0 0 0 3px rgba(198,167,255,.18); }
.editor-tools { height: 26px; display: flex; align-items: center; justify-content: space-between; padding: 0 9px; color: #728096; }
.toolbar-buttons { display: flex; align-items: center; gap: 7px; }
.list-tool { height: 22px; display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; border: 1px solid #d9e1eb; border-radius: 5px; background: #fff; color: #56657a; font-size: 10px; font-weight: 650; }
.counter { font-size: 9px; }
.note-actions { display: flex; align-items: flex-end; gap: 24px; padding-bottom: 13px; }
.action-btn { width: 145px; height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 12px; border: 1px solid #cfd8e4; border-radius: 5px; background: #fff; font-weight: 650; font-size: 11px; white-space: nowrap; }
.approve { width: 230px; min-width: 230px; border-color: #7b2ff7; background: #7b2ff7; color: #fff; box-shadow: 0 2px 5px rgba(123,47,247,.18); }
.approve:hover { border-color: #6724d7; background: #6724d7; color: #fff; }
.end { width: 98px; min-width: 98px; border-color: #d8c6ff; background: #faf7ff; color: #7b2ff7; }
.modal { position: fixed; inset: 0; z-index: 50; }
.backdrop { position: absolute; inset: 0; background: rgba(20,30,50,.42); }
.dialog { position: relative; width: min(820px, calc(100vw - 60px)); height: min(720px, calc(100vh - 60px)); margin: 30px auto; background: #fff; border-radius: 9px; box-shadow: 0 25px 70px rgba(20,30,50,.28); overflow: hidden; }
.dialog-head { height: 55px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid #dfe5ed; }
.dialog-head h2 { margin: 0; font-size: 16px; }
.dialog-body { height: calc(100% - 55px); display: grid; place-items: center; background: #f7f9fc; }
.dialog-body img { max-width: 94%; max-height: 94%; object-fit: contain; }
.close { width: 32px; height: 32px; border: 0; background: transparent; font-size: 22px; }
.toast { position: fixed; right: 22px; bottom: 22px; z-index: 80; padding: 12px 15px; border: 1px solid #d8c6ff; border-radius: 7px; background: #faf7ff; color: #7b2ff7; box-shadow: 0 12px 30px rgba(24,40,75,.16); opacity: 0; transform: translateY(10px); pointer-events: none; transition: .18s; }
.toast.show { opacity: 1; transform: none; }
@media (max-width: 1350px) {
  .review-app { padding-left: 8px; padding-right: 8px; }
  .meta { gap: 14px; padding-left: 12px; padding-right: 12px; }
  .main { grid-template-columns: 170px minmax(0,1fr); column-gap: 10px; }
  .review-panels { grid-template-columns: 35.5% 40.5% 24%; }
  .note-actions { gap: 10px; }
}
</style>
