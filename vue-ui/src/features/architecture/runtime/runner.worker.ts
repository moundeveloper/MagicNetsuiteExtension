import { executeSuiteScript } from "./engine";
import type { ExecutionRequest } from "./types";
self.onmessage = async (event: MessageEvent<ExecutionRequest>) => {
  try {
    self.postMessage({ result: await executeSuiteScript(event.data) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
