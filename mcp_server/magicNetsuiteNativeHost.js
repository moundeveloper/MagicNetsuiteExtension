#!/usr/bin/env node

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

// -----------------------------------------------
// CONFIG + BASE DIR
// -----------------------------------------------
let shouldLog = true;
let BASE_DIR = __dirname;
let hostConfig = {};

for (const candidateDir of [path.dirname(process.execPath), __dirname]) {
  try {
    const configPath = path.join(candidateDir, "host.config.json");
    const config = JSON.parse(
      fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")
    );
    hostConfig = config;
    if (typeof config.shouldLog === "boolean") {
      shouldLog = config.shouldLog;
    }
    BASE_DIR = candidateDir;
    break;
  } catch {
    // Try the next candidate.
  }
}

const LOG_FILE = path.join(BASE_DIR, `magicNetsuiteNativeHost_${process.pid}.log`);
const LOG_FILE_LATEST = path.join(BASE_DIR, "magicNetsuiteNativeHost.log");
const CUSTOM_TOOLS_MANIFEST_PATH = path.join(BASE_DIR, "custom-tools-manifest.json");

function log(...args) {
  if (!shouldLog) return;
  try {
    const line =
      `[${new Date().toISOString()}] [pid:${process.pid}] ` +
      args
        .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
        .join(" ") +
      "\n";

    fs.appendFileSync(LOG_FILE, line);
    try { fs.appendFileSync(LOG_FILE_LATEST, line); } catch {}
  } catch {
    // Never let logging break the native messaging protocol.
  }
}

// -----------------------------------------------
// LOCAL IPC SERVER FOR MCP STDIO PROCESSES
// -----------------------------------------------
const DEFAULT_PIPE_NAME = "magic_netsuite_mcp_bridge";
const BRIDGE_PIPE_NAME =
  process.env.MAGIC_NETSUITE_MCP_PIPE ||
  hostConfig.nativeBridgePipeName ||
  DEFAULT_PIPE_NAME;
const BRIDGE_PIPE_PATH =
  hostConfig.nativeBridgePipePath ||
  (process.platform === "win32"
    ? `\\\\.\\pipe\\${BRIDGE_PIPE_NAME}`
    : path.join(os.tmpdir(), `${BRIDGE_PIPE_NAME}.sock`));

const clients = new Set();
const pending = new Map();
let extensionReady = false;
let nextClientId = 0;
let nextNativeRequestId = 0;
let ipcServer = null;
const claudeRuns = new Map();

function safeClaudeCwd(value) {
  const cwd = path.resolve(String(value || hostConfig.claudeDefaultCwd || BASE_DIR));
  const stat = fs.statSync(cwd);
  if (!stat.isDirectory()) throw new Error(`Claude working directory is not a directory: ${cwd}`);
  return cwd;
}

function sendClaudeEvent(runId, event) {
  let payload = { type: "CLAUDE_CLI_EVENT", runId, event };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8");
  if (encoded.length > 900000) {
    payload = {
      type: "CLAUDE_CLI_EVENT",
      runId,
      event: { type: "host_warning", message: "Claude emitted an event larger than the Chrome native-message limit; it was omitted." }
    };
  }
  sendToExtension(payload);
}

function parseClaudeLines(runId, state, chunk, streamName) {
  const key = streamName === "stdout" ? "stdoutBuffer" : "stderrBuffer";
  state[key] += chunk.toString("utf8");
  const lines = state[key].split(/\r?\n/);
  state[key] = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    if (streamName === "stderr") {
      sendClaudeEvent(runId, { type: "stderr", message: line });
      continue;
    }
    try {
      sendClaudeEvent(runId, JSON.parse(line));
    } catch {
      sendClaudeEvent(runId, { type: "stdout", message: line });
    }
  }
}

