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
    "/app/setup/mainsetup.nl",
  );

  if (injectAllowed) {
    dock.style.display = "block";
    injectUi(injectAllowed);

    document.head.appendChild(style);
    document.body.appendChild(dock);

    const checkbox = document.getElementById(TOGGLE_ID);
    checkbox.checked = true;

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
    { once: true },
  );
};

// inject iframe if not exists
const injectUi = () => {
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
    pointerEvents: "none",
  });

  // 1️⃣ Append hidden first
  document.body.appendChild(iframe);

  // 2️⃣ Give the browser a tiny delay to register initial state
  setTimeout(() => {
    iframe.style.opacity = "1";
    iframe.style.transform = "translateY(0)";
    iframe.style.pointerEvents = "auto";
  }, 50); // 50ms delay is enough
};

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
    createDock();
  } catch (error) {
    console.log("Error", error);
  }
})();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const requestId = Math.random().toString(36).substring(2, 10);

  const handleResponse = (event) => {
    if (event.source !== window) return;
    const data = event.data?.payload;
    if (!data || event.data?.type !== "TO_EXTENSION") return;
    if (data.requestId !== requestId) return; // ignore other responses

    sendResponse(data);
    window.removeEventListener("message", handleResponse);
  };

  window.addEventListener("message", handleResponse);

  window.postMessage(
    { type: "FROM_EXTENSION", payload: { ...msg, requestId } },
    "*",
  );

  return true; // keep sendResponse alive
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
    timestamp: Date.now(),
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
        timestamp: Date.now(),
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
    timestamp: Date.now(),
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
          timestamp: Date.now(),
        };

        // Send response data to background script
        chrome.runtime.sendMessage(responseData);
      });
    return response;
  });
};

// Open on mainsetup
const openOnMainSetup = () => {
  console.log("openOnMainSetup");
  if (!window.location.href.includes("/app/setup/mainsetup.nl")) return;

  const button = document.createElement("button");
  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "MAIN_SETUP" });
  });

  button.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    }),
  );
};

if (document.readyState === "complete") {
  openOnMainSetup();
} else {
  window.addEventListener("load", openOnMainSetup, { once: true });
}

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
