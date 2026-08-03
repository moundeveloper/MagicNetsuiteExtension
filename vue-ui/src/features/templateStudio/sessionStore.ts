export const TEMPLATE_SESSION_STORE_KEY =
  "magic_netsuite_template_design_sessions_v1";
export const TEMPLATE_STUDIO_VIEW_STATE_KEY =
  "magic_netsuite_template_studio_view_state";
export const TEMPLATE_STUDIO_CAPTURE_REQUEST_KEY =
  "magic_netsuite_template_studio_capture_request";
export const TEMPLATE_STUDIO_CAPTURE_RESPONSE_KEY =
  "magic_netsuite_template_studio_capture_response";
export const TEMPLATE_STUDIO_ASSET_REQUEST_KEY =
  "magic_netsuite_template_studio_asset_request";
export const TEMPLATE_STUDIO_ASSET_RESPONSE_KEY =
  "magic_netsuite_template_studio_asset_response";
export const TEMPLATE_IMAGE_ASSET_URI_PREFIX = "mns-asset://";

export type TemplateSessionStatus =
  | "brief_ready"
  | "designing"
  | "rendering"
  | "rendered"
  | "render_error"
  | "completed";

export type TemplateContextMode = "freestyle" | "transaction" | "customrecord";

export interface TemplateReferenceImage {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  createdAt: string;
}

export interface TemplateImageAsset {
  id: string;
  name: string;
  placeholder: string;
  kind: "svg" | "raster";
  mimeType: "image/svg+xml" | "image/png" | "image/jpeg";
  originalMimeType: string;
  source: "upload" | "ai_svg";
  width: number;
  height: number;
  byteSize: number;
  dataUrl?: string;
  svgSource?: string;
  createdAt: string;
  updatedAt: string;
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
  templateFileName: string;
  referenceImages: TemplateReferenceImage[];
  imageAssets: TemplateImageAsset[];
  assetToolsEnabled: boolean;
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
  name?: string;
  prompt?: string;
  freemarker?: string;
  templateFileName?: string;
  referenceImages?: TemplateReferenceImage[];
  imageAssets?: TemplateImageAsset[];
  assetToolsEnabled?: boolean;
  contextMode?: TemplateContextMode;
  recordType?: string;
  recordId?: string;
  recordLabel?: string;
  accountId?: string;
}

