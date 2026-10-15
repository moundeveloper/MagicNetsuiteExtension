import { describe, it, expect } from "vitest";
import {
  applyStatePatch,
  buildDashboardStepCode,
  setStatePath,
  createDashboardService,
  dashboardCatalog,
  dashboardDiagnostics,
  executeDashboardAction,
  resolveBindings,
  validateDashboard,
  type Dashboard,
  type DashboardDefinition,
} from "../../../../shared/dashboards";
import {
  formatDashboardCell,
  reconcileSelection,
  tableRows,
} from "./tableModel";
const definition = (): DashboardDefinition => ({
  name: "batch_helper",
  title: "Batch helper",
  description: "Live batch routines",
  mode: "server",
  tags: [],
  initialState: { selected: [], filter: "" },
  components: {},
  layout: [
    {
      id: "table",
      type: "table",
      bind: "state.selected",
      props: {
        selection: "multiple",
        rowKey: "id",
        rows: { $bind: "results.load.result.rows", fallback: [] },
        columns: [{ field: "id" }, { field: "name" }],
      },
    },
  ],
  actions: [
    {
      id: "load",
      title: "Load",
      mode: "server",
      risk: "read",
      input: {},
      steps: [
        {
          id: "load",
          domain: "server",
          modules: [],
          code: 'return {rows:[{id:1,name:"Live"}]};',
        },
      ],
    },
    {
      id: "reset",
      title: "Reset",
      mode: "server",
      risk: "write",
      input: { $bind: "state.selected" },
      inputSchema: {
        type: "array",
        items: { type: "object", required: ["id"] },
      },
      steps: [
        {
          id: "reset",
          domain: "server",
          modules: [],
          code: 'return {count:input.length,setState:{selected:[],filter:""}};',
        },
      ],
    },
  ],
});
const setup = (getAccount?: () => Promise<string>) => {
  let saved: Dashboard[] = [];
  let runs = 0;
  const service = createDashboardService(
    {
      read: async () => structuredClone(saved),
      write: async (value) => {
        saved = structuredClone(value);
      },
    },
    async (_step, code) => {
      runs++;
      return new Function("runtime", code)({ accountId: "4027610_SB1" });
    },
    { getAccount },
  );
  return {
    service,
    get runs() {
      return runs;
    },
  };
};
describe("dashboard authoring and live data contract", () => {
  it("reports real prop schemas, event names, slots and risk/mode enums", async () => {
    const { service } = setup();
    const catalog = await service("catalog");
    expect(catalog.schemas.action.properties.risk.enum).toEqual([
      "read",
      "write",
    ]);
    const table = dashboardCatalog.find((c) => c.type === "table")!;
    expect(table.propsSchema.properties.selection).toBeDefined();
    expect(table.events).toContain("selectionChange");
    expect(table.slots).toContain("cell:<field>");
  });
  it("defaults to small mutation responses and omits repeated execution step outputs", async () => {
    const { service } = setup();
    const created = await service("create", { definition: definition() });
    expect(created.layout).toBeUndefined();
    expect(created.changedNodeIds).toEqual(["table"]);
    const updated = await service("update", {
      dashboardId: created.id,
      expectedRevision: 1,
      patch: { title: "Updated" },
    });
    expect(updated.changedNodeIds).toEqual([]);
    expect(JSON.stringify(updated).length).toBeLessThan(500);
    const run = await service("run", {
      dashboardId: created.id,
      expectedRevision: 2,
      actionId: "load",
      input: {},
    });
    expect(run.steps).toBeUndefined();
    expect(run.result.rows[0].name).toBe("Live");
  });
  it("patches nested named slots atomically and rejects invalid edits without changing history", async () => {
    const { service } = setup();
    const def = definition();
    def.layout = [
      {
        id: "card",
        type: "card",
        slots: {
          footer: [{ id: "footer", type: "text", props: { text: "Old" } }],
        },
      },
    ];
    const d = await service("create", { definition: def });
    await service("node", {
      dashboardId: d.id,
      expectedRevision: 1,
      operations: [
        {
          op: "upsert",
          id: "footer",
          node: { id: "footer", type: "text", props: { text: "New" } },
        },
        {
          op: "upsert",
          id: "more",
          parentId: "card",
          slot: "default",
          node: { id: "more", type: "text", props: { text: "More" } },
        },
      ],
    });
    const fresh = await service("get", { dashboardId: d.id });
    expect(fresh.layout[0].slots.footer[0].props.text).toBe("New");
    await expect(
      service("node", {
        dashboardId: d.id,
        expectedRevision: 2,
        operations: [
          { op: "remove", id: "footer" },
          { op: "upsert", id: "bad", node: { id: "bad", type: "unknown" } },
        ],
      }),
    ).rejects.toThrow();
    expect(
      (await service("get", { dashboardId: d.id })).layout[0].slots.footer,
    ).toHaveLength(1);
  });
  it("validates missing state/actions, duplicate ids and wrong mapped input types before save", async () => {
    const { service } = setup();
    const d = definition();
    d.layout.push({
      id: "table",
      type: "button",
      actionId: "missing",
      input: { $bind: "state.unknown" },
    });
    const report = await service("validate", { definition: d });
    expect(report.valid).toBe(false);
    expect(report.errors.join(" ")).toMatch(/duplicate/);
    expect(report.errors.join(" ")).toMatch(/missing state/);
    expect(report.errors.join(" ")).toMatch(/Unknown action/);
    d.layout = [
      {
        id: "reset",
        type: "button",
        actionId: "reset",
        input: { wrong: true },
      },
    ];
    expect(dashboardDiagnostics(d).errors.join(" ")).toMatch(/must be array/);
  });
  it("reconciles selected identities to fresh rows, removes absent rows and prevents frozen selection", () => {
    const old = [
      { id: 1, name: "Old" },
      { id: 2, name: "Removed" },
    ];
    const fresh = [
      { id: 1, name: "New" },
      { id: 3, name: "Added" },
    ];
    expect(reconcileSelection(fresh, old, "id", true)).toEqual([fresh[0]]);
    expect(reconcileSelection(fresh, old[1], "id", false)).toBeNull();
    expect(reconcileSelection(fresh, old[0], "id", false)).toEqual(fresh[0]);
  });
  it("sorts and filters the full data set before pagination and formats dates/numbers", () => {
    const rows = Array.from({ length: 179 }, (_, i) => ({
      id: i + 1,
      name: i % 2 ? "Odd" : "Even",
    }));
    const filtered = tableRows(
      rows,
      [{ field: "id" }, { field: "name" }],
      "",
      { name: "Even" },
      "id",
      "desc",
    );
    expect(filtered[0]!.id).toBe(179);
    expect(filtered.length).toBe(90);
    expect(
      formatDashboardCell(12.456, { format: "number", digits: 2 }),
    ).toMatch(/12[.,]46/);
    expect(formatDashboardCell("invalid", { format: "date" })).toBe("invalid");
  });
  it("preserves whole arrays, objects, null and deferred row operators", () => {
    const state = { selected: [{ id: 1 }], nullable: null };
    expect(resolveBindings({ $bind: "state" }, { state })).toEqual(state);
    expect(resolveBindings({ $bind: "state.selected" }, { state })).toEqual(
      state.selected,
    );
    expect(resolveBindings({ $bind: "state.nullable" }, { state })).toBeNull();
    const value = { $op: "length", args: [{ $bind: "item.rows" }] };
    expect(resolveBindings(value, {}, true)).toEqual(value);
    expect(resolveBindings(value, { item: { rows: [1, 2] } })).toBe(2);
  });
  it("merges returned state patches, validates paths and leaves state unchanged on invalid patches", async () => {
    const d = definition();
    const result = await executeDashboardAction(
      d,
      "reset",
      [{ id: 1 }],
      async (_step, code) => new Function(code)(),
    );
    expect(result.setState).toEqual({ selected: [], filter: "" });
    const state = { selected: [{ id: 1 }] };
    expect(() =>
      applyStatePatch(state, { selected: [], "state.constructor.bad": true }),
    ).toThrow();
    expect(state.selected).toHaveLength(1);
  });
  it("refuses account mismatches before running and checks runtime account in generated code", async () => {
    const s = setup(async () => "999_DEV");
    const d = definition();
    d.account = "4027610_SB1";
    const created = await s.service("create", { definition: d });
    await expect(
      s.service("run", {
        dashboardId: created.id,
        expectedRevision: 1,
        actionId: "load",
        input: {},
      }),
    ).rejects.toThrow("mismatch");
    expect(s.runs).toBe(0);
    const code = buildDashboardStepCode(
      d.actions[0]!.steps[0]!,
      {},
      null,
      {},
      d,
    );
    expect(() =>
      new Function("runtime", code)({ accountId: "999_DEV" }),
    ).toThrow("mismatch");
    expect(new Function("runtime", code)({ accountId: "4027610-SB1" })).toEqual(
      { rows: [{ id: 1, name: "Live" }] },
    );
  });
  it("shares helpers through code files without losing regex escapes and validates library domains", async () => {
    const d = definition();
    d.sourceFiles = {
      "lib/helpers.js": "return {digits:v=>/^\\d+$/.test(v)};",
      "actions/load.js": 'return {matched:lib.Helpers.digits("123")};',
    };
    d.libraries = {
      Helpers: { domain: "both", modules: [], codeFile: "lib/helpers.js" },
    };
    d.actions[0]!.steps[0] = {
      id: "load",
      domain: "server",
      modules: [],
      codeFile: "actions/load.js",
      libraries: ["Helpers"],
    };
    const result = await executeDashboardAction(
      d,
      "load",
      {},
      async (_step, code) => new Function(code)(),
    );
    expect(result.result).toEqual({ matched: true });
    d.libraries.Helpers!.domain = "client";
    expect(() => validateDashboard(d)).toThrow("unavailable");
  });
  it("exports/imports source and restores history as a new revision without executing actions", async () => {
    const s = setup();
    const d = await s.service("create", { definition: definition() });
    await s.service("code", {
      dashboardId: d.id,
      expectedRevision: 1,
      operation: "upsert",
      name: "actions/source.js",
      source: 'return /\\d/.test("1");',
    });
    await s.service("update", {
      dashboardId: d.id,
      expectedRevision: 2,
      patch: { title: "Changed" },
    });
    const exported = await s.service("export", { dashboardId: d.id });
    const imported = await s.service("import", {
      payload: exported,
      newName: "copy_batch",
      verbose: true,
    });
    expect(imported.sourceFiles).toEqual(exported.definition.sourceFiles);
    expect(imported.title).toBe("Changed");
    const history = await s.service("history", { dashboardId: d.id });
    expect(history.versions.map((v: any) => v.revision)).toEqual([3, 2, 1]);
    const restored = await s.service("history", {
      dashboardId: d.id,
      expectedRevision: 3,
      restoreRevision: 1,
      verbose: true,
    });
    expect(restored.revision).toBe(4);
    expect(restored.title).toBe("Batch helper");
    expect(restored.sourceFiles).toBeUndefined();
    expect(s.runs).toBe(0);
  });
  it("allows onLoad and refresh for read actions only and rejects fast/unavailable schedules", () => {
    const d = definition();
    d.onLoad = ["load"];
    d.refresh = { actionId: "load", everyMs: 1000 };
    expect(() => validateDashboard(d)).not.toThrow();
    d.onLoad = ["reset"];
    expect(() => validateDashboard(d)).toThrow("read risk");
    d.onLoad = [];
    d.refresh.everyMs = 999;
    expect(() => validateDashboard(d)).toThrow("1000");
  });
  it("composes repeat templates with scoped custom slots, validates custom props and event declarations", () => {
    const d = definition();
    d.components.Panel = {
      description: "Flexible panel",
      propsSchema: {
        type: "object",
        required: ["label"],
        properties: { label: { type: "string" } },
        additionalProperties: false,
      },
      slots: ["body"],
      events: ["change"],
      template: [
        {
          id: "body",
          type: "slot",
          props: { name: "body", scope: { label: { $bind: "props.label" } } },
        },
      ],
    };
    d.layout.push({
      id: "repeat",
      type: "repeat",
      props: { items: { $bind: "results.load.result.rows", fallback: [] } },
      children: [
        {
          id: "panel",
          type: "custom:Panel",
          props: { label: { $bind: "item.name" } },
          slots: {
            body: [
              {
                id: "label",
                type: "text",
                props: { text: { $bind: "slot.label" } },
              },
            ],
          },
        },
      ],
    });
    expect(() => validateDashboard(d)).not.toThrow();
    d.layout.push({
      id: "bad",
      type: "custom:Panel",
      props: { label: 42 },
      slots: { missing: [] },
    });
    expect(dashboardDiagnostics(d).errors.join(" ")).toMatch(
      /unknown custom slot/,
    );
    expect(dashboardDiagnostics(d).errors.join(" ")).toMatch(/must be string/);
  });
  it("writes repeated item state paths without converting arrays into objects", () => {
    const state = {
      rows: [
        { id: 1, selected: false },
        { id: 2, selected: false },
      ],
    };
    setStatePath(state, "state.rows.1.selected", true);
    expect(Array.isArray(state.rows)).toBe(true);
    expect(state.rows).toEqual([
      { id: 1, selected: false },
      { id: 2, selected: true },
    ]);
  });
});
