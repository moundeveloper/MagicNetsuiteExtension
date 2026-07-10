import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";

// Dedicated, on-disk Chromium profile so the NetSuite login survives across
// sessions. Independent of the user's daily browser (Chrome/Brave/etc.) — we
// drive Playwright's own bundled Chromium, no debug flags, no profile sharing.
const PROFILE_DIR =
  process.env.MAGIC_NS_PW_PROFILE ||
  path.join(os.homedir(), ".magic-netsuite", "pw-profile");

// NetSuite's auth cookies are session-scoped (no expiry), so a persistent
// profile alone drops them when the context closes / the node process is
// killed (e.g. on Claude restart). We additionally snapshot storageState
// (which captures session cookies) and re-inject it on launch.
const STATE_FILE = path.join(path.dirname(PROFILE_DIR), "magic-ns-storage-state.json");
const TEMPLATE_REVIEW_STATE_FILE =
  process.env.MAGIC_NS_TEMPLATE_REVIEW_STATE ||
  path.join(path.dirname(PROFILE_DIR), "template-review-state.json");

const NAV_TIMEOUT = 45000;

// Extension logo, used as the Playwright tab favicon. Read from disk at startup
// (dev runs from mcp_app/, built runs from mcp_app/dist/), so try both depths.
const BRAND_TITLE_PREFIX = "Magic Netsuite Testing";
const FAVICON_DATA_URI = (() => {
  const candidates = [
    path.join(import.meta.dirname, "..", "..", "src", "icons", "icon32.png"),
    path.join(import.meta.dirname, "..", "src", "icons", "icon32.png"),
  ];
  for (const file of candidates) {
    try {
      const b64 = fs.readFileSync(file).toString("base64");
      return `data:image/png;base64,${b64}`;
    } catch {
      /* try next */
    }
  }
  return "";
})();

let context: BrowserContext | null = null;
let page: Page | null = null;
let launching: Promise<Page> | null = null;

type TemplateReviewStatus = "open" | "needs_changes" | "approved" | "ftl_review" | "done";
type TemplateReviewComment = {
  initials: string;
  name: string;
  time: string;
  text: string;
  color: "blue" | "purple" | "green";
  isYou?: boolean;
};
type TemplateReviewState = {
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
  comments: TemplateReviewComment[];
  status: TemplateReviewStatus;
  version: number;
  updatedAt: string;
};

let templateReviewState: TemplateReviewState | null = null;
let templateReviewBindingReady = false;
const templateReviewWaiters = new Set<(state: TemplateReviewState) => void>();

async function launch(): Promise<Page> {
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, // actions must be visible (user requirement)
    viewport: null, // null + --start-maximized => real maximized window
    args: ["--start-maximized"],
  });
  context = ctx;
  ctx.on("close", () => {
    context = null;
    page = null;
    templateReviewBindingReady = false;
  });

  // Re-inject previously saved session cookies (lost from the profile on close).
  try {
    if (fs.existsSync(STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      if (Array.isArray(state?.cookies) && state.cookies.length) {
        await ctx.addCookies(state.cookies);
      }
    }
  } catch {
    /* corrupt/absent state — user just logs in again */
  }

  const p = ctx.pages()[0] ?? (await ctx.newPage());
  p.on("close", () => {
    if (page === p) page = null;
    templateReviewBindingReady = false;
  });
  page = p;
  return p;
}

// Persist cookies (incl. session cookies) so login survives restarts.
async function saveState(): Promise<void> {
  if (!context) return;
  try {
    await context.storageState({ path: STATE_FILE });
  } catch {
    /* best effort */
  }
}

async function ensurePage(): Promise<Page> {
  if (page && !page.isClosed()) return page;
  // Page died (e.g. a bad eval closed the tab) but the context is still alive:
  // open a fresh page in the SAME context. Relaunching would try to re-lock the
  // profile dir and collide with the existing Chromium window.
  if (context) {
    try {
      const np = (context.pages().find((pg) => !pg.isClosed())) ?? (await context.newPage());
      np.on("close", () => {
        if (page === np) page = null;
        templateReviewBindingReady = false;
      });
      page = np;
      return np;
    } catch {
      context = null; // context truly dead — fall through to relaunch
    }
  }
  if (launching) return launching;
  launching = launch().finally(() => {
    launching = null;
  });
  return launching;
}

// NetSuite bounces unauthenticated requests to a login form. Detect it so the
// caller can tell the user to log in once in the visible window.
async function detectLogin(p: Page): Promise<boolean> {
  const url = p.url();
  if (/system\.netsuite\.com|\/login|\/pages\/login|account-login/i.test(url)) {
    return true;
  }
  try {
    const hasLoginField = await p
      .locator('input[name="email"], input[type="password"], #login-email, #login-password')
      .first()
      .isVisible({ timeout: 800 });
    if (hasLoginField) return true;
  } catch {
    /* no login field visible */
  }
  return false;
}

const INSPECT_FN = () => {
  const visible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const selectorFor = (el: Element): string => {
    if (el.id) return "#" + CSS.escape(el.id);
    const name = el.getAttribute("name");
    if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
    const dataInput = el.getAttribute("data-input-id");
    if (dataInput) return el.tagName.toLowerCase() + '[data-input-id="' + dataInput + '"]';
    const path: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && path.length < 5) {
      let part = node.tagName.toLowerCase();
      const parent: Element | null = node.parentElement;
      if (parent) {
        const idx = Array.prototype.indexOf.call(parent.children, node) + 1;
        part += ":nth-child(" + idx + ")";
      }
      path.unshift(part);
      if (node.id) {
        path[0] = "#" + CSS.escape(node.id);
        break;
      }
      node = node.parentElement;
    }
    return path.join(" > ");
  };
  const nodes = Array.prototype.slice.call(
    document.querySelectorAll(
      "input, textarea, select, button, a[href], [role=button], [onclick], .ddarrowSpan, .uir-field-dropdown-arrow, [data-input-id], .uir-field-wrapper[data-nsps-label]",
    ),
  ) as Element[];
  const out: Array<Record<string, string>> = [];
  for (let i = 0; i < nodes.length && out.length < 120; i++) {
    const el = nodes[i] as HTMLElement;
    if (!visible(el)) continue;
    const labelledById = el.getAttribute("aria-labelledby");
    const labelledBy = labelledById ? document.getElementById(labelledById) : null;
    const fieldWrapper = el.closest ? el.closest(".uir-field-wrapper[data-nsps-label]") : null;
    out.push({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || "",
      id: el.id || "",
      name: el.getAttribute("name") || "",
      selector: selectorFor(el),
      label: (
        el.innerText ||
        (el as HTMLInputElement).value ||
        (el as HTMLInputElement).placeholder ||
        el.getAttribute("aria-label") ||
        (labelledBy && labelledBy.innerText) ||
        el.getAttribute("title") ||
        el.getAttribute("data-nsps-label") ||
        (fieldWrapper && fieldWrapper.getAttribute("data-nsps-label")) ||
        ""
      )
        .trim()
        .slice(0, 100),
    });
  }
  return { title: document.title, url: location.href, count: out.length, elements: out };
};

async function screenshotB64(p: Page): Promise<string> {
  const buf = await p.screenshot({ type: "jpeg", quality: 60 });
  return buf.toString("base64");
}

// Wait for the page to actually finish loading after an action before we
// screenshot: full load + network idle + NetSuite's own loading indicators
// gone, plus a small settle for late client-side rendering.
async function settlePage(p: Page): Promise<void> {
  await p.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
  await p.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  // NetSuite spinners / loading masks across UI generations.
  await p
    .locator("#loadingindicator, #div__alt_l> img, .uir-page-loading-indicator, .bg_loading, .ns-loading-indicator")
    .first()
    .waitFor({ state: "hidden", timeout: 8000 })
    .catch(() => {});
  await p.waitForTimeout(350);
}

