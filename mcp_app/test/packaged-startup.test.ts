import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("standalone MCP package initializes and lists dashboard tools without a source repository", { timeout: 20000 }, async () => {
  const source = fileURLToPath(new URL("../", import.meta.url));
  const temporaryRoot = path.resolve(os.tmpdir());
  const staged = await mkdtemp(path.join(temporaryRoot, "magic-mcp-package-"));
  const dependencies = path.join(staged, "node_modules");
  const client = new Client({ name: "packaged-startup-test", version: "1.0" });
  let stderr = "";
  let linked = false;
  try {
    // This matches packageMcpApps.ps1: dist + package.json + production dependencies.
    // The temporary package has no sibling mcp_server folder to mask missing assets.
    await cp(path.join(source, "dist"), path.join(staged, "dist"), { recursive: true });
    await writeFile(path.join(staged, "package.json"), JSON.stringify({ type: "module" }));
    await symlink(path.join(source, "node_modules"), dependencies, process.platform === "win32" ? "junction" : "dir");
    linked = true;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(staged, "dist", "main.js"), "--stdio"],
      cwd: staged,
      env: { ...process.env, MAGIC_NS_PLAYWRIGHT: "1", MAGIC_NETSUITE_MCP_PIPE: "magic_packaging_test_unused" } as Record<string,string>,
      stderr: "pipe",
    });
    transport.stderr?.on("data", chunk => { stderr += chunk; });
    await client.connect(transport, { timeout: 10000 });
    const tools = await client.listTools();
    const expected = JSON.parse(await readFile(path.join(source, "dist", "dashboard-resources", "dashboardTools.json"), "utf8"));
    const dashboard = tools.tools.filter(t => t.name.startsWith("magic_netsuite_dashboard_"));
    assert.deepEqual(dashboard.map(t=>t.name).sort(), expected.map((t:{name:string})=>t.name).sort());
    const resources = await client.listResources();
    assert.ok(resources.resources.length > 0, "Packaged MCP app resources remain available");
    assert.equal(stderr.includes("ERR_INVALID_URL"), false);
  } catch (error) {
    throw new Error(`Packaged MCP startup failed. ${stderr}`, { cause: error });
  } finally {
    await client.close();
    // Remove the link itself before recursively removing the verified temporary folder.
    if (linked) await unlink(dependencies);
    assert.equal(path.dirname(staged), temporaryRoot);
    assert.ok(path.basename(staged).startsWith("magic-mcp-package-"));
    await rm(staged, { recursive: true, force: true });
  }
});