function startClaudeRun(message) {
  const runId = String(message.runId || `claude-${Date.now()}`);
  if (!/^[a-zA-Z0-9_-]{4,100}$/.test(runId)) throw new Error("Invalid Claude runId.");
  if (claudeRuns.has(runId)) throw new Error(`Claude run ${runId} is already active.`);
  const prompt = String(message.prompt || "").trim();
  if (!prompt) throw new Error("Claude prompt is required.");

  const cwd = safeClaudeCwd(message.cwd);
  const permissionMode = ["plan", "default", "dontAsk", "acceptEdits"].includes(message.permissionMode)
    ? message.permissionMode
    : "plan";
  const model = ["sonnet", "opus", "haiku"].includes(message.model) ? message.model : "";
  const maxTurns = Math.max(1, Math.min(100, Number(message.maxTurns) || 12));
  const cliArgs = [
    "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--max-turns", String(maxTurns), "--permission-mode", permissionMode
  ];
  if (model) cliArgs.push("--model", model);

  // Force use of the installed Claude login. Never pass API/provider credentials
  // through from the native host environment and never use --bare.
  const env = { ...process.env };
  for (const key of [
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"
  ]) delete env[key];

  const configuredExecutable = String(hostConfig.claudeExecutable || process.env.CLAUDE_CLI_PATH || "").trim();
  let command;
  let args;
  if (configuredExecutable) {
    command = configuredExecutable;
    args = cliArgs;
  } else if (process.platform === "win32") {
    command = process.env.ComSpec || "cmd.exe";
    args = ["/d", "/s", "/c", "claude", ...cliArgs];
  } else {
    command = "claude";
    args = cliArgs;
  }

  const child = spawn(command, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const state = {
    child,
    cwd,
    permissionMode,
    model: model || "default",
    startedAt: new Date().toISOString(),
    stdoutBuffer: "",
    stderrBuffer: "",
    cancelled: false
  };
  claudeRuns.set(runId, state);

  child.stdout.on("data", (chunk) => parseClaudeLines(runId, state, chunk, "stdout"));
  child.stderr.on("data", (chunk) => parseClaudeLines(runId, state, chunk, "stderr"));
  child.on("error", (error) => {
    sendClaudeEvent(runId, { type: "process_error", message: error.message });
  });
  child.on("close", (exitCode, signal) => {
    if (state.stdoutBuffer.trim()) parseClaudeLines(runId, state, "\n", "stdout");
    if (state.stderrBuffer.trim()) parseClaudeLines(runId, state, "\n", "stderr");
    claudeRuns.delete(runId);
    sendClaudeEvent(runId, {
      type: "process_exit",
      exitCode,
      signal,
      cancelled: state.cancelled,
      finishedAt: new Date().toISOString()
    });
  });

  child.stdin.end(prompt);
  sendClaudeEvent(runId, {
    type: "process_started",
    pid: child.pid,
    cwd,
    permissionMode,
    model: model || "default",
    maxTurns,
    startedAt: state.startedAt
  });
  return { runId, pid: child.pid, cwd, permissionMode, model: model || "default", maxTurns };
}

function cancelClaudeRun(runId) {
  const state = claudeRuns.get(String(runId || ""));
  if (!state) return { runId, cancelled: false, reason: "not_running" };
  state.cancelled = true;
  if (process.platform === "win32" && state.child.pid) {
    const killer = spawn("taskkill.exe", ["/pid", String(state.child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore"
    });
    killer.unref();
  } else {
    state.child.kill("SIGTERM");
  }
  return { runId, cancelled: true };
}

function claudeRunStatus() {
  return [...claudeRuns.entries()].map(([runId, state]) => ({
    runId,
    pid: state.child.pid,
    cwd: state.cwd,
    permissionMode: state.permissionMode,
    model: state.model,
    startedAt: state.startedAt
  }));
}

function writeClientMessage(socket, message) {
  socket.write(JSON.stringify(message) + "\n");
}

function rejectClientRequest(socket, requestId, message) {
  writeClientMessage(socket, {
    requestId,
    success: false,
    error: message
  });
}

function startIpcServer() {
  if (process.platform !== "win32" && fs.existsSync(BRIDGE_PIPE_PATH)) {
    try { fs.unlinkSync(BRIDGE_PIPE_PATH); } catch {}
  }

  ipcServer = net.createServer((socket) => {
    const clientId = ++nextClientId;
    let buffer = "";

    clients.add(socket);
    socket.setEncoding("utf8");
    log("MCP client connected", clientId);

    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;

        let message;
        try {
          message = JSON.parse(line);
        } catch {
          log("invalid MCP bridge client JSON", line);
          continue;
        }

        handleClientMessage(socket, clientId, message);
      }
    });

    socket.on("close", () => {
      clients.delete(socket);
      for (const [nativeRequestId, entry] of pending.entries()) {
        if (entry.socket === socket) {
          clearTimeout(entry.timer);
          pending.delete(nativeRequestId);
        }
      }
      log("MCP client disconnected", clientId);
    });

    socket.on("error", (err) => {
      log("MCP client socket error", clientId, err.message);
    });
  });

  ipcServer.on("error", (err) => {
    log("IPC server error", err.message);
    shutdown(1);
  });

  ipcServer.listen(BRIDGE_PIPE_PATH, () => {
    log("IPC server listening", BRIDGE_PIPE_PATH);
  });
}

