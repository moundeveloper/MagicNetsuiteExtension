import { parseSuiteScriptSemantics } from "../../utils/scriptDependencyDb";
import { parse } from "@babel/parser";
import type {
  Artifact,
  ArtifactKind,
  Project,
  Relationship,
  SourceFile,
} from "./model";

export function normalizeCabinetPath(path: string) {
  const clean = path.replace(/\\/g, "/").replace(/^\[|\]$/g, "");
  const cabinet = clean.includes("FileCabinet/")
    ? clean.split("FileCabinet/").pop()!
    : clean.replace(/^.*?(?=SuiteScripts\/)/, "");
  const parts: string[] = [];
  for (const part of cabinet.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

export function resolveModulePath(
  from: string,
  reference: string,
  paths: string[],
): string | undefined {
  const path = normalizeCabinetPath(
    reference.startsWith(".")
      ? `${from.slice(0, from.lastIndexOf("/") + 1)}${reference}`
      : reference,
  );
  return paths.find((p) => p === path || p === `${path}.js`);
}

export function discoverDependencies(
  source: string,
): Array<{ reference: string; line?: number }> {
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: ["typescript"],
  });
  const found: Array<{ reference: string; line?: number }> = [];
  function walk(node: any) {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      ["define", "require"].includes(node.callee.name)
    ) {
      const array = node.arguments.find(
        (arg: any) => arg.type === "ArrayExpression",
      );
      const literals =
        array?.elements ??
        (node.callee.name === "require" ? node.arguments.slice(0, 1) : []);
      for (const value of literals)
        if (value?.type === "StringLiteral")
          found.push({ reference: value.value, line: value.loc?.start.line });
    }
    for (const value of Object.values(node))
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
  }
  walk(ast.program);
  return found;
}

