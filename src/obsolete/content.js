const injectScript = (file) => {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL(file);

  script.onload = function () {
    this.remove();
  };

  (document.head || document.documentElement).appendChild(script);
};

/* ---------- Toggle UI ---------- */
const FRAME_ID = "magic-netsuite-frame";
const DOCK_ID = "magic-netsuite-dock";
const TOGGLE_ID = "magic-netsuite-toggle";

const createDock = async () => {
  await initMagicNetsuiteSettings();

  if (document.getElementById(DOCK_ID)) return;

  const dock = document.createElement("div");
  dock.id = DOCK_ID;
  dock.style.display = "none";
  dock.style.position = "fixed";
  dock.style.top = "50%";
  dock.style.right = "0";
  dock.style.transform = "translateY(-50%)";
  dock.style.zIndex = "200000000";
  dock.style.fontFamily = "sans-serif";

  dock.innerHTML = `
    <div class="dock-trigger">
      <div class="dock-arrow">▶</div>
    </div>
    <div class="dock-content">
      <ul class="dock-list">
        <li class="dock-item">
          <span class="dock-label">🪄 Magic Netsuite</span>
          <label class="my-ext-switch">
            <input id="${TOGGLE_ID}" type="checkbox" />
            <span class="slider"></span>
          </label>
        </li>
      </ul>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #${DOCK_ID} {
      display: flex;
      flex-direction: row-reverse;
      align-items: flex-start;
    }
    #${DOCK_ID} .dock-trigger {
      display: flex;
      flex-direction: column;
    }
    #${DOCK_ID} .dock-arrow {
      cursor: pointer;
      background-color: #8C9BFF;
      color: white;
      padding: 8px 10px;
      border-top-left-radius: 4px;
      border-bottom-left-radius: 4px;
      text-align: center;
      user-select: none;
      transition: background-color 0.2s;
    }
    #${DOCK_ID} .dock-arrow:hover {
      background-color: #7a8ae6;
    }
    #${DOCK_ID} .dock-content {
      background: #f3f4f6;
      border: 1px solid #ccc;
      border-radius: 8px 0 0 8px;
      max-width: 0;
      opacity: 0;
      transition: all 0.3s ease;
      overflow: hidden;
      pointer-events: none;
      white-space: nowrap;
    }
    #${DOCK_ID} .dock-trigger:hover + .dock-content,
    #${DOCK_ID} .dock-content:hover {
      max-width: 300px;
      opacity: 1;
      pointer-events: auto;
    }
    #${DOCK_ID} .dock-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    #${DOCK_ID} .dock-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      gap: 16px;
      border-bottom: 1px solid #e5e7eb;
      min-width: 180px;
    }
    #${DOCK_ID} .dock-item:last-child {
      border-bottom: none;
    }
    #${DOCK_ID} .dock-label {
      font-size: 14px;
      color: #374151;
      white-space: nowrap;
    }
    .my-ext-switch { 
      position: relative; 
      display: inline-block; 
      width: 46px; 
      height: 26px;
      flex-shrink: 0;
    }
    .my-ext-switch input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; 
      cursor: pointer; 
      inset: 0; 
      background-color: #ccc;
      transition: 0.25s; 
      border-radius: 26px;
    }
    .slider:before {
      position: absolute; 
      content: ""; 
      height: 20px; 
      width: 20px; 
      left: 3px; 
      bottom: 3px;
      background-color: white; 
      transition: 0.25s; 
      border-radius: 50%;
    }
    input:checked + .slider { background-color: #8C9BFF; }
    input:checked + .slider:before { transform: translateX(20px); }
  `;

  const injectAllowed = window.location.href.includes(
    "/app/setup/mainsetup.nl"
  );

  const isCustomizationPage = window.location.href.includes("sc=-90");

  if (injectAllowed && isCustomizationPage) {
    dock.style.display = "block";
    injectUI();

    document.head.appendChild(style);
    document.body.appendChild(dock);

    const checkbox = document.getElementById(TOGGLE_ID);

    chrome.runtime.sendMessage({ type: "UI_SOURCE", source: "page" });

    const { magic_netsuite_settings: magicNetsuiteSettings } =
      (await chrome.storage.sync.get(["magic_netsuite_settings"])) || {};
    if (magicNetsuiteSettings.openOnCustomizationPage) {
      console.log("[initMagicNetsuiteSettings] openOnCustomizationPage");
      checkbox.checked = true;
      showUI();
    } else {
      console.log("[initMagicNetsuiteSettings] !openOnCustomizationPage");
      checkbox.checked = false;
    }

    checkbox.addEventListener("change", async () => {
      if (checkbox.checked) {
        showUI();
      } else {
        hideUI();
      }
    });
  }
};

