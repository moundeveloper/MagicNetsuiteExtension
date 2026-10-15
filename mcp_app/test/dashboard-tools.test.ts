import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerDashboardTools } from "../dashboard-tools.js";
test("dashboard MCP tools are discoverable and forward complete edits and action code", async () => {
  const server = new McpServer({ name: "test", version: "1.0" });
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  registerDashboardTools(server, async (name, args) => {
    calls.push({ name, args });
    return {
      content: [{ type: "text", text: JSON.stringify({ revision: 2 }) }],
    };
  });
  const client = new Client({ name: "test-client", version: "1.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 15);
    const patch = {
      components: {
        Counter: {
          description: "Counter",
          template: [{ id: "metric", type: "metric" }],
        },
      },
      actions: [{ id: "run", steps: [{ code: "return input;" }] }],
    };
    await client.callTool({
      name: "magic_netsuite_dashboard_update",
      arguments: { dashboardId: "test", expectedRevision: 1, patch },
    });
    assert.deepEqual(calls[0], {
      name: "magic_netsuite_dashboard_update",
      args: { dashboardId: "test", expectedRevision: 1, patch },
    });
    const invalid = await client.callTool({
      name: "magic_netsuite_dashboard_update",
      arguments: { dashboardId: "test", patch },
    });
    assert.equal(invalid.isError, true);
    assert.equal(calls.length, 1);
    await client.callTool({
      name: "magic_netsuite_dashboard_run",
      arguments: {
        dashboardId: "test",
        expectedRevision: 2,
        actionId: "reset",
        input: [{ id: 1 }, { id: 2 }],
      },
    });
    assert.deepEqual(calls[1]?.args.input, [{ id: 1 }, { id: 2 }]);
    await client.callTool({
      name: "magic_netsuite_dashboard_run",
      arguments: {
        dashboardId: "test",
        expectedRevision: 2,
        actionId: "clear",
        input: null,
        verbose: true,
      },
    });
    assert.equal(calls[2]?.args.input, null);
    assert.equal(calls[2]?.args.verbose, true);
    const invalidOperation = await client.callTool({
      name: "magic_netsuite_dashboard_action",
      arguments: {
        dashboardId: "test",
        expectedRevision: 2,
        operation: "replace",
      },
    });
    assert.equal(invalidOperation.isError, true);
    assert.equal(calls.length, 3);
  } finally {
    await client.close();
    await server.close();
  }
});
