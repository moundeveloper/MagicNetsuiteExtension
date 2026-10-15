/** One resizable workspace widget with independent dashboard/view tabs. */
type Widget = {
  element: HTMLElement;
  frame: HTMLIFrameElement;
  open: (path: string, title: string) => void;
};
let widget: Widget | undefined;
export const hasDashboardWidget = () => Boolean(widget);
let root: ShadowRoot | undefined;

const clampWidth = (width: number) =>
  Math.max(
    Math.min(360, window.innerWidth - 24),
    Math.min(window.innerWidth - 24, width),
  );

export function openDashboardWidget(path: string, title: string) {
  if (widget) {
    widget.open(path, title);
    widget.frame.focus();
    return;
  }
  if (!root) {
    const host = document.createElement("div");
    host.id = "magic-dashboard-widgets";
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host {position:fixed;inset:0;z-index:20000001;pointer-events:none;font:12px/1.5 "JetBrains Mono",system-ui;color:var(--p-text-color,#334155)}
      .widget {position:absolute;right:12px;bottom:12px;display:flex;flex-direction:column;pointer-events:auto;background:var(--p-content-background,#f1f5f9);border:1px solid var(--p-content-border-color,#cbd5e1);border-radius:8px;box-shadow:0 12px 36px #0f172a33;overflow:visible}
      header {display:flex;align-items:center;gap:8px;padding:6px 8px 6px 14px;border-bottom:1px solid var(--p-content-border-color,#cbd5e1)}
      strong {flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:600}
      button {border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer;width:26px;height:26px;font:16px system-ui}
      button:hover {background:var(--p-highlight-background,#e2e8f0)}
      button:focus-visible,.resize:focus-visible {outline:2px solid var(--p-primary-color,#64748b);outline-offset:2px}
      iframe {flex:1;min-height:0;width:100%;border:0;border-radius:0 0 8px 8px;background:var(--p-content-background,#f1f5f9)}
      .resize {position:absolute;left:-7px;top:0;bottom:0;width:14px;cursor:ew-resize;touch-action:none;display:flex;align-items:center;justify-content:center}
      .resize::after {content:'';width:4px;height:42px;border-radius:4px;background:var(--p-content-border-color,#94a3b8);box-shadow:0 0 0 3px var(--p-content-background,#f1f5f9)}
      .resize:hover::after,.resize:focus-visible::after {background:var(--p-primary-color,#64748b)}
      .shield {position:absolute;inset:0;cursor:ew-resize;z-index:2}
    `;
    root.appendChild(style);
    document.body.appendChild(host);
  }
  const element = document.createElement("section");
  element.className = "widget";
  element.dataset.widgetWorkspace = "true";
  element.setAttribute("aria-label", "Dashboard workspace");
  const offset = 0;
  element.style.top = `${72 + offset}px`;
  element.style.right = `${12 + offset}px`;
  const header = document.createElement("header");
  const label = document.createElement("strong");
  label.textContent = "Dashboards & views";
  const expand = document.createElement("button");
  expand.textContent = "↔";
  expand.setAttribute("aria-label", "Expand dashboard widget");
  const close = document.createElement("button");
  close.textContent = "×";
  close.setAttribute("aria-label", "Close dashboard widget");
  header.append(label, expand, close);
  const frame = document.createElement("iframe");
  const url = new URL(chrome.runtime.getURL("dist/vue-ui/index.html"));
  url.searchParams.set("magicDashboardWidget", "workspace");
  url.searchParams.set("initialRoute", path);
  frame.src = url.href;
  frame.title = "Dashboard workspace widget";
  frame.allow = "clipboard-read; clipboard-write";
  const handle = document.createElement("div");
  handle.className = "resize";
  handle.tabIndex = 0;
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", "Resize dashboard widget");
  const defaultWidth = () => clampWidth(Math.max(560, window.innerWidth * 0.5));
  let width = defaultWidth();
  const resize = () => {
    width = clampWidth(width);
    element.style.width = `${width}px`;
    element.style.top = `${Math.min(72 + offset, Math.max(12, window.innerHeight - 240))}px`;
    // Keep stacked panels reachable when the viewport is narrowed.
    element.style.right = `${Math.min(12 + offset, Math.max(0, window.innerWidth - width - 12))}px`;
    handle.setAttribute("aria-valuenow", String(Math.round(width)));
    handle.setAttribute(
      "aria-valuemin",
      String(Math.min(360, window.innerWidth - 24)),
    );
    handle.setAttribute("aria-valuemax", String(window.innerWidth - 24));
  };
  let stopDrag = () => {};
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = event.clientX,
      startWidth = width;
    handle.setPointerCapture(event.pointerId);
    const shield = document.createElement("div");
    shield.className = "shield";
    element.appendChild(shield);
    const move = (next: PointerEvent) => {
      width = startWidth + start - next.clientX;
      resize();
    };
    stopDrag = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stopDrag);
      handle.removeEventListener("pointercancel", stopDrag);
      shield.remove();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stopDrag);
    handle.addEventListener("pointercancel", stopDrag);
  });
  handle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    width =
      event.key === "Home"
        ? 360
        : event.key === "End"
          ? window.innerWidth - 24
          : width + (event.key === "ArrowLeft" ? 40 : -40);
    resize();
  });
  expand.addEventListener("click", () => {
    width =
      width > window.innerWidth * 0.8 ? defaultWidth() : window.innerWidth - 24;
    resize();
  });
  close.addEventListener("click", () => {
    stopDrag();
    window.removeEventListener("resize", resize);
    element.remove();
    window.removeEventListener("message", ready);
    widget = undefined;
    root?.host.remove();
    root = undefined;
  });

  element.append(header, frame, handle);
  root.appendChild(element);
  resize();
  const origin =
    url.origin === "null" ? `${url.protocol}//${url.host}` : url.origin;
  let loaded = false;
  const pending: Array<{ path: string; title: string }> = [];
  const open = (path: string, title: string) => {
    if (!loaded) {
      pending.push({ path, title });
      return;
    }
    frame.contentWindow?.postMessage(
      {
        type: "DASHBOARD_WIDGET_OPEN",
        path,
        label: title,
        preferred: !path.startsWith("/dashboard/"),
      },
      origin,
    );
  };
  function ready(event: MessageEvent) {
    if (
      event.source !== frame.contentWindow ||
      event.origin !== origin ||
      event.data?.type !== "DASHBOARD_WIDGET_READY"
    )
      return;
    loaded = true;
    pending.splice(0).forEach((item) => open(item.path, item.title));
  }
  window.addEventListener("message", ready);
  widget = { element, frame, open };
  window.addEventListener("resize", resize);
}