const now = () => new Date().toISOString();
const makeId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const makeAssetId = () =>
  `asset_${globalThis.crypto?.randomUUID?.().replace(/-/g, "") || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`}`;

export const templateImageAssetPlaceholder = (assetId: string) =>
  `${TEMPLATE_IMAGE_ASSET_URI_PREFIX}${assetId}`;

export const emptyTemplateSessionStore = (): TemplateSessionStore => ({
  schemaVersion: 1,
  currentSessionId: "",
  sessions: [],
  updatedAt: now(),
});

const normalizeSession = (
  value: Partial<TemplateDesignSession>,
): TemplateDesignSession => {
  const timestamp = now();
  return {
    id: String(value.id || makeId("template")),
    name: String(value.name || "Untitled template"),
    prompt: String(value.prompt || ""),
    templateFileName: String(value.templateFileName || ""),
    referenceImages: Array.isArray(value.referenceImages)
      ? value.referenceImages.filter((image): image is TemplateReferenceImage =>
          Boolean(image?.id && image?.dataUrl),
        )
      : [],
    imageAssets: Array.isArray(value.imageAssets)
      ? value.imageAssets
          .filter((asset): asset is TemplateImageAsset =>
            Boolean(
              asset?.id &&
              (/^data:image\/(?:png|jpe?g);base64,/i.test(
                asset?.dataUrl || "",
              ) ||
                asset?.svgSource?.trim().startsWith("<")),
            ),
          )
          .map((asset) => {
            const isSvg = Boolean(asset.svgSource?.trim());
            const rasterMimeType = /^data:image\/(?:jpeg|jpg);base64,/i.test(
              asset.dataUrl || "",
            )
              ? ("image/jpeg" as const)
              : ("image/png" as const);
            return {
              id: String(asset.id),
              name: String(
                asset.name ||
                  (isSvg ? "template-image.svg" : "template-image.png"),
              ),
              placeholder: templateImageAssetPlaceholder(asset.id),
              kind: isSvg ? ("svg" as const) : ("raster" as const),
              mimeType: isSvg ? ("image/svg+xml" as const) : rasterMimeType,
              originalMimeType: String(
                asset.originalMimeType ||
                  (isSvg ? "image/svg+xml" : rasterMimeType),
              ),
              source:
                asset.source === "ai_svg"
                  ? ("ai_svg" as const)
                  : ("upload" as const),
              width: Math.max(1, Number(asset.width) || 1),
              height: Math.max(1, Number(asset.height) || 1),
              byteSize: Math.max(0, Number(asset.byteSize) || 0),
              ...(isSvg
                ? { svgSource: String(asset.svgSource || "") }
                : { dataUrl: String(asset.dataUrl || "") }),
              createdAt: String(asset.createdAt || timestamp),
              updatedAt: String(
                asset.updatedAt || asset.createdAt || timestamp,
              ),
            };
          })
      : [],
    assetToolsEnabled: value.assetToolsEnabled !== false,
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
              : undefined,
          }))
      : [],
    revisions: Array.isArray(value.revisions)
      ? value.revisions.slice(0, 30)
      : [],
    status: value.status || "brief_ready",
    version: Number(value.version) || 1,
    sourceVersion:
      Number(value.sourceVersion) || (String(value.freemarker || "") ? 1 : 0),
    renderVersion: Number(value.renderVersion) || 0,
    createdAt: String(value.createdAt || timestamp),
    updatedAt: String(value.updatedAt || timestamp),
    lastRenderedAt: String(value.lastRenderedAt || ""),
  };
};

export const normalizeTemplateSessionStore = (
  value: unknown,
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
      (session) => session.id === requestedCurrent,
    )
      ? requestedCurrent
      : sessions[0]?.id || "",
    sessions,
    updatedAt: String(raw.updatedAt || now()),
  };
};

export const loadTemplateSessionStore =
  async (): Promise<TemplateSessionStore> => {
    const result = await chrome.storage.local.get(TEMPLATE_SESSION_STORE_KEY);
    return normalizeTemplateSessionStore(result[TEMPLATE_SESSION_STORE_KEY]);
  };

export const saveTemplateSessionStore = async (
  store: TemplateSessionStore,
): Promise<TemplateSessionStore> => {
  const normalized = normalizeTemplateSessionStore({
    ...store,
    updatedAt: now(),
  });
  await chrome.storage.local.set({
    [TEMPLATE_SESSION_STORE_KEY]: normalized,
  });
  return normalized;
};

export const deleteTemplateDesignSession = (
  store: TemplateSessionStore,
  sessionId: string,
): TemplateSessionStore => {
  const normalized = normalizeTemplateSessionStore(store);
  const removedIndex = normalized.sessions.findIndex(
    (session) => session.id === sessionId,
  );
  if (removedIndex < 0) return normalized;

  const sessions = normalized.sessions.filter(
    (session) => session.id !== sessionId,
  );
  const deletingCurrent = normalized.currentSessionId === sessionId;
  const nextCurrentSessionId = deletingCurrent
    ? sessions[Math.min(removedIndex, sessions.length - 1)]?.id || ""
    : normalized.currentSessionId;

  return normalizeTemplateSessionStore({
    ...normalized,
    currentSessionId: nextCurrentSessionId,
    sessions,
    updatedAt: now(),
  });
};

export const createTemplateDesignSession = (
  input: NewTemplateSessionInput,
): TemplateDesignSession => {
  const timestamp = now();
  const freemarker = String(input.freemarker || "").trim();
  const templateFileName = String(input.templateFileName || "").trim();
  const derivedName = templateFileName
    .replace(/\.(?:xml|ftl|html?|txt)$/i, "")
    .trim();
  return normalizeSession({
    id: makeId("template"),
    name: String(input.name || "").trim() || derivedName || "Untitled template",
    prompt: String(input.prompt || "").trim(),
    templateFileName,
    referenceImages: input.referenceImages || [],
    imageAssets: input.imageAssets || [],
    assetToolsEnabled: input.assetToolsEnabled !== false,
    contextMode: input.contextMode || "freestyle",
    recordType: input.recordType || "",
    recordId: input.recordId || "",
    recordLabel: input.recordLabel || "",
    accountId: input.accountId || "",
    freemarker,
    revisions: freemarker
      ? [
          {
            id: makeId("revision"),
            actor: "user",
            summary: templateFileName
              ? `Imported from ${templateFileName}`
              : "Imported template source",
            freemarker,
            createdAt: timestamp,
          },
        ]
      : [],
    status: freemarker ? "designing" : "brief_ready",
    sourceVersion: freemarker ? 1 : 0,
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
};

export const makeTemplateReferenceImage = (
  name: string,
  mimeType: string,
  dataUrl: string,
): TemplateReferenceImage => ({
  id: makeId("reference"),
  name,
  mimeType,
  dataUrl,
  createdAt: now(),
});

export const makeTemplateImageAsset = (
  input: Omit<
    TemplateImageAsset,
    "id" | "placeholder" | "createdAt" | "updatedAt"
  >,
): TemplateImageAsset => {
  const timestamp = now();
  const id = makeAssetId();
  return {
    ...input,
    id,
    placeholder: templateImageAssetPlaceholder(id),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const makeTemplateFeedback = (text: string): TemplateFeedback => ({
  id: makeId("feedback"),
  text: text.trim(),
  status: "open",
  checked: false,
  createdAt: now(),
});

export const makeUserTemplateRevision = (
  freemarker: string,
  summary: string,
): TemplateRevision => ({
  id: makeId("revision"),
  actor: "user",
  summary: summary.trim() || "Updated in Template Studio",
  freemarker,
  createdAt: now(),
});
