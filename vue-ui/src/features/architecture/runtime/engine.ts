import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import kernel from "./kernel.js?raw";
import { behaviorPack } from "./behaviorPack";
import {
  resolveSource,
  type ExecutionRequest,
  type RuntimeResult,
} from "./types";

let engine: ReturnType<typeof newQuickJSWASMModuleFromVariant> | undefined;
export async function executeSuiteScript(
  request: ExecutionRequest,
  timeoutMs = 5000,
): Promise<RuntimeResult> {
  const resolved = resolveSource(request.project, request.artifactId);
  if (!resolved.module?.path)
    throw new Error(
      "Select a script source module, a script record with source, or its deployment.",
    );
  const qjs = await (engine ??= newQuickJSWASMModuleFromVariant(variant));
  const rt = qjs.newRuntime();
  rt.setMemoryLimit(64 * 1024 * 1024);
  rt.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + timeoutMs;
  rt.setInterruptHandler(() => Date.now() >= deadline);
  const vm = rt.newContext();
  try {
    const payload = { ...request, ...resolved, rules: behaviorPack };
    const result = vm.evalCode(
      `globalThis.__runResult = undefined; (${kernel})(${JSON.stringify(payload)}).then(result => { globalThis.__runResult = JSON.stringify(result); }, error => { globalThis.__runResult = JSON.stringify({ fatal: String(error) }); });`,
      "workbench-kernel.js",
    );
    if (result.error) {
      const error = vm.dump(result.error);
      result.error.dispose();
      throw new Error(error.message || String(error));
    }
    result.value.dispose();
    while (rt.hasPendingJob()) {
      if (Date.now() >= deadline)
        throw new Error("Execution exceeded the local CPU deadline.");
      const jobs = rt.executePendingJobs(100);
      if (jobs.error) {
        const error = vm.dump(jobs.error);
        jobs.error.dispose();
        throw new Error(error.message || String(error));
      }
    }
    const handle = vm.getProp(vm.global, "__runResult");
    const text = vm.dump(handle);
    handle.dispose();
    if (!text)
      throw new Error(
        "Execution did not settle. Timers, live I/O, and unresolved promises are not supported.",
      );
    const value = JSON.parse(text);
    if (value.fatal) throw new Error(value.fatal);
    return value as RuntimeResult;
  } finally {
    vm.dispose();
    rt.dispose();
  }
}
