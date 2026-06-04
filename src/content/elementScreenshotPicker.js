(() => {
  const START_KEY = "magic_netsuite_element_screenshot_request";
  const STOP_KEY = "magic_netsuite_element_screenshot_stop";
  const DEFAULT_SHORTCUT = "ctrl+shift+s";
  const OVERLAY_ID = "magic-netsuite-element-screenshot-overlay";
  const LABEL_ID = "magic-netsuite-element-screenshot-label";

  let active = false;
  let hoveredElement = null;
  let shortcut = DEFAULT_SHORTCUT;
  let overlay = null;
  let label = null;

  const parseShortcut = (value) => {
    const parts = String(value || DEFAULT_SHORTCUT)
      .toLowerCase()
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
    return {
      key: parts[parts.length - 1] || "s",
      modifiers: parts.slice(0, -1)
    };
  };

  const matchesShortcut = (event, value) => {
    const { key, modifiers } = parseShortcut(value);
    const wantsCtrl = modifiers.includes("ctrl") || modifiers.includes("cmd") || modifiers.includes("meta");
    const ctrlMatch = wantsCtrl ? event.ctrlKey || event.metaKey : !event.ctrlKey && !event.metaKey;
    const altMatch = modifiers.includes("alt") ? event.altKey : !event.altKey;
    const shiftMatch = modifiers.includes("shift") ? event.shiftKey : !event.shiftKey;
    return ctrlMatch && altMatch && shiftMatch && event.key.toLowerCase() === key;
  };

  const requestSelection = async (source = "shortcut") => {
    try {
      await chrome.storage.local.set({
        [START_KEY]: {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          source
        }
      });
    } catch (error) {
      console.error("[Magic Netsuite] Failed to start element screenshot picker:", error);
    }
  };

  const requestStopSelection = () => {
    chrome.storage.local.set({
      [STOP_KEY]: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
    }).catch(() => {});
  };

  const loadShortcut = async () => {
    try {
      const result = await chrome.storage.sync.get(["magic_netsuite_settings"]);
      shortcut = result.magic_netsuite_settings?.elementScreenshotShortcut || DEFAULT_SHORTCUT;
    } catch {
      shortcut = DEFAULT_SHORTCUT;
    }
  };

  const ensureOverlay = () => {
    if (overlay && label) return;

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: "fixed",
      zIndex: "2147483646",
      pointerEvents: "none",
      border: "2px solid #22c55e",
      background: "transparent",
      boxShadow: "none",
      display: "none",
      boxSizing: "border-box"
    });

    label = document.createElement("div");
    label.id = LABEL_ID;
    label.textContent = "Click to copy element screenshot · Esc to cancel";
    Object.assign(label.style, {
      position: "fixed",
      zIndex: "2147483647",
      pointerEvents: "none",
      display: "none",
      padding: "5px 8px",
      borderRadius: "6px",
      background: "#0f172a",
      color: "#ffffff",
      font: "12px/1.3 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      boxShadow: "0 8px 24px rgba(15, 23, 42, 0.25)"
    });

    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(label);
  };

  const hideOverlay = () => {
    if (overlay) overlay.style.display = "none";
    if (label) label.style.display = "none";
  };

  const updateOverlay = (element) => {
    if (!active || !element || element === overlay || element === label) return;
    ensureOverlay();

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      hideOverlay();
      return;
    }

    Object.assign(overlay.style, {
      display: "block",
      left: `${Math.max(0, rect.left)}px`,
      top: `${Math.max(0, rect.top)}px`,
      width: `${Math.max(1, Math.min(rect.width, window.innerWidth - rect.left))}px`,
      height: `${Math.max(1, Math.min(rect.height, window.innerHeight - rect.top))}px`
    });

    const labelTop = rect.top > 32 ? rect.top - 30 : rect.top + 8;
    Object.assign(label.style, {
      display: "block",
      left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 280))}px`,
      top: `${Math.max(8, labelTop)}px`
    });
  };

  const getFrameOffsetToTop = () => {
    let x = 0;
    let y = 0;
    let currentWindow = window;

    try {
      while (currentWindow !== currentWindow.top) {
        const frameElement = currentWindow.frameElement;
        if (!frameElement) break;
        const rect = frameElement.getBoundingClientRect();
        x += rect.left;
        y += rect.top;
        currentWindow = currentWindow.parent;
      }
    } catch {
      return { x: 0, y: 0 };
    }

    return { x, y };
  };

  const getTopViewportSize = () => {
    try {
      return {
        width: window.top.innerWidth,
        height: window.top.innerHeight
      };
    } catch {
      return {
        width: window.innerWidth,
        height: window.innerHeight
      };
    }
  };

  const getViewportRect = (element) => {
    const rect = element.getBoundingClientRect();
    const offset = getFrameOffsetToTop();
    const viewport = getTopViewportSize();

    const left = Math.max(0, rect.left + offset.x);
    const top = Math.max(0, rect.top + offset.y);
    const right = Math.min(viewport.width, rect.right + offset.x);
    const bottom = Math.min(viewport.height, rect.bottom + offset.y);

    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
      viewportWidth: viewport.width,
      viewportHeight: viewport.height
    };
  };

  const dataUrlToBlob = async (dataUrl) => {
    const response = await fetch(dataUrl);
    return response.blob();
  };

  const loadImage = (dataUrl) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = dataUrl;
    });

  const waitForPaint = () =>
    new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });

  const copyElementScreenshot = async (element) => {
    const rect = getViewportRect(element);
    const response = await chrome.runtime.sendMessage({
      type: "CAPTURE_ELEMENT_SCREENSHOT",
      rect
    });

    if (!response?.ok || !response.dataUrl) {
      throw new Error(response?.error || "Unable to capture visible tab.");
    }

    const image = await loadImage(response.dataUrl);
    const scaleX = image.naturalWidth / rect.viewportWidth;
    const scaleY = image.naturalHeight / rect.viewportHeight;
    const cropLeft = Math.round(rect.left * scaleX);
    const cropTop = Math.round(rect.top * scaleY);
    const cropWidth = Math.max(1, Math.round(rect.width * scaleX));
    const cropHeight = Math.max(1, Math.round(rect.height * scaleY));

    const canvas = document.createElement("canvas");
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    const context = canvas.getContext("2d");
    context.drawImage(
      image,
      cropLeft,
      cropTop,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Unable to render screenshot.");

    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return;
    }

    await navigator.clipboard.writeText(response.dataUrl);
  };

  const showToast = (message, tone = "ok") => {
    const toast = document.createElement("div");
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "2147483647",
      padding: "8px 10px",
      borderRadius: "8px",
      background: tone === "ok" ? "#166534" : "#991b1b",
      color: "#ffffff",
      font: "12px/1.3 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      boxShadow: "0 10px 30px rgba(15, 23, 42, 0.25)"
    });
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
  };

  const stopSelection = () => {
    active = false;
    hoveredElement = null;
    hideOverlay();
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onPickerKeyDown, true);
  };

  const startSelection = () => {
    stopSelection();
    active = true;
    ensureOverlay();
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onPickerKeyDown, true);
    showToast("Element screenshot picker enabled");
  };

  function onMouseMove(event) {
    hoveredElement = event.target;
    updateOverlay(hoveredElement);
  }

  async function onClick(event) {
    if (!active) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const element = event.target;
    stopSelection();
    requestStopSelection();

    try {
      await waitForPaint();
      await copyElementScreenshot(element);
      showToast("Element screenshot copied to clipboard");
    } catch (error) {
      console.error("[Magic Netsuite] Element screenshot failed:", error);
      showToast(error?.message || "Element screenshot failed", "error");
    }
  }

  function onPickerKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      stopSelection();
      requestStopSelection();
      showToast("Element screenshot picker cancelled");
    }
  }

  document.addEventListener("keydown", (event) => {
    if (active) return;
    if (!matchesShortcut(event, shortcut)) return;

    event.preventDefault();
    event.stopPropagation();
    requestSelection("content-shortcut");
  }, true);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.magic_netsuite_settings) {
      shortcut = changes.magic_netsuite_settings.newValue?.elementScreenshotShortcut || DEFAULT_SHORTCUT;
    }

    if (areaName === "local" && changes[START_KEY]?.newValue) {
      startSelection();
    }

    if (areaName === "local" && changes[STOP_KEY]?.newValue) {
      stopSelection();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "START_ELEMENT_SCREENSHOT_SELECTION") return;
    requestSelection("runtime-message")
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });

  window.addEventListener("message", (event) => {
    if (event.data?.type !== "MAGIC_NETSUITE_GET_EXTENSION_FRAME_RECT") return;

    const iframe = Array.from(document.querySelectorAll("iframe"))
      .find((frame) => frame.contentWindow === event.source);

    if (!iframe) return;

    const rect = iframe.getBoundingClientRect();
    event.source.postMessage({
      type: "MAGIC_NETSUITE_EXTENSION_FRAME_RECT",
      requestId: event.data.requestId,
      rect: {
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      }
    }, event.origin);
  });

  loadShortcut();
})();
