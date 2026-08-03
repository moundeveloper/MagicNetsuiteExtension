<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRouter } from "vue-router";
import { Button, InputText, Textarea, useToast } from "primevue";
import Dialog from "primevue/dialog";
import ToggleSwitch from "primevue/toggleswitch";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import MSelect from "../components/universal/input/MSelect.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import {
  ApiRequestType,
  callApi,
  getNetsuiteEnvironment,
  type ApiResponse,
} from "../utils/api";
import { RequestRoutes } from "../types/request";
import {
  TEMPLATE_STUDIO_CAPTURE_REQUEST_KEY,
  TEMPLATE_STUDIO_CAPTURE_RESPONSE_KEY,
  TEMPLATE_STUDIO_ASSET_REQUEST_KEY,
  TEMPLATE_STUDIO_ASSET_RESPONSE_KEY,
  TEMPLATE_SESSION_STORE_KEY,
  TEMPLATE_STUDIO_VIEW_STATE_KEY,
  createTemplateDesignSession,
  deleteTemplateDesignSession,
  emptyTemplateSessionStore,
  loadTemplateSessionStore,
  makeTemplateFeedback,
  makeTemplateReferenceImage,
  makeUserTemplateRevision,
  normalizeTemplateSessionStore,
  saveTemplateSessionStore,
  type TemplateContextMode,
  type TemplateDesignSession,
  type TemplateImageAsset,
  type TemplateReferenceImage,
  type TemplateSessionStore,
} from "../features/templateStudio/sessionStore";
import {
  embeddedImageDataUrlPattern,
  fileToTemplateImageAsset,
  rasterizeTemplateSvg,
  svgSourceToTemplateImageAsset,
  templateImagePreviewUrl,
  templateImageSnippet,
} from "../features/templateStudio/imageAssets";
import { renderPdfDataUrlPage, type PdfPageImage } from "../utils/pdfUtils";

type RecordOption = {
  id: string;
  label: string;
};

type DraftTemplateSource = {
  name: string;
  content: string;
  byteSize: number;
};

type PreviewMode = "pdf" | "reference" | "compare" | "images";
type DocumentKind = "pdf" | "reference";
type DocumentTransform = { scale: number; x: number; y: number };
type PanGesture = {
  kind: DocumentKind;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

const MAX_REFERENCE_IMAGES = 5;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const MAX_TEMPLATE_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_TEMPLATE_IMAGE_ASSETS = 20;
const MAX_TEMPLATE_ASSET_SOURCE_BYTES = 10 * 1024 * 1024;
const router = useRouter();
const toast = useToast();
const store = ref<TemplateSessionStore>(emptyTemplateSessionStore());
const loading = ref(true);
const creating = ref(false);
const showDashboard = ref(false);
const sessionSearch = ref("");
const sessionStatusFilter = ref("all");
const rendering = ref(false);
const editorDirty = ref(false);
const briefDirty = ref(false);
const activePreview = ref<PreviewMode>("pdf");
const activeReferenceId = ref("");
const pdfTransform = ref<DocumentTransform>({ scale: 1, x: 0, y: 0 });
const referenceTransform = ref<DocumentTransform>({ scale: 1, x: 0, y: 0 });
const panGesture = ref<PanGesture | null>(null);
const deleteDialogVisible = ref(false);
const deleteSessionId = ref("");
const deletingSession = ref(false);
const deleteFromDashboard = ref(false);
const editorWidth = ref(52);
const isResizingEditor = ref(false);
const pdfPageImage = ref("");
const pdfPage = ref(1);
const pdfPageCount = ref(0);
const pdfPageRendering = ref(false);
const pdfPreviewError = ref("");
const referenceInput = ref<HTMLInputElement | null>(null);
const templateInput = ref<HTMLInputElement | null>(null);
const assetInput = ref<HTMLInputElement | null>(null);
const assetBusy = ref(false);
const feedbackText = ref("");
const workingFreemarker = ref("");
const workingName = ref("");
const workingPrompt = ref("");
const workingContextMode = ref<TemplateContextMode>("freestyle");
const workingRecordType = ref("");
const workingRecordId = ref("");
const accountId = ref("");
const recordTypes = ref<RecordOption[]>([]);
const records = ref<RecordOption[]>([]);
const recordTypesLoading = ref(false);
const recordsLoading = ref(false);
const contextError = ref("");

const draftName = ref("");
const draftPrompt = ref("");
const draftImages = ref<TemplateReferenceImage[]>([]);
const draftTemplate = ref<DraftTemplateSource | null>(null);
const draftContextMode = ref<TemplateContextMode>("freestyle");
const draftRecordType = ref("");
const draftRecordId = ref("");

const currentSession = computed(
  () =>
    store.value.sessions.find(
      (session) => session.id === store.value.currentSessionId,
    ) || null,
);

const deletionTarget = computed(
  () =>
    store.value.sessions.find(
      (session) => session.id === deleteSessionId.value,
    ) || null,
);

const sessionOptions = computed(() =>
  store.value.sessions.map((session) => ({
    value: session.id,
    label: session.name,
  })),
);

const sessionStatusOptions = [
  { value: "all", label: "All statuses" },
  { value: "brief_ready", label: "Brief ready" },
  { value: "designing", label: "Designing" },
  { value: "rendering", label: "Rendering" },
  { value: "rendered", label: "Rendered" },
  { value: "render_error", label: "Render failed" },
  { value: "completed", label: "Completed" },
];

const filteredSessions = computed(() => {
  const query = sessionSearch.value.trim().toLocaleLowerCase();
  return [...store.value.sessions]
    .filter(
      (session) =>
        (!query || session.name.toLocaleLowerCase().includes(query)) &&
        (sessionStatusFilter.value === "all" ||
          session.status === sessionStatusFilter.value),
    )
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime(),
    );
});

const referenceOptions = computed(() =>
  (currentSession.value?.referenceImages || []).map((image, index) => ({
    value: image.id,
    label: `${index + 1}. ${image.name}`,
  })),
);

const activeReference = computed(() => {
  const images = currentSession.value?.referenceImages || [];
  return (
    images.find((image) => image.id === activeReferenceId.value) ||
    images[0] ||
    null
  );
});

const canCompare = computed(() =>
  Boolean(currentSession.value?.pdfDataUrl && activeReference.value),
);

const pdfPageOptions = computed(() =>
  Array.from({ length: pdfPageCount.value }, (_, index) => ({
    value: index + 1,
    label: `Page ${index + 1}`,
  })),
);

const contextModeOptions = [
  { value: "freestyle", label: "Freestyle / no record" },
  { value: "transaction", label: "Transaction" },
  { value: "customrecord", label: "Custom record" },
];

const recordTypeOptions = computed(() => {
  const values = [...recordTypes.value];
  const currentType = creating.value
    ? draftRecordType.value
    : workingRecordType.value;
  if (currentType && !values.some((option) => option.id === currentType)) {
    values.unshift({ id: currentType, label: currentType });
  }
  return values;
});

const recordOptions = computed(() => {
  const values = [...records.value];
  const currentId = creating.value
    ? draftRecordId.value
    : workingRecordId.value;
  if (currentId && !values.some((option) => option.id === currentId)) {
    values.unshift({ id: currentId, label: `#${currentId}` });
  }
  return values;
});

const activeFeedback = computed(
  () =>
    currentSession.value?.feedback.filter((feedback) => !feedback.checked) ||
    [],
);

const checkedFeedback = computed(
  () =>
    currentSession.value?.feedback.filter((feedback) => feedback.checked) || [],
);

const sessionStatusLabel = (status: TemplateDesignSession["status"]) => {
  const labels: Record<string, string> = {
    brief_ready: "Brief ready",
    designing: "Design in progress",
    rendering: "Rendering with NetSuite",
    rendered: "Rendered",
    render_error: "Render failed",
    completed: "Completed",
  };
  return labels[status] || "Unknown";
};

const statusLabel = computed(() =>
  currentSession.value
    ? sessionStatusLabel(currentSession.value.status)
    : "No session",
);

const formatSessionDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const sessionStartingPoint = (session: TemplateDesignSession) => {
  if (session.templateFileName) return session.templateFileName;
  const referenceCount = session.referenceImages.length;
  if (referenceCount) {
    return `${referenceCount} visual reference${referenceCount === 1 ? "" : "s"}`;
  }
  return "Blank session";
};

const hasRecordContext = computed(
  () => workingContextMode.value !== "freestyle",
);

const normalizeRows = (response: ApiResponse): Record<string, unknown>[] => {
  const message = response?.message;
  if (Array.isArray(message)) return message as Record<string, unknown>[];
  if (Array.isArray(message?.results))
    return message.results as Record<string, unknown>[];
  if (Array.isArray(message?.rows))
    return message.rows as Record<string, unknown>[];
  return [];
};

const cleanRecordType = (value: string) => value.replace(/[^a-z0-9_]/gi, "");

const recordQueries = (recordType: string): string[] => {
  const type = cleanRecordType(recordType);
  if (!type) return [];
  if (type.startsWith("customrecord_")) {
    return [
      `SELECT id, name FROM ${type} WHERE isinactive = 'F' ORDER BY id DESC`,
      `SELECT id FROM ${type} ORDER BY id DESC`,
    ];
  }
  return [
    `SELECT id, tranid, entity, trandate FROM transaction WHERE recordtype = '${type}' ORDER BY id DESC`,
    `SELECT id, entityid, companyname, firstname, lastname FROM ${type} WHERE isinactive = 'F' ORDER BY id DESC`,
    `SELECT id, name FROM ${type} ORDER BY id DESC`,
    `SELECT id FROM ${type} ORDER BY id DESC`,
  ];
};

const rowLabel = (row: Record<string, unknown>) => {
  const id = String(row.id ?? row.ID ?? "");
  const primary = String(
    row.tranid ??
      row.name ??
      row.entityid ??
      row.companyname ??
      [row.firstname, row.lastname].filter(Boolean).join(" ") ??
      "",
  ).trim();
  return primary ? `${primary} · #${id}` : `#${id}`;
};

const hydrateWorkingSession = (
  session: TemplateDesignSession | null,
  force = false,
) => {
  if (!session) {
    workingFreemarker.value = "";
    return;
  }
  if (force || !editorDirty.value) {
    workingFreemarker.value = session.freemarker;
    editorDirty.value = false;
  }
  if (force || !briefDirty.value) {
    workingName.value = session.name;
    workingPrompt.value = session.prompt;
    workingContextMode.value = session.contextMode;
    workingRecordType.value = session.recordType;
    workingRecordId.value = session.recordId;
    briefDirty.value = false;
  }
  rendering.value = session.status === "rendering";
  if (
    !activeReferenceId.value ||
    !session.referenceImages.some(
      (image) => image.id === activeReferenceId.value,
    )
  ) {
    activeReferenceId.value = session.referenceImages[0]?.id || "";
    resetDocumentView("reference");
  }
};

const loadStore = async (force = false) => {
  store.value = await loadTemplateSessionStore();
  hydrateWorkingSession(currentSession.value, force);
};

const updateSession = async (
  sessionId: string,
  updater: (session: TemplateDesignSession) => TemplateDesignSession,
) => {
  const latest = await loadTemplateSessionStore();
  const index = latest.sessions.findIndex(
    (session) => session.id === sessionId,
  );
  if (index < 0) throw new Error("Template session was not found.");
  latest.sessions[index] = updater(latest.sessions[index]!);
  store.value = await saveTemplateSessionStore(latest);
  hydrateWorkingSession(currentSession.value);
};

let pdfRenderSequence = 0;

const markViewReady = async () => {
  await nextTick();
  const session = currentSession.value;
  if (!session) return;
  await chrome.storage.local.set({
    [TEMPLATE_STUDIO_VIEW_STATE_KEY]: {
      sessionId: session.id,
      version: session.version,
      renderVersion: session.renderVersion,
      pdfPage: pdfPage.value,
      pdfPageCount: pdfPageCount.value,
      pdfPageReady: Boolean(pdfPageImage.value),
      readyAt: new Date().toISOString(),
    },
  });
};

const renderPdfPage = async (
  requestedPage = pdfPage.value,
  targetWidth = 1600,
): Promise<PdfPageImage> => {
  const session = currentSession.value;
  if (!session?.pdfDataUrl) {
    throw new Error(
      "Render the current FreeMarker session before capturing its PDF.",
    );
  }
  const sequence = ++pdfRenderSequence;
  pdfPageRendering.value = true;
  pdfPreviewError.value = "";
  try {
    const renderedPage = await renderPdfDataUrlPage(
      session.pdfDataUrl,
      requestedPage,
      targetWidth,
    );
    if (
      sequence === pdfRenderSequence &&
      currentSession.value?.id === session.id
    ) {
      pdfPage.value = renderedPage.pageNumber;
      pdfPageCount.value = renderedPage.pageCount;
      pdfPageImage.value = renderedPage.dataUrl;
      await markViewReady();
    }
    return renderedPage;
  } catch (error) {
    if (sequence === pdfRenderSequence) {
      pdfPreviewError.value =
        error instanceof Error ? error.message : String(error);
      await markViewReady();
    }
    throw error;
  } finally {
    if (sequence === pdfRenderSequence) pdfPageRendering.value = false;
  }
};

const resetPdfPreview = () => {
  pdfRenderSequence += 1;
  pdfPageImage.value = "";
  pdfPage.value = 1;
  pdfPageCount.value = 0;
  pdfPageRendering.value = false;
  pdfPreviewError.value = "";
  resetDocumentView("pdf");
};

const changePdfPage = (value: string | number | null) => {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1 || page > pdfPageCount.value) return;
  resetDocumentView("pdf");
  void renderPdfPage(page).catch(() => undefined);
};

const transformFor = (kind: DocumentKind) =>
  kind === "pdf" ? pdfTransform : referenceTransform;

