import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transformSync } from "esbuild";
import { getPreferredViews } from "../../../../shared/navigationViews";
import { dashboardPath } from "../../../../shared/dashboardLaunch";
import {
  createDashboardService,
  normalizeDashboardAccount,
  type DashboardDefinition,
} from "../../../../shared/dashboards";
const source = readFileSync(
  new URL("../../../../extension-src/background.ts", import.meta.url),
  "utf8",
);
const handlerSource = source.slice(
  source.indexOf("function handleDashboardCommand("),
  source.indexOf("const CUSTOM_TOOLS_STORAGE_KEY"),
);
async function fixture(
  account = "123_SB1",
  sourceAccount = account,
  sessionPresent = true,
) {
  let records: any[] = [];
  const storage = {
    read: async () => records,
    write: async (all: any[]) => {
      records = all;
    },
  };
  const service = createDashboardService(storage, async () => null);
  const definition: DashboardDefinition = {
    name: "scoped_test",
    title: "Scoped dashboard",
    description: "",
    mode: "hybrid",
    tags: [],
    initialState: {},
    components: {},
    layout: [],
    account,
    actions: [
      {
        id: "inspect",
        title: "Inspect",
        mode: "hybrid",
        risk: "read",
        steps: [
          { id: "page", domain: "client", modules: [], code: "return {};" },
          { id: "server", domain: "server", modules: [], code: "return {};" },
        ],
      },
    ],
  };
  const created = await service("create", { definition });
  const calls: { tabId: number; action: string }[] = [];
  const context = vm.createContext({
    URL,
    Error,
    Object,
    String,
    normalizeDashboardAccount,
    createDashboardService,
    dashboardStorage: storage,
    chrome: {
      runtime: { id: "test", getURL: () => "chrome-extension://test/" },
    },
    getDashboardPreviewSessions: async () =>
      sessionPresent
        ? { window: { accountId: account, sourceTabId: 11, enablerTabId: 22 } }
        : {},
    isNetsuiteAppUrl: (url?: string) =>
      Boolean(url?.includes(".app.netsuite.com/")),
    getActiveNetsuiteTab: async () => ({
      id: 11,
      url: `https://${account.toLowerCase().replace(/_/g, "-")}.app.netsuite.com/`,
    }),
    dashboardTabsGet: async (id: number) => ({
      id,
      url: `https://${(id === 11 ? sourceAccount : account).toLowerCase().replace(/_/g, "-")}.app.netsuite.com/`,
    }),
    extractAccountIdFromUrl: (url: string) =>
      new URL(url).hostname.split(".")[0]!.toUpperCase().replace(/-/g, "_"),
    sendMessageToTab: async (tabId: number, request: { action: string }) => {
      calls.push({ tabId, action: request.action });
      return { result: { success: true } };
    },
    getRouteResult: (response: any) => response.result,
    getPreferredNetsuiteTab: async () => {
      throw new Error("UI must not use the MCP account");
    },
  });
  vm.runInContext(handlerSource, context);
  const run = (
    url = "chrome-extension://test/dist/vue-ui/index.html?magicDashboardPreview=window",
    senderId = "test",
  ) =>
    new Promise<any>((resolve) =>
      context.handleDashboardCommand({
        message: {
          operation: "run",
          args: {
            dashboardId: created.id,
            actionId: "inspect",
            expectedRevision: created.revision,
          },
        },
        sender: { id: senderId, url },
        sendResponse: resolve,
      }),
    );
  return { run, calls };
}
describe("dashboard UI execution context", () => {
  it("routes hybrid actions to the source record page and the session’s server worker", async () => {
    const { run, calls } = await fixture();
    expect(await run()).toMatchObject({ ok: true });
    expect(calls).toEqual([
      { tabId: 11, action: "RUN_QUICK_SCRIPT" },
      { tabId: 22, action: "RUN_QUICK_SCRIPT_SERVER" },
    ]);
  });
  it("refuses actions when a source page changes account", async () => {
    const { run, calls } = await fixture("123_SB1", "123");
    expect(await run()).toMatchObject({
      ok: false,
      error: expect.stringContaining("changed account"),
    });
    expect(calls).toEqual([]);
  });
  it("refuses expired sessions and non-extension senders", async () => {
    const { run, calls } = await fixture("123_SB1", "123_SB1", false);
    expect(await run()).toMatchObject({
      ok: false,
      error: expect.stringContaining("expired"),
    });
    expect(await run("https://123.app.netsuite.com/", "test")).toMatchObject({
      ok: false,
    });
    expect(calls).toEqual([]);
  });
  it("runs side-panel actions on the active NetSuite page rather than the MCP account", async () => {
    const { run, calls } = await fixture();
    expect(
      await run("chrome-extension://test/dist/vue-ui/index.html"),
    ).toMatchObject({ ok: true });
    expect(calls).toEqual([
      { tabId: 11, action: "RUN_QUICK_SCRIPT" },
      { tabId: 11, action: "RUN_QUICK_SCRIPT_SERVER" },
    ]);
  });
});

