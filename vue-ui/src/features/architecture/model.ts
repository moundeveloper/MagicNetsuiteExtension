import { discoverProject } from "./discovery";

export const artifactKinds = [
  "Record",
  "Script",
  "Deployment",
  "Module",
  "Search",
  "File",
  "Workflow",
  "Task",
  "Integration",
  "Role",
  "List",
] as const;
export type ArtifactKind = (typeof artifactKinds)[number];
export type Artifact = {
  id: string;
  name: string;
  kind: ArtifactKind;
  description: string;
  position: { x: number; y: number };
  metadata: Record<string, string>;
  source?: string;
  path?: string;
  schema?: Array<{
    id: string;
    label: string;
    type: string;
    required: boolean;
    reference?: string;
  }>;
};
export type Relationship = {
  id: string;
  source: string;
  target: string;
  label: string;
  provenance: "Static" | "SDF" | "Manual" | "Inferred" | "Observed";
  evidence: string;
  path?: string;
  line?: number;
};
export type TraceEvent = {
  id: string;
  artifactId: string;
  label: string;
  detail: string;
  context: string;
  role: string;
  units: number;
  at: number;
};
export type Project = {
  version: 1;
  name: string;
  release: string;
  artifacts: Artifact[];
  relationships: Relationship[];
  trace: TraceEvent[];
  traceLabel: string;
  notes: string;
  diagnostics?: string[];
  scenarioText?: string;
};

export function createExample(): Project {
  const rows: [
    string,
    string,
    ArtifactKind,
    number,
    number,
    Record<string, string>,
  ][] = [
    [
      "salesorder",
      "Sales Order",
      "Record",
      0,
      160,
      { recordType: "salesorder", fixture: "Order #123 · approved" },
    ],
    [
      "ue-deploy",
      "Order approval deployment",
      "Deployment",
      310,
      160,
      {
        scriptId: "customdeploy_so_approval",
        status: "RELEASED",
        context: "REST_WEBSERVICES, USER_INTERFACE",
        events: "EDIT, XEDIT",
      },
    ],
    [
      "ue",
      "Order approval",
      "Script",
      620,
      160,
      {
        scriptId: "customscript_so_approval",
        scriptType: "UserEvent",
        entryPoints: "beforeSubmit, afterSubmit",
        apiVersion: "2.1",
      },
    ],
    [
      "mr-deploy",
      "3PL export deployment",
      "Deployment",
      930,
      160,
      {
        scriptId: "customdeploy_3pl_export",
        status: "RELEASED",
        concurrency: "2",
      },
    ],
    [
      "mr",
      "Export approved orders",
      "Script",
      1240,
      160,
      {
        scriptId: "customscript_3pl_export",
        scriptType: "MapReduce",
        entryPoints: "getInputData, map, reduce, summarize",
      },
    ],
    [
      "search",
      "Eligible orders",
      "Search",
      1240,
      -40,
      { scriptId: "customsearch_3pl_orders", recordType: "salesorder" },
    ],
    [
      "queue",
      "Integration queue",
      "Record",
      1550,
      50,
      {
        recordType: "customrecord_integration_queue",
        fields: "order, status, idempotency_key",
      },
    ],
    [
      "api",
      "3PL mock API",
      "Integration",
      1550,
      270,
      {
        transport: "HTTPS mock",
        network: "DENY_ALL",
        response: "503 · service unavailable",
      },
    ],
  ];
  const links: [string, string, string, Relationship["provenance"], string][] =
    [
      [
        "salesorder",
        "ue-deploy",
        "Triggers",
        "SDF",
        "Example deployment applies to Sales Orders on EDIT and XEDIT.",
      ],
      [
        "ue-deploy",
        "ue",
        "Executes",
        "SDF",
        "Example script record owns this deployment.",
      ],
      [
        "ue",
        "mr-deploy",
        "Submits task",
        "Static",
        "task.create({ taskType: task.TaskType.MAP_REDUCE, scriptId: 'customscript_3pl_export', deploymentId: 'customdeploy_3pl_export' })",
      ],
      [
        "mr-deploy",
        "mr",
        "Executes",
        "SDF",
        "Example Map/Reduce script owns this deployment.",
      ],
      [
        "mr",
        "search",
        "Searches",
        "Static",
        "search.load({ id: 'customsearch_3pl_orders' })",
      ],
      [
        "mr",
        "queue",
        "Writes record",
        "Static",
        "record.create({ type: 'customrecord_integration_queue' })",
      ],
      [
        "mr",
        "api",
        "HTTP request",
        "Static",
        "https.post({ url: MOCK_ENDPOINT, body: payload })",
      ],
    ];
  const steps: [string, string, string, number][] = [
    [
      "salesorder",
      "REST write received",
      "Example fixture: Sales Order #123 approved.",
      0,
    ],
    [
      "ue-deploy",
      "Deployment matched",
      "Example context and event filters match this request.",
      0,
    ],
    ["ue", "beforeSubmit", "Example validation checks the approval flag.", 0],
    [
      "salesorder",
      "Record committed",
      "Example record version advances from 41 to 42.",
      0,
    ],
    ["ue", "afterSubmit", "Example task submission queues the export job.", 20],
    [
      "mr-deploy",
      "Task queued",
      "Example task sim-88 is ready for processing.",
      0,
    ],
    ["mr", "getInputData", "Example job loads eligible orders.", 5],
    [
      "queue",
      "Queue record saved",
      "Example queue entry stores order 123 and its idempotency key.",
      4,
    ],
    [
      "api",
      "Mock response: 503",
      "Example endpoint fails. Verify idempotency before retrying side effects.",
      10,
    ],
  ];
  return {
    version: 1,
    name: "Push approved orders to 3PL",
    release: "2026.2",
    artifacts: rows.map(([id, name, kind, x, y, metadata]) => ({
      id,
      name,
      kind,
      position: { x, y },
      metadata,
      description:
        "Illustrative architecture from the workbench specification.",
    })),
    relationships: links.map(
      ([source, target, label, provenance, evidence], i) => ({
        id: `edge-${i}`,
        source,
        target,
        label,
        provenance,
        evidence,
      }),
    ),
    trace: steps.map(([artifactId, label, detail, units], i) => ({
      id: `event-${i}`,
      artifactId,
      label,
      detail,
      units,
      at: i * 100,
      context: i < 6 ? "REST_WEBSERVICES" : "MAP_REDUCE",
      role: "Integration role (example)",
    })),
    traceLabel: "Illustrative trace · APPROXIMATE · no source executed",
    notes:
      "Keep the export asynchronous. Store an idempotency key before retrying the 3PL request. This example illustrates the architecture; it does not validate NetSuite behavior.",
  };
}

