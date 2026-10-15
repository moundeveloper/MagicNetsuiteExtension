import type { Artifact, Project, TraceEvent } from "../model";
export type RecordFixture = {
  type: string;
  id: string | number;
  fields: Record<string, unknown>;
  sublists?: Record<string, Record<string, unknown>[]>;
};
export type Scenario = {
  entryPoint: string;
  context: string;
  clock: string;
  seed: number;
  parameters: Record<string, unknown>;
  user: { id: number; role: string | number; name?: string };
  records: RecordFixture[];
  files: Array<{
    id: string | number;
    path: string;
    contents: string;
    folder?: string | number;
  }>;
  input: Record<string, any>;
  selectOptions?: Array<{
    recordType: string;
    fieldId: string;
    value: string | number;
    text: string;
  }>;
  queryFixtures: Array<{
    query: string;
    params?: unknown[];
    rows: Record<string, unknown>[];
  }>;
  httpFixtures: Array<{
    url: string;
    method: string;
    code: number;
    body: string;
  }>;
  apiFixtures: Array<{
    api: string;
    args?: unknown[];
    result?: unknown;
    error?: string;
  }>;
};
export type ExecutionRequest = {
  project: Project;
  artifactId: string;
  scenario: Scenario;
};
export type RuntimeResult = {
  status: "completed" | "failed" | "unsupported" | "filtered";
  fidelity: "APPROXIMATE" | "UNIMPLEMENTED";
  behaviorPack: string;
  value?: unknown;
  error?: string;
  trace: TraceEvent[];
  logs: Array<{ level: string; title: string; details: unknown }>;
  records: RecordFixture[];
  files: Scenario["files"];
  tasks: unknown[];
  diffs: Array<{
    type: string;
    id: string | number;
    before: unknown;
    after: unknown;
  }>;
  diagnostics: string[];
  response: { body: string; headers: Record<string, string>; forms: unknown[] };
};
export function resolveSource(
  project: Project,
  artifactId: string,
): { module?: Artifact; script?: Artifact; deployment?: Artifact } {
  const artifact = project.artifacts.find((a) => a.id === artifactId);
  const deployment = artifact?.kind === "Deployment" ? artifact : undefined;
  const scriptId = deployment
    ? project.relationships.find(
        (e) => e.source === artifactId && e.label === "Executes",
      )?.target
    : artifactId;
  const script = project.artifacts.find(
    (a) => a.id === scriptId && a.kind === "Script",
  );
  const moduleId = script
    ? project.relationships.find(
        (e) => e.source === script.id && e.label === "Loads source",
      )?.target
    : artifactId;
  const module = project.artifacts.find(
    (a) => a.id === moduleId && a.kind === "Module" && a.source !== undefined,
  );
  return { module, script, deployment };
}
export function defaultScenario(scriptType = ""): Scenario {
  return {
    entryPoint: /mapreduce/i.test(scriptType)
      ? "pipeline"
      : /suitelet/i.test(scriptType)
        ? "onRequest"
        : /restlet/i.test(scriptType)
          ? "get"
          : /userevent/i.test(scriptType)
            ? "userEvent"
            : "execute",
    context: /mapreduce/i.test(scriptType)
      ? "MAPREDUCE"
      : /scheduled/i.test(scriptType)
        ? "SCHEDULED"
        : /suitelet/i.test(scriptType)
          ? "SUITELET"
          : /restlet/i.test(scriptType)
            ? "RESTLET"
            : "USERINTERFACE",
    clock: "2026-09-25T12:00:00.000Z",
    seed: 42,
    parameters: {},
    user: { id: 1, role: "ADMINISTRATOR", name: "Local test user" },
    records: [],
    files: [],
    queryFixtures: [],
    httpFixtures: [],
    apiFixtures: [],
    input: /userevent/i.test(scriptType)
      ? {
          recordType: "customrecord_local",
          eventType: "create",
          id: 1,
          values: { name: "Local test" },
        }
      : { method: "GET", parameters: {}, body: "" },
  };
}
export function parseScenario(text: string): Scenario {
  const v = JSON.parse(text);
  const object = (x: any) => x && typeof x === "object" && !Array.isArray(x);
  if (
    !object(v) ||
    typeof v.entryPoint !== "string" ||
    typeof v.context !== "string" ||
    !Number.isFinite(Date.parse(v.clock)) ||
    !Number.isFinite(v.seed) ||
    !object(v.parameters) ||
    !object(v.user) ||
    !object(v.input)
  )
    throw new Error(
      "Scenario requires entryPoint, context, valid clock/seed, parameters, user and input.",
    );
  for (const key of [
    "records",
    "files",
    "queryFixtures",
    "httpFixtures",
    "apiFixtures",
  ])
    if (!Array.isArray(v[key]))
      throw new Error(`Scenario ${key} must be an array.`);
  if (
    v.records.some(
      (r: any) =>
        !object(r) ||
        typeof r.type !== "string" ||
        r.id == null ||
        !object(r.fields),
    )
  )
    throw new Error("Each record requires type, id and fields.");
  if (
    v.files.some(
      (f: any) =>
        !object(f) ||
        f.id == null ||
        typeof f.path !== "string" ||
        typeof f.contents !== "string",
    )
  )
    throw new Error("Each file requires id, path and contents.");
  if (
    v.queryFixtures.some(
      (q: any) =>
        !object(q) || typeof q.query !== "string" || !Array.isArray(q.rows),
    )
  )
    throw new Error("Query fixtures require query text and rows.");
  if (
    v.httpFixtures.some(
      (h: any) =>
        !object(h) ||
        typeof h.url !== "string" ||
        typeof h.method !== "string" ||
        typeof h.body !== "string" ||
        !Number.isFinite(h.code),
    )
  )
    throw new Error("HTTP fixtures require url, method, code and body.");
  if (v.apiFixtures.some((a: any) => !object(a) || typeof a.api !== "string"))
    throw new Error("API fixtures require an api name.");
  if (
    v.selectOptions !== undefined &&
    (!Array.isArray(v.selectOptions) ||
      v.selectOptions.some(
        (o: any) =>
          !object(o) ||
          typeof o.recordType !== "string" ||
          typeof o.fieldId !== "string" ||
          typeof o.text !== "string" ||
          !["string", "number"].includes(typeof o.value),
      ))
  )
    throw new Error(
      "Select options require recordType, fieldId, value and text.",
    );
  return v;
}
