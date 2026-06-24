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

const MIME_BY_EXTENSION = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".ts": "text/typescript",
  ".json": "application/json",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".xml": "application/xml",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".ftl": "text/plain",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

function guessMimeType(filePath) {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function normalizeUploadFileSpecs(args = {}) {
  if (Array.isArray(args.files) && args.files.length > 0) {
    return args.files.map((file) => ({
      localPath: file.localPath || file.path,
      fileName: file.fileName,
      folderId: file.folderId ?? args.folderId,
      mimeType: file.mimeType
    }));
  }

  if (Array.isArray(args.localPaths) && args.localPaths.length > 0) {
    return args.localPaths.map((localPath) => ({
      localPath,
      folderId: args.folderId,
      mimeType: args.mimeType
    }));
  }

  if (args.localPath || args.path) {
    return [{
      localPath: args.localPath || args.path,
      fileName: args.fileName,
      folderId: args.folderId,
      mimeType: args.mimeType
    }];
  }

  return [];
}

async function uploadLocalFilesViaExtension(args = {}) {
  const specs = normalizeUploadFileSpecs(args);
  if (specs.length === 0) return null;

  const uploaded = [];
  const errors = [];

  for (const spec of specs) {
    const rawPath = String(spec.localPath || "").trim();
    if (!rawPath) {
      errors.push("Missing localPath for one file.");
      continue;
    }

    const resolvedPath = path.resolve(rawPath);
    let stat;
    try {
      stat = fs.statSync(resolvedPath);
    } catch (err) {
      errors.push(`${rawPath}: ${err.message}`);
      continue;
    }

    if (!stat.isFile()) {
      errors.push(`${resolvedPath}: not a file`);
      continue;
    }

    const bytes = fs.readFileSync(resolvedPath);
    const fileName = spec.fileName || path.basename(resolvedPath);
    const response = await callExtension("tools/call", {
      name: "netsuite_upload_file",
      arguments: {
        fileName,
        fileContentBase64: bytes.toString("base64"),
        mimeType: spec.mimeType || guessMimeType(resolvedPath),
        folderId: spec.folderId ?? args.folderId ?? -15
      }
    });

    const textItem = response?.content?.find?.((item) => item?.type === "text");
    let payload = null;
    if (textItem?.text) {
      try {
        payload = JSON.parse(textItem.text);
      } catch {
        payload = { raw: textItem.text };
      }
    }

    uploaded.push({
      localPath: resolvedPath,
      fileName,
      bytes: bytes.length,
      result: payload ?? response
    });
  }

  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        uploadedCount: uploaded.length,
        errorCount: errors.length,
        uploaded,
        errors
      }, null, 2)
    }]
  };
}

function pdfDataUrlToBuffer(dataUrl) {
  const value = String(dataUrl || "").trim();
  const match = /^data:application\/pdf[^,]*;base64,(.+)$/i.exec(
    value
  );
  if (match) return Buffer.from(match[1], "base64");

  if (/^[A-Za-z0-9+/=\r\n]+$/.test(value) && value.length > 32) {
    const buffer = Buffer.from(value, "base64");
    return buffer.slice(0, 5).toString("ascii") === "%PDF-" ? buffer : null;
  }

  return null;
}

function decodePdfLiteralString(value) {
  let output = "";
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char !== "\\") {
      output += char;
      continue;
    }

    const next = value[++i];
    if (next === "n") output += "\n";
    else if (next === "r") output += "\r";
    else if (next === "t") output += "\t";
    else if (next === "b") output += "\b";
    else if (next === "f") output += "\f";
    else if (next === "(" || next === ")" || next === "\\") output += next;
    else if (/[0-7]/.test(next || "")) {
      let octal = next;
      for (let j = 0; j < 2 && /[0-7]/.test(value[i + 1] || ""); j++) {
        octal += value[++i];
      }
      output += String.fromCharCode(parseInt(octal, 8));
    } else if (next) {
      output += next;
    }
  }

  const bytes = Buffer.from(output, "binary");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let utf16 = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      utf16 += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return utf16;
  }

  return output;
}

function decodePdfHexString(value) {
  const clean = value.replace(/\s+/g, "");
  const padded = clean.length % 2 === 0 ? clean : `${clean}0`;
  const bytes = Buffer.from(padded, "hex");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let utf16 = "";
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      utf16 += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return utf16;
  }
  return bytes.toString("latin1");
}

function normalizeExtractedPdfText(text) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractPdfTextFallback(pdfBuffer) {
  const source = pdfBuffer.toString("latin1");
  const chunks = [];
  const tokenPattern =
    /\(((?:\\.|[^\\)])*)\)\s*Tj|<([0-9A-Fa-f\s]+)>\s*Tj|\[((?:.|\n|\r)*?)\]\s*TJ/g;

  let match;
  while ((match = tokenPattern.exec(source))) {
    if (match[1] !== undefined) {
      chunks.push(decodePdfLiteralString(match[1]));
      continue;
    }

    if (match[2] !== undefined) {
      chunks.push(decodePdfHexString(match[2]));
      continue;
    }

    const arrayText = match[3];
    const arrayStringPattern = /\(((?:\\.|[^\\)])*)\)|<([0-9A-Fa-f\s]+)>/g;
    let arrayMatch;
    while ((arrayMatch = arrayStringPattern.exec(arrayText))) {
      chunks.push(
        arrayMatch[1] !== undefined
          ? decodePdfLiteralString(arrayMatch[1])
          : decodePdfHexString(arrayMatch[2])
      );
    }
  }

  return normalizeExtractedPdfText(chunks.join(" "));
}

