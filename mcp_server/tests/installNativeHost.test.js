"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const installerPath = path.resolve(__dirname, "..", "installNativeHost.ps1");

test(
  "native host manifest is persisted outside the Git-managed host directory",
  { skip: process.platform !== "win32" },
  () => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "magic-ns-host-"));
    const hostDir = path.join(testRoot, "checkout", "mcpServer");
    const manifestDir = path.join(testRoot, "profile", "NativeMessagingHosts");
    const hostExe = path.join(hostDir, "magicNetsuiteNativeHost.exe");
    const extensionId = "abcdefghijklmnopabcdefghijklmnop";

    try {
      fs.mkdirSync(hostDir, { recursive: true });
      fs.writeFileSync(hostExe, "test native host");

      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          installerPath,
          "-ExtensionId",
          extensionId,
          "-HostDir",
          hostDir,
          "-ManifestDir",
          manifestDir,
          "-SkipRegistry",
        ],
        { encoding: "utf8" },
      );

      assert.equal(result.status, 0, result.stderr || result.stdout);

      const manifestPath = path.join(
        manifestDir,
        "com.magicnetsuite.mcp_bridge.json",
      );
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

      assert.equal(path.resolve(manifest.path), path.resolve(hostExe));
      assert.deepEqual(manifest.allowed_origins, [
        `chrome-extension://${extensionId}/`,
      ]);
      assert.equal(fs.existsSync(path.join(hostDir, path.basename(manifestPath))), false);
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  },
);
