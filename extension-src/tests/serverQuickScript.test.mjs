import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const managerFile = new URL(
  "../netsuiteApi/serverScriptManager.ts",
  import.meta.url,
);

const extractSuiteletSource = () => {
  const managerSource = fs.readFileSync(fileURLToPath(managerFile), "utf8");
  const match = managerSource.match(
    /function buildSuiteletContent\(\) \{\s*return `([\s\S]*?)`;\s*\}\s*function extractDeploymentIdFromHtml/,
  );

  assert.ok(match, "Expected to find the generated Suitelet source");
  return match[1];
};

test("server Quick Script returns console and N/log output with the result", () => {
  let suiteletFactory;
  const suiteletSource = extractSuiteletSource();

  vm.runInNewContext(suiteletSource, {
    define(_dependencies, factory) {
      suiteletFactory = factory;
    },
  });

  assert.equal(typeof suiteletFactory, "function");

  const forwardedLogs = [];
  const nativeLog = {
    debug(...args) {
      forwardedLogs.push(["debug", ...args]);
    },
    audit(...args) {
      forwardedLogs.push(["audit", ...args]);
    },
    error(...args) {
      forwardedLogs.push(["error", ...args]);
    },
    emergency(...args) {
      forwardedLogs.push(["emergency", ...args]);
    },
  };
  const dependencies = [
    {},
    {},
    {},
    nativeLog,
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    { callTool() {} },
  ];
  const suitelet = suiteletFactory(...dependencies);
  let responseBody = "";

  suitelet.onRequest({
    request: {
      method: "POST",
      parameters: {
        action: "quick-script-user",
        code:
          'console.log("server console"); ' +
          'log.debug({ title: "server debug", details: 7 }); ' +
          "return 42;",
      },
    },
    response: {
      setHeader() {},
      write(value) {
        responseBody = value;
      },
    },
  });

  const response = JSON.parse(responseBody);
  assert.equal(response.success, true);
  assert.equal(response.result, 42);
  assert.deepEqual(response.logs, [
    { type: "log", values: ["server console"] },
    {
      type: "log",
      values: ['{"title":"server debug","details":7}'],
    },
  ]);
  assert.equal(forwardedLogs.length, 1);
  assert.equal(forwardedLogs[0][0], "debug");
});
