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

  if (
    (state?.pending === true && !state?.status) ||
    state?.status === "html_review" ||
    state?.status === "html_changes_requested" ||
    state?.status === "freemarker_review" ||
    state?.status === "freemarker_changes_requested" ||
    state?.status === "render_error"
  ) {
    console.log(JSON.stringify({
      decision: "block",
      reason:
        "The NetSuite template workflow is still active. Call magic_netsuite_template_review_wait; apply HTML fixes in the HTML stage, FreeMarker fixes with NetSuite rerendering in the FreeMarker/PDF stage, or finish after final approval.",
    }));
    return;
  }

  console.log(JSON.stringify({ decision: "allow" }));
});
