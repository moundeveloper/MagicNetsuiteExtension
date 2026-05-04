#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

// -----------------------------------------------
// LOG (pkg-safe)
// -----------------------------------------------
const LOG_FILE = path.join(__dirname, "host.log");

function log(...args) {
  try {
    const line =
      `[${new Date().toISOString()}] ` +
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ") +
      "\n";

    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

// -----------------------------------------------
// WS SERVER
// -----------------------------------------------
const PORT_RANGE_START = 9700;
const PORT_RANGE_END = 9720;

const server = http.createServer();
const wss = new WebSocketServer({ server });

let extensionSocket = null;
let pending = new Map();
let idCounter = 0;

wss.on("connection", (ws) => {
  log("extension connected");
  extensionSocket = ws;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    log("← extension", msg);

    const cb = pending.get(msg.requestId);
    if (!cb) return;

    pending.delete(msg.requestId);

    if (msg.success) cb.resolve(msg.result);
    else cb.reject(new Error(msg.error || "Extension error"));
  });

  ws.on("close", () => {
    log("extension disconnected");
    extensionSocket = null;
  });
});

// -----------------------------------------------
// PORT BIND
// -----------------------------------------------
function listenOnFreePort(port) {
  if (port > PORT_RANGE_END) {
    log("no free port");
    process.exit(1);
  }

  server.once("error", (err) => {
    if (err.code === "EADDRINUSE") {
      listenOnFreePort(port + 1);
    } else {
      log("server error", err.message);
      process.exit(1);
    }
  });

  server.listen(port, "127.0.0.1", () => {
    log("listening", port);
  });
}

listenOnFreePort(PORT_RANGE_START);

// -----------------------------------------------
// EXTENSION CALL (NON-BLOCKING SAFE)
// -----------------------------------------------
function callExtension(method, params) {
  return new Promise((resolve, reject) => {
    if (!extensionSocket) {
      return reject(new Error("Extension not connected"));
    }

    const requestId = ++idCounter;

    const timer = setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        reject(new Error("Extension timeout"));
      }
    }, 10000);

    pending.set(requestId, {
      resolve: (r) => {
        clearTimeout(timer);
        resolve(r);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      }
    });

    const payload = { requestId, method, params };
    log("→ extension", payload);

    extensionSocket.send(JSON.stringify(payload));
  });
}

// -----------------------------------------------
// MCP STDIO
// -----------------------------------------------
process.stdin.setEncoding("utf8");
let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk;

  const lines = buffer.split("\n");
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;

    let req;
    try {
      req = JSON.parse(line);
    } catch {
      continue;
    }

    log("← OpenCode", req);
    handleMcp(req);
  }
});

// -----------------------------------------------
// MCP HANDLER (CRITICAL FIX)
// -----------------------------------------------
async function handleMcp(req) {
  const { id, method, params } = req;

  try {
    let result = null;

    // -------------------------
    // REQUIRED MCP METHODS
    // -------------------------
    if (method === "initialize") {
      result = {
        protocolVersion: params.protocolVersion,
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "chrome-extension-bridge",
          version: "1.0.0"
        }
      };
    } else if (method === "notifications/initialized") {
      return;
    }

    // ✅ CRITICAL: DO NOT WAIT FOR EXTENSION HERE
    else if (method === "tools/list") {
      result = {
        tools: [
          {
            name: "ping",
            description: "Ping extension",
            inputSchema: {
              type: "object",
              properties: {
                message: { type: "string" }
              }
            }
          },
          {
            name: "suiteql_execute_query",
            description: "Execute SuiteQL query",
            inputSchema: {
              type: "object",
              properties: {
                sql: { type: "string" }
              },
              required: ["sql"]
            }
          }
        ]
      };
    }

    // ✅ ONLY HERE we depend on extension
    else if (method === "tools/call") {
      result = await callExtension("tools/call", params);
    } else if (method === "resources/list") {
      result = { resources: [] };
    } else if (method === "prompts/list") {
      result = { prompts: [] };
    } else {
      return;
    }

    const response = { jsonrpc: "2.0", id, result };
    process.stdout.write(JSON.stringify(response) + "\n");
    log("→ OpenCode", response);
  } catch (err) {
    const error = {
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message: err.message }
    };

    process.stdout.write(JSON.stringify(error) + "\n");
    log("ERROR", error);
  }
}

// -----------------------------------------------
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

log("host started");
