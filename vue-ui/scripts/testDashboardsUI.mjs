/** Optional browser smoke test: start Vite on port 5174 first. Uses a mock worker,
 * never a real NetSuite session. Requires the existing mcp_app Playwright install. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(
  new URL("../../mcp_app/package.json", import.meta.url),
);
const { chromium } = require("playwright");
const core = await build({
  entryPoints: [resolve(import.meta.dirname, "../../shared/dashboards.ts")],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2022",
});
const { createDashboardService } = await import(
  `data:text/javascript;base64,${Buffer.from(core.outputFiles[0].text).toString("base64")}`
);
let records = [];
let runs = 0;
const service = createDashboardService(
  {
    read: async () => structuredClone(records),
    write: async (all) => {
      records = structuredClone(all);
    },
  },
  async () => {
    runs++;
    return {
      rows: [
        { id: 1, name: "invoice.js", filetype: "JAVASCRIPT" },
        { id: 2, name: "receipt.pdf", filetype: "PDF" },
      ],
    };
  },
);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 920 } });
const errors = [];
page.on("pageerror", (e) =>
  errors.push({ name: e.name, message: e.message, stack: e.stack }),
);
const commands = [];
await page.exposeFunction("dashboardTestCommand", async (message) => {
  commands.push(message.operation);
  try {
    return { ok: true, result: await service(message.operation, message.args) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
await page.addInitScript(() => {
  const listeners = [];
  const area = {
    get: async (_keys, cb) => {
      cb?.({});
      return {};
    },
    set: async () => {},
    remove: async () => {},
  };
  globalThis.chrome = {
    storage: {
      local: area,
      sync: area,
      session: area,
      onChanged: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
    },
    runtime: {
      id: "test",
      getURL: (p) => p,
      onMessage: { addListener() {}, removeListener() {} },
      sendMessage: async (message) => {
        if (message.type !== "DASHBOARD_COMMAND") return {};
        const response = await window.dashboardTestCommand(message);
        if (
          response.ok &&
          ["create", "update", "action", "delete"].includes(message.operation)
        )
          listeners.forEach((fn) =>
            fn({ magic_netsuite_dashboards_v1: {} }, "local"),
          );
        return response;
      },
    },
  };
});
try {
  await page.goto(
    process.env.DASHBOARD_UI_URL ||
      "http://127.0.0.1:5174/?initialRoute=/dashboards&magicExecutionSurface=1",
  );
  await page
    .getByRole("heading", { name: "A workspace for the work you repeat." })
    .waitFor();
  await page
    .getByRole("button", { name: "Create a dashboard", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator(".monaco-editor").waitFor();
  await page
    .getByRole("button", { name: "Create dashboard", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "File Cabinet snapshot", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector(
        ".subtle-fade-enter-active, .subtle-fade-leave-active",
      ),
  );
  assert.equal(records.length, 1);
  assert.equal(runs, 0);
  const openFull = () => page.goto(`http://127.0.0.1:5174/?initialRoute=${encodeURIComponent('/dashboard/' + records[0].id)}&magicExecutionSurface=1`);
  const openManager = () => page.goto(`http://127.0.0.1:5174/?initialRoute=${encodeURIComponent('/dashboards?dashboard=' + records[0].id)}&magicExecutionSurface=1`);
  await openFull();
  await page
    .getByRole("button", { name: "Load snapshot", exact: true })
    .click();
  await page.getByText("invoice.js", { exact: true }).waitFor();
  assert.equal(runs, 1);
  assert.equal(await page.locator(".m-table-header-cell").count(), 3);
  assert.equal(await page.locator("select, option").count(), 0);
  // Preview a custom component and ensure generated HTML cannot inject controls/scripts.
  await service("update", {
    dashboardId: records[0].id,
    expectedRevision: 1,
    patch: {
      components: {
        Counter: {
          description: "Reusable counter",
          template: [
            {
              id: "metric",
              type: "metric",
              props: {
                label: { $bind: "props.label" },
                value: { $bind: "props.value" },
              },
            },
          ],
        },
      },
      layout: [
        ...records[0].layout,
        {
          id: "counter",
          type: "custom:Counter",
          props: { label: "Ready", value: 42 },
        },
        {
          id: "markup",
          type: "richText",
          props: {
            html: "<strong>Sanitized visual</strong><script>window.injected=true</script><select><option>Bad</option></select>",
          },
        },
      ],
    },
  });
  await page.evaluate(() =>
    window.dispatchEvent(new Event("magic-dashboards-changed")),
  );
  await page.getByText("Ready", { exact: true }).waitFor();
  await page.getByText("Sanitized visual", { exact: true }).waitFor();
  assert.equal(await page.locator("select, option").count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  await page
    .getByRole("button", { name: "Load snapshot", exact: true })
    .click();
  await page.getByText("invoice.js", { exact: true }).waitFor();
  assert.equal(runs, 2);
  const out = resolve(import.meta.dirname, "../node_modules/.tmp/dashboard-ui");
  await mkdir(out, { recursive: true });
  await page.screenshot({
    path: resolve(out, "dashboard-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 480, height: 850 });
  await page.screenshot({
    path: resolve(out, "dashboard-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1365, height: 920 });
  await openManager();
  await page
    .getByRole("button", { name: "Edit dashboard", exact: true })
    .click();
  await page.getByRole("button", { name: "actions", exact: true }).click();
  // Current Monaco uses Chromium EditContext rather than a hidden textarea.
  await page
    .locator(".p-dialog .monaco-editor .view-lines")
    .click({ position: { x: 80, y: 16 } });
  await page.keyboard.press("Control+A");
  await page.keyboard.type("return { rows: [] };");
  await page
    .getByRole("button", { name: "Save dashboard", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(records[0].actions[0].steps[0].code, "return { rows: [] };");
  assert.equal(records[0].revision, 3);
  await openFull();
  await service("action", {
    dashboardId: records[0].id,
    expectedRevision: 3,
    operation: "upsert",
    action: { ...records[0].actions[0], risk: "write" },
  });
  await page.evaluate(() => window.dispatchEvent(new Event('magic-dashboards-changed')));
  await page.locator('[data-dashboard-revision="4"]').waitFor();
  await page
    .getByRole("button", { name: "Load snapshot", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Run Load snapshot?" }).waitFor();
  assert.equal(runs, 2);
  await page.getByRole("button", { name: "Run action", exact: true }).click();
  await page.getByText("invoice.js", { exact: true }).waitFor();
  assert.equal(runs, 3);
  await openManager();
  await page
    .getByRole("button", { name: "Delete dashboard", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete dashboard", exact: true })
    .last()
    .click();
  await page
    .getByRole("heading", { name: "A workspace for the work you repeat." })
    .waitFor();
  assert.equal(records.length, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Dashboard browser smoke passed: create, live results, table columns, custom components, sanitization, responsive layout, edit action code, write confirmation and delete.",
  );
  console.log(`Screenshots: ${out}`);
} catch (error) {
  console.error(
    "Browser errors:",
    errors,
    "Runs:",
    runs,
    "Commands:",
    commands,
  );
  console.error((await page.locator("body").innerText()).slice(-5000));
  const out = resolve(import.meta.dirname, "../node_modules/.tmp/dashboard-ui");
  await mkdir(out, { recursive: true });
  await page.screenshot({
    path: resolve(out, "dashboard-failure.png"),
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
