import Dexie, { type EntityTable } from "dexie";

export type ScriptDependencyNode = {
  key: string;
  environment: string;
  scriptInternalId: number;
  scriptId: string;
  name: string;
  scriptType: string;
  nodeType?: "script" | "client-file" | "html-file";
  fileName: string;
  fileId: number | null;
  imports: string[];
  resolvedDependencies: string[];
  unresolvedDependencies: string[];
  connections: ScriptConnection[];
  recordUsage: RecordUsage[];
  source?: string;
  scannedAt: number;
};

export type ScriptConnectionKind =
  | "module"
  | "client-script"
  | "html-file"
  | "scheduled-task"
  | "map-reduce-task"
  | "suitelet"
  | "restlet"
  | "external-http";

export type ScriptConnection = {
  kind: ScriptConnectionKind;
  targetRef: string;
  deploymentRef?: string;
  targetKey?: string;
  confidence: "exact" | "unresolved";
  evidence: string;
  line?: number;
};

export type RecordOperation =
  | "load"
  | "create"
  | "submitFields"
  | "delete"
  | "transform"
  | "copy"
  | "search"
  | "lookup"
  | "suiteql";

export type RecordUsage = {
  recordType: string;
  operation: RecordOperation;
  evidence: string;
  line?: number;
};

export type DependencyScanMeta = {
  environment: string;
  scannedAt: number;
  scriptCount: number;
  fileCount: number;
};

const db = new Dexie("MagicNetsuiteDependencyExplorer") as Dexie & {
  nodes: EntityTable<ScriptDependencyNode, "key">;
  scans: EntityTable<DependencyScanMeta, "environment">;
};

db.version(1).stores({
  nodes: "&key, environment, scriptInternalId, scriptId, fileName, scannedAt",
  scans: "&environment, scannedAt"
});

export const dependencyNodeKey = (
  environment: string,
  scriptInternalId: number
) => `${environment}::${scriptInternalId}`;

const BUILTIN_PREFIXES = ["N/", "SuiteScripts/", "/", "./", "../"];

