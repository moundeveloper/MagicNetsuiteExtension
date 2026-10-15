const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const definitions = require("../dashboardTools.json");

test("native MCP companion exposes dashboard tools without a NetSuite session", async () => {
  const executable = process.env.MAGIC_NS_TEST_SERVER_PATH;
  const child = spawn(
    executable || process.execPath,
    executable ? [] : [path.join(__dirname, "../magiNetsuiteMCPServer.js")],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  let buffer = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Native tools/list timed out. ${stderr}`)),
        10000,
      );
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Native companion exited ${code}. ${stderr}`));
      });
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const message = JSON.parse(line);
            if (message.id === 41) {
              clearTimeout(timer);
              resolve(message);
            }
          } catch (error) {
            clearTimeout(timer);
            reject(error);
          }
        }
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: 41, method: "tools/list" }) + "\n",
      );
    });
    assert.equal(result.error, undefined);
    const tools = result.result.tools.filter((tool) =>
      tool.name.startsWith("magic_netsuite_dashboard_"),
    );
    assert.equal(tools.length, definitions.length);
    for (const definition of definitions) {
      const tool = tools.find((tool) => tool.name === definition.name);
      assert.ok(tool, definition.name);
      assert.deepEqual(tool.inputSchema, definition.inputSchema);
    }
  } finally {
    child.kill();
  }
});