// Rebrand the tab: set the title to "Magic Netsuite Testing <suitelet>" and the
// favicon to the extension logo, and keep re-applying them (NetSuite's own JS
// resets document.title and the favicon as the page boots).
async function brandTab(p: Page, title: string, favicon: string): Promise<void> {
  try {
    await p.evaluate(
      ({ title, favicon }) => {
        // IDEMPOTENT: only touch the DOM when something is actually wrong, so
        // re-applying is cheap and never causes DOM churn. NO MutationObserver —
        // observing the whole document while mutating <head> self-triggers an
        // infinite loop that freezes/crashes the tab on DOM-heavy pages.
        const apply = () => {
          if (title && document.title !== title) document.title = title;
          if (favicon && document.head) {
            const existing = document.head.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
            if (existing && existing.href === favicon) return; // already ours — do nothing
            // Remove other icon links (rel is case-insensitive, e.g. "SHORTCUT ICON").
            Array.from(document.querySelectorAll("link")).forEach((el) => {
              if ((el.getAttribute("rel") || "").toLowerCase().includes("icon")) {
                el.parentNode?.removeChild(el);
              }
            });
            const link = document.createElement("link");
            link.rel = "icon";
            link.type = "image/png";
            link.href = favicon;
            document.head.appendChild(link);
          }
        };
        apply();
        // NetSuite sets its own title/favicon a beat after load — re-apply on a
        // few bounded, timed ticks (cheap because apply() is idempotent), then stop.
        const w = window as unknown as { __magicNsBrandTimer?: number };
        if (!w.__magicNsBrandTimer) {
          let ticks = 0;
          w.__magicNsBrandTimer = window.setInterval(() => {
            apply();
            if (++ticks >= 8) {
              window.clearInterval(w.__magicNsBrandTimer);
              w.__magicNsBrandTimer = undefined;
            }
          }, 1000);
        }
      },
      { title, favicon },
    );
  } catch {
    /* page navigated mid-brand — best effort */
  }
}

