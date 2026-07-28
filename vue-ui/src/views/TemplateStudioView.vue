<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import { useRouter } from "vue-router";
import { Button, InputText, Textarea, useToast } from "primevue";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import MSelect from "../components/universal/input/MSelect.vue";
import {
  ApiRequestType,
  callApi,
  getNetsuiteEnvironment,
  type ApiResponse
} from "../utils/api";
import { RequestRoutes } from "../types/request";
import {
  TEMPLATE_STUDIO_CAPTURE_REQUEST_KEY,
  TEMPLATE_STUDIO_CAPTURE_RESPONSE_KEY,
  TEMPLATE_SESSION_STORE_KEY,
  TEMPLATE_STUDIO_VIEW_STATE_KEY,
  createTemplateDesignSession,
  emptyTemplateSessionStore,
  loadTemplateSessionStore,
  makeTemplateFeedback,
  makeTemplateReferenceImage,
  makeUserTemplateRevision,
  normalizeTemplateSessionStore,
  saveTemplateSessionStore,
  type TemplateContextMode,
  type TemplateDesignSession,
  type TemplateReferenceImage,
  type TemplateSessionStore
} from "../features/templateStudio/sessionStore";
import {
  renderPdfDataUrlPage,
  type PdfPageImage
} from "../utils/pdfUtils";

type RecordOption = {
  id: string;
  label: string;
};

const MAX_REFERENCE_IMAGES = 5;
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const router = useRouter();
const toast = useToast();
const store = ref<TemplateSessionStore>(emptyTemplateSessionStore());
const loading = ref(true);
const creating = ref(false);
const rendering = ref(false);
const editorDirty = ref(false);
const briefDirty = ref(false);
const activePreview = ref<"pdf" | "reference">("pdf");
const pdfPageImage = ref("");
const pdfPage = ref(1);
const pdfPageCount = ref(0);
const pdfPageRendering = ref(false);
const pdfPreviewError = ref("");
const referenceInput = ref<HTMLInputElement | null>(null);
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
const draftContextMode = ref<TemplateContextMode>("freestyle");
const draftRecordType = ref("");
const draftRecordId = ref("");

const currentSession = computed(
  () =>
    store.value.sessions.find(
      (session) => session.id === store.value.currentSessionId
    ) || null
);

const sessionOptions = computed(() =>
  store.value.sessions.map((session) => ({
    value: session.id,
    label: session.name
  }))
);

const pdfPageOptions = computed(() =>
  Array.from({ length: pdfPageCount.value }, (_, index) => ({
    value: index + 1,
    label: `Page ${index + 1}`
  }))
);

const contextModeOptions = [
  { value: "freestyle", label: "Freestyle / no record" },
  { value: "transaction", label: "Transaction" },
  { value: "customrecord", label: "Custom record" }
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
    currentSession.value?.feedback.filter(
      (feedback) => !feedback.checked
    ) || []
);

const checkedFeedback = computed(
  () =>
    currentSession.value?.feedback.filter(
      (feedback) => feedback.checked
    ) || []
);

const statusLabel = computed(() => {
  const labels: Record<string, string> = {
    brief_ready: "Brief ready",
    designing: "Design in progress",
    rendering: "Rendering with NetSuite",
    rendered: "Rendered",
    render_error: "Render failed",
    completed: "Completed"
  };
  return labels[currentSession.value?.status || ""] || "No session";
});