async function enrichNetsuiteReadFilePdfResult(result) {
  const textItem = result?.content?.find?.((item) => item?.type === "text");
  if (!textItem || typeof textItem.text !== "string") return result;

  let payload;
  try {
    payload = JSON.parse(textItem.text);
  } catch {
    return result;
  }

  const contentType = String(payload.contentType || "").toLowerCase();
  const isPdf =
    contentType.includes("application/pdf") ||
    /^data:application\/pdf/i.test(String(payload.content || ""));
  if (!isPdf) return result;

  try {
    const buffer = pdfDataUrlToBuffer(payload.content);
    if (!buffer) {
      throw new Error("PDF payload was not a recognized base64 PDF value");
    }

    let parsed;
    let parserError = null;
    let extractedText = extractPdfTextFallback(buffer);

    if (!extractedText) {
      try {
        const pdfParse = require("pdf-parse");
        parsed = await pdfParse(buffer);
        extractedText = normalizeExtractedPdfText(parsed?.text || "");
      } catch (err) {
        parserError = err;
      }
    }

    if (!extractedText) {
      throw parserError || new Error("PDF contained no extractable text layer");
    }

    payload.binary = false;
    payload.extractedPdfText = true;
    payload.base64Omitted = true;
    payload.pageCount = parsed?.numpages || undefined;
    payload.content = extractedText;
    if (parserError) {
      payload.pdfExtractionWarning =
        `Used built-in PDF text extraction; optional parser failed: ${
          parserError?.message || String(parserError)
        }`;
    }
  } catch (err) {
    const message = err?.message || String(err);
    payload.binary = false;
    payload.extractedPdfText = false;
    payload.base64Omitted = true;
    payload.content = `[PDF text extraction failed: ${message}]`;
    payload.pdfExtractionError = message;
  }

  textItem.text = JSON.stringify(payload, null, 2);
  return result;
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

## SCRIPT DEPLOYMENT IDS
The SuiteQL scriptdeployment table is unusual:
  - scriptdeployment.id is NOT the deployment record internal ID used by the NetSuite record API or deployment URL tools.
  - scriptdeployment.primarykey IS the actual scriptdeployment record internal ID.
  - When a SuiteQL query result for scriptdeployment will be used with netsuite_load_record(recordType: "scriptdeployment"), netsuite_get_script_deployment_url, execute/deployment tools, or a NetSuite deployment URL, use primarykey.
  - Select it explicitly and alias it clearly:
      SELECT sd.primarykey AS deployment_record_id, sd.scriptid, sd.deploymentid
      FROM scriptdeployment sd
      WHERE ROWNUM <= 25

## RECORD-RELATED FILES AND REPORTS
When the user asks for a report/file/document/PDF "for", "with", or "related to" a lead/customer/entity/transaction ID:
  - Treat the number as the record ID unless the user explicitly says "file ID".
  - Do NOT call netsuite_find_file(id: recordId) or netsuite_read_file(fileId: recordId).
  - Use SuiteQL discovery to find the relationship table/field first.
  - Loading the record can confirm identity, but it does not locate related files.

Example: "find the report file with lead id 181"
  1. suiteql_search_tables("lead") and/or suiteql_search_tables("report")
  2. suiteql_get_table_fields / suiteql_get_table_joins on likely customer/customrecord tables
  3. suiteql_execute_query against the related table where the lead/customer field = 181
  4. Use netsuite_read_file only with a file ID returned by that query

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
              "Step 4 of discovery workflow. Execute a SuiteQL query. IMPORTANT: NEVER use LIMIT — SuiteQL does not support it and it will error. Use ROWNUM in a WHERE clause instead: WHERE ROWNUM <= 25. When querying scriptdeployment, select primarykey; it is the actual deployment record internal ID. scriptdeployment.id is not.",
            inputSchema: {
              type: "object",
              properties: {
                sql: {
                  type: "string",
                  description:
                    "Valid SuiteQL query. Must use ROWNUM <= N for row limiting, never LIMIT. For scriptdeployment, select primarykey when you need the deployment record internal ID."
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
            name: "netsuite_get_deployed_scripts",
            description:
              "Get all currently deployed scripts attached to a specific record type, including full source code for analysis. " +
              "Pass a record type ID from netsuite_list_record_types, such as 'salesorder', 'customer', 'itemfulfillment', or 'customrecord_my_type'. " +
              "Returns scriptName, scriptType, scriptId, internal numeric id, and scriptFile content for each deployed script.",
            inputSchema: {
              type: "object",
              properties: {
                recordType: {
                  type: "string",
                  description:
                    "The NetSuite record type ID. Use netsuite_list_record_types first if you do not know the exact value."
                }
              },
              required: ["recordType"]
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
            name: "netsuite_lists",
            description:
              "List NetSuite custom lists from the current account. Returns metadata only: name, internalId, and inactive status. " +
              "Use this to discover the listId to pass to netsuite_list_items. Optional query filters by list name or internal ID.",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Optional partial list name or internal ID filter."
                },
                includeInactive: {
                  type: "boolean",
                  description: "Include inactive custom lists. Defaults to false."
                }
              }
            }
          },
          {
            name: "netsuite_list_items",
            description:
              "Load a NetSuite custom list and return its values from the customvalue sublist. " +
              "Pass listId from netsuite_lists. Returns each value's internalId, display value, line number, and inactive status.",
            inputSchema: {
              type: "object",
              properties: {
                listId: {
                  type: "string",
                  description: "The custom list internal ID returned by netsuite_lists, or a valid customlist script ID when supported by NetSuite record.load."
                },
                includeInactive: {
                  type: "boolean",
                  description: "Include inactive list values. Defaults to false."
                }
              },
              required: ["listId"]
            }
          },
          {
            name: "netsuite_create_list",
            description:
              "Create a NetSuite custom list using the native custlist.nl form POST. " +
              "Destructive: creates metadata in the account. Pass name, scriptId, and values. " +
              "The scriptId accepts customlist_my_list, my_list, or _my_list and is normalized to NetSuite's metadata suffix format.",
            inputSchema: {
              type: "object",
              properties: {
                name: { type: "string", description: "Custom list display name." },
                scriptId: { type: "string", description: "Custom list script ID, e.g. customlist_ai_session_status, ai_session_status, or _ai_session_status." },
                description: { type: "string" },
                isOrdered: { type: "boolean", description: "Whether the custom list is ordered. Defaults to true." },
                isHierarchical: { type: "boolean", description: "Whether the custom list is hierarchical. Defaults to false." },
                values: {
                  type: "array",
                  items: {
                    anyOf: [
                      { type: "string" },
                      {
                        type: "object",
                        properties: {
                          value: { type: "string" },
                          abbreviation: { type: "string" },
                          isInactive: { type: "boolean" },
                          scriptId: { type: "string" }
                        },
                        required: ["value"]
                      }
                    ]
                  },
                  description: "Custom list values. Strings are accepted, or objects like { value: 'IN_PROGRESS', abbreviation: 'I' }."
                },
                listFields: { type: "object", description: "Additional raw form fieldId-to-value pairs to include in the custlist.nl POST." }
              },
              required: ["name", "scriptId", "values"]
            }
          },
          {
            name: "netsuite_update_list",
            description:
              "Update a NetSuite custom list using the native custlist.nl edit form POST. " +
              "Destructive: modifies metadata in the account. Use valuesToAdd to append missing values, valuesToUpdate to rename/change existing values, or replaceAllValues to replace the whole value set. " +
              "The tool fetches the existing edit form first and preserves NetSuite row tokens/translation metadata where possible.",
            inputSchema: {
              type: "object",
              properties: {
                listId: { type: "string", description: "Internal ID of the custom list to edit." },
                name: { type: "string", description: "Optional new custom list display name." },
                scriptId: { type: "string", description: "Optional custom list script ID, e.g. customlist_ai_session_status or _ai_session_status." },
                description: { type: "string" },
                isOrdered: { type: "boolean", description: "Whether the custom list is ordered." },
                isHierarchical: { type: "boolean", description: "Whether the custom list is hierarchical." },
                valuesToAdd: {
                  type: "array",
                  items: { type: "object", properties: { value: { type: "string" }, abbreviation: { type: "string" }, isInactive: { type: "boolean" }, scriptId: { type: "string" } }, required: ["value"] },
                  description: "Values to add if missing, e.g. [{ value: 'FAILED', abbreviation: 'F' }]. Existing matching values are skipped."
                },
                valuesToUpdate: {
                  type: "array",
                  items: { type: "object", properties: { id: { type: "string" }, internalId: { type: "string" }, currentValue: { type: "string" }, value: { type: "string" }, abbreviation: { type: "string" }, isInactive: { type: "boolean" } }, required: ["value"] },
                  description: "Existing values to update. Match by id/internalId when known, otherwise by currentValue; value is the new display value."
                },
                replaceAllValues: {
                  type: "array",
                  items: { type: "object", properties: { id: { type: "string" }, internalId: { type: "string" }, value: { type: "string" }, abbreviation: { type: "string" }, isInactive: { type: "boolean" } }, required: ["value"] },
                  description: "Complete desired value set. Existing rows are preserved by id/internalId/currentValue/value where possible; omitted rows are removed from the submitted list."
                },
                listFields: { type: "object", description: "Additional raw form fieldId-to-value pairs to include in the custlist.nl POST." }
              },
              required: ["listId"]
            }
          },
          {
            name: "netsuite_create_record",
            description:
              "Create a NetSuite standard or custom record using SuiteScript record.create, Record.setValue, and Record.save. " +
              "Destructive: this creates data in the account. Pass recordType and a values object mapping body field IDs to values. " +
              "Date fields are normalized automatically: DATE, DATETIME, and DATETIMETZ fields receive SuiteScript Date objects. " +
              "For custom records, recordType is the custom record script ID such as customrecord_my_type. This tool does not create sublist lines or subrecords.",
            inputSchema: {
              type: "object",
              properties: {
                recordType: {
                  type: "string",
                  description: "The SuiteScript record type ID, e.g. customer, task, customrecord_my_type."
                },
                values: {
                  type: "object",
                  description: "Body field values keyed by field ID, e.g. { \"companyname\": \"Acme\" }."
                },
                defaultValues: {
                  type: "object",
                  description: "Optional defaultValues passed to record.create for record types that require creation defaults."
                },
                isDynamic: {
                  type: "boolean",
                  description: "Create the record in dynamic mode. Defaults to false."
                },
                enableSourcing: {
                  type: "boolean",
                  description: "Record.save enableSourcing option. Defaults to true."
                },
                ignoreMandatoryFields: {
                  type: "boolean",
                  description: "Record.save ignoreMandatoryFields option. Defaults to false."
                }
              },
              required: ["recordType", "values"]
            }
          },
          {
            name: "netsuite_update_record_fields",
            description:
              "Update body fields on an existing NetSuite record using SuiteScript record.submitFields. " +
              "Destructive: this modifies data in the account. This is for body fields only; NetSuite does not allow submitFields to update sublist line fields or subrecords. " +
              "Date fields are normalized automatically: DATE, DATETIME, and DATETIMETZ fields receive SuiteScript Date objects. " +
              "Pass recordType, recordId, and a values object mapping field IDs to values.",
            inputSchema: {
              type: "object",
              properties: {
                recordType: {
                  type: "string",
                  description: "The SuiteScript record type ID, e.g. customer, salesorder, customrecord_my_type."
                },
                recordId: {
                  type: "string",
                  description: "Internal ID of the record to update."
                },
                values: {
                  type: "object",
                  description: "Body field values keyed by field ID, e.g. { \"memo\": \"Updated by MCP\" }."
                },
                enableSourcing: {
                  type: "boolean",
                  description: "record.submitFields enableSourcing option. Defaults to true."
                },
                ignoreMandatoryFields: {
                  type: "boolean",
                  description: "record.submitFields ignoreMandatoryFields option. Defaults to false."
                }
              },
              required: ["recordType", "recordId", "values"]
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
            name: "netsuite_create_custom_record_type",
            description:
              "Find or create a NetSuite custom record type metadata record using customrecordtype. " +
              "If an existing custom record type matches the normalized scriptId or recordname, returns that internal ID instead of creating a duplicate. " +
              "Set body fields with recordFields or convenience keys. The name key maps to recordname. " +
              "The Include Name Field checkbox is off by default; set includeNameField true to enable it. " +
              "The scriptId key accepts either 'customrecord_my_type' or 'my_type' and is normalized so NetSuite saves CUSTOMRECORD_MY_TYPE. " +
              "Create fields afterward with netsuite_create_custom_record_field to avoid orphaned record types if a field save fails.",
            inputSchema: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Convenience value for the custom record type recordname field."
                },
                scriptId: {
                  type: "string",
                  description: "Convenience value for the custom record type scriptid field. Accepts 'customrecord_my_type', 'my_type', or '_my_type'."
                },
                description: {
                  type: "string",
                  description: "Convenience value for the description field."
                },
                includeNameField: {
                  type: "boolean",
                  description: "Whether to check NetSuite's Include Name Field option. Defaults to false."
                },
                recordFields: {
                  type: "object",
                  description: "Additional raw fieldId-to-value pairs to set on the customrecordtype before save(). These override convenience keys."
                },
                customFields: {
                  type: "array",
                  description: "Deprecated and rejected by this tool. Create fields with netsuite_create_custom_record_field after the record type is saved."
                }
              }
            }
          },
          {
            name: "netsuite_get_custom_record_field_types",
            description:
              "Return the available custom record field type select options from the live NetSuite account. " +
              "Internally creates an unsaved customrecordcustomfield record and reads record.getField({ fieldId: 'fieldtype' }).getSelectOptions(...). " +
              "Use the returned option values as the fieldType for netsuite_create_custom_record_field.",
            inputSchema: {
              type: "object",
              properties: {
                filter: {
                  type: "string",
                  description: "Optional text filter passed to getSelectOptions. Leave empty to list available field types."
                }
              }
            }
          },
          {
            name: "netsuite_create_custom_record_field",
            description:
              "Find or create a NetSuite custom record field metadata record using customrecordcustomfield. " +
              "If an existing field with the normalized scriptId is already attached to the custom record type, returns that internal ID instead of creating a duplicate. " +
              "Creation uses the native NetSuite custreccustfield.nl form POST because client-side SuiteScript cannot reliably save customrecordcustomfield records. " +
              "Call netsuite_get_custom_record_field_types first when you need valid fieldType values.",
            inputSchema: {
              type: "object",
              properties: {
                customRecordTypeId: {
                  type: "string",
                  description: "Internal ID of the custom record type metadata record; posted as rectype."
                },
                customRecordTypeInternalId: {
                  type: "string",
                  description: "Alias for customRecordTypeId."
                },
                label: { type: "string" },
                scriptId: {
                  type: "string",
                  description: "Convenience value for the custom field scriptid field. The form POST sends NetSuite's metadata suffix format only, e.g. '_my_field'. Passing 'custrecord_my_field' or 'my_field' is normalized to '_my_field'."
                },
                fieldType: {
                  type: "string",
                  examples: [
                    "CHECKBOX",
                    "CURRENCY",
                    "DATE",
                    "DATETIME",
                    "DECIMAL",
                    "DOCUMENT",
                    "EMAIL",
                    "FREEFORMTEXT",
                    "HELP",
                    "HYPERLINK",
                    "INLINEHTML",
                    "INTEGER",
                    "LIST",
                    "LONGTEXT",
                    "MULTISELECT",
                    "PASSWORD",
                    "PERCENT",
                    "PHONE",
                    "RICHTEXT",
                    "TEXTAREA",
                    "TIMEOFDAY"
                  ],
                  description: "Convenience value for the fieldtype field. If these hints do not match your account, call netsuite_get_custom_record_field_types and use a returned value."
                },
                selectRecordType: {
                  type: "string",
                  description: "Convenience value for selectrecordtype when fieldType is SELECT or MULTISELECT. Use an internal numeric ID such as a custom record type ID. Custom record script IDs like 'customrecord_my_type' are resolved to internal IDs. Negative built-in IDs are validated against netsuite_get_custom_record_select_record_types. If creating a SELECT/MULTISELECT for a custom list or record list and no valid list/record is specified, use TEXT instead; the tool defaults missing selectRecordType SELECT/MULTISELECT requests to TEXT."
                },
                description: { type: "string" },
                storeValue: { type: "boolean" },
                showInList: { type: "boolean" },
                fieldValues: {
                  type: "object",
                  description: "Additional raw form fieldId-to-value pairs to include in the custreccustfield.nl POST. rectype is always set by the tool."
                }
              }
            }
          },
          {
            name: "netsuite_update_custom_record_field",
            description:
              "Edit an existing NetSuite custom record field using the native custreccustfield.nl edit form POST. " +
              "The tool loads the existing edit form first, preserves NetSuite metadata/sublist fields, and overrides only the provided friendly fields and fieldValues.",
            inputSchema: {
              type: "object",
              properties: {
                customRecordFieldId: {
                  type: "string",
                  description: "Internal ID of the custom record field to edit."
                },
                customFieldId: {
                  type: "string",
                  description: "Alias for customRecordFieldId."
                },
                fieldId: {
                  type: "string",
                  description: "Alias for customRecordFieldId."
                },
                customRecordTypeId: {
                  type: "string",
                  description: "Internal ID of the parent custom record type; posted as rectype."
                },
                customRecordTypeInternalId: {
                  type: "string",
                  description: "Alias for customRecordTypeId."
                },
                label: { type: "string" },
                fieldType: {
                  type: "string",
                  examples: [
                    "CHECKBOX",
                    "CURRENCY",
                    "DATE",
                    "DATETIME",
                    "DECIMAL",
                    "DOCUMENT",
                    "EMAIL",
                    "FREEFORMTEXT",
                    "HELP",
                    "HYPERLINK",
                    "INLINEHTML",
                    "INTEGER",
                    "LIST",
                    "LONGTEXT",
                    "MULTISELECT",
                    "PASSWORD",
                    "PERCENT",
                    "PHONE",
                    "RICHTEXT",
                    "TEXTAREA",
                    "TIMEOFDAY"
                  ],
                  description: "Optional new fieldtype value. If omitted, the existing type is preserved."
                },
                selectRecordType: {
                  type: "string",
                  description: "Convenience value for selectrecordtype when fieldType is SELECT or MULTISELECT."
                },
                description: { type: "string" },
                storeValue: { type: "boolean" },
                showInList: { type: "boolean" },
                fieldValues: {
                  type: "object",
                  description: "Additional raw form fieldId-to-value pairs to include in the custreccustfield.nl POST. rectype and id are always set by the tool."
                }
              },
              required: ["customRecordFieldId", "customRecordTypeId"]
            }
          },
          {
            name: "netsuite_create_script_field",
            description:
              "Find or create a NetSuite script parameter field using the native scriptcustfield.nl form POST. " +
              "Uses the same fieldType and selectRecordType values as custom record fields. " +
              "The scriptId key accepts either 'custscript_my_param' or 'my_param' and is normalized to NetSuite's metadata suffix format.",
            inputSchema: {
              type: "object",
              properties: {
                scriptInternalId: {
                  type: "string",
                  description: "Internal ID of the parent script record; posted as scripttype."
                },
                scriptRecordId: {
                  type: "string",
                  description: "Alias for scriptInternalId."
                },
                label: { type: "string" },
                scriptId: {
                  type: "string",
                  description: "Convenience value for the script parameter scriptid field. Passing 'custscript_my_param' or 'my_param' is normalized to '_my_param'."
                },
                fieldType: {
                  type: "string",
                  examples: [
                    "CHECKBOX",
                    "CURRENCY",
                    "DATE",
                    "DATETIME",
                    "DECIMAL",
                    "DOCUMENT",
                    "EMAIL",
                    "FREEFORMTEXT",
                    "HELP",
                    "HYPERLINK",
                    "INLINEHTML",
                    "INTEGER",
                    "LIST",
                    "LONGTEXT",
                    "MULTISELECT",
                    "PASSWORD",
                    "PERCENT",
                    "PHONE",
                    "RICHTEXT",
                    "TEXTAREA",
                    "TIMEOFDAY"
                  ],
                  description: "Convenience value for the fieldtype field. Uses the same values as netsuite_create_custom_record_field."
                },
                selectRecordType: {
                  type: "string",
                  description: "Convenience value for selectrecordtype when fieldType is SELECT or MULTISELECT."
                },
                description: { type: "string" },
                storeValue: { type: "boolean" },
                fieldValues: {
                  type: "object",
                  description: "Additional raw form fieldId-to-value pairs to include in the scriptcustfield.nl POST. scripttype is always set by the tool."
                }
              }
            }
          },
          {
            name: "netsuite_update_script_field",
            description:
              "Edit an existing NetSuite script parameter field using the native scriptcustfield.nl edit form POST. " +
              "The tool loads the existing edit form first, preserves NetSuite metadata/sublist fields, and overrides only the provided friendly fields and fieldValues.",
            inputSchema: {
              type: "object",
              properties: {
                scriptFieldId: {
                  type: "string",
                  description: "Internal ID of the script parameter field to edit."
                },
                fieldId: {
                  type: "string",
                  description: "Alias for scriptFieldId."
                },
                scriptInternalId: {
                  type: "string",
                  description: "Internal ID of the parent script record; posted as scripttype."
                },
                scriptRecordId: {
                  type: "string",
                  description: "Alias for scriptInternalId."
                },
                label: { type: "string" },
                fieldType: {
                  type: "string",
                  examples: [
                    "CHECKBOX",
                    "CURRENCY",
                    "DATE",
                    "DATETIME",
                    "DECIMAL",
                    "DOCUMENT",
                    "EMAIL",
                    "FREEFORMTEXT",
                    "HELP",
                    "HYPERLINK",
                    "INLINEHTML",
                    "INTEGER",
                    "LIST",
                    "LONGTEXT",
                    "MULTISELECT",
                    "PASSWORD",
                    "PERCENT",
                    "PHONE",
                    "RICHTEXT",
                    "TEXTAREA",
                    "TIMEOFDAY"
                  ],
                  description: "Optional new fieldtype value. If omitted, the existing type is preserved."
                },
                selectRecordType: {
                  type: "string",
                  description: "Convenience value for selectrecordtype when fieldType is SELECT or MULTISELECT."
                },
                description: { type: "string" },
                storeValue: { type: "boolean" },
                fieldValues: {
                  type: "object",
                  description: "Additional raw form fieldId-to-value pairs to include in the scriptcustfield.nl POST. scripttype and id are always set by the tool."
                }
              },
              required: ["scriptFieldId", "scriptInternalId"]
            }
          },
          {
            name: "netsuite_get_custom_record_select_record_types",
            description:
              "Return the available List/Record selectrecordtype options for custom record SELECT and MULTISELECT fields from the live NetSuite account. " +
              "Use one returned option value as selectRecordType for netsuite_create_custom_record_field. Do not guess negative built-in IDs. If no valid custom list or record list exists, create the field as TEXT.",
            inputSchema: {
              type: "object",
              properties: {
                filter: {
                  type: "string",
                  description: "Optional text filter passed to getSelectOptions. Examples: Employee, Custom List, Agent Provider."
                }
              }
            }
          },
          {
            name: "netsuite_inspect_custom_record_field",
            description:
              "Load an existing NetSuite customrecordcustomfield metadata record and return its actual body field IDs, values, display text, field metadata, and fieldtype/selectrecordtype select options. " +
              "Use this to verify how custom record fields are structured in the current account before creating or debugging fields.",
            inputSchema: {
              type: "object",
              properties: {
                customFieldId: {
                  type: "string",
                  description: "Internal ID of a custom record field metadata record to load directly."
                },
                customRecordTypeId: {
                  type: "string",
                  description: "Internal ID of a custom record type. If customFieldId is omitted, the tool loads the first field on this record type or the field matching scriptId."
                },
                customRecordTypeInternalId: {
                  type: "string",
                  description: "Alias for customRecordTypeId."
                },
                scriptId: {
                  type: "string",
                  description: "Optional custom field script ID to find on customRecordTypeId, e.g. custrecord_my_field or my_field."
                }
              }
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
              "Search the ENTIRE NetSuite File Cabinet for files matching a file name or internal FILE ID. Searches globally across all folders. " +
              "Returns matching files with id, name, folder (parent folder id), filesize, filetype, and url. " +
              "Do NOT pass a lead/customer/entity/transaction ID as `id`. If the user asks for a report/file related to a record ID (for example 'lead id 181'), use SuiteQL relationship discovery first and only use this tool with a verified File Cabinet file ID or distinctive file name. " +
              "To read the actual content of a file after finding it, call netsuite_read_file with the file id.",
            inputSchema: {
              type: "object",
              properties: {
                id: {
                  type: "string",
                  description: "Exact internal File Cabinet file ID (e.g. '12345'). Do not use a lead/customer/entity/transaction ID here."
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
              "Do NOT use a lead/customer/entity/transaction record ID as fileId. Resolve related files with SuiteQL first. " +
              "Returns the file name, content type, and full text content. PDFs are extracted to text when possible; other binary files may return base64. " +
              "Works with PDFs and text-based files: .js, .json, .xml, .csv, .html, .ftl, .txt, etc.",
            inputSchema: {
              type: "object",
              properties: {
                fileId: {
                  type: "string",
                  description: "The internal numeric File Cabinet file ID to read (e.g. '21301'). Obtain this from a SuiteQL relationship query or from netsuite_find_file, never from a lead/customer/entity ID."
                }
              },
              required: ["fileId"]
            }
          },
          {
            name: "netsuite_create_folder",
            description:
              "Create a new folder in the NetSuite File Cabinet. Destructive: creates data. If no parentFolderId is provided, uses -15 (SuiteScripts root). Returns the new folder ID.",
            inputSchema: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Folder name to create."
                },
                parentFolderId: {
                  type: "number",
                  description: "Parent folder internal ID. Defaults to -15 (SuiteScripts root)."
                }
              },
              required: ["name"]
            }
          },
          {
            name: "netsuite_upload_file",
            description:
              "Upload one or more files to the NetSuite File Cabinet. Destructive: creates files. " +
              "Best MCP workflow: pass localPath for one local file, localPaths for several local files, or files:[{localPath,fileName?,folderId?}]. " +
              "The MCP server reads local files and base64-encodes them internally, so do not shell out to encode files. " +
              "You may still pass fileContent for generated text or fileContentBase64 for pre-encoded binary data. If no folderId is provided, uses -15 (SuiteScripts root).",
            inputSchema: {
              type: "object",
              properties: {
                localPath: {
                  type: "string",
                  description: "Absolute or relative local filesystem path to upload. Preferred for existing local files."
                },
                localPaths: {
                  type: "array",
                  items: { type: "string" },
                  description: "Multiple local filesystem paths to upload in one call."
                },
                files: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      localPath: {
                        type: "string",
                        description: "Local filesystem path to upload."
                      },
                      fileName: {
                        type: "string",
                        description: "Optional NetSuite file name override."
                      },
                      folderId: {
                        type: "number",
                        description: "Optional target folder override for this file."
                      },
                      mimeType: {
                        type: "string",
                        description: "Optional MIME type override."
                      }
                    },
                    required: ["localPath"]
                  },
                  description: "Batch upload specs. Use when files need different names, folder IDs, or MIME types."
                },
                fileName: {
                  type: "string",
                  description: "Name of the file to upload, e.g. my_script.js. Required only for fileContent or fileContentBase64 mode."
                },
                fileContent: {
                  type: "string",
                  description: "Raw text content to upload."
                },
                fileContentBase64: {
                  type: "string",
                  description: "Base64 content for binary files. Use instead of fileContent."
                },
                mimeType: {
                  type: "string",
                  description: "Optional MIME type for base64 uploads."
                },
                folderId: {
                  type: "number",
                  description: "Target folder internal ID. Defaults to -15 (SuiteScripts root)."
                }
              },
              required: ["fileName"]
            }
          },
          {
            name: "netsuite_update_file_content",
            description:
              "Replace the content of an existing NetSuite File Cabinet file. Destructive: modifies a file. For text/script files, pass fileId and fileContent. fileName, folderId, and mediaType are optional and will be looked up when omitted.",
            inputSchema: {
              type: "object",
              properties: {
                fileId: {
                  type: "number",
                  description: "Internal ID of the File Cabinet file to update."
                },
                fileContent: {
                  type: "string",
                  description: "New raw text content for the file."
                },
                fileName: {
                  type: "string",
                  description: "Optional current file name. Looked up if omitted."
                },
                folderId: {
                  type: "number",
                  description: "Optional parent folder ID. Looked up if omitted."
                },
                mediaType: {
                  type: "string",
                  description: "Optional NetSuite media/file type such as JAVASCRIPT, PLAINTEXT, HTMLDOC, XMLDOC, JSON."
                }
              },
              required: ["fileId", "fileContent"]
            }
          },
          {
            name: "netsuite_rename_file",
            description:
              "Rename an existing File Cabinet file without changing content. Destructive: modifies file metadata.",
            inputSchema: {
              type: "object",
              properties: {
                fileId: {
                  type: "number",
                  description: "Internal ID of the file to rename."
                },
                newName: {
                  type: "string",
                  description: "New file name."
                },
                folderId: {
                  type: "number",
                  description: "Optional current parent folder ID. Looked up if omitted."
                }
              },
              required: ["fileId", "newName"]
            }
          },
          {
            name: "netsuite_rename_folder",
            description:
              "Rename an existing File Cabinet folder. Destructive: modifies folder metadata.",
            inputSchema: {
              type: "object",
              properties: {
                folderId: {
                  type: "number",
                  description: "Internal ID of the folder to rename."
                },
                newName: {
                  type: "string",
                  description: "New folder name."
                },
                parentFolderId: {
                  type: "number",
                  description: "Optional parent folder ID. Looked up if omitted."
                }
              },
              required: ["folderId", "newName"]
            }
          },
          {
            name: "netsuite_delete_file",
            description:
              "Delete a File Cabinet file. Destructive and irreversible unless NetSuite recovery applies.",
            inputSchema: {
              type: "object",
              properties: {
                fileId: {
                  type: "number",
                  description: "Internal ID of the file to delete."
                },
                folderId: {
                  type: "number",
                  description: "Optional current parent folder ID. Looked up if omitted."
                }
              },
              required: ["fileId"]
            }
          },
          {
            name: "netsuite_delete_folder",
            description:
              "Delete a File Cabinet folder. Destructive. The folder must be deletable in NetSuite.",
            inputSchema: {
              type: "object",
              properties: {
                folderId: {
                  type: "number",
                  description: "Internal ID of the folder to delete."
                }
              },
              required: ["folderId"]
            }
          },
          {
            name: "netsuite_move_items",
            description:
              "Move File Cabinet files and/or folders from one folder to another. Destructive: changes file/folder locations.",
            inputSchema: {
              type: "object",
              properties: {
                srcFolderId: {
                  type: "number",
                  description: "Source folder internal ID."
                },
                dstFolderId: {
                  type: "number",
                  description: "Destination folder internal ID."
                },
                fileIds: {
                  type: "array",
                  items: { type: "number" },
                  description: "File IDs to move."
                },
                folderIds: {
                  type: "array",
                  items: { type: "number" },
                  description: "Folder IDs to move."
                }
              },
              required: ["srcFolderId", "dstFolderId"]
            }
          },
          {
            name: "netsuite_create_script_record",
            description:
              "Create a NetSuite Script record for an already-uploaded script file. Destructive: creates a script record. Common scriptType values: SCRIPTLET (Suitelet), RESTLET, USEREVENT, SCHEDULED, MAPREDUCE, CLIENT, PORTLET, WORKFLOWACTION.",
            inputSchema: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  description: "Human-readable script name."
                },
                scriptId: {
                  type: "string",
                  description: "Script ID, e.g. customscript_my_script."
                },
                fileId: {
                  type: "number",
                  description: "Internal ID of the uploaded script file."
                },
                scriptType: {
                  type: "string",
                  description: "NetSuite script type constant. Defaults to SCRIPTLET."
                },
                description: {
                  type: "string",
                  description: "Optional script description."
                },
                apiVersion: {
                  type: "string",
                  description: "SuiteScript API version. Defaults to 2.1."
                }
              },
              required: ["name", "scriptId", "fileId"]
            }
          },
          {
            name: "netsuite_create_script_deployment",
            description:
              "Create and deploy a NetSuite script deployment for an existing script record. Destructive: creates a deployment. " +
              "Supports Suitelet/SCRIPTLET, SCHEDULED, MAPREDUCE, and RESTLET deployments through NetSuite's native scriptrecord.nl form POST. " +
              "All internal roles are selected for audience-capable deployment types.",
            inputSchema: {
              type: "object",
              properties: {
                scriptInternalId: {
                  type: "number",
                  description: "Internal ID of the existing script record to deploy."
                },
                deploymentScriptId: {
                  type: "string",
                  description: "Deployment script ID, e.g. customdeploy_my_suitelet or my_suitelet. Normalized to NetSuite's metadata suffix format."
                },
                scriptType: {
                  type: "string",
                  enum: ["SCRIPTLET", "SUITELET", "SCHEDULED", "MAPREDUCE", "RESTLET"],
                  description: "Script deployment type. Defaults to SCRIPTLET. Use SCHEDULED for Scheduled Scripts, MAPREDUCE for Map/Reduce, RESTLET for RESTlets."
                },
                name: {
                  type: "string",
                  description: "Fallback deployment title when title is not provided."
                },
                title: {
                  type: "string",
                  description: "Display title for the deployment."
                },
                status: {
                  type: "string",
                  description: "Deployment status. Defaults to RELEASED. Supported values include RELEASED and TESTING."
                },
                logLevel: {
                  type: "string",
                  description: "Logging level. Defaults to DEBUG. Supported values include DEBUG, AUDIT, ERROR, and EMERGENCY."
                },
                runAsRole: {
                  type: "number",
                  description: "Optional internal role ID for Suitelet Run As Role. Defaults to the current user's role."
                },
                priority: { type: "number", description: "Scheduled/MapReduce priority value. Defaults to 2 (Standard)." },
                concurrencyLimit: { type: "number", description: "Map/Reduce concurrency limit. Defaults to 1." },
                queueAllStagesAtOnce: { type: "boolean", description: "Map/Reduce queue all stages at once. Defaults to true." },
                yieldAfterMins: { type: "number", description: "Map/Reduce yield-after minutes. Defaults to 60." },
                bufferSize: { type: "number", description: "Map/Reduce buffer size. Defaults to 1." },
                startDate: { type: "string", description: "Scheduled/MapReduce start date as NetSuite expects, e.g. 23-June-2026. Defaults to today." },
                startTime: { type: "string", description: "Scheduled/MapReduce start time HHmm, e.g. 1800. Defaults to current time." },
                deploymentFields: { type: "object", description: "Additional raw scriptrecord.nl fieldId-to-value overrides." }
              },
              required: ["scriptInternalId", "deploymentScriptId"]
            }
          },
          {
            name: "netsuite_run_quick_script",
            description:
              "Run a small SuiteScript/JavaScript snippet in the authenticated NetSuite page context. " +
              "Use this to quickly test N/* module calls or JavaScript expressions. Return values and console/N.log output are returned as { result, logs }. " +
              "The snippet runs inside an async function with N modules destructured, so you can use await and modules such as record, search, query, runtime, file, log.",
            inputSchema: {
              type: "object",
              properties: {
                code: {
                  type: "string",
                  description:
                    "SuiteScript/JavaScript body to execute, e.g. \"console.log(runtime.getCurrentUser().id); return runtime.getCurrentUser().name;\""
                }
              },
              required: ["code"]
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
      if (params?.name === "netsuite_upload_file") {
        result = await uploadLocalFilesViaExtension(params.arguments || {});
      }
      if (!result) {
        result = await callExtension("tools/call", params);
      }
      result = await enrichNetsuiteReadFilePdfResult(result);
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


