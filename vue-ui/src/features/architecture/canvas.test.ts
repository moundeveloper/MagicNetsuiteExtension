// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { indexFiles } from "./model";
import { projectArchitecture } from "./canvas";

const source = {
  path: "SuiteScripts/main.js",
  content:
    '/** @NScriptType ScheduledScript */ define(["./lib", "N/log"], lib => ({execute: () => lib.run()}));',
};
const library = {
  path: "SuiteScripts/lib.js",
  content:
    'define(["N/record"], r => ({run: () => r.load({type:"customrecord_queue",id:1})}));',
};
const sdf = {
  path: "Objects/main.xml",
  content:
    '<scheduledscript scriptid="customscript_main"><name>Main worker</name><scriptfile>[/SuiteScripts/main.js]</scriptfile><scriptdeployments><scriptdeployment scriptid="customdeploy_main"><status>RELEASED</status></scriptdeployment></scriptdeployments></scheduledscript>',
};
describe("architectural canvas projection", () => {
  it("keeps standalone imported scripts, but hides libraries and built-in APIs", () => {
    const p = indexFiles([source, library]);
    const graph = projectArchitecture(p);
    expect(
      graph.artifacts.find((a) => a.id === "file:SuiteScripts/main.js")?.kind,
    ).toBe("Script");
    expect(graph.artifacts.some((a) => a.kind === "Module")).toBe(false);
    expect(
      p.artifacts.find((a) => a.id === "file:SuiteScripts/main.js")?.kind,
    ).toBe("Module");
  });
  it("uses the SDF script and deployment without a duplicate source node", () => {
    const graph = projectArchitecture(indexFiles([source, library, sdf]));
    expect(graph.artifacts.map((a) => a.id)).toContain("customscript_main");
    expect(graph.artifacts.map((a) => a.id)).toContain("customdeploy_main");
    expect(graph.artifacts.map((a) => a.id)).not.toContain(
      "file:SuiteScripts/main.js",
    );
    expect(graph.representatives.get("file:SuiteScripts/main.js")).toEqual(
      new Set(["customscript_main"]),
    );
    expect(
      graph.relationships.some(
        (e) =>
          e.source === "customscript_main" && e.target === "customrecord_queue",
      ),
    ).toBe(true);
  });
  it("preserves shared library effects without inventing connections between its callers", () => {
    const p = indexFiles([
      source,
      library,
      { path: "SuiteScripts/other.js", content: source.content },
    ]);
    const graph = projectArchitecture(p);
    expect(graph.representatives.get("file:SuiteScripts/lib.js")?.size).toBe(2);
    for (const id of [
      "file:SuiteScripts/main.js",
      "file:SuiteScripts/other.js",
    ])
      expect(
        graph.relationships.some(
          (e) => e.source === id && e.target === "customrecord_queue",
        ),
      ).toBe(true);
    expect(
      graph.relationships.some(
        (e) =>
          e.source === "file:SuiteScripts/main.js" &&
          e.target === "file:SuiteScripts/other.js",
      ),
    ).toBe(false);
    expect(p.relationships.every((e) => !e.id.includes(":canvas:"))).toBe(true);
  });
});
