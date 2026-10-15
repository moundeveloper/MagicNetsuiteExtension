/** Live-data dashboard integration test against the real Vue renderer and a mock worker. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
const { chromium } = createRequire(
  new URL("../../mcp_app/package.json", import.meta.url),
)("playwright");
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
const calls = [];
let loadGeneration = 0;
const rows = () =>
  Array.from({ length: 179 }, (_, i) => ({
    id: i + 1,
    name: `Body ${i + 1}${loadGeneration > 1 ? " refreshed" : ""}`,
    amount: i + 0.123,
    status: i % 2 ? "Ready" : "Pending",
  }));
const service = createDashboardService(
  {
    read: async () => structuredClone(records),
    write: async (all) => (records = structuredClone(all)),
  },
  async (step, code) => {
    calls.push(step.id);
    if (step.id === "load") {
      loadGeneration++;
      return { rows: rows() };
    }
    return new Function(code)();
  },
);
const definition = {
  name: "batch_smoke",
  title: "Body batch",
  description: "179 live rows with selection and reusable slots",
  mode: "server",
  tags: [],
  initialState: { selected: [], filter: "retain" },
  onLoad: ["load"],
  components: {
    Panel: {
      description: "Scoped panel",
      slots: ["body"],
      propsSchema: {
        type: "object",
        required: ["label"],
        properties: { label: { type: "string" } },
      },
      template: [
        {
          id: "card",
          type: "card",
          slots: {
            default: [
              {
                id: "slot",
                type: "slot",
                props: {
                  name: "body",
                  scope: { label: { $bind: "props.label" } },
                },
              },
            ],
          },
        },
      ],
    },
  },
  layout: [
    {
      id: "table",
      type: "table",
      bind: "state.selected",
      props: {
        rows: { $bind: "results.load.result.rows", fallback: [] },
        selection: "multiple",
        pageSize: 10,
        rowKey: "id",
        columns: [
          { field: "id", label: "ID", recordType: "customer" },
          { field: "name", label: "Name" },
          { field: "amount", label: "Amount", format: "number", digits: 2 },
          { field: "status", label: "Status", format: "badge" },
        ],
      },
      slots: {
        rowActions: [
          {
            id: "rowbutton",
            type: "button",
            actionId: "inspect",
            input: { $bind: "item" },
            props: { label: "Inspect row" },
          },
        ],
      },
    },
    {
      id: "load",
      type: "button",
      actionId: "load",
      props: { label: "Reload rows" },
    },
    {
      id: "reset",
      type: "button",
      actionId: "reset",
      props: { label: "Reset selected" },
    },
    {
      id: "clear",
      type: "button",
      events: { click: { setState: { selected: [] } } },
      props: { label: "Clear with event" },
    },
    {
      id: "filter",
      type: "input",
      bind: "state.filter",
      props: { label: "Remembered input" },
    },
    {
      id: "echo",
      type: "json",
      props: { value: { $bind: "results.inspect.result", fallback: {} } },
    },
    {
      id: "repeat",
      type: "repeat",
      props: {
        items: { $bind: "results.load.result.rows", fallback: [] },
        maxItems: 2,
        keyField: "id",
      },
      children: [
        {
          id: "panel",
          type: "custom:Panel",
          props: { label: { $bind: "item.name" } },
          slots: {
            body: [
              {
                id: "text",
                type: "text",
                props: { text: { $bind: "slot.label" } },
              },
            ],
          },
        },
      ],
    },
  ],
  actions: [
    {
      id: "load",
      title: "Load bodies",
      mode: "server",
      risk: "read",
      steps: [
        { id: "load", domain: "server", modules: [], code: "return {};" },
      ],
    },
    {
      id: "inspect",
      title: "Inspect row",
      mode: "server",
      risk: "read",
      inputSchema: { type: "object", required: ["id"] },
      steps: [
        {
          id: "inspect",
          domain: "server",
          modules: [],
          code: "return {id:input.id,name:input.name};",
        },
      ],
    },
    {
      id: "reset",
      title: "Reset selected",
      mode: "server",
      risk: "write",
      input: { $bind: "state.selected" },
      inputSchema: {
        type: "array",
        items: { type: "object", required: ["id"] },
      },
      confirmation: "Reset {{input.length}} bodies?",
      successMessage: "Reset {{result.count}} bodies.",
      steps: [
        {
          id: "reset",
          domain: "server",
          modules: [],
          code: 'return {count:input.length,setState:{selected:[],filter:"reset"}};',
        },
      ],
    },
  ],
};
const created = await service("create", { definition });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 920 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.exposeFunction("testWorker", async (message) => {
  try {
    return {
      ok: true,
      result:
        message.operation === "recordUrl"
          ? "https://4027610-sb1.app.netsuite.com/app/common/entity/custjob.nl?id=" +
            message.args.recordId
          : await service(message.operation, message.args),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
await page.addInitScript(() => {
  window.openedRecord = null;
  window.open = (url) => {
    window.openedRecord = url;
  };
  const listeners = [];
  window.testRender = (id) =>
    new Promise((resolve) => {
      for (const listener of listeners)
        listener(
          { type: "DASHBOARD_RENDER_VIEW", dashboardId: id },
          {},
          resolve,
        );
    });
  const area = {
    get: async (_keys, cb) => {
      cb?.({});
      return {};
    },
    set: async () => {},
    remove: async () => {},
  };
  window.chrome = {
    storage: {
      local: area,
      sync: area,
      session: area,
      onChanged: { addListener() {}, removeListener() {} },
    },
    runtime: {
      id: "test",
      getURL: (p) => p,
      onMessage: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => {
          const i = listeners.indexOf(fn);
          if (i >= 0) listeners.splice(i, 1);
        },
      },
      sendMessage: async (message) =>
        message.type === "DASHBOARD_COMMAND" ? window.testWorker(message) : {},
    },
  };
});
try {
  await page.goto(
    `http://127.0.0.1:5174/?initialRoute=${encodeURIComponent("/dashboard/" + created.id)}&magicExecutionSurface=1`,
  );
  await page
    .locator(".table-count")
    .getByText("0 selected", { exact: true })
    .waitFor();
  await page.getByText("179 rows · page 1 / 18", { exact: true }).waitFor();
  assert.deepEqual(calls, ["load"]);
  await page.locator(".dashboard-record-link").first().click();
  await page.waitForFunction(() => Boolean(window.openedRecord));
  assert.match(
    await page.evaluate(() => window.openedRecord),
    /custjob.nl\?id=1/,
  );
  assert.ok(
    (await page.locator(".dashboard-page-toolbar").boundingBox()).height <= 60,
    "Header occupies at most 60px",
  );
  await page
    .getByRole("checkbox", { name: "Select row 1", exact: true })
    .check();
  await page
    .locator(".table-count")
    .getByText("1 selected", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Reload rows", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Select row 1", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("checkbox", { name: "Select row 1", exact: true })
      .isChecked(),
    true,
  );
  await page
    .getByRole("button", { name: "Inspect row", exact: true })
    .first()
    .click();
  await page
    .locator(".node-json")
    .getByText(/refreshed/)
    .waitFor();
  assert.match(
    await page.locator(".node-repeat").innerText(),
    /Body 1 refreshed/,
  );
  assert.match(
    await page.locator(".node-repeat").innerText(),
    /Body 2 refreshed/,
  );
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page
    .locator(".table-count")
    .getByText("179 selected", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Reset selected", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Reset 179 bodies?" }).waitFor();
  assert.equal(calls.filter((id) => id === "reset").length, 0);
  await page.getByRole("button", { name: "Run action", exact: true }).click();
  await page
    .locator(".table-count")
    .getByText("0 selected", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".node-input input").inputValue(), "reset");
  assert.match(
    await page.locator(".runtime-feedback").innerText(),
    /Reset 179 bodies/,
  );
  await page.getByRole("button", { name: "Sort by ID", exact: true }).click();
  await page.getByRole("button", { name: "Sort by ID", exact: true }).click();
  assert.equal(
    await page
      .locator(".m-table-row")
      .first()
      .locator(".m-table-cell")
      .nth(1)
      .innerText(),
    "179",
  );
  await page.getByPlaceholder("Filter Name", { exact: true }).fill("Body 179");
  assert.equal(await page.locator(".m-table-row").count(), 1);
  const rendered = await page.evaluate(
    (id) => window.testRender(id),
    created.id,
  );
  assert.equal(rendered.source, "live-view");
  assert.match(rendered.text, /179/);
  assert.equal(rendered.revision, 1);
  await page.getByRole("button", { name: "Select all", exact: true }).click();
  await page
    .locator(".table-count")
    .getByText("1 selected", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Clear with event", exact: true })
    .click();
  await page
    .locator(".table-count")
    .getByText("0 selected", { exact: true })
    .waitFor();
  assert.equal(await page.locator("select,option").count(), 0);
  assert.deepEqual(errors, []);
  // Configured polling starts in the dedicated page and stops after it closes.
  await service("update", {
    dashboardId: created.id,
    expectedRevision: 1,
    patch: { refresh: { actionId: "load", everyMs: 1000 } },
  });
  await page.evaluate(() => window.dispatchEvent(new Event('magic-dashboards-changed')));
  await page.locator('[data-dashboard-revision="2"]').waitFor();
  const beforeRefresh = loadGeneration;
  await page.waitForTimeout(1400);
  assert.ok(loadGeneration > beforeRefresh);
  const other = await service("create", {
    definition: {
      ...definition,
      name: "idle_dashboard",
      title: "Idle dashboard",
      layout: [],
      actions: [],
      components: {},
      onLoad: undefined,
      refresh: undefined,
    },
  });
  await page.goto(`http://127.0.0.1:5174/?initialRoute=${encodeURIComponent('/dashboard/' + other.id)}&magicExecutionSurface=1`);
  await page.locator('.dashboard-page-toolbar').getByText('Idle dashboard', { exact: true }).waitFor();
  const stopped = loadGeneration;
  await page.waitForTimeout(1400);
  assert.equal(loadGeneration, stopped);
  // Preview renders initial state and cannot execute the configured onLoad action.
  const before = calls.length;
  await page.goto(
    `http://127.0.0.1:5174/?initialRoute=${encodeURIComponent("/dashboards?dashboard=" + created.id + "&preview=1")}&magicExecutionSurface=1`,
  );
  await page
    .getByText("Render preview · initial state · actions paused", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Reload rows", exact: true }).click();
  assert.equal(calls.length, before);
  console.log(
    "Dashboard live-data smoke passed: 179-row selection, refresh reconciliation, row actions, state patches, scoped slots/repeat, custom confirmation, sorting/filtering, real rendered text, compact header and action-free preview.",
  );
} finally {
  if (errors.length) console.error(errors);
  await browser.close();
}