function makeReviewId(): string {
  return `review_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultTemplateReviewComments(): TemplateReviewComment[] {
  return [];
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function stringArray(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : fallback;
}

function makeEmptyTemplateReviewState(): TemplateReviewState {
  return {
    reviewId: makeReviewId(),
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
    comments: defaultTemplateReviewComments(),
    status: "open",
    version: 0,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeTemplateReviewState(value: unknown): TemplateReviewState | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const status = input.status === "needs_changes" ||
    input.status === "approved" ||
    input.status === "ftl_review" ||
    input.status === "done"
    ? input.status
    : "open";
  return {
    ...makeEmptyTemplateReviewState(),
    reviewId: typeof input.reviewId === "string" && input.reviewId ? input.reviewId : makeReviewId(),
    title: typeof input.title === "string" && input.title ? input.title : "NetSuite Template Review",
    templateFile: typeof input.templateFile === "string" && input.templateFile ? input.templateFile : "invoice_template.ftl",
    recordType: typeof input.recordType === "string" && input.recordType ? input.recordType : "invoice",
    recordId: typeof input.recordId === "string" ? input.recordId : "",
    recordTypeOptions: stringArray(input.recordTypeOptions, ["invoice"]),
    recordIdOptions: stringArray(input.recordIdOptions),
    html: typeof input.html === "string" ? input.html : "",
    freemarker: typeof input.freemarker === "string" ? input.freemarker : "",
    renderedResult: typeof input.renderedResult === "string" ? input.renderedResult : "",
    referenceImageDataUrl: typeof input.referenceImageDataUrl === "string" ? input.referenceImageDataUrl : "",
    referenceImageUrl: typeof input.referenceImageUrl === "string" ? input.referenceImageUrl : "",
    feedback: typeof input.feedback === "string" ? input.feedback : "",
    comments: Array.isArray(input.comments) ? input.comments as TemplateReviewComment[] : [],
    status,
    version: typeof input.version === "number" ? input.version : 0,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
  };
}

function loadPersistedTemplateReviewState(): TemplateReviewState | null {
  try {
    return normalizeTemplateReviewState(JSON.parse(fs.readFileSync(TEMPLATE_REVIEW_STATE_FILE, "utf8")));
  } catch {
    return null;
  }
}

function currentReviewSnapshot(): TemplateReviewState {
  if (!templateReviewState) templateReviewState = loadPersistedTemplateReviewState();
  if (!templateReviewState) throw new Error("No template review is open.");
  return { ...templateReviewState };
}

function resolveTemplateReview(state: TemplateReviewState): void {
  for (const resolve of templateReviewWaiters) resolve({ ...state });
  templateReviewWaiters.clear();
}

function persistTemplateReviewState(state: TemplateReviewState): void {
  try {
    fs.mkdirSync(path.dirname(TEMPLATE_REVIEW_STATE_FILE), { recursive: true });
    fs.writeFileSync(TEMPLATE_REVIEW_STATE_FILE, JSON.stringify({
      reviewId: state.reviewId,
      title: state.title,
      templateFile: state.templateFile,
      recordType: state.recordType,
      recordId: state.recordId,
      recordTypeOptions: state.recordTypeOptions,
      recordIdOptions: state.recordIdOptions,
      html: state.html,
      freemarker: state.freemarker,
      renderedResult: state.renderedResult,
      referenceImageDataUrl: state.referenceImageDataUrl,
      referenceImageUrl: state.referenceImageUrl,
      status: state.status,
      feedback: state.feedback,
      comments: state.comments,
      version: state.version,
      updatedAt: state.updatedAt,
      pending: state.status !== "done",
    }, null, 2));
  } catch {
    /* hook state is best-effort */
  }
}

function applyTemplateReviewUpdate(patch: Partial<TemplateReviewState>): TemplateReviewState {
  if (!templateReviewState) {
    templateReviewState = loadPersistedTemplateReviewState() || makeEmptyTemplateReviewState();
  }
  const cleanPatch = withoutUndefined(patch as Record<string, unknown>) as Partial<TemplateReviewState>;
  templateReviewState = {
    ...templateReviewState,
    ...cleanPatch,
    version: templateReviewState.version + 1,
    updatedAt: new Date().toISOString(),
  };
  persistTemplateReviewState(templateReviewState);
  if (
    templateReviewState.status === "approved" ||
    templateReviewState.status === "needs_changes" ||
    templateReviewState.status === "done"
  ) {
    resolveTemplateReview(templateReviewState);
  }
  return { ...templateReviewState };
}

async function ensureTemplateReviewBinding(p: Page): Promise<void> {
  if (templateReviewBindingReady) return;
  try {
    await p.exposeBinding("__magicTemplateReviewAction", async (_source, payload: Record<string, unknown>) => {
      const status =
        payload.status === "approved" ? "approved" :
        payload.status === "done" ? "done" :
        "needs_changes";
      applyTemplateReviewUpdate({
        status,
        feedback: String(payload.feedback ?? ""),
        comments: Array.isArray(payload.comments)
          ? payload.comments as TemplateReviewComment[]
          : templateReviewState?.comments,
        recordType: String(payload.recordType ?? templateReviewState?.recordType ?? ""),
        recordId: String(payload.recordId ?? templateReviewState?.recordId ?? ""),
      });
    });
    templateReviewBindingReady = true;
  } catch {
    templateReviewBindingReady = true;
  }
}

function buildTemplateReviewHtml(state: TemplateReviewState): string {
  const data = JSON.stringify(state).replace(/</g, "\\u003c");
  const candidates = [
    path.join(import.meta.dirname, "template-review.html"),
    path.join(import.meta.dirname, "dist", "template-review.html"),
    path.join(import.meta.dirname, "..", "dist", "template-review.html"),
  ];
  for (const file of candidates) {
    try {
      const html = fs.readFileSync(file, "utf8");
      const boot = `<script>window.__MAGIC_TEMPLATE_REVIEW_INITIAL__=${data};</script>`;
      return html.includes("</head>") ? html.replace("</head>", `${boot}</head>`) : `${boot}${html}`;
    } catch {
      /* try next */
    }
  }
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NetSuite Template Review</title>
  <style>
    :root {
      --bg: #f7f9fc;
      --card: #fff;
      --line: #dfe5ed;
      --line2: #cfd8e5;
      --text: #172238;
      --muted: #6f7d91;
      --accent: #7b2ff7;
      --accent-soft: #faf7ff;
      --accent-border: #d8c6ff;
      --accent-hover: #c6a7ff;
      --green: #14916e;
      --shadow: 0 1px 2px rgba(23,34,56,.035);
      color-scheme: light;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; min-width: 1180px; overflow: hidden; background: var(--bg); color: var(--text); font-size: 12px; }
    button, input, textarea { font: inherit; color: inherit; }
    button { cursor: pointer; }
    .app { width: 100vw; height: 100vh; padding: 4px 10px; overflow: hidden; display: grid; grid-template-rows: 69px minmax(0, 1fr); gap: 0; }
    .meta { min-height: 0; padding: 10px 18px; display: flex; align-items: center; gap: 28px; border: 1px solid var(--line); border-radius: 7px; background: #fff; box-shadow: var(--shadow); }
    .meta-item { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
    .meta-label { font-size: 11px; color: #66758a; }
    .meta-value { display: block; min-width: 145px; max-width: 240px; height: 34px; line-height: 32px; padding: 0 11px; border: 1px solid #dce3ec; border-radius: 7px; background: #f6f8fb; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .record-field { width: 178px; height: 34px; padding: 0 10px; border: 1px solid #d7dfe9; border-radius: 7px; background: #fff; font-weight: 650; outline: none; }
    .record-field:focus { border-color: var(--accent-hover); box-shadow: 0 0 0 3px rgba(198,167,255,.18); }
    .updated { margin-left: auto; color: var(--muted); font-size: 11px; white-space: nowrap; }
    .status-pill { display: none; }
    .main { min-height: 0; display: grid; grid-template-columns: 192px minmax(0, 1fr); column-gap: 20px; }
    .steps { min-height: 0; padding: 34px 6px 0; border: 1px solid var(--line); border-top: 0; border-radius: 0 0 7px 7px; background: #fff; }
    .step { position: relative; width: 100%; height: 62px; display: grid; grid-template-columns: 34px 1fr 24px; align-items: center; column-gap: 10px; padding: 0 10px; border: 1px solid transparent; border-radius: 7px; background: transparent; text-align: left; color: #5e6c80; }
    .step:not(:last-child)::after { content: ""; position: absolute; left: 25px; top: 44px; width: 1px; height: 42px; background: #dde4ed; }
    .step-number { width: 29px; height: 29px; display: grid; place-items: center; border: 1px solid #cbd5e2; border-radius: 50%; background: #fff; color: #607087; font-size: 12px; z-index: 1; }
    .step strong { display: block; font-size: 12px; color: #536176; }
    .step small { display: block; margin-top: 3px; color: var(--accent); font-size: 10px; }
    .step .state { justify-self: end; color: var(--green); }
    .step.active { background: var(--accent-soft); border-color: var(--accent-border); color: var(--accent); }
    .step.active .step-number { border-color: var(--accent); background: var(--accent); color: #fff; }
    .step.active strong { color: var(--accent); }
    .step.locked .state { color: #8b97a8; }
    .content { height: 100%; min-height: 0; overflow: hidden; padding-top: 15px; display: grid; grid-template-rows: minmax(0,1fr) 136px; min-width: 0; }
    .review-panels { min-height: 0; display: grid; grid-template-columns: 36.7% 41% 22.3%; border: 1px solid var(--line); border-bottom: 0; border-radius: 7px 7px 0 0; overflow: hidden; background: #fff; }
    .panel { min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--line); background: #fff; }
    .panel:last-child { border-right: 0; }
    .panel-head { height: 49px; flex: 0 0 49px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 11px 0 15px; border-bottom: 1px solid var(--line); background: #fff; }
    .panel-head h2 { margin: 0; font-size: 12px; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .panel-head h2 span { color: var(--muted); font-weight: 500; }
    .info { display: inline-grid; place-items: center; width: 14px; height: 14px; margin-left: 4px; border: 1px solid #8e9aad; border-radius: 50%; font-size: 8px; color: #7f8b9b; vertical-align: 1px; }
    .tools { display: flex; align-items: center; flex-shrink: 0; }
    .tool { height: 28px; min-width: 28px; padding: 0 8px; border: 1px solid #dce3ec; background: #fff; color: #536176; }
    .tool:first-child { border-radius: 5px 0 0 5px; }
    .tool:last-child { border-radius: 0 5px 5px 0; }
    .tool + .tool { border-left: 0; }
    .tool.zoom { min-width: 46px; }
    #renderZoom { min-width: 58px; }
    .tool.solo { border-radius: 5px !important; border-left: 1px solid #dce3ec !important; margin-left: 8px; }
    .tool:hover, .secondary:hover, .action-btn:hover { border-color: var(--accent-hover); background: var(--accent-soft); color: var(--accent); }
    .reference-body, .render-body, .status-body { flex: 1; min-height: 0; overflow: hidden; }
    .reference-body { padding: 0 9px 11px 10px; background: #fff; }
    .reference-stage { height: 100%; display: grid; place-items: center; border: 1px solid #e0e6ee; border-radius: 6px; background: linear-gradient(#fbfcfe,#f7f9fc); overflow: auto; }
    .reference-stage img { display: block; max-width: 100%; height: auto; transform-origin: top center; transition: transform .15s ease; }
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
    .status-body { padding: 10px 22px 12px 23px; overflow: auto; display: flex; flex-direction: column; gap: 0; }
    .status-card { margin-bottom: 12px; padding: 14px; border: 1px solid #dde4ed; border-radius: 7px; background: #fcfdff; }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; color: #5e6d82; font-size: 11px; }
    .row:last-child { margin-bottom: 0; }
    .row strong { min-width: 0; text-align: right; color: #27344b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge { padding: 4px 8px; border-radius: 4px; background: var(--accent-soft); color: var(--accent) !important; border: 1px solid var(--accent-border); }
    .lockbox { display: grid; grid-template-columns: 23px 1fr; gap: 8px; margin: 0 0 20px; padding: 12px; border: 1px solid #b8c8fb; border-radius: 7px; background: #f5f7ff; }
    .lockbox svg { width: 20px; height: 20px; stroke: #315adf; }
    .lockbox p { margin: 0; color: #354158; font-size: 11px; line-height: 1.35; }
    .lockbox strong { display: block; margin-bottom: 3px; }
    .comments-title { display: flex; align-items: center; justify-content: space-between; margin: 0 0 14px; }
    .comments-title h3 { margin: 0; font-size: 13px; }
    .count { width: 25px; height: 25px; display: grid; place-items: center; border-radius: 6px; background: #eef1f6; font-size: 11px; font-weight: 700; color: #556276; }
    .comments { display: flex; flex-direction: column; gap: 16px; }
    .comment { display: grid; grid-template-columns: 33px 1fr; gap: 9px; }
    .avatar { width: 31px; height: 31px; display: grid; place-items: center; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 800; }
    .avatar.blue { background: #4970de; }
    .avatar.purple { background: #7862e6; }
    .avatar.green { background: #66ae8b; }
    .comment-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .comment-top strong { font-size: 11px; }
    .comment-top time { font-size: 8px; color: #8592a3; white-space: nowrap; }
    .you { margin-left: 4px; padding: 2px 5px; border-radius: 4px; background: var(--accent-soft); color: var(--accent); font-size: 8px; font-weight: 600; }
    .comment p { margin: 6px 0 0; font-size: 10.5px; line-height: 1.4; color: #38445a; }
    .add-comment { width: 100%; margin-top: 14px; height: 34px; border: 1px solid #cfd8e4; border-radius: 5px; background: #fff; font-size: 11px; font-weight: 600; }
    .add-comment:hover { border-color: var(--accent-hover); background: var(--accent-soft); color: var(--accent); }
    .result-frame-wrap { display: none; min-height: 260px; border: 1px solid #dde4ed; border-radius: 7px; overflow: auto; background: #fff; }
    .result-frame-wrap iframe { min-height: 520px; }
    pre { min-height: 230px; margin: 0; padding: 10px; border: 1px solid #dde4ed; border-radius: 7px; color: #27323a; background: #fff; font: 11px/1.42 Consolas, "Courier New", monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    .notes { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 20px; padding: 13px 18px 17px 14px; border: 1px solid var(--line); border-radius: 0 0 7px 7px; background: #fff; }
    .notes label { display: block; margin-bottom: 4px; font-size: 11px; font-weight: 750; }
    .notes .hint { display: block; margin-bottom: 8px; color: var(--muted); font-size: 9px; }
    .editor { height: 67px; border: 1px solid #dce3ec; border-radius: 6px; overflow: hidden; }
    .editor textarea { display: block; width: 100%; height: 40px; padding: 10px 11px 3px; border: 0; outline: 0; resize: none; font-size: 11px; }
    .editor:focus-within { border-color: var(--accent-hover); box-shadow: 0 0 0 3px rgba(198,167,255,.18); }
    .editor-tools { height: 26px; display: flex; align-items: center; justify-content: space-between; padding: 0 9px; color: #728096; }
    .toolbar-buttons { display: flex; align-items: center; gap: 7px; }
    .list-tool { height: 22px; display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; border: 1px solid #d9e1eb; border-radius: 5px; background: #fff; color: #56657a; font-size: 10px; font-weight: 650; }
    .list-tool:hover { border-color: var(--accent-hover); background: var(--accent-soft); color: var(--accent); }
    .counter { font-size: 9px; }
    .note-actions { display: flex; align-items: flex-end; gap: 10px; padding-bottom: 13px; }
    .action-btn { height: 36px; min-width: 108px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 13px; border: 1px solid #cfd8e4; border-radius: 5px; background: #fff; font-weight: 700; font-size: 11px; white-space: nowrap; }
    .action-btn svg { width: 14px; height: 14px; flex: 0 0 auto; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .approve { min-width: 230px; border-color: #3858e9; background: #3858e9; color: #fff; box-shadow: 0 2px 5px rgba(56,88,233,.18); }
    .approve:hover { border-color: #2748d8; background: #2748d8; color: #fff; }
    .end { min-width: 92px; border-color: var(--accent-border); background: var(--accent-soft); color: var(--accent); }
    .toast { position: fixed; right: 22px; bottom: 22px; z-index: 80; padding: 12px 15px; border: 1px solid var(--accent-border); border-radius: 7px; background: var(--accent-soft); color: var(--accent); box-shadow: 0 12px 30px rgba(24,40,75,.16); opacity: 0; transform: translateY(10px); pointer-events: none; transition: .18s; }
    .toast.show { opacity: 1; transform: none; }
    @media (max-width: 1350px) {
      html, body { min-width: 1040px; }
      .app { padding-left: 8px; padding-right: 8px; }
      .main { grid-template-columns: 170px minmax(0,1fr); column-gap: 10px; }
      .review-panels { grid-template-columns: 35.5% 40.5% 24%; }
      .meta { gap: 14px; padding-left: 12px; padding-right: 12px; }
      .record-field { width: 148px; }
    }
    /* Ported from the supplied HTML design. Keep these overrides last so the
       generated MCP page tracks that review surface instead of the old shell. */
    html, body { min-width: 0; width: 100vw; height: 100vh; }
    .app { width: 100vw; height: 100vh; min-height: 0; padding: 4px 10px; display: grid; grid-template-rows: 69px minmax(0, 1fr); overflow: hidden; }
    .meta { height: 69px; margin-top: 0; padding: 10px 39px; align-items: center; gap: 58px; }
    .meta-item { position: relative; justify-content: center; }
    .template-file { min-width: 150px; }
    .meta-filename { display: block; color: #253149; font-size: 12px; font-weight: 700; line-height: 34px; white-space: nowrap; max-width: 210px; overflow: hidden; text-overflow: ellipsis; }
    .main { min-height: 0; height: 100%; display: grid; grid-template-columns: 192px minmax(0,1fr); column-gap: 20px; overflow: hidden; }
    .steps { height: 100%; min-height: 0; margin-top: 0; padding: 34px 6px 0; overflow: hidden; }
    .content { height: 100%; min-height: 0; padding-top: 15px; grid-template-rows: minmax(0,1fr) 136px; overflow: hidden; }
    .review-panels { grid-template-columns: 36.7% 41% 22.3%; }
    .status-body { padding: 10px 18px 12px 23px; display: block; }
    .status-card { padding: 14px; }
    .row { margin-bottom: 14px; }
    .notes { grid-template-columns: minmax(0,1fr) auto; gap: 20px; padding: 13px 18px 17px 14px; }
    .note-actions { gap: 24px; padding-bottom: 13px; }
    .action-btn { width: 145px; height: 36px; padding: 0 12px; font-weight: 650; }
    .approve { width: 230px; min-width: 230px; height: 36px; padding: 0 12px; font-weight: 700; }
    .end { width: 98px; min-width: 98px; }
    .custom-select { position: relative; width: 178px; }
    .select-trigger {
      width: 100%; height: 34px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 0 11px; border: 1px solid #d7dfe9; border-radius: 7px; background: #fff;
      color: #27344b; font-size: 12px; font-weight: 650; text-align: left; box-shadow: 0 1px 1px rgba(23,34,56,.02);
    }
    .select-trigger:hover { border-color: #b9c5d6; }
    .custom-select.open .select-trigger { border-color: var(--accent-hover); box-shadow: 0 0 0 3px rgba(198,167,255,.18); }
    .select-chevron { color: #718096; font-size: 14px; transition: transform .15s ease; }
    .custom-select.open .select-chevron { transform: rotate(180deg); }
    .select-menu {
      position: absolute; z-index: 30; left: 0; right: 0; top: 39px; display: none; padding: 5px;
      border: 1px solid #d5deea; border-radius: 7px; background: #fff;
      box-shadow: 0 12px 28px rgba(23,34,56,.14);
    }
    .custom-select.open .select-menu { display: grid; }
    .select-menu button { min-height: 32px; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: #344158; font-size: 11px; text-align: left; }
    .select-menu button:hover, .select-menu button[aria-selected="true"] { background: var(--accent-soft); color: var(--accent); }
    .select-menu button[aria-selected="true"] { font-weight: 700; }
    .modal { position: fixed; inset: 0; display: none; z-index: 50; }
    .modal.open { display: block; }
    .backdrop { position: absolute; inset: 0; background: rgba(20,30,50,.42); }
    .dialog { position: relative; width: min(820px, calc(100vw - 60px)); height: min(720px, calc(100vh - 60px)); margin: 30px auto; background: #fff; border-radius: 9px; box-shadow: 0 25px 70px rgba(20,30,50,.28); overflow: hidden; }
    .dialog-head { height: 55px; display: flex; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid var(--line); }
    .dialog-head h2 { margin: 0; font-size: 16px; }
    .dialog-body { height: calc(100% - 55px); display: grid; place-items: center; background: #f7f9fc; }
    .dialog-body img { max-width: 94%; max-height: 94%; object-fit: contain; }
    .close { width: 32px; height: 32px; border: 0; background: transparent; font-size: 22px; }
    @media (max-width: 1350px) {
      .main { grid-template-columns: 170px 1fr; }
      .review-panels { grid-template-columns: 35.5% 40.5% 24%; }
      .note-actions { gap: 10px; }
      .action-btn, .approve { padding: 0 15px; }
    }
  </style>
</head>
<body>
  <div class="app">
    <section class="meta">
      <div class="meta-item template-file">
        <span class="meta-label">Template File</span>
        <span class="meta-filename" id="templateFile" title=""></span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Record Type</span>
        <div class="custom-select" data-custom-select>
          <input type="hidden" id="recordType" value="invoice">
          <button class="select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
            <span class="select-value" id="recordTypeValue">Invoice</span>
            <span class="select-chevron" aria-hidden="true">v</span>
          </button>
          <div class="select-menu" role="listbox">
            <button type="button" role="option" data-value="invoice">Invoice</button>
            <button type="button" role="option" data-value="salesorder">Sales Order</button>
            <button type="button" role="option" data-value="purchaseorder">Purchase Order</button>
            <button type="button" role="option" data-value="creditmemo">Credit Memo</button>
            <button type="button" role="option" data-value="customerstatement">Customer Statement</button>
          </div>
        </div>
      </div>
      <div class="meta-item">
        <span class="meta-label">Record ID</span>
        <div class="custom-select" data-custom-select>
          <input type="hidden" id="recordId" value="">
          <button class="select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
            <span class="select-value" id="recordIdValue">Select record</span>
            <span class="select-chevron" aria-hidden="true">v</span>
          </button>
          <div class="select-menu" role="listbox" id="recordIdMenu">
            <button type="button" role="option" data-value="">Select record</button>
          </div>
        </div>
      </div>
      <div class="updated" id="updated"></div>
      <div class="status-pill" id="status"></div>
    </section>
    <main class="main">
      <aside class="steps" aria-label="Template review workflow">
        <button class="step" type="button"><span class="step-number">1</span><span><strong>Upload</strong></span><span class="state">✓</span></button>
        <button class="step" type="button"><span class="step-number">2</span><span><strong>HTML</strong></span><span class="state">✓</span></button>
        <button class="step active" type="button" id="reviewStep"><span class="step-number">3</span><span><strong>Review</strong><small id="reviewStepText">You are here</small></span><span></span></button>
        <button class="step locked" type="button" id="ftlStep"><span class="step-number">4</span><span><strong>FreeMarker</strong><small id="ftlStepText"></small></span><span class="state">♙</span></button>
        <button class="step locked" type="button" id="previewStep"><span class="step-number">5</span><span><strong>Preview</strong><small id="previewStepText"></small></span><span class="state">♙</span></button>
      </aside>
      <section class="content">
        <div class="review-panels">
          <section class="panel">
            <div class="panel-head">
              <h2>Reference <span>(Source Image)</span><span class="info">i</span></h2>
              <div class="tools">
                <button class="tool" type="button" data-ref="-10" title="Zoom out">-</button>
                <button class="tool zoom" type="button" id="refZoom">100%</button>
                <button class="tool" type="button" data-ref="10" title="Zoom in">+</button>
                <button class="tool solo" type="button" id="openRef" title="Open reference">
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>
                </button>
              </div>
            </div>
            <div class="reference-body"><div class="reference-stage" id="reference"></div></div>
          </section>
          <section class="panel">
            <div class="panel-head">
              <h2>Rendered HTML <span>(Live Preview)</span></h2>
              <div class="tools">
                <button class="tool" type="button" data-render="-10" title="Zoom out">-</button>
                <button class="tool zoom" type="button" id="renderZoom">100%</button>
                <button class="tool" type="button" data-render="10" title="Zoom in">+</button>
              </div>
            </div>
            <div class="render-body"><div class="render-scroll"><div class="iframe-scale-wrap" id="htmlScaleWrap"><iframe id="htmlFrame" sandbox="allow-same-origin"></iframe></div></div></div>
          </section>
          <section class="panel">
            <div class="panel-head">
              <h2>Actions &amp; FreeMarker Status</h2>
              <button class="tool solo" type="button" id="collapseStatus" title="Collapse status">^</button>
            </div>
            <div class="status-body">
              <div class="status-card">
                <div class="row"><span>Review Status</span><strong class="badge" id="statusInline"></strong></div>
                <div class="row"><span>Step</span><strong id="reviewStepNumber">3 of 5</strong></div>
                <div class="row"><span>Locked Until</span><strong id="lockedUntil">Approval</strong></div>
                <div class="row"><span>Next Step</span><strong id="nextStep"></strong></div>
              </div>
              <div class="lockbox" id="lockbox">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                <p><strong>FreeMarker generation is locked.</strong>Approve this HTML to enable FreeMarker generation.</p>
              </div>
              <div class="comments-title"><h3>Comments History</h3><span class="count" id="count">0</span></div>
              <div class="comments" id="comments"></div>
              <button class="add-comment" type="button" id="addComment">Add Comment</button>
              <div class="result-frame-wrap" id="resultFrameWrap"><iframe id="resultFrame" sandbox="allow-same-origin"></iframe></div>
              <pre id="freemarker"></pre>
            </div>
          </section>
        </div>
        <section class="notes">
          <div>
            <label for="feedback">Review notes</label>
            <span class="hint">Write fixes for the agent, or approve when the current stage is correct.</span>
            <div class="editor">
              <textarea id="feedback" maxlength="4000" placeholder="Write fixes for the agent here"></textarea>
              <div class="editor-tools">
                <span class="toolbar-buttons">
                  <button class="list-tool" type="button" id="bullets">Bulleted list</button>
                  <button class="list-tool" type="button" id="numbers">Numbered list</button>
                </span>
                <span class="counter" id="counter">0/4000</span>
              </div>
            </div>
          </div>
          <div class="note-actions">
            <button type="button" class="action-btn" id="save">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
              <span>Save Draft</span>
            </button>
            <button type="button" class="action-btn" id="fixes">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              <span>Send Fixes</span>
            </button>
            <button type="button" class="action-btn approve" id="approve">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5"/></svg>
              <span id="approveLabel">Approve &amp; Generate FreeMarker</span>
            </button>
            <button type="button" class="action-btn end" id="end">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
              <span>End</span>
            </button>
          </div>
        </section>
      </section>
    </main>
  </div>
  <div class="modal" id="modal">
    <div class="backdrop" data-close></div>
    <div class="dialog">
      <div class="dialog-head"><h2>Reference image</h2><button class="close" type="button" data-close>x</button></div>
      <div class="dialog-body" id="modalImageWrap"></div>
    </div>
  </div>
  <div class="toast" id="toast"></div>
  <script>
    let state = ${data};
    let refZoom = 100;
    let renderZoom = 100;
    let lastHtmlSrcdoc = null;
    let lastResultSrcdoc = null;
    let toastTimer;
    const qs = (selector) => document.querySelector(selector);
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const showToast = (message) => {
      const toast = qs("#toast");
      toast.textContent = message;
      toast.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
    };
    const formatDate = (value) => {
      try {
        return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
      } catch {
        return value || "";
      }
    };
    const actionPayload = (status) => ({
      status,
      feedback: qs("#feedback").value || "",
      recordType: qs("#recordType").value || "",
      recordId: qs("#recordId").value || "",
      comments: state.comments || [],
    });
    const labels = {
      invoice: "Invoice",
      salesorder: "Sales Order",
      purchaseorder: "Purchase Order",
      creditmemo: "Credit Memo",
      customerstatement: "Customer Statement",
    };
    const labelFor = (value) => labels[String(value || "").toLowerCase()] || value || "Select record";
    function optionValues(values, current) {
      const out = [];
      if (current) out.push(current);
      (Array.isArray(values) ? values : []).forEach((value) => {
        if (value && !out.includes(value)) out.push(value);
      });
      return out;
    }
    function rebuildOptions(menu, values, placeholder) {
      menu.textContent = "";
      if (placeholder) {
        const option = document.createElement("button");
        option.type = "button";
        option.setAttribute("role", "option");
        option.setAttribute("data-value", "");
        option.textContent = placeholder;
        menu.appendChild(option);
        wireCustomSelectOption(option);
      }
      values.forEach((value) => {
        const option = document.createElement("button");
        option.type = "button";
        option.setAttribute("role", "option");
        option.setAttribute("data-value", value);
        option.textContent = labelFor(value);
        menu.appendChild(option);
        wireCustomSelectOption(option);
      });
    }
    function setCustomSelect(select, value, label) {
      const hidden = select.querySelector('input[type="hidden"]');
      const valueLabel = select.querySelector(".select-value");
      const options = Array.from(select.querySelectorAll('[role="option"]'));
      hidden.value = value || "";
      valueLabel.textContent = label || value || "Select record";
      options.forEach((option) => option.setAttribute("aria-selected", option.getAttribute("data-value") === hidden.value ? "true" : "false"));
    }
    function ensureRecordOption(value) {
      const menu = qs("#recordIdMenu");
      if (!value) return;
      if (!menu.querySelector('[data-value="' + CSS.escape(value) + '"]')) {
        const option = document.createElement("button");
        option.type = "button";
        option.setAttribute("role", "option");
        option.setAttribute("data-value", value);
        option.textContent = value;
        menu.prepend(option);
        wireCustomSelectOption(option);
      }
    }
    function wireCustomSelectOption(option) {
      option.addEventListener("click", function() {
        const select = option.closest("[data-custom-select]");
        setCustomSelect(select, option.getAttribute("data-value") || "", option.textContent || "");
        select.classList.remove("open");
        select.querySelector(".select-trigger").setAttribute("aria-expanded", "false");
      });
    }
    document.querySelectorAll("[data-custom-select]").forEach((select) => {
      const trigger = select.querySelector(".select-trigger");
      trigger.addEventListener("click", function() {
        document.querySelectorAll("[data-custom-select].open").forEach((open) => {
          if (open !== select) {
            open.classList.remove("open");
            open.querySelector(".select-trigger").setAttribute("aria-expanded", "false");
          }
        });
        const open = !select.classList.contains("open");
        select.classList.toggle("open", open);
        trigger.setAttribute("aria-expanded", open ? "true" : "false");
      });
      select.querySelectorAll('[role="option"]').forEach(wireCustomSelectOption);
    });
    document.addEventListener("click", function(event) {
      if (event.target.closest("[data-custom-select]")) return;
      document.querySelectorAll("[data-custom-select].open").forEach((select) => {
        select.classList.remove("open");
        select.querySelector(".select-trigger").setAttribute("aria-expanded", "false");
      });
    });
    function syncSteps() {
      const reviewStep = qs("#reviewStep");
      const ftlStep = qs("#ftlStep");
      const previewStep = qs("#previewStep");
      const activeFtl = state.status === "ftl_review";
      reviewStep.classList.toggle("active", !activeFtl && state.status !== "done");
      ftlStep.classList.toggle("active", activeFtl);
      ftlStep.classList.toggle("locked", !activeFtl && state.status !== "done");
      previewStep.classList.toggle("active", activeFtl);
      previewStep.classList.toggle("locked", !activeFtl && state.status !== "done");
      qs("#reviewStepText").textContent = activeFtl ? "Approved" : "You are here";
      qs("#ftlStepText").textContent = activeFtl ? "Review output" : "";
      qs("#previewStepText").textContent = activeFtl ? "Rendered result" : "";
      ftlStep.querySelector(".state").textContent = activeFtl ? "✓" : "♙";
      previewStep.querySelector(".state").textContent = activeFtl ? "✓" : "♙";
    }
    function renderComments() {
      const comments = Array.isArray(state.comments) ? state.comments : [];
      const list = qs("#comments");
      list.textContent = "";
      qs("#count").textContent = String(comments.length);
      comments.forEach((comment) => {
        const item = document.createElement("article");
        item.className = "comment";
        const avatar = document.createElement("span");
        avatar.className = "avatar " + (comment.color || "blue");
        avatar.textContent = comment.initials || "ME";
        const body = document.createElement("div");
        const top = document.createElement("div");
        top.className = "comment-top";
        const name = document.createElement("strong");
        name.textContent = comment.name || "You";
        if (comment.isYou) {
          const you = document.createElement("span");
          you.className = "you";
          you.textContent = "You";
          name.appendChild(document.createTextNode(" "));
          name.appendChild(you);
        }
        const time = document.createElement("time");
        time.textContent = comment.time || "";
        const text = document.createElement("p");
        text.textContent = comment.text || "";
        top.appendChild(name);
        top.appendChild(time);
        body.appendChild(top);
        body.appendChild(text);
        item.appendChild(avatar);
        item.appendChild(body);
        list.appendChild(item);
      });
    }
    function measureHtmlFrame() {
      const frame = qs("#htmlFrame");
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
      return { width, height };
    }
    function resizeHtmlFrame() {
      const frame = qs("#htmlFrame");
      const wrap = qs("#htmlScaleWrap");
      const scale = renderZoom / 100;
      const { width, height } = measureHtmlFrame();
      frame.style.width = width + "px";
      frame.style.height = height + "px";
      frame.style.transform = "scale(" + scale + ")";
      wrap.style.width = Math.ceil(width * scale) + "px";
      wrap.style.height = Math.ceil(height * scale) + "px";
    }
    function setHtmlPreview() {
      const frame = qs("#htmlFrame");
      const nextHtml = state.html || "";
      frame.onload = resizeHtmlFrame;
      if (nextHtml !== lastHtmlSrcdoc) {
        lastHtmlSrcdoc = nextHtml;
        frame.srcdoc = nextHtml;
      } else {
        setTimeout(resizeHtmlFrame, 20);
      }
    }
    function setResultPreview(renderedResult, activeFtl) {
      const frame = qs("#resultFrame");
      qs("#resultFrameWrap").style.display = renderedResult && activeFtl ? "block" : "none";
      if (renderedResult !== lastResultSrcdoc) {
        lastResultSrcdoc = renderedResult;
        frame.srcdoc = renderedResult;
      }
    }
    function fitHtmlFrame() {
      const scroller = qs(".render-scroll");
      const { width, height } = measureHtmlFrame();
      const scale = Math.min(scroller.clientWidth / width, scroller.clientHeight / height);
      renderZoom = clamp(Math.floor(scale * 100), 25, 200);
      qs("#renderZoom").textContent = renderZoom + "%";
      resizeHtmlFrame();
    }
    function updateReferenceZoom() {
      qs("#refZoom").textContent = refZoom + "%";
      const card = qs("#refCard");
      if (card) card.style.transform = "scale(" + (refZoom / 100) + ")";
    }
    function appendFixComment(text) {
      if (!text.trim()) return;
      const now = new Date();
      const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(now);
      state.comments = [
        {
          initials: "ME",
          name: "You",
          time,
          text: text.trim(),
          color: "blue",
          isYou: true,
        },
        ...(Array.isArray(state.comments) ? state.comments : []),
      ];
    }
    function render() {
      document.title = state.title || "NetSuite Template Review";
      qs("#templateFile").textContent = state.templateFile || "invoice_template.ftl";
      qs("#templateFile").title = state.templateFile || "";
      rebuildOptions(qs("#recordType").closest("[data-custom-select]").querySelector(".select-menu"), optionValues(state.recordTypeOptions, state.recordType || "invoice"), "");
      rebuildOptions(qs("#recordIdMenu"), optionValues(state.recordIdOptions, state.recordId || ""), "Select record");
      setCustomSelect(qs("#recordType").closest("[data-custom-select]"), state.recordType || "invoice", labelFor(state.recordType || "invoice"));
      setCustomSelect(qs("#recordId").closest("[data-custom-select]"), state.recordId || "", state.recordId || "Select record");
      qs("#updated").textContent = "Last updated: " + formatDate(state.updatedAt);
      qs("#status").textContent = state.status || "open";
      const activeFtl = state.status === "ftl_review";
      qs("#statusInline").textContent = activeFtl ? "FTL Review" : "In Review";
      qs("#reviewStepNumber").textContent = activeFtl ? "4 of 5" : "3 of 5";
      qs("#lockedUntil").textContent = activeFtl ? "Unlocked" : "Approval";
      qs("#nextStep").textContent = activeFtl ? "Rendered Preview" : "FreeMarker Generation";
      qs("#feedback").value = state.feedback || "";
      qs("#counter").textContent = (state.feedback || "").length + "/4000";
      qs("#renderZoom").textContent = renderZoom + "%";
      setHtmlPreview();
      const renderedResult = state.renderedResult || "";
      setResultPreview(renderedResult, activeFtl);
      qs("#freemarker").style.display = activeFtl ? "block" : "none";
      qs("#freemarker").textContent = state.freemarker || "Approve the HTML preview to generate the rendered FreeMarker result here.";
      qs("#approveLabel").textContent = state.status === "ftl_review" ? "Approve FTL" : "Approve & Generate FreeMarker";
      qs("#end").style.display = state.status === "ftl_review" ? "inline-flex" : "none";
      qs("#lockbox").innerHTML = activeFtl
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 6-11 11-5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg><p><strong>FreeMarker generation enabled.</strong>Review the rendered output, send fixes, or end the workflow.</p>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" stroke-width="2"/></svg><p><strong>FreeMarker generation is locked.</strong>Approve this HTML to enable FreeMarker generation.</p>';
      renderComments();
      const ref = qs("#reference");
      ref.textContent = "";
      const src = state.referenceImageDataUrl || state.referenceImageUrl || "";
      if (src) {
        const card = document.createElement("div");
        card.className = "ref-card";
        card.id = "refCard";
        card.style.transform = "scale(" + (refZoom / 100) + ")";
        card.innerHTML = '<div class="doc-icon"></div><strong>Reference image loaded</strong><span>Invoice_reference.png</span><span>1.2 MB</span><button class="secondary" type="button" id="viewFull">View Full Size ↗</button>';
        ref.appendChild(card);
        card.querySelector("#viewFull").addEventListener("click", function() {
          qs("#modal").classList.add("open");
        });
        const modalWrap = qs("#modalImageWrap");
        modalWrap.textContent = "";
        const modalImg = document.createElement("img");
        modalImg.src = src;
        modalImg.alt = "Reference image";
        modalWrap.appendChild(modalImg);
      } else {
        const empty = document.createElement("div");
        empty.className = "ref-empty";
        empty.innerHTML = '<div class="doc-icon"></div><strong>No reference image was passed.</strong><br>The agent should pass referenceImagePath, referenceImageDataUrl, or referenceImageUrl from the prompt attachment.';
        ref.appendChild(empty);
        qs("#modalImageWrap").textContent = "No reference image available.";
      }
      updateReferenceZoom();
      syncSteps();
    }
    window.__magicTemplateReviewSet = function(next) {
      state = Object.assign({}, state, next || {});
      render();
    };
    window.__magicTemplateReviewGet = function() {
      return state;
    };
    qs("#feedback").addEventListener("input", function(event) {
      qs("#counter").textContent = event.target.value.length + "/4000";
    });
    document.querySelectorAll("[data-ref]").forEach((button) => button.addEventListener("click", function() {
      refZoom = clamp(refZoom + Number(button.getAttribute("data-ref")), 70, 160);
      updateReferenceZoom();
    }));
    document.querySelectorAll("[data-render]").forEach((button) => button.addEventListener("click", function() {
      renderZoom = clamp(renderZoom + Number(button.getAttribute("data-render")), 25, 200);
      qs("#renderZoom").textContent = renderZoom + "%";
      resizeHtmlFrame();
    }));
    qs("#renderZoom").addEventListener("click", fitHtmlFrame);
    qs("#openRef").addEventListener("click", function() {
      const src = state.referenceImageDataUrl || state.referenceImageUrl || "";
      if (src) qs("#modal").classList.add("open");
      else showToast("No reference image available.");
    });
    qs("#save").addEventListener("click", function() {
      localStorage.setItem("magic-template-review-draft", qs("#feedback").value || "");
      showToast("Draft saved locally.");
    });
    qs("#addComment").addEventListener("click", function() {
      qs("#feedback").focus();
      showToast("Write your comment below, then click Send Fixes.");
    });
    qs("#collapseStatus").addEventListener("click", function() {
      const body = qs(".status-body");
      body.hidden = !body.hidden;
      qs("#collapseStatus").textContent = body.hidden ? "v" : "^";
    });
    document.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", function() {
      qs("#modal").classList.remove("open");
    }));
    document.addEventListener("keydown", function(event) {
      if (event.key === "Escape") qs("#modal").classList.remove("open");
    });
    qs("#fixes").addEventListener("click", function() {
      const feedback = qs("#feedback").value || "";
      if (!feedback.trim()) {
        qs("#feedback").focus();
        showToast("Add review notes before sending fixes.");
        return;
      }
      appendFixComment(feedback);
      const payload = actionPayload("needs_changes");
      state.status = payload.status;
      state.feedback = payload.feedback;
      state.comments = payload.comments;
      state.recordType = payload.recordType;
      state.recordId = payload.recordId;
      render();
      window.__magicTemplateReviewAction(payload);
    });
    qs("#approve").addEventListener("click", function() {
      const payload = actionPayload("approved");
      state.status = payload.status;
      state.feedback = payload.feedback;
      state.recordType = payload.recordType;
      state.recordId = payload.recordId;
      render();
      window.__magicTemplateReviewAction(payload);
    });
    qs("#end").addEventListener("click", function() {
      const payload = actionPayload("done");
      state.status = payload.status;
      state.feedback = payload.feedback;
      state.recordType = payload.recordType;
      state.recordId = payload.recordId;
      render();
      window.__magicTemplateReviewAction(payload);
    });
    render();
  </script>
</body>
</html>`;
}

