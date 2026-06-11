import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

const DEFAULT_PIPE_NAME = "magic_netsuite_mcp_bridge";
const BRIDGE_PIPE_NAME =
  process.env.MAGIC_NETSUITE_MCP_PIPE || DEFAULT_PIPE_NAME;
const BRIDGE_PIPE_PATH =
  process.env.MAGIC_NETSUITE_MCP_PIPE_PATH ||
  (process.platform === "win32"
    ? `\\\\.\\pipe\\${BRIDGE_PIPE_NAME}`
    : path.join(os.tmpdir(), `${BRIDGE_PIPE_NAME}.sock`));

type BridgeResponse = {
  requestId: number;
  success: boolean;
  result?: unknown;
  error?: string;
  account?: string | null;
};

type TextToolResult = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type SelectedContextSnapshot = {
  markdown: string;
  selectedItems: Array<{
    kind: string;
    id: string;
    recordType?: string;
    name: string;
  }>;
  savedAt: string;
};

type FolderRow = {
  type: "folder";
  id: number;
  name: string;
  parent: number | null;
  foldertype: string;
  numfolderfiles: number;
  foldersize: number;
  lastmodifieddate: string | null;
  description?: string;
};

type FileCabinetFileRow = {
  type: "file";
  id: number;
  name: string;
  filetype: string;
  filesize: number;
  folder: number;
  lastmodifieddate: string | null;
  createddate?: string | null;
  description?: string;
  url?: string;
};

let bridgeSocket: net.Socket | null = null;
let bridgeConnecting: Promise<net.Socket> | null = null;
let bridgeBuffer = "";
let requestId = 0;
let selectedContext: SelectedContextSnapshot | null = null;
const pending = new Map<
  number,
  {
    resolve: (value: BridgeResponse) => void;
    reject: (reason: Error) => void;
    timer: NodeJS.Timeout;
  }
>();

function attachBridgeHandlers(socket: net.Socket): void {
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    bridgeBuffer += chunk;
    const lines = bridgeBuffer.split("\n");
    bridgeBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let message: BridgeResponse;
      try {
        message = JSON.parse(line) as BridgeResponse;
      } catch {
        continue;
      }

      const entry = pending.get(message.requestId);
      if (!entry) continue;
      pending.delete(message.requestId);
      clearTimeout(entry.timer);
      entry.resolve(message);
    }
  });

  socket.on("close", () => {
    if (bridgeSocket === socket) bridgeSocket = null;
    bridgeBuffer = "";
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Magic NetSuite native bridge disconnected."));
    }
    pending.clear();
  });
}

function connectNativeBridge(): Promise<net.Socket> {
  if (bridgeSocket && !bridgeSocket.destroyed) {
    return Promise.resolve(bridgeSocket);
  }
  if (bridgeConnecting) return bridgeConnecting;

  const connecting = new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection(BRIDGE_PIPE_PATH);
    let settled = false;
    const timer = setTimeout(() => {
      socket.destroy();
      if (!settled) {
        settled = true;
        reject(new Error("Open the Magic NetSuite extension MCP Server page and enable the bridge."));
      }
    }, 2500);

    socket.once("connect", () => {
      clearTimeout(timer);
      settled = true;
      bridgeSocket = socket;
      attachBridgeHandlers(socket);
      resolve(socket);
    });

    socket.once("error", (err) => {
      clearTimeout(timer);
      socket.destroy();
      if (!settled) {
        settled = true;
        reject(new Error(`Magic NetSuite native bridge is not connected: ${err.message}`));
      }
    });
  });

  bridgeConnecting = connecting;
  connecting.finally(() => {
    bridgeConnecting = null;
  });

  return connecting;
}

