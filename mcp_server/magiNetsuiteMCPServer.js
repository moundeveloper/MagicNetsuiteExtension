#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");

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
// NATIVE BRIDGE IPC CLIENT
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

let bridgeSocket = null;
let bridgeConnecting = null;
let bridgeBuffer = "";
let pending = new Map();
let idCounter = 0;
let currentAccount = null; // Account ID from latest extension response

function writeBridgeMessage(socket, message) {
  socket.write(JSON.stringify(message) + "\n");
}

function rejectAllPending(reason) {
  for (const [requestId, cb] of pending.entries()) {
    pending.delete(requestId);
    cb.reject(reason);
  }
}

function attachBridgeHandlers(socket) {
  socket.setEncoding("utf8");

  socket.on("data", (chunk) => {
    bridgeBuffer += chunk;
    const lines = bridgeBuffer.split("\n");
    bridgeBuffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        log("invalid native bridge JSON", line);
        continue;
      }

      log("← native bridge", msg);

      if (msg.account) {
        currentAccount = msg.account;
      }

      const cb = pending.get(msg.requestId);
      if (!cb) continue;

      pending.delete(msg.requestId);

      if (msg.success) cb.resolve(msg.result);
      else cb.reject(new Error(msg.error || "Extension error"));
    }
  });

  socket.on("close", () => {
    if (bridgeSocket === socket) {
      bridgeSocket = null;
      bridgeBuffer = "";
    }
    rejectAllPending(new Error("Native bridge disconnected"));
    log("native bridge disconnected");
  });

  socket.on("error", (err) => {
    log("native bridge socket error", err.message);
  });
}

function connectNativeBridge() {
  if (bridgeSocket && !bridgeSocket.destroyed) {
    return Promise.resolve(bridgeSocket);
  }

  if (bridgeConnecting) {
    return bridgeConnecting;
  }

  bridgeConnecting = new Promise((resolve, reject) => {
    log("connecting to native bridge", BRIDGE_PIPE_PATH);

    const socket = net.createConnection(BRIDGE_PIPE_PATH);
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      socket.destroy();
      settle(
        reject,
        new Error(
          "Chrome native bridge is not connected. Open the extension MCP Server page and enable the bridge."
        )
      );
    }, 2000);

    const onInitialError = (err) => {
      if (settled) return;
      socket.destroy();
      settle(
        reject,
        new Error(`Chrome native bridge is not connected: ${err.message}`)
      );
    };

    socket.once("connect", () => {
      socket.removeListener("error", onInitialError);
      bridgeSocket = socket;
      attachBridgeHandlers(socket);
      log("connected to native bridge", BRIDGE_PIPE_PATH);
      settle(resolve, socket);
    });

    socket.once("error", onInitialError);
  }).finally(() => {
    bridgeConnecting = null;
  });

  return bridgeConnecting;
}

