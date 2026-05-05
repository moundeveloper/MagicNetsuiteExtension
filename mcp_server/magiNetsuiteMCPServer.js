#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { WebSocketServer } = require("ws");

// -----------------------------------------------
// CONFIG + BASE DIR
// -----------------------------------------------
// We need to find host.config.json on the real filesystem.
// Two execution modes require different base directories:
//
//   pkg-compiled exe  →  process.execPath is the .exe itself, so
//                        path.dirname(process.execPath) is its folder.
//
//   plain node magiNetsuiteMCPServer.js →  process.execPath is the node binary (wrong),
//                         so __dirname (the script's own folder) is correct.
//
// We avoid relying on process.pkg (not guaranteed across all pkg versions)
// and instead probe both candidate directories, using whichever one actually
// contains host.config.json.
//
// Supported config keys:
//   shouldLog  boolean  — write log files (default: true)
let shouldLog = true;
let BASE_DIR = __dirname; // fallback

for (const candidateDir of [path.dirname(process.execPath), __dirname]) {
  try {
    const configPath = path.join(candidateDir, "host.config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (typeof config.shouldLog === "boolean") {
      shouldLog = config.shouldLog;
    }
    BASE_DIR = candidateDir;
    break;
  } catch {
    // Not found here — try next candidate.
  }
}

// -----------------------------------------------
// LOG (pkg-safe, per-process)
// -----------------------------------------------
// Each magiNetsuiteMCPServer.js instance writes to its own log file named magiNetsuiteMCPServer_<pid>.log.
// Previously all instances shared magiNetsuiteMCPServer.log; on Windows, concurrent
// fs.appendFileSync calls from two processes race for the file lock and
// the losers are silently swallowed, making async events (port binds,
// extension connect/disconnect) invisible in the logs.
const LOG_FILE = path.join(BASE_DIR, `magiNetsuiteMCPServer_${process.pid}.log`);

// Also maintain a rolling "latest" symlink-style copy for quick tailing.
const LOG_FILE_LATEST = path.join(BASE_DIR, "magiNetsuiteMCPServer.log");

function log(...args) {
  if (!shouldLog) return;
  try {
    const line =
      `[${new Date().toISOString()}] [pid:${process.pid}] ` +
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ") +
      "\n";

    fs.appendFileSync(LOG_FILE, line);
    // Best-effort write to the shared latest log; ignore lock conflicts.
    try { fs.appendFileSync(LOG_FILE_LATEST, line); } catch {}
  } catch {}
}

// -----------------------------------------------
// WS SERVER
// -----------------------------------------------
const PORT_RANGE_START = 9700;
const PORT_RANGE_END = 9720;

let extensionSocket = null;
let pending = new Map();
let idCounter = 0;

// -----------------------------------------------
// PORT BIND
//
// Uses an async loop with explicit cleanup so each failed port attempt
// is fully torn down before trying the next one.  The previous approach
// (recursive calls with fresh servers) still left unreleased handles on
// Windows when the listen() callback never fired.
// -----------------------------------------------
function tryPort(port) {
  return new Promise((resolve) => {
    log("trying port", port);

    const server = http.createServer();
    const wss = new WebSocketServer({ server });

    const cleanup = () => {
      try { wss.close(); } catch {}
      try { server.close(); } catch {}
    };

    // ws v8.x registers server.on('error', (err) => wss.emit('error', err)).
    // Its listener fires BEFORE any server.once('error', ...) we register, and
    // if the wss has no error handler Node throws the re-emitted error as an
    // uncaught exception — killing the process before the port-retry loop can
    // move to the next port.  Handle errors on the wss directly; ws's
    // forwarding ensures we receive all server-level errors here.
    wss.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        log("port", port, "in use");
        cleanup();
        resolve(null);
      } else {
        log("server error on port", port, err.message);
        cleanup();
        process.exit(1);
      }
    });

    server.listen(port, "127.0.0.1", () => {
      log("listening", port);

      // Wire up WebSocket connection handler
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

      resolve({ server, wss, port });
    });
  });
}