const hasRecordContext = computed(
  () => workingContextMode.value !== "freestyle"
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

const cleanRecordType = (value: string) =>
  value.replace(/[^a-z0-9_]/gi, "");

const recordQueries = (recordType: string): string[] => {
  const type = cleanRecordType(recordType);
  if (!type) return [];
  if (type.startsWith("customrecord_")) {
    return [
      `SELECT id, name FROM ${type} WHERE isinactive = 'F' ORDER BY id DESC`,
      `SELECT id FROM ${type} ORDER BY id DESC`
    ];
  }
  return [
    `SELECT id, tranid, entity, trandate FROM transaction WHERE recordtype = '${type}' ORDER BY id DESC`,
    `SELECT id, entityid, companyname, firstname, lastname FROM ${type} WHERE isinactive = 'F' ORDER BY id DESC`,
    `SELECT id, name FROM ${type} ORDER BY id DESC`,
    `SELECT id FROM ${type} ORDER BY id DESC`
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
      ""
  ).trim();
  return primary ? `${primary} · #${id}` : `#${id}`;
};

const hydrateWorkingSession = (
  session: TemplateDesignSession | null,
  force = false
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
  if (session.pdfDataUrl) activePreview.value = "pdf";
};

const loadStore = async (force = false) => {
  store.value = await loadTemplateSessionStore();
  hydrateWorkingSession(currentSession.value, force);
};

const updateSession = async (
  sessionId: string,
  updater: (session: TemplateDesignSession) => TemplateDesignSession
) => {
  const latest = await loadTemplateSessionStore();
  const index = latest.sessions.findIndex((session) => session.id === sessionId);
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
      readyAt: new Date().toISOString()
    }
  });
};

const renderPdfPage = async (
  requestedPage = pdfPage.value,
  targetWidth = 1600
): Promise<PdfPageImage> => {
  const session = currentSession.value;
  if (!session?.pdfDataUrl) {
    throw new Error("Render the current FreeMarker session before capturing its PDF.");
  }
  const sequence = ++pdfRenderSequence;
  pdfPageRendering.value = true;
  pdfPreviewError.value = "";
  try {
    const renderedPage = await renderPdfDataUrlPage(
      session.pdfDataUrl,
      requestedPage,
      targetWidth
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
};

const changePdfPage = (value: string | number | null) => {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1 || page > pdfPageCount.value) return;
  void renderPdfPage(page).catch(() => undefined);
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
    error: ""
  };
  try {
    const renderedPage = await renderPdfPage(
      Number(request.page) || 1,
      Math.min(2400, Math.max(800, Number(request.targetWidth) || 1600))
    );
    response.page = renderedPage.pageNumber;
    response.pageCount = renderedPage.pageCount;
    response.width = renderedPage.width;
    response.height = renderedPage.height;
    response.imageBase64 = renderedPage.dataUrl.replace(
      /^data:image\/jpeg;base64,/,
      ""
    );
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
  }
  await chrome.storage.local.set({
    [TEMPLATE_STUDIO_CAPTURE_RESPONSE_KEY]: response
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

const startNewSession = () => {
  creating.value = true;
  draftName.value = "";
  draftPrompt.value = "";
  draftImages.value = [];
  draftContextMode.value = "freestyle";
  draftRecordType.value = "";
  draftRecordId.value = "";
};

const commitSession = async () => {
  if (!draftName.value.trim() || !draftPrompt.value.trim()) {
    toast.add({
      severity: "warn",
      summary: "Brief incomplete",
      detail: "Add a session name and design prompt.",
      life: 3200
    });
    return;
  }
  const latest = await loadTemplateSessionStore();
  const record = records.value.find(
    (option) => option.id === draftRecordId.value
  );
  const session = createTemplateDesignSession({
    name: draftName.value,
    prompt: draftPrompt.value,
    referenceImages: draftImages.value,
    contextMode: draftContextMode.value,
    recordType: draftRecordType.value,
    recordId: draftRecordId.value,
    recordLabel: record?.label || "",
    accountId: accountId.value
  });
  latest.sessions.unshift(session);
  latest.currentSessionId = session.id;
  store.value = await saveTemplateSessionStore(latest);
  creating.value = false;
  hydrateWorkingSession(session, true);
  toast.add({
    severity: "success",
    summary: "Session committed",
    detail: "Claude can now load this session and begin the FreeMarker design.",
    life: 3500
  });
  void markViewReady();
};

const setBriefDirty = () => {
  briefDirty.value = true;
};

const saveBrief = async () => {
  const session = currentSession.value;
  if (!session) return;
  const record = records.value.find(
    (option) => option.id === workingRecordId.value
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
    updatedAt: new Date().toISOString()
  }));
  briefDirty.value = false;
};

const saveFreemarker = async () => {
  const session = currentSession.value;
  if (!session || !workingFreemarker.value.trim()) return;
  const freemarker = workingFreemarker.value;
  await updateSession(session.id, (current) => ({
    ...current,
    freemarker,
    pdfDataUrl:
      current.freemarker === freemarker ? current.pdfDataUrl : "",
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
            ...current.revisions
          ].slice(0, 30),
    version: current.version + 1,
    updatedAt: new Date().toISOString()
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
      sessionId: session.id
    });
    if (!response?.ok) {
      throw new Error(response?.error || "NetSuite rendering failed.");
    }
    await loadStore(true);
  } catch (error) {
    toast.add({
      severity: "error",
      summary: "Render failed",
      detail: error instanceof Error ? error.message : String(error),
      life: 5000
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
    updatedAt: new Date().toISOString()
  }));
  feedbackText.value = "";
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
            checkedAt: checked ? new Date().toISOString() : undefined
          }
        : feedback
    ),
    version: current.version + 1,
    updatedAt: new Date().toISOString()
  }));
};

