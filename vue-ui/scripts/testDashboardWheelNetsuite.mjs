/** Exercise the actual content shortcut controller on a synthetic NetSuite page. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
const { chromium } = createRequire(
  new URL("../../mcp_app/package.json", import.meta.url),
)("playwright");
const bundle = await build({
  entryPoints: [
    resolve(
      import.meta.dirname,
      "../../extension-src/content/keyboard/shortcuts.ts",
    ),
  ],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "keyboardTest",
  target: "chrome109",
});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 920 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("https://123-sb1.app.netsuite.com/**", (route) =>
  route.fulfill({
    contentType: "text/html",
    body: '<html><head><title>NetSuite sandbox</title></head><body style="margin:0;background:#f3f5f8;color:#293448;font:14px system-ui"><header style="background:#24354d;color:white;padding:22px">NetSuite · 123_SB1</header><main style="padding:28px"><h1>Dashboard shortcuts</h1><p>File Cabinet · Tasks · Records</p></main></body></html>',
  }),
);
await page.goto("https://123-sb1.app.netsuite.com/app/setup/mainsetup.nl");
await page.evaluate(() => {
  const listeners = [];
  const runtimeListeners = [];
  window.probeWidget = (path, label) => new Promise(resolve => runtimeListeners.forEach(fn => fn({type: "OPEN_NAVIGATOR_WIDGET", path, label}, {}, resolve)));
  window.probeVisibleWorkspace = () => new Promise(resolve => runtimeListeners.forEach(fn => fn({type: "NAVIGATOR_PAGE_VISIBLE"}, {}, resolve)));
  window.launches = [];
  window.readCount = 0;
  window.records = [
    { id: "files", title: "File Cabinet", mode: "server" },
    { id: "jobs", title: "Batch jobs", mode: "hybrid", account: "123_SB1" },
    { id: "other", title: "Production", mode: "server", account: "123" },
    ...[
      "Record helper",
      "Script logs",
      "Task status",
      "Field inspector",
      "Deployments",
      "Search tools",
      "Queue status",
      "Alerts",
    ].map((title, index) => ({
      id: "item_" + index,
      title,
      mode: index % 2 ? "client" : "server",
    })),
  ];
  window.syncedSettings = {
    dashboardWheelShortcut: "ctrl+alt+d",
    preferredFeatures: ["/records", "/notes", "/processing", "/stale"],
  };
  window.notify = (changes, area) =>
    listeners.forEach((listener) => listener(changes, area));
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => {
          window.readCount++;
          return {
            magic_netsuite_dashboard_launch_v1: {
              files: { pinned: true, shortcut: "ctrl+alt+1" },
            },
            magic_netsuite_dashboards_v1: window.records,
          };
        },
      },
      sync: {
        get: async () => {
          window.readCount++;
          return { magic_netsuite_settings: window.syncedSettings };
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
    runtime: {
      getURL: () => 'https://123-sb1.app.netsuite.com/fake_widget.html',
      onMessage: {addListener: fn => runtimeListeners.push(fn)},
      sendMessage: async (message) => {
        window.launches.push(message);
        return { ok: true };
      },
    },
  };
});
await page.addScriptTag({ content: bundle.outputFiles[0].text });
await page.evaluate(() => keyboardTest.setupKeyboardShortcuts());
await page.waitForFunction(() => window.readCount >= 2);
const hold = async () => {
  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.keyboard.down("d");
};
const release = async () => {
  await page.keyboard.up("d");
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");
};
try {
  const visibility = await page.evaluate(async () => {
    const states = [(await window.probeVisibleWorkspace()).visible];
    const frame = document.createElement('iframe');
    frame.id = 'magic-netsuite-frame';
    frame.src = 'about:blank';
    frame.style.cssText = 'width:300px;height:200px;opacity:1;pointer-events:auto';
    document.body.appendChild(frame);
    states.push((await window.probeVisibleWorkspace()).visible);
    frame.style.pointerEvents = 'none';
    states.push((await window.probeVisibleWorkspace()).visible);
    frame.style.pointerEvents = 'auto';
    frame.src = 'about:blank?magicExecutionSurface=1';
    states.push((await window.probeVisibleWorkspace()).visible);
    frame.remove();
    return states;
  });
  assert.deepEqual(visibility, [false, true, false, false]);
  await page.mouse.move(720, 450);
  await hold();
  const wheel = page.locator("#magic-dashboard-wheel");
  await wheel.waitFor();
  assert.equal(await wheel.getByRole("option").count(), 8);
  assert.equal(
    await wheel.getByRole("option", { name: "Production" }).count(),
    0,
  );
  assert.deepEqual(await page.evaluate(() => window.launches), []);
  const hover = async (title) => {
    const icon = await wheel
      .getByRole("option", { name: title, exact: true })
      .locator(".icon")
      .boundingBox();
    await page.mouse.move(icon.x + icon.width / 2, icon.y + icon.height / 2);
    await wheel
      .locator('[aria-selected="true"]')
      .filter({ has: page.locator(".label", { hasText: title }) })
      .waitFor();
  };
  await hover("File Cabinet");
  const out = resolve(
    import.meta.dirname,
    "../node_modules/.tmp/dashboard-launch",
  );
  await mkdir(out, { recursive: true });
  await page.screenshot({
    path: resolve(out, "netsuite-dashboard-wheel.png"),
    fullPage: true,
  });
  await release();
  await page.waitForFunction(() => window.launches.length === 1);
  assert.deepEqual(await page.evaluate(() => window.launches[0]), {
    type: "OPEN_SAVED_DASHBOARD",
    dashboardId: "files",
  });
  await page.mouse.move(5, 5);
  await hold();
  const box = await wheel.locator(".wheel").boundingBox();
  assert.ok(
    Math.abs(box.x + box.width / 2 - 1365 / 2) < 1 &&
      Math.abs(box.y + box.height / 2 - 920 / 2) < 1,
    "wheel must stay centered regardless of cursor position",
  );
  await page.mouse.wheel(0, 120);
  assert.equal(await wheel.getByRole("option").count(), 4);
  await page.keyboard.press("Escape");
  await release();
  assert.equal(await page.evaluate(() => window.launches.length), 1);
  await page.keyboard.press("Control+Alt+1");
  await page.waitForFunction(() => window.launches.length === 2);
  await hold();
  await hover("Records");
  await release();
  await page.waitForFunction(() => window.launches.length === 3);
  assert.deepEqual(await page.evaluate(() => window.launches[2]), {
    type: "OPEN_PREFERRED_VIEW",
    path: "/records",
  });
  // Live preference changes must be reflected without refreshing the NetSuite page.
  await page.evaluate(() => {
    window.syncedSettings.preferredFeatures = ["/notes"];
    window.notify({ magic_netsuite_settings: {} }, "sync");
  });
  await page.waitForFunction(() => window.readCount >= 4);
  await hold();
  assert.equal(
    await wheel.getByRole("option", { name: "Records", exact: true }).count(),
    0,
  );
  assert.equal(
    await wheel.getByRole("option", { name: "Notes", exact: true }).count(),
    1,
  );
  await page.keyboard.press("Escape");
  await release();
  // Disabling the shortcut propagates to an already-open NetSuite page.
  await page.evaluate(() => {
    window.syncedSettings.dashboardWheelShortcut = "";
    window.notify({ magic_netsuite_settings: {} }, "sync");
  });
  await page.waitForFunction(() => window.readCount >= 6);
  await hold();
  assert.equal(await wheel.count(), 0);
  await release();
  // Exercise the content listener, using the same registered callback as the visibility probe.
  const widgetReply = await page.evaluate(() => window.probeWidget('/dashboard/files', 'Files'));
  assert.equal(widgetReply.ok, true);
  const sideWidgets = page.locator('#magic-dashboard-widgets');
  assert.equal(await sideWidgets.locator('.widget').count(), 1);
  await sideWidgets.getByRole('button', {name: 'Close dashboard widget'}).click();
  assert.equal(await sideWidgets.count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "NetSuite dashboard wheel passed: hold/release launch, account filtering, paging, screen centering, preferred views, cancel, direct shortcut and live settings.",
  );
} finally {
  await browser.close();
}