function resetDocumentView(kind: DocumentKind) {
  transformFor(kind).value = { scale: 1, x: 0, y: 0 };
  if (panGesture.value?.kind === kind) panGesture.value = null;
}

const documentTransformStyle = (kind: DocumentKind) => {
  const transform = transformFor(kind).value;
  return {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
  };
};

const zoomDocument = (
  kind: DocumentKind,
  direction: number,
  event?: WheelEvent,
) => {
  const target = transformFor(kind);
  const previous = target.value;
  const step = event ? (event.deltaY < 0 ? 0.2 : -0.2) : direction * 0.25;
  const scale = Math.min(4, Math.max(0.25, previous.scale + step));
  if (scale === previous.scale) return;

  let x = previous.x;
  let y = previous.y;
  if (event?.currentTarget instanceof HTMLElement) {
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = event.clientX - rect.left - rect.width / 2;
    const cursorY = event.clientY - rect.top - rect.height / 2;
    const ratio = scale / previous.scale;
    x = cursorX - ratio * (cursorX - previous.x);
    y = cursorY - ratio * (cursorY - previous.y);
  }
  target.value = { scale, x, y };
};

const startDocumentPan = (kind: DocumentKind, event: PointerEvent) => {
  if (event.button !== 0) return;
  const transform = transformFor(kind).value;
  panGesture.value = {
    kind,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: transform.x,
    originY: transform.y,
  };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
};

const moveDocumentPan = (kind: DocumentKind, event: PointerEvent) => {
  const gesture = panGesture.value;
  if (
    !gesture ||
    gesture.kind !== kind ||
    gesture.pointerId !== event.pointerId
  ) {
    return;
  }
  const target = transformFor(kind);
  target.value = {
    ...target.value,
    x: gesture.originX + event.clientX - gesture.startX,
    y: gesture.originY + event.clientY - gesture.startY,
  };
};

const stopDocumentPan = (kind: DocumentKind, event: PointerEvent) => {
  if (panGesture.value?.kind !== kind) return;
  if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }
  panGesture.value = null;
};

const handleDocumentKey = (kind: DocumentKind, event: KeyboardEvent) => {
  if (event.key === "+" || event.key === "=") zoomDocument(kind, 1);
  else if (event.key === "-") zoomDocument(kind, -1);
  else if (event.key === "0") resetDocumentView(kind);
  else if (
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
  ) {
    const target = transformFor(kind);
    const amount = event.shiftKey ? 60 : 24;
    target.value = {
      ...target.value,
      x:
        target.value.x +
        (event.key === "ArrowLeft"
          ? -amount
          : event.key === "ArrowRight"
            ? amount
            : 0),
      y:
        target.value.y +
        (event.key === "ArrowUp"
          ? -amount
          : event.key === "ArrowDown"
            ? amount
            : 0),
    };
  } else return;
  event.preventDefault();
};

const setPreviewMode = (mode: PreviewMode) => {
  if (mode === "compare" && !canCompare.value) return;
  activePreview.value = mode;
  if (
    (mode === "pdf" || mode === "compare") &&
    currentSession.value?.pdfDataUrl &&
    !pdfPageImage.value
  ) {
    void renderPdfPage(pdfPage.value).catch(() => undefined);
  }
};

const selectReference = (value: string | number | null) => {
  const imageId = String(value || "");
  if (
    !currentSession.value?.referenceImages.some((image) => image.id === imageId)
  )
    return;
  activeReferenceId.value = imageId;
  resetDocumentView("reference");
};

const showReference = (imageId: string) => {
  selectReference(imageId);
  setPreviewMode(currentSession.value?.pdfDataUrl ? "compare" : "reference");
};

const safeDownloadName = (name: string, fallback: string) => {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
  return cleaned || fallback;
};

const downloadUrl = (url: string, name: string) => {
  if (!url) return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeDownloadName(name, "template-studio-download");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

const downloadReference = (image = activeReference.value) => {
  if (image) downloadUrl(image.dataUrl, image.name);
};

const downloadPdfPage = () => {
  if (!pdfPageImage.value || !currentSession.value) return;
  downloadUrl(
    pdfPageImage.value,
    `${safeDownloadName(currentSession.value.name, "template")}-page-${pdfPage.value}.jpg`,
  );
};

const downloadPdf = () => {
  const session = currentSession.value;
  if (!session?.pdfDataUrl) return;
  downloadUrl(
    session.pdfDataUrl,
    `${safeDownloadName(session.name, "template")}.pdf`,
  );
};

const downloadImageAsset = (asset: TemplateImageAsset) => {
  downloadUrl(templateImagePreviewUrl(asset), asset.name);
};

const respondToPdfCaptureRequest = async (request: {
  requestId?: string;
  sessionId?: string;
  renderVersion?: number;
  page?: number;
  targetWidth?: number;
}) => {
  if (!request?.requestId || request.sessionId !== currentSession.value?.id) {
    return;
  }
  const response = {
    requestId: request.requestId,
    sessionId: request.sessionId,
    renderVersion: request.renderVersion,
    page: Number(request.page) || 1,
    pageCount: 0,
    width: 0,
    height: 0,
    mimeType: "image/jpeg",
    imageBase64: "",
    error: "",
  };
  try {
    const renderedPage = await renderPdfPage(
      Number(request.page) || 1,
      Math.min(2400, Math.max(800, Number(request.targetWidth) || 1600)),
    );
    response.page = renderedPage.pageNumber;
    response.pageCount = renderedPage.pageCount;
    response.width = renderedPage.width;
    response.height = renderedPage.height;
    response.imageBase64 = renderedPage.dataUrl.replace(
      /^data:image\/jpeg;base64,/,
      "",
    );
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
  }
  await chrome.storage.local.set({
    [TEMPLATE_STUDIO_CAPTURE_RESPONSE_KEY]: response,
  });
};

const selectSession = async (value: string | number | null) => {
  const sessionId = String(value || "");
  if (!sessionId || sessionId === store.value.currentSessionId) return;
  const latest = await loadTemplateSessionStore();
  if (!latest.sessions.some((session) => session.id === sessionId)) return;
  latest.currentSessionId = sessionId;
  store.value = await saveTemplateSessionStore(latest);
  creating.value = false;
  activePreview.value = "pdf";
  editorDirty.value = false;
  briefDirty.value = false;
  hydrateWorkingSession(currentSession.value, true);
  if (workingRecordType.value) void loadRecords(workingRecordType.value);
  resetPdfPreview();
  if (currentSession.value?.pdfDataUrl) {
    void renderPdfPage(1).catch(() => undefined);
  } else {
    void markViewReady();
  }
};

const openSession = async (sessionId: string | number | null) => {
  const requestedId = String(sessionId || "");
  if (!requestedId) return;
  showDashboard.value = false;
  creating.value = false;
  if (requestedId === store.value.currentSessionId) {
    hydrateWorkingSession(currentSession.value, true);
    resetPdfPreview();
    if (currentSession.value?.pdfDataUrl) {
      void renderPdfPage(1).catch(() => undefined);
    } else {
      void markViewReady();
    }
    return;
  }
  await selectSession(requestedId);
};

const openDashboard = () => {
  if (!store.value.sessions.length) {
    startNewSession();
    return;
  }
  creating.value = false;
  showDashboard.value = true;
};

const requestSessionDeletion = (sessionId = currentSession.value?.id || "") => {
  if (!sessionId || deletingSession.value) return;
  deleteFromDashboard.value = showDashboard.value;
  deleteSessionId.value = sessionId;
  deleteDialogVisible.value = true;
};

const confirmSessionDeletion = async () => {
  const session = deletionTarget.value;
  if (!session || deletingSession.value) return;
  deletingSession.value = true;
  try {
    const latest = await loadTemplateSessionStore();
    if (!latest.sessions.some((candidate) => candidate.id === session.id)) {
      throw new Error("This session no longer exists.");
    }
    const updated = deleteTemplateDesignSession(latest, session.id);
    store.value = await saveTemplateSessionStore(updated);
    deleteDialogVisible.value = false;
    deleteSessionId.value = "";
    if (store.value.sessions.length === 0) {
      showDashboard.value = false;
      startNewSession();
    } else {
      creating.value = false;
      showDashboard.value = deleteFromDashboard.value;
    }
    editorDirty.value = false;
    briefDirty.value = false;
    activeReferenceId.value =
      currentSession.value?.referenceImages[0]?.id || "";
    activePreview.value = "pdf";
    resetPdfPreview();
    hydrateWorkingSession(currentSession.value, true);
    if (currentSession.value?.pdfDataUrl) {
      await renderPdfPage(1).catch(() => undefined);
    } else if (currentSession.value) {
      await markViewReady();
    } else {
      await chrome.storage.local.remove(TEMPLATE_STUDIO_VIEW_STATE_KEY);
    }
    toast.add({
      severity: "success",
      summary: "Session deleted",
      detail: `${session.name} and its stored references, images, revisions, and render were removed.`,
      life: 3500,
    });
  } catch (error) {
    toast.add({
      severity: "error",
      summary: "Session was not deleted",
      detail: error instanceof Error ? error.message : String(error),
      life: 4500,
    });
  } finally {
    deletingSession.value = false;
    deleteFromDashboard.value = false;
  }
};

const startNewSession = () => {
  showDashboard.value = false;
  creating.value = true;
  draftName.value = "";
  draftPrompt.value = "";
  draftImages.value = [];
  draftTemplate.value = null;
  draftContextMode.value = "freestyle";
  draftRecordType.value = "";
  draftRecordId.value = "";
};

const commitSession = async () => {
  if (!draftImages.value.length && !draftTemplate.value) {
    toast.add({
      severity: "warn",
      summary: "Starting point required",
      detail: "Add at least one reference image or an existing template file.",
      life: 3200,
    });
    return;
  }
  const startingTemplate = draftTemplate.value;
  const templateName = startingTemplate?.name
    .replace(/\.(?:xml|ftl|html?|txt)$/i, "")
    .trim();
  const referenceName = draftImages.value[0]?.name
    .replace(/\.[^.]+$/, "")
    .trim();
  const latest = await loadTemplateSessionStore();
  const record = records.value.find(
    (option) => option.id === draftRecordId.value,
  );
  const session = createTemplateDesignSession({
    name: draftName.value.trim() || templateName || referenceName || undefined,
    prompt: draftPrompt.value,
    freemarker: startingTemplate?.content,
    templateFileName: startingTemplate?.name,
    referenceImages: draftImages.value,
    contextMode: draftContextMode.value,
    recordType: draftRecordType.value,
    recordId: draftRecordId.value,
    recordLabel: record?.label || "",
    accountId: accountId.value,
  });
  latest.sessions.unshift(session);
  latest.currentSessionId = session.id;
  store.value = await saveTemplateSessionStore(latest);
  creating.value = false;
  hydrateWorkingSession(session, true);
  await chrome.runtime
    .sendMessage({ type: "ENSURE_TEMPLATE_SKILLS" })
    .catch(() => undefined);
  activePreview.value = "pdf";
  resetPdfPreview();
  toast.add({
    severity: "success",
    summary: startingTemplate ? "Template loaded" : "Session committed",
    detail: startingTemplate
      ? "Rendering the uploaded template now so its first page is ready for inspection."
      : "AI can now load the references and begin the FreeMarker design.",
    life: 3500,
  });
  if (startingTemplate) await renderCurrent();
  else void markViewReady();
};

const setBriefDirty = () => {
  briefDirty.value = true;
};

const saveBrief = async () => {
  const session = currentSession.value;
  if (!session) return;
  const record = records.value.find(
    (option) => option.id === workingRecordId.value,
  );
  await updateSession(session.id, (current) => ({
    ...current,
    name: workingName.value.trim() || current.name,
    prompt: workingPrompt.value.trim(),
    contextMode: workingContextMode.value,
    recordType: workingRecordType.value,
    recordId: workingRecordId.value,
    recordLabel: record?.label || current.recordLabel,
    accountId: accountId.value || current.accountId,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  }));
  briefDirty.value = false;
};

const saveFreemarker = async () => {
  const session = currentSession.value;
  if (!session || !workingFreemarker.value.trim()) return;
  const freemarker = workingFreemarker.value;
  if (embeddedImageDataUrlPattern.test(freemarker)) {
    toast.add({
      severity: "warn",
      summary: "Embedded image blocked",
      detail:
        "Add the image in the Images tab and use its mns-asset:// placeholder instead of putting base64 in FreeMarker.",
      life: 5000,
    });
    return;
  }
  await updateSession(session.id, (current) => ({
    ...current,
    freemarker,
    pdfDataUrl: current.freemarker === freemarker ? current.pdfDataUrl : "",
    renderError: "",
    status: "designing",
    sourceVersion:
      current.freemarker === freemarker
        ? current.sourceVersion
        : current.sourceVersion + 1,
    revisions:
      current.freemarker === freemarker
        ? current.revisions
        : [
            makeUserTemplateRevision(freemarker, "Edited in Template Studio"),
            ...current.revisions,
          ].slice(0, 30),
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  }));
  editorDirty.value = false;
};

const renderCurrent = async () => {
  const session = currentSession.value;
  if (!session || rendering.value) return;
  if (editorDirty.value) await saveFreemarker();
  if (briefDirty.value) await saveBrief();
  rendering.value = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "TEMPLATE_DESIGN_SESSION_RENDER",
      sessionId: session.id,
    });
    if (!response?.ok) {
      throw new Error(response?.error || "NetSuite rendering failed.");
    }
    await loadStore(true);
    activePreview.value = "pdf";
    resetPdfPreview();
    if (currentSession.value?.pdfDataUrl) await renderPdfPage(1);
    else await markViewReady();
  } catch (error) {
    toast.add({
      severity: "error",
      summary: "Render failed",
      detail: error instanceof Error ? error.message : String(error),
      life: 5000,
    });
  } finally {
    rendering.value = false;
  }
};

