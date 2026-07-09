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

type TemplateReviewStatus = "open" | "needs_changes" | "approved";
type TemplateReviewState = {
  reviewId: string;
  title: string;
  html: string;
  freemarker: string;
  referenceImageDataUrl: string;
  referenceImageUrl: string;
  feedback: string;
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

function currentReviewSnapshot(): TemplateReviewState {
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
      status: state.status,
      feedback: state.feedback,
      version: state.version,
      updatedAt: state.updatedAt,
      pending: state.status === "open",
    }, null, 2));
  } catch {
    /* hook state is best-effort */
  }
}

function applyTemplateReviewUpdate(patch: Partial<TemplateReviewState>): TemplateReviewState {
  if (!templateReviewState) {
    templateReviewState = {
      reviewId: makeReviewId(),
      title: "NetSuite Template Review",
      html: "",
      freemarker: "",
      referenceImageDataUrl: "",
      referenceImageUrl: "",
      feedback: "",
      status: "open",
      version: 0,
      updatedAt: new Date().toISOString(),
    };
  }
  templateReviewState = {
    ...templateReviewState,
    ...patch,
    version: templateReviewState.version + 1,
    updatedAt: new Date().toISOString(),
  };
  persistTemplateReviewState(templateReviewState);
  if (templateReviewState.status === "approved" || templateReviewState.status === "needs_changes") {
    resolveTemplateReview(templateReviewState);
  }
  return { ...templateReviewState };
}

async function ensureTemplateReviewBinding(p: Page): Promise<void> {
  if (templateReviewBindingReady) return;
  try {
    await p.exposeBinding("__magicTemplateReviewAction", async (_source, payload: Record<string, unknown>) => {
      const status = payload.status === "approved" ? "approved" : "needs_changes";
      applyTemplateReviewUpdate({
        status,
        feedback: String(payload.feedback ?? ""),
      });
    });
    templateReviewBindingReady = true;
  } catch {
    templateReviewBindingReady = true;
  }
}