function handleClientMessage(socket, clientId, message) {
  const { requestId, method, params } = message;

  if (!requestId) {
    rejectClientRequest(socket, requestId, "Missing requestId.");
    return;
  }

  if (!extensionReady) {
    setTimeout(() => {
      if (!clients.has(socket)) return;
      if (extensionReady) {
        handleClientMessage(socket, clientId, message);
      } else {
        rejectClientRequest(
          socket,
          requestId,
          "Chrome extension native messaging port is not ready."
        );
      }
    }, 250);
    return;
  }

  const nativeRequestId = `native-${++nextNativeRequestId}`;
  const timer = setTimeout(() => {
    if (!pending.has(nativeRequestId)) return;
    pending.delete(nativeRequestId);
    rejectClientRequest(socket, requestId, "Extension timeout");
  }, 10000);

  pending.set(nativeRequestId, {
    socket,
    clientId,
    clientRequestId: requestId,
    timer
  });

  const payload = {
    requestId: nativeRequestId,
    method,
    params
  };

  log("MCP client -> extension", clientId, payload);
  sendToExtension(payload);
}

// -----------------------------------------------
// CHROME NATIVE MESSAGING PROTOCOL
// -----------------------------------------------
let nativeBuffer = Buffer.alloc(0);

function readNativeMessages(onMessage) {
  process.stdin.on("data", (chunk) => {
    nativeBuffer = Buffer.concat([nativeBuffer, chunk]);

    while (nativeBuffer.length >= 4) {
      const messageLength = nativeBuffer.readUInt32LE(0);

      if (nativeBuffer.length < 4 + messageLength) {
        return;
      }

      const json = nativeBuffer.slice(4, 4 + messageLength).toString("utf8");
      nativeBuffer = nativeBuffer.slice(4 + messageLength);

      try {
        onMessage(JSON.parse(json));
      } catch (err) {
        log("invalid extension JSON", err.message);
      }
    }
  });

  process.stdin.on("end", () => {
    log("extension native port closed stdin");
    shutdown(0);
  });

  process.stdin.on("close", () => {
    log("extension native port closed");
    shutdown(0);
  });
}

function sendToExtension(message) {
  const json = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);

  header.writeUInt32LE(json.length, 0);

  try {
    process.stdout.write(header);
    process.stdout.write(json);
  } catch (err) {
    log("failed writing native message", err.message);
  }
}

function normalizeCustomToolsManifest(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .filter((tool) => tool && tool.enabled !== false && tool.status === "active")
    .map((tool) => ({
      id: String(tool.id || ""),
      name: String(tool.name || "").trim().toLowerCase(),
      displayName: String(tool.displayName || tool.name || "").trim(),
      description: String(tool.description || "").trim(),
      domain: ["client", "server", "both"].includes(tool.domain) ? tool.domain : "both",
      risk: tool.risk === "write" ? "write" : "read",
      inputSchema:
        tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)
          ? tool.inputSchema
          : { type: "object", properties: {} }
    }))
    .filter((tool) => /^[a-z][a-z0-9_]{2,63}$/.test(tool.name) && tool.description)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readCustomToolsManifest() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CUSTOM_TOOLS_MANIFEST_PATH, "utf8").replace(/^\uFEFF/, ""));
    return Array.isArray(parsed?.tools) ? parsed.tools : [];
  } catch {
    return [];
  }
}

