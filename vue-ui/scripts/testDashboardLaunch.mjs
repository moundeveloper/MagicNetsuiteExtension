/** Dashboard manager -> Home -> independent workspace tabs, using the real Vue UI. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
const { chromium } = createRequire(
  new URL("../../mcp_app/package.json", import.meta.url),
)("playwright");
const bundle = await build({
  entryPoints: [resolve(import.meta.dirname, "../../shared/dashboards.ts")],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2022",
});
const { createDashboardService } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const launchBundle = await build({
  entryPoints: [
    resolve(import.meta.dirname, "../../shared/dashboardLaunch.ts"),
  ],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2022",
});
const {
  DASHBOARD_LAUNCH_KEY,
  updateDashboardLaunchPreferences,
  reservedDashboardShortcuts,
} = await import(
  `data:text/javascript;base64,${Buffer.from(launchBundle.outputFiles[0].text).toString("base64")}`
);
let records = [];
const runs = [];
const service = createDashboardService(
  {
    read: async () => structuredClone(records),
    write: async (all) => {
      records = structuredClone(all);
    },
  },
  async (step) => {
    runs.push(step.id);
    return { rows: [] };
  },
);
const definition = (title) => ({
  name: title.toLowerCase(),
  title,
  description: `${title} live work`,
  mode: "server",
  tags: [],
  components: {},
  initialState: { value: title },
  onLoad: ["load"],
  ...(title === "Alpha"
    ? { refresh: { actionId: "load", everyMs: 1000 } }
    : {}),
  layout: [
    {
      id: "value",
      type: "input",
      bind: "state.value",
      props: { label: "Value" },
    },
    {
      id: "load",
      type: "button",
      actionId: "load",
      props: { label: "Load data" },
    },
  ],
  actions: [
    {
      id: "load",
      title: "Load",
      risk: "read",
      mode: "server",
      steps: [{ id: title, domain: "server", modules: [], code: "return {};" }],
    },
  ],
});
const first = await service("create", { definition: definition("Alpha") });
const second = await service("create", { definition: definition("Beta") });
const data = {
  local: {},
  sync: {
    magic_netsuite_settings: { preferredFeatures: ["/dashboards", "/records"] },
  },
  session: {
    magic_netsuite_dashboard_preview_sessions: {
      launch: { enablerTabId: 22, sourceTabId: 11, accountId: "123_SB1" },
    },
  },
};
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 920 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.exposeFunction("launchRead", (area, keys) => {
  const store = {
    ...data[area],
    ...(area === "local" ? { magic_netsuite_dashboards_v1: records } : {}),
  };
  if (!keys) return store;
  return Object.fromEntries(
    (typeof keys === "string"
      ? [keys]
      : Array.isArray(keys)
        ? keys
        : Object.keys(keys)
    ).map((key) => [key, store[key]]),
  );
});
await page.exposeFunction("launchWrite", (area, patch) => {
  Object.assign(data[area], patch);
});
await page.exposeFunction("launchCommand", async (message) => {
  try {
    if (message.type === "DASHBOARD_LAUNCH_PREFERENCES") {
      const preferences = updateDashboardLaunchPreferences(
        data.local[DASHBOARD_LAUNCH_KEY] || {},
        message.dashboardId,
        message.patch,
        records.map((d) => d.id),
        reservedDashboardShortcuts({}),
      );
      data.local[DASHBOARD_LAUNCH_KEY] = preferences;
      return { ok: true, preferences };
    }
    if (message.type === "DASHBOARD_COMMAND")
      return {
        ok: true,
        result: await service(message.operation, message.args),
      };
    if (message.type === "LIST_OPEN_NETSUITE_ACCOUNTS")
      return {
        ok: true,
        accounts: [
          { tabId: 11, accountId: "123_SB1", label: "Sandbox", current: true },
        ],
      };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});
await page.addInitScript(() => {
  const storageListeners = [];
  const runtimeListeners = [];
  const event = () => ({ addListener() {}, removeListener() {} });
  const tab = {
    id: 22,
    url: "https://123-sb1.app.netsuite.com/app/setup/mainsetup.nl?magicDashboardEnabler=launch",
    status: "complete",
  };
  const area = (name) => ({
    get: async (keys, callback) => {
      const result = await window.launchRead(name, keys);
      callback?.(result);
      return result;
    },
    set: async (patch) => {
      await window.launchWrite(name, patch);
      storageListeners.forEach((fn) =>
        fn(
          Object.fromEntries(
            Object.entries(patch).map(([key, value]) => [
              key,
              { newValue: value },
            ]),
          ),
          name,
        ),
      );
    },
    remove: async () => {},
  });
  window.launchNotify = (changes, area) =>
    storageListeners.forEach((fn) => fn(changes, area));
  window.launchRuntime = (message) =>
    runtimeListeners.forEach((fn) => fn(message, {}, () => {}));
  globalThis.chrome = {
    storage: {
      local: area("local"),
      sync: area("sync"),
      session: area("session"),
      onChanged: {
        addListener: (fn) => storageListeners.push(fn),
        removeListener: (fn) => {
          const i = storageListeners.indexOf(fn);
          if (i >= 0) storageListeners.splice(i, 1);
        },
      },
    },
    windows: { getCurrent: async () => ({ id: 1 }) },
    tabs: {
      getCurrent: async () =>
        window.self !== window.top ? { id: 11, windowId: 1 } : undefined,
      get: (_id, done) => done(tab),
      query: (_query, done) => done([tab]),
      onActivated: event(),
      onUpdated: event(),
      onRemoved: event(),
    },
    runtime: {
      id: "test",
      getURL: (p) => p,
      connect: ({ name }) => {
        if (name !== "navigatorWorkspace")
          return {
            onDisconnect: event(),
            onMessage: event(),
            disconnect() {},
            postMessage() {},
          };
        const listeners = [],
          disconnects = [];
        window.navigatorMessages = [];
        window.navigatorConnectCount = (window.navigatorConnectCount || 0) + 1;
        window.disconnectNavigator = () => disconnects.forEach((fn) => fn());
        window.launchNavigator = (message) =>
          listeners.forEach((fn) => fn(message));
        return {
          onDisconnect: { addListener: (fn) => disconnects.push(fn) },
          onMessage: { addListener: (fn) => listeners.push(fn) },
          disconnect: () => disconnects.forEach((fn) => fn()),
          postMessage: (message) => window.navigatorMessages.push(message),
        };
      },
      onMessage: {
        addListener: (fn) => runtimeListeners.push(fn),
        removeListener: (fn) => {
          const i = runtimeListeners.indexOf(fn);
          if (i >= 0) runtimeListeners.splice(i, 1);
        },
      },
      sendMessage: async (message) => {
        const result = await window.launchCommand(message);
        if (result.ok && message.type === "DASHBOARD_LAUNCH_PREFERENCES")
          window.launchNotify(
            { magic_netsuite_dashboard_launch_v1: {} },
            "local",
          );
        return result;
      },
    },
  };
});
const url = (route) =>
  `http://127.0.0.1:5174/?initialRoute=${encodeURIComponent(route)}&magicDashboardPreview=launch`;
try {
  await page.goto(url(`/dashboards?dashboard=${first.id}`));
  await page.getByRole("heading", { name: "Alpha", exact: true }).waitFor();
  assert.deepEqual(
    runs,
    [],
    "manager must not automatically execute dashboards",
  );
  await page.getByRole("button", { name: "Pin to Home", exact: true }).click();
  await page
    .getByRole("button", { name: "Unpin from Home", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Set dashboard shortcut", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Keyboard shortcut" })
    .fill("Ctrl+Alt+1");
  await page.getByRole("button", { name: "Save shortcut" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Open dashboard", exact: true })
    .click();
  const alpha = page.locator(`[data-dashboard-page="${first.id}"]`);
  await alpha.waitFor({ state: "visible" });
  await alpha.getByRole("textbox").fill("Kept Alpha state");
  await page.evaluate(
    ({ path, label }) =>
      window.dispatchEvent(
        new CustomEvent("magic-netsuite-open-dashboard-tab", {
          detail: { path, label, reuseExisting: true },
        }),
      ),
    { path: `/dashboard/${second.id}?label=Beta`, label: "Beta" },
  );
  const beta = page.locator(`[data-dashboard-page="${second.id}"]`);
  await beta.waitFor({ state: "visible" });
  await beta.getByRole("textbox").fill("Kept Beta state");
  const stopped = runs.filter((id) => id === "Alpha").length;
  await page.waitForTimeout(1200);
  assert.equal(
    runs.filter((id) => id === "Alpha").length,
    stopped,
    "inactive dashboard polling must pause",
  );
  // Every mounted dashboard must continue to resolve its own tab's route.
  assert.equal(
    await page.locator(`[data-dashboard-page="${first.id}"]`).count(),
    1,
  );
  await page.keyboard.press("Control+Alt+1");
  await alpha.waitFor({ state: "visible" });
  assert.equal(
    await alpha.getByRole("textbox").inputValue(),
    "Kept Alpha state",
  );
  assert.equal(await beta.locator("input").inputValue(), "Kept Beta state");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("magic-netsuite-open-dashboard-tab", {
        detail: { path: "/", label: "Home", reuseExisting: true },
      }),
    ),
  );
  await page
    .getByRole("button", { name: "Alpha server", exact: false })
    .waitFor();
  await page
    .getByRole("button", { name: "Alpha server", exact: false })
    .click();
  await alpha.waitFor({ state: "visible" });
  assert.equal(
    await page.locator(`[data-dashboard-page="${first.id}"]`).count(),
    1,
    "Home must reuse an existing dashboard tab",
  );
  await page.waitForFunction(async (id) => {
    const { getWorkspaceState } = await import("/src/utils/workspaceState.ts");
    const saved = await getWorkspaceState(
      "dashboard",
      "123-sb1.app.netsuite.com",
    );
    return saved?.tabs
      .find((tab) => tab.id === saved.activeTabId)
      ?.fullPath.startsWith("/dashboard/" + id);
  }, first.id);
  await page.reload();
  await page.locator(".view-tab-label").filter({ hasText: "Alpha" }).waitFor();
  await page.keyboard.press("Control+Alt+1");
  await page
    .locator(`[data-dashboard-page="${first.id}"]`)
    .waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page
    .getByRole("button", { name: "Unpin from Home", exact: true })
    .waitFor();
  assert.equal(
    data.local[DASHBOARD_LAUNCH_KEY][first.id].shortcut,
    "ctrl+alt+1",
  );
  await page.evaluate(
    (path) =>
      window.launchRuntime({
        type: "OPEN_SAVED_DASHBOARD_VIEW",
        sessionId: "launch",
        path,
        label: "Beta",
      }),
    `/dashboard/${second.id}?label=Beta`,
  );
  await page
    .locator(`[data-dashboard-page="${second.id}"]`)
    .waitFor({ state: "visible" });
  assert.equal(await page.locator("select, option").count(), 0);
  const out = resolve(
    import.meta.dirname,
    "../node_modules/.tmp/dashboard-launch",
  );
  await mkdir(out, { recursive: true });
  await page.screenshot({
    path: resolve(out, "full-dashboard.png"),
    fullPage: true,
  });
  // The radial selector uses live metadata and opens only when the gesture ends.
  await page.mouse.move(760, 460);
  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.keyboard.down("d");
  const wheel = page.locator("#magic-dashboard-wheel");
  await wheel.waitFor();
  assert.equal(await wheel.getByRole("option").count(), 4);
  const hover = async (title) => {
    const icon = await wheel
      .getByRole("option", { name: title, exact: true })
      .locator(".icon")
      .boundingBox();
    await page.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2);
    await wheel
      .locator('[aria-selected="true"]')
      .filter({ hasText: title })
      .waitFor();
  };
  const wheelBox = await wheel.locator(".wheel").boundingBox();
  assert.ok(
    Math.abs(wheelBox.x + wheelBox.width / 2 - 1365 / 2) < 1 &&
      Math.abs(wheelBox.y + wheelBox.height / 2 - 920 / 2) < 1,
  );
  await hover("Alpha");
  await beta.waitFor({ state: "visible" });
  await page.keyboard.up("d");
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");
  await alpha.waitFor({ state: "visible" });
  assert.equal(
    await page.locator(`[data-dashboard-page="${first.id}"]`).count(),
    1,
  );
  for (const [index, title] of [
    "Record helper",
    "Batch jobs",
    "Script logs",
    "Files",
    "Task status",
    "Field inspector",
    "Deployments",
  ].entries()) {
    await service("create", {
      definition: {
        name: "wheel_" + index,
        title,
        description: "",
        mode: ["client", "server", "hybrid"][index % 3],
        tags: [],
        components: {},
        layout: [],
        initialState: {},
        actions: [],
      },
    });
  }
  await page.evaluate(() =>
    window.launchNotify({ magic_netsuite_dashboards_v1: {} }, "local"),
  );
  await page.mouse.move(760, 460);
  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.keyboard.down("d");
  await wheel.waitFor();
  await hover("Records");
  await page.screenshot({
    path: resolve(out, "dashboard-wheel.png"),
    fullPage: true,
  });
  assert.equal(await wheel.getByRole("option").count(), 8);
  await page.mouse.wheel(0, 120);
  assert.equal(await wheel.getByRole("option").count(), 3);
  await page.keyboard.press("Escape");
  await page.keyboard.up("d");
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");
  await wheel.waitFor({ state: "detached" });
  await page.mouse.move(5, 5);
  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.keyboard.down("d");
  await wheel.waitFor();
  await hover("Dashboards");
  await page.keyboard.up("d");
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");
  await page
    .getByRole("button", { name: "Unpin from Home", exact: true })
    .waitFor();
  // Preferred-view messages use the existing workspace and reject arbitrary paths.
  await page.evaluate(() =>
    window.launchRuntime({
      type: "OPEN_PREFERRED_VIEW_TAB",
      sessionId: "launch",
      path: "/dashboards",
    }),
  );
  assert.equal(
    await page
      .locator(".view-tab-label")
      .filter({ hasText: /^Dashboards$/ })
      .count(),
    1,
  );
  await page.evaluate(() =>
    window.launchRuntime({
      type: "OPEN_PREFERRED_VIEW_TAB",
      sessionId: "launch",
      path: "/missing",
    }),
  );
  assert.equal(
    await page
      .locator(".view-tab-label")
      .filter({ hasText: /missing/ })
      .count(),
    0,
  );
  await service("update", {
    dashboardId: first.id,
    expectedRevision: first.revision,
    patch: { title: "Alpha renamed" },
  });
  await page.evaluate(() =>
    window.launchNotify({ magic_netsuite_dashboards_v1: {} }, "local"),
  );
  await page.keyboard.press("Control+Alt+1");
  await page
    .locator(".view-tab-label")
    .filter({ hasText: "Alpha renamed" })
    .waitFor();
  assert.equal(
    await page.locator(`[data-dashboard-page="${first.id}"]`).count(),
    1,
    "renaming must reuse the dashboard id rather than create a second tab",
  );
  // An existing side panel accepts launches directly through its scoped workspace port.
  await page.goto("http://127.0.0.1:5174/?initialRoute=%2Fdashboards");
  await page.waitForFunction(() =>
    window.navigatorMessages?.some(
      (message) =>
        message.type === "NAVIGATOR_REGISTER" &&
        message.kind === "panel" &&
        message.windowId === 1,
    ),
  );
  await page.evaluate(
    (id) =>
      window.launchNavigator({
        type: "NAVIGATOR_OPEN",
        requestId: "panel-dashboard",
        path: `/dashboard/${id}?label=Alpha`,
        label: "Alpha",
        preferred: false,
      }),
    first.id,
  );
  await page
    .locator(`[data-dashboard-page="${first.id}"]`)
    .waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    window.navigatorMessages.some(
      (message) => message.requestId === "panel-dashboard" && message.ok,
    ),
  );
  await page.evaluate(() =>
    window.launchNavigator({
      type: "NAVIGATOR_OPEN",
      requestId: "panel-view",
      path: "/dashboards",
      preferred: true,
    }),
  );
  await page
    .getByRole("button", { name: "New dashboard", exact: true })
    .first()
    .waitFor();
  assert.equal(
    await page
      .locator(".view-tab-label")
      .filter({ hasText: /^Dashboards$/ })
      .count(),
    1,
  );
  await page.evaluate(() =>
    window.launchNavigator({
      type: "NAVIGATOR_OPEN",
      requestId: "invalid",
      path: "/missing",
      preferred: true,
    }),
  );
  await page.waitForFunction(() =>
    window.navigatorMessages.some(
      (message) => message.requestId === "invalid" && message.ok === false,
    ),
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    window.launchNavigator({
      type: "NAVIGATOR_OPEN",
      requestId: "hidden-panel",
      path: "/dashboards",
      preferred: true,
    });
    delete document.visibilityState;
  });
  await page.waitForFunction(() =>
    window.navigatorMessages.some(
      (message) =>
        message.requestId === "hidden-panel" && message.ok === undefined,
    ),
  );
  await page.evaluate(() => window.disconnectNavigator());
  await page.waitForFunction(
    () =>
      window.navigatorConnectCount === 2 &&
      window.navigatorMessages.some(
        (message) => message.type === "NAVIGATOR_REGISTER",
      ),
  );
  // The page dashboard registers as an embedded surface and opens its own tab.
  await page.setContent(
    '<iframe id="workspace" src="http://127.0.0.1:5174/?initialRoute=%2Fdashboards" style="width:100%;height:850px"></iframe>',
  );
  const embedded = await page.locator("#workspace").elementHandle();
  const frame = await embedded.contentFrame();
  await frame.waitForFunction(() =>
    window.navigatorMessages?.some(
      (message) =>
        message.type === "NAVIGATOR_REGISTER" && message.kind === "page",
    ),
  );
  await frame.evaluate(
    (id) =>
      window.launchNavigator({
        type: "NAVIGATOR_OPEN",
        requestId: "page-dashboard",
        path: `/dashboard/${id}?label=Alpha`,
        label: "Alpha",
        preferred: false,
      }),
    first.id,
  );
  await frame
    .locator(`[data-dashboard-page="${first.id}"]`)
    .waitFor({ state: "visible" });
  await frame.waitForFunction(() =>
    window.navigatorMessages.some(
      (message) => message.requestId === "page-dashboard" && message.ok,
    ),
  );
  // NetSuite side widgets render the real dashboard UI, with independent tabs and a half-screen initial width.
  const widgetBundle = await build({
    entryPoints: [
      resolve(
        import.meta.dirname,
        "../../extension-src/content/ui/widgets/dashboard.ts",
      ),
    ],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "widgetTest",
    target: "chrome109",
  });
  await page.addScriptTag({ content: widgetBundle.outputFiles[0].text });
  await page.evaluate(() => {
    chrome.runtime.getURL = () => "http://127.0.0.1:5174/index.html";
  });
  await page.evaluate(
    ({ id, title }) =>
      widgetTest.openDashboardWidget(`/dashboard/${id}?label=${title}`, title),
    { id: first.id, title: "Alpha" },
  );
  const widgets = page.locator("#magic-dashboard-widgets");
  const firstWidget = widgets.locator(".widget");
  const firstFrame = await (
    await firstWidget.locator("iframe").elementHandle()
  ).contentFrame();
  await firstFrame.locator(`[data-dashboard-page="${first.id}"]`).waitFor();
  assert.equal(await firstFrame.locator(".view-tabbar:visible").count(), 1);
  assert.ok((await firstWidget.boundingBox()).width >= 1365 / 2);
  await firstFrame.getByRole("textbox").fill("Independent widget state");
  await page.evaluate(
    ({ id, title }) =>
      widgetTest.openDashboardWidget(`/dashboard/${id}?label=${title}`, title),
    { id: second.id, title: "Beta" },
  );
  assert.equal(await widgets.locator(".widget").count(), 1);
  const secondFrame = firstFrame;
  await secondFrame
    .locator(`[data-dashboard-page="${second.id}"]`)
    .waitFor({ state: "visible" });
  await secondFrame
    .locator(`[data-dashboard-page="${second.id}"]`)
    .getByRole("textbox")
    .fill("Independent Beta widget state");
  await page.evaluate(
    (id) =>
      widgetTest.openDashboardWidget(
        `/dashboard/${id}?label=Renamed`,
        "Renamed",
      ),
    first.id,
  );
  assert.equal(await widgets.locator(".widget").count(), 1);
  await firstFrame
    .locator(`[data-dashboard-page="${first.id}"]`)
    .waitFor({ state: "visible" });
  assert.equal(
    await firstFrame
      .locator(`[data-dashboard-page="${first.id}"]`)
      .getByRole("textbox")
      .inputValue(),
    "Independent widget state",
  );
  assert.equal(
    await firstFrame
      .locator(".view-tab-label")
      .filter({ hasText: "Renamed" })
      .count(),
    1,
  );
  await page.evaluate(() =>
    widgetTest.openDashboardWidget("/records", "Records"),
  );
  await firstFrame
    .locator(".view-tab-label")
    .filter({ hasText: /^Records$/ })
    .waitFor();
  assert.equal(await firstFrame.locator(".view-tab-label").count(), 3);
  await page.evaluate(
    (id) =>
      widgetTest.openDashboardWidget(`/dashboard/${id}?label=Beta`, "Beta"),
    second.id,
  );
  await firstFrame
    .locator(`[data-dashboard-page="${second.id}"]`)
    .waitFor({ state: "visible" });
  assert.equal(
    await firstFrame
      .locator(`[data-dashboard-page="${second.id}"]`)
      .getByRole("textbox")
      .inputValue(),
    "Independent Beta widget state",
  );
  assert.equal(await firstFrame.locator(".view-tab-label").count(), 3);
  await firstFrame
    .locator(".view-tab")
    .filter({ hasText: "Records" })
    .getByRole("button", { name: "Close tab" })
    .click();
  assert.equal(await firstFrame.locator(".view-tab-label").count(), 2);
  const initialWidth = (await firstWidget.boundingBox()).width;
  const handle = await firstWidget.getByRole("separator").boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x - 120, handle.y + handle.height / 2);
  await page.mouse.up();
  assert.ok((await firstWidget.boundingBox()).width > initialWidth + 100);
  await firstWidget
    .getByRole("button", { name: "Expand dashboard widget" })
    .click();
  assert.ok((await firstWidget.boundingBox()).width > 1200);
  await firstWidget.getByRole("separator").focus();
  await page.keyboard.press("Home");
  assert.ok((await firstWidget.boundingBox()).width < 370);
  await page.screenshot({
    path: resolve(out, "dashboard-side-widgets.png"),
    fullPage: true,
  });
  await firstWidget
    .getByRole("button", { name: "Close dashboard widget" })
    .click();
  assert.equal(await widgets.count(), 0);
  // Rapid selections queue until the widget is ready, including preferred views.
  await page.evaluate(
    ({ alpha, beta }) => {
      widgetTest.openDashboardWidget(
        `/dashboard/${alpha}?label=Alpha`,
        "Alpha",
      );
      widgetTest.openDashboardWidget(`/dashboard/${beta}?label=Beta`, "Beta");
      widgetTest.openDashboardWidget("/records", "Records");
    },
    { alpha: first.id, beta: second.id },
  );
  const queuedFrame = await (
    await page
      .locator("#magic-dashboard-widgets")
      .locator("iframe")
      .elementHandle()
  ).contentFrame();
  await queuedFrame
    .locator(".view-tab-label")
    .filter({ hasText: /^Records$/ })
    .waitFor();
  assert.equal(await queuedFrame.locator(".view-tab-label").count(), 3);
  assert.equal(
    await queuedFrame
      .locator(".view-tab-label")
      .filter({ hasText: /^Dashboards$/ })
      .count(),
    0,
  );
  await page
    .locator("#magic-dashboard-widgets")
    .getByRole("button", { name: "Close dashboard widget" })
    .click();
  assert.deepEqual(errors, []);
  console.log(
    "Dashboard launch smoke passed: manager, pin persistence, shortcut, Home, independent tab state, restore, NetSuite launch message and centered hold/release navigator, preferred views, pagination, existing side panel and embedded workspace routing.",
  );
} catch (error) {
  console.error(
    "UI errors:",
    errors,
    "\n",
    (await page.locator("body").innerText()).slice(-4500),
  );
  throw error;
} finally {
  await browser.close();
}