function buildTemplateReviewHtml(state: TemplateReviewState): string {
  const data = JSON.stringify(state).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${state.title}</title>
  <style>
    :root { color-scheme: light; font-family: Segoe UI, Arial, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef3f7; color: #27323a; overflow: hidden; }
    .shell { display: grid; grid-template-rows: 34px minmax(0, 1fr) 86px; width: 100vw; height: 100vh; min-width: 1120px; }
    .toolbar { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 5px 8px; border-bottom: 1px solid #dbe3ea; background: #fbfcfd; }
    .toolbar strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 800; }
    .hint { color: #62696e; font-size: 11px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pill { margin-left: auto; border: 1px solid #d8c6ff; background: #faf7ff; color: #7b2ff7; border-radius: 5px; padding: 3px 7px; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .main { display: grid; grid-template-columns: minmax(250px, 30%) minmax(420px, 42%) minmax(300px, 28%); min-height: 0; padding: 6px; gap: 6px; }
    .pane { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; border: 1px solid #dbe3ea; border-radius: 6px; background: #fff; }
    .pane:last-child { border-right: 0; }
    .pane-head { display: flex; align-items: center; justify-content: space-between; min-height: 29px; padding: 4px 8px; border-bottom: 1px solid #dbe3ea; background: #fbfcfd; color: #27323a; font-size: 11px; font-weight: 800; }
    .pane-body { flex: 1; min-height: 0; overflow: auto; }
    .reference-wrap { display: flex; align-items: flex-start; justify-content: center; min-height: 100%; padding: 8px; background: #f8fafc; }
    .reference-wrap img { max-width: 100%; height: auto; border: 1px solid #dbe3ea; border-radius: 4px; background: #fff; }
    .empty-reference { margin: auto; max-width: 260px; color: #62696e; font-size: 12px; line-height: 1.35; text-align: center; }
    iframe { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
    pre { min-height: 100%; margin: 0; padding: 8px; color: #27323a; background: #fff; font: 11px/1.42 Consolas, "Courier New", monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
    .review { display: grid; grid-template-columns: minmax(0, 1fr) 96px 92px; gap: 7px; align-items: center; padding: 6px; border-top: 1px solid #dbe3ea; background: #fbfcfd; }
    textarea { width: 100%; height: 70px; resize: none; border: 1px solid #b4c4d3; border-radius: 6px; padding: 7px; color: #27323a; font: 12px/1.35 Segoe UI, Arial, sans-serif; outline: none; }
    textarea:focus { border-color: #c6a7ff; box-shadow: 0 0 0 3px rgba(198, 167, 255, .22); }
    button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 32px; min-width: 0; border: 1px solid #dbe3ea; border-radius: 6px; background: #fff; color: #27323a; cursor: pointer; font: 800 12px Segoe UI, Arial, sans-serif; padding: 5px 9px; white-space: nowrap; }
    button:hover { border-color: #c6a7ff; background: #faf7ff; color: #7b2ff7; }
    .approve { background: #27323a; border-color: #27323a; color: #fff; }
    .approve:hover { background: #7b2ff7; color: #fff; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="toolbar">
      <strong id="title"></strong>
      <span class="hint">Review the match, write fixes, or approve to generate FreeMarker.</span>
      <span class="pill" id="status"></span>
    </div>
    <div class="main">
      <section class="pane">
        <div class="pane-head"><span>Reference</span></div>
        <div class="pane-body reference-wrap" id="reference"></div>
      </section>
      <section class="pane">
        <div class="pane-head"><span>Rendered HTML</span></div>
        <div class="pane-body"><iframe id="htmlFrame" sandbox="allow-same-origin"></iframe></div>
      </section>
      <section class="pane">
        <div class="pane-head"><span>FreeMarker / Render Result</span></div>
        <div class="pane-body"><pre id="freemarker"></pre></div>
      </section>
    </div>
    <div class="review">
      <textarea id="feedback" placeholder="Write fixes for the agent here"></textarea>
      <button type="button" id="fixes">Send Fixes</button>
      <button type="button" class="approve" id="approve">Approve</button>
    </div>
  </div>
  <script>
    let state = ${data};
    function render() {
      document.title = state.title || "NetSuite Template Review";
      document.getElementById("title").textContent = state.title || "NetSuite Template Review";
      document.getElementById("status").textContent = state.status || "open";
      document.getElementById("feedback").value = state.feedback || "";
      document.getElementById("htmlFrame").srcdoc = state.html || "";
      document.getElementById("freemarker").textContent = state.freemarker || "Approve the HTML preview to generate the FreeMarker output here.";
      const ref = document.getElementById("reference");
      ref.textContent = "";
      const src = state.referenceImageDataUrl || state.referenceImageUrl || "";
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        ref.appendChild(img);
      } else {
        const empty = document.createElement("div");
        empty.className = "empty-reference";
        empty.textContent = "No reference image was passed. The agent should pass referenceImagePath, referenceImageDataUrl, or referenceImageUrl from the prompt attachment.";
        ref.appendChild(empty);
      }
    }
    window.__magicTemplateReviewSet = function(next) {
      state = Object.assign({}, state, next || {});
      render();
    };
    document.getElementById("fixes").addEventListener("click", function() {
      const feedback = document.getElementById("feedback").value || "";
      state.status = "needs_changes";
      state.feedback = feedback;
      render();
      window.__magicTemplateReviewAction({ status: "needs_changes", feedback });
    });
    document.getElementById("approve").addEventListener("click", function() {
      const feedback = document.getElementById("feedback").value || "";
      state.status = "approved";
      state.feedback = feedback;
      render();
      window.__magicTemplateReviewAction({ status: "approved", feedback });
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
    referenceImageDataUrl?: string;
    referenceImageUrl?: string;
    freemarker?: string;
  }): Promise<ControlResult> {
    if (!opts.html.trim()) throw new Error("HTML is required for the template review.");
    const p = await ensurePage();
    await ensureTemplateReviewBinding(p);
    const state = applyTemplateReviewUpdate({
      reviewId: templateReviewState?.reviewId || makeReviewId(),
      title: opts.title || "NetSuite Template Review",
      html: opts.html,
      freemarker: opts.freemarker || "",
      referenceImageDataUrl: opts.referenceImageDataUrl || "",
      referenceImageUrl: opts.referenceImageUrl || "",
      feedback: "",
      status: "open",
    });
    await p.setViewportSize({ width: 1920, height: 980 }).catch(() => {});
    await p.setContent(buildTemplateReviewHtml(state), { waitUntil: "load", timeout: NAV_TIMEOUT });
    await settlePage(p);
    await brandTab(p, `${BRAND_TITLE_PREFIX} ${state.title}`.trim(), FAVICON_DATA_URI);
    return { ok: true, ...state, screenshot: await screenshotB64(p) };
  },

  async updateTemplateReview(opts: {
    html?: string;
    title?: string;
    referenceImageDataUrl?: string;
    referenceImageUrl?: string;
    freemarker?: string;
    feedback?: string;
    status?: TemplateReviewStatus;
  }): Promise<ControlResult> {
    const p = await ensurePage();
    const state = applyTemplateReviewUpdate(opts);
    const pushed = await p.evaluate((next) => {
      const w = window as unknown as { __magicTemplateReviewSet?: (value: unknown) => void };
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
    if (existing.status === "approved" || existing.status === "needs_changes") {
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