export const parseSuiteScriptDependencies = (source: string): string[] => {
  const imports = new Set<string>();
  const add = (value: string) => {
    const clean = value.trim();
    if (clean) imports.add(clean);
  };

  for (const match of source.matchAll(
    /\b(?:define|require)\s*\(\s*\[([\s\S]*?)\]/g
  )) {
    const body = match[1] ?? "";
    for (const item of body.matchAll(/["'`]([^"'`]+)["'`]/g)) {
      add(item[1] ?? "");
    }
  }

  for (const match of source.matchAll(
    /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g
  )) {
    add(match[1] ?? "");
  }

  for (const match of source.matchAll(
    /\b(?:import|export)\b[\s\S]*?\bfrom\s*["'`]([^"'`]+)["'`]/g
  )) {
    add(match[1] ?? "");
  }

  for (const match of source.matchAll(/\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    add(match[1] ?? "");
  }

  return [...imports];
};

const normalizePath = (value: string) =>
  value
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\.(?:js|ts)$/i, "")
    .toLowerCase();

const basename = (value: string) =>
  normalizePath(value).split("/").filter(Boolean).pop() ?? "";

const lineNumberAt = (source: string, index: number) =>
  source.slice(0, Math.max(0, index)).split("\n").length;

type ModuleBindings = Record<string, Set<string>>;

const parseModuleBindings = (source: string): ModuleBindings => {
  const bindings: ModuleBindings = {};
  const register = (modulesBody: string, parametersBody: string) => {
    const modules = [...modulesBody.matchAll(/["'`]([^"'`]+)["'`]/g)].map(
      (match) => match[1] ?? ""
    );
    const parameters = parametersBody
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[A-Za-z_$][\w$]*$/.test(value));
    modules.forEach((moduleName, index) => {
      const parameter = parameters[index];
      if (!parameter) return;
      (bindings[moduleName] ??= new Set()).add(parameter);
    });
  };

  for (const match of source.matchAll(
    /\b(?:define|require)\s*\(\s*\[([\s\S]*?)\]\s*,\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*(?:\n|$))\s*)*(?:function\s*\(([^)]*)\)|\(([^)]*)\)\s*=>|([A-Za-z_$][\w$]*)\s*=>)/g
  )) {
    register(match[1] ?? "", match[2] ?? match[3] ?? match[4] ?? "");
  }
  return bindings;
};

const parseStringConstants = (source: string) => {
  const constants = new Map<string, string>();
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]([^"'`]+)["'`]\s*;?/g
  )) {
    constants.set(match[1] ?? "", match[2] ?? "");
  }
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{([\s\S]*?)\}\s*;?/g
  )) {
    const objectName = match[1] ?? "";
    for (const property of (match[2] ?? "").matchAll(
      /\b([A-Za-z_$][\w$]*)\s*:\s*["'`]([^"'`]+)["'`]/g
    )) {
      constants.set(`${objectName}.${property[1]}`, property[2] ?? "");
    }
  }
  return constants;
};

const parseExpressionCandidates = (source: string) => {
  const candidates = new Map<string, Set<string>>();
  const add = (name: string, value: string) => {
    const cleanName = name.trim();
    const cleanValue = value.trim();
    if (!cleanName || !cleanValue) return;
    (candidates.get(cleanName) ?? new Set<string>()).add(cleanValue);
    if (!candidates.has(cleanName)) {
      candidates.set(cleanName, new Set([cleanValue]));
    }
  };

  const assignment = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])/g;
  let match: RegExpExecArray | null;
  while ((match = assignment.exec(source))) {
    const quote = match[2] ?? "";
    const valueStart = assignment.lastIndex;
    let escaped = false;
    for (let index = valueStart; index < source.length; index += 1) {
      const character = source[index] ?? "";
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === quote) {
        add(match[1] ?? "", source.slice(valueStart, index));
        assignment.lastIndex = index + 1;
        break;
      }
    }
  }

  for (const comparison of source.matchAll(
    /\b([A-Za-z_$][\w$]*)\s*(?:===|!==|==|!=)\s*["'`]([^"'`]+)["'`]/g
  )) {
    add(comparison[1] ?? "", comparison[2] ?? "");
  }
  for (const comparison of source.matchAll(
    /["'`]([^"'`]+)["'`]\s*(?:===|!==|==|!=)\s*\b([A-Za-z_$][\w$]*)/g
  )) {
    add(comparison[2] ?? "", comparison[1] ?? "");
  }
  return candidates;
};

const resolveExpression = (
  expression: string,
  constants: Map<string, string>,
  enumAliases: Set<string>
) => {
  const clean = expression.trim().replace(/[,;]\s*$/, "");
  const literal = clean.match(/^["']([^"']+)["']$/)?.[1] ??
    clean.match(/^`([\s\S]*)`$/)?.[1];
  if (literal) return literal;
  if (constants.has(clean)) return constants.get(clean) ?? "";
  for (const alias of enumAliases) {
    const enumMatch = clean.match(
      new RegExp(`^${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.Type\\.([A-Z0-9_]+)$`)
    );
    if (enumMatch) return enumMatch[1]!.toLowerCase();
  }
  return "";
};

const resolveExpressionCandidates = (
  expression: string,
  constants: Map<string, string>,
  candidates: Map<string, Set<string>>,
  enumAliases: Set<string>
) => {
  const clean = expression.trim().replace(/[,;]\s*$/, "");
  const values = new Set<string>();
  const exact = resolveExpression(clean, constants, enumAliases);
  if (exact) values.add(exact);
  for (const candidate of candidates.get(clean) ?? []) values.add(candidate);
  return [...values];
};

const propertyExpression = (source: string, property: string) => {
  const match = new RegExp(`\\b${property}\\s*:\\s*`, "i").exec(source);
  if (!match) return "";
  const start = match.index + match[0].length;
  let quote = "";
  let escaped = false;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(" || character === "[" || character === "{") depth += 1;
    else if (character === ")" || character === "]" || character === "}") {
      if (depth === 0) return source.slice(start, index).trim();
      depth -= 1;
    } else if (depth === 0 && (character === "," || character === "\n")) {
      return source.slice(start, index).trim();
    }
  }
  return source.slice(start).trim();
};

const callBlocks = (
  source: string,
  objectNames: Iterable<string>,
  method: string
): Array<{ body: string; evidence: string; line: number }> => {
  const results: Array<{ body: string; evidence: string; line: number }> = [];
  const names = [...objectNames];
  if (!names.length) return results;
  const aliases = names
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const expression = new RegExp(
    `\\b(?:${aliases})\\.${method}\\s*\\(\\s*\\{`,
    "g"
  );
  let match: RegExpExecArray | null;
  while ((match = expression.exec(source))) {
    const objectStart = source.indexOf("{", match.index);
    if (objectStart < 0) continue;
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = objectStart; index < source.length; index += 1) {
      const character = source[index] ?? "";
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
        continue;
      }
      if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          results.push({
            body: source.slice(objectStart + 1, index),
            evidence: source.slice(match.index, Math.min(index + 2, match.index + 320)),
            line: lineNumberAt(source, match.index)
          });
          expression.lastIndex = index + 1;
          break;
        }
      }
    }
  }
  return results;
};

export const parseSuiteScriptSemantics = (source: string) => {
  const bindings = parseModuleBindings(source);
  const constants = parseStringConstants(source);
  const expressionCandidates = parseExpressionCandidates(source);
  const aggregateAliases = bindings["N"] ?? new Set<string>();
  const withAggregate = (moduleName: string, property: string) =>
    new Set([
      ...(bindings[moduleName] ?? []),
      ...[...aggregateAliases].map((alias) => `${alias}.${property}`)
    ]);
  const recordAliases = withAggregate("N/record", "record");
  const searchAliases = withAggregate("N/search", "search");
  const queryAliases = withAggregate("N/query", "query");
  const taskAliases = withAggregate("N/task", "task");
  const httpsAliases = withAggregate("N/https", "https");
  const urlAliases = withAggregate("N/url", "url");
  const connections: ScriptConnection[] = [];
  const recordUsage: RecordUsage[] = [];
  const seenConnection = new Set<string>();
  const seenRecord = new Set<string>();

  const addConnection = (connection: ScriptConnection) => {
    const key = `${connection.kind}:${connection.targetRef}:${connection.deploymentRef ?? ""}`;
    if (!connection.targetRef || seenConnection.has(key)) return;
    seenConnection.add(key);
    connections.push(connection);
  };
  const addRecordUsage = (
    recordType: string,
    operation: RecordOperation,
    evidence: string,
    line?: number
  ) => {
    const clean = recordType.trim().toLowerCase();
    const key = `${operation}:${clean}`;
    if (!clean || seenRecord.has(key)) return;
    seenRecord.add(key);
    recordUsage.push({ recordType: clean, operation, evidence, line });
  };

  for (const match of source.matchAll(
    /\bclientScriptModulePath\s*=\s*["'`]([^"'`]+)["'`]/g
  )) {
    addConnection({
      kind: "client-script",
      targetRef: match[1] ?? "",
      confidence: "unresolved",
      evidence: match[0],
      line: lineNumberAt(source, match.index ?? 0)
    });
  }

  for (const match of source.matchAll(
    /\b(?:clientScriptModulePath|clientScriptFileId)\s*:\s*["'`]([^"'`]+)["'`]/g
  )) {
    addConnection({
      kind: "client-script",
      targetRef: match[1] ?? "",
      confidence: "unresolved",
      evidence: match[0],
      line: lineNumberAt(source, match.index ?? 0)
    });
  }

  const taskVariables = new Map<string, {
    kind: ScriptConnectionKind;
    evidence: string;
  }>();
  for (const taskAlias of taskAliases) {
    const escapedAlias = taskAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of source.matchAll(
      new RegExp(
        `\\b(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*${escapedAlias}\\.create\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`,
        "g"
      )
    )) {
      const body = match[2] ?? "";
      const taskType =
        body.match(/\btaskType\s*:\s*[\w$]+\.TaskType\.([A-Z_]+)/i)?.[1] ?? "";
    const kind =
      taskType.toUpperCase() === "MAP_REDUCE"
        ? "map-reduce-task"
        : taskType.toUpperCase() === "SCHEDULED_SCRIPT"
          ? "scheduled-task"
          : null;
    if (!kind) continue;
      const scriptId = resolveExpression(
        propertyExpression(body, "scriptId"),
        constants,
        recordAliases
      );
      const deploymentId = resolveExpression(
        propertyExpression(body, "deploymentId"),
        constants,
        recordAliases
      );
    if (scriptId) {
      addConnection({
        kind,
        targetRef: scriptId,
        deploymentRef: deploymentId || undefined,
        confidence: "unresolved",
          evidence: match[0],
          line: lineNumberAt(source, match.index ?? 0)
      });
    } else {
      taskVariables.set(match[1] ?? "", { kind, evidence: match[0] });
    }
    }
  }

  for (const [variable, task] of taskVariables) {
    const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const scriptId = source.match(
      new RegExp(`\\b${escaped}\\.scriptId\\s*=\\s*["'\`]([^"'\`]+)["'\`]`)
    )?.[1];
    const deploymentId = source.match(
      new RegExp(`\\b${escaped}\\.deploymentId\\s*=\\s*["'\`]([^"'\`]+)["'\`]`)
    )?.[1];
    if (scriptId) {
      addConnection({
        kind: task.kind,
        targetRef: scriptId,
        deploymentRef: deploymentId || undefined,
        confidence: "unresolved",
        evidence: `${task.evidence}; ${variable}.scriptId = "${scriptId}"`
      });
    }
  }

  for (const { body, evidence, line } of callBlocks(source, taskAliases, "create")) {
    const taskType =
      body.match(/\btaskType\s*:\s*[\w$]+\.TaskType\.([A-Z_]+)/i)?.[1] ?? "";
    const kind =
      taskType.toUpperCase() === "MAP_REDUCE"
        ? "map-reduce-task"
        : taskType.toUpperCase() === "SCHEDULED_SCRIPT"
          ? "scheduled-task"
          : null;
    if (!kind) continue;
    const scriptId = resolveExpression(
      propertyExpression(body, "scriptId"),
      constants,
      recordAliases
    );
    if (!scriptId) continue;
    addConnection({
      kind,
      targetRef: scriptId,
      deploymentRef:
        resolveExpression(
          propertyExpression(body, "deploymentId"),
          constants,
          recordAliases
        ) || undefined,
      confidence: "unresolved",
      evidence,
      line
    });
  }

  const endpointMethods: Array<{
    method: string;
    kind: ScriptConnectionKind;
  }> = [
    { method: "resolveScript", kind: "suitelet" },
    { method: "requestSuitelet", kind: "suitelet" },
    { method: "requestRestlet", kind: "restlet" }
  ];
  for (const endpoint of endpointMethods) {
    const aliases =
      endpoint.method === "resolveScript" ? urlAliases : httpsAliases;
    for (const { body, evidence, line } of callBlocks(
      source,
      aliases,
      endpoint.method
    )) {
      const scriptId = resolveExpression(
        propertyExpression(body, "scriptId") ||
          propertyExpression(body, "script"),
        constants,
        recordAliases
      );
      if (!scriptId) continue;
      addConnection({
        kind: endpoint.kind,
        targetRef: scriptId,
        deploymentRef:
          resolveExpression(
            propertyExpression(body, "deploymentId") ||
              propertyExpression(body, "deployment"),
            constants,
            recordAliases
          ) ||
          undefined,
        confidence: "unresolved",
        evidence,
        line
      });
    }
  }

  const operations: RecordOperation[] = [
    "load",
    "create",
    "submitFields",
    "delete",
    "transform",
    "copy"
  ];
  for (const operation of operations) {
    for (const { body, evidence, line } of callBlocks(
      source,
      recordAliases,
      operation
    )) {
      const property = operation === "transform" ? "fromType" : "type";
      const recordType = resolveExpression(
        propertyExpression(body, property),
        constants,
        recordAliases
      );
      if (!recordType) continue;
      addRecordUsage(recordType, operation, evidence, line);
      if (operation === "transform") {
        const target = resolveExpression(
          propertyExpression(body, "toType"),
          constants,
          recordAliases
        );
        if (target) addRecordUsage(target, "create", `transform to ${target}`, line);
      }
    }
  }

  const searchOperations: Array<{
    method: string;
    operation: RecordOperation;
  }> = [
    { method: "create", operation: "search" },
    { method: "lookupFields", operation: "lookup" }
  ];
  const searchEnumAliases = new Set([...recordAliases, ...searchAliases]);
  for (const { method, operation } of searchOperations) {
    for (const { body, evidence, line } of callBlocks(
      source,
      searchAliases,
      method
    )) {
      const types = resolveExpressionCandidates(
        propertyExpression(body, "type"),
        constants,
        expressionCandidates,
        searchEnumAliases
      );
      types.forEach((recordType) =>
        addRecordUsage(recordType, operation, evidence, line)
      );
    }
  }

  for (const { body, evidence, line } of callBlocks(
    source,
    queryAliases,
    "runSuiteQL"
  )) {
    const queries = resolveExpressionCandidates(
      propertyExpression(body, "query"),
      constants,
      expressionCandidates,
      new Set()
    );
    for (const sql of queries) {
      for (const table of sql.matchAll(
        /\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_]*)/gi
      )) {
        addRecordUsage(table[1] ?? "", "suiteql", evidence, line);
      }
    }
  }

  for (const method of ["request", "get", "post", "put", "delete"]) {
    for (const { body, evidence, line } of callBlocks(
      source,
      httpsAliases,
      method
    )) {
      const urls = resolveExpressionCandidates(
        propertyExpression(body, "url"),
        constants,
        expressionCandidates,
        new Set()
      );
      for (const url of urls) {
        if (!/^https?:\/\//i.test(url)) continue;
        addConnection({
          kind: "external-http",
          targetRef: url,
          confidence: "exact",
          evidence,
          line
        });
      }
    }
  }

  for (const alias of withAggregate("N/file", "file")) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of source.matchAll(
      new RegExp(
        `\\b${escaped}\\.load\\s*\\(\\s*\\{\\s*id\\s*:\\s*["'\`]([^"'\`]+\\.(?:html?|js))["'\`]`,
        "gi"
      )
    )) {
      const targetRef = match[1] ?? "";
      addConnection({
        kind: /\.html?$/i.test(targetRef) ? "html-file" : "client-script",
        targetRef,
        confidence: "unresolved",
        evidence: match[0],
        line: lineNumberAt(source, match.index ?? 0)
      });
    }
  }

  return { connections, recordUsage };
};

export const resolveDependencyGraph = (
  nodes: Array<
    Omit<ScriptDependencyNode, "resolvedDependencies" | "unresolvedDependencies">
  >,
  deploymentTargets: Record<string, string> = {}
): ScriptDependencyNode[] => {
  const byIdentity = new Map<string, string>();
  const byScriptId = new Map<string, string>();
  for (const node of nodes) {
    const identities = [
      normalizePath(node.fileName),
      basename(node.fileName),
      normalizePath(node.scriptId),
      basename(node.scriptId)
    ].filter(Boolean);
    identities.forEach((identity) => byIdentity.set(identity, node.key));
    if (node.scriptId) byScriptId.set(node.scriptId.toLowerCase(), node.key);
  }

  return nodes.map((node) => {
    const resolved = new Set<string>();
    const unresolved = new Set<string>();
    for (const dependency of node.imports) {
      if (dependency.startsWith("N/")) continue;
      const exact = byIdentity.get(normalizePath(dependency));
      const loose = byIdentity.get(basename(dependency));
      const target = exact ?? loose;
      if (target && target !== node.key) resolved.add(target);
      else if (
        BUILTIN_PREFIXES.some((prefix) => dependency.startsWith(prefix)) ||
        dependency.startsWith("custom")
      ) {
        unresolved.add(dependency);
      }
    }
    const moduleConnections: ScriptConnection[] = [...resolved].map(
      (targetKey) => ({
        kind: "module",
        targetRef: nodeMapIdentity(targetKey, nodes),
        targetKey,
        confidence: "exact",
        evidence: "Source module import"
      })
    );
    const semanticConnections = node.connections.map((connection) => {
      if (connection.kind === "external-http") {
        return { ...connection, confidence: "exact" as const };
      }
      const targetKey =
        byScriptId.get(connection.targetRef.toLowerCase()) ??
        byIdentity.get(normalizePath(connection.targetRef)) ??
        byIdentity.get(basename(connection.targetRef)) ??
        (connection.deploymentRef
          ? deploymentTargets[connection.deploymentRef.toLowerCase()]
          : undefined);
      const targetNode = targetKey
        ? nodes.find((candidate) => candidate.key === targetKey)
        : undefined;
      const resolvedKind =
        connection.kind === "suitelet" &&
        targetNode?.scriptType?.toUpperCase().includes("RESTLET")
          ? "restlet"
          : connection.kind;
      return {
        ...connection,
        kind: resolvedKind,
        targetKey,
        confidence: targetKey ? ("exact" as const) : ("unresolved" as const)
      };
    });
    return {
      ...node,
      resolvedDependencies: [...resolved],
      unresolvedDependencies: [...unresolved],
      connections: [...moduleConnections, ...semanticConnections]
    };
  });
};

const nodeMapIdentity = (
  key: string,
  nodes: Array<{ key: string; scriptId: string; fileName: string }>
) => {
  const node = nodes.find((item) => item.key === key);
  return node?.scriptId || node?.fileName || key;
};

export const saveDependencyScan = async (
  environment: string,
  nodes: ScriptDependencyNode[]
) => {
  const now = Date.now();
  const serializableNodes = JSON.parse(
    JSON.stringify(nodes)
  ) as ScriptDependencyNode[];
  await db.transaction("rw", db.nodes, db.scans, async () => {
    await db.nodes.where("environment").equals(environment).delete();
    if (serializableNodes.length) await db.nodes.bulkPut(serializableNodes);
    await db.scans.put({
      environment,
      scannedAt: now,
      scriptCount: nodes.length,
      fileCount: nodes.filter((node) => node.imports.length > 0).length
    });
  });
};

export const loadDependencyNodes = async (environment: string) =>
  (await db.nodes.where("environment").equals(environment).toArray()).map(
    (node) => ({
      ...node,
      imports: Array.isArray(node.imports) ? node.imports : [],
      resolvedDependencies: Array.isArray(node.resolvedDependencies)
        ? node.resolvedDependencies
        : [],
      unresolvedDependencies: Array.isArray(node.unresolvedDependencies)
        ? node.unresolvedDependencies
        : [],
      connections: Array.isArray(node.connections) ? node.connections : [],
      recordUsage: Array.isArray(node.recordUsage) ? node.recordUsage : []
    })
  );

export const getDependencyScanMeta = (environment: string) =>
  db.scans.get(environment);

export { db as scriptDependencyDb };
