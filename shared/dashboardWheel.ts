import {
  matchesDashboardShortcut,
  normalizeDashboardShortcut,
} from "./dashboardLaunch";
import { getPreferredViews } from "./navigationViews";

export type DashboardWheelItem = {
  id: string;
  title: string;
  mode: string;
  account?: string;
  pinned?: boolean;
  kind?: "dashboard" | "view";
  path?: string;
  icon?: string;
};
export function preferredWheelItems(preferred: unknown): DashboardWheelItem[] {
  return getPreferredViews(preferred).map((view) => ({
    id: `view:${view.route}`,
    title: view.name,
    mode: "Preferred view",
    kind: "view",
    path: view.route,
    icon: view.icon,
    pinned: true,
  }));
}
export const DEFAULT_DASHBOARD_WHEEL_SHORTCUT = "ctrl+alt+d";
export const DASHBOARD_WHEEL_PAGE_SIZE = 8;
export function wheelIndex(
  x: number,
  y: number,
  count: number,
  inner: number,
  outer: number,
) {
  const distance = Math.hypot(x, y);
  if (!count || distance < inner || distance > outer) return -1;
  const angle =
    (Math.atan2(y, x) + Math.PI / 2 + Math.PI / count + Math.PI * 2) %
    (Math.PI * 2);
  return Math.floor(angle / ((Math.PI * 2) / count)) % count;
}
export function wheelCenter(width: number, height: number) {
  return { x: width / 2, y: height / 2 };
}
function wedgePath(index: number, count: number, inner: number, outer: number) {
  const angle = (Math.PI * 2) / count;
  const start = -Math.PI / 2 + angle * (index - 0.5) + 0.001;
  const end = start + angle - 0.002;
  const point = (r: number, a: number) =>
    `${r * Math.cos(a)},${r * Math.sin(a)}`;
  const large = end - start > Math.PI ? 1 : 0;
  return `M${point(outer, start)} A${outer},${outer} 0 ${large} 1 ${point(outer, end)} L${point(inner, end)} A${inner},${inner} 0 ${large} 0 ${point(inner, start)} Z`;
}

// Inline line icons work in both extension and NetSuite shadow roots, without icon fonts.
const icons: Record<string, string> = {
  "th-large": "M2 2h7v7H2z M15 2h7v7h-7z M2 15h7v7H2z M15 15h7v7h-7z",
  folder: "M2 6V4h8l2 3h10v13H2z M2 9h20",
  database:
    "M3 5a9 3 0 1 0 18 0a9 3 0 1 0-18 0 M3 5v14c0 4 18 4 18 0V5 M3 12c0 4 18 4 18 0",
  table: "M2 3h20v18H2z M2 9h20 M2 15h20 M9 9v12",
  box: "M12 2 22 7v10l-10 5L2 17V7z M2 7l10 5 10-5 M12 12v10 M7 4.5l10 5",
  code: "m8 5-6 7 6 7 M16 5l6 7-6 7 M14 3l-4 18",
  terminal: "m3 5 6 6-6 6 M12 18h9",
  cog: "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
  file: "M5 2h9l5 5v15H5z M14 2v5h5 M8 12h8 M8 16h8",
  "file-edit": "M5 2h9l5 5v4 M5 2v20h7 M14 2v5h5 M13 18l6-6 3 3-6 6-4 1z",
  book: "M2 3h7l3 2 3-2h7v18h-7l-3-2-3 2H2z M12 5v14",
  server: "M2 2h20v8H2z M2 14h20v8H2z M5 6h1 M5 18h1",
  sitemap: "M8 2h8v6H8z M2 16h6v6H2z M16 16h6v6h-6z M12 8v4 M5 16v-4h14v4",
  "share-alt":
    "M3 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M16 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M16 19a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M9 11l7-5 M9 13l7 5",
  bolt: "m13 2-9 12h7l-1 8 10-13h-8z",
  list: "M3 5h1 M8 5h13 M3 12h1 M8 12h13 M3 19h1 M8 19h13",
  "list-check":
    "m2 5 2 2 3-4 M10 5h12 m-20 8 2 2 3-4 M10 13h12 M2 21h5 M10 21h12",
  history: "M3 8a9 9 0 1 1 0 8 M3 3v5h5 M12 7v6l4 2",
  download: "M12 2v14 m-6-6 6 6 6-6 M3 18v4h18v-4",
  eye: "M1 12Q12-3 23 12Q12 27 1 12 M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
  link: "m10 8 3-3a5 5 0 0 1 7 7l-3 3 M14 16l-3 3a5 5 0 0 1-7-7l3-3 M8 16l8-8",
  send: "m2 3 21 9-21 9 5-9z M7 12h16",
  sparkles: "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z",
  wrench: "M14 3a7 7 0 0 0-8 9l-4 7 3 3 7-5a7 7 0 0 0 9-8l-5 4-5-5z",
  "wave-pulse": "M1 12h5l3-8 6 16 3-8h5",
  compass: "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0 M16 8l-3 5-5 3 3-5z",
  comments: "M2 3h16v12H8l-6 4z M18 7h4v15l-5-4h-6v-3",
  "question-circle":
    "M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0 M9 8a3 3 0 0 1 6 0c0 3-3 3-3 6 M12 18h.01",
};

