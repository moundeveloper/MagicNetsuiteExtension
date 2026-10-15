import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openInCurrentWorkspace,
  registerNavigatorWorkspace,
} from "../../../../extension-src/navigationWorkspace";

const connections: Array<{ close: () => void }> = [];
afterEach(() => {
  connections.splice(0).forEach((port) => port.close());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture(visible = true) {
  const sendMessage = vi.fn(async () => ({ visible }));
  vi.stubGlobal("chrome", {
    runtime: {
      id: "test",
      getURL: (path: string) => `chrome-extension://test/${path}`,
    },
    tabs: { sendMessage },
  });
  const tab = { id: 11, windowId: 1 } as chrome.tabs.Tab;
  function surface(
    kind: "panel" | "page",
    id = 11,
    windowId = 1,
    query = "",
    acknowledge = true,
  ) {
    const listeners: Array<(message: any) => void> = [];
    const disconnect: Array<() => void> = [];
    const messages: any[] = [];
    const port = {
      sender: {
        id: "test",
        url: `chrome-extension://test/dist/vue-ui/index.html${query}`,
        ...(kind === "page" ? { tab: { id, windowId } } : {}),
      },
      onMessage: {
        addListener: (fn: (message: any) => void) => listeners.push(fn),
      },
      onDisconnect: { addListener: (fn: () => void) => disconnect.push(fn) },
      postMessage: (message: any) => {
        messages.push(message);
        if (acknowledge)
          listeners.forEach((fn) =>
            fn({
              type: "NAVIGATOR_OPEN_RESULT",
              requestId: message.requestId,
              ok: true,
            }),
          );
      },
    } as unknown as chrome.runtime.Port;
    registerNavigatorWorkspace(port);
    listeners.forEach((fn) =>
      fn({ type: "NAVIGATOR_REGISTER", kind, windowId }),
    );
    const close = () => disconnect.forEach((fn) => fn());
    connections.push({ close });
    return { messages, close };
  }
  return { surface, tab, sendMessage };
}
describe("current navigator workspace", () => {
  it("opens in the visible page workspace before its window’s side panel", async () => {
    const { surface, tab } = fixture();
    const panel = surface("panel");
    const page = surface("page");
    expect(
      await openInCurrentWorkspace(tab, "/dashboard/saved", "Tasks", false),
    ).toBe(true);
    expect(page.messages).toMatchObject([
      { path: "/dashboard/saved", label: "Tasks", preferred: false },
    ]);
    expect(panel.messages).toEqual([]);
  });
  it("uses an open side panel when the page workspace is hidden", async () => {
    const { surface, tab } = fixture(false);
    const page = surface("page");
    const panel = surface("panel");
    expect(await openInCurrentWorkspace(tab, "/notes", "Notes", true)).toBe(
      true,
    );
    expect(page.messages).toEqual([]);
    expect(panel.messages).toMatchObject([{ path: "/notes", preferred: true }]);
  });
  it("ignores workspaces on another page or in another browser window", async () => {
    const { surface, tab } = fixture();
    const page = surface("page", 22);
    const panel = surface("panel", 11, 2);
    expect(await openInCurrentWorkspace(tab, "/notes", "Notes", true)).toBe(
      false,
    );
    expect(page.messages).toEqual([]);
    expect(panel.messages).toEqual([]);
  });
  it("ignores execution workers and disconnected side panels", async () => {
    const { surface, tab } = fixture();
    const worker = surface("page", 11, 1, "?magicExecutionSurface=1");
    const group = surface("panel", 11, 1, "?magicDashboardPreview=window");
    const panel = surface("panel");
    panel.close();
    expect(await openInCurrentWorkspace(tab, "/notes", "Notes", true)).toBe(
      false,
    );
    expect(worker.messages).toEqual([]);
    expect(group.messages).toEqual([]);
  });
  it("does not hang when a workspace stops acknowledging requests", async () => {
    vi.useFakeTimers();
    const { surface, tab } = fixture();
    surface("panel", 11, 1, "", false);
    const pending = openInCurrentWorkspace(tab, "/notes", "Notes", true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBe(false);
  });
});
