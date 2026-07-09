#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const stateFile =
  process.env.MAGIC_NS_TEMPLATE_REVIEW_STATE ||
  path.join(os.homedir(), ".magic-netsuite", "template-review-state.json");

let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
});

process.stdin.on("end", () => {
  let hookInput = {};
  try {
    hookInput = input.trim() ? JSON.parse(input) : {};
  } catch {
    hookInput = {};
  }

  const stopHookActive = Boolean(hookInput.stop_hook_active || hookInput.stopHookActive);
  if (stopHookActive) {
    console.log(JSON.stringify({ decision: "allow" }));
    return;
  }

  let state = null;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  } catch {
    console.log(JSON.stringify({ decision: "allow" }));
    return;
  }

  if (state?.pending === true || state?.status === "open") {
    console.log(JSON.stringify({
      decision: "block",
      reason:
        "The NetSuite template review is still pending in Playwright. Call magic_netsuite_template_review_wait and continue after the user clicks Approve or Send Fixes.",
    }));
    return;
  }

  console.log(JSON.stringify({ decision: "allow" }));
});
