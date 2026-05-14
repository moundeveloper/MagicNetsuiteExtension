import {
  MESSAGE_TYPES,
  REQUEST_MODES,
  generateRequestId
} from "./constants.js";
import { StreamHandler, NormalRequestHandler } from "./handlers.js";
import { RequestManager } from "./requestManager.js";
import { scrapeSuiteScriptModules } from "../../modules/suiteScriptScraper.js";

const requestManager = new RequestManager();

const SCRAPE_ACTION = "SCRAPE_SUITESCRIPT_MODULES";

export const setupMessageListener = () => {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "stream-api") return;

    port.onMessage.addListener((msg) => {
      const { action, data, mode, tabId } = msg;
      const requestId = generateRequestId();

      if (mode !== REQUEST_MODES.STREAM) return;

      // ── Intercept: scrape docs directly in content script ──
      if (action === SCRAPE_ACTION) {
        scrapeSuiteScriptModules(data?.baseUrl, (chunk) => {
          port.postMessage({ ...chunk, requestId });
        });
        return;
      }

      const handler = new StreamHandler(requestId, (chunk) => {
        port.postMessage(chunk);
      });

      requestManager.addRequest(requestId, handler);
      handler.start();

      // Send to page context (content script → page)
      window.postMessage(
        {
          type: MESSAGE_TYPES.FROM_EXTENSION,
          payload: {
            action,
            data,
            requestId,
            mode
          }
        },
        "*"
      );
    });

    port.onDisconnect.addListener(() => {
      requestManager.abortAll();
    });
  });

  // ============================================================================
  // NORMAL REQUEST HANDLING (UNCHANGED)
  // ============================================================================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const { action, data, mode = REQUEST_MODES.NORMAL } = msg;
    const requestId = generateRequestId();

    if (mode !== REQUEST_MODES.NORMAL) return;

    // Handle FETCH_HELP_PAGE directly in the content script isolated world.
    // Content scripts have extension-level fetch privileges (cross-origin +
    // session cookies) AND full browser APIs (DOMParser) — both of which are
    // unavailable or unreliable in the background service worker.
    if (action === "FETCH_HELP_PAGE") {
      const url = data?.url ?? "";
      const operation = data?.operation ?? "read"; // "search" | "read"
      const baseUrl = data?.baseUrl ?? "";

      fetch(url, { credentials: "include" })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.text();
        })
        .then(html => {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, "text/html");

          if (operation === "search") {
            const titleEls = doc.querySelectorAll(".result-title");
            const bodyEls = doc.querySelectorAll(".result-body");
            const results = [];
            titleEls.forEach((titleEl, i) => {
              const anchor = titleEl.querySelector("a");
              const title = (anchor?.textContent ?? titleEl.textContent ?? "").trim();
              const href = anchor?.getAttribute("href") ?? "";
              const fullUrl = href.startsWith("http") ? href : href ? `${baseUrl}${href}` : "";
              const summary = (bodyEls[i]?.textContent ?? "").trim();
              if (title && fullUrl) results.push({ title, url: fullUrl, summary });
            });
            sendResponse({ status: "ok", message: { results } });
          } else {
            const el =
              doc.getElementById("nshelp_page") ??
              doc.querySelector(".nshelp_page") ??
              doc.querySelector("main") ??
              doc.body;
            const content = (el?.textContent ?? "").trim();
            sendResponse({ status: "ok", message: { content } });
          }
        })
        .catch(e => sendResponse({ status: "error", message: String(e?.message ?? e) }));
      return true;
    }

    const handler = new NormalRequestHandler(requestId, sendResponse);
    requestManager.addRequest(requestId, handler);
    handler.start();

    window.postMessage(
      {
        type: MESSAGE_TYPES.FROM_EXTENSION,
        payload: { ...msg, requestId }
      },
      "*"
    );

    return true;
  });

  // Cleanup on unload
  window.addEventListener("beforeunload", () => {
    console.log("Content script unloading, aborting all requests...");
    requestManager.abortAll();
  });
};