/* ---------- Inject UI ---------- */

// show iframe with fade/slide
const showUI = () => {
  const iframe = document.getElementById(FRAME_ID);
  if (!iframe) return;

  iframe.style.pointerEvents = "auto";
  requestAnimationFrame(() => {
    iframe.style.opacity = "1";
    iframe.style.transform = "translateY(0)";
  });
};

// hide iframe with fade/slide
const hideUI = () => {
  const iframe = document.getElementById(FRAME_ID);
  if (!iframe) return;

  iframe.style.pointerEvents = "none";
  iframe.style.opacity = "0";
  iframe.style.transform = "translateY(20px)";

  iframe.addEventListener(
    "transitionend",
    () => {
      // optional: keep in DOM or remove
      // iframe.remove();
    },
    { once: true }
  );
};

// inject iframe if not exists
const injectUI = () => {
  let iframe = document.getElementById(FRAME_ID);
  if (iframe) return;

  iframe = document.createElement("iframe");
  iframe.id = FRAME_ID;
  iframe.src = chrome.runtime.getURL("dist/vue-ui/index.html");

  Object.assign(iframe.style, {
    position: "fixed",
    top: "0",
    right: "0",
    width: "100%",
    height: "100vh",
    border: "none",
    zIndex: "20000000",
    opacity: "0", // start invisible
    transform: "translateY(20px)", // slide from bottom
    transition: "opacity 0.3s ease, transform 0.3s ease",
    pointerEvents: "none"
  });

  // 1️⃣ Append hidden first
  document.body.appendChild(iframe);
};

const initMagicNetsuiteSettings = async () => {
  const checkSettings = await chrome.storage.sync.get([
    "magic_netsuite_settings"
  ]);
  console.log("[initMagicNetsuiteSettings] result", checkSettings);
  if (checkSettings.magic_netsuite_settings) {
    console.log("[initMagicNetsuiteSettings] Settings already exist");
    return;
  }

  const settings = {
    extensionToggle: "Alt+Shift+U",
    drawerOpen: "ctrl+k",
    openOnCustomizationPage: true
  };

  console.log("[initMagicNetsuiteSettings] Settings created");
  await chrome.storage.sync.set({ magic_netsuite_settings: settings });
};

