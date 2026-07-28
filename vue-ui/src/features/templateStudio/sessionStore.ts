export const TEMPLATE_SESSION_STORE_KEY =
  "magic_netsuite_template_design_sessions_v1";
export const TEMPLATE_STUDIO_VIEW_STATE_KEY =
  "magic_netsuite_template_studio_view_state";
export const TEMPLATE_STUDIO_CAPTURE_REQUEST_KEY =
  "magic_netsuite_template_studio_capture_request";
export const TEMPLATE_STUDIO_CAPTURE_RESPONSE_KEY =
  "magic_netsuite_template_studio_capture_response";

export type TemplateSessionStatus =
  | "brief_ready"
  | "designing"
  | "rendering"
  | "rendered"
  | "render_error"
  | "completed";

export type TemplateContextMode =
  | "freestyle"
  | "transaction"
  | "customrecord";

export interface TemplateReferenceImage {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  createdAt: string;
}

export interface TemplateFeedback {
  id: string;
  text: string;
  status: "open" | "addressed";
  checked: boolean;
  createdAt: string;
  addressedAt?: string;
  response?: string;
  checkedAt?: string;
}

export interface TemplateRevision {
  id: string;
  actor: "user" | "assistant";
  summary: string;
  freemarker: string;
  createdAt: string;
}

export interface TemplateDesignSession {
  id: string;
  name: string;
  prompt: string;
  referenceImages: TemplateReferenceImage[];
  contextMode: TemplateContextMode;
  recordType: string;
  recordId: string;
  recordLabel: string;
  accountId: string;
  freemarker: string;
  pdfDataUrl: string;
  renderError: string;
  feedback: TemplateFeedback[];
  revisions: TemplateRevision[];
  status: TemplateSessionStatus;
  version: number;
  sourceVersion: number;
  renderVersion: number;
  createdAt: string;
  updatedAt: string;
  lastRenderedAt: string;
}

export interface TemplateSessionStore {
  schemaVersion: 1;
  currentSessionId: string;
  sessions: TemplateDesignSession[];
  updatedAt: string;
}

export interface NewTemplateSessionInput {
  name: string;
  prompt: string;
  referenceImages?: TemplateReferenceImage[];
  contextMode?: TemplateContextMode;
  recordType?: string;
  recordId?: string;
  recordLabel?: string;
  accountId?: string;
}

const now = () => new Date().toISOString();
const makeId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const emptyTemplateSessionStore = (): TemplateSessionStore => ({
  schemaVersion: 1,
  currentSessionId: "",
  sessions: [],
  updatedAt: now()
});

const normalizeSession = (
  value: Partial<TemplateDesignSession>
): TemplateDesignSession => {
  const timestamp = now();
  return {
    id: String(value.id || makeId("template")),
    name: String(value.name || "Untitled template"),
    prompt: String(value.prompt || ""),
    referenceImages: Array.isArray(value.referenceImages)
      ? value.referenceImages.filter(
          (image): image is TemplateReferenceImage =>
            Boolean(image?.id && image?.dataUrl)
        )
      : [],
    contextMode:
      value.contextMode === "transaction" ||
      value.contextMode === "customrecord"
        ? value.contextMode
        : "freestyle",
    recordType: String(value.recordType || ""),
    recordId: String(value.recordId || ""),
    recordLabel: String(value.recordLabel || ""),
    accountId: String(value.accountId || ""),
    freemarker: String(value.freemarker || ""),
    pdfDataUrl: String(value.pdfDataUrl || ""),
    renderError: String(value.renderError || ""),
    feedback: Array.isArray(value.feedback)
      ? value.feedback
          .filter((feedback) => feedback?.id && feedback?.text)
          .map((feedback) => ({
            ...feedback,
            status:
              feedback.status === "addressed"
                ? ("addressed" as const)
                : ("open" as const),
            checked: Boolean(feedback.checked),
            checkedAt: feedback.checked
              ? String(feedback.checkedAt || feedback.addressedAt || timestamp)
              : undefined
          }))
      : [],
    revisions: Array.isArray(value.revisions) ? value.revisions.slice(0, 30) : [],
    status: value.status || "brief_ready",
    version: Number(value.version) || 1,
    sourceVersion:
      Number(value.sourceVersion) || (String(value.freemarker || "") ? 1 : 0),
    renderVersion: Number(value.renderVersion) || 0,
    createdAt: String(value.createdAt || timestamp),
    updatedAt: String(value.updatedAt || timestamp),
    lastRenderedAt: String(value.lastRenderedAt || "")
  };
};

export const normalizeTemplateSessionStore = (
  value: unknown
): TemplateSessionStore => {
  if (!value || typeof value !== "object") return emptyTemplateSessionStore();
  const raw = value as Partial<TemplateSessionStore>;
  const sessions = Array.isArray(raw.sessions)
    ? raw.sessions.map((session) => normalizeSession(session))
    : [];
  const requestedCurrent = String(raw.currentSessionId || "");
  return {
    schemaVersion: 1,
    currentSessionId: sessions.some(
      (session) => session.id === requestedCurrent
    )
      ? requestedCurrent
      : sessions[0]?.id || "",
    sessions,
    updatedAt: String(raw.updatedAt || now())
  };
};

export const loadTemplateSessionStore =
  async (): Promise<TemplateSessionStore> => {
    const result = await chrome.storage.local.get(TEMPLATE_SESSION_STORE_KEY);
    return normalizeTemplateSessionStore(result[TEMPLATE_SESSION_STORE_KEY]);
  };

export const saveTemplateSessionStore = async (
  store: TemplateSessionStore
): Promise<TemplateSessionStore> => {
  const normalized = normalizeTemplateSessionStore({
    ...store,
    updatedAt: now()
  });
  await chrome.storage.local.set({
    [TEMPLATE_SESSION_STORE_KEY]: normalized
  });
  return normalized;
};

export const createTemplateDesignSession = (
  input: NewTemplateSessionInput
): TemplateDesignSession => {
  const timestamp = now();
  return normalizeSession({
    id: makeId("template"),
    name: input.name.trim() || "Untitled template",
    prompt: input.prompt.trim(),
    referenceImages: input.referenceImages || [],
    contextMode: input.contextMode || "freestyle",
    recordType: input.recordType || "",
    recordId: input.recordId || "",
    recordLabel: input.recordLabel || "",
    accountId: input.accountId || "",
    status: "brief_ready",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp
  });
};

export const makeTemplateReferenceImage = (
  name: string,
  mimeType: string,
  dataUrl: string
): TemplateReferenceImage => ({
  id: makeId("reference"),
  name,
  mimeType,
  dataUrl,
  createdAt: now()
});

export const makeTemplateFeedback = (text: string): TemplateFeedback => ({
  id: makeId("feedback"),
  text: text.trim(),
  status: "open",
  checked: false,
  createdAt: now()
});

export const makeUserTemplateRevision = (
  freemarker: string,
  summary: string
): TemplateRevision => ({
  id: makeId("revision"),
  actor: "user",
  summary: summary.trim() || "Updated in Template Studio",
  freemarker,
  createdAt: now()
});
