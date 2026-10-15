import type { ExecutionRequest, RuntimeResult } from "./types";
export function startExecution(request: ExecutionRequest) {
  const worker = new Worker(new URL("./runner.worker.ts", import.meta.url), {
    type: "module",
  });
  let rejectRun: (reason: Error) => void;
  let timer: ReturnType<typeof setTimeout>;
  const cancel = () => {
    clearTimeout(timer);
    worker.terminate();
    rejectRun(new Error("Execution cancelled."));
  };
  const result = new Promise<RuntimeResult>((resolve, reject) => {
    rejectRun = reject;
    timer = setTimeout(() => {
      worker.terminate();
      reject(
        new Error("Execution stopped after the worker deadline (15 seconds)."),
      );
    }, 15000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      event.data.error
        ? reject(new Error(event.data.error))
        : resolve(event.data.result);
    };
    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(event.message || "Runtime worker failed to start."));
    };
    try {
      worker.postMessage(JSON.parse(JSON.stringify(request)));
    } catch (error) {
      clearTimeout(timer);
      worker.terminate();
      reject(error);
    }
  });
  return { result, cancel };
}