const initUIWidgets = () => {
  const logoHTML = `
<svg id="magic-netsuite-logo" height="1.5rem" viewBox="0 0 231 189" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M101.121 0.28651C54.6933 2.26513 15.4319 12.9936 3.78105 26.8879C0.967244 30.2735 0.0439656 32.5599 0 36.2534C0 38.6717 0.263794 39.8588 1.14311 41.7495C6.94657 54.1049 32.2708 64.4816 69.2459 69.626C82.4356 71.4727 86.6563 71.8685 100.242 72.572C114.574 73.3194 136.601 72.7039 150.143 71.1649C182.457 67.6034 206.331 60.9201 220.532 51.5986C224.708 48.8286 228.973 44.2118 230.116 41.1339C234.908 28.251 220.092 16.5551 188.613 8.33288C164.431 2.04528 131.501 -0.988598 101.121 0.28651ZM127.5 19.7649C138.624 20.2925 143.812 20.7762 152.781 22.2272C170.675 25.1291 182.721 29.7899 184.7 34.5825C185.579 36.6051 185.227 37.8363 183.337 39.9468C178.413 45.355 161.31 50.1476 138.931 52.3901C130.05 53.2695 99.0985 53.1376 90.1296 52.1702C64.9372 49.4002 48.5381 44.0799 45.9441 37.7923C41.5036 27.1078 83.7985 17.7423 127.5 19.7649Z" fill="white"/>
  <path d="M49.0657 78.7715C48.5821 81.9813 46.8674 93.2374 45.2846 103.746C41.6355 128.017 38.7338 147.188 37.5467 154.706C36.4036 161.961 36.5355 164.072 38.47 167.106C42.3389 173.13 49.5493 177.614 61.7718 181.572C90.3934 190.937 134.623 191.509 164.871 182.935C178.413 179.109 187.689 173.877 191.91 167.721C194.196 164.424 194.372 162.753 193.317 156.245C192.394 150.749 191.558 145.341 187.953 121.554C184.084 95.9635 180.523 73.2753 180.347 73.0995C180.259 73.0115 176.918 73.5392 172.961 74.2866C163.113 76.0894 150.363 77.6723 139.107 78.4637C128.248 79.2112 106.573 79.3431 95.4934 78.6836C82.2158 77.8921 64.6295 75.7376 54.8252 73.6271C49.6812 72.5718 50.1648 72.1761 49.0657 78.7715ZM103.979 102.691C106.045 105.373 109.387 109.726 111.453 112.408C113.519 115.046 118.663 121.729 122.884 127.226L130.578 137.251L130.71 117.42L130.798 97.5903H148.824V165.743H140.119C131.633 165.743 131.369 165.699 130.446 164.731C129.611 163.808 102.044 128.369 100.725 126.434C100.154 125.643 100.066 127.973 100.066 145.605L100.022 165.743H81.9959V97.5903L91.0968 97.6783L100.242 97.8102L103.979 102.691Z" fill="white"/>
</svg>
  `;

  const addLogo = () => {
    // Select the span inside the menu item with the unique data-automation-id
    const menuItemSpan = document.querySelector(
      'div[data-widget="MenuItem"][data-automation-id="-90"] a span'
    );

    if (menuItemSpan && !menuItemSpan.querySelector("#magic-netsuite-logo")) {
      menuItemSpan.insertAdjacentHTML("afterbegin", logoHTML);

      // Optional: style the span so the SVG aligns nicely
      menuItemSpan.style.display = "flex";
      menuItemSpan.style.alignItems = "center";
      menuItemSpan.style.gap = "0.5rem"; // spacing between logo and text
    }
  };

  // Observe the menu container to handle dynamic re-renders
  const menuContainer =
    document.querySelector('div[data-widget="Menu"]') || document.body;

  const observer = new MutationObserver(addLogo);
  observer.observe(menuContainer, { childList: true, subtree: true });

  // Initial attempt in case the menu is already loaded
  addLogo();
};

// Setup backend
(async function () {
  try {
    /* const { logStuff } = await import(chrome.runtime.getURL("./utils.js")); */
    injectScript("scripts.js");
    injectScript("customRecords.js");
    injectScript("sandboxCode.js");
    injectScript("exportRecord.js");
    injectScript("logs.js");
    injectScript("mediaItems.js");
    injectScript("netsuiteApi.js");
    initUIWidgets();
    createDock();
  } catch (error) {
    console.log("Error", error);
  }
})();

// Intercept messages and relay (PAGE <-> UI)
// ============================================================================
// Constants & Configuration
// ============================================================================

const MESSAGE_TYPES = {
  TO_EXTENSION: "TO_EXTENSION",
  FROM_EXTENSION: "FROM_EXTENSION",
  STREAM_END: "STREAM_END",
  STREAM_ERROR: "STREAM_ERROR",
  STREAM_ABORT: "STREAM_ABORT"
};

const REQUEST_MODES = {
  NORMAL: "normal",
  STREAM: "stream"
};

const STREAM_TIMEOUT = 30000; // 30 seconds
const MAX_RETRY_ATTEMPTS = 3;

// ============================================================================
// Utility Functions
// ============================================================================

const generateRequestId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
};

const createMessageFilter = (requestId) => (event) => {
  if (event.source !== window) return false;
  if (event.data?.type !== MESSAGE_TYPES.TO_EXTENSION) return false;
  if (event.data?.payload?.requestId !== requestId) return false;
  return true;
};

// ============================================================================
// Stream Handler
// ============================================================================

class StreamHandler {
  constructor(requestId, sendResponse) {
    this.requestId = requestId;
    this.sendResponse = sendResponse;
    this.timeoutId = null;
    this.isActive = true;
    this.chunkCount = 0;
  }

  start() {
    this.handleStream = this.handleStream.bind(this);
    window.addEventListener("message", this.handleStream);

    // Set timeout for stream
    this.timeoutId = setTimeout(() => {
      this.sendError("Stream timeout exceeded");
      this.cleanup();
    }, STREAM_TIMEOUT);

    console.log(`[Stream ${this.requestId}] Started`);
  }