function writeCustomToolsManifest(tools) {
  const normalized = normalizeCustomToolsManifest(tools);
  if (JSON.stringify(readCustomToolsManifest()) === JSON.stringify(normalized)) return false;

  const payload = JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    tools: normalized
  }, null, 2) + "\n";
  const temporaryPath = `${CUSTOM_TOOLS_MANIFEST_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, payload, "utf8");
  try {
    fs.renameSync(temporaryPath, CUSTOM_TOOLS_MANIFEST_PATH);
  } catch (error) {
    try { fs.unlinkSync(CUSTOM_TOOLS_MANIFEST_PATH); } catch {}
    fs.renameSync(temporaryPath, CUSTOM_TOOLS_MANIFEST_PATH);
  }
  log("custom tools manifest updated", CUSTOM_TOOLS_MANIFEST_PATH, normalized.length);
  return true;
}

function handleExtensionMessage(message) {
  log("extension -> native host", message);

  if (message.type === "extensionReady") {
    extensionReady = true;
    return;
  }

  if (message.type === "CUSTOM_TOOLS_SYNC") {
    try {
      writeCustomToolsManifest(message.tools);
    } catch (error) {
      log("failed writing custom tools manifest", error.message || String(error));
    }
    return;
  }

  // Direct queries from the extension (not through MCP client pipeline)
  if (message.type === "GET_BASE_DIR") {
    const response = { type: "BASE_DIR", baseDir: BASE_DIR };
    if (message.requestId) {
      response.requestId = message.requestId;
    }
    sendToExtension(response);
    return;
  }

  if (message.type === "CLAUDE_CLI_START") {
    try {
      sendToExtension({
        type: "CLAUDE_CLI_STARTED",
        requestId: message.requestId,
        success: true,
        result: startClaudeRun(message)
      });
    } catch (error) {
      sendToExtension({
        type: "CLAUDE_CLI_STARTED",
        requestId: message.requestId,
        success: false,
        error: error.message || String(error)
      });
    }
    return;
  }

  if (message.type === "CLAUDE_CLI_CANCEL") {
    try {
      sendToExtension({
        type: "CLAUDE_CLI_CANCELLED",
        requestId: message.requestId,
        success: true,
        result: cancelClaudeRun(message.runId)
      });
    } catch (error) {
      sendToExtension({
        type: "CLAUDE_CLI_CANCELLED",
        requestId: message.requestId,
        success: false,
        error: error.message || String(error)
      });
    }
    return;
  }

  if (message.type === "CLAUDE_CLI_STATUS") {
    sendToExtension({
      type: "CLAUDE_CLI_STATUS_RESULT",
      requestId: message.requestId,
      success: true,
      result: { runs: claudeRunStatus() }
    });
    return;
  }

  const nativeRequestId = message.requestId;
  const entry = pending.get(nativeRequestId);
  if (!entry) {
    log("no pending MCP client for extension response", nativeRequestId);
    return;
  }

  pending.delete(nativeRequestId);
  clearTimeout(entry.timer);

  const response = {
    requestId: entry.clientRequestId,
    success: Boolean(message.success),
    result: message.result,
    error: message.error,
    account: message.account || null
  };

  log("extension -> MCP client", entry.clientId, response);

  try {
    writeClientMessage(entry.socket, response);
  } catch (err) {
    log("failed writing MCP client response", entry.clientId, err.message);
  }
}

function shutdown(code) {
  for (const state of claudeRuns.values()) {
    try { state.child.kill("SIGTERM"); } catch {}
  }
  claudeRuns.clear();
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
  }
  pending.clear();

  for (const socket of clients) {
    try { socket.destroy(); } catch {}
  }
  clients.clear();

  if (ipcServer) {
    try { ipcServer.close(); } catch {}
  }

  if (process.platform !== "win32" && fs.existsSync(BRIDGE_PIPE_PATH)) {
    try { fs.unlinkSync(BRIDGE_PIPE_PATH); } catch {}
  }

  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (err) => {
  log("UNCAUGHT EXCEPTION", err.message, err.stack || "");
  shutdown(1);
});
process.on("unhandledRejection", (reason) => {
  log("UNHANDLED REJECTION", reason instanceof Error ? reason.message : String(reason));
});

startIpcServer();
readNativeMessages(handleExtensionMessage);
log("native host started");
