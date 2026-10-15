import { describe, expect, it } from "vitest";
import { computed, reactive } from "vue";
import {
  createDashboardService,
  executeDashboardAction,
  readPath,
  resolveBindings,
  setStatePath,
  validateDashboard,
  type Dashboard,
  type DashboardDefinition,
} from "../../../../shared/dashboards";
const definition = (): DashboardDefinition => ({
  name: "record_helper",
  title: "Record helper",
  description: "Repeated record checks",
  mode: "hybrid",
  tags: ["records"],
  initialState: { id: 7 },
  components: {},
  layout: [
    {
      id: "run",
      type: "button",
      actionId: "inspect",
      props: { label: "Inspect" },
    },
    {
      id: "result",
      type: "json",
      props: { value: { $bind: "results.inspect.result" } },
    },
  ],
  actions: [
    {
      id: "inspect",
      title: "Inspect",
      mode: "hybrid",
      risk: "read",
      inputSchema: {
        type: "object",
        properties: { id: { type: "integer", minimum: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
      steps: [
        {
          id: "context",
          domain: "client",
          modules: ["currentRecord"],
          code: "return {id: input.id};",
        },
        {
          id: "load",
          domain: "server",
          modules: ["record"],
          code: "return {id: previous.id, contextId: steps.context.id};",
        },
      ],
    },
  ],
});
const setup = () => {
  let saved: Dashboard[] = [];
  let runs = 0;
  const service = createDashboardService(
    {
      read: async () => structuredClone(saved),
      write: async (all) => {
        saved = structuredClone(all);
      },
    },
    async () => {
      runs++;
      return { ok: true };
    },
  );
  return {
    service: (operation: string, args: Record<string, unknown> = {}) =>
      service(operation, { verbose: true, ...args }),
    get runs() {
      return runs;
    },
  };
};
describe("dynamic dashboards", () => {
  it("reactively resolves a missing result when an action completes and reacts to later state changes", () => {
    const scope = reactive<{
      state: { limit: number };
      results: Record<string, unknown>;
    }>({ state: { limit: 25 }, results: {} });
    const rows = computed(() =>
      resolveBindings(
        { $bind: "results.refresh.result.rows", fallback: [] },
        scope,
      ),
    );
    const limit = computed(() =>
      resolveBindings({ $bind: "state.limit" }, scope),
    );
    expect(rows.value).toEqual([]);
    scope.results.refresh = { result: { rows: [{ id: 7 }] } };
    expect(rows.value).toEqual([{ id: 7 }]);
    scope.state.limit = 50;
    expect(limit.value).toBe(50);
    delete scope.results.refresh;
    expect(rows.value).toEqual([]);
  });
  it("creates, updates action source and removes dashboards without implicitly executing code", async () => {
    const s = setup();
    const d = await s.service("create", { definition: definition() });
    const a = { ...d.actions[0], title: "New title" };
    const updated = await s.service("action", {
      dashboardId: d.id,
      expectedRevision: 1,
      operation: "upsert",
      action: a,
    });
    expect(updated.revision).toBe(2);
    expect(updated.actions[0].title).toBe("New title");
    expect((await s.service("list", { query: "records" }))[0].actionCount).toBe(
      1,
    );
    expect(await s.service("get", { dashboardId: d.name })).toEqual(updated);
    await s.service("delete", { dashboardId: d.id, expectedRevision: 2 });
    expect(await s.service("list")).toEqual([]);
    expect(s.runs).toBe(0);
  });
  it("serializes concurrent edits and rejects stale revisions for edits, deletes and runs", async () => {
    const { service } = setup();
    const d = await service("create", { definition: definition() });
    const edits = await Promise.allSettled([
      service("update", {
        dashboardId: d.id,
        expectedRevision: 1,
        patch: { title: "First" },
      }),
      service("update", {
        dashboardId: d.id,
        expectedRevision: 1,
        patch: { title: "Second" },
      }),
    ]);
    expect(edits.map((e) => e.status)).toEqual(["fulfilled", "rejected"]);
    await expect(
      service("delete", { dashboardId: d.id, expectedRevision: 1 }),
    ).rejects.toThrow("revision conflict");
    await expect(
      service("run", {
        dashboardId: d.id,
        expectedRevision: 1,
        actionId: "inspect",
        input: { id: 7 },
      }),
    ).rejects.toThrow("changed");
  });
  it("preserves fields in partial edits and rejects duplicate dashboard names", async () => {
    const { service } = setup();
    const d = await service("create", { definition: definition() });
    const result = await service("update", {
      dashboardId: d.id,
      expectedRevision: 1,
      patch: { description: "Changed" },
    });
    expect(result.layout).toEqual(d.layout);
    expect(result.actions).toEqual(d.actions);
    await expect(
      service("create", { definition: definition() }),
    ).rejects.toThrow("already exists");
  });
  it("rejects unavailable modules, mode conflicts, dangling actions, unsupported components and cycles", () => {
    const d = definition();
    d.actions[0]!.steps[0]!.modules = ["file"];
    expect(() => validateDashboard(d)).toThrow("unavailable");
    const modes = definition();
    modes.mode = "client";
    expect(() => validateDashboard(modes)).toThrow("conflicts");
    const missing = definition();
    missing.actions = [];
    expect(() => validateDashboard(missing)).toThrow("Unknown action");
    const unknown = definition();
    unknown.layout = [{ id: "bad", type: "script" }];
    expect(() => validateDashboard(unknown)).toThrow("Unknown component");
    const cycle = definition();
    cycle.components.Loop = {
      description: "Loop",
      template: [{ id: "loop", type: "custom:Loop" }],
    };
    expect(() => validateDashboard(cycle)).toThrow("cyclic");
    const inherited = definition();
    inherited.layout = [{ id: "bad", type: "custom:constructor" }];
    expect(() => validateDashboard(inherited)).toThrow("Unknown");
  });
  it("keeps object binding types and prevents prototype access/writes", () => {
    const rows = [{ id: 7 }];
    const scope = {
      state: { id: 7 },
      results: { inspect: { result: { rows } } },
      props: { label: "Count" },
    };
    expect(
      resolveBindings(
        {
          rows: { $bind: "results.inspect.result.rows" },
          label: { $bind: "props.label" },
        },
        scope,
      ),
    ).toEqual({ rows, label: "Count" });
    expect(
      resolveBindings({ $bind: "results.missing", fallback: [] }, scope),
    ).toEqual([]);
    expect(readPath(scope, "state.constructor")).toBeUndefined();
    expect(readPath(scope, "state.__proto__")).toBeUndefined();
    const state = {};
    expect(() =>
      setStatePath(state, "state.__proto__.polluted", true),
    ).toThrow();
    setStatePath(state, "state.filters.id", 12);
    expect(state).toEqual({ filters: { id: 12 } });
  });
  it("executes hybrid steps in order and passes prior results safely to generated code", async () => {
    const domains: string[] = [];
    const result = await executeDashboardAction(
      definition(),
      "inspect",
      { id: 7 },
      async (step, code) => {
        domains.push(step.domain);
        // A test runtime uses the same function-body contract as the NetSuite runner.
        return await new Function("currentRecord", "record", code)({}, {});
      },
    );
    expect(domains).toEqual(["client", "server"]);
    expect(result.result).toEqual({ id: 7, contextId: 7 });
    expect(result.steps.context).toEqual({ id: 7 });
  });
  it("stops after a failed hybrid step and reports possible completed writes", async () => {
    const d = definition();
    d.actions[0]!.steps.push({
      id: "last",
      domain: "server",
      modules: [],
      code: "return true;",
    });
    const calls: string[] = [];
    await expect(
      executeDashboardAction(d, "inspect", { id: 7 }, async (step) => {
        calls.push(step.id);
        if (step.id === "load") throw new Error("Permission denied");
        return { id: 7 };
      }),
    ).rejects.toThrow("Earlier steps may have completed");
    expect(calls).toEqual(["context", "load"]);
  });
  it("rejects asynchronous server results instead of silently serializing promises as empty objects", async () => {
    const d = definition();
    d.actions[0]!.steps[1]!.code = "return Promise.resolve({id: 7});";
    await expect(
      executeDashboardAction(
        d,
        "inspect",
        { id: 7 },
        async (_step, code) =>
          await new Function("currentRecord", "record", code)({}, {}),
      ),
    ).rejects.toThrow("synchronous JSON");
  });
  it("validates required inputs and numeric limits before invoking any SuiteScript", async () => {
    const s = setup();
    const d = await s.service("create", { definition: definition() });
    for (const input of [{}, { id: "7" }, { id: 0 }, { id: 7, unknown: true }])
      await expect(
        s.service("run", {
          dashboardId: d.id,
          expectedRevision: 1,
          actionId: "inspect",
          input,
        }),
      ).rejects.toThrow();
    expect(s.runs).toBe(0);
    await s.service("run", {
      dashboardId: d.id,
      expectedRevision: 1,
      actionId: "inspect",
      input: { id: 7 },
    });
    expect(s.runs).toBe(2);
  });
  it("supports reusable custom templates and validates unreferenced templates too", () => {
    const d = definition();
    d.components.Counter = {
      description: "Metric",
      template: [
        {
          id: "metric",
          type: "metric",
          props: { value: { $bind: "props.value" } },
        },
      ],
    };
    d.layout.push({
      id: "counter",
      type: "custom:Counter",
      props: { value: 42 },
    });
    expect(() => validateDashboard(d)).not.toThrow();
    d.components.Counter.template[0]!.type = "bad-component";
    expect(() => validateDashboard(d)).toThrow("Unknown component");
  });
});