/** Validate the complete envelope before replacing the user's current workspace. */
export function parseProject(text: string): Project {
  const value = JSON.parse(text);
  const fail = (): never => {
    throw new Error(
      "Invalid workbench project. Expected a version 1 project with valid artifacts, relationships and trace events.",
    );
  };
  const str = (x: unknown): x is string => typeof x === "string";
  if (
    !value ||
    value.version !== 1 ||
    !str(value.name) ||
    !str(value.release) ||
    !str(value.notes) ||
    !str(value.traceLabel) ||
    !Array.isArray(value.artifacts) ||
    !Array.isArray(value.relationships) ||
    !Array.isArray(value.trace) ||
    (value.scenarioText !== undefined && !str(value.scenarioText)) ||
    (value.diagnostics !== undefined &&
      (!Array.isArray(value.diagnostics) || !value.diagnostics.every(str)))
  )
    return fail();
  if (
    value.artifacts.length > 10000 ||
    value.relationships.length > 50000 ||
    value.trace.length > 50000
  )
    throw new Error(
      "Project exceeds the import limit (10,000 artifacts or 50,000 relationships/events).",
    );
  const ids = new Set<string>();
  for (const a of value.artifacts) {
    if (
      !a ||
      !str(a.id) ||
      !a.id ||
      ids.has(a.id) ||
      !str(a.name) ||
      !artifactKinds.includes(a.kind) ||
      !str(a.description) ||
      !Number.isFinite(a.position?.x) ||
      !Number.isFinite(a.position?.y) ||
      !a.metadata ||
      typeof a.metadata !== "object" ||
      Array.isArray(a.metadata) ||
      !Object.values(a.metadata).every(str) ||
      (a.source !== undefined && !str(a.source)) ||
      (a.path !== undefined && !str(a.path)) ||
      (a.schema !== undefined &&
        (!Array.isArray(a.schema) ||
          a.schema.some(
            (f: any) =>
              !f ||
              !str(f.id) ||
              !str(f.label) ||
              !str(f.type) ||
              typeof f.required !== "boolean" ||
              (f.reference !== undefined && !str(f.reference)),
          )))
    )
      return fail();
    ids.add(a.id);
  }
  const edgeIds = new Set<string>();
  for (const e of value.relationships) {
    if (
      !e ||
      !str(e.id) ||
      edgeIds.has(e.id) ||
      !ids.has(e.source) ||
      !ids.has(e.target) ||
      !str(e.label) ||
      !str(e.evidence) ||
      !["Static", "SDF", "Manual", "Inferred", "Observed"].includes(
        e.provenance,
      ) ||
      (e.path !== undefined && !str(e.path)) ||
      (e.line !== undefined && (!Number.isInteger(e.line) || e.line < 1))
    )
      return fail();
    edgeIds.add(e.id);
  }
  const eventIds = new Set<string>();
  for (const e of value.trace) {
    if (
      !e ||
      !str(e.id) ||
      eventIds.has(e.id) ||
      !ids.has(e.artifactId) ||
      !str(e.label) ||
      !str(e.detail) ||
      !str(e.context) ||
      !str(e.role) ||
      !Number.isFinite(e.units) ||
      e.units < 0 ||
      !Number.isFinite(e.at) ||
      e.at < 0
    )
      return fail();
    eventIds.add(e.id);
  }
  return value as Project;
}

export type SourceFile = { path: string; content: string };
/** Conservative discovery: heuristic source references are explicitly inferred, never runtime facts. */
export function indexFiles(files: SourceFile[], previous?: Project): Project {
  return discoverProject(files, previous);
}