describe("launching from NetSuite", () => {
  const launchSource = transformSync(
    source.slice(
      source.indexOf("async function openNavigatorDestination("),
      source.indexOf("const switchDashboardAccount ="),
    ),
    { loader: "ts" },
  ).code;
  function launcher(
    account = "123_SB1",
    sourceAccount = "123_SB1",
    windowAccount = "123_SB1",
    existingSourceTab = 11,
    currentWorkspace = false,
  ) {
    const opened: any[] = [];
    const routes: any[] = [];
    let sessions: any = {
      window: { accountId: windowAccount, sourceTabId: existingSourceTab },
    };
    const context = vm.createContext({
      URL,
      Error,
      String,
      normalizeDashboardAccount,
      dashboardPath,
      getPreferredViews,
      dashboardPreviewOpenPromise: null,
      openInCurrentWorkspace: async () => currentWorkspace,
      isNetsuiteAppUrl: (url: string) =>
        Boolean(url?.includes(".app.netsuite.com/")),
      extractAccountIdFromUrl: () => sourceAccount,
      dashboardService: async () => ({ id: "saved", title: "Tasks", account }),
      ensureDashboardPreviewOpen: async (message: any) => {
        opened.push(message);
        return { ok: true };
      },
      getLiveDashboardPreviewSession: async () => ({
        tabId: 11,
        session: sessions.window,
      }),
      getDashboardPreviewSessions: async () => structuredClone(sessions),
      saveDashboardPreviewSessions: async (value: any) => {
        sessions = value;
      },
      chrome: {
        tabs: {
          sendMessage: async (tabId: number, message: any) => {
            if (message.type === "NAVIGATOR_WIDGET_EXISTS")
              return { exists: false };
            routes.push({ ...message, tabId });
            return { ok: true };
          },
        },
        storage: {
          sync: {
            get: async () => ({
              magic_netsuite_settings: {
                preferredFeatures: ["/notes", "/processing"],
              },
            }),
          },
        },
        runtime: {
          id: "test",
          sendMessage: async (message: any) => {
            routes.push(message);
            return { ok: true };
          },
        },
      },
    });
    vm.runInContext(launchSource, context);
    const run = (fromWidget = false) =>
      new Promise<any>((resolve) =>
        context.openSavedDashboardFromNetsuite({
          message: { dashboardId: "saved" },
          sender: {
            id: "test",
            ...(fromWidget
              ? {
                  url: "chrome-extension://test/dist/vue-ui/index.html?magicDashboardWidget=saved",
                }
              : {}),
            tab: { id: 11, url: "https://123-sb1.app.netsuite.com/" },
          },
          sendResponse: resolve,
        }),
      );
    const runView = (path = "/notes", senderId = "test") =>
      new Promise<any>((resolve) =>
        context.openPreferredViewFromNetsuite({
          message: { path },
          sender: {
            id: senderId,
            tab: { id: 11, url: "https://123-sb1.app.netsuite.com/" },
          },
          sendResponse: resolve,
        }),
      );
    return { run, runView, opened, routes, getSessions: () => sessions };
  }
  it("does not open or focus the grouped window when the current workspace accepts the launch", async () => {
    const { run, runView, opened, routes } = launcher(
      "123_SB1",
      "123_SB1",
      "123",
      11,
      true,
    );
    expect(await run()).toEqual({ ok: true });
    expect(await runView()).toEqual({ ok: true });
    expect(opened).toEqual([]);
    expect(routes).toEqual([]);
  });
  it("opens another widget when selecting from a widget, even if another workspace is open", async () => {
    const { run, routes, opened } = launcher(
      "123_SB1",
      "123_SB1",
      "123_SB1",
      11,
      true,
    );
    expect(await run(true)).toEqual({ ok: true });
    expect(routes).toMatchObject([
      { type: "OPEN_NAVIGATOR_WIDGET", tabId: 11 },
    ]);
    expect(opened).toEqual([]);
  });
  it("launches preferred views in a widget on the invoking page", async () => {
    const { runView, opened, routes } = launcher();
    expect(await runView()).toEqual({ ok: true });
    expect(opened).toEqual([]);
    expect(routes).toMatchObject([
      {
        type: "OPEN_NAVIGATOR_WIDGET",
        path: "/notes",
        label: "Notes",
        tabId: 11,
      },
    ]);
  });
  it("refuses arbitrary, internal, stale preferred routes and external senders", async () => {
    const { runView, opened } = launcher();
    for (const path of [
      "/processing",
      "/records",
      "https://example.com",
      "/notes?bad=1",
    ])
      expect(await runView(path)).toMatchObject({ ok: false });
    expect(await runView("/notes", "external")).toMatchObject({ ok: false });
    expect(opened).toEqual([]);
  });
  it("opens the saved dashboard in the matching account’s workspace", async () => {
    const { run, opened, routes } = launcher();
    expect(await run()).toEqual({ ok: true });
    expect(opened).toEqual([]);
    expect(routes[0]).toMatchObject({
      type: "OPEN_NAVIGATOR_WIDGET",
      tabId: 11,
      path: "/dashboard/saved?label=Tasks",
    });
  });
  it("refuses a bound dashboard on the wrong source account", async () => {
    const { run, opened, routes } = launcher("123_SB1", "123");
    expect(await run()).toMatchObject({
      ok: false,
      error: expect.stringContaining("tied to"),
    });
    expect(opened).toEqual([]);
    expect(routes).toEqual([]);
  });
  it("opens the widget on the invoking page without touching another account’s grouped window", async () => {
    const { run, routes, opened, getSessions } = launcher(
      "123_SB1",
      "123_SB1",
      "123",
      33,
    );
    expect(await run()).toEqual({ ok: true });
    expect(routes).toMatchObject([
      { type: "OPEN_NAVIGATOR_WIDGET", tabId: 11 },
    ]);
    expect(opened).toEqual([]);
    expect(getSessions().window.sourceTabId).toBe(33);
  });
});