export type PwCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type ControlResult = {
  ok: boolean;
  needsLogin?: boolean;
  message?: string;
  screenshot?: string; // base64 jpeg
  [k: string]: unknown;
};

export const playwrightController = {
  profileDir: PROFILE_DIR,

  async previewHtml(html: string, label = "FreeMarker Preview"): Promise<ControlResult> {
    if (!html.trim()) throw new Error("HTML is required for the Playwright preview.");
    const p = await ensurePage();
    await p.setContent(html, { waitUntil: "load", timeout: NAV_TIMEOUT });
    await p.setViewportSize({ width: 1100, height: 1400 }).catch(() => {});
    await p.emulateMedia({ media: "screen" }).catch(() => {});
    await settlePage(p);
    await brandTab(p, `${BRAND_TITLE_PREFIX} ${label}`.trim(), FAVICON_DATA_URI);
    const info = await p.evaluate(() => ({
      title: document.title,
      url: location.href,
      bodyTextLength: document.body?.innerText?.length ?? 0,
      documentHeight: Math.ceil(document.documentElement.scrollHeight),
      documentWidth: Math.ceil(document.documentElement.scrollWidth),
    }));
    return { ok: true, ...info, screenshot: await screenshotB64(p) };
  },

  async openTemplateReview(opts: {
    html: string;
    title?: string;
    templateFile?: string;
    recordType?: string;
    recordId?: string;
    recordTypeOptions?: string[];
    recordIdOptions?: string[];
    referenceImageDataUrl?: string;
    referenceImageUrl?: string;
    freemarker?: string;
    renderedResult?: string;
  }): Promise<ControlResult> {
    if (!opts.html.trim()) throw new Error("HTML is required for the template review.");
    const p = await ensurePage();
    await ensureTemplateReviewBinding(p);
    const state = applyTemplateReviewUpdate({
      reviewId: templateReviewState?.reviewId || makeReviewId(),
      title: opts.title || "NetSuite Template Review",
      templateFile: opts.templateFile || "invoice_template.ftl",
      recordType: opts.recordType || "invoice",
      recordId: opts.recordId || "",
      recordTypeOptions: opts.recordTypeOptions?.length ? opts.recordTypeOptions : [opts.recordType || "invoice"],
      recordIdOptions: opts.recordIdOptions?.length ? opts.recordIdOptions : (opts.recordId ? [opts.recordId] : []),
      html: opts.html,
      freemarker: opts.freemarker || "",
      renderedResult: opts.renderedResult || "",
      referenceImageDataUrl: opts.referenceImageDataUrl || "",
      referenceImageUrl: opts.referenceImageUrl || "",
      feedback: "",
      comments: defaultTemplateReviewComments(),
      status: "open",
    });
    await p.setContent(buildTemplateReviewHtml(state), { waitUntil: "load", timeout: NAV_TIMEOUT });
    await settlePage(p);
    await brandTab(p, `${BRAND_TITLE_PREFIX} ${state.title}`.trim(), FAVICON_DATA_URI);
    return { ok: true, ...state, screenshot: await screenshotB64(p) };
  },

  async updateTemplateReview(opts: {
    html?: string;
    title?: string;
    templateFile?: string;
    recordType?: string;
    recordId?: string;
    recordTypeOptions?: string[];
    recordIdOptions?: string[];
    referenceImageDataUrl?: string;
    referenceImageUrl?: string;
    freemarker?: string;
    renderedResult?: string;
    feedback?: string;
    status?: TemplateReviewStatus;
  }): Promise<ControlResult> {
    const p = await ensurePage();
    if (!templateReviewState || (!opts.html && !templateReviewState.html)) {
      const pageState = await p.evaluate(() => {
        const w = window as unknown as { __magicTemplateReviewGet?: () => unknown };
        return w.__magicTemplateReviewGet ? w.__magicTemplateReviewGet() : null;
      }).catch(() => null);
      const recovered = normalizeTemplateReviewState(pageState) || loadPersistedTemplateReviewState();
      if (recovered) templateReviewState = recovered;
    }
    if (!opts.html && !templateReviewState?.html) {
      throw new Error("Template review update refused because no existing HTML preview could be recovered. Pass the revised HTML to magic_netsuite_template_review_update.");
    }
    const state = applyTemplateReviewUpdate(opts);
    const pushed = await p.evaluate((next) => {
      const w = window as unknown as { __magicTemplateReviewSet?: (value: unknown) => void };
      if (!document.querySelector(".review-app")) return false;
      if (!w.__magicTemplateReviewSet) return false;
      w.__magicTemplateReviewSet(next);
      return true;
    }, state).catch(() => false);
    if (!pushed) {
      await p.setContent(buildTemplateReviewHtml(state), { waitUntil: "load", timeout: NAV_TIMEOUT });
    }
    await settlePage(p);
    return { ok: true, ...state, screenshot: await screenshotB64(p) };
  },

  async waitTemplateReview(timeoutMs = 900000): Promise<ControlResult> {
    const existing = currentReviewSnapshot();
    if (existing.status === "approved" || existing.status === "needs_changes" || existing.status === "done") {
      return { ok: true, ...existing };
    }
    const state = await new Promise<TemplateReviewState>((resolve, reject) => {
      const timer = setTimeout(() => {
        templateReviewWaiters.delete(done);
        reject(new Error("Timed out waiting for template review action."));
      }, Math.max(1000, timeoutMs));
      const done = (value: TemplateReviewState) => {
        clearTimeout(timer);
        resolve(value);
      };
      templateReviewWaiters.add(done);
    });
    return { ok: true, ...state };
  },

  templateReviewState(): ControlResult {
    return { ok: true, ...currentReviewSnapshot() };
  },

  async open(url: string, cookies?: PwCookie[], label?: string): Promise<ControlResult> {
    if (!url) throw new Error("A Suitelet URL is required to open in Playwright.");
    const p = await ensurePage();
    // Inject the real browser session (cookies dumped from the logged-in tab)
    // so Playwright reuses it instead of hitting the NetSuite login.
    if (cookies?.length && context) {
      await context.addCookies(cookies).catch(() => {});
    }
    await p.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await settlePage(p);
    const tabTitle = `${BRAND_TITLE_PREFIX}${label ? ` ${label}` : ""}`.trim();
    await brandTab(p, tabTitle, FAVICON_DATA_URI);
    if (await detectLogin(p)) {
      return {
        ok: false,
        needsLogin: true,
        url: p.url(),
        message:
          "NetSuite is asking you to log in. A Chromium window is open — sign in there once (incl. MFA), then re-run the open. The session is saved on disk for next time.",
        screenshot: await screenshotB64(p),
      };
    }
    // Logged in successfully — snapshot the session so it survives restarts.
    await saveState();
    const info = await p.evaluate(INSPECT_FN);
    return { ok: true, ...info, screenshot: await screenshotB64(p) };
  },

  async inspect(): Promise<ControlResult> {
    const p = await ensurePage();
    const info = await p.evaluate(INSPECT_FN);
    return { ok: true, ...info };
  },

  async screenshot(): Promise<ControlResult> {
    const p = await ensurePage();
    return { ok: true, url: p.url(), screenshot: await screenshotB64(p) };
  },

  async click(opts: { selector?: string; text?: string }): Promise<ControlResult> {
    const p = await ensurePage();
    let target = null as ReturnType<Page["locator"]> | null;
    if (opts.selector) {
      target = p.locator(opts.selector).first();
    } else if (opts.text) {
      const byRole = p.getByRole("button", { name: opts.text, exact: false });
      target = (await byRole.first().isVisible({ timeout: 500 }).catch(() => false))
        ? byRole.first()
        : p.getByText(opts.text, { exact: false }).first();
    } else {
      throw new Error("click requires a selector or text.");
    }
    // Click by POSITION: resolve the element by selector, then mouse.click its
    // center. A coordinate click hits whatever element is topmost at that point
    // (the one actually carrying the handler / any overlay), so it doesn't
    // depend on the selector resolving to the exact event-bearing node — and it
    // won't throw on locator.click()'s "receives events" check like NetSuite's
    // obscured widgets do. locator.click() is only the fallback.
    await target.scrollIntoViewIfNeeded({ timeout: 10000 }).catch(() => {});
    let box = await target.boundingBox({ timeout: 10000 }).catch(() => null);
    if (!box) {
      // Wait for it to actually lay out, then retry once.
      await target.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      box = await target.boundingBox({ timeout: 5000 }).catch(() => null);
    }
    if (box) {
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await p.mouse.move(x, y, { steps: 20 }); // visible cursor travel
      await p.mouse.click(x, y);
    } else {
      await target.click({ timeout: 15000 }); // fallback: element click
    }
    await settlePage(p);
    return { ok: true, screenshot: await screenshotB64(p) };
  },

  // Robustly read/choose a dropdown option. NetSuite's custom dropdowns are NOT
  // real <select> elements (hidden field + rendered widget), so clicking them is
  // flaky. This sets the value via the right mechanism instead:
  //   - native <select>  -> set value/text + dispatch change
  //   - NetSuite field   -> nlapiSetFieldValue (resolves value from label)
  // Call with no value/label to just LIST the options.
  async select(opts: {
    selector?: string;
    fieldId?: string;
    value?: string;
    label?: string;
  }): Promise<ControlResult> {
    const p = await ensurePage();
    const res = (await p.evaluate((o) => {
      const w = window as unknown as {
        nlapiGetField?: (id: string) => { getSelectOptions?: () => Array<{ getId: () => string; getText: () => string }> } | null;
        nlapiSetFieldValue?: (id: string, v: string) => void;
      };
      // Derive the NetSuite field id from a selector like #inpt_custpage_xxx_1.
      let fid = o.fieldId || "";
      if (!fid && o.selector) {
        const m =
          o.selector.match(/inpt_(.+?)_\d+$/) ||
          o.selector.match(/(custpage_[a-z0-9_]+)/i) ||
          o.selector.match(/name=["']?([^"'\]]+)/i);
        if (m) fid = m[1];
      }
      const pickFrom = (opts: Array<{ value: string; text: string }>) => {
        if (o.value != null) {
          const byVal = opts.find((x) => x.value === o.value);
          if (byVal) return byVal;
        }
        if (o.label != null) {
          const exact = opts.find((x) => x.text.trim() === o.label!.trim());
          if (exact) return exact;
          const part = opts.find((x) => x.text.toLowerCase().includes(o.label!.toLowerCase()));
          if (part) return part;
        }
        return null;
      };

      // 1) Native <select>?
      const nativeEl =
        (fid && (document.querySelector(`select[name="${fid}"]`) || document.getElementById(fid))) || null;
      if (nativeEl && (nativeEl as HTMLElement).tagName === "SELECT") {
        const sel = nativeEl as HTMLSelectElement;
        const opts = Array.from(sel.options).map((op) => ({ value: op.value, text: op.text }));
        const pick = pickFrom(opts);
        if (pick) {
          sel.value = pick.value;
          sel.dispatchEvent(new Event("input", { bubbles: true }));
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return { ok: o.value == null && o.label == null ? true : !!pick, mode: "native", fieldId: fid, chosen: pick, options: opts.map((x) => x.text) };
      }

      // 2) NetSuite NLAPI dropdown.
      if (typeof w.nlapiGetField === "function" && fid) {
        const f = w.nlapiGetField(fid);
        const raw = f?.getSelectOptions ? f.getSelectOptions() : [];
        const opts: Array<{ value: string; text: string }> = [];
        for (let i = 0; i < raw.length; i++) {
          const v = raw[i].getId();
          const t = raw[i].getText();
          if (v !== "") opts.push({ value: v, text: t });
        }
        const pick = pickFrom(opts);
        if (pick && typeof w.nlapiSetFieldValue === "function") {
          w.nlapiSetFieldValue(fid, pick.value);
        }
        const dispEl = document.getElementById(`inpt_${fid}_1`) as HTMLInputElement | null;
        return {
          ok: o.value == null && o.label == null ? true : !!pick,
          mode: "nlapi",
          fieldId: fid,
          chosen: pick,
          display: dispEl?.value ?? null,
          options: opts.map((x) => x.text),
        };
      }

      return { ok: false, error: "Field not found or not a recognized dropdown.", fieldId: fid };
    }, opts)) as ControlResult;
    await settlePage(p);
    return { ...res, screenshot: await screenshotB64(p) };
  },

  async fill(opts: { selector: string; value: string }): Promise<ControlResult> {
    const p = await ensurePage();
    await p.locator(opts.selector).first().fill(opts.value ?? "", { timeout: 10000 });
    return { ok: true };
  },

  async read(opts: { selector?: string; maxLength?: number }): Promise<ControlResult> {
    const p = await ensurePage();
    const max = opts.maxLength ?? 20000;
    const text = opts.selector
      ? await p.locator(opts.selector).first().innerText({ timeout: 10000 })
      : await p.evaluate(() => document.body.innerText);
    return { ok: true, text: String(text).slice(0, max) };
  },

  async eval(expression: string): Promise<ControlResult> {
    const p = await ensurePage();
    // Wrap so callers can pass either an expression or a statement body.
    const value = await p.evaluate(
      (expr) => {
        // eslint-disable-next-line no-eval
        return (0, eval)(expr);
      },
      expression,
    );
    return { ok: true, value };
  },

  async hover(opts: { selector?: string; x?: number; y?: number }): Promise<ControlResult> {
    const p = await ensurePage();
    if (opts.selector) {
      await p.locator(opts.selector).first().hover({ timeout: 10000 });
    } else if (typeof opts.x === "number" && typeof opts.y === "number") {
      await p.mouse.move(opts.x, opts.y);
    } else {
      throw new Error("hover requires a selector or x/y coordinates.");
    }
    await p.waitForTimeout(350); // let tooltips / hover menus render
    return { ok: true, screenshot: await screenshotB64(p) };
  },

  async scroll(opts: { selector?: string; to?: string; dy?: number; dx?: number }): Promise<ControlResult> {
    const p = await ensurePage();
    await p.evaluate(
      ({ selector, to, dy, dx }) => {
        const target: Element | (Window & typeof globalThis) = selector
          ? document.querySelector(selector) || window
          : window;
        const el = target as HTMLElement;
        if (to === "bottom") {
          if (target === window) window.scrollTo(0, document.body.scrollHeight);
          else el.scrollTop = el.scrollHeight;
        } else if (to === "top") {
          if (target === window) window.scrollTo(0, 0);
          else el.scrollTop = 0;
        } else {
          const deltaY = typeof dy === "number" ? dy : window.innerHeight * 0.8;
          const deltaX = typeof dx === "number" ? dx : 0;
          if (target === window) window.scrollBy(deltaX, deltaY);
          else {
            el.scrollTop += deltaY;
            el.scrollLeft += deltaX;
          }
        }
      },
      opts,
    );
    await p.waitForTimeout(350); // let lazy-loaded rows / images render
    return { ok: true, screenshot: await screenshotB64(p) };
  },

  async close(): Promise<void> {
    if (context) await context.close().catch(() => {});
    context = null;
    page = null;
  },
};