/** One isolated renderer and gesture controller for Vue workspaces and NetSuite pages. */
export function installDashboardWheel(options: {
  shortcut: () => string;
  items: () => DashboardWheelItem[];
  open: (item: DashboardWheelItem) => void;
  enabled?: () => boolean;
}) {
  let pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let center = pointer;
  let radius = 190;
  let host: HTMLElement | undefined;
  let root: ShadowRoot | undefined;
  let items: DashboardWheelItem[] = [];
  let page = 0;
  let selected = -1;
  let trigger = "";
  let triggerHeld = false;
  const visibleItems = () =>
    items.slice(
      page * DASHBOARD_WHEEL_PAGE_SIZE,
      (page + 1) * DASHBOARD_WHEEL_PAGE_SIZE,
    );
  function close(commit = false) {
    const chosen = commit ? visibleItems()[selected] : undefined;
    host?.remove();
    host = undefined;
    root = undefined;
    selected = -1;
    if (chosen) options.open(chosen);
  }
  function highlight(index: number) {
    selected = index;
    root?.querySelectorAll("[data-wheel-index]").forEach((node) => {
      const active = Number(node.getAttribute("data-wheel-index")) === index;
      node.classList.toggle("selected", active);
      node.setAttribute("aria-selected", String(active));
    });
    const chosen = visibleItems()[index];
    const title = root?.querySelector(".wheel-title");
    const detail = root?.querySelector(".wheel-detail");
    if (title) title.textContent = chosen?.title || "Navigator";
    title?.classList.toggle("idle", !chosen);
    if (detail)
      detail.textContent = chosen
        ? `${chosen.kind === "view" ? "Preferred view" : chosen.mode}${chosen.account ? " · " + chosen.account : ""}`
        : items.length
          ? "Select a destination"
          : "Pin a view or create a dashboard";
  }
  function render() {
    if (!root) return;
    root.replaceChildren();
    const style = document.createElement("style");
    style.textContent = `
      :host { position:fixed;inset:0;z-index:2147483647;font:12px/1.4 var(--magic-wheel-font,"JetBrains Mono",system-ui); }
      .backdrop { position:absolute;inset:0;background:#0f172a38;backdrop-filter:blur(6px); }
      .wheel { position:absolute;color:var(--p-text-color,#334155);filter:drop-shadow(0 16px 32px #0f172a26); }
      svg { overflow:visible;width:100%;height:100%; }
      .wedge { fill:color-mix(in srgb,var(--p-content-background,#f1f5f9) 94%,transparent);stroke:var(--p-content-border-color,#cbd5e1);stroke-width:.6;transition:fill .12s; }
      .selected .wedge { fill:var(--p-highlight-background,#e2e8f0); }
      .selection-arc { fill:none;stroke:var(--p-primary-color,#334155);stroke-width:3;opacity:0;transition:opacity .12s;pointer-events:none; }
      .selected .selection-arc,.selected .selection-pointer { opacity:1; }
      .selection-pointer { fill:var(--p-primary-color,#334155);opacity:0;pointer-events:none; }
      .label { fill:var(--p-text-muted-color,#64748b);font-size:9px;text-anchor:middle;pointer-events:none; }
      .selected .label { fill:var(--p-text-color,#334155); }
      .icon { fill:none;stroke:var(--p-text-muted-color,#64748b);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;pointer-events:none; }
      .selected .icon { stroke:var(--p-primary-color,#334155); }
      .wheel-center { position:absolute;inset:26%;box-sizing:border-box;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:var(--p-content-background,#f1f5f9);border:1px solid var(--p-content-border-color,#cbd5e1);padding:18px;pointer-events:none; }
      .wheel-title { font-size:12px;font-weight:600;overflow-wrap:anywhere;line-height:1.5;max-height:72px;overflow:hidden; }
      .wheel-title.idle { font-size:11px;text-transform:uppercase;letter-spacing:2.5px; }
      .wheel-detail { font-size:9px;color:var(--p-text-muted-color,#64748b);margin-top:7px;line-height:1.6; }
      .hint { position:absolute;top:calc(100% + 22px);left:50%;transform:translateX(-50%);width:min(420px,90vw);text-align:center;color:var(--p-text-color,#334155);font-size:10px;line-height:1.8; }
      .hint span { display:inline-block;background:var(--p-content-background,#f1f5f9);border:1px solid var(--p-content-border-color,#cbd5e1);border-radius:var(--p-border-radius-md,6px);padding:3px 10px; }
      @media (prefers-reduced-motion:reduce) { .wedge,.selection-arc { transition:none; } }
    `;
    root.appendChild(style);
    const backdrop = document.createElement("div");
    backdrop.className = "backdrop";
    root.appendChild(backdrop);
    const wheel = document.createElement("div");
    wheel.className = "wheel";
    wheel.style.cssText = `left:${center.x - radius}px;top:${center.y - radius}px;width:${radius * 2}px;height:${radius * 2}px`;
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute(
      "viewBox",
      `${-radius} ${-radius} ${radius * 2} ${radius * 2}`,
    );
    svg.setAttribute("role", "listbox");
    svg.setAttribute("aria-label", "Choose a dashboard or preferred view");
    visibleItems().forEach((item, index, current) => {
      const group = document.createElementNS(svgNS, "g");
      group.setAttribute("role", "option");
      group.setAttribute("aria-label", item.title);
      group.setAttribute("data-wheel-index", String(index));
      group.setAttribute("data-dashboard-wheel-item", item.id);
      group.setAttribute("data-wheel-kind", item.kind || "dashboard");
      const path = document.createElementNS(svgNS, "path");
      path.classList.add("wedge");
      path.setAttribute(
        "d",
        wedgePath(index, current.length, radius * 0.48, radius),
      );
      group.appendChild(path);
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / current.length;
      const segmentAngle = (Math.PI * 2) / current.length;
      const arcStart = angle - segmentAngle / 2 + 0.025;
      const arcEnd = angle + segmentAngle / 2 - 0.025;
      const arc = document.createElementNS(svgNS, "path");
      arc.classList.add("selection-arc");
      arc.setAttribute(
        "d",
        `M${radius * Math.cos(arcStart)},${radius * Math.sin(arcStart)} A${radius},${radius} 0 ${arcEnd - arcStart > Math.PI ? 1 : 0} 1 ${radius * Math.cos(arcEnd)},${radius * Math.sin(arcEnd)}`,
      );
      group.appendChild(arc);
      const pointer = document.createElementNS(svgNS, "path");
      pointer.classList.add("selection-pointer");
      pointer.setAttribute("d", "M-3 0L0 -5L3 0Z");
      pointer.setAttribute(
        "transform",
        `rotate(${(angle * 180) / Math.PI + 90}) translate(0,${-radius * 0.48 - 10})`,
      );
      group.appendChild(pointer);
      const x = Math.cos(angle) * radius * 0.74,
        y = Math.sin(angle) * radius * 0.74;
      const icon = document.createElementNS(svgNS, "path");
      icon.classList.add("icon");
      icon.setAttribute("transform", `translate(${x - 12},${y - 18})`);
      icon.setAttribute(
        "d",
        icons[item.icon?.split("pi-").pop() || "th-large"] || icons.file!,
      );
      group.appendChild(icon);
      const label = document.createElementNS(svgNS, "text");
      label.classList.add("label");
      label.setAttribute("x", String(x));
      label.setAttribute("y", String(y + 22));
      const title =
        item.title.length > 16 ? item.title.slice(0, 15) + "…" : item.title;
      label.textContent = title;
      group.appendChild(label);
      svg.appendChild(group);
    });
    wheel.appendChild(svg);
    const middle = document.createElement("div");
    middle.className = "wheel-center";
    middle.setAttribute("role", "status");
    const title = document.createElement("div");
    title.className = "wheel-title";
    const detail = document.createElement("div");
    detail.className = "wheel-detail";
    middle.append(title, detail);
    wheel.appendChild(middle);
    const hint = document.createElement("div");
    hint.className = "hint";
    const hintText = document.createElement("span");
    hintText.textContent = `${trigger.toUpperCase()} · release to open · Esc to cancel${items.length > DASHBOARD_WHEEL_PAGE_SIZE ? ` · ${page + 1}/${Math.ceil(items.length / DASHBOARD_WHEEL_PAGE_SIZE)} · scroll` : ""}`;
    hint.appendChild(hintText);
    wheel.appendChild(hint);
    root.appendChild(wheel);
    highlight(-1);
  }
  const move = (event: MouseEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (host)
      highlight(
        wheelIndex(
          pointer.x - center.x,
          pointer.y - center.y,
          visibleItems().length,
          radius * 0.48,
          radius + 8,
        ),
      );
  };
  const down = (event: KeyboardEvent) => {
    const physicalKey = event.code?.replace(/^(Key|Digit)/, "").toLowerCase();
    if (
      triggerHeld &&
      event.repeat &&
      (event.key.toLowerCase() === trigger.split("+").pop() ||
        physicalKey === trigger.split("+").pop())
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (host) {
      // Holding the trigger must not type repeated letters into the underlying form.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (
        ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const count = visibleItems().length;
        if (count) {
          const forward = ["ArrowRight", "ArrowDown"].includes(event.key);
          highlight(
            selected < 0
              ? forward
                ? 0
                : count - 1
              : (selected + (forward ? 1 : count - 1)) % count,
          );
        }
      }
      return;
    }
    if (
      event.repeat ||
      event.isComposing ||
      event.defaultPrevented ||
      options.enabled?.() === false
    )
      return;
    try {
      trigger = normalizeDashboardShortcut(options.shortcut());
    } catch {
      return;
    }
    if (!matchesDashboardShortcut(event, trigger)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    triggerHeld = true;
    items = options.items();
    page = 0;
    selected = -1;
    radius = Math.max(
      65,
      Math.min(
        190,
        (Math.min(window.innerWidth, window.innerHeight) - 100) / 2,
      ),
    );
    center = wheelCenter(window.innerWidth, window.innerHeight);
    host = document.createElement("div");
    host.id = "magic-dashboard-wheel";
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-label", "Quick navigator");
    host.setAttribute("aria-modal", "true");
    root = host.attachShadow({ mode: "open" });
    document.body.appendChild(host);
    render();
  };
  const up = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase().replace("control", "ctrl");
    const triggerKey = trigger.split("+").pop();
    const physicalKey = event.code?.replace(/^(Key|Digit)/, "").toLowerCase();
    if (key === triggerKey || physicalKey === triggerKey) triggerHeld = false;
    if (!host) return;
    if (trigger.split("+").includes(key) || triggerKey === physicalKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    }
  };
  const mouseUp = (event: MouseEvent) => {
    if (host && event.button === 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    }
  };
  const scroll = (event: WheelEvent) => {
    if (!host) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const pages = Math.ceil(items.length / DASHBOARD_WHEEL_PAGE_SIZE);
    if (pages > 1) {
      page = (page + (event.deltaY >= 0 ? 1 : pages - 1)) % pages;
      render();
    }
  };
  const cancel = () => {
    triggerHeld = false;
    close();
  };
  window.addEventListener("mousemove", move, true);
  window.addEventListener("keydown", down, true);
  window.addEventListener("keyup", up, true);
  window.addEventListener("mouseup", mouseUp, true);
  window.addEventListener("wheel", scroll, { capture: true, passive: false });
  window.addEventListener("blur", cancel);
  window.addEventListener("resize", cancel);
  return () => {
    close();
    window.removeEventListener("mousemove", move, true);
    window.removeEventListener("keydown", down, true);
    window.removeEventListener("keyup", up, true);
    window.removeEventListener("mouseup", mouseUp, true);
    window.removeEventListener("wheel", scroll, true);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("resize", cancel);
  };
}
