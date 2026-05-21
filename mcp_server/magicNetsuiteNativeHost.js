#!/usr/bin/env node

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");

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

function handleExtensionMessage(message) {
  log("extension -> native host", message);

  if (message.type === "extensionReady") {
    extensionReady = true;
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