async function callExtensionTool(name: string, args: Record<string, unknown> = {}): Promise<TextToolResult> {
  const socket = await connectNativeBridge();
  const id = ++requestId;

  const response = await new Promise<BridgeResponse>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out while running ${name}.`));
    }, 30000);

    pending.set(id, { resolve, reject, timer });
    socket.write(JSON.stringify({
      requestId: id,
      method: "tools/call",
      params: { name, arguments: args },
    }) + "\n");
  });

  if (!response.success) {
    throw new Error(response.error || `Magic NetSuite tool ${name} failed.`);
  }

  return (response.result ?? {}) as TextToolResult;
}

function parseToolJson(result: TextToolResult): unknown {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) return result.structuredContent ?? {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function rowsFrom(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["results", "recordTypes", "files", "folders", "subfolders", "records", "rows", "items"]) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
    const rows = rowsFrom(nested);
    if (rows.length) return rows;
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function escapeSuiteQL(value: string): string {
  return value.replace(/'/g, "''");
}

function isNumeric(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

const TRANSACTION_TYPES: Record<string, string> = {
  salesorder: "SalesOrd",
  invoice: "CustInvc",
  purchaseorder: "PurchOrd",
  vendorbill: "VendBill",
  estimate: "Estimate",
  creditmemo: "CustCred",
  journalentry: "Journal",
  itemfulfillment: "ItemShip",
  cashsale: "CashSale",
};

function recordSearchQueries(recordType: string, query: string, limit: number): string[] {
  const cleanType = recordType.replace(/[^a-z0-9_]/gi, "");
  const cleanQuery = query.trim();
  const rowLimit = Math.max(1, Math.min(100, limit));

  if (TRANSACTION_TYPES[cleanType]) {
    const conditions = [`type = '${TRANSACTION_TYPES[cleanType]}'`, `ROWNUM <= ${rowLimit}`];
    if (cleanQuery) {
      const search = escapeSuiteQL(cleanQuery);
      conditions.push(isNumeric(cleanQuery)
        ? `(id = ${Number(cleanQuery)} OR LOWER(tranid) LIKE LOWER('%${search}%'))`
        : `LOWER(tranid) LIKE LOWER('%${search}%')`);
    }
    return [
      `SELECT id, tranid, BUILTIN.DF(entity) AS entity, trandate FROM transaction WHERE ${conditions.join(" AND ")} ORDER BY id DESC`,
    ];
  }

  const searchClause = (fields: string[]): string => {
    const parts = [`ROWNUM <= ${rowLimit}`];
    if (cleanQuery) {
      const search = escapeSuiteQL(cleanQuery);
      const matches = fields.map((field) => `LOWER(${field}) LIKE LOWER('%${search}%')`);
      if (isNumeric(cleanQuery)) matches.unshift(`id = ${Number(cleanQuery)}`);
      parts.push(`(${matches.join(" OR ")})`);
    }
    return parts.join(" AND ");
  };

  return [
    `SELECT id, name FROM ${cleanType} WHERE ${searchClause(["name"])} ORDER BY id DESC`,
    `SELECT id, entityid, altname FROM ${cleanType} WHERE ${searchClause(["entityid", "altname"])} ORDER BY id DESC`,
    `SELECT id, scriptid, name FROM ${cleanType} WHERE ${searchClause(["scriptid", "name"])} ORDER BY id DESC`,
    `SELECT id FROM ${cleanType} WHERE ROWNUM <= ${rowLimit} ORDER BY id DESC`,
  ];
}

async function runSuiteQLRows(sql: string): Promise<Record<string, unknown>[]> {
  const result = await callExtensionTool("suiteql_execute_query", { sql });
  return rowsFrom(parseToolJson(result));
}

function toLabel(row: Record<string, unknown>): string {
  return String(
    row.name ?? row.entityid ?? row.altname ?? row.tranid ?? row.scriptid ?? row.displayname ?? `#${row.id ?? ""}`,
  ).trim();
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function mapFolderRow(row: Record<string, unknown>): FolderRow {
  return {
    type: "folder",
    id: Number(row.id),
    name: String(row.name ?? ""),
    parent: toNumberOrNull(row.parent),
    foldertype: String(row.foldertype ?? "DEFAULT"),
    numfolderfiles: Number(row.numfolderfiles ?? row.numFolderFiles ?? 0),
    foldersize: Number(row.foldersize ?? row.folderSize ?? 0),
    lastmodifieddate: row.lastmodifieddate == null ? null : String(row.lastmodifieddate),
    description: row.description == null ? undefined : String(row.description),
  };
}

function mapFileRow(row: Record<string, unknown>): FileCabinetFileRow {
  return {
    type: "file",
    id: Number(row.id),
    name: String(row.name ?? ""),
    filetype: String(row.filetype ?? row.fileType ?? ""),
    filesize: Number(row.filesize ?? row.fileSize ?? 0),
    folder: Number(row.folder ?? 0),
    lastmodifieddate: row.lastmodifieddate == null ? null : String(row.lastmodifieddate),
    createddate: row.createddate == null ? undefined : String(row.createddate),
    description: row.description == null ? undefined : String(row.description),
    url: row.url == null ? undefined : String(row.url),
  };
}

