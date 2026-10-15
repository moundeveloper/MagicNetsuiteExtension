/** Live workspace ports are scoped to their actual tab/window, rather than global UI flags. */
type NavigatorTab = { id?: number; windowId: number };
type NavigatorPort = {
  sender?: { id?: string; url?: string; tab?: NavigatorTab };
  onMessage: {
    addListener: (listener: (message: Record<string, any>) => void) => void;
  };
  onDisconnect: { addListener: (listener: () => void) => void };
  postMessage: (message: Record<string, any>) => void;
};
type Surface = {
  port: NavigatorPort;
  kind: "page" | "panel";
  tabId?: number;
  windowId: number;
  pending: Map<string, (response: { ok?: boolean; error?: string }) => void>;
};
const surfaces = new Map<NavigatorPort, Surface>();
let sequence = 0;

export function registerNavigatorWorkspace(port: NavigatorPort) {
  if (
    port.sender?.id !== chrome.runtime.id ||
    !port.sender.url?.startsWith(
      chrome.runtime.getURL("dist/vue-ui/index.html"),
    )
  )
    return;
  const url = new URL(port.sender.url);
  if (
    [
      "magicExecutionSurface",
      "magicDashboardPreview",
      "magicTemplateReview",
      "magicDashboardWidget",
    ].some((key) => url.searchParams.has(key))
  )
    return;
  port.onMessage.addListener((message) => {
    if (message.type === "NAVIGATOR_REGISTER") {
      const tab = port.sender?.tab;
      const kind = tab ? "page" : "panel";
      const windowId = tab?.windowId ?? message.windowId;
      if (message.kind !== kind || !Number.isInteger(windowId)) return;
      surfaces.set(port, {
        port,
        kind,
        tabId: tab?.id,
        windowId,
        pending: new Map(),
      });
    } else if (message.type === "NAVIGATOR_OPEN_RESULT") {
      surfaces.get(port)?.pending.get(message.requestId)?.(message);
    }
  });
  port.onDisconnect.addListener(() => {
    surfaces.get(port)?.pending.forEach((resolve) => resolve({}));
    surfaces.delete(port);
  });
}

export async function openInCurrentWorkspace(
  tab: NavigatorTab,
  path: string,
  label: string,
  preferred: boolean,
): Promise<boolean> {
  const candidates = [...surfaces.values()];
  let page = candidates.find(
    (surface) => surface.kind === "page" && surface.tabId === tab.id,
  );
  if (page) {
    const visible = await chrome.tabs
      .sendMessage(tab.id!, { type: "NAVIGATOR_PAGE_VISIBLE" })
      .catch(() => null);
    if (!visible?.visible) page = undefined;
  }
  const surface =
    page ||
    candidates.find(
      (surface) =>
        surface.kind === "panel" && surface.windowId === tab.windowId,
    );
  if (!surface) return false;
  const requestId = `navigator-${++sequence}`;
  const response = await new Promise<{ ok?: boolean; error?: string }>(
    (resolve) => {
      const timer = setTimeout(() => {
        surface.pending.delete(requestId);
        resolve({});
      }, 2000);
      surface.pending.set(requestId, (result) => {
        clearTimeout(timer);
        surface.pending.delete(requestId);
        resolve(result);
      });
      try {
        surface.port.postMessage({
          type: "NAVIGATOR_OPEN",
          requestId,
          path,
          label,
          preferred,
        });
      } catch {
        surface.pending.get(requestId)?.({});
      }
    },
  );
  if (response.ok === false)
    throw new Error(
      response.error || "Could not open this view in the current workspace.",
    );
  return response.ok === true;
}
