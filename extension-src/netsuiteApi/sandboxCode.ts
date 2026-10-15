// Streaming-enabled runQuickScript
window.runQuickScript = async (
  N,
  { code, requestId, mode = "normal", bridgeCapability, browserSession }
) => {
  console.log("[runQuickScript] requestId", requestId);
  const logs = [];
  const isStreaming = mode === "stream";
  const pendingBrowserCalls = new Map();
  const browserListener = event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.type !== 'CUSTOM_TOOL_BROWSER_RESPONSE' || data.capability !== bridgeCapability || data.token !== browserSession) return;
    const pending = pendingBrowserCalls.get(data.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingBrowserCalls.delete(data.id);
    data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.result);
  };
  if (browserSession) window.addEventListener('message', browserListener);
  const browserCall = (operation, args = {}) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pendingBrowserCalls.delete(id); reject(new Error('Browser operation timed out: ' + operation)); }, 75000);
    pendingBrowserCalls.set(id, { resolve, reject, timer });
    window.postMessage({ type: 'CUSTOM_TOOL_BROWSER_REQUEST', capability: bridgeCapability, token: browserSession, id, operation, args }, location.origin);
  });
  const browser = browserSession ? Object.freeze({
    openTab: options => browserCall('openTab', options),
    openView: options => browserCall('openView', options),
    getTab: tabId => browserCall('getTab', { tabId }),
    navigate: (tabId, url) => browserCall('navigate', { tabId, url }),
    waitForSelector: (tabId, selector, options = {}) => browserCall('waitForSelector', { ...options, tabId, selector }),
    extract: (tabId, options = {}) => browserCall('extract', { ...options, tabId }),
    click: (tabId, selector) => browserCall('click', { tabId, selector }),
    fill: (tabId, selector, value) => browserCall('fill', { tabId, selector, value }),
    closeTab: tabId => browserCall('closeTab', { tabId })
  }) : undefined;

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

  // ============================================================================
  // Emit Functions
  // ============================================================================

  const emitLog = (requestId, entry) => {
    console.log("[emitLog] requestId", requestId);
    window.postMessage(
      {
        type: "TO_EXTENSION",
        capability: bridgeCapability,
        payload: {
          requestId,
          event: "log",
          data: entry,
          timestamp: Date.now()
        }
      },
      window.location.origin
    );
  };

  const emitProgress = (requestId, progress) => {
    if (!isStreaming) return;

    window.postMessage(
      {
        type: "TO_EXTENSION",
        capability: bridgeCapability,
        payload: {
          requestId,
          event: "progress",
          data: progress,
          timestamp: Date.now()
        }
      },
      window.location.origin
    );
  };

  const emitStreamChunk = (requestId, chunk) => {
    if (!isStreaming) return;
    console.log("[emitStreamChunk] streaming this chunk", requestId);
    window.postMessage(
      {
        type: "TO_EXTENSION",
        capability: bridgeCapability,
        payload: {
          requestId,
          event: "chunk",
          data: chunk,
          timestamp: Date.now()
        }
      },
      window.location.origin
    );
  };

  const emitComplete = (requestId, result) => {
    window.postMessage(
      {
        type: "TO_EXTENSION",
        capability: bridgeCapability,
        payload: isStreaming
          ? {
              requestId,
              type: "STREAM_END",
              result,
              logs,
              timestamp: Date.now()
            }
          : {
              requestId,
              event: "done",
              result,
              logs,
              timestamp: Date.now()
            }
      },
      window.location.origin
    );
  };

  const emitError = (requestId, error) => {
    window.postMessage(
      {
        type: "TO_EXTENSION",
        capability: bridgeCapability,
        payload: isStreaming
          ? {
              requestId,
              type: "STREAM_ERROR",
              error: error.toString(),
              timestamp: Date.now()
            }
          : {
              requestId,
              event: "error",
              error: error.toString(),
              timestamp: Date.now()
            }
      },
      window.location.origin
    );
  };

  // Helper to yield control back to the browser
  const yieldToMain = () => {
    return new Promise((resolve) => setTimeout(resolve, 0));
  };

  // ============================================================================
  // Streaming-aware Console
  // ============================================================================

  try {
    const fakeConsole = {
      log: (...args) => {
        const entry = {
          type: "log",
          values: args.map(stringifyArg)
        };
        logs.push(entry);

        if (isStreaming) {
          emitStreamChunk(requestId, entry);
        }
      },
      warn: (...args) => {
        const entry = {
          type: "warn",
          values: args.map(stringifyArg)
        };
        logs.push(entry);

        if (isStreaming) {
          emitStreamChunk(requestId, entry);
        }
      },
      error: (...args) => {
        const entry = {
          type: "error",
          values: args.map(stringifyArg)
        };
        logs.push(entry);

        if (isStreaming) {
          emitStreamChunk(requestId, entry);
        }
      },
      // Add streaming-specific method
      stream: (data) => {
        if (isStreaming) {
          emitStreamChunk(requestId, {
            type: "data",
            value: stringifyArg(data)
          });
        }
      }
    };

    // ============================================================================
    // Enhanced N.log for Streaming
    // ============================================================================

    const originalLog = N.log;
    const fakeLog = {
      LOG_LEVELS: originalLog?.LOG_LEVELS || [
        "DEBUG",
        "AUDIT",
        "ERROR",
        "EMERGENCY"
      ],
      emergency: (...args) => {
        const entry = { type: "error", values: args.map(stringifyArg) };
        logs.push(entry);
        if (isStreaming) emitStreamChunk(requestId, entry);
      },
      debug: (...args) => {
        const entry = { type: "log", values: args.map(stringifyArg) };
        logs.push(entry);
        if (isStreaming) emitStreamChunk(requestId, entry);
      },
      audit: (...args) => {
        const entry = { type: "log", values: args.map(stringifyArg) };
        logs.push(entry);
        if (isStreaming) emitStreamChunk(requestId, entry);
      },
      error: (...args) => {
        const entry = { type: "error", values: args.map(stringifyArg) };
        logs.push(entry);
        if (isStreaming) emitStreamChunk(requestId, entry);
      }
    };

    // ============================================================================
    // Progress Tracking Wrapper
    // ============================================================================

    const createProgressTracker = () => {
      let currentStep = 0;
      let totalSteps = 0;

      return {
        setTotal: (total) => {
          totalSteps = total;
        },
        increment: (message) => {
          currentStep++;
          if (isStreaming && totalSteps > 0) {
            emitProgress(requestId, {
              current: currentStep,
              total: totalSteps,
              percentage: Math.round((currentStep / totalSteps) * 100),
              message
            });
          }
        },
        update: (current, message) => {
          currentStep = current;
          if (isStreaming && totalSteps > 0) {
            emitProgress(requestId, {
              current,
              total: totalSteps,
              percentage: Math.round((current / totalSteps) * 100),
              message
            });
          }
        }
      };
    };

    const progress = createProgressTracker();

    // ============================================================================
    // Modified N object with streaming support
    // ============================================================================

    const modifiedN = {
      ...N,
      log: fakeLog,
      progress // Expose progress tracker to user scripts
    };

    const destructuredKeys = Object.keys(modifiedN).join(", ");
    const wrappedCode = `
      "use strict";
      const { ${destructuredKeys} } = N;
      return (async () => { ${code} })();
    `;

    const asyncFn = new Function("N", "console", "__customToolBrowser", wrappedCode);

    // ============================================================================
    // Execute with streaming support
    // ============================================================================

    // Emit start event for streaming
    if (isStreaming) {
      emitStreamChunk(requestId, {
        type: "start",
        message: "Script execution started"
      });
    }

    // Yield before executing to allow UI update
    await yieldToMain();

    const result = await asyncFn(modifiedN, fakeConsole, browser);

    // Yield after execution
    await yieldToMain();

    // Emit completion
    if (isStreaming) {
      emitComplete(requestId, result);
      return null;
    }

    return { result, logs };
  } catch (err) {
    const errorEntry = {
      type: "error",
      values: ["Execution error: " + err.message || err]
    };
    logs.push(errorEntry);

    if (isStreaming) {
      emitStreamChunk(requestId, errorEntry);
      emitError(requestId, err);
      return null;
    }

    return {
      result: null,
      error: err?.message || String(err),
      logs
    };
  } finally {
    if (browserSession) {
      try { await browserCall('dispose'); } catch (error) { console.warn('Browser cleanup failed', error); }
      window.removeEventListener('message', browserListener);
      for (const pending of pendingBrowserCalls.values()) { clearTimeout(pending.timer); pending.reject(new Error('Tool execution finished.')); }
      pendingBrowserCalls.clear();
    }
  }
};