async function fetchFolderInfo(folderId: number): Promise<FolderRow | null> {
  const rows = await runSuiteQLRows(`
    SELECT id, name, parent, foldertype, numFolderFiles, folderSize, lastModifiedDate, description
    FROM MediaItemFolder
    WHERE id = ${folderId} AND ROWNUM <= 1
  `);
  return rows.length > 0 ? mapFolderRow(rows[0]!) : null;
}

async function buildFolderBreadcrumbs(folderId: number | null): Promise<Array<{ id: number; name: string }>> {
  if (folderId === null) return [];
  const breadcrumbs: Array<{ id: number; name: string }> = [];
  let current: number | null = folderId;

  for (let i = 0; i < 20 && current !== null; i += 1) {
    const rows = await runSuiteQLRows(
      `SELECT id, name, parent FROM MediaItemFolder WHERE id = ${current} AND ROWNUM <= 1`,
    );
    if (rows.length === 0) break;
    const row = rows[0]!;
    breadcrumbs.unshift({ id: Number(row.id), name: String(row.name ?? row.id) });
    current = toNumberOrNull(row.parent);
  }

  return breadcrumbs;
}

function summarizeJson(value: unknown, maxChars = 22000): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n... [truncated ${text.length - maxChars} characters]`;
}

function toolResult(data: unknown, message = "Done."): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: isRecord(data) ? data : { value: data },
  };
}

function markdownToolResult(data: Record<string, unknown> & { markdown: string }, fallbackMessage: string): CallToolResult {
  return {
    content: [{ type: "text", text: data.markdown || fallbackMessage }],
    structuredContent: data,
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "Magic NetSuite MCP App",
    version: "1.0.0",
  });

  const resourceUri = "ui://magic-netsuite/context-picker.html";

  server.registerPrompt("open_context_picker", {
    title: "Open Magic NetSuite Context Picker",
    description: "Open the Magic NetSuite context picker MCP App for selecting records and File Cabinet files.",
    argsSchema: {
      initialTab: z.enum(["records", "files"]).optional(),
    },
  }, ({ initialTab = "records" }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Open the Magic NetSuite context picker using magic_netsuite_context_picker with initialTab "${initialTab}".`,
        },
      },
    ],
  }));

  server.registerPrompt("open_suitelet_viewer", {
    title: "Open Magic NetSuite Suitelet Viewer",
    description: "Open the Magic NetSuite MCP App Suitelet viewer for interactive Suitelet streaming.",
    argsSchema: {
      url: z.string().optional(),
    },
  }, ({ url = "" }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Open the Magic NetSuite Suitelet viewer using magic_netsuite_suitelet_viewer${url ? ` with url "${url}"` : ""}.`,
        },
      },
    ],
  }));

  registerAppTool(
    server,
    "magic_netsuite_context_picker",
    {
      title: "Magic NetSuite Context Picker",
      description: "Open an interactive picker for NetSuite records and File Cabinet files, then load the selected context into Claude chat.",
      inputSchema: {
        initialTab: z.enum(["records", "files"]).optional().describe("Which picker tab to open first."),
      },
      _meta: { ui: { resourceUri } },
    },
    async ({ initialTab = "records" }) =>
      toolResult({ initialTab }, "Use the picker below to select NetSuite context for Claude."),
  );

  registerAppTool(
    server,
    "magic_netsuite_suitelet_viewer",
    {
      title: "Magic NetSuite Suitelet Viewer",
      description: "Open an interactive MCP App viewer that streams a NetSuite Suitelet tab and forwards clicks, wheel events, and keyboard input back to Chrome.",
      inputSchema: {
        url: z.string().optional().describe("Optional Suitelet URL to open. If omitted, the viewer uses the preferred/current NetSuite tab."),
      },
      _meta: { ui: { resourceUri } },
    },
    async ({ url = "" }) =>
      toolResult({ mode: "suitelet", url }, "Use the viewer below to stream and interact with a NetSuite Suitelet."),
  );

  server.registerTool("magic_netsuite_bridge_status", {
    title: "Magic NetSuite Bridge Status",
    description: "Check whether the Magic NetSuite extension native bridge is reachable.",
    inputSchema: {},
  }, async () => {
    await connectNativeBridge();
    return toolResult({ connected: true, pipe: BRIDGE_PIPE_PATH }, "Magic NetSuite bridge is connected.");
  });

  server.registerTool("magic_netsuite_suitelet_stream_start", {
    title: "Start Suitelet Stream",
    description: "Start a Suitelet stream session in the Chrome extension. Intended for the Magic NetSuite Suitelet Viewer MCP App.",
    inputSchema: {
      url: z.string().optional(),
    },
  }, async ({ url = "" }) => {
    const data = parseToolJson(await callExtensionTool("netsuite_suitelet_stream_start", { url }));
    return toolResult(isRecord(data) ? data : { value: data }, "Suitelet stream started.");
  });

  server.registerTool("magic_netsuite_suitelet_stream_list", {
    title: "List Suitelets",
    description: "List deployed Suitelets available for the Magic NetSuite Suitelet Viewer MCP App.",
    inputSchema: {
      query: z.string().optional(),
    },
  }, async ({ query = "" }) => {
    const data = parseToolJson(await callExtensionTool("netsuite_suitelet_stream_list", { query }));
    return toolResult(isRecord(data) ? data : { value: data }, "Suitelets loaded.");
  });

  server.registerTool("magic_netsuite_suitelet_stream_frame", {
    title: "Get Suitelet Stream Frame",
    description: "Get the latest image frame for the active Suitelet stream session.",
    inputSchema: {},
  }, async () => {
    const data = parseToolJson(await callExtensionTool("netsuite_suitelet_stream_frame"));
    return toolResult(isRecord(data) ? data : { value: data }, "Suitelet frame captured.");
  });

  server.registerTool("magic_netsuite_suitelet_stream_input", {
    title: "Send Suitelet Stream Input",
    description: "Forward a mouse, wheel, or keyboard event from the Suitelet viewer to Chrome.",
    inputSchema: {
      event: z.record(z.string(), z.unknown()),
    },
  }, async ({ event }) => {
    const data = parseToolJson(await callExtensionTool("netsuite_suitelet_stream_input", { event }));
    return toolResult(isRecord(data) ? data : { value: data }, "Suitelet input sent.");
  });

  server.registerTool("magic_netsuite_suitelet_probe_url", {
    title: "Probe Suitelet URL",
    description: "Fetch a Suitelet URL from the Chrome extension and return diagnostics for blank iframe troubleshooting.",
    inputSchema: {
      url: z.string(),
    },
  }, async ({ url }) => {
    const data = parseToolJson(await callExtensionTool("netsuite_suitelet_probe_url", { url }));
    return toolResult(isRecord(data) ? data : { value: data }, "Suitelet URL probed.");
  });

  server.registerTool("magic_netsuite_suitelet_fetch_html", {
    title: "Fetch Suitelet HTML",
    description: "Fetch Suitelet HTML through the Chrome extension for srcdoc rendering in the MCP App.",
    inputSchema: {
      url: z.string(),
    },
  }, async ({ url }) => {
    const data = parseToolJson(await callExtensionTool("netsuite_suitelet_fetch_html", { url }));
    return toolResult(isRecord(data) ? data : { value: data }, "Suitelet HTML fetched.");
  });

  server.registerTool("magic_netsuite_suitelet_proxy_request", {
    title: "Proxy Suitelet Request",
    description: "Proxy a runtime Suitelet fetch/XHR request through the Chrome extension.",
    inputSchema: {
      url: z.string(),
      originalUrl: z.string().optional(),
      source: z.string().optional(),
      method: z.string().optional(),
      headers: z.record(z.string(), z.unknown()).optional(),
      body: z.string().nullable().optional(),
    },
  }, async ({ url, originalUrl, source, method = "GET", headers = {}, body = null }) => {
    const data = parseToolJson(await callExtensionTool("netsuite_suitelet_proxy_request", {
      url,
      originalUrl,
      source,
      method,
      headers,
      body,
    }));
    return toolResult(isRecord(data) ? data : { value: data }, "Suitelet request proxied.");
  });

  server.registerTool("magic_netsuite_save_selected_context", {
    title: "Save Selected NetSuite Context",
    description: "Save the context selected in the interactive picker so Claude can retrieve it with magic_netsuite_get_selected_context.",
    inputSchema: {
      markdown: z.string(),
      selectedItems: z.array(z.object({
        kind: z.string(),
        id: z.string(),
        recordType: z.string().optional(),
        name: z.string(),
      })),
    },
  }, async ({ markdown, selectedItems }) => {
    selectedContext = {
      markdown,
      selectedItems,
      savedAt: new Date().toISOString(),
    };
    return toolResult(
      {
        saved: true,
        savedAt: selectedContext.savedAt,
        itemCount: selectedItems.length,
        selectedItems,
      },
      `Saved ${selectedItems.length} selected NetSuite context item${selectedItems.length === 1 ? "" : "s"}.`,
    );
  });

  server.registerTool("magic_netsuite_get_selected_context", {
    title: "Get Selected NetSuite Context",
    description: "Retrieve the latest NetSuite records/files selected in the interactive picker. Use this when the user asks about a file or record they selected in the picker.",
    inputSchema: {},
  }, async () => {
    if (!selectedContext) {
      return toolResult(
        {
          found: false,
          markdown: "",
          selectedItems: [],
        },
        "No NetSuite context has been selected in the picker yet.",
      );
    }

    return toolResult(
      {
        found: true,
        markdown: selectedContext.markdown,
        selectedItems: selectedContext.selectedItems,
        savedAt: selectedContext.savedAt,
      },
      selectedContext.markdown,
    );
  });

  server.registerTool("magic_netsuite_list_record_types", {
    title: "List NetSuite Record Types",
    description: "List NetSuite record types for the context picker.",
    inputSchema: {},
  }, async () => {
    const data = parseToolJson(await callExtensionTool("netsuite_list_record_types"));
    const recordTypes = rowsFrom(data)
      .map((row) => ({
        id: String(row.id ?? row.scriptId ?? "").toLowerCase(),
        name: String(row.name ?? row.label ?? row.id ?? ""),
      }))
      .filter((row) => row.id && row.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!recordTypes.some((row) => row.id === "script")) {
      recordTypes.unshift({ id: "script", name: "Script" });
    }
    return toolResult({ recordTypes }, `Found ${recordTypes.length} record types.`);
  });

  server.registerTool("magic_netsuite_search_records", {
    title: "Search NetSuite Records",
    description: "Search records by type and optional ID/name text.",
    inputSchema: {
      recordType: z.string(),
      query: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ recordType, query = "", limit = 50 }) => {
    let lastError = "";
    for (const sql of recordSearchQueries(recordType, query, limit)) {
      try {
        const rows = await runSuiteQLRows(sql);
        if (rows.length || sql.includes("SELECT id FROM")) {
          return toolResult({
            records: rows.map((row) => ({
              id: String(row.id ?? row.ID ?? ""),
              label: toLabel(row),
              meta: Object.entries(row)
                .filter(([key, value]) => key.toLowerCase() !== "id" && value !== null && value !== undefined && value !== "")
                .slice(0, 4)
                .map(([key, value]) => `${key}: ${String(value)}`)
                .join(" | "),
              raw: row,
            })).filter((row) => row.id),
          }, `Searched ${recordType}.`);
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    throw new Error(lastError || `No records found for ${recordType}.`);
  });

  server.registerTool("magic_netsuite_load_record_context", {
    title: "Load NetSuite Record Context",
    description: "Load a NetSuite record as text context for Claude.",
    inputSchema: {
      recordType: z.string(),
      recordId: z.string(),
      includeSublists: z.boolean().optional(),
    },
  }, async ({ recordType, recordId, includeSublists = false }) => {
    const body = parseToolJson(await callExtensionTool("netsuite_load_record", { recordType, recordId }));
    let sublists: unknown = undefined;
    if (includeSublists) {
      sublists = parseToolJson(await callExtensionTool("netsuite_get_record_sublists", { recordType, recordId }));
    }
    const markdown = [
      "# NetSuite Record Context",
      `recordType: ${recordType}`,
      `recordId: ${recordId}`,
      "",
      "```json",
      summarizeJson(includeSublists ? { body, sublists } : body),
      "```",
    ].join("\n");
    return markdownToolResult({ markdown, body, sublists }, `Loaded ${recordType} #${recordId}.`);
  });

  server.registerTool("magic_netsuite_list_file_cabinet_folder", {
    title: "List NetSuite File Cabinet Folder",
    description: "List File Cabinet folders and files for the context picker. Pass no folderId for root folders.",
    inputSchema: {
      folderId: z.number().nullable().optional(),
    },
  }, async ({ folderId = null }) => {
    const numericFolderId = folderId === null ? null : Number(folderId);

    if (numericFolderId === null) {
      const folders = (await runSuiteQLRows(`
        SELECT id, name, parent, foldertype, numFolderFiles, folderSize, lastModifiedDate, description
        FROM MediaItemFolder
        WHERE parent IS NULL
        ORDER BY name
      `)).map(mapFolderRow);

      return toolResult({
        folderId: null,
        folderInfo: null,
        breadcrumbs: [],
        folders,
        files: [],
      }, "Root File Cabinet folders loaded.");
    }

    const [folderInfo, folders, files, breadcrumbs] = await Promise.all([
      fetchFolderInfo(numericFolderId),
      runSuiteQLRows(`
        SELECT id, name, parent, foldertype, numFolderFiles, folderSize, lastModifiedDate, description
        FROM MediaItemFolder
        WHERE parent = ${numericFolderId}
        ORDER BY name
      `).then((rows) => rows.map(mapFolderRow)),
      runSuiteQLRows(`
        SELECT id, name, fileType, fileSize, folder, lastModifiedDate, createdDate, description, url
        FROM File
        WHERE folder = ${numericFolderId}
        ORDER BY name
      `).then((rows) => rows.map(mapFileRow)),
      buildFolderBreadcrumbs(numericFolderId),
    ]);

    return toolResult({
      folderId: numericFolderId,
      folderInfo,
      breadcrumbs,
      folders,
      files,
    }, "File Cabinet folder loaded.");
  });

  server.registerTool("magic_netsuite_search_files", {
    title: "Search NetSuite File Cabinet",
    description: "Search the NetSuite File Cabinet by file/folder ID or name.",
    inputSchema: {
      query: z.string(),
      limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ query, limit = 50 }) => {
    const cleanQuery = query.trim();
    const escaped = cleanQuery.replace(/'/g, "''");
    const numeric = isNumeric(cleanQuery);
    const rowLimit = Math.max(1, Math.min(100, limit));

    const folderSql = numeric
      ? `
        SELECT id, name, parent, foldertype, numFolderFiles, folderSize, lastModifiedDate, description
        FROM MediaItemFolder
        WHERE id = ${Number(cleanQuery)}
        ORDER BY name
      `
      : `
        SELECT id, name, parent, foldertype, numFolderFiles, folderSize, lastModifiedDate, description
        FROM MediaItemFolder
        WHERE LOWER(name) LIKE LOWER('%${escaped}%')
          AND ROWNUM <= ${rowLimit}
        ORDER BY name
      `;

    const [folderRows, fileData] = await Promise.all([
      runSuiteQLRows(folderSql),
      callExtensionTool("netsuite_find_file", numeric ? { id: cleanQuery } : { name: cleanQuery }).then(parseToolJson),
    ]);

    const folders = folderRows.slice(0, rowLimit).map(mapFolderRow);
    const files = rowsFrom(fileData)
      .slice(0, rowLimit)
      .map((row) => ({
        id: Number(row.id ?? row.ID),
        name: String(row.name ?? row.Name ?? row.id ?? ""),
        folder: row.folder ?? null,
        filesize: Number(row.filesize ?? row.fileSize ?? 0),
        filetype: String(row.filetype ?? row.fileType ?? ""),
        url: row.url ? String(row.url) : undefined,
      }))
      .filter((file) => Number.isFinite(file.id) && file.name);
    return toolResult({ folders, files, breadcrumbs: [], folderId: null }, `Found ${folders.length} folders and ${files.length} files.`);
  });

  server.registerTool("magic_netsuite_read_file_context", {
    title: "Read NetSuite File Context",
    description: "Read a NetSuite File Cabinet file as text context for Claude.",
    inputSchema: {
      fileId: z.string(),
    },
  }, async ({ fileId }) => {
    const file = parseToolJson(await callExtensionTool("netsuite_read_file", { fileId }));
    const markdown = [
      "# NetSuite File Cabinet Context",
      `fileId: ${fileId}`,
      "",
      "```json",
      summarizeJson(file),
      "```",
    ].join("\n");
    return markdownToolResult({ markdown, file }, `Loaded file #${fileId}.`);
  });

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => {
      const html = await fs.readFile(path.join(DIST_DIR, "mcp-app.html"), "utf8");
      return {
        contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