  handleStream(event) {
    if (!this.isActive) return;
    if (!createMessageFilter(this.requestId)(event)) return;

    const { payload } = event.data;
    this.chunkCount++;

    console.log(
      `[Stream ${this.requestId}] Chunk #${this.chunkCount}`,
      payload
    );

    // Handle different stream events
    switch (payload.type) {
      case MESSAGE_TYPES.STREAM_END:
        console.log(
          `[Stream ${this.requestId}] Completed with ${this.chunkCount} chunks`
        );
        this.sendResponse({ ...payload, isComplete: true });
        this.cleanup();
        break;

      case MESSAGE_TYPES.STREAM_ERROR:
        console.error(`[Stream ${this.requestId}] Error:`, payload.error);
        this.sendError(payload.error);
        this.cleanup();
        break;

      case MESSAGE_TYPES.STREAM_ABORT:
        console.log(`[Stream ${this.requestId}] Aborted by sender`);
        this.cleanup();
        break;

      default:
        // Regular stream chunk
        this.sendResponse({ ...payload, isComplete: false });
    }
  }

  sendError(error) {
    this.sendResponse({
      status: "error",
      error,
      requestId: this.requestId
    });
  }

  cleanup() {
    this.isActive = false;
    window.removeEventListener("message", this.handleStream);

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  abort() {
    console.log(`[Stream ${this.requestId}] Manually aborted`);
    this.cleanup();
  }
}

// ============================================================================
// Normal Request Handler
// ============================================================================

class NormalRequestHandler {
  constructor(requestId, sendResponse, retryAttempts = 0) {
    this.requestId = requestId;
    this.sendResponse = sendResponse;
    this.retryAttempts = retryAttempts;
    this.timeoutId = null;
    this.isActive = true;
  }

  start() {
    this.handleResponse = this.handleResponse.bind(this);
    window.addEventListener("message", this.handleResponse);

    // Set timeout for normal request
    this.timeoutId = setTimeout(() => {
      if (this.retryAttempts < MAX_RETRY_ATTEMPTS) {
        console.warn(
          `[Request ${this.requestId}] Timeout, retrying... (${this.retryAttempts + 1}/${MAX_RETRY_ATTEMPTS})`
        );
        this.cleanup();
        // Retry logic would be handled by the caller
        this.sendResponse({
          status: "retry",
          requestId: this.requestId,
          attempt: this.retryAttempts + 1
        });
      } else {
        console.error(
          `[Request ${this.requestId}] Timeout after ${MAX_RETRY_ATTEMPTS} attempts`
        );
        this.sendResponse({
          status: "error",
          error: "Request timeout",
          requestId: this.requestId
        });
        this.cleanup();
      }
    }, STREAM_TIMEOUT);

    console.log(`[Request ${this.requestId}] Started`);
  }

  handleResponse(event) {
    if (!this.isActive) return;
    if (!createMessageFilter(this.requestId)(event)) return;

    const { payload } = event.data;
    console.log(`[Request ${this.requestId}] Response received`, payload);

    this.sendResponse(payload);
    this.cleanup();
  }

  cleanup() {
    this.isActive = false;
    window.removeEventListener("message", this.handleResponse);

    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}

// ============================================================================
// Request Manager (tracks active requests)
// ============================================================================

class RequestManager {
  constructor() {
    this.activeRequests = new Map();
  }

  addRequest(requestId, handler) {
    this.activeRequests.set(requestId, handler);
  }

  removeRequest(requestId) {
    this.activeRequests.delete(requestId);
  }

  abortRequest(requestId) {
    const handler = this.activeRequests.get(requestId);
    if (handler && typeof handler.abort === "function") {
      handler.abort();
      this.removeRequest(requestId);
      return true;
    }
    return false;
  }

  abortAll() {
    this.activeRequests.forEach((handler, requestId) => {
      if (typeof handler.abort === "function") {
        handler.abort();
      }
    });
    this.activeRequests.clear();
  }

  getActiveCount() {
    return this.activeRequests.size;
  }
}

const requestManager = new RequestManager();

// ============================================================================
// Main Message Listener
// ============================================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const { mode = REQUEST_MODES.NORMAL, action } = msg;
  const requestId = generateRequestId();

  console.log(`[${mode.toUpperCase()}] New request:`, { requestId, action });

  // Handle special commands
  if (action === "ABORT_REQUEST" && msg.targetRequestId) {
    const aborted = requestManager.abortRequest(msg.targetRequestId);
    sendResponse({
      status: aborted ? "ok" : "error",
      message: aborted ? "Request aborted" : "Request not found"
    });
    return false;
  }

