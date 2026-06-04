const START_KEY = "magic_netsuite_element_screenshot_request";
const STOP_KEY = "magic_netsuite_element_screenshot_stop";
const DEFAULT_SHORTCUT = "ctrl+shift+s";

let installed = false;
let active = false;
let hoveredElement: Element | null = null;
let shortcut = DEFAULT_SHORTCUT;
let overlay: HTMLDivElement | null = null;
let label: HTMLDivElement | null = null;

const parseShortcut = (value: string) => {
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

const matchesShortcut = (event: KeyboardEvent, value: string) => {
  const { key, modifiers } = parseShortcut(value);
  const wantsCtrl =
    modifiers.includes("ctrl") ||
    modifiers.includes("cmd") ||
    modifiers.includes("meta");
  const ctrlMatch = wantsCtrl
    ? event.ctrlKey || event.metaKey
    : !event.ctrlKey && !event.metaKey;
  const altMatch = modifiers.includes("alt") ? event.altKey : !event.altKey;
  const shiftMatch = modifiers.includes("shift")
    ? event.shiftKey
    : !event.shiftKey;

  return ctrlMatch && altMatch && shiftMatch && event.key.toLowerCase() === key;
};

const requestSelection = async () => {
  await chrome.storage.local.set({
    [START_KEY]: {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      source: "extension-page"
    }
  });
};

const requestStopSelection = () => {
  chrome.storage.local
    .set({
      [STOP_KEY]: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
    })
    .catch(() => {});
};

const ensureOverlay = () => {
  if (overlay && label) return;

  overlay = document.createElement("div");
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

const updateOverlay = (element: Element | null) => {
  if (!active || !element || element === overlay || element === label) return;
  ensureOverlay();

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    hideOverlay();
    return;
  }

  Object.assign(overlay!.style, {
    display: "block",
    left: `${Math.max(0, rect.left)}px`,
    top: `${Math.max(0, rect.top)}px`,
    width: `${Math.max(1, Math.min(rect.width, window.innerWidth - rect.left))}px`,
    height: `${Math.max(1, Math.min(rect.height, window.innerHeight - rect.top))}px`
  });

  const labelTop = rect.top > 32 ? rect.top - 30 : rect.top + 8;
  Object.assign(label!.style, {
    display: "block",
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - 280))}px`,
    top: `${Math.max(8, labelTop)}px`
  });
};

const loadImage = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const getParentFrameRect = () =>
  new Promise<{
    left: number;
    top: number;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
  }>((resolve, reject) => {
    if (window.parent === window) {
      resolve({
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight
      });
      return;
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("Unable to locate extension iframe on the page."));
    }, 1000);

    function onMessage(event: MessageEvent) {
      if (
        event.data?.type !== "MAGIC_NETSUITE_EXTENSION_FRAME_RECT" ||
        event.data.requestId !== requestId
      ) {
        return;
      }

      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(event.data.rect);
    }

    window.addEventListener("message", onMessage);
    window.parent.postMessage({
      type: "MAGIC_NETSUITE_GET_EXTENSION_FRAME_RECT",
      requestId
    }, "*");
  });

const getTopViewportRect = async (element: Element) => {
  const rect = element.getBoundingClientRect();
  const frameRect = await getParentFrameRect();

  const left = Math.max(0, frameRect.left + rect.left);
  const top = Math.max(0, frameRect.top + rect.top);
  const right = Math.min(frameRect.viewportWidth, frameRect.left + rect.right);
  const bottom = Math.min(frameRect.viewportHeight, frameRect.top + rect.bottom);

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
    viewportWidth: frameRect.viewportWidth,
    viewportHeight: frameRect.viewportHeight
  };
};

const copyElementScreenshot = async (element: Element) => {
  const rect = await getTopViewportRect(element);
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
  if (!context) throw new Error("Unable to render screenshot.");

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

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );
  if (!blob) throw new Error("Unable to render screenshot.");

  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
};

const showToast = (message: string, tone: "ok" | "error" = "ok") => {
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
  window.setTimeout(() => toast.remove(), 2200);
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

function onMouseMove(event: MouseEvent) {
  hoveredElement = event.target instanceof Element ? event.target : null;
  updateOverlay(hoveredElement);
}

async function onClick(event: MouseEvent) {
  if (!active) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const element = event.target instanceof Element ? event.target : null;
  stopSelection();
  requestStopSelection();

  if (!element) return;

  try {
    await waitForPaint();
    await copyElementScreenshot(element);
    showToast("Element screenshot copied to clipboard");
  } catch (error) {
    console.error("[Magic Netsuite] Element screenshot failed:", error);
    showToast(error instanceof Error ? error.message : "Element screenshot failed", "error");
  }
}

function onPickerKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    stopSelection();
    requestStopSelection();
    showToast("Element screenshot picker cancelled");
  }
}

export const installElementScreenshotPicker = async () => {
  if (installed) return;
  installed = true;

  try {
    const result = await chrome.storage.sync.get(["magic_netsuite_settings"]);
    shortcut =
      result.magic_netsuite_settings?.elementScreenshotShortcut ||
      DEFAULT_SHORTCUT;
  } catch {
    shortcut = DEFAULT_SHORTCUT;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && changes.magic_netsuite_settings) {
      shortcut =
        changes.magic_netsuite_settings.newValue?.elementScreenshotShortcut ||
        DEFAULT_SHORTCUT;
    }

    if (areaName === "local" && changes[START_KEY]?.newValue) {
      startSelection();
    }

    if (areaName === "local" && changes[STOP_KEY]?.newValue) {
      stopSelection();
    }
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (active || !matchesShortcut(event, shortcut)) return;
      event.preventDefault();
      event.stopPropagation();
      requestSelection().catch(() => {});
    },
    true
  );
};
