#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

// -----------------------------------------------
// IMPORTANT FIX: write next to exe (pkg-safe)
// -----------------------------------------------
const LOG_FILE = path.join(process.cwd(), "host.log");

function log(...args) {
  try {
    const line =
      `[${new Date().toISOString()}] ` +
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ") +
      "\n";

    fs.appendFileSync(LOG_FILE, line);
  } catch (e) {
    // NEVER crash MCP server because logging fails
    process.stderr.write("[log-error] " + e.message + "\n");
  }
}

// -----------------------------------------------
// WebSocket server
// -----------------------------------------------

const PORT_RANGE_START = 9700;
const PORT_RANGE_END = 9720;

const server = http.createServer();
const wss = new WebSocketServer({ server });

let extensionSocket = null;
let pending = new Map();
let idCounter = 0;

wss.on("connection", (ws) => {
  process.stderr.write("[host] Chrome extension connected\n");
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
    process.stderr.write("[host] Chrome extension disconnected\n");
    log("extension disconnected");
    extensionSocket = null;
  });
});

// -----------------------------------------------
// Port binding
// -----------------------------------------------

function listenOnFreePort(port) {
  if (port > PORT_RANGE_END) {
    log("no free port found");
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
    process.stderr.write(`[host] listening ${port}\n`);
    log("listening", port);
  });
}

listenOnFreePort(PORT_RANGE_START);

// -----------------------------------------------
// Extension call
// -----------------------------------------------

function callExtension(method, params) {
  return new Promise((resolve, reject) => {
    if (!extensionSocket) {
      return reject(new Error("Chrome extension not connected"));
    }

    const requestId = ++idCounter;

    const timer = setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        reject(new Error("timeout"));
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

    extensionSocket.send(JSON.stringify({ requestId, method, params }));
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
// MCP HANDLER
// -----------------------------------------------

async function handleMcp(req) {
  const { id, method, params } = req;

  try {
    let result = null;

    if (method === "initialize") {
      result = {
        protocolVersion: params.protocolVersion,
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        },
        serverInfo: {
          name: "chrome-extension-bridge",
          version: "1.0.0"
        }
      };
    } else if (method === "notifications/initialized") {
      return;
    } else if (method === "tools/list") {
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
          }
        ]
      };
    } else if (method === "tools/call") {
      const { name, arguments: args = {} } = params;

      if (name === "ping") {
        const text = args.message ? `pong: ${args.message}` : "pong";
        result = { content: [{ type: "text", text }] };
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
    } else if (method === "resources/list") {
      result = { resources: [] };
    } else if (method === "prompts/list") {
      result = { prompts: [] };
    } else {
      log("ignored method", method);
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
// EXIT
// -----------------------------------------------

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

process.stderr.write("[host] started\n");
log("host started");