  if (action === "ABORT_ALL_REQUESTS") {
    requestManager.abortAll();
    sendResponse({ status: "ok", message: "All requests aborted" });
    return false;
  }

  if (action === "GET_ACTIVE_REQUESTS") {
    sendResponse({
      status: "ok",
      activeRequests: requestManager.getActiveCount()
    });
    return false;
  }

  // Create appropriate handler
  let handler;

  if (mode === REQUEST_MODES.STREAM) {
    handler = new StreamHandler(requestId, (response) => {
      try {
        sendResponse(response);
      } catch (error) {
        console.error(`[Stream ${requestId}] Error sending response:`, error);
      }
    });
  } else {
    handler = new NormalRequestHandler(requestId, (response) => {
      try {
        sendResponse(response);
        requestManager.removeRequest(requestId);
      } catch (error) {
        console.error(`[Request ${requestId}] Error sending response:`, error);
      }
    });
  }

  // Track and start handler
  requestManager.addRequest(requestId, handler);
  handler.start();

  // Send message to page
  window.postMessage(
    {
      type: MESSAGE_TYPES.FROM_EXTENSION,
      payload: { ...msg, requestId, mode }
    },
    "*"
  );

  return true; // Keep sendResponse alive
});

// ============================================================================
// Cleanup on unload
// ============================================================================

window.addEventListener("beforeunload", () => {
  console.log("Content script unloading, aborting all requests...");
  requestManager.abortAll();
});

// Intercept XMLHttpRequest
const originalXHROpen = XMLHttpRequest.prototype.open;
const originalXHRSend = XMLHttpRequest.prototype.send;
const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

XMLHttpRequest.prototype.open = function (method, url) {
  this._method = method;
  this._url = url;
  this._requestHeaders = {};
  return originalXHROpen.apply(this, arguments);
};

XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
  this._requestHeaders[header] = value;
  return originalXHRSetRequestHeader.apply(this, arguments);
};

XMLHttpRequest.prototype.send = function (body) {
  const requestData = {
    type: "xhr_request",
    url: this._url,
    method: this._method,
    headers: this._requestHeaders,
    body: body,
    timestamp: Date.now()
  };

  // Send request data to background script
  chrome.runtime.sendMessage(requestData);

  // Capture response
  this.addEventListener("readystatechange", function () {
    if (this.readyState === 4) {
      const responseData = {
        type: "xhr_response",
        url: this._url,
        status: this.status,
        responseText: this.responseText,
        responseHeaders: this.getAllResponseHeaders(),
        timestamp: Date.now()
      };

      // Send response data to background script
      chrome.runtime.sendMessage(responseData);
    }
  });

  return originalXHRSend.apply(this, arguments);
};

// Intercept Fetch API
const originalFetch = window.fetch;
window.fetch = function (...args) {
  const requestInfo = args[0];
  const requestInit = args[1] || {};

  const requestData = {
    type: "fetch_request",
    url: requestInfo,
    method: requestInit.method || "GET",
    headers: requestInit.headers
      ? Object.fromEntries(new Headers(requestInit.headers).entries())
      : {},
    body: requestInit.body,
    timestamp: Date.now()
  };

  // Send request data to background script
  chrome.runtime.sendMessage(requestData);

  return originalFetch.apply(this, args).then((response) => {
    // Clone response to read body without consuming it
    response
      .clone()
      .text()
      .then((body) => {
        const responseData = {
          type: "fetch_response",
          url: requestInfo,
          status: response.status,
          responseBody: body,
          responseHeaders: Object.fromEntries(response.headers.entries()),
          timestamp: Date.now()
        };

        // Send response data to background script
        chrome.runtime.sendMessage(responseData);
      });
    return response;
  });
};

// Open Main Setup
let keysPressed = {};

document.addEventListener("keydown", (e) => {
  keysPressed[e.key.toLowerCase()] = true;

  const isNetSuiteByUrl = location.hostname.includes("netsuite.com");

  if (!isNetSuiteByUrl) return;

  // Check if both "c" and "s" are pressed
  if (keysPressed["c"] && keysPressed["s"]) {
    chrome.runtime.sendMessage({ type: "OPEN_MAIN_SETUP" });
  }
});

document.addEventListener("keyup", (e) => {
  keysPressed[e.key.toLowerCase()] = false;
});