// -----------------------------------------------
// EXTENSION CALL (NON-BLOCKING SAFE)
// -----------------------------------------------
async function callExtension(method, params) {
  const socket = await connectNativeBridge();
  const requestId = ++idCounter;

  return new Promise((resolve, reject) => {
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
    log("→ native bridge", payload);

    try {
      writeBridgeMessage(socket, payload);
    } catch (err) {
      pending.delete(requestId);
      clearTimeout(timer);
      reject(err);
    }
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
          version: "1.0.0",
          account: currentAccount
        }
      };
    } else if (method === "notifications/initialized") {
      return;
    }

    // Keep tools/list local and immediate. MCP clients may call it before the
    // browser-side native bridge is connected.
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
          },
          {
            name: "netsuite_search_docs",
            description:
              "Search the official NetSuite help documentation. Returns a list of matching pages with title, URL, and summary. Use this first to find relevant documentation, then call 'netsuite_read_doc_page' with a returned URL to get the full content. Always use this tool for any factual question about NetSuite — do NOT answer from training data.",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search keywords (e.g. 'SuiteScript record load', 'saved search filters', 'revenue recognition')."
                }
              },
              required: ["query"]
            }
          },
          {
            name: "netsuite_read_doc_page",
            description:
              "Read a NetSuite documentation page. Pass a URL returned by 'netsuite_search_docs' or a link returned by a previous 'netsuite_read_doc_page' call. Returns the page's main text (up to 10 000 characters) with inline Markdown links preserved, plus a structured links array for deeper follow-up research. Always include a References section with the page URL in your response after reading.",
            inputSchema: {
              type: "object",
              properties: {
                url: {
                  type: "string",
                  description: "Full NetSuite help center URL, either from netsuite_search_docs results or from the links array returned by netsuite_read_doc_page."
                }
              },
              required: ["url"]
            }
          },
          {
            name: "netsuite_get_scripts",
            description:
              "Search and list scripts from a live NetSuite account. Returns scriptid, id, name, scripttype, owner, scriptfile. " +
              "Supports SQL-level filtering by scriptId (exact match), scriptType, name (partial match), and owner (partial match) — these run server-side and reduce data transfer. " +
              "Also supports a client-side 'search' parameter for fuzzy keyword matching across all fields when you don't know which field to filter on. " +
              "Call with no parameters to list ALL scripts. Pass the numeric 'id' values to netsuite_get_script_files to read source code.",
            inputSchema: {
              type: "object",
              properties: {
                scriptId: {
                  type: "string",
                  description: "Exact script ID string (e.g. 'customscript_my_suitelet'). Only use when you know the full exact ID."
                },
                scriptType: {
                  type: "string",
                  description: "Filter by script type (e.g. 'CLIENT', 'USEREVENT', 'SCRIPTLET', 'MAPREDUCE', 'SCHEDULED', 'SUITELET', 'RESTLET', 'WORKFLOWACTION', 'PORTLET', 'BUNDLEINSTALLATION', 'MASSUPDATESCRIPT'). Case-insensitive. Filters at the SQL level."
                },
                name: {
                  type: "string",
                  description: "Partial script name to search for (case-insensitive LIKE match). Filters at the SQL level. E.g. 'Project' will match any script with 'Project' in the name."
                },
                owner: {
                  type: "string",
                  description: "Partial owner name to filter by (case-insensitive LIKE match). Filters at the SQL level. E.g. 'John' will match scripts owned by any user with 'John' in their entity ID."
                },
                search: {
                  type: "string",
                  description: "Fuzzy client-side keyword search across name, scriptid, owner, and scriptfile (case-insensitive). Use this as a general-purpose search when you don't know which specific field to filter on. Applied AFTER server-side filters."
                }
              }
            }
          },
          {
            name: "netsuite_get_script_files",
            description:
              "Fetch the full source code for one or more scripts by their internal numeric IDs (the 'id' field from netsuite_get_scripts).",
            inputSchema: {
              type: "object",
              properties: {
                scriptIds: {
                  type: "array",
                  items: { type: "number" },
                  description: "One or more script internal numeric IDs (e.g. [523] or [523, 841])."
                }
              },
              required: ["scriptIds"]
            }
          },
          {
            name: "netsuite_get_logs",
            description:
              "Get script execution logs from a live NetSuite account. Defaults to the last 7 days. Filter by scriptIds for targeted debugging. Focus on 'ERROR' and 'System' type logs for failures.",
            inputSchema: {
              type: "object",
              properties: {
                startDate: {
                  type: "string",
                  description: "Start date ISO string (e.g. '2025-05-11T00:00:00Z'). Defaults to 7 days ago."
                },
                endDate: {
                  type: "string",
                  description: "End date ISO string. Defaults to now."
                },
                scriptIds: {
                  type: "array",
                  items: { type: "number" },
                  description: "Filter by script internal IDs. Always provide this when investigating a specific script."
                },
                type: {
                  type: "string",
                  description: "Log type filter: 'ERROR', 'DEBUG', 'AUDIT', 'EMERGENCY', or 'System'."
                }
              }
            }
          },
          {
            name: "netsuite_load_record",
            description:
              "ALWAYS use this tool when the user asks to 'show', 'view', 'display', 'get', or 'load' a NetSuite record by ID. " +
              "Returns body fields only (no sublist rows) — fast and token-efficient. " +
              "If the user also needs line items or sublist rows, call netsuite_get_record_sublists afterward. " +
              "Do NOT use SuiteQL as a substitute — this tool returns all body field values (value + display text) directly from the record API. " +
              "Common recordType values: 'script' (SuiteScript), 'scriptdeployment', 'customer', 'salesorder', 'invoice', 'purchaseorder', 'employee', 'vendor', 'item', 'customrecord_<scriptid>' for custom records. " +
              "If you are unsure of the correct recordType string, call netsuite_list_record_types first.",
            inputSchema: {
              type: "object",
              properties: {
                recordType: {
                  type: "string",
                  description: "The SuiteScript record type ID. Examples: 'script', 'scriptdeployment', 'customer', 'salesorder', 'invoice', 'purchaseorder', 'employee', 'vendor', 'customrecord_foo'. Call netsuite_list_record_types if unsure."
                },
                recordId: {
                  type: "string",
                  description: "The internal numeric ID of the record to load (e.g. '3309')."
                }
              },
              required: ["recordType", "recordId"]
            }
          },
          {
            name: "netsuite_get_record_sublists",
            description:
              "Get the sublist rows (line items) for a NetSuite record. " +
              "Use this after netsuite_load_record when the user specifically needs line-item data (e.g. order items, expense lines, inventory lines). " +
              "Do NOT call this unless sublists are explicitly needed — sublist data can be very large. " +
              "Specify sublistIds to limit which sublists are returned; omit to get all sublists. " +
              "Common sublists: 'item' (line items), 'expense' (expense lines), 'apply' (applied transactions), 'links' (related records).",
            inputSchema: {
              type: "object",
              properties: {
                recordType: {
                  type: "string",
                  description: "The SuiteScript record type ID (e.g. 'salesorder', 'invoice', 'purchaseorder')."
                },
                recordId: {
                  type: "string",
                  description: "The internal numeric ID of the record (e.g. '3309')."
                },
                sublistIds: {
                  type: "array",
                  items: { type: "string" },
                  description: "Optional: limit which sublists are returned (e.g. ['item', 'expense']). Omit to return all sublists — can be large on transactions."
                }
              },
              required: ["recordType", "recordId"]
            }
          },
          {
            name: "netsuite_list_record_types",
            description:
              "List ALL available NetSuite record types — both standard built-in types and custom record types in this account. Returns { name, id } pairs. " +
              "Use this ONLY when you need to discover the correct `recordType` string to pass to netsuite_load_record or netsuite_get_record_fields and you cannot infer it from context. " +
              "Most common types (no lookup needed): 'script', 'scriptdeployment', 'customer', 'salesorder', 'invoice', 'purchaseorder', 'employee', 'vendor', 'customrecord_<scriptid>'.",
            inputSchema: {
              type: "object",
              properties: {}
            }
          },
          {
            name: "netsuite_get_record_fields",
            description:
              "Get the list of available body fields and sublist fields for a record type, WITHOUT loading a real record. " +
              "Use this as a metadata/discovery tool when you need to know what fields a type exposes before querying or building logic around it. " +
              "You do NOT need to call this before netsuite_load_record — load_record already returns all fields.",
            inputSchema: {
              type: "object",
              properties: {
                recordType: {
                  type: "string",
                  description: "The record type ID (e.g. 'script', 'salesorder', 'customer', 'customrecord_foo')."
                }
              },
              required: ["recordType"]
            }
          },
          {
            name: "netsuite_list_bundles",
            description:
              "List SuiteApp bundles in the current NetSuite account. Returns each bundle's name, ID, version, app ID, abstract, creator, dates, and a `type` field ('installed' or 'created'). Use the `filter` parameter to narrow results: 'installed' returns only marketplace/3rd-party bundles, 'created' returns only bundles built and published in-house, 'all' (default) returns both.",
            inputSchema: {
              type: "object",
              properties: {
                filter: {
                  type: "string",
                  enum: ["all", "installed", "created"],
                  description:
                    "'all' (default) – both installed and created bundles. 'installed' – only bundles downloaded from the SuiteApp marketplace (type=I). 'created' – only bundles built and published in-house (type=S)."
                }
              }
            }
          },
          {
            name: "netsuite_get_bundle_components",
            description:
              "Get the detailed list of components installed by a specific bundle, identified by its Bundle ID. Returns components grouped by category (e.g. 'Script Files', 'Custom Records') and subcategory, with each component's name, script/record ID, references, and lock status.",
            inputSchema: {
              type: "object",
              properties: {
                bundleId: {
                  type: "string",
                  description: "The numeric Bundle ID to inspect (e.g. '123456'). Obtain this from netsuite_list_bundles."
                },
                bundleName: {
                  type: "string",
                  description: "Optional bundle name for context."
                }
              },
              required: ["bundleId"]
            }
          },
          {
            name: "netsuite_find_folder",
            description:
              "Search the ENTIRE NetSuite File Cabinet for folders matching a name or ID. Searches globally (not just root). " +
              "Use this first when you don't know a folder's ID. " +
              "After finding the folder, call netsuite_list_folder with the returned id to see its contents. " +
              "Returns matching folders with id, name, and parent folder id.",
            inputSchema: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "Exact internal ID of the folder (e.g. '67890'). Use for direct lookup."
                },
                name: {
                  type: "string",
                  description: "Partial folder name to search for globally (case-insensitive). E.g. 'test to remove' will find any folder containing that text anywhere in the File Cabinet."
                }
              }
            }
          },
          {
            name: "netsuite_list_folder",
            description:
              "List the immediate contents of a File Cabinet folder — returns both files and subfolders in a single call. " +
              "Use this after netsuite_find_folder to explore a folder's contents. " +
              "Returns { folderId, subfolders: [{id, name}], files: [{id, name, filesize, filetype, url}] }.",
            inputSchema: {
              type: "object",
              properties: {
                folderId: {
                  type: "string",
                  description: "Internal ID of the folder to list (e.g. '12345'). Obtain from netsuite_find_folder."
                }
              },
              required: ["folderId"]
            }
          },
          {
            name: "netsuite_find_file",
            description:
              "Search the ENTIRE NetSuite File Cabinet for files matching a name or ID. Searches globally across all folders. " +
              "Returns matching files with id, name, folder (parent folder id), filesize, filetype, and url. " +
              "To read the actual content of a file after finding it, call netsuite_read_file with the file id.",
            inputSchema: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "Exact internal ID of the file (e.g. '12345'). Use for direct lookup."
                },
                name: {
                  type: "string",
                  description: "Partial file name to search globally (case-insensitive LIKE match). E.g. 'myScript' will match 'myScript.js' anywhere in the File Cabinet."
                }
              }
            }
          },
          {
            name: "netsuite_read_file",
            description:
              "Read the actual content of a NetSuite File Cabinet file by its internal ID. " +
              "ALWAYS use this tool when you have a file ID (e.g. from a SuiteQL query result or from netsuite_find_file) and the user wants to see or display the file contents. " +
              "Returns the file name, content type, and full text content (or base64 for binary files). " +
              "Works with any text-based file: .js, .json, .xml, .csv, .html, .ftl, .txt, etc.",
            inputSchema: {
              type: "object",
              properties: {
                fileId: {
                  type: "string",
                  description: "The internal numeric ID of the file to read (e.g. '21301'). Obtain this from a SuiteQL query or from netsuite_find_file."
                }
              },
              required: ["fileId"]
            }
          }
        ]
      };
    }

    // suiteql_get_guide is handled locally — no extension needed
    else if (method === "tools/call" && params?.name === "suiteql_get_guide") {
      const accountNote = currentAccount
        ? `\n\n## CURRENT ACCOUNT\nYou are connected to NetSuite account: **${currentAccount}**`
        : "";
      result = {
        content: [{ type: "text", text: SUITEQL_GUIDE + accountNote }]
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
// rejection would kill the process with no log entry, making bridge failures
// hard to diagnose from the AI client side.
process.on("uncaughtException", (err) => {
  log("UNCAUGHT EXCEPTION — process will exit", err.message, err.stack || "");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log("UNHANDLED REJECTION", reason instanceof Error ? reason.message : String(reason));
  // Don't exit — keep running so the extension can still reconnect.
});

log("host started");
