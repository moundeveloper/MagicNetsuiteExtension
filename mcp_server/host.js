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
// SUITEQL AGENT GUIDE
// Returned by suiteql_get_guide tool and prompts/get.
// Teaches agents the correct usage patterns so they
// don't waste calls or produce invalid queries.
// -----------------------------------------------
const SUITEQL_GUIDE = `
# SuiteQL Agent Guide — NetSuite MCP Server

## CRITICAL RULES

### 1. NEVER USE \`LIMIT\`
SuiteQL is built on Oracle SQL. \`LIMIT\` does NOT exist and will throw an error.
Use ROWNUM in a WHERE clause instead:
  CORRECT: SELECT id, name FROM customer WHERE ROWNUM <= 10
  WRONG:   SELECT id, name FROM customer LIMIT 10

### 2. ALWAYS FOLLOW THE DISCOVERY WORKFLOW
Never guess table names or column names — always verify first:
  Step 1: suiteql_search_tables        — find the right table
  Step 2: suiteql_get_table_fields     — get valid column names + types
  Step 3: suiteql_discover_field_values — get valid values for WHERE filters
  Step 4: suiteql_execute_query        — run the final verified query

### 3. ALWAYS LIMIT ROWS
Every query must include a ROWNUM guard to prevent runaway results:
  WHERE ROWNUM <= 25

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

log("host started");
