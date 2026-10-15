// This entire function is evaluated inside QuickJS/WASM, never in the UI or worker's host realm.
async function run(input) {
  "use strict";
  const s = input.scenario,
    rules = input.rules;
  const copy = (value) =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const trace = [],
    logs = [],
    diagnostics = [],
    tasks = [],
    diffs = [];
  const records = copy(s.records),
    files = copy(s.files);
  const response = { body: "", headers: {}, forms: [] };
  let status = "completed",
    failure,
    activeId = input.module.id,
    stage = s.entryPoint;
  let budget =
    rules.limits[
      input.script?.metadata.scriptType || input.module.metadata.scriptType
    ] || 1000;
  let consumed = 0,
    totalUnits = 0,
    fixtureIndex = Object.create(null),
    loading = 0;
  const startTime = Date.parse(s.clock),
    NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [startTime]));
    }
    static now() {
      return startTime;
    }
  };
  let seed = s.seed >>> 0;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const normalize = (path) => {
    const out = [];
    for (const part of String(path).replace(/\\/g, "/").split("/")) {
      if (part === "..") out.pop();
      else if (part && part !== ".") out.push(part);
    }
    return out.join("/");
  };
  const sources = new Map(
    input.project.artifacts
      .filter((a) => a.kind === "Module" && a.path && a.source !== undefined)
      .map((a) => [normalize(a.path), a]),
  );
  for (const a of input.project.artifacts.filter(
    (a) =>
      a.kind === "File" &&
      a.path &&
      a.source !== undefined &&
      !/\.xml$/i.test(a.path),
  )) {
    if (!files.some((f) => normalize(f.path) === normalize(a.path)))
      files.push({
        id: a.id,
        path: normalize(a.path),
        contents: a.source,
        folder: "/",
      });
  }
  const describe = (value) =>
    value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack }
      : value;
  const emit = (label, detail = "", units = 0, artifactId = activeId) => {
    if (trace.length >= 10000) throw new Error("TRACE_LIMIT_EXCEEDED");
    trace.push({
      id: `run-${trace.length}`,
      artifactId,
      label,
      detail:
        typeof detail === "string" ? detail : JSON.stringify(describe(detail)),
      context: s.context,
      role: String(s.user.role),
      units,
      at: trace.length,
      stage,
    });
  };
  const issue = (message) => {
    if (!diagnostics.includes(message)) diagnostics.push(message);
  };
  const unsupported = (message) => {
    status = "unsupported";
    issue(message);
    emit("Unsupported behavior", message);
    const e = new Error(message);
    e.name = "SIM_UNIMPLEMENTED";
    throw e;
  };
  const charge = (api, units = rules.costs[api] || 0, target) => {
    if (loading)
      unsupported(
        `SuiteScript API invoked while AMD module is initializing: ${api}`,
      );
    consumed += units;
    totalUnits += units;
    emit(
      api,
      `${units} units · ${Math.max(0, budget - consumed)} remaining`,
      units,
      target || activeId,
    );
    if (consumed > budget) {
      status = "failed";
      issue(`Governance exceeded in ${stage}`);
      const e = new Error("SSS_USAGE_LIMIT_EXCEEDED");
      e.name = e.message;
      throw e;
    }
  };
  const targetId = (type) =>
    input.project.artifacts.some((a) => a.id === type) ? type : activeId;
  const required = (value, name) => {
    if (value === undefined || value === null || value === "")
      throw new Error(`SSS_MISSING_REQD_ARGUMENT: ${name}`);
    return value;
  };
  const recordCost = (op, type) =>
    rules.recordCosts[op][
      String(type).startsWith("customrecord")
        ? 0
        : [
              "salesorder",
              "purchaseorder",
              "invoice",
              "cashsale",
              "creditmemo",
              "vendorbill",
              "itemfulfillment",
              "itemreceipt",
            ].includes(type)
          ? 2
          : 1
    ];
  const findRecord = (type, id) => {
    const r = records.find(
      (r) => r.type === type && String(r.id) === String(id),
    );
    if (!r) throw new Error(`RCRD_DSNT_EXIST: ${type} ${id}`);
    return r;
  };
  const change = (type, id, before, after) => {
    diffs.push({ type, id, before: copy(before), after: copy(after) });
    emit("Record changed", { type, id, before, after }, 0, targetId(type));
  };
  const schema = (type) =>
    input.project.artifacts.find((a) => a.id === type)?.schema || [];
  function recordObject(data, readOnly = false) {
    const textSet = new Set(),
      valueSet = new Set();
    const writable = () => {
      if (readOnly)
        throw new Error(
          "SSS_RECORD_TYPE_MISMATCH: afterSubmit/oldRecord is read-only",
        );
    };
    const obj = {
      get id() {
        return data.id;
      },
      type: data.type,
      isDynamic: false,
      getValue(o) {
        return data.fields[typeof o === "string" ? o : o.fieldId] ?? null;
      },
      setValue(o) {
        writable();
        required(o.fieldId, "fieldId");
        data.fields[o.fieldId] = copy(o.value);
        valueSet.add(o.fieldId);
        return obj;
      },
      getFields() {
        return Object.keys(data.fields);
      },
      setText(o) {
        writable();
        const def = schema(data.type).find((f) => f.id === o.fieldId);
        const options = (s.selectOptions || []).filter(
          (f) => f.recordType === data.type && f.fieldId === o.fieldId,
        );
        if ((def && /SELECT/.test(def.type)) || options.length) {
          const match = options.find((f) => f.text === o.text);
          if (!match)
            return unsupported(
              `Record.setText requires a selectOptions mapping for ${data.type}.${o.fieldId}: ${o.text}`,
            );
          data.fields[o.fieldId] = match.value;
          issue(
            "Select display text uses explicit scenario mappings; account sourcing is not modeled.",
          );
        } else data.fields[o.fieldId] = o.text;
        textSet.add(o.fieldId);
        return obj;
      },
      getText(o) {
        if (valueSet.has(o.fieldId) && !textSet.has(o.fieldId))
          throw new Error(
            "SSS_INVALID_API_USAGE: getText after setValue in standard mode",
          );
        const v = data.fields[o.fieldId];
        if (v == null) return null;
        const option = (s.selectOptions || []).find(
          (f) =>
            f.recordType === data.type &&
            f.fieldId === o.fieldId &&
            String(f.value) === String(v),
        );
        if (option) return option.text;
        if (
          schema(data.type).some(
            (f) => f.id === o.fieldId && /SELECT/.test(f.type),
          )
        )
          return unsupported(
            `Record.getText requires a selectOptions mapping for ${data.type}.${o.fieldId}`,
          );
        if (typeof v === "string") return v;
        return unsupported(
          `Record.getText needs display text for ${o.fieldId}`,
        );
      },
      getLineCount(o) {
        return data.sublists?.[o.sublistId]?.length || 0;
      },
      getSublistValue(o) {
        return data.sublists?.[o.sublistId]?.[o.line]?.[o.fieldId] ?? null;
      },
      setSublistValue(o) {
        writable();
        data.sublists ||= {};
        const lines = (data.sublists[o.sublistId] ||= []);
        if (!Number.isInteger(o.line) || o.line < 0 || o.line > lines.length)
          throw new Error("SSS_INVALID_SUBLIST_OPERATION");
        lines[o.line] ||= {};
        lines[o.line][o.fieldId] = copy(o.value);
        return obj;
      },
      save(options = {}) {
        writable();
        charge(
          "N/record.save",
          recordCost("save", data.type),
          targetId(data.type),
        );
        if (!options.ignoreMandatoryFields)
          for (const f of schema(data.type))
            if (
              f.required &&
              (data.fields[f.id] == null || data.fields[f.id] === "")
            )
              throw new Error(`USER_ERROR: Missing required field ${f.id}`);
        const existing = records.find(
          (r) => r.type === data.type && String(r.id) === String(data.id),
        );
        const before = existing ? copy(existing.fields) : null;
        if (!data.id)
          data.id =
            Math.max(
              0,
              ...records
                .filter((r) => r.type === data.type)
                .map((r) => Number(r.id) || 0),
            ) + 1;
        if (existing) Object.assign(existing, copy(data));
        else records.push(copy(data));
        change(data.type, data.id, before, data.fields);
        return data.id;
      },
    };
    return guarded("Record", obj);
  }
  function fixture(api, args, units = 0) {
    charge(api, units);
    const matches = s.apiFixtures.filter(
      (f) =>
        f.api === api &&
        (f.args === undefined ||
          JSON.stringify(f.args) === JSON.stringify(args)),
    );
    const key = `${api}:${JSON.stringify(args)}`;
    const item = matches[fixtureIndex[key] || 0];
    if (!item)
      return unsupported(
        `No explicit fixture for ${api}. Supply apiFixtures with api, optional args and result/error.`,
      );
    fixtureIndex[key] = (fixtureIndex[key] || 0) + 1;
    issue(`${api} used an explicit scenario fixture; behavior is approximate.`);
    if (item.error) throw new Error(item.error);
    return copy(item.result);
  }
  function guarded(name, object) {
    return new Proxy(object, {
      get(target, key) {
        if (key in target || typeof key === "symbol") return target[key];
        if (key === "then" || key === "toJSON") return undefined;
        return (...args) => fixture(`${name}.${key}`, args);
      },
    });
  }
  const enums = (values) => Object.fromEntries(values.map((v) => [v, v]));
  const modules = Object.create(null);
  modules["N/log"] = Object.fromEntries(
    ["debug", "audit", "error", "emergency"].map((level) => [
      level,
      (arg, details) => {
        const entry =
          typeof arg === "object" && arg !== null
            ? arg
            : { title: arg, details };
        const row = {
          level,
          title: String(entry.title || ""),
          details: copy(describe(entry.details)),
        };
        if (logs.length >= 2000) throw new Error("LOG_LIMIT_EXCEEDED");
        logs.push(row);
        emit(`log.${level}`, row);
      },
    ]),
  );
  globalThis.log = modules["N/log"];
  const params = {
    ...JSON.parse(input.script?.metadata.parameters || "{}"),
    ...JSON.parse(input.deployment?.metadata.parameters || "{}"),
    ...s.parameters,
  };
  modules["N/runtime"] = {
    executionContext: s.context,
    accountId: "LOCAL_SIMULATION",
    envType: "SANDBOX",
    version: input.project.release,
    ContextType: enums([
      "USERINTERFACE",
      "RESTLET",
      "SUITELET",
      "SCHEDULED",
      "MAPREDUCE",
      "USEREVENT",
      "RESTWEBSERVICES",
      "CSVIMPORT",
    ]),
    getCurrentScript: () => ({
      id: input.script?.id || input.module.id,
      deploymentId: input.deployment?.id || "local",
      getParameter: ({ name }) => params[name] ?? null,
      getRemainingUsage: () => Math.max(0, budget - consumed),
    }),
    getCurrentUser: () => ({
      ...s.user,
      getPreference: ({ name }) => s.input.preferences?.[name] ?? null,
    }),
    isFeatureInEffect: ({ feature }) =>
      Boolean(s.input.features?.includes(feature)),
  };
  modules["N/error"] = {
    create: ({ name, message }) => Object.assign(new Error(message), { name }),
  };
  modules["N/record"] = {
    Type: {
      SALES_ORDER: "salesorder",
      CUSTOMER: "customer",
      EMPLOYEE: "employee",
      INVOICE: "invoice",
      PURCHASE_ORDER: "purchaseorder",
    },
    create(o) {
      required(o.type, "type");
      if (o.isDynamic)
        return unsupported(
          "Dynamic record sourcing is not implemented. Use a standard-mode scenario.",
        );
      charge("N/record.create", recordCost("create", o.type), targetId(o.type));
      return recordObject({
        type: o.type,
        id: null,
        fields: copy(o.defaultValues || {}),
      });
    },
    load(o) {
      if (o.isDynamic)
        return unsupported("Dynamic record mode is not implemented.");
      charge("N/record.load", recordCost("load", o.type), targetId(o.type));
      return recordObject(copy(findRecord(o.type, o.id)));
    },
    submitFields(o) {
      charge(
        "N/record.submitFields",
        recordCost("submitFields", o.type),
        targetId(o.type),
      );
      const r = findRecord(o.type, o.id),
        before = copy(r.fields);
      Object.assign(r.fields, copy(o.values));
      change(o.type, o.id, before, r.fields);
      return r.id;
    },
    delete(o) {
      charge("N/record.delete", recordCost("delete", o.type), targetId(o.type));
      const r = findRecord(o.type, o.id);
      records.splice(records.indexOf(r), 1);
      change(o.type, o.id, r.fields, null);
      return r.id;
    },
  };
  const normalizedQuery = (query) =>
    String(query).replace(/\s+/g, " ").trim().replace(/;$/, "");
  modules["N/query"] = {
    runSuiteQL(o) {
      charge("N/query.runSuiteQL");
      const sql = normalizedQuery(typeof o === "string" ? o : o.query),
        params = o.params || [];
      const found = s.queryFixtures.find(
        (f) =>
          normalizedQuery(f.query) === sql &&
          JSON.stringify(f.params || []) === JSON.stringify(params),
      );
      if (!found)
        return unsupported(
          `No SuiteQL fixture for: ${sql} ; params=${JSON.stringify(params)}. SQL is not silently approximated.`,
        );
      if (found.rows.length > 5000)
        throw new Error(
          "SuiteQL fixture exceeds the 5,000 row limit; paging is required.",
        );
      issue(
        "SuiteQL results are supplied by exact-query fixtures, not an Oracle SQL engine.",
      );
      const rows = copy(found.rows);
      return {
        asMappedResults: () => copy(rows),
        results: rows.map((row) => ({
          values: Object.values(row),
          asMap: () => copy(row),
        })),
      };
    },
  };
  function fileObject(data) {
    const obj = {
      ...data,
      name: data.path.split("/").pop(),
      fileType: data.fileType || "PLAINTEXT",
      getContents() {
        if (data.contents.length > 10 * 1024 * 1024)
          throw new Error("SSS_FILE_CONTENT_SIZE_EXCEEDED");
        return data.contents;
      },
      lines: {
        iterator: () => ({
          each: (callback) => {
            for (const value of data.contents.split(/\r?\n/))
              if (callback({ value }) === false) break;
          },
        }),
      },
      save() {
        charge("N/file.save");
        required(obj.folder, "folder");
        const previous = files.find((f) => String(f.id) === String(obj.id));
        if (!obj.id)
          obj.id = Math.max(0, ...files.map((f) => Number(f.id) || 0)) + 1;
        const saved = {
          id: obj.id,
          path: obj.path,
          contents: data.contents,
          folder: obj.folder,
        };
        if (previous) Object.assign(previous, saved);
        else files.push(saved);
        return obj.id;
      },
    };
    return guarded("File", obj);
  }
  modules["N/file"] = {
    Type: enums([
      "PLAINTEXT",
      "JSON",
      "HTMLDOC",
      "CSV",
      "JAVASCRIPT",
      "XMLDOC",
    ]),
    Encoding: enums(["UTF8", "UTF_8"]),
    load(o) {
      charge("N/file.load");
      const id = typeof o === "object" ? o.id : o;
      const path = normalize(
        String(id).startsWith(".")
          ? `${input.module.path.slice(0, input.module.path.lastIndexOf("/") + 1)}${id}`
          : id,
      );
      const f = files.find(
        (f) => String(f.id) === String(id) || normalize(f.path) === path,
      );
      if (!f) throw new Error(`RCRD_DSNT_EXIST: virtual file ${id}`);
      return fileObject(copy(f));
    },
    create(o) {
      return fileObject({
        id: null,
        path: `${o.folder || ""}/${required(o.name, "name")}`,
        contents: String(o.contents || ""),
        folder: o.folder,
        fileType: o.fileType,
      });
    },
    delete(o) {
      charge("N/file.delete");
      const idx = files.findIndex((f) => String(f.id) === String(o.id));
      if (idx < 0) throw new Error("RCRD_DSNT_EXIST: file");
      files.splice(idx, 1);
    },
  };
  function http(method, o) {
    charge("N/https.request");
    const f = s.httpFixtures.find(
      (f) => f.url === o.url && f.method.toUpperCase() === method.toUpperCase(),
    );
    if (!f)
      return unsupported(`Network denied: no ${method} fixture for ${o.url}`);
    issue("HTTPS responses are local fixtures; no request was sent.");
    emit("Mock HTTP response", { method, url: o.url, code: f.code });
    return { code: f.code, body: f.body, headers: {} };
  }
  modules["N/https"] = {
    Method: enums(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"]),
    request: (o) => http(o.method || "GET", o),
  };
  for (const method of ["get", "post", "put", "delete", "patch"]) {
    const fn = (o) => http(method.toUpperCase(), o);
    fn.promise = async (o) => fn(o);
    modules["N/https"][method] = fn;
  }
  modules["N/task"] = {
    TaskType: {
      SCHEDULED_SCRIPT: "SCHEDULED_SCRIPT",
      MAP_REDUCE: "MAP_REDUCE",
    },
    TaskStatus: enums(["PENDING", "PROCESSING", "COMPLETE", "FAILED"]),
    create(o) {
      const task = {
        ...copy(o),
        submit() {
          if (!["SCHEDULED_SCRIPT", "MAP_REDUCE"].includes(task.taskType))
            return unsupported(`Task type ${task.taskType}`);
          charge("N/task.submit");
          const id = `sim-task-${tasks.length + 1}`;
          tasks.push({
            id,
            taskType: task.taskType,
            scriptId: task.scriptId,
            deploymentId: task.deploymentId,
            params: copy(task.params || {}),
            status: "PENDING",
            role: s.user.role,
          });
          issue(
            "Submitted tasks are recorded as queued; run the target script separately with these parameters.",
          );
          return id;
        },
      };
      return task;
    },
    checkStatus: (o) => {
      const t = tasks.find(
        (t) => t.id === (typeof o === "string" ? o : o.taskId),
      );
      if (!t) throw new Error("INVALID_TASK_ID");
      return copy(t);
    },
  };
  const iterator = (entries) => ({
    iterator: () => ({
      each: (fn) => {
        for (const row of entries) if (fn(...row) === false) break;
      },
    }),
  });
  const searchResult = (row) => ({
    id: row.id,
    recordType: row.type,
    getValue: (o) => row.fields[typeof o === "string" ? o : o.name] ?? null,
    getText: (o) =>
      String(row.fields[typeof o === "string" ? o : o.name] ?? ""),
  });
  modules["N/search"] = {
    Type: modules["N/record"].Type,
    Operator: { IS: "is", ANYOF: "anyof", EQUALTO: "equalto" },
    Sort: { ASC: "ASC", DESC: "DESC" },
    createColumn: (o) => copy(o),
    createFilter: (o) => copy(o),
    lookupFields(o) {
      charge("N/search.lookupFields");
      const record = findRecord(o.type, o.id);
      return Object.fromEntries(
        o.columns.map((c) => [c, copy(record.fields[c] ?? null)]),
      );
    },
    create(o) {
      const results = () => {
        if (o.filters?.length)
          return unsupported(
            "Search filter evaluation requires an explicit saved-search fixture in this runtime.",
          );
        return records.filter((r) => r.type === o.type).map(searchResult);
      };
      return {
        run: () => ({
          getRange: ({ start, end }) => {
            charge("N/search.getRange");
            if (end - start > 1000)
              throw new Error("SSS_SEARCH_RESULT_LIMIT_EXCEEDED");
            return results().slice(start, end);
          },
          each: (fn) => {
            charge("N/search.each");
            for (const row of results().slice(0, 4000))
              if (fn(row) === false) break;
          },
        }),
      };
    },
    load(o) {
      const rows = fixture("N/search.load", [o], 5);
      if (!Array.isArray(rows))
        throw new Error("Search fixture must contain record-shaped rows.");
      return {
        run: () => ({
          getRange: ({ start, end }) => {
            charge("N/search.getRange");
            return rows.slice(start, end).map(searchResult);
          },
          each: (fn) => {
            charge("N/search.each");
            for (const row of rows.slice(0, 4000))
              if (fn(searchResult(row)) === false) break;
          },
        }),
      };
    },
  };
  modules["N/llm"] = {
    ModelFamily: copy(s.input.modelFamilies || {}),
    ChatRole: enums(["USER", "CHATBOT", "SYSTEM", "TOOL"]),
    ParamType: enums(["STRING", "NUMBER", "BOOLEAN", "OBJECT", "ARRAY"]),
    createTool: (o) => copy(o),
    createToolParameter: (o) => copy(o),
    createToolResult: (o) => copy(o),
    generateText: (o) =>
      fixture("N/llm.generateText", [o], rules.costs["N/llm.generateText"]),
  };
  modules["N/llm"].generateText.promise = async (o) =>
    modules["N/llm"].generateText(o);
  modules["N/crypto"] = {
    EncryptionAlg: { AES: "AES" },
    Padding: { PKCS5Padding: "PKCS5Padding" },
    HashAlg: { SHA256: "SHA256", SHA512: "SHA512" },
  };
  modules["N/encode"] = {
    Encoding: enums(["UTF_8", "BASE_64", "BASE_64_URL_SAFE", "HEX"]),
  };
  modules["N/config"] = {
    Type: enums(["COMPANY_INFORMATION", "USER_PREFERENCES"]),
  };
  modules["N/ui/serverWidget"] = {
    FieldType: enums(["INLINEHTML", "TEXT", "LONGTEXT", "SELECT", "CHECKBOX"]),
    createForm(o) {
      const form = {
        title: o.title,
        fields: [],
        addField(options) {
          const field = { ...options, defaultValue: "" };
          form.fields.push(field);
          return field;
        },
      };
      issue(
        "ServerWidget is a captured form model; browser UI behavior is not simulated.",
      );
      return form;
    },
  };
  const cache = new Map(),
    resolving = new Set();
  function load(reference, parent = "") {
    if (reference === "N")
      return guarded(
        "N",
        Object.fromEntries(
          Object.entries(modules).map(([name, api]) => [
            name.slice(2),
            guarded(name, api),
          ]),
        ),
      );
    if (reference.startsWith("N/")) {
      if (!modules[reference]) modules[reference] = {};
      return guarded(reference, modules[reference]);
    }
    if (/^[a-z]+:/i.test(reference))
      return unsupported(`Remote AMD module is not permitted: ${reference}`);
    const path = normalize(
      reference.startsWith(".")
        ? `${parent.slice(0, parent.lastIndexOf("/") + 1)}${reference}`
        : reference,
    );
    const resolved = sources.has(path)
      ? path
      : sources.has(`${path}.js`)
        ? `${path}.js`
        : undefined;
    if (!resolved)
      return unsupported(`AMD module not found: ${reference} (from ${parent})`);
    if (cache.has(resolved)) return cache.get(resolved);
    if (resolving.has(resolved))
      return unsupported(`Cyclic AMD initialization: ${resolved}`);
    const artifact = sources.get(resolved);
    resolving.add(resolved);
    emit("Load module", resolved, 0, artifact.id);
    let value,
      defined = false;
    const require = (deps, callback) => {
      if (typeof deps === "string") return load(deps, resolved);
      const values = deps.map((dep) => load(dep, resolved));
      return callback ? callback(...values) : values;
    };
    const define = (...args) => {
      if (defined) throw new Error(`Multiple define calls: ${resolved}`);
      defined = true;
      if (typeof args[0] === "string") args.shift();
      const deps = Array.isArray(args[0]) ? args.shift() : [];
      const factory = args[0],
        exports = {},
        module = { exports };
      const dependencies = deps.map((dep) =>
        dep === "require"
          ? require
          : dep === "exports"
            ? exports
            : dep === "module"
              ? module
              : load(dep, resolved),
      );
      loading++;
      try {
        value =
          typeof factory === "function" ? factory(...dependencies) : factory;
        if (value === undefined) value = module.exports;
      } finally {
        loading--;
      }
    };
    define.amd = {};
    // Function belongs to the QuickJS realm. It has no DOM, fetch, worker, Node or host filesystem.
    new Function(
      "define",
      "require",
      `${artifact.source}\n//# sourceURL=${resolved.replace(/[\r\n]/g, "")}`,
    )(define, require);
    if (!defined)
      throw new Error(`SuiteScript source has no AMD define(): ${resolved}`);
    resolving.delete(resolved);
    cache.set(resolved, value);
    return value;
  }
  async function invoke(module, name, context, limit) {
    if (typeof module[name] !== "function")
      throw new Error(`ENTRY_POINT_NOT_FOUND: ${name}`);
    stage = name;
    consumed = 0;
    if (limit) budget = limit;
    emit(`Enter ${name}`);
    const value = await module[name](context);
    emit(`Exit ${name}`);
    return value;
  }
  let value;
  try {
    const deployment = input.deployment?.metadata;
    if (deployment) {
      const contexts = (deployment.contexts || "")
        .split(/[|,\s]+/)
        .filter(Boolean)
        .map((v) => v.replace(/_/g, "").toUpperCase());
      if (
        deployment.deployed === "F" ||
        (contexts.length &&
          !contexts.includes(s.context.replace(/_/g, "").toUpperCase())) ||
        (deployment.eventType &&
          deployment.eventType.toLowerCase() !==
            String(s.input.eventType || "edit").toLowerCase())
      ) {
        status = "filtered";
        emit("Deployment filtered", input.deployment.id);
      }
      if (deployment.status === "TESTING" && s.input.allowTesting !== true) {
        status = "filtered";
        issue(
          "Testing deployment requires input.allowTesting: true for this local user.",
        );
      }
      if (deployment.role)
        issue(
          `Deployment role ${deployment.role}; scenario effective role ${s.user.role}. Audience/permission enforcement is not modeled.`,
        );
    }
    if (status !== "filtered") {
      const module = load(input.module.path);
      if (s.entryPoint === "inspect") value = { exports: Object.keys(module) };
      else if (s.entryPoint === "pipeline") {
        issue(
          "Map/Reduce uses deterministic sequential scheduling. Processor concurrency, restarts, soft yielding and persisted-data limits are not modeled.",
        );
        let rows = [],
          inputError,
          mapErrors = [],
          reduceErrors = [],
          output = [];
        try {
          const data = await invoke(
            module,
            "getInputData",
            {},
            rules.limits.getInputData,
          );
          if (Array.isArray(data)) rows = data.map((v, i) => [String(i), v]);
          else if (
            data &&
            typeof data === "object" &&
            Object.getPrototypeOf(data) === Object.prototype
          )
            rows = Object.entries(data);
          else if (data != null)
            unsupported(
              "Map/Reduce input must be an array or plain object; search/file input references need adapters.",
            );
        } catch (error) {
          inputError = JSON.stringify(describe(error));
        }
        if (rows.length > 10000)
          throw new Error("LOCAL_MAP_REDUCE_INPUT_LIMIT");
        const writeTo = (list) => (arg, val) => {
          const key = String(typeof arg === "object" ? arg.key : arg),
            value = typeof arg === "object" ? arg.value : val;
          if (key.length > 3000)
            throw new Error("KEY_LENGTH_IS_OVER_3000_BYTES");
          list.push([
            key,
            typeof value === "string" ? value : JSON.stringify(value),
          ]);
        };
        for (const [key, row] of rows) {
          if (!module.map) {
            output.push([
              key,
              typeof row === "string" ? row : JSON.stringify(row),
            ]);
            continue;
          }
          try {
            await invoke(
              module,
              "map",
              {
                key,
                value: typeof row === "string" ? row : JSON.stringify(row),
                write: writeTo(output),
                isRestarted: false,
                executionNo: 1,
                errors: iterator([]),
              },
              rules.limits.map,
            );
          } catch (error) {
            mapErrors.push([key, JSON.stringify(describe(error)), 1]);
          }
        }
        if (module.reduce) {
          const groups = new Map(),
            reduced = [];
          for (const [key, v] of output) {
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(v);
          }
          for (const [key, values] of groups) {
            try {
              await invoke(
                module,
                "reduce",
                {
                  key,
                  values,
                  write: writeTo(reduced),
                  isRestarted: false,
                  executionNo: 1,
                  errors: iterator([]),
                },
                rules.limits.reduce,
              );
            } catch (error) {
              reduceErrors.push([key, JSON.stringify(describe(error)), 1]);
            }
          }
          output = reduced;
        }
        const summary = {
          usage: totalUnits,
          seconds: 0,
          yields: 0,
          concurrency: 1,
          isRestarted: false,
          dateCreated: new Date(),
          inputSummary: { error: inputError },
          mapSummary: { errors: iterator(mapErrors) },
          reduceSummary: { errors: iterator(reduceErrors) },
          output: iterator(output),
        };
        if (module.summarize)
          await invoke(module, "summarize", summary, rules.limits.summarize);
        value = { output, inputError, mapErrors, reduceErrors };
        if (
          (inputError || mapErrors.length || reduceErrors.length) &&
          status !== "unsupported"
        )
          status = "failed";
      } else if (s.entryPoint === "userEvent") {
        if (s.context.replace(/_/g, "").toUpperCase() === "USEREVENT") {
          status = "filtered";
          emit("User Event chaining suppressed");
        } else {
          const type = required(s.input.recordType, "input.recordType"),
            id = s.input.id || 1,
            eventType = s.input.eventType || "edit";
          if (!["create", "edit", "xedit", "delete"].includes(eventType))
            unsupported(`User Event type ${eventType}`);
          if (
            deployment?.recordType &&
            deployment.recordType !== type &&
            deployment.recordType !== `[scriptid=${type}]`
          ) {
            status = "filtered";
            emit("Deployment record type filtered");
          } else {
            const old =
              eventType === "create" ? null : copy(findRecord(type, id));
            const data = {
              type,
              id,
              fields:
                eventType === "xedit"
                  ? copy(s.input.values || {})
                  : { ...(old?.fields || {}), ...copy(s.input.values || {}) },
            };
            const context = {
              type: eventType,
              UserEventType: {
                CREATE: "create",
                EDIT: "edit",
                XEDIT: "xedit",
                DELETE: "delete",
              },
              newRecord: recordObject(data),
              oldRecord: old ? recordObject(old, true) : null,
            };
            if (module.beforeSubmit)
              await invoke(module, "beforeSubmit", context, 1000);
            const before = old?.fields || null,
              existing = records.find(
                (r) => r.type === type && String(r.id) === String(id),
              );
            const committed = {
              type,
              id,
              fields: { ...(old?.fields || {}), ...data.fields },
            };
            if (eventType === "delete")
              records.splice(records.indexOf(existing), 1);
            else if (existing) Object.assign(existing, copy(committed));
            else records.push(copy(committed));
            change(
              type,
              id,
              before,
              eventType === "delete" ? null : committed.fields,
            );
            emit("Database commit");
            if (module.afterSubmit)
              await invoke(
                module,
                "afterSubmit",
                { ...context, newRecord: recordObject(copy(data), true) },
                1000,
              );
            value = eventType === "delete" ? null : committed;
          }
        }
      } else {
        let context = copy(s.input);
        if (s.entryPoint === "onRequest")
          context = {
            request: {
              method: s.input.method || "GET",
              parameters: s.input.parameters || {},
              body: s.input.body || "",
              headers: s.input.headers || {},
              url: "https://local.invalid/suitelet",
            },
            response: {
              write: (arg) => {
                const text = typeof arg === "object" ? arg.output : arg;
                if (
                  response.body.length + String(text).length >
                  2 * 1024 * 1024
                )
                  throw new Error("LOCAL_RESPONSE_LIMIT");
                response.body += String(text);
              },
              setHeader: (arg, val) => {
                response.headers[typeof arg === "object" ? arg.name : arg] =
                  typeof arg === "object" ? arg.value : val;
              },
              addHeader: (arg) => {
                response.headers[arg.name] = arg.value;
              },
              writePage: (arg) => {
                response.forms.push(copy(arg.pageObject || arg));
              },
            },
          };
        value = await invoke(module, s.entryPoint, context);
      }
    }
  } catch (error) {
    if (status !== "unsupported") status = "failed";
    failure = `${error.name}: ${error.message}`;
    emit("Execution error", describe(error));
  }
  return {
    status,
    fidelity: status === "unsupported" ? "UNIMPLEMENTED" : "APPROXIMATE",
    behaviorPack: rules.id,
    value: copy(value),
    error: failure,
    trace,
    logs,
    records,
    files,
    tasks,
    diffs,
    diagnostics,
    response,
  };
}
