import type { DashboardDefinition } from "./api";
export function dashboardTemplate(
  mode: "client" | "server" | "hybrid",
  suffix: string,
): DashboardDefinition {
  const client = {
    id: "context",
    domain: "client" as const,
    modules: ["currentRecord", "runtime"],
    code: "const rec = currentRecord.get();\nreturn { recordId: rec.id || null, recordType: rec.type, accountId: runtime.accountId };",
  };
  const server = {
    id: "files",
    domain: "server" as const,
    modules: ["query"],
    code: "return { rows: query.runSuiteQL({ query: 'SELECT id, name, filetype FROM file WHERE ROWNUM <= ?', params: [input.limit] }).asMappedResults() };",
  };
  const hybrid = {
    id: "details",
    domain: "server" as const,
    modules: ["record"],
    code: "if (!previous.recordId) throw new Error('Open a saved NetSuite record first.');\nconst rec = record.load({type: previous.recordType, id: previous.recordId});\nreturn { recordId: rec.id, recordType: rec.type, fields: rec.getFields() };",
  };
  return {
    name: `dashboard_${suffix}`,
    title:
      mode === "client"
        ? "Current record helper"
        : mode === "server"
          ? "File Cabinet snapshot"
          : "Record inspector",
    description:
      mode === "hybrid"
        ? "Read the current record in the browser, then load its fields on the server."
        : mode === "server"
          ? "Inspect recent File Cabinet entries without repeating queries."
          : "Check the current NetSuite record and account in one click.",
    mode,
    tags: ["starter", "suitescript"],
    initialState: { limit: 25 },
    components: {},
    actions: [
      {
        id: "refresh",
        title: "Load snapshot",
        mode,
        risk: "read",
        input: mode === "server" ? { limit: { $bind: "state.limit" } } : {},
        inputSchema: {
          type: "object",
          properties:
            mode === "server"
              ? { limit: { type: "integer", minimum: 1, maximum: 100 } }
              : {},
          required: mode === "server" ? ["limit"] : [],
        },
        steps:
          mode === "client"
            ? [client]
            : mode === "server"
              ? [server]
              : [client, hybrid],
      },
    ],
    layout: [
      {
        id: "controls",
        type: "card",
        props: {
          title: "Quick actions",
          description:
            "Uses the connected NetSuite account. Run when you need a fresh snapshot.",
        },
        children: [
          ...(mode === "server"
            ? [
                {
                  id: "limit",
                  type: "input",
                  bind: "state.limit",
                  props: { label: "Maximum files", inputType: "number" },
                },
              ]
            : []),
          {
            id: "load",
            type: "button",
            actionId: "refresh",
            props: { label: "Load snapshot", icon: "pi pi-refresh" },
          },
        ],
      },
      mode === "server"
        ? {
            id: "files",
            type: "table",
            props: {
              rows: { $bind: "results.refresh.result.rows", fallback: [] },
              columns: [
                { field: "id", label: "ID" },
                { field: "name", label: "Name" },
                { field: "filetype", label: "Type" },
              ],
              searchable: true,
            },
          }
        : {
            id: "result",
            type: "json",
            props: {
              label: "Snapshot",
              value: {
                $bind: "results.refresh.result",
                fallback: "Run Load snapshot to see live data.",
              },
            },
          },
    ],
  };
}
