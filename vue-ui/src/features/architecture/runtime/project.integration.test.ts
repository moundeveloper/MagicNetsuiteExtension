// @vitest-environment jsdom
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { indexFiles, type Project, type SourceFile } from "../model";
import { executeSuiteScript } from "./engine";
import { defaultScenario, type Scenario } from "./types";

const root = process.env.MAGIC_NETSUITE_TEST_PROJECT;
describe.skipIf(!root)("real AI Agents SuiteCloud project", () => {
  let project: Project;
  function loadProject() {
    if (project) return project;
    const files: SourceFile[] = [];
    function walk(folder: string) {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) {
          if (![".git", "node_modules"].includes(entry.name)) walk(path);
        } else if (/\.(js|xml|html|json)$/i.test(entry.name))
          files.push({
            path: relative(root!, path).replace(/\\/g, "/"),
            content: readFileSync(path, "utf8"),
          });
      }
    }
    walk(join(root!, "src"));
    project = indexFiles(files);
    project.name = "AI Agents · local execution audit";
    const destination = process.env.MAGIC_NETSUITE_AUDIT_EXPORT;
    if (destination)
      writeFileSync(destination, JSON.stringify(project, null, 2));
    return project;
  }
  function request(
    filename: string,
    scenario: Partial<Scenario> = {},
    suffix = "",
  ) {
    const project = loadProject();
    const module = project.artifacts.find(
      (a) => a.path?.endsWith(`/${filename}`) && a.kind === "Module",
    )!;
    expect(module, filename).toBeDefined();
    const merged = {
      ...defaultScenario(module.metadata.scriptType),
      ...scenario,
    };
    const scenarioDir = process.env.MAGIC_NETSUITE_SCENARIO_EXPORT;
    if (scenarioDir) {
      mkdirSync(scenarioDir, { recursive: true });
      writeFileSync(
        join(scenarioDir, filename.replace(/\.js$/, `${suffix}.scenario.json`)),
        JSON.stringify(merged, null, 2) + "\n",
      );
    }
    return { project, artifactId: module.id, scenario: merged };
  }
  it("indexes all source, SDF schemas, local dependencies, template and duplicate diagnostics", () => {
    const p = loadProject();
    const source = p.artifacts.filter((a) => a.kind === "Module" && a.source);
    expect(source).toHaveLength(14);
    expect(
      p.artifacts.filter((a) => a.kind === "Script" && a.source),
    ).toHaveLength(4);
    expect(
      p.artifacts.find((a) => a.id === "customrecord_ctkc_agent_config")?.schema
        ?.length,
    ).toBeGreaterThan(10);
    expect(
      p.artifacts.some((a) =>
        a.path?.endsWith("ctkc_agent_console_template.html"),
      ),
    ).toBe(true);
    expect(
      p.diagnostics?.some((d) =>
        d.includes("Duplicate SDF object customscript_ctkc_claude_provider"),
      ),
    ).toBe(true);
    expect(p.diagnostics?.filter((d) => d.includes("unresolved AMD"))).toEqual(
      [],
    );
    const localLinks = p.relationships.filter(
      (e) => e.label === "Loads module" && e.target.startsWith("file:"),
    );
    expect(localLinks.length).toBeGreaterThanOrEqual(6);
    console.info(
      "AI_AGENTS_INDEX",
      JSON.stringify({
        sources: source.length,
        artifacts: p.artifacts.length,
        relationships: p.relationships.length,
        schemas: p.artifacts.filter((a) => a.schema?.length).length,
        fields: p.artifacts.reduce((n, a) => n + (a.schema?.length || 0), 0),
        diagnostics: p.diagnostics,
      }),
    );
  });
  it("loads every real AMD module without running entrypoints", async () => {
    for (const a of loadProject().artifacts.filter(
      (a) => a.kind === "Module" && a.source,
    )) {
      const r = await executeSuiteScript({
        project,
        artifactId: a.id,
        scenario: { ...defaultScenario(), entryPoint: "inspect" },
      });
      expect(
        { status: r.status, error: r.error, diagnostics: r.diagnostics },
        a.path,
      ).toEqual({ status: "completed", error: undefined, diagnostics: [] });
    }
  });
  it("executes real MCP tools/list and addNumbers RESTlet requests", async () => {
    const list = await executeSuiteScript(
      request("ctkc_mock_mcp_rs.js", {
        entryPoint: "post",
        input: { jsonrpc: "2.0", id: 1, method: "tools/list" },
      }),
    );
    expect((list.value as any).result.tools).toHaveLength(6);
    const add = await executeSuiteScript(
      request("ctkc_mock_mcp_rs.js", {
        entryPoint: "post",
        input: {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "addNumbers", arguments: { a: 20, b: 22 } },
        },
      }),
    );
    expect(add.status).toBe("completed");
    expect(JSON.parse((add.value as any).result.content[0].text)).toEqual({
      sum: 42,
    });
  });
  it("executes real requeue logic for retryable and exhausted records", async () => {
    const type = "customrecord_ctkc_data_to_process";
    const r = await executeSuiteScript(
      request("ctkc_dtp_requeue_ss.js", {
        records: [1, 2].map((id) => ({
          type,
          id,
          fields: {
            custrecord_ctkc_dtp_status: 2,
            custrecord_ctkc_dtp_thread_id: "dead",
          },
        })),
        queryFixtures: [
          {
            query:
              "SELECT id, custrecord_ctkc_dtp_kind AS kind, custrecord_ctkc_dtp_batch AS batch, custrecord_ctkc_dtp_attempts AS attempts, custrecord_ctkc_dtp_thread_id AS threadid FROM customrecord_ctkc_data_to_process WHERE custrecord_ctkc_dtp_status = ? AND lastmodified <= (CURRENT_DATE - (? / 1440)) ORDER BY id",
            params: [2, 15],
            rows: [
              { id: 1, attempts: 1, threadid: "dead", batch: "test" },
              { id: 2, attempts: 3, threadid: "dead", batch: "test" },
            ],
          },
        ],
      }),
    );
    expect(r.status).toBe("completed");
    expect(r.records[0]?.fields.custrecord_ctkc_dtp_status).toBe(1);
    expect(r.records[1]?.fields.custrecord_ctkc_dtp_status).toBe(4);
    expect(r.records[0]?.fields.custrecord_ctkc_dtp_thread_id).toBe("");
    expect(r.diffs).toHaveLength(2);
    expect(r.trace.reduce((n, e) => n + e.units, 0)).toBe(14);
    expect(r.logs.filter((l) => l.level === "error")).toEqual([]);
  });
  it("executes real schema-upsert Map/Reduce creation, update and cleanup", async () => {
    const type = "customrecord_ctkc_suiteql_table_schema";
    const query =
      "SELECT id FROM customrecord_ctkc_suiteql_table_schema WHERE custrecord_ctkc_sqts_table = ? FETCH FIRST 1 ROWS ONLY";
    const r = await executeSuiteScript(
      request("ctkc_suiteql_schema_upsert_mr.js", {
        entryPoint: "pipeline",
        parameters: { custscript_ctkc_sqsu_file: 77 },
        files: [
          {
            id: 77,
            path: "SuiteScripts/staged.json",
            folder: 1,
            contents: JSON.stringify([
              {
                table: "customer",
                label: "Customer",
                fields: [{ id: "id", type: "integer" }],
              },
              { table: "salesorder", label: "Sales Order", fields: [] },
            ]),
          },
        ],
        records: [
          {
            type,
            id: 1,
            fields: {
              name: "salesorder",
              custrecord_ctkc_sqts_table: "salesorder",
            },
          },
        ],
        queryFixtures: [
          { query, params: ["customer"], rows: [] },
          { query, params: ["salesorder"], rows: [{ id: 1 }] },
        ],
      }),
    );
    expect(r.status).toBe("completed");
    expect(r.logs.filter((l) => l.level === "error")).toEqual([]);
    expect(r.records.filter((r) => r.type === type)).toHaveLength(2);
    expect(
      r.records.find((r) => r.fields.name === "customer")?.fields
        .custrecord_ctkc_sqts_fieldcount,
    ).toBe(1);
    expect(r.files.some((f) => f.id === 77)).toBe(false);
    expect(r.logs.find((l) => l.title === "[summarize] done")?.details).toEqual(
      { created: 1, updated: 1, error: 0 },
    );
  });
  it("runs the real provider Suitelet through its local LLM library", async () => {
    const r = await executeSuiteScript(
      request("ctkc_netsuite_provider_sl.js", {
        entryPoint: "onRequest",
        input: {
          method: "GET",
          parameters: { action: "list_models" },
          modelFamilies: { COHERE_COMMAND_R: "cohere.command-r" },
        },
      }),
    );
    expect(r.status).toBe("completed");
    expect(r.logs.filter((l) => l.level === "error")).toEqual([]);
    expect(JSON.parse(r.response.body)).toEqual({
      models: [{ id: "COHERE_COMMAND_R", name: "Cohere Command R" }],
    });
  });
  it("launches an agent through the real Suitelet, persisting session and queued task", async () => {
    const r = await executeSuiteScript(
      request(
        "ctkc_netsuite_provider_sl.js",
        {
          entryPoint: "onRequest",
          input: {
            method: "POST",
            parameters: { action: "launch_agent" },
            body: JSON.stringify({
              agentConfigId: 7,
              title: "Local agent",
              userMessage: "Test",
            }),
          },
          selectOptions: [
            {
              recordType: "customrecord_ctkc_agent_session",
              fieldId: "custrecord_ctkc_as_status",
              value: 4,
              text: "NOT_STARTED",
            },
            {
              recordType: "customrecord_ctkc_agent_session_event",
              fieldId: "custrecord_ctkc_ase_type",
              value: 1,
              text: "netsuite.session_started",
            },
          ],
          queryFixtures: [
            {
              query:
                "SELECT name, custrecord_ctkc_ac_ai_requirement AS airequirement, custrecord_ctkc_ac_model AS model, (SELECT pv.custrecord_ctkc_pv_key FROM customrecord_ctkc_provider pv WHERE pv.id = custrecord_ctkc_ac_provider) AS provider, custrecord_ctkc_ac_system_prompt AS systemprompt, custrecord_ctkc_ac_multi_task AS multitask FROM customrecord_ctkc_agent_config WHERE id = ?",
              params: [7],
              rows: [
                {
                  name: "Local agent",
                  airequirement: 1,
                  model: "COHERE_COMMAND",
                  provider: "NETSUITE",
                  systemprompt: "",
                  multitask: "F",
                },
              ],
            },
          ],
        },
        "-launch",
      ),
    );
    expect({
      status: r.status,
      error: r.error,
      logs: r.logs.filter((l) => l.level === "error"),
    }).toEqual({ status: "completed", error: undefined, logs: [] });
    expect(JSON.parse(r.response.body)).toMatchObject({
      status: "NOT_STARTED",
      mode: "SCHEDULED",
      queued: false,
      taskId: "sim-task-1",
    });
    expect(r.tasks).toHaveLength(1);
    expect(
      r.records.find((row) => row.type === "customrecord_ctkc_agent_session")
        ?.fields.custrecord_ctkc_as_status,
    ).toBe(4);
    expect(
      r.records.find(
        (row) => row.type === "customrecord_ctkc_agent_session_event",
      ),
    ).toBeDefined();
    expect(r.diagnostics.join()).toContain("queued");
  });
});