const addFeedback = async () => {
  const session = currentSession.value;
  const text = feedbackText.value.trim();
  if (!session || !text) return;
  await updateSession(session.id, (current) => ({
    ...current,
    feedback: [makeTemplateFeedback(text), ...current.feedback],
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  }));
  feedbackText.value = "";
  toast.add({
    severity: "success",
    summary: "Fix request added",
    detail: "The request is ready for AI in this Template Studio session.",
    life: 2600,
  });
};

const setFeedbackChecked = async (feedbackId: string, checked: boolean) => {
  const session = currentSession.value;
  if (!session) return;
  await updateSession(session.id, (current) => ({
    ...current,
    feedback: current.feedback.map((feedback) =>
      feedback.id === feedbackId
        ? {
            ...feedback,
            checked,
            checkedAt: checked ? new Date().toISOString() : undefined,
          }
        : feedback,
    ),
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  }));
};

const removeFeedback = async (feedbackId: string) => {
  const session = currentSession.value;
  if (!session) return;
  await updateSession(session.id, (current) => ({
    ...current,
    feedback: current.feedback.filter(
      (feedback) => feedback.id !== feedbackId || feedback.checked,
    ),
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  }));
};

const setCompleted = async () => {
  const session = currentSession.value;
  if (!session) return;
  await updateSession(session.id, (current) => ({
    ...current,
    status: current.status === "completed" ? "rendered" : "completed",
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  }));
};

