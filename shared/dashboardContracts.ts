// Public schemas are consumed by agents and by save-time validation.
const string = { type: "string" },
  boolean = { type: "boolean" },
  number = { type: "number" };
const enumeration = (...values: string[]) => ({ type: "string", enum: values });
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });
export const bindingSchema = {
  type: "object",
  properties: { $bind: string, fallback: {} },
  required: ["$bind"],
  additionalProperties: false,
};
export const eventSchema = {
  type: "object",
  properties: {
    actionId: string,
    input: {},
    setState: { type: "object", additionalProperties: {} },
  },
  additionalProperties: false,
};
const column = object(
  {
    field: string,
    label: string,
    width: string,
    format: enumeration("text", "number", "date", "datetime", "badge"),
    digits: { type: "integer", minimum: 0, maximum: 10 },
    sortable: boolean,
    filterable: boolean,
    recordType: { anyOf: [string, bindingSchema] },
    recordIdField: string,
    actionId: string,
    input: {},
    labelField: string,
    tone: string,
  },
  ["field"],
);
const common = { disabled: boolean };
const specifications: Array<
  [string, string, Record<string, unknown>, string[], string[]]
> = [
  [
    "grid",
    "Responsive grid",
    { columns: { type: "integer", minimum: 1, maximum: 12 }, gap: string },
    [],
    ["default"],
  ],
  [
    "stack",
    "Flex layout",
    { direction: enumeration("row", "column"), gap: string, wrap: boolean },
    [],
    ["default"],
  ],
  [
    "card",
    "MCard",
    {
      title: string,
      description: string,
      padding: string,
      gap: string,
      outlined: boolean,
      elevated: boolean,
    },
    [],
    ["header", "default", "footer"],
  ],
  ["tabs", "Dashboard tabs", { value: string }, ["change"], ["default"]],
  [
    "text",
    "Text",
    {
      text: {},
      tone: enumeration("default", "muted", "success", "warning", "danger"),
    },
    [],
    [],
  ],
  [
    "metric",
    "Metric card",
    { label: string, value: {}, hint: string },
    [],
    ["default", "footer"],
  ],
  [
    "badge",
    "Status badge",
    {
      text: {},
      tone: enumeration("default", "success", "warning", "danger", "info"),
    },
    [],
    [],
  ],
  [
    "input",
    "MInput",
    {
      ...common,
      label: string,
      placeholder: string,
      inputType: enumeration("text", "number", "date"),
      readonly: boolean,
    },
    ["change", "enter"],
    [],
  ],
  [
    "textarea",
    "Textarea",
    {
      ...common,
      label: string,
      placeholder: string,
      rows: { type: "integer", minimum: 1, maximum: 30 },
      readonly: boolean,
    },
    ["change"],
    [],
  ],
  [
    "select",
    "MSelect",
    {
      ...common,
      label: string,
      placeholder: string,
      options: {
        type: "array",
        items: {
          anyOf: [
            string,
            object({ label: string, value: { anyOf: [string, number] } }, [
              "label",
              "value",
            ]),
          ],
        },
      },
      searchable: boolean,
    },
    ["change"],
    [],
  ],
  ["toggle", "Checkbox", { ...common, label: string }, ["change"], []],
  [
    "button",
    "PrimeVue Button",
    {
      ...common,
      label: string,
      icon: string,
      severity: enumeration(
        "primary",
        "secondary",
        "success",
        "info",
        "warn",
        "help",
        "danger",
        "contrast",
      ),
      outlined: boolean,
      text: boolean,
      size: enumeration("small", "large"),
    },
    ["click"],
    ["default"],
  ],
  [
    "table",
    "MTableStatic",
    {
      rows: { type: "array", items: { type: "object" } },
      columns: { type: "array", items: column },
      searchable: boolean,
      selection: enumeration("none", "single", "multiple"),
      rowKey: string,
      sortable: boolean,
      filterable: boolean,
      pagination: boolean,
      pageSize: { type: "integer", minimum: 1, maximum: 1000 },
      pageSizes: { type: "array", items: { type: "integer", minimum: 1 } },
      emptyText: string,
    },
    ["selectionChange", "rowClick", "sort", "page"],
    ["toolbar", "empty", "cell:<field>", "rowActions"],
  ],
  ["json", "JSON result inspector", { value: {}, label: string }, [], []],
  ["progress", "Progress meter", { value: number, label: string }, [], []],
  [
    "barChart",
    "Reactive bar chart",
    {
      rows: { type: "array", items: { type: "object" } },
      labelField: string,
      valueField: string,
      label: string,
    },
    [],
    [],
  ],
  ["richText", "Sanitized HTML/SVG", { html: string }, [], []],
  ["divider", "Divider", {}, [], []],
  [
    "repeat",
    "Live row template",
    {
      items: { type: "array" },
      keyField: string,
      maxItems: { type: "integer", minimum: 1, maximum: 1000 },
      emptyText: string,
      direction: enumeration("row", "column"),
    },
    [],
    ["default", "empty"],
  ],
  [
    "slot",
    "Named scoped slot",
    { name: string, scope: { type: "object" } },
    [],
    ["default"],
  ],
];
export const dashboardCatalog = specifications.map(
  ([type, component, properties, events, slots]) => ({
    type,
    component,
    props: Object.keys(properties).join(", "),
    propsSchema: object(
      Object.fromEntries(
        Object.entries(properties).map(([key, schema]) => [
          key,
          {
            anyOf: [
              schema,
              bindingSchema,
              { type: "object", required: ["$op"] },
            ],
          },
        ]),
      ),
    ),
    events,
    slots,
  }),
);
export const nodeSchema = object(
  {
    id: string,
    type: string,
    props: { type: "object" },
    children: { type: "array", items: { $ref: "#/$defs/node" } },
    slots: {
      type: "object",
      additionalProperties: { type: "array", items: { $ref: "#/$defs/node" } },
    },
    events: {
      type: "object",
      additionalProperties: {
        anyOf: [eventSchema, { type: "array", items: eventSchema }],
      },
    },
    style: {
      type: "object",
      additionalProperties: { anyOf: [string, number] },
    },
    visible: {},
    bind: { anyOf: [string, bindingSchema] },
    actionId: { anyOf: [string, bindingSchema] },
    input: {},
  },
  ["id", "type"],
);
export const stepSchema = object(
  {
    id: string,
    domain: enumeration("client", "server"),
    modules: { type: "array", items: string },
    code: string,
    codeFile: string,
    libraries: { type: "array", items: string },
  },
  ["id", "domain", "modules"],
);
export const actionSchema = object(
  {
    id: string,
    title: string,
    description: string,
    mode: enumeration("client", "server", "hybrid"),
    risk: enumeration("read", "write"),
    inputSchema: { type: "object" },
    input: {},
    steps: { type: "array", items: stepSchema },
    confirmation: string,
    successMessage: string,
  },
  ["id", "title", "mode", "risk", "steps"],
);
export const componentSchema = object(
  {
    description: string,
    template: { type: "array", items: { $ref: "#/$defs/node" } },
    propsSchema: { type: "object" },
    defaults: { type: "object" },
    slots: { type: "array", items: string },
    events: { type: "array", items: string },
  },
  ["description", "template"],
);
export const librarySchema = object(
  {
    domain: enumeration("client", "server", "both"),
    modules: { type: "array", items: string },
    code: string,
    codeFile: string,
  },
  ["domain", "modules"],
);
export const definitionSchema = {
  ...object(
    {
      name: string,
      title: string,
      description: string,
      mode: enumeration("client", "server", "hybrid"),
      tags: { type: "array", items: string },
      initialState: { type: "object" },
      stateSchema: { type: "object" },
      layout: { type: "array", items: nodeSchema },
      components: { type: "object", additionalProperties: componentSchema },
      account: string,
      onLoad: { type: "array", items: string },
      refresh: object(
        { actionId: string, everyMs: { type: "integer", minimum: 1000 } },
        ["actionId", "everyMs"],
      ),
      libraries: { type: "object", additionalProperties: librarySchema },
      sourceFiles: { type: "object", additionalProperties: string },
      actions: { type: "array", items: actionSchema },
    },
    [
      "name",
      "title",
      "description",
      "mode",
      "tags",
      "initialState",
      "layout",
      "components",
      "actions",
    ],
  ),
  $defs: { node: nodeSchema },
};