const removeFeedback = async (feedbackId: string) => {
  const session = currentSession.value;
  if (!session) return;
  await updateSession(session.id, (current) => ({
    ...current,
    feedback: current.feedback.filter(
      (feedback) => feedback.id !== feedbackId || feedback.checked
    ),
    version: current.version + 1,
    updatedAt: new Date().toISOString()
  }));
};

const setCompleted = async () => {
  const session = currentSession.value;
  if (!session) return;
  await updateSession(session.id, (current) => ({
    ...current,
    status: current.status === "completed" ? "rendered" : "completed",
    version: current.version + 1,
    updatedAt: new Date().toISOString()
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
          String(reader.result || "")
        )
      );
    reader.readAsDataURL(file);
  });

const addReferenceFiles = async (files: FileList | File[]) => {
  try {
    const images = await Promise.all([...files].map(fileToReference));
    if (creating.value) {
      draftImages.value = [...draftImages.value, ...images].slice(
        0,
        MAX_REFERENCE_IMAGES
      );
      return;
    }
    const session = currentSession.value;
    if (!session) return;
    await updateSession(session.id, (current) => ({
      ...current,
      referenceImages: [...current.referenceImages, ...images].slice(
        0,
        MAX_REFERENCE_IMAGES
      ),
      version: current.version + 1,
      updatedAt: new Date().toISOString()
    }));
    activePreview.value = "reference";
  } catch (error) {
    toast.add({
      severity: "warn",
      summary: "Reference not added",
      detail: error instanceof Error ? error.message : String(error),
      life: 3500
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

const removeReference = async (imageId: string) => {
  if (creating.value) {
    draftImages.value = draftImages.value.filter(
      (image) => image.id !== imageId
    );
    return;
  }
  const session = currentSession.value;
  if (!session) return;
  await updateSession(session.id, (current) => ({
    ...current,
    referenceImages: current.referenceImages.filter(
      (image) => image.id !== imageId
    ),
    version: current.version + 1,
    updatedAt: new Date().toISOString()
  }));
};

const loadRecordTypes = async () => {
  if (recordTypesLoading.value) return;
  recordTypesLoading.value = true;
  contextError.value = "";
  try {
    const rows = normalizeRows(
      (await callApi(RequestRoutes.GET_ALL_RECORD_TYPES)) as ApiResponse
    );
    recordTypes.value = rows
      .map((row) => {
        const id = String(row.id ?? row.ID ?? row.scriptId ?? "")
          .trim()
          .toLowerCase();
        return {
          id,
          label: String(row.name ?? row.Name ?? row.label ?? id)
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
          ApiRequestType.NORMAL
        )) as ApiResponse;
        const rows = normalizeRows(response);
        records.value = rows
          .map((row) => ({
            id: String(row.id ?? row.ID ?? ""),
            label: rowLabel(row)
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

const storageListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string
) => {
  if (areaName !== "local") return;
  const captureRequest =
    changes[TEMPLATE_STUDIO_CAPTURE_REQUEST_KEY]?.newValue;
  if (captureRequest) void respondToPdfCaptureRequest(captureRequest);

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
  () => hydrateWorkingSession(currentSession.value, true)
);

onMounted(async () => {
  chrome.storage.onChanged.addListener(storageListener);
  chrome.runtime.onMessage.addListener(runtimeListener);
  accountId.value = await getNetsuiteEnvironment().catch(() => "");
  await Promise.all([loadStore(true), loadRecordTypes()]);
  creating.value = store.value.sessions.length === 0;
  if (workingRecordType.value) void loadRecords(workingRecordType.value);
  loading.value = false;
  if (currentSession.value?.pdfDataUrl) {
    void renderPdfPage(1).catch(() => undefined);
  } else {
    void markViewReady();
  }
});

onBeforeUnmount(() => {
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
          <small>Claude + NetSuite FreeMarker workspace</small>
        </div>
      </div>

      <div class="studio-session-picker">
        <MSelect
          :model-value="store.currentSessionId"
          :options="sessionOptions"
          placeholder="No committed sessions"
          searchable
          size="small"
          @update:model-value="selectSession"
        />
      </div>

      <span v-if="currentSession && !creating" class="current-badge">
        <i class="pi pi-circle-fill"></i>
        Current
      </span>
      <span
        v-if="currentSession && !creating"
        class="status-badge"
        :class="`status-${currentSession.status}`"
      >
        {{ statusLabel }}
      </span>

      <div class="studio-toolbar-actions">
        <Button
          size="small"
          severity="secondary"
          outlined
          icon="pi pi-eye"
          label="Renderer"
          @click="router.push('/freemarker-renderer')"
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

    <main v-else-if="creating" class="session-creator">
      <section class="creator-copy">
        <div class="section-heading">
          <span class="step-number">1</span>
          <div>
            <strong>Commit a design brief</strong>
            <small
              >This becomes the current session Claude reads and edits.</small
            >
          </div>
        </div>

        <label class="field">
          <span>Session name</span>
          <InputText
            v-model="draftName"
            placeholder="Modern invoice redesign"
          />
        </label>

        <label class="field field-grow">
          <span>Design prompt</span>
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
        <small v-if="contextError" class="field-error">{{ contextError }}</small>
      </section>

      <section class="creator-reference">
        <div class="section-heading">
          <span class="step-number">2</span>
          <div>
            <strong>Add visual references</strong>
            <small>Up to five PNG, JPEG, or WebP images.</small>
          </div>
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

        <div class="creator-commit">
          <p>
            After commit, ask Claude to begin the current Template Studio
            session.
          </p>
          <Button
            icon="pi pi-check"
            label="Commit as current session"
            @click="commitSession"
          />
        </div>
      </section>
    </main>

    <main v-else-if="currentSession" class="studio-workspace">
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
              @click="activePreview = 'reference'"
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
            placeholder="Describe the next correction for Claude…"
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
                <summary>Claude's response</summary>
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

      <section class="design-pane">
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
          <strong>Ready for Claude</strong>
          <span
            >Ask Claude to begin the current Template Studio session. The first
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

      <section class="preview-pane">
        <div class="pane-toolbar">
          <div class="preview-tabs">
            <button
              type="button"
              :class="{ active: activePreview === 'pdf' }"
              @click="activePreview = 'pdf'"
            >
              PDF
            </button>
            <button
              type="button"
              :class="{ active: activePreview === 'reference' }"
              :disabled="!currentSession.referenceImages.length"
              @click="activePreview = 'reference'"
            >
              Reference
            </button>
          </div>
          <div class="preview-actions">
            <div
              v-if="activePreview === 'pdf' && pdfPageCount > 0"
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
          v-else-if="
            activePreview === 'pdf' && !currentSession.pdfDataUrl
          "
          class="preview-message"
        >
          <i class="pi pi-file-pdf"></i>
          <strong>No render yet</strong>
          <span>Claude or you can render after saving a FreeMarker revision.</span>
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
        <div v-else-if="activePreview === 'pdf'" class="pdf-page-scroll">
          <img
            class="pdf-page-image"
            :src="pdfPageImage"
            :alt="`Rendered PDF page ${pdfPage} of ${pdfPageCount}`"
          />
        </div>

        <div v-else class="reference-preview">
          <figure
            v-for="image in currentSession.referenceImages"
            :key="image.id"
          >
            <img :src="image.dataUrl" :alt="image.name" />
            <figcaption>
              <span :title="image.name">{{ image.name }}</span>
              <button
                type="button"
                title="Remove reference"
                @click="removeReference(image.id)"
              >
                <i class="pi pi-trash"></i>
              </button>
            </figcaption>
          </figure>
        </div>
      </section>
    </main>

    <div v-else class="studio-empty">
      <i class="pi pi-sparkles"></i>
      <strong>No design session</strong>
      <Button label="Create the first session" @click="startNewSession" />
    </div>

    <input
      ref="referenceInput"
      class="hidden-input"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      multiple
      @change="handleReferenceInput"
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
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: 17rem minmax(22rem, 1fr) minmax(21rem, 0.9fr);
  overflow: hidden;
}

.collaboration-panel,
.design-pane,
.preview-pane {
  min-width: 0;
  min-height: 0;
  background: white;
}

.collaboration-panel {
  overflow-y: auto;
  border-right: 1px solid var(--p-slate-200);
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
  border-right: 1px solid var(--p-slate-200);
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
  gap: 0.2rem;
}

.preview-tabs button {
  height: 1.8rem;
  border: 1px solid transparent;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--p-slate-500);
  cursor: pointer;
  padding: 0 0.65rem;
  font-size: 0.66rem;
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
.pdf-page-controls {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.25rem;
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

.pdf-page-scroll {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: flex-start;
  justify-content: center;
  overflow: auto;
  background: var(--p-slate-100);
  padding: 0.65rem;
}

.pdf-page-image {
  display: block;
  width: min(100%, 50rem);
  height: auto;
  border: 1px solid var(--p-slate-300);
  background: white;
  box-shadow: 0 1px 4px rgb(15 23 42 / 12%);
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

.reference-preview {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 0.55rem;
  overflow: auto;
  background: var(--p-slate-100);
  padding: 0.65rem;
}

.reference-preview figure {
  margin: 0;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.3rem;
  background: white;
}

.reference-preview img {
  display: block;
  width: 100%;
  max-height: 70vh;
  object-fit: contain;
}

.reference-preview figcaption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-top: 1px solid var(--p-slate-100);
  padding: 0.35rem 0.5rem;
}

.reference-preview figcaption span {
  overflow: hidden;
  font-size: 0.64rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reference-preview figcaption button {
  border: none;
  background: transparent;
  color: var(--p-slate-400);
  cursor: pointer;
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
    grid-template-columns: 15rem minmax(20rem, 1fr);
    grid-template-rows: minmax(18rem, 1fr) minmax(18rem, 1fr);
  }

  .collaboration-panel {
    grid-row: 1 / 3;
  }

  .design-pane {
    border-right: none;
    border-bottom: 1px solid var(--p-slate-200);
  }

  .preview-pane {
    grid-column: 2;
  }
}
</style>
