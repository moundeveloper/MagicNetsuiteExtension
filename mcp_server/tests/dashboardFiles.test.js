const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { callDashboardWithFiles } = require("../dashboardFiles");
test("dashboard code file adapter preserves regex escapes and never sends local paths to the worker", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "magic-dashboard-"));
  try {
    const file = path.join(dir, "action.js");
    const source = "return /\\d+/.test(input);";
    await fs.writeFile(file, source);
    let captured;
    await callDashboardWithFiles(
      "magic_netsuite_dashboard_code",
      { filePath: file, name: "action.js" },
      async (_name, args) => {
        captured = args;
        return { content: [] };
      },
    );
    assert.equal(captured.source, source);
    assert.equal(captured.filePath, undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("exports portable JSON and code, rejects path traversal and accidental overwrites, and imports exact source", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "magic-dashboard-"));
  try {
    const payload = {
      format: "magic-netsuite-dashboard",
      formatVersion: 2,
      definition: {
        sourceFiles: { "actions/run.js": 'return /\\d/.test("1");' },
      },
    };
    const call = async () => ({
      content: [{ type: "text", text: JSON.stringify(payload) }],
    });
    const result = await callDashboardWithFiles(
      "magic_netsuite_dashboard_export",
      { directory: dir },
      call,
    );
    assert.equal(JSON.parse(result.content[0].text).exported, true);
    assert.equal(
      await fs.readFile(path.join(dir, "actions/run.js"), "utf8"),
      payload.definition.sourceFiles["actions/run.js"],
    );
    await assert.rejects(
      callDashboardWithFiles(
        "magic_netsuite_dashboard_export",
        { directory: dir },
        call,
      ),
      /already exists/,
    );
    let imported;
    await callDashboardWithFiles(
      "magic_netsuite_dashboard_import",
      { filePath: path.join(dir, "dashboard.json") },
      async (_name, args) => {
        imported = args.payload;
        return { content: [] };
      },
    );
    assert.deepEqual(imported, payload);
    payload.definition.sourceFiles = { "../escape.js": "bad" };
    await assert.rejects(
      callDashboardWithFiles(
        "magic_netsuite_dashboard_export",
        { directory: dir, overwrite: true },
        call,
      ),
      /relative/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
