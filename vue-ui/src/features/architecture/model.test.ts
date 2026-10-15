// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createExample, indexFiles, parseProject } from "./model";

const files = [
  {
    path: "Project/FileCabinet/SuiteScripts/order.js",
    content:
      "/** @NApiVersion 2.1 @NScriptType UserEvent */\ndefine(['N/record'], (record) => { const run = () => record.load({ type: 'salesorder', id: 123 }); return { afterSubmit: run }; });",
  },
  {
    path: "Project/Objects/customscript_order.xml",
    content:
      '<usereventscript scriptid="customscript_order"><name>Order hook</name><scriptfile>[/SuiteScripts/order.js]</scriptfile><scriptdeployments><scriptdeployment scriptid="customdeploy_order"><status>RELEASED</status><recordtype>salesorder</recordtype></scriptdeployment></scriptdeployments></usereventscript>',
  },
];

describe("architecture project persistence", () => {
  it("rejects malformed optional schemas and diagnostics before replacing a workspace", () => {
    const project = JSON.parse(JSON.stringify(createExample()));
    project.diagnostics = [123];
    expect(() => parseProject(JSON.stringify(project))).toThrow();
    project.diagnostics = [];
    project.artifacts[0].schema = [
      { id: "field", label: "Field", type: "TEXT", required: "T" },
    ];
    expect(() => parseProject(JSON.stringify(project))).toThrow();
  });
  it("round-trips the example with shared artifact IDs in architecture and trace", () => {
    const example = createExample();
    expect(parseProject(JSON.stringify(example))).toEqual(example);
    expect(
      example.trace.every((e) =>
        example.artifacts.some((a) => a.id === e.artifactId),
      ),
    ).toBe(true);
  });
  it("rejects dangling graph references and duplicate artifact IDs", () => {
    const invalid = createExample();
    invalid.relationships[0]!.target = "missing";
    expect(() => parseProject(JSON.stringify(invalid))).toThrow(
      "Invalid workbench project",
    );
    const duplicate = createExample();
    duplicate.artifacts.push(duplicate.artifacts[0]!);
    expect(() => parseProject(JSON.stringify(duplicate))).toThrow();
  });
  it("rejects invalid trace values and missing provenance", () => {
    const invalid = createExample();
    invalid.trace[0]!.units = -1;
    expect(() => parseProject(JSON.stringify(invalid))).toThrow();
    const missing = JSON.parse(JSON.stringify(createExample()));
    delete missing.relationships[0].provenance;
    expect(() => parseProject(JSON.stringify(missing))).toThrow();
  });
});

describe("local source indexing", () => {
  it("keeps script records, deployments, and source modules distinct and connected", () => {
    const project = indexFiles(files);
    expect(
      project.artifacts.find((a) => a.id === "customscript_order")?.kind,
    ).toBe("Script");
    expect(
      project.artifacts.find((a) => a.id === "customdeploy_order")?.kind,
    ).toBe("Deployment");
    expect(
      project.artifacts.filter((a) => a.id === "file:SuiteScripts/order.js"),
    ).toHaveLength(1);
    expect(project.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "customscript_order",
          target: "file:SuiteScripts/order.js",
          provenance: "SDF",
        }),
        expect.objectContaining({
          source: "customdeploy_order",
          target: "customscript_order",
          provenance: "SDF",
        }),
        expect.objectContaining({
          source: "file:SuiteScripts/order.js",
          target: "salesorder",
          provenance: "Inferred",
          line: 2,
        }),
      ]),
    );
    expect(project.trace).toEqual([]);
    expect(parseProject(JSON.stringify(project))).toEqual(project);
  });
  it("preserves manual positions and notes on re-index", () => {
    const project = indexFiles(files);
    project.artifacts[0]!.position = { x: 789, y: 456 };
    project.artifacts[0]!.description = "Keep this boundary asynchronous";
    const next = indexFiles(files, project);
    expect(next.artifacts[0]!.position).toEqual({ x: 789, y: 456 });
    expect(next.artifacts[0]!.description).toBe(
      "Keep this boundary asynchronous",
    );
  });
  it("resolves individually selected source files when the filename is unique", () => {
    const project = indexFiles([{ ...files[0]!, path: "order.js" }, files[1]!]);
    expect(project.relationships).toContainEqual(
      expect.objectContaining({
        source: "customscript_order",
        target: "file:order.js",
        label: "Loads source",
      }),
    );
    expect(
      project.artifacts.filter((a) => a.kind === "Module" && a.source),
    ).toHaveLength(1);
  });
  it("enriches a previously referenced record when its SDF definition appears", () => {
    const project = indexFiles([
      {
        path: "script.xml",
        content: files[1]!.content.replace(
          "salesorder",
          "[scriptid=customrecord_queue]",
        ),
      },
      {
        path: "record.xml",
        content:
          '<customrecordtype scriptid="customrecord_queue"><name>Integration queue</name></customrecordtype>',
      },
    ]);
    const record = project.artifacts.find((a) => a.id === "customrecord_queue");
    expect(record?.name).toBe("Integration queue");
    expect(record?.source).toContain("customrecordtype");
  });
  it("does not execute imported code", () => {
    const project = indexFiles([
      {
        path: "unsafe.js",
        content:
          "throw new Error('Never execute me'); fetch('https://example.invalid');",
      },
    ]);
    expect(project.artifacts.some((a) => a.id === "file:unsafe.js")).toBe(true);
    expect(project.trace).toHaveLength(0);
  });
  it("rejects malformed XML and unsupported-only imports", () => {
    expect(() =>
      indexFiles([{ path: "invalid.xml", content: "<usereventscript>" }]),
    ).toThrow("Invalid XML");
    expect(() => indexFiles([{ path: "readme.md", content: "hello" }])).toThrow(
      "No supported artifacts",
    );
  });
});
