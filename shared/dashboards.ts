/** Shared contract: the extension worker and Vue renderer use the same validation. */
import {
  dashboardCatalog,
  actionSchema,
  nodeSchema,
  definitionSchema,
  bindingSchema,
  componentSchema,
  librarySchema,
} from "./dashboardContracts";
export { dashboardCatalog } from "./dashboardContracts";
export const DASHBOARDS_STORAGE_KEY = "magic_netsuite_dashboards_v1";
export type DashboardMode = "client" | "server" | "hybrid";
export type DashboardNode = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  children?: DashboardNode[];
  visible?: unknown;
  bind?: string | Record<string, unknown>;
  actionId?: string | Record<string, unknown>;
  input?: any;
  slots?: Record<string, DashboardNode[]>;
  events?: Record<string, DashboardEvent | DashboardEvent[]>;
  style?: Record<string, string | number>;
};
export type DashboardEvent = {
  actionId?: string;
  input?: any;
  setState?: Record<string, unknown>;
};
export type DashboardComponent = {
  description: string;
  template: DashboardNode[];
  propsSchema?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  slots?: string[];
  events?: string[];
};
export type DashboardLibrary = {
  domain: "client" | "server" | "both";
  modules: string[];
  code?: string;
  codeFile?: string;
};
export type DashboardStep = {
  id: string;
  domain: "client" | "server";
  modules: string[];
  code?: string;
  codeFile?: string;
  libraries?: string[];
};
export type DashboardAction = {
  id: string;
  title: string;
  description?: string;
  mode: DashboardMode;
  risk: "read" | "write";
  inputSchema?: Record<string, unknown>;
  input?: any;
  steps: DashboardStep[];
  confirmation?: string;
  successMessage?: string;
};
export type DashboardDefinition = {
  name: string;
  title: string;
  description: string;
  mode: DashboardMode;
  tags: string[];
  initialState: Record<string, unknown>;
  layout: DashboardNode[];
  components: Record<string, DashboardComponent>;
  actions: DashboardAction[];
  account?: string;
  onLoad?: string[];
  refresh?: { actionId: string; everyMs: number };
  stateSchema?: Record<string, unknown>;
  libraries?: Record<string, DashboardLibrary>;
  sourceFiles?: Record<string, string>;
};
export type DashboardVersion = {
  revision: number;
  savedAt: string;
  definition: DashboardDefinition;
};
export type Dashboard = DashboardDefinition & {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  history?: DashboardVersion[];
};
export const dashboardModules = {
  shared: [
    "record",
    "search",
    "query",
    "runtime",
    "log",
    "url",
    "format",
    "email",
    "https",
    "http",
    "xml",
    "currency",
    "transaction",
  ],
  client: ["currentRecord", "dialog", "message"],
  server: ["file", "render", "task", "workflow", "encode", "error", "redirect"],
};
const types = new Set(dashboardCatalog.map((c) => c.type));
const reserved = new Set(["__proto__", "prototype", "constructor"]);
const identifier = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
export const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const hasOwn = (value: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key);
export function readPath(
  scope: Record<string, unknown>,
  path: string,
): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    // The `in` check is essential for Vue's proxy dependency tracking when an
    // action result does not exist yet. Own-property checks alone are untracked.
    if (
      reserved.has(key) ||
      !value ||
      typeof value !== "object" ||
      !(key in value) ||
      !hasOwn(value, key)
    )
      return undefined;
    return (value as Record<string, unknown>)[key];
  }, scope);
}
/** Exact bindings preserve arrays/objects/numbers. No eval or template compilation. */
export function resolveBindings(
  value: unknown,
  scope: Record<string, unknown>,
  preserveDeferred = false,
): any {
  if (Array.isArray(value))
    return value.map((v) => resolveBindings(v, scope, preserveDeferred));
  if (!isObject(value)) return value;
  if (typeof value.$bind === "string") {
    if (
      preserveDeferred &&
      ["item", "slot", "event"].includes(value.$bind.split(".")[0]!) &&
      !hasOwn(scope, value.$bind.split(".")[0]!)
    )
      return value;
    const resolved = readPath(scope, value.$bind);
    return resolved === undefined ? value.fallback : resolved;
  }
  if (typeof value.$op === "string") {
    if (preserveDeferred) {
      const deferred = (v: unknown): boolean =>
        Array.isArray(v)
          ? v.some(deferred)
          : isObject(v)
            ? (typeof v.$bind === "string" &&
                ["item", "slot", "event"].includes(v.$bind.split(".")[0]!) &&
                !hasOwn(scope, v.$bind.split(".")[0]!)) ||
              Object.values(v).some(deferred)
            : false;
      if (deferred(value.args)) return value;
    }
    const args = resolveBindings(
      Array.isArray(value.args) ? value.args : [],
      scope,
    );
    switch (value.$op) {
      case "not":
        return !args[0];
      case "and":
        return args.every(Boolean);
      case "or":
        return args.some(Boolean);
      case "equals":
        return JSON.stringify(args[0]) === JSON.stringify(args[1]);
      case "length":
        return args[0]?.length ?? 0;
      case "add":
        return args.reduce((a: number, b: unknown) => a + Number(b || 0), 0);
      case "subtract":
        return Number(args[0] || 0) - Number(args[1] || 0);
      case "coalesce":
        return args.find((a: unknown) => a !== null && a !== undefined);
      case "includes":
        return (
          Array.isArray(args[0]) &&
          args[0].some(
            (v: unknown) => JSON.stringify(v) === JSON.stringify(args[1]),
          )
        );
      default:
        throw new Error(`Unsupported binding operator: ${value.$op}`);
    }
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => !reserved.has(k))
      .map(([k, v]) => [k, resolveBindings(v, scope, preserveDeferred)]),
  );
}
export function setStatePath(
  state: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const keys = path.replace(/^state\./, "").split(".");
  if (!keys.length || keys.some((k) => !k || reserved.has(k)))
    throw new Error("Invalid state binding.");
  let target = state;
  for (const [index, key] of keys.slice(0, -1).entries()) {
    if (!isObject(target[key]) && !Array.isArray(target[key]))
      target[key] = /^\d+$/.test(keys[index + 1]!) ? [] : {};
    target = target[key] as Record<string, unknown>;
  }
  target[keys[keys.length - 1]!] = value;
}
export function applyStatePatch(
  state: Record<string, unknown>,
  patch: unknown,
) {
  if (!isObject(patch))
    throw new Error("setState must be an object of state paths and values.");
  // Validate every path before applying any state change.
  for (const path of Object.keys(patch))
    if (
      !path ||
      path
        .replace(/^state\./, "")
        .split(".")
        .some((k) => !k || reserved.has(k))
    )
      throw new Error(`Invalid state path: ${path}`);
  for (const [path, value] of Object.entries(patch))
    setStatePath(state, path, value);
}
export const normalizeDashboardAccount = (v: unknown) =>
  String(v || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
const definitionKeys = [
  "name",
  "title",
  "description",
  "mode",
  "tags",
  "initialState",
  "stateSchema",
  "layout",
  "components",
  "actions",
  "account",
  "onLoad",
  "refresh",
  "libraries",
  "sourceFiles",
] as const;
export function dashboardDefinition(
  d: DashboardDefinition,
): DashboardDefinition {
  return Object.fromEntries(
    definitionKeys.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]),
  ) as DashboardDefinition;
}
const stepSource = (
  d: DashboardDefinition,
  s: { code?: string; codeFile?: string },
) => (s.codeFile ? d.sourceFiles?.[s.codeFile] : s.code);
export function dashboardDiagnostics(value: unknown) {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    validateDashboard(value);
  } catch (e) {
    errors.push(...(e instanceof Error ? e.message : String(e)).split("\n"));
  }
  if (isObject(value)) {
    const scan = (v: unknown, path: string) => {
      if (Array.isArray(v)) {
        v.forEach((item, i) => scan(item, `${path}[${i}]`));
        return;
      }
      if (!isObject(v)) return;
      if (
        typeof v.$bind === "string" &&
        v.$bind.startsWith("results.") &&
        v.fallback === undefined
      )
        warnings.push(
          `${path}: result binding has no fallback before its action runs.`,
        );
      for (const [key, item] of Object.entries(v)) scan(item, `${path}.${key}`);
    };
    scan(
      dashboardDefinition(value as unknown as DashboardDefinition),
      "definition",
    );
  }
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)].slice(0, 30),
  };
}
export function validateDashboard(
  value: unknown,
): asserts value is DashboardDefinition {
  if (!isObject(value))
    throw new Error("Dashboard definition must be an object.");
  const d = value as unknown as DashboardDefinition;
  const errors: string[] = [];
  if (!/^[a-z][a-z0-9_-]{2,63}$/.test(d.name || ""))
    errors.push(
      "name must be 3–64 lowercase letters, numbers, underscores or hyphens.",
    );
  if (typeof d.title !== "string" || !d.title.trim())
    errors.push("title is required.");
  if (typeof d.description !== "string")
    errors.push("description must be text.");
  if (!["client", "server", "hybrid"].includes(d.mode))
    errors.push("mode must be client, server or hybrid.");
  if (!Array.isArray(d.tags) || d.tags.some((t) => typeof t !== "string"))
    errors.push("tags must be strings.");
  if (!isObject(d.initialState)) errors.push("initialState must be an object.");
  if (d.stateSchema)
    try {
      validateActionInput(d.stateSchema, d.initialState, "initialState");
    } catch (e) {
      errors.push(String(e));
    }
  if (
    d.account !== undefined &&
    (typeof d.account !== "string" || !/^[a-zA-Z0-9_-]+$/.test(d.account))
  )
    errors.push("account must be a NetSuite account id.");
  if (
    d.sourceFiles !== undefined &&
    (!isObject(d.sourceFiles) ||
      Object.entries(d.sourceFiles).some(
        ([name, source]) =>
          !name ||
          /^[A-Za-z]:|^\//.test(name) ||
          name
            .split(/[\\/]/)
            .some((s) => !s || s === ".." || s === "." || reserved.has(s)) ||
          typeof source !== "string",
      ))
  )
    errors.push(
      "sourceFiles must map portable relative file names to source text.",
    );
  if (d.libraries !== undefined && !isObject(d.libraries))
    errors.push("libraries must be an object.");
  for (const [name, lib] of Object.entries(
    isObject(d.libraries) ? d.libraries : {},
  )) {
    if (
      !identifier.test(name) ||
      reserved.has(name) ||
      !isObject(lib) ||
      !["client", "server", "both"].includes(String(lib.domain))
    ) {
      errors.push(`Invalid library: ${name}`);
      continue;
    }
    const allowed = [
      ...dashboardModules.shared,
      ...(lib.domain === "both"
        ? []
        : dashboardModules[lib.domain as "client" | "server"]),
    ];
    if (
      !Array.isArray(lib.modules) ||
      lib.modules.some((m) => !allowed.includes(m))
    )
      errors.push(`Library ${name} has incompatible modules.`);
    if (!stepSource(d, lib as DashboardLibrary)?.trim())
      errors.push(`Library ${name} needs code or a valid codeFile.`);
  }
  if (!Array.isArray(d.actions) || d.actions.length > 64)
    errors.push("actions must be an array of at most 64 actions.");
  const actionIds = new Set<string>();
  for (const a of Array.isArray(d.actions) ? d.actions : []) {
    if (!isObject(a)) {
      errors.push("Invalid action.");
      continue;
    }
    if (!identifier.test(a.id) || actionIds.has(a.id) || reserved.has(a.id))
      errors.push(`Invalid or duplicate action id: ${a.id}`);
    actionIds.add(a.id);
    if (typeof a.title !== "string" || !a.title.trim())
      errors.push(`Action ${a.id} needs a title.`);
    if (
      !["client", "server", "hybrid"].includes(a.mode) ||
      (d.mode !== "hybrid" && a.mode !== d.mode)
    )
      errors.push(`Action ${a.id} mode conflicts with dashboard mode.`);
    if (!["read", "write"].includes(a.risk))
      errors.push(`Action ${a.id} needs read/write risk.`);
    if (
      a.inputSchema &&
      (!isObject(a.inputSchema) ||
        ![
          "object",
          "array",
          "string",
          "number",
          "integer",
          "boolean",
          "null",
        ].includes(String(a.inputSchema.type)))
    )
      errors.push(`Action ${a.id} inputSchema needs a valid JSON type.`);
    if (!Array.isArray(a.steps) || !a.steps.length || a.steps.length > 12) {
      errors.push(`Action ${a.id} needs 1–12 steps.`);
      continue;
    }
    const steps = new Set<string>();
    for (const s of a.steps) {
      if (!isObject(s)) {
        errors.push("Invalid action step.");
        continue;
      }
      if (!identifier.test(s.id) || steps.has(s.id) || reserved.has(s.id))
        errors.push(`Invalid or duplicate step id: ${s.id}`);
      steps.add(s.id);
      if (
        !["client", "server"].includes(s.domain) ||
        (a.mode !== "hybrid" && s.domain !== a.mode)
      )
        errors.push(`Step ${s.id} conflicts with action mode.`);
      const allowed = [
        ...dashboardModules.shared,
        ...(dashboardModules[s.domain] || []),
      ];
      if (
        !Array.isArray(s.modules) ||
        s.modules.some((m) => !allowed.includes(m))
      )
        errors.push(
          `Step ${s.id} contains modules unavailable in ${s.domain}.`,
        );
      if (!stepSource(d, s)?.trim())
        errors.push(`Step ${s.id} needs JavaScript code or a valid codeFile.`);
      if (s.code && s.codeFile)
        errors.push(`Step ${s.id} must use code or codeFile, not both.`);
      for (const name of Array.isArray(s.libraries) ? s.libraries : []) {
        const lib = d.libraries?.[name];
        if (!lib || (lib.domain !== "both" && lib.domain !== s.domain))
          errors.push(`Library ${name} is unavailable for step ${s.id}.`);
      }
    }
    if (
      a.mode === "hybrid" &&
      new Set(a.steps.map((s) => s?.domain)).size !== 2
    )
      errors.push(
        `Hybrid action ${a.id} must include client and server steps.`,
      );
  }
  const automatic = [
    ...(Array.isArray(d.onLoad) ? d.onLoad : []),
    ...(d.refresh ? [d.refresh.actionId] : []),
  ];
  if (d.onLoad !== undefined && !Array.isArray(d.onLoad))
    errors.push("onLoad must be an array of action ids.");
  if (
    d.refresh &&
    (!Number.isInteger(d.refresh.everyMs) || d.refresh.everyMs < 1000)
  )
    errors.push("refresh.everyMs must be an integer of at least 1000 ms.");
  for (const id of automatic) {
    const a = d.actions?.find((a) => a?.id === id);
    if (!a) errors.push(`Unknown automatic action: ${id}`);
    else if (a.risk !== "read")
      errors.push(`Automatic action ${id} must have read risk.`);
  }
  const checkBindings = (v: unknown, path: string) => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => checkBindings(item, `${path}[${i}]`));
      return;
    }
    if (!isObject(v)) return;
    if (typeof v.$bind === "string") {
      const parts = v.$bind.split(".");
      if (
        parts.some((k) => !k || reserved.has(k)) ||
        ![
          "state",
          "results",
          "busy",
          "errors",
          "props",
          "item",
          "index",
          "slot",
          "event",
        ].includes(parts[0]!)
      )
        errors.push(`${path}: invalid binding ${v.$bind}.`);
      if (
        parts[0] === "state" &&
        parts.length > 1 &&
        !hasOwn(d.initialState || {}, parts[1]!)
      )
        errors.push(
          `${path}: missing state field ${parts[1]}. Declare it in initialState.`,
        );
      if (
        parts[0] === "results" &&
        parts.length > 1 &&
        !actionIds.has(parts[1]!)
      )
        errors.push(`${path}: missing result action ${parts[1]}.`);
    }
    if (
      typeof v.$op === "string" &&
      ![
        "not",
        "and",
        "or",
        "equals",
        "length",
        "add",
        "subtract",
        "coalesce",
        "includes",
      ].includes(v.$op)
    )
      errors.push(`${path}: unsupported operator ${v.$op}.`);
    for (const [key, item] of Object.entries(v))
      checkBindings(item, `${path}.${key}`);
  };
  const checkMappedInput = (
    input: unknown,
    a: DashboardAction | undefined,
    path: string,
  ) => {
    if (!a?.inputSchema) return;
    const isDeferred = (v: unknown): boolean =>
      Array.isArray(v)
        ? v.some(isDeferred)
        : isObject(v)
          ? (typeof v.$bind === "string" && !v.$bind.startsWith("state")) ||
            Object.values(v).some(isDeferred)
          : false;
    if (isDeferred(input)) return;
    try {
      validateActionInput(
        a.inputSchema,
        resolveBindings(input, { state: d.initialState }),
        path,
      );
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  };
  for (const a of Array.isArray(d.actions) ? d.actions : [])
    if (a?.input !== undefined) {
      checkBindings(a.input, `action ${a.id}.input`);
      checkMappedInput(a.input, a, `action ${a.id}.input`);
    }
  const components = isObject(d.components) ? d.components : {};
  if (!isObject(d.components) || Object.keys(components).length > 64)
    errors.push("components must be an object with at most 64 entries.");
  let count = 0;
  const walk = (
    nodes: unknown,
    depth: number,
    chain: string[],
    ids: Set<string>,
  ) => {
    if (!Array.isArray(nodes)) {
      errors.push("layout/template/children must be arrays.");
      return;
    }
    if (depth > 12) {
      errors.push("Component nesting exceeds 12 levels or contains a cycle.");
      return;
    }
    for (const n of nodes) {
      if (++count > 1500) {
        errors.push("Dashboard exceeds 1500 expanded nodes.");
        return;
      }
      if (!isObject(n)) {
        errors.push("Invalid layout node.");
        continue;
      }
      if (typeof n.id !== "string" || !identifier.test(n.id) || ids.has(n.id))
        errors.push(`Invalid or duplicate node id: ${n.id}`);
      ids.add(String(n.id));
      const type = String(n.type);
      if (type.startsWith("custom:")) {
        const name = type.slice(7);
        if (!hasOwn(components, name) || chain.includes(name))
          errors.push(`Unknown or cyclic component: ${name}`);
        else {
          const c = components[name]!;
          if (c.propsSchema) {
            const merged = {
              ...c.defaults,
              ...(isObject(n.props) ? n.props : {}),
            };
            // Required props are checked now; deferred values are validated after binding at render time.
            for (const key of Array.isArray(c.propsSchema.required)
              ? c.propsSchema.required
              : [])
              if (!hasOwn(merged, String(key)))
                errors.push(`Node ${n.id}: missing custom prop ${key}.`);
            for (const [key, v] of Object.entries(merged))
              if (!(isObject(v) && ("$bind" in v || "$op" in v))) {
                const properties = isObject(c.propsSchema.properties)
                  ? c.propsSchema.properties
                  : {};
                if (
                  c.propsSchema.additionalProperties === false &&
                  !hasOwn(properties, key)
                )
                  errors.push(`Node ${n.id}: unknown custom prop ${key}.`);
                if (isObject(properties[key]))
                  try {
                    validateActionInput(
                      properties[key],
                      v,
                      `node ${n.id}.props.${key}`,
                    );
                  } catch (e) {
                    errors.push(String(e));
                  }
              }
          }
          if (Array.isArray(c.slots))
            for (const slot of Object.keys(isObject(n.slots) ? n.slots : {}))
              if (!c.slots.includes(slot))
                errors.push(`Node ${n.id}: unknown custom slot ${slot}.`);
          if (Array.isArray(c.events))
            for (const event of Object.keys(isObject(n.events) ? n.events : {}))
              if (!c.events.includes(event))
                errors.push(`Node ${n.id}: unknown custom event ${event}.`);
          walk(c?.template, depth + 1, [...chain, name], new Set());
        }
      } else if (!types.has(type))
        errors.push(`Unknown component type: ${type}`);
      if (n.props !== undefined && !isObject(n.props))
        errors.push(`Node ${n.id} props must be an object.`);
      if (typeof n.bind === "string") {
        if (
          !/^state\.[\w.-]+$/.test(n.bind) ||
          n.bind.split(".").some((k) => reserved.has(k))
        )
          errors.push(`Invalid state binding: ${n.bind}`);
        else if (!hasOwn(d.initialState || {}, n.bind.split(".")[1]!))
          errors.push(
            `Node ${n.id}: missing state field ${n.bind.split(".")[1]}.`,
          );
      } else if (n.bind !== undefined && !isObject(n.bind))
        errors.push(`Invalid state binding: ${n.id}`);
      if (["input", "textarea", "select", "toggle"].includes(type) && !n.bind)
        errors.push(`Input node ${n.id} needs a state binding.`);
      if (typeof n.actionId === "string" && !actionIds.has(n.actionId))
        errors.push(`Unknown action: ${n.actionId}`);
      if (type === "button" && !n.actionId && !isObject(n.events))
        errors.push(`Button ${n.id} needs an actionId or click event.`);
      if (
        type === "table" &&
        isObject(n.props) &&
        n.props.selection &&
        n.props.selection !== "none" &&
        !n.bind
      )
        errors.push(`Selectable table ${n.id} needs a state binding.`);
      checkBindings(n.bind, `node ${n.id}.bind`);
      checkBindings(n.actionId, `node ${n.id}.actionId`);
      checkBindings(n.props, `node ${n.id}.props`);
      checkBindings(n.visible, `node ${n.id}.visible`);
      checkBindings(n.input, `node ${n.id}.input`);
      if (
        type === "table" &&
        isObject(n.props) &&
        Array.isArray(n.props.columns)
      )
        for (const column of n.props.columns) {
          if (
            isObject(column) &&
            typeof column.actionId === "string" &&
            !actionIds.has(column.actionId)
          )
            errors.push(`Unknown column action: ${column.actionId}`);
        }
      if (typeof n.actionId === "string" && n.input !== undefined)
        checkMappedInput(
          n.input,
          d.actions.find((a) => a.id === n.actionId),
          `node ${n.id}.input`,
        );
      const entry = dashboardCatalog.find((c) => c.type === type);
      if (entry && isObject(n.props))
        for (const [key, v] of Object.entries(n.props)) {
          const schema = entry.propsSchema.properties[key];
          if (!schema)
            errors.push(`Node ${n.id}: unknown prop ${key} for ${type}.`);
          else if (!(isObject(v) && ("$bind" in v || "$op" in v)))
            try {
              validateActionInput(
                schema as Record<string, unknown>,
                v,
                `node ${n.id}.props.${key}`,
              );
            } catch (e) {
              errors.push(e instanceof Error ? e.message : String(e));
            }
        }
      if (
        n.style !== undefined &&
        (!isObject(n.style) ||
          Object.values(n.style).some(
            (v) =>
              !["string", "number"].includes(typeof v) ||
              /url\s*\(|expression\s*\(|@import|javascript:/i.test(String(v)),
          ))
      )
        errors.push(`Node ${n.id}: style must contain safe CSS values.`);
      if (isObject(n.events))
        for (const [event, handlers] of Object.entries(n.events)) {
          if (entry && !entry.events.includes(event))
            errors.push(`Node ${n.id}: unsupported event ${event}.`);
          for (const handler of Array.isArray(handlers)
            ? handlers
            : [handlers]) {
            if (!isObject(handler)) {
              errors.push(`Node ${n.id}: invalid event handler.`);
              continue;
            }
            if (
              typeof handler.actionId === "string" &&
              !actionIds.has(handler.actionId)
            )
              errors.push(`Unknown event action: ${handler.actionId}`);
            checkBindings(handler, `node ${n.id}.events.${event}`);
            if (handler.setState)
              try {
                applyStatePatch({}, handler.setState);
              } catch (e) {
                errors.push(String(e));
              }
            if (
              typeof handler.actionId === "string" &&
              handler.input !== undefined
            )
              checkMappedInput(
                handler.input,
                d.actions.find((a) => a.id === handler.actionId),
                `event ${event}.input`,
              );
          }
        }
      if (isObject(n.slots))
        for (const [name, children] of Object.entries(n.slots)) {
          if (
            entry &&
            !entry.slots.includes(name) &&
            !(type === "table" && name.startsWith("cell:"))
          )
            errors.push(`Node ${n.id}: unsupported slot ${name}.`);
          walk(children, depth + 1, chain, ids);
        }
      if (n.children !== undefined) walk(n.children, depth + 1, chain, ids);
    }
  };
  walk(d.layout, 0, [], new Set());
  for (const [name, c] of Object.entries(components)) {
    if (
      !identifier.test(name) ||
      reserved.has(name) ||
      !isObject(c) ||
      typeof c.description !== "string"
    )
      errors.push(`Invalid custom component: ${name}`);
    else {
      if (
        c.slots !== undefined &&
        (!Array.isArray(c.slots) || c.slots.some((s) => typeof s !== "string"))
      )
        errors.push(`Component ${name}: slots must be names.`);
      if (
        c.events !== undefined &&
        (!Array.isArray(c.events) ||
          c.events.some((s) => typeof s !== "string"))
      )
        errors.push(`Component ${name}: events must be names.`);
      walk(c.template, 0, [name], new Set());
    }
  }
  if (JSON.stringify(dashboardDefinition(d)).length > 750_000)
    errors.push("Dashboard definition exceeds 750 KB.");
  if (errors.length) throw new Error([...new Set(errors)].join("\n"));
}
export function validateActionInput(
  schema: Record<string, unknown> | undefined,
  value: unknown,
  path = "input",
): void {
  if (!schema) return;
  if (Array.isArray(schema.anyOf)) {
    if (
      !schema.anyOf.some((s) => {
        try {
          validateActionInput(s, value, path);
          return true;
        } catch {
          return false;
        }
      })
    )
      throw new Error(`${path} does not match its allowed schema.`);
    return;
  }
  const type = schema.type;
  const actual = Array.isArray(value)
    ? "array"
    : value === null
      ? "null"
      : typeof value;
  if (
    type &&
    type !== actual &&
    !(type === "integer" && Number.isInteger(value))
  )
    throw new Error(`${path} must be ${type}.`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    throw new Error(`${path} must be one of the allowed values.`);
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (typeof schema.minimum === "number" && value < schema.minimum) ||
      (typeof schema.maximum === "number" && value > schema.maximum))
  )
    throw new Error(`${path} is outside its allowed range.`);
  if (isObject(value)) {
    for (const key of Array.isArray(schema.required) ? schema.required : [])
      if (
        typeof key !== "string" ||
        value[key] === undefined ||
        value[key] === ""
      )
        throw new Error(`Missing ${path}.${String(key)}.`);
    const properties = isObject(schema.properties) ? schema.properties : {};
    for (const [key, v] of Object.entries(value)) {
      if (schema.additionalProperties === false && !hasOwn(properties, key))
        throw new Error(`Unknown ${path}.${key}.`);
      if (isObject(properties[key]))
        validateActionInput(properties[key], v, `${path}.${key}`);
    }
  }
  if (Array.isArray(value) && isObject(schema.items))
    value.forEach((v, i) =>
      validateActionInput(
        schema.items as Record<string, unknown>,
        v,
        `${path}[${i}]`,
      ),
    );
}
export function buildDashboardStepCode(
  step: DashboardStep,
  input: any,
  previous: unknown,
  steps: Record<string, unknown>,
  dashboard?: DashboardDefinition,
): string {
  const payload = JSON.stringify(JSON.stringify({ input, previous, steps }));
  const libs = (step.libraries || []).map((name) => ({
    name,
    lib: dashboard?.libraries?.[name],
  }));
  const modules = [
    ...new Set([
      ...step.modules,
      ...libs.flatMap(({ lib }) => lib?.modules || []),
    ]),
  ];
  const libraryCode = libs
    .map(
      ({ name, lib }) =>
        `lib[${JSON.stringify(name)}] = (function(input, previous, steps, context) {\n${lib && dashboard ? stepSource(dashboard, lib) : ""}\n})(input, previous, steps, context);\nif (!lib[${JSON.stringify(name)}] || typeof lib[${JSON.stringify(name)}] !== 'object' || typeof lib[${JSON.stringify(name)}].then === 'function') throw new Error('Libraries must return synchronous helper objects.');`,
    )
    .join("\n");
  const invocation = `(${step.domain === "client" ? "async " : ""}function(input, previous, steps, context) {\nconst lib = {};\n${libraryCode}\n${dashboard ? stepSource(dashboard, step) : step.code}\n})(__dashboard.input, __dashboard.previous, __dashboard.steps, Object.freeze({domain: ${JSON.stringify(step.domain)}, account: ${JSON.stringify(dashboard?.account || "")}, modules: Object.freeze({${modules.join(",")}})}))`;
  const guard = dashboard?.account
    ? `if (String(runtime.accountId).toUpperCase().replace(/-/g,'_') !== ${JSON.stringify(normalizeDashboardAccount(dashboard.account))}) throw new Error('Dashboard account mismatch: expected ${normalizeDashboardAccount(dashboard.account)}.');\n`
    : "";
  return `${guard}const __dashboard = JSON.parse(${payload});\nconst __dashboardOutput = function(value) {\nif (value === undefined) return null;\nif (value && typeof value.then === 'function') throw new Error('Server dashboard steps must return synchronous JSON data.');\nconst json = JSON.stringify(value);\nif (json === undefined) throw new Error('Dashboard steps must return JSON data.');\nreturn JSON.parse(json);\n};\nreturn ${step.domain === "client" ? `Promise.resolve(${invocation}).then(__dashboardOutput)` : `__dashboardOutput(${invocation})`};`;
}
export async function executeDashboardAction(
  dashboard: DashboardDefinition,
  actionId: string,
  input: any,
  run: (step: DashboardStep, code: string) => Promise<unknown>,
) {
  validateDashboard(dashboard);
  const action = dashboard.actions.find((a) => a.id === actionId);
  if (!action) throw new Error(`Action ${actionId} was not found.`);
  validateActionInput(action.inputSchema, input);
  const steps: Record<string, unknown> = {};
  const setState: Record<string, unknown> = {};
  let previous: unknown = null;
  for (const step of action.steps) {
    try {
      previous = await run(
        step,
        buildDashboardStepCode(step, input, previous, steps, dashboard),
      );
      if (isObject(previous) && previous.setState !== undefined) {
        applyStatePatch({}, previous.setState);
        Object.assign(setState, previous.setState);
      }
      steps[step.id] = previous;
    } catch (e) {
      throw new Error(
        `Step ${step.id} (${step.domain}) failed: ${e instanceof Error ? e.message : String(e)}. Earlier steps may have completed; no rollback was performed.`,
      );
    }
  }
  return {
    actionId,
    result: previous,
    steps,
    setState,
    completedAt: new Date().toISOString(),
  };
}
export function dashboardNodes(d: DashboardDefinition) {
  const nodes = new Map<string, DashboardNode>();
  const walk = (list: DashboardNode[], prefix: string) => {
    for (const n of list) {
      nodes.set(prefix + n.id, n);
      walk(n.children || [], prefix);
      Object.values(n.slots || {}).forEach((s) => walk(s, prefix));
    }
  };
  walk(d.layout, "");
  for (const [name, c] of Object.entries(d.components))
    walk(c.template, `${name}/`);
  return nodes;
}
function dashboardMutationResult(
  d: Dashboard,
  previous: Dashboard | undefined,
  verbose: boolean,
) {
  const { history, ...full } = d;
  if (verbose) return full;
  const before = previous ? dashboardNodes(previous) : new Map();
  const after = dashboardNodes(d);
  const changedNodeIds = [
    ...new Set([...before.keys(), ...after.keys()]),
  ].filter(
    (id) => JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id)),
  );
  const changedActionIds = [
    ...new Set([
      ...(previous?.actions || []).map((a) => a.id),
      ...d.actions.map((a) => a.id),
    ]),
  ].filter(
    (id) =>
      JSON.stringify(previous?.actions.find((a) => a.id === id)) !==
      JSON.stringify(d.actions.find((a) => a.id === id)),
  );
  return {
    id: d.id,
    name: d.name,
    revision: d.revision,
    changedNodeIds,
    changedActionIds,
    warnings: dashboardDiagnostics(d).warnings,
  };
}
export function patchDashboardNode(
  d: DashboardDefinition,
  edit: {
    op: string;
    id: string;
    node?: DashboardNode;
    parentId?: string;
    slot?: string;
    component?: string;
  },
) {
  const root = edit.component
    ? d.components[edit.component]?.template
    : d.layout;
  if (!root) throw new Error("Component template was not found.");
  const locate = (
    list: DashboardNode[],
  ): { list: DashboardNode[]; index: number } | undefined => {
    for (let i = 0; i < list.length; i++) {
      const n = list[i]!;
      if (n.id === edit.id) return { list, index: i };
      const found = locate(n.children || []);
      if (found) return found;
      for (const slot of Object.values(n.slots || {})) {
        const hit = locate(slot);
        if (hit) return hit;
      }
    }
  };
  const found = locate(root);
  if (edit.op === "remove") {
    if (!found) throw new Error(`Node ${edit.id} was not found.`);
    found.list.splice(found.index, 1);
    return;
  }
  if (edit.op !== "upsert" || !isObject(edit.node) || edit.id !== edit.node.id)
    throw new Error("upsert requires a node with the matching id.");
  if (found) {
    found.list[found.index] = edit.node;
    return;
  }
  if (edit.parentId) {
    const original = edit.id;
    edit = { ...edit, id: edit.parentId };
    const parent = locate(root);
    edit = { ...edit, id: original };
    if (!parent) throw new Error("Parent node was not found.");
    const n = parent.list[parent.index]!;
    if (edit.slot) {
      n.slots ??= {};
      (n.slots[edit.slot] ??= []).push(edit.node!);
    } else (n.children ??= []).push(edit.node!);
  } else root.push(edit.node);
}
/** One worker owns mutations; revisions prevent editors/agents overwriting each other. */
export function createDashboardService(
  storage: {
    read: () => Promise<Dashboard[]>;
    write: (all: Dashboard[]) => Promise<void>;
  },
  run: (step: DashboardStep, code: string) => Promise<unknown>,
  environment: { getAccount?: () => Promise<string> } = {},
) {
  let queue = Promise.resolve();
  const mutate = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const find = (all: Dashboard[], id: unknown) => {
    const d = all.find((d) => d.id === id || d.name === id);
    if (!d) throw new Error(`Dashboard ${String(id)} was not found.`);
    return d;
  };
  return async (
    operation: string,
    args: Record<string, any> = {},
  ): Promise<any> => {
    if (operation === "catalog")
      return {
        components: dashboardCatalog,
        modules: dashboardModules,
        schemas: {
          definition: definitionSchema,
          node: { ...nodeSchema, $defs: { node: nodeSchema } },
          action: actionSchema,
          binding: bindingSchema,
          component: { ...componentSchema, $defs: { node: nodeSchema } },
          library: librarySchema,
        },
        bindings: {
          roots: [
            "state",
            "results",
            "busy",
            "errors",
            "props",
            "item",
            "index",
            "slot",
            "event",
          ],
          operators: [
            "not",
            "and",
            "or",
            "equals",
            "length",
            "add",
            "subtract",
            "coalesce",
            "includes",
          ],
        },
        customComponents:
          "components.Name = {description,template,propsSchema,defaults,slots,events}. Instantiate custom:Name with props and named slots. slot nodes expose caller content with slot.* scoped values. repeat templates expose item and index.",
        execution:
          "Code reads input,previous,steps,context,lib; server code is synchronous. Return JSON and optional setState:{statePath:value}. Only configured read actions may run onLoad/refresh; other actions require explicit execution. account is verified before every action and inside each SuiteScript step.",
        responses:
          "Mutations return id,name,revision,changedNodeIds,changedActionIds,warnings. Set verbose:true to include the full saved definition.",
      };
    if (operation === "list")
      return (await storage.read())
        .filter((d) =>
          `${d.title} ${d.description} ${d.tags.join(" ")}`
            .toLowerCase()
            .includes(String(args.query || "").toLowerCase()),
        )
        .map((d) => ({
          id: d.id,
          name: d.name,
          title: d.title,
          description: d.description,
          mode: d.mode,
          tags: d.tags,
          account: d.account,
          revision: d.revision,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          actionCount: d.actions.length,
        }));
    if (operation === "get") {
      const { history, ...d } = find(await storage.read(), args.dashboardId);
      return d;
    }
    if (operation === "validate") {
      const d = args.definition ?? {
        ...dashboardDefinition(find(await storage.read(), args.dashboardId)),
        ...args.patch,
      };
      return dashboardDiagnostics(d);
    }
    if (operation === "export") {
      const d = find(await storage.read(), args.dashboardId);
      return {
        format: "magic-netsuite-dashboard",
        formatVersion: 2,
        definition: dashboardDefinition(d),
      };
    }
    if (operation === "history" && !args.restoreRevision) {
      const d = find(await storage.read(), args.dashboardId);
      if (args.revision !== undefined) {
        const v = d.history?.find((v) => v.revision === args.revision);
        if (args.revision === d.revision)
          return { revision: d.revision, definition: dashboardDefinition(d) };
        if (!v) throw new Error("History revision was not found.");
        return v;
      }
      return {
        id: d.id,
        revision: d.revision,
        versions: [
          { revision: d.revision, savedAt: d.updatedAt, current: true },
          ...(d.history || []).map((v) => ({
            revision: v.revision,
            savedAt: v.savedAt,
            current: false,
          })),
        ],
      };
    }
    if (operation === "run") {
      const d = find(await storage.read(), args.dashboardId);
      if (args.expectedRevision !== d.revision)
        throw new Error(
          "Dashboard changed. Reload and review its actions before running.",
        );
      if (d.account) {
        const account = normalizeDashboardAccount(
          await environment.getAccount?.(),
        );
        if (account !== normalizeDashboardAccount(d.account))
          throw new Error(
            `Dashboard account mismatch: expected ${d.account}, routed to ${account || "unknown"}. No action was executed.`,
          );
      }
      const execution = await executeDashboardAction(
        d,
        args.actionId,
        args.input === undefined ? {} : args.input,
        run,
      );
      if (args.verbose === true) return execution;
      const { steps, ...compact } = execution;
      return compact;
    }
    return mutate(async () => {
      const all = await storage.read();
      if (operation === "create" || operation === "import") {
        const imported =
          operation === "import" ? args.payload?.definition : args.definition;
        if (
          operation === "import" &&
          (args.payload?.format !== "magic-netsuite-dashboard" ||
            ![1, 2].includes(args.payload?.formatVersion))
        )
          throw new Error("Unsupported dashboard export format.");
        const definition = args.newName
          ? { ...imported, name: args.newName }
          : imported;
        validateDashboard(definition);
        if (all.some((d) => d.name === definition.name))
          throw new Error("A dashboard with that name already exists.");
        const now = new Date().toISOString();
        const d: Dashboard = {
          ...dashboardDefinition(definition),
          id: crypto.randomUUID(),
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };
        await storage.write([...all, d]);
        return dashboardMutationResult(d, undefined, args.verbose === true);
      }
      const current = find(all, args.dashboardId);
      if (args.expectedRevision !== current.revision)
        throw new Error("Dashboard revision conflict. Reload before editing.");
      if (operation === "delete") {
        await storage.write(all.filter((d) => d.id !== current.id));
        return { deleted: true, id: current.id };
      }
      let definition: DashboardDefinition = { ...current };
      if (operation === "update") {
        if (!isObject(args.patch)) throw new Error("patch must be an object.");
        for (const key of definitionKeys)
          if (hasOwn(args.patch, key))
            (definition as any)[key] = args.patch[key];
      } else if (operation === "action") {
        if (args.operation === "delete") {
          if (!current.actions.some((a) => a.id === args.actionId))
            throw new Error("Action was not found.");
          definition.actions = current.actions.filter(
            (a) => a.id !== args.actionId,
          );
        } else if (args.operation === "upsert" && isObject(args.action)) {
          definition.actions = [
            ...current.actions.filter((a) => a.id !== args.action.id),
            args.action as DashboardAction,
          ];
        } else throw new Error("operation must be upsert or delete.");
      } else if (operation === "node") {
        definition = JSON.parse(JSON.stringify(dashboardDefinition(current)));
        if (!Array.isArray(args.operations) || !args.operations.length)
          throw new Error("operations must contain at least one node edit.");
        for (const edit of args.operations)
          patchDashboardNode(definition, edit);
      } else if (operation === "code") {
        if (!["upsert", "delete"].includes(args.operation))
          throw new Error("Code operation must be upsert or delete.");
        if (
          typeof args.name !== "string" ||
          !args.name ||
          args.name
            .split(/[\\/]/)
            .some((s: string) => !s || s === ".." || reserved.has(s)) ||
          /^[A-Za-z]:|^\//.test(args.name)
        )
          throw new Error("Source name must be a portable relative path.");
        definition.sourceFiles = { ...current.sourceFiles };
        if (args.operation === "delete")
          delete definition.sourceFiles[args.name];
        else if (typeof args.source === "string")
          definition.sourceFiles[args.name] = args.source;
        else
          throw new Error(
            "source text is required. Native MCP also accepts filePath.",
          );
      } else if (operation === "history" && args.restoreRevision) {
        const version = current.history?.find(
          (v) => v.revision === args.restoreRevision,
        );
        if (!version) throw new Error("History revision was not found.");
        definition = JSON.parse(JSON.stringify(version.definition));
      } else throw new Error(`Unknown dashboard operation: ${operation}`);
      validateDashboard(definition);
      if (all.some((d) => d.name === definition.name && d.id !== current.id))
        throw new Error("A dashboard with that name already exists.");
      const history = [
        {
          revision: current.revision,
          savedAt: current.updatedAt,
          definition: dashboardDefinition(current),
        },
        ...(current.history || []),
      ].slice(0, 20);
      while (history.length > 1 && JSON.stringify(history).length > 2_000_000)
        history.pop();
      const d = {
        ...dashboardDefinition(definition),
        id: current.id,
        createdAt: current.createdAt,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        history,
      };
      await storage.write(all.map((item) => (item.id === d.id ? d : item)));
      return dashboardMutationResult(d, current, args.verbose === true);
    });
  };
}