export function discoverProject(
  files: SourceFile[],
  previous?: Project,
): Project {
  const project: Project = {
    version: 1,
    name: "Imported SuiteCloud architecture",
    release: previous?.release ?? "2026.2",
    artifacts: [],
    relationships: [],
    trace: [],
    traceLabel: "No execution trace",
    notes: previous?.notes ?? "",
    diagnostics: [],
    scenarioText: previous?.scenarioText,
  };
  const artifacts = new Map<string, Artifact>();
  const old = new Map(previous?.artifacts.map((a) => [a.id, a]));
  const edgeIds = new Set<string>();
  const add = (
    id: string,
    name: string,
    kind: ArtifactKind,
    metadata: Record<string, string> = {},
    path?: string,
    source?: string,
  ) => {
    let a = artifacts.get(id);
    if (!a) {
      a = {
        id,
        name,
        kind,
        metadata,
        path,
        source,
        description: old.get(id)?.description ?? "",
        position: old.get(id)?.position ?? {
          x: (artifacts.size % 4) * 310,
          y: Math.floor(artifacts.size / 4) * 190,
        },
      };
      artifacts.set(id, a);
    } else if (source !== undefined) {
      Object.assign(a, {
        name,
        kind,
        path,
        source,
        metadata: { ...a.metadata, ...metadata },
      });
    }
    return a;
  };
  const link = (
    source: string,
    target: string,
    label: string,
    provenance: Relationship["provenance"],
    evidence: string,
    path?: string,
    line?: number,
  ) => {
    const id = JSON.stringify([source, target, label, line]);
    if (!edgeIds.has(id)) {
      edgeIds.add(id);
      project.relationships.push({
        id,
        source,
        target,
        label,
        provenance,
        evidence,
        path,
        line,
      });
    }
  };
  const sourceFiles = files.filter(
    (f) =>
      /\.(?:js|ts)$/i.test(f.path) &&
      !/(?:^|\/)(?:node_modules|\.git)\//.test(f.path.replace(/\\/g, "/")) &&
      !/(?:^|[\\/])suitecloud\.config\.js$/.test(f.path),
  );
  for (const f of sourceFiles) {
    const path = normalizeCabinetPath(f.path);
    add(
      `file:${path}`,
      path.split("/").pop()!,
      "Module",
      {
        scriptType: f.content.match(/@NScriptType\s+(\w+)/)?.[1] ?? "Library",
        apiVersion:
          f.content.match(/@NApiVersion\s+([\d.]+)/)?.[1] ?? "Unknown",
      },
      path,
      f.content,
    );
  }
  for (const f of files.filter(
    (f) =>
      /\.(?:html?|json|csv|txt|ftl|svg)$/i.test(f.path) &&
      /(?:FileCabinet|SuiteScripts)[\\/]/.test(f.path),
  )) {
    const path = normalizeCabinetPath(f.path);
    add(
      `file:${path}`,
      path.split("/").pop()!,
      "File",
      { fileType: path.split(".").pop()!.toUpperCase() },
      path,
      f.content,
    );
  }
  const get = (el: Element, tag: string) =>
    Array.from(el.children)
      .find((c) => c.tagName === tag)
      ?.textContent?.trim() ?? "";
  const scriptTypes: Record<string, string> = {
    usereventscript: "UserEventScript",
    clientscript: "ClientScript",
    scheduledscript: "ScheduledScript",
    mapreducescript: "MapReduceScript",
    suitelet: "Suitelet",
    restlet: "Restlet",
    workflowactionscript: "WorkflowActionScript",
    massupdatescript: "MassUpdateScript",
    portlet: "Portlet",
  };
  const definitions = new Map<string, string>();
  // Prefer canonical Objects definitions over accidental nested copies.
  for (const f of files
    .filter((f) => /\.xml$/i.test(f.path))
    .sort(
      (a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path),
    )) {
    const doc = new DOMParser().parseFromString(f.content, "application/xml");
    if (doc.querySelector("parsererror"))
      throw new Error(`Invalid XML: ${f.path}`);
    const root = doc.documentElement,
      id = root.getAttribute("scriptid");
    if (!id) continue;
    if (definitions.has(id)) {
      project.diagnostics!.push(
        `Duplicate SDF object ${id}: kept ${definitions.get(id)}; ignored ${f.path}.`,
      );
      continue;
    }
    definitions.set(id, f.path);
    const type = scriptTypes[root.tagName];
    const kind: ArtifactKind = type
      ? "Script"
      : root.tagName === "customrecordtype"
        ? "Record"
        : root.tagName === "customlist"
          ? "List"
          : root.tagName === "savedsearch"
            ? "Search"
            : root.tagName === "workflow"
              ? "Workflow"
              : root.tagName === "role"
                ? "Role"
                : "File";
    const a = add(
      id,
      get(root, "name") || get(root, "recordname") || id,
      kind,
      {
        scriptId: id,
        sdfType: root.tagName,
        ...(type ? { scriptType: type } : {}),
      },
      f.path,
      f.content,
    );
    a.schema = Array.from(
      root.querySelectorAll("customrecordcustomfield, scriptcustomfield"),
    )
      .map((field) => ({
        id: field.getAttribute("scriptid")!,
        label: get(field, "label"),
        type: get(field, "fieldtype"),
        required: get(field, "ismandatory") === "T",
        reference: get(field, "selectrecordtype") || undefined,
      }))
      .filter((field) => field.id);
    if (kind === "List")
      a.metadata.values = JSON.stringify(
        Array.from(root.querySelectorAll("customvalue")).map((v) => ({
          id: v.getAttribute("scriptid"),
          value: get(v, "value"),
        })),
      );
    if (!type) continue;
    const declared = normalizeCabinetPath(get(root, "scriptfile"));
    if (declared) {
      const exact = artifacts.get(`file:${declared}`);
      const matching = [...artifacts.values()].filter(
        (m) =>
          m.kind === "Module" &&
          m.path?.split("/").pop() === declared.split("/").pop(),
      );
      const module =
        exact ??
        (matching.length === 1
          ? matching[0]!
          : add(
              `file:${declared}`,
              declared.split("/").pop()!,
              "Module",
              { resolution: "Source missing or ambiguous" },
              declared,
            ));
      link(
        id,
        module.id,
        "Loads source",
        "SDF",
        get(root, "scriptfile"),
        f.path,
      );
      if (!module.source)
        project.diagnostics!.push(
          `${id}: source ${declared} is missing or ambiguous.`,
        );
    }
    const defaults: Record<string, string> = {};
    for (const p of Array.from(root.querySelectorAll("scriptcustomfield"))) {
      const value = get(p, "defaultvalue");
      if (value) defaults[p.getAttribute("scriptid")!] = value;
    }
    a.metadata.parameters = JSON.stringify(defaults);
    for (const d of Array.from(root.querySelectorAll("scriptdeployment"))) {
      const deploymentId = d.getAttribute("scriptid");
      if (!deploymentId) continue;
      const parameters = { ...defaults };
      for (const p of Array.from(d.children))
        if (p.tagName.startsWith("custscript"))
          parameters[p.tagName] = p.textContent?.trim() ?? "";
      add(
        deploymentId,
        get(d, "title") || deploymentId,
        "Deployment",
        {
          scriptId: id,
          status: get(d, "status"),
          recordType: get(d, "recordtype"),
          contexts: get(d, "executioncontext"),
          eventType: get(d, "eventtype"),
          deployed: get(d, "isdeployed"),
          role: get(d, "runasrole"),
          parameters: JSON.stringify(parameters),
        },
        f.path,
      );
      link(
        deploymentId,
        id,
        "Executes",
        "SDF",
        `Declared in ${f.path}`,
        f.path,
      );
      const record = get(d, "recordtype").replace(/^\[scriptid=|\]$/g, "");
      if (record) {
        add(record, record, "Record", { recordType: record });
        link(
          record,
          deploymentId,
          "Triggers",
          "SDF",
          `recordtype: ${record}`,
          f.path,
        );
      }
    }
  }
  const paths = [...artifacts.values()]
    .filter((a) => a.kind === "Module")
    .map((a) => a.path!);
  for (const f of sourceFiles) {
    const path = normalizeCabinetPath(f.path),
      id = `file:${path}`;
    let dependencies: ReturnType<typeof discoverDependencies> = [];
    try {
      dependencies = discoverDependencies(f.content);
    } catch (error) {
      project.diagnostics!.push(
        `${path}: parse error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    for (const { reference: dep, line } of dependencies) {
      const builtin = dep === "N" || dep.startsWith("N/");
      const target = builtin ? undefined : resolveModulePath(path, dep, paths);
      const targetId = target ? `file:${target}` : `reference:${dep}`;
      if (!target)
        add(targetId, dep, "Module", {
          resolution: builtin
            ? "SuiteScript API adapter"
            : "Unresolved AMD dependency",
        });
      if (!target && !builtin)
        project.diagnostics!.push(`${path}: unresolved AMD dependency ${dep}.`);
      link(
        id,
        targetId,
        "Loads module",
        "Static",
        `AMD dependency: ${dep}`,
        path,
        line,
      );
    }
    const parsed = parseSuiteScriptSemantics(f.content);
    for (const usage of parsed.recordUsage) {
      add(usage.recordType, usage.recordType, "Record", {
        recordType: usage.recordType,
      });
      link(
        id,
        usage.recordType,
        usage.operation,
        "Inferred",
        usage.evidence,
        path,
        usage.line,
      );
    }
    for (const c of parsed.connections.filter((c) => c.kind !== "module")) {
      const kind: ArtifactKind =
        c.kind === "external-http"
          ? "Integration"
          : c.kind.includes("task")
            ? "Script"
            : "Module";
      const targetId = artifacts.has(c.targetRef)
        ? c.targetRef
        : kind === "Script"
          ? c.targetRef
          : `reference:${c.targetRef}`;
      add(targetId, c.targetRef, kind, {
        resolution: "Heuristic reference; verify source",
      });
      link(id, targetId, c.kind, "Inferred", c.evidence, path, c.line);
    }
  }
  project.artifacts = [...artifacts.values()];
  if (!project.artifacts.length)
    throw new Error(
      "No supported artifacts found. Select SuiteScript .js/.ts files and SDF .xml objects.",
    );
  return project;
}