const fileToReference = (file: File): Promise<TemplateReferenceImage> =>
  new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error(`${file.name} is not an image.`));
      return;
    }
    if (file.size > MAX_REFERENCE_BYTES) {
      reject(new Error(`${file.name} is larger than 10 MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () =>
      resolve(
        makeTemplateReferenceImage(
          file.name,
          file.type,
          String(reader.result || ""),
        ),
      );
    reader.readAsDataURL(file);
  });

const addReferenceFiles = async (files: FileList | File[]) => {
  try {
    const images = await Promise.all([...files].map(fileToReference));
    if (creating.value) {
      draftImages.value = [...draftImages.value, ...images].slice(
        0,
        MAX_REFERENCE_IMAGES,
      );
      return;
    }
    const session = currentSession.value;
    if (!session) return;
    await updateSession(session.id, (current) => ({
      ...current,
      referenceImages: [...current.referenceImages, ...images].slice(
        0,
        MAX_REFERENCE_IMAGES,
      ),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    }));
    activeReferenceId.value = images[0]?.id || activeReferenceId.value;
    setPreviewMode(currentSession.value?.pdfDataUrl ? "compare" : "reference");
  } catch (error) {
    toast.add({
      severity: "warn",
      summary: "Reference not added",
      detail: error instanceof Error ? error.message : String(error),
      life: 3500,
    });
  }
};

const handleReferenceInput = (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) void addReferenceFiles(input.files);
  input.value = "";
};

const handleDrop = (event: DragEvent) => {
  if (event.dataTransfer?.files.length) {
    void addReferenceFiles(event.dataTransfer.files);
  }
};

const addTemplateFile = async (file: File) => {
  try {
    if (file.size > MAX_TEMPLATE_SOURCE_BYTES) {
      throw new Error(`${file.name} is larger than 10 MB.`);
    }
    if (!/\.(?:xml|ftl|html?|txt)$/i.test(file.name)) {
      throw new Error(
        "Choose a FreeMarker template with an XML, FTL, HTML, HTM, or TXT extension.",
      );
    }
    const content = (await file.text()).trim();
    if (!content) throw new Error(`${file.name} is empty.`);
    if (embeddedImageDataUrlPattern.test(content)) {
      throw new Error(
        "This template embeds base64 image data. Add those images in the Images tab and use mns-asset:// placeholders instead.",
      );
    }
    if (!/<pdf(?:\s[^>]*)?>/i.test(content) || !/<\/pdf>/i.test(content)) {
      throw new Error(
        "The uploaded file must contain a complete BFO <pdf> document.",
      );
    }
    draftTemplate.value = {
      name: file.name,
      content,
      byteSize: file.size,
    };
  } catch (error) {
    toast.add({
      severity: "warn",
      summary: "Template not added",
      detail: error instanceof Error ? error.message : String(error),
      life: 4500,
    });
  }
};

const handleTemplateInput = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void addTemplateFile(file);
  input.value = "";
};

const handleTemplateDrop = (event: DragEvent) => {
  const file = event.dataTransfer?.files[0];
  if (file) void addTemplateFile(file);
};

const removeReference = async (imageId: string) => {
  if (creating.value) {
    draftImages.value = draftImages.value.filter(
      (image) => image.id !== imageId,
    );
    return;
  }
  const session = currentSession.value;
  if (!session) return;
  await updateSession(session.id, (current) => ({
    ...current,
    referenceImages: current.referenceImages.filter(
      (image) => image.id !== imageId,
    ),
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  }));
  if (activeReferenceId.value === imageId) {
    activeReferenceId.value =
      currentSession.value?.referenceImages[0]?.id || "";
    resetDocumentView("reference");
  }
  if (
    !currentSession.value?.referenceImages.length &&
    activePreview.value !== "images"
  ) {
    activePreview.value = "pdf";
  }
};

const setAssetToolsEnabled = async (enabled: boolean) => {
  const session = currentSession.value;
  if (!session || session.assetToolsEnabled === enabled) return;
  await updateSession(session.id, (current) => ({
    ...current,
    assetToolsEnabled: enabled,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  }));
  toast.add({
    severity: enabled ? "success" : "info",
    summary: `AI asset tools ${enabled ? "enabled" : "disabled"}`,
    detail: enabled
      ? "The AI can list and edit this session's image assets again."
      : "Existing images still render and manual management remains available.",
    life: 3000,
  });
};

const assetMetadata = (asset: TemplateImageAsset) => ({
  id: asset.id,
  name: asset.name,
  placeholder: asset.placeholder,
  kind: asset.kind,
  mimeType: asset.mimeType,
  originalMimeType: asset.originalMimeType,
  source: asset.source,
  width: asset.width,
  height: asset.height,
  byteSize: asset.byteSize,
  createdAt: asset.createdAt,
  updatedAt: asset.updatedAt,
});

const addAssetFiles = async (files: FileList | File[]) => {
  const session = currentSession.value;
  if (!session || assetBusy.value) return;
  assetBusy.value = true;
  try {
    const selected = [...files];
    for (const file of selected) {
      if (file.size > MAX_TEMPLATE_ASSET_SOURCE_BYTES) {
        throw new Error(`${file.name} is larger than 10 MB.`);
      }
    }
    const available = Math.max(
      0,
      MAX_TEMPLATE_IMAGE_ASSETS - session.imageAssets.length,
    );
    if (!available) {
      throw new Error("This session already has 20 template image assets.");
    }
    const addedAssets = await Promise.all(
      selected.slice(0, available).map(fileToTemplateImageAsset),
    );
    await updateSession(session.id, (current) => ({
      ...current,
      imageAssets: [...current.imageAssets, ...addedAssets].slice(
        0,
        MAX_TEMPLATE_IMAGE_ASSETS,
      ),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    }));
    activePreview.value = "images";
    toast.add({
      severity: "success",
      summary: "Template images ready",
      detail: `${addedAssets.length} image${addedAssets.length === 1 ? "" : "s"} added at source quality. SVG renders at print density; PNG and JPEG bytes are preserved.`,
      life: 3500,
    });
  } catch (error) {
    toast.add({
      severity: "warn",
      summary: "Template image not added",
      detail: error instanceof Error ? error.message : String(error),
      life: 4500,
    });
  } finally {
    assetBusy.value = false;
  }
};

const handleAssetInput = (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) void addAssetFiles(input.files);
  input.value = "";
};

const handleAssetDrop = (event: DragEvent) => {
  if (event.dataTransfer?.files.length) {
    void addAssetFiles(event.dataTransfer.files);
  }
};

const copyAssetText = async (
  asset: TemplateImageAsset,
  kind: "placeholder" | "snippet",
) => {
  const text =
    kind === "snippet" ? templateImageSnippet(asset) : asset.placeholder;
  await navigator.clipboard.writeText(text);
  toast.add({
    severity: "success",
    summary: kind === "snippet" ? "Image tag copied" : "Placeholder copied",
    detail: text,
    life: 2400,
  });
};

const assetUsageCount = (asset: TemplateImageAsset) =>
  workingFreemarker.value.split(asset.placeholder).length - 1;

const removeImageAsset = async (asset: TemplateImageAsset) => {
  const session = currentSession.value;
  if (!session) return;
  const usages = assetUsageCount(asset);
  if (
    usages > 0 &&
    !window.confirm(
      `"${asset.name}" is used ${usages} time${usages === 1 ? "" : "s"} in the current FreeMarker source. Remove the asset anyway?`,
    )
  ) {
    return;
  }
  await updateSession(session.id, (current) => ({
    ...current,
    imageAssets: current.imageAssets.filter(
      (candidate) => candidate.id !== asset.id,
    ),
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
  }));
};

const respondToAssetRequest = async (request: {
  requestId?: string;
  operation?: "save_svg" | "rasterize";
  sessionId?: string;
  assetId?: string;
  assetIds?: string[];
  name?: string;
  svg?: string;
  width?: number;
  height?: number;
}) => {
  if (!request?.requestId || !request.sessionId) return;
  const response: Record<string, unknown> = {
    requestId: request.requestId,
    sessionId: request.sessionId,
    error: "",
  };
  try {
    const latest = await loadTemplateSessionStore();
    const index = latest.sessions.findIndex(
      (session) => session.id === request.sessionId,
    );
    if (index < 0) throw new Error("Template session was not found.");
    const session = latest.sessions[index]!;
    if (request.operation === "rasterize") {
      const requestedIds = new Set(
        Array.isArray(request.assetIds) ? request.assetIds.map(String) : [],
      );
      const vectorAssets = session.imageAssets.filter(
        (asset) =>
          asset.kind === "svg" &&
          Boolean(asset.svgSource) &&
          (!requestedIds.size || requestedIds.has(asset.id)),
      );
      const rasterizedAssets: Record<string, unknown>[] = [];
      for (const asset of vectorAssets) {
        rasterizedAssets.push({
          id: asset.id,
          ...(await rasterizeTemplateSvg(
            asset.svgSource || "",
            asset.width,
            asset.height,
          )),
        });
      }
      response.assets = rasterizedAssets;
      await chrome.storage.local.set({
        [TEMPLATE_STUDIO_ASSET_RESPONSE_KEY]: response,
      });
      return;
    }
    if (!session.assetToolsEnabled) {
      throw new Error(
        "AI asset tooling is disabled for this Template Studio session.",
      );
    }
    const existingIndex = request.assetId
      ? session.imageAssets.findIndex((asset) => asset.id === request.assetId)
      : -1;
    if (request.assetId && existingIndex < 0) {
      throw new Error("The SVG asset was not found.");
    }
    if (
      existingIndex >= 0 &&
      session.imageAssets[existingIndex]?.kind !== "svg"
    ) {
      throw new Error("A raster asset cannot be replaced with SVG source.");
    }
    if (
      existingIndex < 0 &&
      session.imageAssets.length >= MAX_TEMPLATE_IMAGE_ASSETS
    ) {
      throw new Error("This session already has 20 template image assets.");
    }
    const generated = svgSourceToTemplateImageAsset(
      request.name || "generated-image.svg",
      String(request.svg || ""),
      {
        width: request.width,
        height: request.height,
        source: "ai_svg",
      },
    );
    const previous =
      existingIndex >= 0 ? session.imageAssets[existingIndex] : undefined;
    const asset: TemplateImageAsset = previous
      ? {
          ...generated,
          id: previous.id,
          placeholder: previous.placeholder,
          createdAt: previous.createdAt,
          updatedAt: new Date().toISOString(),
        }
      : generated;
    const imageAssets = [...session.imageAssets];
    if (existingIndex >= 0) imageAssets[existingIndex] = asset;
    else imageAssets.push(asset);
    latest.sessions[index] = {
      ...session,
      imageAssets,
      version: session.version + 1,
      updatedAt: new Date().toISOString(),
    };
    store.value = await saveTemplateSessionStore(latest);
    hydrateWorkingSession(currentSession.value);
    response.asset = assetMetadata(asset);
    activePreview.value = "images";
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
  }
  await chrome.storage.local.set({
    [TEMPLATE_STUDIO_ASSET_RESPONSE_KEY]: response,
  });
};

const loadRecordTypes = async () => {
  if (recordTypesLoading.value) return;
  recordTypesLoading.value = true;
  contextError.value = "";
  try {
    const rows = normalizeRows(
      (await callApi(RequestRoutes.GET_ALL_RECORD_TYPES)) as ApiResponse,
    );
    recordTypes.value = rows
      .map((row) => {
        const id = String(row.id ?? row.ID ?? row.scriptId ?? "")
          .trim()
          .toLowerCase();
        return {
          id,
          label: String(row.name ?? row.Name ?? row.label ?? id),
        };
      })
      .filter((option) => option.id)
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch (error) {
    contextError.value =
      error instanceof Error ? error.message : "Could not load record types.";
  } finally {
    recordTypesLoading.value = false;
  }
};

async function loadRecords(recordType: string) {
  if (!recordType || recordsLoading.value) return;
  recordsLoading.value = true;
  records.value = [];
  contextError.value = "";
  let lastError = "";
  try {
    for (const sql of recordQueries(recordType)) {
      try {
        const response = (await callApi(
          RequestRoutes.RUN_SUITEQL_QUERY,
          { sql, limit: 100 },
          ApiRequestType.NORMAL,
        )) as ApiResponse;
        const rows = normalizeRows(response);
        records.value = rows
          .map((row) => ({
            id: String(row.id ?? row.ID ?? ""),
            label: rowLabel(row),
          }))
          .filter((option) => option.id);
        if (records.value.length || sql.startsWith("SELECT id FROM")) break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (!records.value.length && lastError) contextError.value = lastError;
  } finally {
    recordsLoading.value = false;
  }
}

const changeContextMode = (value: string | number | null) => {
  const mode = String(value || "freestyle") as TemplateContextMode;
  if (creating.value) {
    draftContextMode.value = mode;
    draftRecordType.value = "";
    draftRecordId.value = "";
  } else {
    workingContextMode.value = mode;
    workingRecordType.value = "";
    workingRecordId.value = "";
    setBriefDirty();
  }
  records.value = [];
};

const changeRecordType = (value: string | number | null) => {
  const recordType = String(value || "");
  if (creating.value) {
    draftRecordType.value = recordType;
    draftRecordId.value = "";
  } else {
    workingRecordType.value = recordType;
    workingRecordId.value = "";
    setBriefDirty();
  }
  if (recordType) void loadRecords(recordType);
};

const changeRecordId = (value: string | number | null) => {
  if (creating.value) draftRecordId.value = String(value || "");
  else {
    workingRecordId.value = String(value || "");
    setBriefDirty();
  }
};

let stopEditorResize: (() => void) | null = null;

const resizeEditor = (delta: number) => {
  editorWidth.value = Math.min(72, Math.max(30, editorWidth.value + delta));
};

const startEditorResize = (event: PointerEvent) => {
  if (event.button !== 0) return;
  event.preventDefault();
  const workspace = (event.currentTarget as HTMLElement).parentElement;
  const sidebar = workspace?.querySelector<HTMLElement>(
    ".collaboration-sidebar",
  );
  const workspaceWidth = Math.max(
    1,
    (workspace?.clientWidth || window.innerWidth) - (sidebar?.offsetWidth || 0),
  );
  const startX = event.clientX;
  const startWidth = editorWidth.value;
  isResizingEditor.value = true;

  const onMove = (moveEvent: PointerEvent) => {
    const deltaPercent = ((moveEvent.clientX - startX) / workspaceWidth) * 100;
    editorWidth.value = Math.min(72, Math.max(30, startWidth + deltaPercent));
  };
  const onUp = () => {
    isResizingEditor.value = false;
    document.body.classList.remove("template-studio-resizing");
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    stopEditorResize = null;
  };

  document.body.classList.add("template-studio-resizing");
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  stopEditorResize = onUp;
};

const storageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => {
  if (areaName !== "local") return;
  const captureRequest = changes[TEMPLATE_STUDIO_CAPTURE_REQUEST_KEY]?.newValue;
  if (captureRequest) void respondToPdfCaptureRequest(captureRequest);
  const assetRequest = changes[TEMPLATE_STUDIO_ASSET_REQUEST_KEY]?.newValue;
  if (assetRequest) void respondToAssetRequest(assetRequest);

  const change = changes[TEMPLATE_SESSION_STORE_KEY];
  if (!change?.newValue) return;
  const previousPdfKey = currentSession.value
    ? `${currentSession.value.id}:${currentSession.value.renderVersion}:${currentSession.value.pdfDataUrl.length}`
    : "";
  store.value = normalizeTemplateSessionStore(change.newValue);
  hydrateWorkingSession(currentSession.value);
  const nextPdfKey = currentSession.value
    ? `${currentSession.value.id}:${currentSession.value.renderVersion}:${currentSession.value.pdfDataUrl.length}`
    : "";
  if (previousPdfKey !== nextPdfKey) {
    resetPdfPreview();
    if (currentSession.value?.pdfDataUrl) {
      void renderPdfPage(1).catch(() => undefined);
    } else {
      void markViewReady();
    }
  } else if (
    currentSession.value &&
    (!currentSession.value.pdfDataUrl ||
      currentSession.value.status === "render_error")
  ) {
    void markViewReady();
  }
};

const runtimeListener = (message: { type?: string; sessionId?: string }) => {
  if (message?.type !== "OPEN_TEMPLATE_STUDIO") return;
  showDashboard.value = false;
  creating.value = false;
  activePreview.value = "pdf";
  void (async () => {
    if (
      message.sessionId &&
      message.sessionId !== store.value.currentSessionId &&
      store.value.sessions.some((session) => session.id === message.sessionId)
    ) {
      await selectSession(message.sessionId);
      return;
    }
    if (currentSession.value?.pdfDataUrl && !pdfPageImage.value) {
      await renderPdfPage(pdfPage.value).catch(() => undefined);
    } else {
      await markViewReady();
    }
  })();
};

watch(
  () => currentSession.value?.id,
  () => hydrateWorkingSession(currentSession.value, true),
);

onMounted(async () => {
  chrome.storage.onChanged.addListener(storageListener);
  chrome.runtime.onMessage.addListener(runtimeListener);
  accountId.value = await getNetsuiteEnvironment().catch(() => "");
  await Promise.all([loadStore(true), loadRecordTypes()]);
  creating.value = store.value.sessions.length === 0;
  showDashboard.value = store.value.sessions.length > 0;
  if (workingRecordType.value) void loadRecords(workingRecordType.value);
  loading.value = false;
  if (currentSession.value?.pdfDataUrl) {
    void renderPdfPage(1).catch(() => undefined);
  } else {
    void markViewReady();
  }
});

onBeforeUnmount(() => {
  stopEditorResize?.();
  chrome.storage.onChanged.removeListener(storageListener);
  chrome.runtime.onMessage.removeListener(runtimeListener);
});
</script>

<template>
  <div class="template-studio">
    <header class="studio-toolbar">
      <div class="studio-title">
        <span class="studio-icon"><i class="pi pi-sparkles"></i></span>
        <div>
          <strong>Template Studio</strong>
          <small>AI + NetSuite FreeMarker workspace</small>
        </div>
      </div>

      <div class="studio-session-picker">
        <MSelect
          :model-value="store.currentSessionId"
          :options="sessionOptions"
          placeholder="No committed sessions"
          searchable
          size="small"
          @update:model-value="openSession"
        />
      </div>

      <span
        v-if="currentSession && !creating && !showDashboard"
        class="current-badge"
      >
        <i class="pi pi-circle-fill"></i>
        Current
      </span>
      <span
        v-if="currentSession && !creating && !showDashboard"
        class="status-badge"
        :class="`status-${currentSession.status}`"
      >
        {{ statusLabel }}
      </span>

      <div class="studio-toolbar-actions">
        <Button
          v-if="store.sessions.length && !showDashboard"
          size="small"
          severity="secondary"
          outlined
          icon="pi pi-home"
          label="Sessions"
          @click="openDashboard"
        />
        <Button
          size="small"
          severity="secondary"
          outlined
          icon="pi pi-eye"
          label="Renderer"
          @click="router.push('/freemarker-renderer')"
        />
        <Button
          v-if="currentSession && !creating && !showDashboard"
          size="small"
          severity="danger"
          outlined
          icon="pi pi-trash"
          label="Delete"
          @click="requestSessionDeletion()"
        />
        <Button
          size="small"
          icon="pi pi-plus"
          label="New session"
          @click="startNewSession"
        />
      </div>
    </header>

    <div v-if="loading" class="studio-empty">
      <i class="pi pi-spin pi-spinner"></i>
      <span>Loading design sessions…</span>
    </div>

    <main v-else-if="showDashboard" class="session-home">
      <header class="session-home-header">
        <div>
          <span class="section-kicker">Template Studio</span>
          <h1>Your design sessions</h1>
          <p>
            Continue a FreeMarker design, compare its latest render, or start a
            new template.
          </p>
        </div>
        <Button
          size="small"
          icon="pi pi-plus"
          label="New session"
          @click="startNewSession"
        />
      </header>

      <div class="session-home-controls">
        <span class="session-search">
          <i class="pi pi-search"></i>
          <InputText
            v-model="sessionSearch"
            placeholder="Search sessions by title…"
            aria-label="Search Template Studio sessions by title"
          />
        </span>
        <MSelect
          v-model="sessionStatusFilter"
          :options="sessionStatusOptions"
          class="session-filter"
          size="small"
          aria-label="Filter Template Studio sessions by status"
        />
        <span class="session-result-count">
          {{ filteredSessions.length }} of {{ store.sessions.length }}
        </span>
      </div>

      <div v-if="filteredSessions.length" class="session-card-grid">
        <article
          v-for="session in filteredSessions"
          :key="session.id"
          class="session-card"
          :class="{ active: session.id === store.currentSessionId }"
          role="button"
          tabindex="0"
          :aria-label="`Open ${session.name}`"
          @click="openSession(session.id)"
          @keydown.enter.prevent="openSession(session.id)"
          @keydown.space.prevent="openSession(session.id)"
        >
          <div class="session-card-preview">
            <img
              v-if="session.referenceImages[0]"
              :src="session.referenceImages[0].dataUrl"
              :alt="`${session.name} reference preview`"
            />
            <div v-else class="session-card-placeholder">
              <i
                :class="session.pdfDataUrl ? 'pi pi-file-pdf' : 'pi pi-code'"
              ></i>
              <span>{{
                session.pdfDataUrl ? "Rendered PDF" : "FreeMarker"
              }}</span>
            </div>
            <span
              class="session-card-status"
              :class="`status-${session.status}`"
            >
              {{ sessionStatusLabel(session.status) }}
            </span>
          </div>
          <div class="session-card-copy">
            <div class="session-card-title-row">
              <strong :title="session.name">{{ session.name }}</strong>
              <button
                type="button"
                class="session-card-delete"
                :aria-label="`Delete ${session.name}`"
                :title="`Delete ${session.name}`"
                @click.stop="requestSessionDeletion(session.id)"
              >
                <i class="pi pi-trash"></i>
              </button>
            </div>
            <p v-if="session.prompt" :title="session.prompt">
              {{ session.prompt }}
            </p>
            <p v-else class="session-card-empty-copy">No design brief yet.</p>
            <div class="session-card-meta">
              <span :title="sessionStartingPoint(session)">
                <i class="pi pi-paperclip"></i>
                {{ sessionStartingPoint(session) }}
              </span>
              <span>
                <i class="pi pi-history"></i>
                {{ formatSessionDate(session.updatedAt) }}
              </span>
            </div>
          </div>
        </article>
      </div>

      <div v-else class="session-search-empty">
        <i class="pi pi-search"></i>
        <strong>No matching sessions</strong>
        <span>Try a different title or status filter.</span>
        <Button
          size="small"
          severity="secondary"
          text
          label="Clear filters"
          @click="
            sessionSearch = '';
            sessionStatusFilter = 'all';
          "
        />
      </div>
    </main>

    <main v-else-if="creating" class="session-creator">
      <section class="creator-copy">
        <div class="section-heading">
          <span class="step-number">1</span>
          <div>
            <strong>Describe the session</strong>
            <small>Both fields are optional and can be refined later.</small>
          </div>
        </div>

        <label class="field">
          <span>Session name · optional</span>
          <InputText
            v-model="draftName"
            placeholder="Modern invoice redesign"
          />
        </label>

        <label class="field field-grow">
          <span>Design prompt · optional</span>
          <Textarea
            v-model="draftPrompt"
            rows="10"
            placeholder="Describe the layout, brand, hierarchy, constraints, and what the final NetSuite PDF should feel like…"
          />
        </label>

        <div class="context-grid">
          <label class="field">
            <span>Render context</span>
            <MSelect
              :model-value="draftContextMode"
              :options="contextModeOptions"
              size="small"
              @update:model-value="changeContextMode"
            />
          </label>
          <label v-if="draftContextMode !== 'freestyle'" class="field">
            <span>Record type</span>
            <MSelect
              :model-value="draftRecordType"
              :options="recordTypeOptions"
              option-label="label"
              option-value="id"
              searchable
              :loading="recordTypesLoading"
              size="small"
              @update:model-value="changeRecordType"
            />
          </label>
          <label v-if="draftContextMode !== 'freestyle'" class="field">
            <span>Record</span>
            <MSelect
              :model-value="draftRecordId"
              :options="recordOptions"
              option-label="label"
              option-value="id"
              searchable
              :loading="recordsLoading"
              size="small"
              @update:model-value="changeRecordId"
            />
          </label>
        </div>
        <small v-if="contextError" class="field-error">{{
          contextError
        }}</small>
      </section>

      <section class="creator-reference">
        <div class="section-heading">
          <span class="step-number">2</span>
          <div>
            <strong>Choose a starting point</strong>
            <small
              >Add reference images, an existing FreeMarker template, or
              both.</small
            >
          </div>
        </div>

        <div class="starting-point-label">
          <span>Reference images</span>
          <small>Up to five PNG, JPEG, or WebP files.</small>
        </div>

        <button
          type="button"
          class="reference-dropzone"
          @click="referenceInput?.click()"
          @dragover.prevent
          @drop.prevent="handleDrop"
        >
          <i class="pi pi-images"></i>
          <strong>Drop design images here</strong>
          <span>or click to choose files</span>
        </button>

        <div v-if="draftImages.length" class="reference-grid">
          <figure v-for="image in draftImages" :key="image.id">
            <img :src="image.dataUrl" :alt="image.name" />
            <figcaption :title="image.name">{{ image.name }}</figcaption>
            <button
              type="button"
              title="Remove reference"
              @click="removeReference(image.id)"
            >
              <i class="pi pi-times"></i>
            </button>
          </figure>
        </div>

        <div class="starting-point-divider"><span>or</span></div>

        <div class="starting-point-label">
          <span>Existing template</span>
          <small>XML, FTL, HTML, or TXT · 10 MB maximum.</small>
        </div>

        <button
          v-if="!draftTemplate"
          type="button"
          class="template-dropzone"
          @click="templateInput?.click()"
          @dragover.prevent
          @drop.prevent="handleTemplateDrop"
        >
          <span class="template-file-icon"
            ><i class="pi pi-file-code"></i
          ></span>
          <span>
            <strong>Use an existing FreeMarker template</strong>
            <small>Drop it here or click to choose a file.</small>
          </span>
        </button>

        <article v-else class="draft-template-card">
          <span class="template-file-icon"
            ><i class="pi pi-file-code"></i
          ></span>
          <div>
            <strong :title="draftTemplate.name">{{
              draftTemplate.name
            }}</strong>
            <small
              >{{ Math.max(1, Math.ceil(draftTemplate.byteSize / 1024)) }} KB ·
              ready to render</small
            >
          </div>
          <button
            type="button"
            title="Remove template"
            @click="draftTemplate = null"
          >
            <i class="pi pi-times"></i>
          </button>
        </article>

        <div class="creator-commit">
          <p>
            {{
              draftTemplate
                ? "The source will render immediately and page one will be prepared for visual inspection."
                : "AI will use the selected references to create the first template."
            }}
          </p>
          <Button
            icon="pi pi-check"
            :label="draftTemplate ? 'Create and render' : 'Create session'"
            :disabled="!draftImages.length && !draftTemplate"
            @click="commitSession"
          />
        </div>
      </section>
    </main>

    <main v-else-if="currentSession" class="studio-workspace">
      <ExpandableSidebar
        class="collaboration-sidebar"
        expanded-width="17rem"
        collapsed-width="2.65rem"
      >
        <template #collapsed>
          <span class="collapsed-panel-icon" title="Design brief">
            <i class="pi pi-file-edit"></i>
          </span>
          <span class="collapsed-panel-icon" title="References">
            <i class="pi pi-images"></i>
            <small>{{ currentSession.referenceImages.length }}</small>
          </span>
          <span class="collapsed-panel-icon" title="Fix requests">
            <i class="pi pi-comments"></i>
            <small>{{ activeFeedback.length }}</small>
          </span>
        </template>
        <aside class="collaboration-panel">
          <section class="panel-section brief-section">
            <div class="panel-heading">
              <strong>Design brief</strong>
              <Button
                size="small"
                severity="secondary"
                text
                icon="pi pi-save"
                title="Save brief"
                :disabled="!briefDirty"
                @click="saveBrief"
              />
            </div>
            <InputText
              v-model="workingName"
              class="compact-input"
              @input="setBriefDirty"
            />
            <Textarea
              v-model="workingPrompt"
              rows="5"
              class="compact-textarea"
              @input="setBriefDirty"
            />

            <MSelect
              :model-value="workingContextMode"
              :options="contextModeOptions"
              size="small"
              @update:model-value="changeContextMode"
            />
            <MSelect
              v-if="hasRecordContext"
              :model-value="workingRecordType"
              :options="recordTypeOptions"
              option-label="label"
              option-value="id"
              searchable
              :loading="recordTypesLoading"
              size="small"
              placeholder="Record type"
              @update:model-value="changeRecordType"
            />
            <MSelect
              v-if="hasRecordContext"
              :model-value="workingRecordId"
              :options="recordOptions"
              option-label="label"
              option-value="id"
              searchable
              :loading="recordsLoading"
              size="small"
              placeholder="Record"
              @update:model-value="changeRecordId"
            />
            <small v-if="contextError" class="field-error">{{
              contextError
            }}</small>
          </section>

          <section class="panel-section">
            <div class="panel-heading">
              <strong>References</strong>
              <button
                type="button"
                class="icon-action"
                title="Add reference image"
                @click="referenceInput?.click()"
              >
                <i class="pi pi-plus"></i>
              </button>
            </div>
            <div
              v-if="currentSession.referenceImages.length"
              class="reference-strip"
            >
              <button
                v-for="image in currentSession.referenceImages"
                :key="image.id"
                type="button"
                :title="image.name"
                :class="{ active: activeReference?.id === image.id }"
                @click="showReference(image.id)"
              >
                <img :src="image.dataUrl" :alt="image.name" />
              </button>
            </div>
            <button
              v-else
              type="button"
              class="mini-dropzone"
              @click="referenceInput?.click()"
              @dragover.prevent
              @drop.prevent="handleDrop"
            >
              <i class="pi pi-image"></i>
              Add reference
            </button>
          </section>

          <section class="panel-section feedback-section">
            <div class="panel-heading">
              <strong>Fix requests</strong>
              <span v-if="activeFeedback.length"
                >{{ activeFeedback.length }} todo</span
              >
            </div>
            <Textarea
              v-model="feedbackText"
              rows="3"
              class="compact-textarea"
              placeholder="Describe the next correction for AI…"
              @keydown.ctrl.enter.prevent="addFeedback"
            />
            <Button
              size="small"
              icon="pi pi-send"
              label="Add request"
              :disabled="!feedbackText.trim()"
              @click="addFeedback"
            />

            <div class="feedback-list">
              <article
                v-for="feedback in activeFeedback"
                :key="feedback.id"
                class="feedback-item"
                :class="{ 'feedback-open': feedback.status === 'open' }"
              >
                <div class="feedback-todo-row">
                  <input
                    type="checkbox"
                    :checked="feedback.checked"
                    :aria-label="`Mark fix request complete: ${feedback.text}`"
                    @change="setFeedbackChecked(feedback.id, true)"
                  />
                  <span :title="feedback.text">{{ feedback.text }}</span>
                  <button
                    type="button"
                    class="feedback-remove"
                    title="Remove unchecked fix request"
                    @click="removeFeedback(feedback.id)"
                  >
                    <i class="pi pi-times"></i>
                  </button>
                </div>
                <small>
                  {{
                    feedback.status === "addressed"
                      ? "Addressed · awaiting your check"
                      : new Date(feedback.createdAt).toLocaleString()
                  }}
                </small>
                <details
                  v-if="feedback.status === 'addressed'"
                  class="feedback-response"
                >
                  <summary>AI response</summary>
                  <p>
                    {{
                      feedback.response ||
                      "Marked addressed without a written response."
                    }}
                  </p>
                </details>
              </article>
              <details v-if="checkedFeedback.length" class="feedback-history">
                <summary>{{ checkedFeedback.length }} checked history</summary>
                <article
                  v-for="feedback in checkedFeedback"
                  :key="feedback.id"
                  class="feedback-item feedback-checked"
                >
                  <div class="feedback-todo-row">
                    <input
                      type="checkbox"
                      checked
                      :aria-label="`Restore fix request: ${feedback.text}`"
                      @change="setFeedbackChecked(feedback.id, false)"
                    />
                    <span :title="feedback.text">{{ feedback.text }}</span>
                  </div>
                  <small v-if="feedback.checkedAt">
                    Checked
                    {{ new Date(feedback.checkedAt).toLocaleString() }}
                  </small>
                  <details
                    v-if="feedback.status === 'addressed'"
                    class="feedback-response"
                  >
                    <summary>Addressed response</summary>
                    <p>
                      {{
                        feedback.response ||
                        "Marked addressed without a written response."
                      }}
                    </p>
                  </details>
                </article>
              </details>
            </div>
          </section>
        </aside>
      </ExpandableSidebar>

      <section class="design-pane" :style="{ flexBasis: `${editorWidth}%` }">
        <div class="pane-toolbar">
          <div>
            <strong>FreeMarker</strong>
            <span v-if="editorDirty">Unsaved changes</span>
            <span v-else
              >Revision {{ currentSession.revisions.length || 1 }}</span
            >
          </div>
          <div class="pane-actions">
            <Button
              size="small"
              severity="secondary"
              outlined
              icon="pi pi-save"
              label="Save"
              :disabled="!editorDirty"
              @click="saveFreemarker"
            />
            <Button
              size="small"
              icon="pi pi-play"
              :label="rendering ? 'Rendering…' : 'Render'"
              :loading="rendering"
              :disabled="rendering || !workingFreemarker.trim()"
              @click="renderCurrent"
            />
          </div>
        </div>

        <div v-if="!workingFreemarker && !editorDirty" class="editor-empty">
          <i class="pi pi-sparkles"></i>
          <strong>Ready for AI</strong>
          <span
            >Ask AI to begin the current Template Studio session. The first
            FreeMarker revision will appear here.</span
          >
        </div>
        <MonacoCodeEditor
          v-else
          v-model="workingFreemarker"
          language="xml"
          :readonly="rendering"
          :config="{ autoSizing: true, minimap: true, validateTags: false }"
          @update:model-value="editorDirty = true"
          @ctrl-enter="renderCurrent"
        />
      </section>

      <div
        class="editor-resize-handle"
        :class="{ active: isResizingEditor }"
        role="separator"
        tabindex="0"
        aria-label="Resize FreeMarker editor and preview panels"
        aria-orientation="vertical"
        :aria-valuenow="Math.round(editorWidth)"
        aria-valuemin="30"
        aria-valuemax="72"
        @pointerdown="startEditorResize"
        @keydown.left.prevent="resizeEditor(-2)"
        @keydown.right.prevent="resizeEditor(2)"
      >
        <span></span>
      </div>

      <section class="preview-pane">
        <div class="pane-toolbar">
          <div class="preview-tabs">
            <button
              type="button"
              :class="{ active: activePreview === 'pdf' }"
              @click="setPreviewMode('pdf')"
            >
              PDF
            </button>
            <button
              type="button"
              :class="{ active: activePreview === 'reference' }"
              :disabled="!currentSession.referenceImages.length"
              @click="setPreviewMode('reference')"
            >
              Reference
            </button>
            <button
              type="button"
              :class="{ active: activePreview === 'compare' }"
              :disabled="!canCompare"
              title="View the rendered PDF and selected reference side by side"
              @click="setPreviewMode('compare')"
            >
              Compare
            </button>
            <button
              type="button"
              :class="{ active: activePreview === 'images' }"
              @click="setPreviewMode('images')"
            >
              Images
              <span v-if="currentSession.imageAssets.length">{{
                currentSession.imageAssets.length
              }}</span>
            </button>
          </div>
          <div class="preview-actions">
            <div
              v-if="
                (activePreview === 'pdf' || activePreview === 'compare') &&
                pdfPageCount > 0
              "
              class="pdf-page-controls"
            >
              <Button
                size="small"
                severity="secondary"
                text
                icon="pi pi-chevron-left"
                aria-label="Previous PDF page"
                :disabled="pdfPageRendering || pdfPage <= 1"
                @click="changePdfPage(pdfPage - 1)"
              />
              <MSelect
                :model-value="pdfPage"
                :options="pdfPageOptions"
                size="small"
                class="pdf-page-select"
                @update:model-value="changePdfPage"
              />
              <span>{{ pdfPage }} / {{ pdfPageCount }}</span>
              <Button
                size="small"
                severity="secondary"
                text
                icon="pi pi-chevron-right"
                aria-label="Next PDF page"
                :disabled="pdfPageRendering || pdfPage >= pdfPageCount"
                @click="changePdfPage(pdfPage + 1)"
              />
            </div>
            <MSelect
              v-if="
                (activePreview === 'reference' ||
                  activePreview === 'compare') &&
                referenceOptions.length > 1
              "
              :model-value="activeReference?.id"
              :options="referenceOptions"
              size="small"
              class="reference-select"
              @update:model-value="selectReference"
            />
            <div
              v-if="activePreview === 'pdf' && pdfPageImage"
              class="document-controls"
              aria-label="PDF zoom controls"
            >
              <Button
                size="small"
                severity="secondary"
                text
                icon="pi pi-minus"
                aria-label="Zoom PDF out"
                @click="zoomDocument('pdf', -1)"
              />
              <button
                type="button"
                class="zoom-value"
                title="Reset PDF zoom and position"
                @click="resetDocumentView('pdf')"
              >
                {{ Math.round(pdfTransform.scale * 100) }}%
              </button>
              <Button
                size="small"
                severity="secondary"
                text
                icon="pi pi-plus"
                aria-label="Zoom PDF in"
                @click="zoomDocument('pdf', 1)"
              />
              <Button
                size="small"
                severity="secondary"
                text
                icon="pi pi-download"
                aria-label="Download rendered PDF page as an image"
                title="Download this page as JPG"
                @click="downloadPdfPage"
              />
              <Button
                size="small"
                severity="secondary"
                text
                icon="pi pi-file-export"
                aria-label="Download PDF"
                title="Download PDF"
                @click="downloadPdf"
              />
            </div>
            <div
              v-if="activePreview === 'reference' && activeReference"
              class="document-controls"
              aria-label="Reference zoom controls"
            >
              <Button
                size="small"
                severity="secondary"
                text
                icon="pi pi-minus"
                aria-label="Zoom reference out"
                @click="zoomDocument('reference', -1)"
              />
              <button
                type="button"
                class="zoom-value"
                title="Reset reference zoom and position"
                @click="resetDocumentView('reference')"
              >
                {{ Math.round(referenceTransform.scale * 100) }}%
              </button>
              <Button
                size="small"
                severity="secondary"
                text
                icon="pi pi-plus"
                aria-label="Zoom reference in"
                @click="zoomDocument('reference', 1)"
              />
              <Button
                size="small"
                severity="secondary"
                text
                icon="pi pi-download"
                aria-label="Download reference image"
                title="Download reference image"
                @click="downloadReference()"
              />
              <Button
                size="small"
                severity="danger"
                text
                icon="pi pi-trash"
                aria-label="Remove reference image"
                title="Remove reference image"
                @click="removeReference(activeReference.id)"
              />
            </div>
            <Button
              v-if="activePreview === 'images'"
              size="small"
              severity="secondary"
              outlined
              icon="pi pi-upload"
              :label="assetBusy ? 'Adding…' : 'Add image'"
              :loading="assetBusy"
              @click="assetInput?.click()"
            />
            <Button
              size="small"
              severity="secondary"
              text
              :icon="
                currentSession.status === 'completed'
                  ? 'pi pi-replay'
                  : 'pi pi-check-circle'
              "
              :label="
                currentSession.status === 'completed'
                  ? 'Reopen'
                  : 'Mark complete'
              "
              @click="setCompleted"
            />
          </div>
        </div>

        <div
          v-if="activePreview === 'pdf' && currentSession.renderError"
          class="preview-message preview-error"
        >
          <i class="pi pi-exclamation-triangle"></i>
          <strong>NetSuite could not render this revision</strong>
          <pre>{{ currentSession.renderError }}</pre>
        </div>
        <div
          v-else-if="
            activePreview === 'pdf' && !currentSession.pdfDataUrl && rendering
          "
          class="preview-message"
        >
          <i class="pi pi-spin pi-spinner"></i>
          <strong>Rendering with NetSuite…</strong>
        </div>
        <div
          v-else-if="activePreview === 'pdf' && !currentSession.pdfDataUrl"
          class="preview-message"
        >
          <i class="pi pi-file-pdf"></i>
          <strong>No render yet</strong>
          <span>AI or you can render after saving a FreeMarker revision.</span>
        </div>
        <div
          v-else-if="activePreview === 'pdf' && pdfPreviewError"
          class="preview-message preview-error"
        >
          <i class="pi pi-exclamation-triangle"></i>
          <strong>PDF page could not be rasterized</strong>
          <pre>{{ pdfPreviewError }}</pre>
        </div>
        <div
          v-else-if="activePreview === 'pdf' && !pdfPageImage"
          class="preview-message"
        >
          <i class="pi pi-spin pi-spinner"></i>
          <strong>Rendering full PDF page…</strong>
          <span>The preview is generated directly from the PDF bytes.</span>
        </div>
        <div
          v-else-if="activePreview === 'pdf'"
          class="document-viewport"
          :class="{ panning: panGesture?.kind === 'pdf' }"
          tabindex="0"
          aria-label="Rendered PDF page. Drag to pan, use the mouse wheel or plus and minus buttons to zoom."
          @wheel.prevent="zoomDocument('pdf', 0, $event)"
          @pointerdown="startDocumentPan('pdf', $event)"
          @pointermove="moveDocumentPan('pdf', $event)"
          @pointerup="stopDocumentPan('pdf', $event)"
          @pointercancel="stopDocumentPan('pdf', $event)"
          @keydown="handleDocumentKey('pdf', $event)"
          @dblclick="resetDocumentView('pdf')"
        >
          <img
            class="document-canvas pdf-page-image"
            :src="pdfPageImage"
            :alt="`Rendered PDF page ${pdfPage} of ${pdfPageCount}`"
            :style="documentTransformStyle('pdf')"
            draggable="false"
          />
          <span class="viewport-help"
            >Drag to pan · Wheel to zoom · Double-click to reset</span
          >
        </div>

        <div
          v-else-if="activePreview === 'reference'"
          class="document-viewport"
          :class="{ panning: panGesture?.kind === 'reference' }"
          tabindex="0"
          aria-label="Reference image. Drag to pan, use the mouse wheel or plus and minus buttons to zoom."
          @wheel.prevent="zoomDocument('reference', 0, $event)"
          @pointerdown="startDocumentPan('reference', $event)"
          @pointermove="moveDocumentPan('reference', $event)"
          @pointerup="stopDocumentPan('reference', $event)"
          @pointercancel="stopDocumentPan('reference', $event)"
          @keydown="handleDocumentKey('reference', $event)"
          @dblclick="resetDocumentView('reference')"
        >
          <img
            v-if="activeReference"
            class="document-canvas reference-image"
            :src="activeReference.dataUrl"
            :alt="activeReference.name"
            :style="documentTransformStyle('reference')"
            draggable="false"
          />
          <span class="viewport-help"
            >Drag to pan · Wheel to zoom · Double-click to reset</span
          >
        </div>

        <div v-else-if="activePreview === 'compare'" class="comparison-view">
          <section class="comparison-document">
            <header class="comparison-header">
              <div>
                <strong>Rendered PDF</strong>
                <span>Page {{ pdfPage }} of {{ pdfPageCount }}</span>
              </div>
              <div class="document-controls">
                <Button
                  size="small"
                  severity="secondary"
                  text
                  icon="pi pi-minus"
                  aria-label="Zoom PDF out"
                  @click="zoomDocument('pdf', -1)"
                />
                <button
                  type="button"
                  class="zoom-value"
                  title="Reset PDF zoom and position"
                  @click="resetDocumentView('pdf')"
                >
                  {{ Math.round(pdfTransform.scale * 100) }}%
                </button>
                <Button
                  size="small"
                  severity="secondary"
                  text
                  icon="pi pi-plus"
                  aria-label="Zoom PDF in"
                  @click="zoomDocument('pdf', 1)"
                />
                <Button
                  size="small"
                  severity="secondary"
                  text
                  icon="pi pi-download"
                  aria-label="Download rendered PDF page as an image"
                  title="Download page as JPG"
                  @click="downloadPdfPage"
                />
              </div>
            </header>
            <div
              class="document-viewport compare-viewport"
              :class="{ panning: panGesture?.kind === 'pdf' }"
              tabindex="0"
              aria-label="Rendered PDF comparison pane. Drag to pan and use the mouse wheel to zoom."
              @wheel.prevent="zoomDocument('pdf', 0, $event)"
              @pointerdown="startDocumentPan('pdf', $event)"
              @pointermove="moveDocumentPan('pdf', $event)"
              @pointerup="stopDocumentPan('pdf', $event)"
              @pointercancel="stopDocumentPan('pdf', $event)"
              @keydown="handleDocumentKey('pdf', $event)"
              @dblclick="resetDocumentView('pdf')"
            >
              <img
                v-if="pdfPageImage"
                class="document-canvas pdf-page-image"
                :src="pdfPageImage"
                :alt="`Rendered PDF page ${pdfPage} of ${pdfPageCount}`"
                :style="documentTransformStyle('pdf')"
                draggable="false"
              />
              <div v-else-if="pdfPreviewError" class="comparison-error">
                <i class="pi pi-exclamation-triangle"></i>
                <span>{{ pdfPreviewError }}</span>
              </div>
              <i v-else class="pi pi-spin pi-spinner comparison-spinner"></i>
            </div>
          </section>

          <section class="comparison-document">
            <header class="comparison-header">
              <div>
                <strong :title="activeReference?.name">Reference</strong>
                <span :title="activeReference?.name">{{
                  activeReference?.name
                }}</span>
              </div>
              <div class="document-controls">
                <Button
                  size="small"
                  severity="secondary"
                  text
                  icon="pi pi-minus"
                  aria-label="Zoom reference out"
                  @click="zoomDocument('reference', -1)"
                />
                <button
                  type="button"
                  class="zoom-value"
                  title="Reset reference zoom and position"
                  @click="resetDocumentView('reference')"
                >
                  {{ Math.round(referenceTransform.scale * 100) }}%
                </button>
                <Button
                  size="small"
                  severity="secondary"
                  text
                  icon="pi pi-plus"
                  aria-label="Zoom reference in"
                  @click="zoomDocument('reference', 1)"
                />
                <Button
                  size="small"
                  severity="secondary"
                  text
                  icon="pi pi-download"
                  aria-label="Download reference image"
                  title="Download reference image"
                  @click="downloadReference()"
                />
              </div>
            </header>
            <div
              class="document-viewport compare-viewport"
              :class="{ panning: panGesture?.kind === 'reference' }"
              tabindex="0"
              aria-label="Reference comparison pane. Drag to pan and use the mouse wheel to zoom."
              @wheel.prevent="zoomDocument('reference', 0, $event)"
              @pointerdown="startDocumentPan('reference', $event)"
              @pointermove="moveDocumentPan('reference', $event)"
              @pointerup="stopDocumentPan('reference', $event)"
              @pointercancel="stopDocumentPan('reference', $event)"
              @keydown="handleDocumentKey('reference', $event)"
              @dblclick="resetDocumentView('reference')"
            >
              <img
                v-if="activeReference"
                class="document-canvas reference-image"
                :src="activeReference.dataUrl"
                :alt="activeReference.name"
                :style="documentTransformStyle('reference')"
                draggable="false"
              />
            </div>
          </section>
          <section class="compare-feedback-composer">
            <div class="compare-feedback-copy">
              <span class="compare-feedback-icon"
                ><i class="pi pi-comments"></i
              ></span>
              <div>
                <strong>Send a fix request to AI</strong>
                <span>
                  Describe what differs while both documents are in view.
                  Ctrl+Enter submits.
                </span>
              </div>
            </div>
            <Textarea
              v-model="feedbackText"
              rows="2"
              class="compare-feedback-input"
              placeholder="What should change in the rendered PDF?"
              aria-label="Fix request based on the PDF and reference comparison"
              @keydown.ctrl.enter.prevent="addFeedback"
            />
            <Button
              size="small"
              icon="pi pi-send"
              label="Submit fix"
              :disabled="!feedbackText.trim()"
              @click="addFeedback"
            />
          </section>
        </div>

        <div
          v-else
          class="asset-library"
          @dragover.prevent
          @drop.prevent="handleAssetDrop"
        >
          <div class="asset-tool-control">
            <div>
              <strong>AI asset tools</strong>
              <span>
                {{
                  currentSession.assetToolsEnabled
                    ? "AI can inspect and edit this session's asset library."
                    : "AI asset calls are blocked. Existing images still render."
                }}
              </span>
            </div>
            <label>
              <span>{{
                currentSession.assetToolsEnabled ? "Enabled" : "Disabled"
              }}</span>
              <ToggleSwitch
                :model-value="currentSession.assetToolsEnabled"
                aria-label="Allow AI asset tools for this session"
                @update:model-value="setAssetToolsEnabled"
              />
            </label>
          </div>
          <button
            v-if="!currentSession.imageAssets.length"
            type="button"
            class="asset-empty"
            @click="assetInput?.click()"
          >
            <i class="pi pi-images"></i>
            <strong>Add template images</strong>
            <span>
              Drop or choose SVG, PNG, JPEG, or WebP. SVG renders at print
              density; PNG and JPEG keep their original resolution. Image bytes
              stay outside the FreeMarker editor.
            </span>
          </button>
          <div v-else class="asset-grid">
            <article
              v-for="asset in currentSession.imageAssets"
              :key="asset.id"
              class="asset-card"
            >
              <div class="asset-preview">
                <img :src="templateImagePreviewUrl(asset)" :alt="asset.name" />
                <span>{{
                  asset.kind === "svg"
                    ? "SVG · up to 4× render"
                    : asset.mimeType === "image/jpeg"
                      ? "JPG · original"
                      : "PNG · original"
                }}</span>
              </div>
              <div class="asset-copy">
                <strong :title="asset.name">{{ asset.name }}</strong>
                <small>
                  {{ asset.width }}×{{ asset.height }} ·
                  {{ Math.max(1, Math.round(asset.byteSize / 1024)) }} KB ·
                  {{ asset.kind === "svg" ? "editable vector" : "raster" }} ·
                  {{ assetUsageCount(asset) }} use{{
                    assetUsageCount(asset) === 1 ? "" : "s"
                  }}
                </small>
                <code :title="asset.placeholder">{{ asset.placeholder }}</code>
              </div>
              <div class="asset-actions">
                <Button
                  size="small"
                  severity="secondary"
                  text
                  icon="pi pi-copy"
                  label="Placeholder"
                  @click="copyAssetText(asset, 'placeholder')"
                />
                <Button
                  size="small"
                  severity="secondary"
                  text
                  icon="pi pi-code"
                  label="Image tag"
                  @click="copyAssetText(asset, 'snippet')"
                />
                <Button
                  size="small"
                  severity="secondary"
                  text
                  icon="pi pi-download"
                  aria-label="Download template image"
                  title="Download image"
                  @click="downloadImageAsset(asset)"
                />
                <Button
                  size="small"
                  severity="danger"
                  text
                  icon="pi pi-trash"
                  aria-label="Remove template image"
                  @click="removeImageAsset(asset)"
                />
              </div>
            </article>
          </div>
          <div v-if="currentSession.imageAssets.length" class="asset-drop-hint">
            <i class="pi pi-upload"></i>
            Drop more SVG or raster images anywhere in this tab
          </div>
        </div>
      </section>
    </main>

    <div v-else class="studio-empty">
      <i class="pi pi-sparkles"></i>
      <strong>No design session</strong>
      <Button label="Create the first session" @click="startNewSession" />
    </div>

    <Dialog
      v-model:visible="deleteDialogVisible"
      modal
      header="Delete Template Studio session?"
      :closable="!deletingSession"
      :close-on-escape="!deletingSession"
      :style="{ width: 'min(28rem, calc(100vw - 2rem))' }"
    >
      <div class="delete-session-copy">
        <span class="delete-session-icon"><i class="pi pi-trash"></i></span>
        <div>
          <strong>{{ deletionTarget?.name }}</strong>
          <p>
            This permanently removes the session, its source history, fix
            requests, references, image assets, and rendered PDF from local
            extension storage.
          </p>
          <small v-if="editorDirty || briefDirty">
            Unsaved editor or brief changes will also be discarded.
          </small>
        </div>
      </div>
      <template #footer>
        <Button
          size="small"
          severity="secondary"
          outlined
          label="Cancel"
          :disabled="deletingSession"
          @click="deleteDialogVisible = false"
        />
        <Button
          size="small"
          severity="danger"
          icon="pi pi-trash"
          :label="deletingSession ? 'Deleting…' : 'Delete session'"
          :loading="deletingSession"
          @click="confirmSessionDeletion"
        />
      </template>
    </Dialog>

    <input
      ref="referenceInput"
      class="hidden-input"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      multiple
      @change="handleReferenceInput"
    />
    <input
      ref="assetInput"
      class="hidden-input"
      type="file"
      accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp"
      multiple
      @change="handleAssetInput"
    />
    <input
      ref="templateInput"
      class="hidden-input"
      type="file"
      accept=".xml,.ftl,.html,.htm,.txt,application/xml,text/xml,text/html,text/plain"
      @change="handleTemplateInput"
    />
  </div>
</template>

<style scoped>
.template-studio {
  --studio-accent: #4f46e5;
  --studio-accent-border: #a5b4fc;
  --studio-accent-surface: #f1f4fe;
  --studio-icon-surface: #e0e7ff;
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.375rem;
  background: var(--p-slate-50);
  color: var(--p-slate-700);
}

.studio-toolbar {
  display: flex;
  min-height: 3.25rem;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.65rem;
  border-bottom: 1px solid var(--p-slate-200);
  background: white;
  padding: 0.5rem 0.65rem;
}

.studio-title {
  display: flex;
  min-width: 12rem;
  align-items: center;
  gap: 0.55rem;
}

.studio-title > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.studio-title strong {
  font-size: 0.82rem;
}

.studio-title small {
  overflow: hidden;
  color: var(--p-slate-400);
  font-size: 0.64rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-icon {
  display: inline-flex;
  width: 1.9rem;
  height: 1.9rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 0.35rem;
  background: var(--studio-icon-surface);
  color: var(--studio-accent);
}

.studio-session-picker {
  width: min(22rem, 30vw);
}

.current-badge,
.status-badge {
  display: inline-flex;
  height: 1.65rem;
  align-items: center;
  gap: 0.3rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 999px;
  background: var(--p-slate-50);
  padding: 0 0.5rem;
  font-size: 0.63rem;
  white-space: nowrap;
}

.current-badge {
  border-color: var(--studio-accent-border);
  background: var(--studio-accent-surface);
  color: var(--studio-accent);
}

.current-badge i {
  font-size: 0.42rem;
}

.status-rendering {
  color: var(--p-blue-600);
}

.status-render_error {
  border-color: var(--p-red-200);
  background: var(--p-red-50);
  color: var(--p-red-600);
}

.status-completed {
  border-color: var(--p-green-200);
  background: var(--p-green-50);
  color: var(--p-green-700);
}

.studio-toolbar-actions {
  display: flex;
  margin-left: auto;
  flex: 0 0 auto;
  gap: 0.4rem;
}

.session-home {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.7rem;
  overflow: auto;
  padding: 0.85rem;
}

.session-home-header {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 0.15rem 0 0.75rem;
}

.session-home-header > div {
  min-width: 0;
}

.section-kicker {
  color: var(--studio-accent);
  font-size: 0.6rem;
  font-weight: 750;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.session-home-header h1 {
  margin: 0.18rem 0 0;
  color: var(--p-slate-800);
  font-size: 1.15rem;
  line-height: 1.25;
}

.session-home-header p {
  margin: 0.2rem 0 0;
  color: var(--p-slate-500);
  font-size: 0.68rem;
}

.session-home-controls {
  display: flex;
  min-height: 2.15rem;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.45rem;
}

.session-search {
  position: relative;
  display: flex;
  width: min(24rem, 48vw);
  align-items: center;
}

.session-search > i {
  position: absolute;
  left: 0.6rem;
  z-index: 1;
  color: var(--p-slate-400);
  font-size: 0.7rem;
  pointer-events: none;
}

.session-search :deep(.p-inputtext) {
  width: 100%;
  padding-left: 1.75rem;
}

.session-filter {
  width: 9.5rem;
}

.session-result-count {
  margin-left: auto;
  color: var(--p-slate-400);
  font-size: 0.62rem;
  white-space: nowrap;
}

.session-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15.5rem, 1fr));
  gap: 0.65rem;
}

.session-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.35rem;
  background: white;
  cursor: pointer;
  transition:
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.session-card:hover,
.session-card:focus-visible {
  border-color: var(--studio-accent-border);
  outline: none;
  box-shadow: 0 2px 8px rgb(15 23 42 / 10%);
}

.session-card.active {
  border-color: var(--studio-accent-border);
  outline: 1px solid var(--studio-accent-border);
  outline-offset: -1px;
}

.session-card-preview {
  position: relative;
  display: flex;
  height: 7.5rem;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-bottom: 1px solid var(--p-slate-100);
  background: var(--p-slate-100);
}

.session-card-preview > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.session-card-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  color: var(--p-slate-400);
  font-size: 0.62rem;
}

.session-card-placeholder i {
  color: var(--studio-accent);
  font-size: 1.35rem;
}

.session-card-status {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 999px;
  background: rgb(255 255 255 / 92%);
  color: var(--p-slate-600);
  padding: 0.12rem 0.38rem;
  font-size: 0.55rem;
  font-weight: 700;
}

.session-card-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.55rem;
}

.session-card-title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.4rem;
}

.session-card-title-row strong {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--p-slate-800);
  font-size: 0.74rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-card-delete {
  display: inline-flex;
  width: 1.55rem;
  height: 1.55rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--p-slate-400);
  cursor: pointer;
}

.session-card-delete:hover,
.session-card-delete:focus-visible {
  border-color: var(--p-red-200);
  background: var(--p-red-50);
  color: var(--p-red-600);
  outline: none;
}

.session-card-copy > p {
  min-height: 1.9rem;
  margin: 0;
  overflow: hidden;
  color: var(--p-slate-500);
  display: -webkit-box;
  font-size: 0.63rem;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.session-card-empty-copy {
  color: var(--p-slate-400) !important;
  font-style: italic;
}

.session-card-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
  border-top: 1px solid var(--p-slate-100);
  padding-top: 0.35rem;
}

.session-card-meta span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.25rem;
  overflow: hidden;
  color: var(--p-slate-400);
  font-size: 0.55rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-card-meta span:first-child {
  flex: 1;
}

.session-search-empty {
  display: flex;
  min-height: 12rem;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  color: var(--p-slate-400);
  text-align: center;
}

.session-search-empty > i {
  color: var(--studio-accent);
  font-size: 1.35rem;
}

.session-search-empty strong {
  color: var(--p-slate-700);
  font-size: 0.75rem;
}

.session-search-empty span {
  font-size: 0.64rem;
}

.session-creator {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(22rem, 1fr) minmax(20rem, 0.8fr);
  gap: 0.75rem;
  overflow: auto;
  padding: 0.75rem;
}

.creator-copy,
.creator-reference {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 0.7rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.375rem;
  background: white;
  padding: 0.85rem;
}

.section-heading {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  border-bottom: 1px solid var(--p-slate-100);
  padding-bottom: 0.65rem;
}

.section-heading > div {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.section-heading strong {
  font-size: 0.82rem;
}

.section-heading small {
  color: var(--p-slate-400);
  font-size: 0.68rem;
}

.step-number {
  display: inline-flex;
  width: 1.7rem;
  height: 1.7rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.35rem;
  background: var(--studio-icon-surface);
  color: var(--studio-accent);
  font-size: 0.72rem;
  font-weight: 700;
}

.field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.3rem;
}

.field > span {
  color: var(--p-slate-500);
  font-size: 0.66rem;
  font-weight: 600;
}

.field-grow {
  flex: 1;
}

.field-grow :deep(textarea) {
  min-height: 10rem;
  resize: vertical;
}

.context-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
}

.field-error {
  color: var(--p-red-600);
  font-size: 0.65rem;
}

.starting-point-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
}

.starting-point-label span {
  color: var(--p-slate-600);
  font-size: 0.68rem;
  font-weight: 700;
}

.starting-point-label small {
  color: var(--p-slate-400);
  font-size: 0.62rem;
}

.reference-dropzone,
.mini-dropzone {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--studio-accent-border);
  border-radius: 0.375rem;
  background: var(--studio-accent-surface);
  color: var(--studio-accent);
  cursor: pointer;
}

.reference-dropzone {
  min-height: 9rem;
  flex-direction: column;
  gap: 0.3rem;
}

.reference-dropzone i {
  font-size: 1.35rem;
}

.reference-dropzone strong {
  font-size: 0.78rem;
}

.reference-dropzone span {
  color: var(--p-slate-500);
  font-size: 0.66rem;
}

.reference-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.reference-grid figure {
  position: relative;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.3rem;
  background: var(--p-slate-50);
}

.reference-grid img {
  width: 100%;
  height: 7rem;
  object-fit: contain;
}

.reference-grid figcaption {
  overflow: hidden;
  padding: 0.35rem;
  font-size: 0.62rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reference-grid figure > button {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  display: inline-flex;
  width: 1.45rem;
  height: 1.45rem;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.25rem;
  background: white;
  color: var(--p-slate-500);
  cursor: pointer;
}

.starting-point-divider {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--p-slate-400);
  font-size: 0.62rem;
  text-transform: uppercase;
}

.starting-point-divider::before,
.starting-point-divider::after {
  height: 1px;
  flex: 1;
  background: var(--p-slate-100);
  content: "";
}

.template-dropzone,
.draft-template-card {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  border: 1px dashed var(--studio-accent-border);
  border-radius: 0.375rem;
  background: var(--studio-accent-surface);
  padding: 0.7rem;
  text-align: left;
}

.template-dropzone {
  width: 100%;
  color: var(--p-slate-700);
  cursor: pointer;
}

.template-dropzone > span:last-child,
.draft-template-card > div {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.15rem;
}

.template-dropzone strong,
.draft-template-card strong {
  overflow: hidden;
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-dropzone small,
.draft-template-card small {
  color: var(--p-slate-500);
  font-size: 0.62rem;
}

.template-file-icon {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 0.3rem;
  background: var(--studio-icon-surface);
  color: var(--studio-accent);
}

.draft-template-card {
  border-style: solid;
}

.draft-template-card > button {
  display: inline-flex;
  width: 1.65rem;
  height: 1.65rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--p-slate-500);
  cursor: pointer;
}

.draft-template-card > button:hover {
  background: white;
  color: var(--p-red-600);
}

.creator-commit {
  display: flex;
  margin-top: auto;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-top: 1px solid var(--p-slate-100);
  padding-top: 0.75rem;
}

.creator-commit p {
  margin: 0;
  color: var(--p-slate-500);
  font-size: 0.67rem;
}

.studio-workspace {
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.collaboration-sidebar {
  height: 100%;
}

.collaboration-sidebar :deep(.sidebar-header) {
  min-height: 2.5rem;
  align-items: center;
  padding: 0.35rem 0.45rem;
}

.collaboration-sidebar :deep(.toggle-btn) {
  width: 1.7rem;
  height: 1.7rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.25rem;
  background: white;
  color: var(--studio-accent);
  padding: 0;
}

.collaboration-sidebar :deep(.toggle-btn:hover),
.collaboration-sidebar :deep(.toggle-btn:focus-visible) {
  border-color: var(--studio-accent-border);
  background: var(--studio-accent-surface);
  outline: none;
}

.collaboration-sidebar :deep(.sidebar-content) {
  min-height: 0;
  padding: 0;
}

.collaboration-sidebar :deep(.collapsed-content) {
  padding: 0.45rem 0;
}

.collapsed-panel-icon {
  position: relative;
  display: inline-flex;
  width: 1.7rem;
  height: 1.7rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  background: var(--studio-icon-surface);
  color: var(--studio-accent);
  font-size: 0.7rem;
}

.collapsed-panel-icon small {
  position: absolute;
  top: -0.2rem;
  right: -0.2rem;
  min-width: 0.8rem;
  border-radius: 999px;
  background: white;
  color: var(--p-slate-600);
  font-size: 0.48rem;
  line-height: 0.8rem;
  text-align: center;
}

.collaboration-panel,
.design-pane,
.preview-pane {
  min-width: 0;
  min-height: 0;
  background: white;
}

.collaboration-panel {
  height: 100%;
  overflow-y: auto;
  background: var(--p-slate-50);
  padding: 0.55rem;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 0.45rem 0 0.7rem;
}

.panel-section:last-child {
  border-bottom: none;
}

.panel-heading {
  display: flex;
  min-height: 1.7rem;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.panel-heading strong {
  font-size: 0.7rem;
}

.panel-heading > span {
  color: var(--studio-accent);
  font-size: 0.6rem;
}

.compact-input,
.compact-textarea {
  width: 100%;
  font-size: 0.7rem;
}

.compact-textarea {
  resize: vertical;
}

.icon-action {
  display: inline-flex;
  width: 1.6rem;
  height: 1.6rem;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.25rem;
  background: white;
  color: var(--studio-accent);
  cursor: pointer;
}

.reference-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.3rem;
}

.reference-strip button {
  height: 3.5rem;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.25rem;
  background: white;
  cursor: pointer;
  padding: 0.15rem;
}

.reference-strip button.active {
  border-color: var(--studio-accent-border);
  outline: 1px solid var(--studio-accent-border);
  outline-offset: -1px;
  background: var(--studio-accent-surface);
}

.reference-strip img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.mini-dropzone {
  min-height: 3.2rem;
  gap: 0.35rem;
  font-size: 0.67rem;
}

.feedback-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.feedback-item {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.3rem;
  background: white;
  padding: 0.45rem;
}

.feedback-open {
  border-color: var(--studio-accent-border);
  background: var(--studio-accent-surface);
}

.feedback-todo-row {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 0.35rem;
}

.feedback-todo-row input {
  width: 0.8rem;
  height: 0.8rem;
  flex: 0 0 auto;
  margin: 0.1rem 0 0;
  accent-color: var(--studio-accent);
}

.feedback-todo-row span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 0.66rem;
  line-height: 1.4;
  text-overflow: ellipsis;
}

.feedback-item small,
.feedback-list summary {
  color: var(--p-slate-400);
  font-size: 0.58rem;
}

.feedback-remove {
  display: inline-flex;
  width: 1.2rem;
  height: 1.2rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--p-slate-400);
  cursor: pointer;
}

.feedback-remove:hover {
  border-color: var(--p-slate-200);
  background: white;
  color: var(--p-slate-700);
}

.feedback-response {
  border-top: 1px solid var(--p-slate-200);
  padding-top: 0.25rem;
}

.feedback-response p {
  margin: 0.3rem 0 0;
  color: var(--p-slate-600);
  font-size: 0.62rem;
  line-height: 1.45;
}

.feedback-history {
  border-top: 1px solid var(--p-slate-200);
  padding-top: 0.3rem;
}

.feedback-checked {
  margin-top: 0.35rem;
  opacity: 0.78;
}

.feedback-checked .feedback-todo-row span {
  text-decoration: line-through;
}

.feedback-list details {
  cursor: pointer;
}

.design-pane,
.preview-pane {
  display: flex;
  flex-direction: column;
}

.design-pane {
  flex: 0 0 auto;
}

.preview-pane {
  flex: 1 1 0;
}

.editor-resize-handle {
  position: relative;
  z-index: 2;
  display: flex;
  flex: 0 0 7px;
  align-items: center;
  justify-content: center;
  border-inline: 1px solid var(--p-slate-200);
  background: var(--p-slate-100);
  cursor: col-resize;
  touch-action: none;
  transition:
    background 120ms ease,
    border-color 120ms ease;
}

.editor-resize-handle span {
  width: 2px;
  height: 2rem;
  border-radius: 999px;
  background: var(--p-slate-400);
}

.editor-resize-handle:hover,
.editor-resize-handle:focus-visible,
.editor-resize-handle.active {
  border-color: var(--studio-accent-border);
  background: var(--studio-icon-surface);
  outline: none;
}

.editor-resize-handle:hover span,
.editor-resize-handle:focus-visible span,
.editor-resize-handle.active span {
  background: var(--studio-accent);
}

:global(body.template-studio-resizing) {
  cursor: col-resize;
  user-select: none;
}

.pane-toolbar {
  display: flex;
  min-height: 2.5rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-bottom: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  padding: 0.35rem 0.55rem;
}

.pane-toolbar > div:first-child:not(.preview-tabs) {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.pane-toolbar strong {
  font-size: 0.7rem;
}

.pane-toolbar span {
  color: var(--p-slate-400);
  font-size: 0.58rem;
}

.pane-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 0.35rem;
}

.editor-empty,
.preview-message,
.studio-empty {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  color: var(--p-slate-400);
  padding: 1.5rem;
  text-align: center;
}

.editor-empty i,
.studio-empty > i {
  color: var(--studio-accent);
  font-size: 1.5rem;
}

.editor-empty strong,
.preview-message strong,
.studio-empty strong {
  color: var(--p-slate-700);
  font-size: 0.78rem;
}

.editor-empty span,
.preview-message span {
  max-width: 24rem;
  font-size: 0.67rem;
  line-height: 1.45;
}

.preview-tabs {
  display: flex;
  min-width: 0;
  flex: 1;
  gap: 0.2rem;
  overflow-x: auto;
  scrollbar-width: thin;
}

.preview-tabs button {
  display: inline-flex;
  height: 1.8rem;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.25rem;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--p-slate-500);
  cursor: pointer;
  padding: 0 0.65rem;
  font-size: 0.66rem;
  white-space: nowrap;
}

.preview-tabs button > span {
  display: inline-flex;
  min-width: 0.9rem;
  height: 0.9rem;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--p-slate-200);
  color: var(--p-slate-600);
  font-size: 0.52rem;
  line-height: 1;
}

.preview-tabs button.active > span {
  background: var(--studio-icon-surface);
  color: var(--studio-accent);
}

.preview-tabs button.active {
  border-color: var(--studio-accent-border);
  background: var(--studio-accent-surface);
  color: var(--studio-accent);
}

.preview-tabs button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.preview-actions,
.pdf-page-controls,
.document-controls {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.25rem;
}

.preview-actions {
  justify-content: flex-end;
}

.pdf-page-controls {
  border-right: 1px solid var(--p-slate-200);
  padding-right: 0.35rem;
}

.pdf-page-controls > span {
  min-width: 2.5rem;
  color: var(--p-slate-500);
  text-align: center;
  white-space: nowrap;
}

.pdf-page-select {
  width: 5.4rem;
}

.reference-select {
  width: min(10rem, 28vw);
}

.document-controls {
  flex: 0 0 auto;
  border-left: 1px solid var(--p-slate-200);
  padding-left: 0.25rem;
}

.zoom-value {
  min-width: 2.8rem;
  height: 1.55rem;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--p-slate-600);
  cursor: pointer;
  padding: 0 0.25rem;
  font-size: 0.6rem;
  font-variant-numeric: tabular-nums;
}

.zoom-value:hover,
.zoom-value:focus-visible {
  border-color: var(--studio-accent-border);
  background: var(--studio-accent-surface);
  color: var(--studio-accent);
  outline: none;
}

.document-viewport {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--p-slate-100);
  padding: 0.65rem;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.document-viewport:focus-visible {
  outline: 2px solid var(--studio-accent-border);
  outline-offset: -2px;
}

.document-viewport.panning {
  cursor: grabbing;
}

.document-viewport.panning .document-canvas {
  transition: none;
}

.document-canvas {
  display: block;
  max-width: calc(100% - 1rem);
  max-height: calc(100% - 1rem);
  object-fit: contain;
  transform-origin: center;
  transition: transform 80ms ease-out;
  will-change: transform;
  pointer-events: none;
}

.pdf-page-image {
  border: 1px solid var(--p-slate-300);
  background: white;
  box-shadow: 0 1px 4px rgb(15 23 42 / 12%);
}

.reference-image {
  background: white;
  box-shadow: 0 1px 4px rgb(15 23 42 / 10%);
}

.viewport-help {
  position: absolute;
  right: 0.5rem;
  bottom: 0.45rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.25rem;
  background: rgb(255 255 255 / 88%);
  color: var(--p-slate-500);
  padding: 0.15rem 0.35rem;
  font-size: 0.55rem;
  pointer-events: none;
}

.comparison-view {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: repeat(2, minmax(13rem, 1fr));
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 1px;
  overflow: auto;
  background: var(--p-slate-300);
}

.compare-feedback-composer {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: minmax(10rem, 0.65fr) minmax(14rem, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
  border-top: 1px solid var(--p-slate-200);
  background: white;
  padding: 0.5rem;
}

.compare-feedback-copy {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.45rem;
}

.compare-feedback-icon {
  display: inline-flex;
  width: 1.75rem;
  height: 1.75rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 0.3rem;
  background: var(--studio-icon-surface);
  color: var(--studio-accent);
  font-size: 0.72rem;
}

.compare-feedback-copy > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.compare-feedback-copy strong,
.compare-feedback-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compare-feedback-copy strong {
  color: var(--p-slate-700);
  font-size: 0.67rem;
}

.compare-feedback-copy span {
  color: var(--p-slate-400);
  font-size: 0.56rem;
}

.compare-feedback-input {
  width: 100%;
  min-height: 2.5rem;
  max-height: 5rem;
  resize: vertical;
}

.comparison-document {
  display: flex;
  min-width: 13rem;
  min-height: 0;
  flex-direction: column;
  background: white;
}

.comparison-header {
  display: flex;
  min-height: 2.25rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 0.25rem 0.4rem;
}

.comparison-header > div:first-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.comparison-header strong,
.comparison-header span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.comparison-header strong {
  color: var(--p-slate-700);
  font-size: 0.66rem;
}

.comparison-header span {
  color: var(--p-slate-400);
  font-size: 0.55rem;
}

.comparison-header .document-controls {
  border-left: none;
  padding-left: 0;
}

.compare-viewport {
  padding: 0.4rem;
}

.comparison-spinner {
  color: var(--studio-accent);
  font-size: 1.2rem;
}

.comparison-error {
  display: flex;
  max-width: 16rem;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  color: var(--p-red-600);
  font-size: 0.62rem;
  line-height: 1.4;
  text-align: center;
}

.preview-error {
  align-items: stretch;
  justify-content: flex-start;
  color: var(--p-red-600);
  text-align: left;
}

.preview-error pre {
  max-height: 60%;
  overflow: auto;
  border: 1px solid var(--p-red-200);
  border-radius: 0.3rem;
  background: var(--p-red-50);
  padding: 0.65rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.65rem;
  white-space: pre-wrap;
}

.asset-library {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.55rem;
  overflow: auto;
  background: var(--p-slate-100);
  padding: 0.65rem;
}

.asset-tool-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.35rem;
  background: white;
  padding: 0.5rem 0.65rem;
}

.asset-tool-control > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.12rem;
}

.asset-tool-control strong {
  color: var(--p-slate-800);
  font-size: 0.72rem;
}

.asset-tool-control span {
  color: var(--p-slate-500);
  font-size: 0.62rem;
  line-height: 1.35;
}

.asset-tool-control label {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.45rem;
}

.asset-tool-control label > span {
  color: var(--p-slate-600);
  font-weight: 650;
}

.asset-empty {
  display: flex;
  min-height: 12rem;
  flex: 1;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 0.45rem;
  border: 1px dashed var(--studio-accent-border);
  border-radius: 0.35rem;
  background: var(--studio-accent-surface);
  color: var(--p-slate-600);
  cursor: pointer;
  padding: 1.25rem;
  text-align: center;
}

.asset-empty i {
  color: var(--studio-accent);
  font-size: 1.45rem;
}

.asset-empty strong {
  font-size: 0.78rem;
}

.asset-empty span {
  max-width: 26rem;
  color: var(--p-slate-500);
  font-size: 0.66rem;
  line-height: 1.45;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(13.5rem, 1fr));
  gap: 0.55rem;
}

.asset-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.35rem;
  background: white;
}

.asset-preview {
  position: relative;
  display: flex;
  height: 8rem;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background:
    linear-gradient(45deg, var(--p-slate-100) 25%, transparent 25%),
    linear-gradient(-45deg, var(--p-slate-100) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--p-slate-100) 75%),
    linear-gradient(-45deg, transparent 75%, var(--p-slate-100) 75%);
  background-position:
    0 0,
    0 0.4rem,
    0.4rem -0.4rem,
    -0.4rem 0;
  background-size: 0.8rem 0.8rem;
}

.asset-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.asset-preview span {
  position: absolute;
  top: 0.35rem;
  right: 0.35rem;
  border: 1px solid var(--studio-accent-border);
  border-radius: 0.2rem;
  background: rgb(255 255 255 / 88%);
  color: var(--studio-accent);
  padding: 0.08rem 0.3rem;
  font-size: 0.55rem;
  font-weight: 700;
}

.asset-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.2rem;
  border-top: 1px solid var(--p-slate-100);
  padding: 0.45rem 0.5rem 0.35rem;
}

.asset-copy strong,
.asset-copy small,
.asset-copy code {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-copy strong {
  font-size: 0.7rem;
}

.asset-copy small {
  color: var(--p-slate-400);
  font-size: 0.57rem;
}

.asset-copy code {
  color: var(--studio-accent);
  font-size: 0.58rem;
}

.asset-actions {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  border-top: 1px solid var(--p-slate-100);
  padding: 0.15rem 0.25rem;
}

.asset-actions :deep(.p-button:last-child) {
  margin-left: auto;
}

.asset-drop-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: 1px dashed var(--p-slate-300);
  border-radius: 0.3rem;
  color: var(--p-slate-400);
  padding: 0.45rem;
  font-size: 0.61rem;
}

.delete-session-copy {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
}

.delete-session-icon {
  display: inline-flex;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--p-red-200);
  border-radius: 0.3rem;
  background: var(--p-red-50);
  color: var(--p-red-600);
}

.delete-session-copy > div {
  min-width: 0;
}

.delete-session-copy strong {
  display: block;
  overflow: hidden;
  color: var(--p-slate-800);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.delete-session-copy p {
  margin: 0.35rem 0 0;
  color: var(--p-slate-600);
  font-size: 0.68rem;
  line-height: 1.5;
}

.delete-session-copy small {
  display: block;
  margin-top: 0.45rem;
  color: var(--p-red-600);
  font-size: 0.63rem;
}

.hidden-input {
  display: none;
}

:deep(.p-button) {
  white-space: nowrap;
}

:deep(.p-inputtext),
:deep(.p-textarea) {
  border-radius: 0.3rem;
  font-size: 0.72rem;
}

@media (max-width: 1120px) {
  .studio-workspace {
    display: grid;
    grid-template-columns: auto minmax(20rem, 1fr);
    grid-template-rows: minmax(18rem, 1fr) minmax(18rem, 1fr);
  }

  .collaboration-sidebar {
    grid-row: 1 / 3;
  }

  .design-pane {
    grid-column: 2;
    border-bottom: 1px solid var(--p-slate-200);
  }

  .editor-resize-handle {
    display: none;
  }

  .preview-pane {
    grid-row: 2;
    grid-column: 2;
  }

  .compare-feedback-composer {
    grid-template-columns: minmax(12rem, 1fr) auto;
  }

  .compare-feedback-copy {
    display: none;
  }
}

@media (max-width: 760px) {
  .studio-title small,
  .current-badge,
  .status-badge {
    display: none;
  }

  .studio-title {
    min-width: auto;
  }

  .studio-session-picker {
    width: min(14rem, 34vw);
  }

  .session-home-header {
    align-items: flex-start;
  }

  .session-home-controls {
    flex-wrap: wrap;
  }

  .session-search {
    width: 100%;
  }

  .session-result-count {
    margin-left: 0;
  }
}
</style>
