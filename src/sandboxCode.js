// Non-blocking runQuickScript - runs on main thread but yields to UI
window.runQuickScript = async (N, { code, requestId }) => {
  const logs = [];

  const stringifyArg = (arg) => {
    if (typeof arg === "object" && arg !== null) {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  };

  const emitLog = (requestId, entry) => {
    window.postMessage(
      {
        type: "TO_EXTENSION",
        payload: {
          requestId,
          event: "log",
          data: entry
        }
      },
      "*"
    );
  };

  // Helper to yield control back to the browser
  const yieldToMain = () => {
    return new Promise((resolve) => setTimeout(resolve, 0));
  };

  try {
    const fakeConsole = {
      log: (...args) => {
        emitLog(requestId, {
          type: "log",
          values: args.map(stringifyArg)
        });
      },
      warn: (...args) => {
        emitLog(requestId, {
          type: "warn",
          values: args.map(stringifyArg)
        });
      },
      error: (...args) => {
        emitLog(requestId, {
          type: "error",
          values: args.map(stringifyArg)
        });
      }
    };

    const originalLog = N.log;
    const fakeLog = {
      LOG_LEVELS: originalLog?.LOG_LEVELS || [
        "DEBUG",
        "AUDIT",
        "ERROR",
        "EMERGENCY"
      ],
      emergency: (...args) => {
        logs.push({ type: "error", values: args.map(stringifyArg) });
      },
      debug: (...args) => {
        logs.push({ type: "log", values: args.map(stringifyArg) });
      },
      audit: (...args) => {
        logs.push({ type: "log", values: args.map(stringifyArg) });
      },
      error: (...args) => {
        logs.push({ type: "error", values: args.map(stringifyArg) });
      }
    };

    const modifiedN = {
      ...N,
      log: fakeLog
    };

    const destructuredKeys = Object.keys(modifiedN).join(", ");
    const wrappedCode = `
        "use strict";
        const { ${destructuredKeys} } = N;
        return (async () => { ${code} })();
      `;

    const asyncFn = new Function("N", "console", wrappedCode);

    // Yield before executing to allow UI update
    await yieldToMain();

    await asyncFn(modifiedN, fakeConsole);

    // Yield after execution
    await yieldToMain();
  } catch (err) {
    logs.push({ type: "error", values: ["Execution error: " + err] });
  }

  emitLog(requestId, { type: "done" });
};