(async () => {
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    const result = await tryPort(port);
    if (result) return; // bound successfully
  }
  log("no free port in range", PORT_RANGE_START, "-", PORT_RANGE_END);
  process.exit(1);
})();

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
// SUITEQL AGENT GUIDE
// Returned by suiteql_get_guide tool and prompts/get.
// Teaches agents the correct usage patterns so they
// don't waste calls or produce invalid queries.
// -----------------------------------------------
const SUITEQL_GUIDE = `
# SuiteQL Agent Guide — NetSuite MCP Server

You are connected to a live NetSuite account via the MCP Connector. Apply every rule in this guide to every query — no exceptions. Execute immediately. Show your reasoning throughout the process.

## CRITICAL RULES

### 1. NEVER USE \`LIMIT\`
SuiteQL is built on Oracle SQL. \`LIMIT\` does NOT exist and will throw an error.
Use ROWNUM in a WHERE clause instead:
  CORRECT: SELECT id, name FROM customer WHERE ROWNUM <= 10
  WRONG:   SELECT id, name FROM customer LIMIT 10

### 2. ALWAYS FOLLOW THE MANDATORY DISCOVERY WORKFLOW
Never guess table names, column names, or field values — always verify first:
  Step 1: suiteql_search_tables        — find the right table
  Step 2: suiteql_get_table_fields     — get valid column names + types
  Step 3: suiteql_discover_field_values — get valid values for WHERE filters
  Step 4: suiteql_get_table_joins      — discover JOIN relationships (if joins needed)
  Step 5: Build the query              — using ONLY verified tables, columns, and values
  Step 6: suiteql_execute_query        — run the final verified query

### 3. ALWAYS LIMIT ROWS
Every query must include a ROWNUM guard to prevent runaway results:
  WHERE ROWNUM <= 25

## HARD RULES — NO EXCEPTIONS
- ALWAYS call suiteql_search_tables before assuming a table name
- ALWAYS call suiteql_get_table_fields before writing SELECT or WHERE clauses
- ALWAYS call suiteql_discover_field_values before filtering on status, type, category, class, or any enum-like field — never assume values from general knowledge
- ALWAYS call suiteql_get_table_joins before writing any JOIN clause
- ALWAYS include WHERE ROWNUM <= N on every query
- NEVER use LIMIT — it is invalid SuiteQL syntax
- NEVER guess or assume table names, column names, or enum values
- NEVER skip the discovery workflow steps
- NEVER repeat a tool call if you already have its result — extract from previous results
- If a query fails, analyze the error, fix the issue from the relevant discovery step, and retry

## SYNTAX REFERENCE

Row limiting (mandatory):
  WHERE ROWNUM <= 25

Date filtering:
  WHERE trandate >= TO_DATE('2024-01-01', 'YYYY-MM-DD')

NULL checks:
  WHERE fieldname IS NOT NULL
  WHERE fieldname IS NULL

String comparison (case-sensitive in SuiteQL):
  WHERE status = 'A'

Numeric ID join pattern:
  JOIN customer ON transaction.entity = customer.id

Text search (slow — use only when necessary):
  WHERE LOWER(name) LIKE '%keyword%'

Custom records:
  Table name = customrecord_<scriptid_lowercase>
  Discover with suiteql_search_tables

## COMMON TABLES
  customer            Customer master records
  transaction         All transaction types (invoices, bills, POs, etc.)
  item                Inventory / non-inventory / service items
  vendor              Vendor records
  employee            Employee records
  account             Chart of accounts
  contact             Contact records
  customrecord_*      Custom record types — discover with suiteql_search_tables

## FULL WORKFLOW EXAMPLE
Goal: Find open invoices for customer ID 123

  1. suiteql_search_tables("transaction")
     → confirms table name is "transaction"

  2. suiteql_get_table_fields("transaction")
     → reveals columns: id, tranid, entity, status, type, trandate, amount

  3. suiteql_discover_field_values("transaction", "type")
     → invoice type value = "CustInvc"

  4. suiteql_discover_field_values("transaction", "status")
     → open invoice status = "CustInvc:A"

  5. suiteql_execute_query:
       SELECT t.id, t.tranid, t.trandate, t.amount
       FROM transaction t
       WHERE t.type = 'CustInvc'
         AND t.status = 'CustInvc:A'
         AND t.entity = 123
         AND ROWNUM <= 25

## JOINS
Always call suiteql_get_table_joins before writing JOIN clauses.
The join condition column names are not always obvious.
`.trim();

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
          tools: {},
          prompts: {}
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
            name: "suiteql_get_guide",
            description:
              "CALL THIS FIRST before any SuiteQL work. Returns the complete usage guide: correct syntax rules (no LIMIT — use ROWNUM), the mandatory discovery workflow, common table names, and worked examples.",
            inputSchema: { type: "object", properties: {} }
          },
          {
            name: "ping",
            description: "Ping the Chrome extension. Returns pong.",
            inputSchema: {
              type: "object",
              properties: { message: { type: "string" } }
            }
          },
          {
            name: "suiteql_search_tables",
            description:
              "Step 1 of discovery workflow. Search available SuiteQL tables by keyword. Returns table IDs and labels. Always run this before writing a query to confirm the exact table name.",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Keyword to filter tables (e.g. 'customer', 'transaction'). Leave empty to list all."
                }
              }
            }
          },
          {
            name: "suiteql_get_table_fields",
            description:
              "Step 2 of discovery workflow. Get all columns for a SuiteQL table — field IDs, labels, and data types. Always call this before writing SELECT or WHERE clauses to avoid unknown-column errors.",
            inputSchema: {
              type: "object",
              properties: {
                tableName: {
                  type: "string",
                  description: "Exact table ID returned by suiteql_search_tables (e.g. 'customer')."
                }
              },
              required: ["tableName"]
            }
          },
          {
            name: "suiteql_get_table_joins",
            description:
              "Get available JOIN relationships for a SuiteQL table. Call this before writing any JOIN clause — join column names are not always obvious.",
            inputSchema: {
              type: "object",
              properties: {
                tableName: {
                  type: "string",
                  description: "Exact table ID to get joins for."
                }
              },
              required: ["tableName"]
            }
          },
          {
            name: "suiteql_execute_query",
            description:
              "Step 4 of discovery workflow. Execute a SuiteQL query. IMPORTANT: NEVER use LIMIT — SuiteQL does not support it and it will error. Use ROWNUM in a WHERE clause instead: WHERE ROWNUM <= 25",
            inputSchema: {
              type: "object",
              properties: {
                sql: {
                  type: "string",
                  description: "Valid SuiteQL query. Must use ROWNUM <= N for row limiting, never LIMIT."
                }
              },
              required: ["sql"]
            }
          },
          {
            name: "suiteql_discover_field_values",
            description:
              "Step 3 of discovery workflow. Sample DISTINCT values for a column to find exact values for WHERE filters. Always call this before filtering on status, type, or any enum-like field.",
            inputSchema: {
              type: "object",
              properties: {
                tableName: {
                  type: "string",
                  description: "Exact table ID (e.g. 'transaction')."
                },
                fieldId: {
                  type: "string",
                  description: "Column ID to sample values for (e.g. 'status', 'type')."
                }
              },
              required: ["tableName", "fieldId"]
            }
          }
        ]
      };
    }

    // suiteql_get_guide is handled locally — no extension needed
    else if (method === "tools/call" && params?.name === "suiteql_get_guide") {
      result = {
        content: [{ type: "text", text: SUITEQL_GUIDE }]
      };
    }

    // ✅ ONLY HERE we depend on extension
    else if (method === "tools/call") {
      result = await callExtension("tools/call", params);
    } else if (method === "resources/list") {
      result = { resources: [] };
    } else if (method === "prompts/list") {
      result = {
        prompts: [
          {
            name: "suiteql-guide",
            description: "System prompt with SuiteQL syntax rules, discovery workflow, and worked examples for the NetSuite MCP tools."
          }
        ]
      };
    } else if (method === "prompts/get") {
      result = {
        description: "SuiteQL guide for NetSuite MCP tools",
        messages: [
          {
            role: "user",
            content: { type: "text", text: SUITEQL_GUIDE }
          }
        ]
      };
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

// Catch any unhandled errors so the process doesn't die silently.
// Without these, a pkg-specific require failure or an uncaught promise
// rejection would kill the process with no log entry, making it look like
// the port was never bound (background.js scan finds nothing on 9701+).
process.on("uncaughtException", (err) => {
  log("UNCAUGHT EXCEPTION — process will exit", err.message, err.stack || "");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log("UNHANDLED REJECTION", reason instanceof Error ? reason.message : String(reason));
  // Don't exit — keep running so the extension can still reconnect.
});

log("host started");