describe("first dashboard window startup", () => {
  const startupSource = source.slice(
    source.indexOf("const ensureDashboardPreviewOpen ="),
    source.indexOf("const openDashboardPreview ="),
  );
  it("publishes the account and worker before a dashboard page can run onLoad", async () => {
    let sessions: any = {};
    let created = 0;
    let connectionAtMount: any;
    const context = vm.createContext({
      URL,
      Date,
      Math,
      Error,
      TAB_GROUP_ID_NONE: -1,
      DASHBOARD_TAB_TITLE: "Magic",
      DASHBOARD_ENABLER_TAB_TITLE: "Worker",
      DASHBOARD_GROUP_TITLE: "Magic",
      chrome: {
        storage: {
          sync: {
            get: async () => ({
              magic_netsuite_settings: {
                preferredFeatures: ["/notes", "/processing"],
              },
            }),
          },
        },
        runtime: {
          getURL: (path: string) => "chrome-extension://test/" + path,
        },
      },
      openExistingMagicDashboardGroup: async () => null,
      getLiveDashboardPreviewSession: async () => null,
      dashboardTabsGet: async () => ({
        id: 11,
        url: "https://123-sb1.app.netsuite.com/",
        windowId: 1,
      }),
      dashboardTabsCreate: async (options: any) => {
        created++;
        if (created === 2) {
          const session = new URL(options.url).searchParams.get(
            "magicDashboardPreview",
          );
          connectionAtMount = sessions[session!];
        }
        return { id: created === 1 ? 22 : 33 };
      },
      dashboardTabsUpdate: async () => {},
      dashboardTabsRemove: async () => {},
      buildDashboardEnablerUrl: () =>
        "https://123-sb1.app.netsuite.com/?magicDashboardEnabler=test",
      getAccountIdFromUrl: () => "123_SB1",
      waitForDashboardEnablerReady: async () => {},
      waitForTabComplete: async () => {},
      decorateDashboardPreviewTab: async () => {},
      getDashboardPreviewSessions: async () => structuredClone(sessions),
      saveDashboardPreviewSessions: async (value: any) => {
        sessions = structuredClone(value);
      },
      dashboardTabsGroup: async () => 55,
      dashboardTabGroupsUpdate: async () => {},
    });
    vm.runInContext(
      startupSource + "\nglobalThis.startup = ensureDashboardPreviewOpen;",
      context,
    );
    expect(
      await context.startup(
        { dashboardRoute: "/dashboard/saved" },
        { tab: { id: 11 } },
      ),
    ).toMatchObject({ ok: true });
    expect(connectionAtMount).toMatchObject({
      accountId: "123_SB1",
      enablerTabId: 22,
      sourceTabId: 11,
    });
    expect(Object.values(sessions)[0]).toMatchObject({
      dashboardTabId: 33,
      groupId: 55,
    });
  });
});
