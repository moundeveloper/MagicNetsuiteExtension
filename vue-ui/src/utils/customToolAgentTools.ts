import type { ToolDefinition } from "../composables/useAgent";
import {
  executeCustomTool,
  executeCustomToolDraft,
  getCustomTool,
  saveCustomTool,
  saveCustomToolTestState,
  searchCustomTools,
  type CustomToolDomain,
  type CustomToolModule
} from "./customToolsDb";

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const requestedDomain = (value: unknown): "client" | "server" | undefined =>
  value === "client" || value === "server" ? value : undefined;

export const customToolAgentTools: ToolDefinition[] = [
  {
    name: "magic_netsuite_search_custom_tools",
    description:
      "Search user-created Magic NetSuite tools. Call this when the user asks for an account-specific workflow or capability that may have been implemented locally. Returns metadata and input schemas, never source code.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords describing the needed capability. Leave empty to list all active custom tools." }
      },
      required: []
    },
    execute: async (input) => ({ results: await searchCustomTools(String(input.query ?? "")) })
  },
  {
    name: "magic_netsuite_create_custom_tool",
    description:
      "Create a new user-editable custom NetSuite tool. If the name already exists, use magic_netsuite_update_custom_tool. AI-created tools are always saved as drafts for review.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Lowercase snake_case tool name." },
        displayName: { type: "string", description: "Short user-facing name." },
        description: { type: "string", description: "Precise routing description explaining when the AI should use the tool." },
        tags: { type: "array", description: "Search tags.", items: { type: "string" } },
        domain: { type: "string", description: "Allowed execution domain.", enum: ["client", "server", "both"] },
        modules: { type: "array", description: "SuiteScript module short names allowed by the selected domain.", items: { type: "string" } },
        inputSchema: { type: "object", description: "JSON Schema object describing tool input." },
        testInput: { type: "object", description: "Concrete test arguments matching inputSchema. Saved with this tool and used by the test operation." },
        code: { type: "string", description: "JavaScript function body. Read arguments from input and return JSON-serializable data." },
        risk: { type: "string", description: "Whether the implementation can mutate state.", enum: ["read", "write"] }
      },
      required: ["name", "displayName", "description", "domain", "modules", "inputSchema", "testInput", "code", "risk"]
    },
    execute: async (input) => {
      const existing = await getCustomTool(String(input.name || ""));
      if (existing) throw new Error(`Custom tool "${existing.name}" already exists. Use magic_netsuite_update_custom_tool to edit it.`);
      const saved = await saveCustomTool({
        name: String(input.name || ""),
        displayName: String(input.displayName || ""),
        description: String(input.description || ""),
        tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
        domain: String(input.domain || "both") as CustomToolDomain,
        modules: Array.isArray(input.modules) ? input.modules.map(String) as CustomToolModule[] : [],
        inputSchema: asObject(input.inputSchema),
        testInput: asObject(input.testInput),
        code: String(input.code || ""),
        status: "draft",
        risk: input.risk === "write" ? "write" : "read",
        enabled: true
      });
      return { created: true, status: "draft", tool: saved, nextAction: "Test this draft with magic_netsuite_test_custom_tool." };
    }
  },
  {
    name: "magic_netsuite_update_custom_tool",
    description:
      "Update an existing user-created custom NetSuite tool by exact name. Fields are partial; omitted fields are preserved. AI edits return the tool to draft status for user review.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        toolName: { type: "string", description: "Exact current custom tool name." },
        name: { type: "string", description: "Optional replacement snake_case name." },
        displayName: { type: "string", description: "Optional replacement display name." },
        description: { type: "string", description: "Optional replacement routing description." },
        tags: { type: "array", description: "Optional complete replacement tag list.", items: { type: "string" } },
        domain: { type: "string", description: "Optional replacement execution domain.", enum: ["client", "server", "both"] },
        modules: { type: "array", description: "Optional complete replacement module list.", items: { type: "string" } },
        inputSchema: { type: "object", description: "Optional replacement JSON input schema." },
        testInput: { type: "object", description: "Optional replacement saved test arguments." },
        code: { type: "string", description: "Optional replacement JavaScript function body." },
        risk: { type: "string", description: "Optional replacement risk classification.", enum: ["read", "write"] },
        enabled: { type: "boolean", description: "Optional enabled state." }
      },
      required: ["toolName"]
    },
    execute: async (input) => {
      const existing = await getCustomTool(String(input.toolName || ""));
      if (!existing) throw new Error(`Custom tool "${String(input.toolName || "")}" was not found.`);
      const saved = await saveCustomTool({
        ...existing,
        id: existing.id,
        name: input.name === undefined ? existing.name : String(input.name),
        displayName: input.displayName === undefined ? existing.displayName : String(input.displayName),
        description: input.description === undefined ? existing.description : String(input.description),
        tags: input.tags === undefined ? existing.tags : Array.isArray(input.tags) ? input.tags.map(String) : [],
        domain: input.domain === undefined ? existing.domain : String(input.domain) as CustomToolDomain,
        modules: input.modules === undefined ? existing.modules : Array.isArray(input.modules) ? input.modules.map(String) as CustomToolModule[] : [],
        inputSchema: input.inputSchema === undefined ? existing.inputSchema : asObject(input.inputSchema),
        testInput: input.testInput === undefined ? existing.testInput : asObject(input.testInput),
        code: input.code === undefined ? existing.code : String(input.code),
        risk: input.risk === undefined ? existing.risk : input.risk === "write" ? "write" : "read",
        enabled: input.enabled === undefined ? existing.enabled : Boolean(input.enabled),
        status: "draft"
      });
      return { updated: true, status: "draft", tool: saved };
    }
  },
  {
    name: "magic_netsuite_test_custom_tool",
    description:
      "Explicitly test a saved custom tool, including a draft, in one allowed execution domain. Use after creating a tool and report the result or runtime error to the user.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        toolName: { type: "string", description: "Exact saved custom tool name." },
        input: { type: "object", description: "Optional replacement test input. Omit to use the test case saved with the tool." },
        executionDomain: { type: "string", description: "Required choice for a both-domain tool; otherwise must match its configured domain.", enum: ["client", "server"] }
      },
      required: ["toolName", "executionDomain"]
    },
    execute: async (input) => {
      const tool = await getCustomTool(String(input.toolName || ""));
      if (!tool) throw new Error(`Custom tool "${String(input.toolName || "")}" was not found.`);
      const testInput = input.input === undefined ? tool.testInput : asObject(input.input);
      const domain = requestedDomain(input.executionDomain);
      if (!domain) throw new Error("executionDomain must be client or server.");
      try {
        const result = await executeCustomToolDraft(tool, testInput, domain);
        await saveCustomToolTestState(tool.id, testInput, result, domain);
        return result;
      } catch (error) {
        const failure = { error: error instanceof Error ? error.message : String(error) };
        await saveCustomToolTestState(tool.id, testInput, failure, domain);
        throw error;
      }
    }
  },
  {
    name: "magic_netsuite_call_custom_tool",
    description:
      "Execute one active user-created Magic NetSuite tool after finding it with magic_netsuite_search_custom_tools. The saved domain controls whether it runs in the authenticated client page, through the server Suitelet, or in a requested one of those environments.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        toolName: { type: "string", description: "Exact custom tool name returned by search." },
        input: { type: "object", description: "Input object matching the custom tool's returned inputSchema." },
        executionDomain: { type: "string", description: "Client or server for a both-domain tool. Omit for a single-domain tool.", enum: ["client", "server"] }
      },
      required: ["toolName", "input"]
    },
    execute: async (input) => executeCustomTool(
      String(input.toolName ?? ""),
      asObject(input.input),
      requestedDomain(input.executionDomain)
    )
  }
];
