window.runQuickScript = async (N, { code }) => {
  const logs = []; // Array of structured log entries

  const stringifyArg = (arg) => {
    if (typeof arg === "object" && arg !== null) {
      try {
        return JSON.stringify(arg, null, 2); // pretty print objects
      } catch {
        return String(arg); // fallback
      }
    }
    return String(arg);
  };

  try {
    const fakeConsole = {
      log: (...args) =>
        logs.push({ type: "log", values: args.map(stringifyArg) }),
      warn: (...args) =>
        logs.push({ type: "warn", values: args.map(stringifyArg) }),
      error: (...args) =>
        logs.push({ type: "error", values: args.map(stringifyArg) }),
    };

    // Destructure all keys of N for easy access in user code
    const destructuredKeys = Object.keys(N).join(", ");
    const wrappedCode = `
        "use strict";
        const { ${destructuredKeys} } = N;
        return (async () => { ${code} })();
      `;

    const asyncFn = new Function("N", "console", wrappedCode);
    await asyncFn(N, fakeConsole);
  } catch (err) {
    logs.push({ type: "error", values: ["Execution error: " + err.message] });
  }

  return logs; // return the structured logs array
};
