// toolManager.ts
import type { ToolDefinition } from "../composables/useAgent";
import { callApi, ApiRequestType } from "./api";
import { RequestRoutes } from "../types/request";
import { Parser } from "expr-eval";
import { searchSkills, getSkillContent } from "./skillsDb";
import { searchMembers, getMemberById, getModuleCount } from "./modulesDb";
import { agentCache } from "./agentCacheStore";
import { customToolAgentTools } from "./customToolAgentTools";

type SuiteqlTableRef = {
  id: string;
  label?: string;
  type?: string;
};

type SuiteqlFieldRef = {
  id: string;
  label?: string;
  dataType?: string;
  isColumn?: boolean;
};

type SuiteqlRow = Record<string, unknown>;

const normalizeSuiteqlTables = (message: unknown): SuiteqlTableRef[] => {
  const payload = (message as { data?: unknown; tables?: unknown })?.data ?? message;
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { tables?: unknown })?.tables)
      ? (payload as { tables: unknown[] }).tables
      : [];
  const tables: SuiteqlTableRef[] = [];
  for (const row of rows) {
    const obj = row as Record<string, unknown>;
    const id = String(obj.id ?? "").trim();
    if (!id) continue;
    tables.push({
      id,
      label: obj.label ? String(obj.label) : undefined,
      type: obj.type ? String(obj.type) : undefined
    });
  }
  return tables;
};

const normalizeSuiteqlFields = (message: unknown): SuiteqlFieldRef[] => {
  const payload = (message as { data?: unknown })?.data ?? message;
  const raw = (payload as { fields?: unknown })?.fields;
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .filter((row) => (row as { isColumn?: boolean }).isColumn !== false)
    .map((row) => {
      const obj = row as Record<string, unknown>;
      return {
        id: String(obj.id ?? "").trim(),
        label: obj.label ? String(obj.label) : undefined,
        dataType: obj.dataType ? String(obj.dataType) : undefined,
        isColumn: obj.isColumn === undefined ? true : Boolean(obj.isColumn)
      };
    })
    .filter((field) => field.id.length > 0);
};

const normalizeSuiteqlRows = (
  message: unknown
): { rows: SuiteqlRow[]; totalCount: number } => {
  const payload = (message as { data?: unknown })?.data ?? message;
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { results?: unknown })?.results)
      ? (payload as { results: unknown[] }).results
      : [];
  const totalCount = Array.isArray(payload)
    ? rows.length
    : Number((payload as { totalCount?: unknown })?.totalCount ?? rows.length);
  return {
    rows: rows.filter((row) => row && typeof row === "object") as SuiteqlRow[],
    totalCount: Number.isFinite(totalCount) ? totalCount : rows.length
  };
};

const normalizeFileResults = (message: unknown): SuiteqlRow[] => {
  const files = (message as { files?: unknown })?.files ?? message;
  const rows = Array.isArray(files)
    ? files
    : Array.isArray((files as { results?: unknown })?.results)
      ? (files as { results: unknown[] }).results
      : [];
  return rows.filter((row) => row && typeof row === "object") as SuiteqlRow[];
};

const isSuiteqlIdentifier = (value: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

const toPositiveInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const wordsForRecordType = (recordType: string): string[] => {
  const normalized = recordType.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const terms = new Set<string>([
    normalized,
    recordType.toLowerCase(),
    "entity"
  ]);

  if (["lead", "prospect", "customer"].includes(normalized)) {
    terms.add("lead");
    terms.add("customer");
    terms.add("prospect");
    terms.add("entity");
    terms.add("enriched");
  }
  if (["salesorder", "estimate", "invoice", "transaction"].includes(normalized)) {
    terms.add("transaction");
    terms.add("tran");
  }
  if (normalized === "vendor") {
    terms.add("vendor");
    terms.add("entity");
  }

  return Array.from(terms).filter(Boolean);
};

const scoreText = (text: string, terms: string[], weight: number): number =>
  terms.reduce((score, term) => score + (term && text.includes(term) ? weight : 0), 0);

const rankRelatedFileTables = (
  tables: SuiteqlTableRef[],
  recordType: string,
  purpose: string
): SuiteqlTableRef[] => {
  const recordTerms = wordsForRecordType(recordType);
  const purposeTerms = [
    purpose.toLowerCase(),
    "report",
    "document",
    "attachment",
    "pdf",
    "file"
  ].filter(Boolean);

  return tables
    .map((table) => {
      const haystack = `${table.id} ${table.label ?? ""}`.toLowerCase();
      let score = 0;
      score += scoreText(haystack, recordTerms, 6);
      score += scoreText(haystack, purposeTerms, 4);
      if (haystack.includes("customrecord")) score += 2;
      if (haystack.includes("lead") && haystack.includes("report")) score += 10;
      if (haystack.includes("report") && haystack.includes("file")) score += 5;
      return { table, score };
    })
    .filter(({ score }) => score >= 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, 16)
    .map(({ table }) => table);
};

const rankLinkFields = (
  fields: SuiteqlFieldRef[],
  recordType: string
): SuiteqlFieldRef[] => {
  const recordTerms = wordsForRecordType(recordType);
  return fields
    .map((field) => {
      const haystack = `${field.id} ${field.label ?? ""}`.toLowerCase();
      let score = scoreText(haystack, recordTerms, 8);
      if (haystack.includes("entity") || haystack.includes("customer")) score += 3;
      if (haystack.includes("parent")) score += 1;
      if (/(file|report|pdf|document|attachment|format)/i.test(haystack)) score -= 20;
      if (/^(id|name|owner|created|lastmodified|isinactive)$/i.test(field.id)) score -= 20;
      return { field, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ field }) => field);
};

const rankFileFields = (
  fields: SuiteqlFieldRef[],
  purpose: string
): SuiteqlFieldRef[] => {
  const purposeTerms = [
    purpose.toLowerCase(),
    "report",
    "file",
    "pdf",
    "document",
    "attachment"
  ].filter(Boolean);
  return fields
    .map((field) => {
      const haystack = `${field.id} ${field.label ?? ""}`.toLowerCase();
      let score = scoreText(haystack, purposeTerms, 6);
      if (/\bfile\b|_file\b|file$/i.test(haystack)) score += 10;
      if (haystack.includes("url")) score += 2;
      if (/format|type|template|status/i.test(haystack)) score -= 4;
      if (/^(id|name|owner|created|lastmodified|isinactive)$/i.test(field.id)) score -= 20;
      return { field, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ field }) => field);
};

const findAliasedValue = (
  row: SuiteqlRow,
  alias: string,
  fallbackFieldId: string
): unknown => {
  const direct = row[alias];
  if (direct !== undefined) return direct;
  const lowerAlias = alias.toLowerCase();
  const lowerField = fallbackFieldId.toLowerCase();
  const entry = Object.entries(row).find(([key]) => {
    const lower = key.toLowerCase();
    return lower === lowerAlias || lower === lowerField;
  });
  return entry?.[1];
};

const findFileCabinetFile = async (
  fileId: number
): Promise<{ message: unknown; file: SuiteqlRow | null }> => {
  const response = await callApi(RequestRoutes.FIND_FILE, {
    id: String(fileId)
  });
  const rows = normalizeFileResults(response.message);
  return { message: response.message, file: rows[0] ?? null };
};

const fetchAndCacheFileContent = async (
  fileId: number,
  preferredUrl?: string
): Promise<{
  cacheKey: string;
  fileId: number;
  contentType: string;
  sizeChars: number;
  binary: boolean;
}> => {
  let fileUrl = preferredUrl || `/core/media/media.nl?id=${fileId}`;
  if (!preferredUrl) {
    try {
      const { file } = await findFileCabinetFile(fileId);
      const foundUrl = file?.url;
      if (foundUrl) fileUrl = String(foundUrl);
    } catch {
      // FIND_FILE unavailable - proceed with the bare URL fallback.
    }
  }

  const contentResponse = await callApi(RequestRoutes.FETCH_FILE_CONTENT, {
    fileUrl
  });
  const result = contentResponse.message as {
    content: string;
    contentType: string;
    binary: boolean;
  };

  if (!result) {
    throw new Error("Failed to fetch file content.");
  }

  const content = result.binary
    ? result.content
    : result.content?.slice(0, 500_000) ?? "";
  const cacheKey = `file_${fileId}`;
  agentCache.set(cacheKey, content, `File ID ${fileId} (${result.contentType})`);

  return {
    cacheKey,
    fileId,
    contentType: result.contentType,
    sizeChars: content.length,
    binary: result.binary
  };
};

export const tools: ToolDefinition[] = [
  ...customToolAgentTools,
  {
    name: "calculate",
    description:
      "Evaluates a safe mathematical expression and returns the result.",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "A math expression, e.g. '2 + 2' or '10 * (3 + 4)'"
        }
      },
      required: ["expression"]
    },
    execute: (input) => {
      try {
        const expr = String(input.expression)
          .replace(/×/g, "*")
          .replace(/÷/g, "/")
          .replace(/−/g, "-")
          .replace(/\^/g, "**");

        const result = Parser.evaluate(expr);
        return { result };
      } catch (err) {
        return { error: `Invalid expression: ${String(err)}` };
      }
    }
  },

  {
    name: "get_current_time",
    description: "Returns the current date and time.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description:
            "Optional IANA timezone, e.g. 'America/New_York'. Defaults to local."
        }
      },
      required: []
    },
    execute: (input) => {
      const tz = input.timezone as string | undefined;
      const now = new Date();
      return {
        datetime: now.toLocaleString("en-US", tz ? { timeZone: tz } : {}),
        iso: now.toISOString()
      };
    }
  },

  {
    name: "fetch_url",
    description:
      "Fetches the text content of a public URL using Jina reader (renders JavaScript). " +
      "Use ONLY for public web pages such as documentation, articles, or external sites. " +
      "NEVER use for NetSuite URLs — NetSuite requires an authenticated session cookie that only the netsuite_* tools have access to. " +
      "Attempting to fetch any *.netsuite.com URL or /core/media/* path with this tool will always return a login page or 'Page Not Found'. " +
      "To read a file from the NetSuite File Cabinet, use netsuite_get_file_content instead.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL to fetch"
        }
      },
      required: ["url"]
    },
    execute: async (input) => {
      try {
        const readerUrl = `https://r.jina.ai/${encodeURIComponent(String(input.url))}`;
        const res = await fetch(readerUrl, {
          headers: { Accept: "text/plain" }
        });
        const text = await res.text();
        return { status: res.status, body: text.slice(0, 5000) };
      } catch (err) {
        return { error: String(err) };
      }
    }
  },

  // ========== NetSuite Scripts ==========
  {
    name: "netsuite_get_scripts",
    description:
      "Search and list scripts from NetSuite. Returns an array of objects with fields: scriptid (string ID like 'customscript_xxx'), id (internal numeric ID), name, scripttype, owner, scriptfile. " +
      "Supports SQL-level filtering by scriptId (exact match), scriptType, name (partial match), and owner (partial match) — these run server-side and reduce data transfer. " +
      "Also supports a client-side 'search' parameter for fuzzy keyword matching across all fields when you don't know which field to filter on. " +
      "Call with no parameters to list ALL scripts. To read the actual source code of scripts found here, pass the numeric 'id' values to netsuite_get_script_files — do NOT call this tool again for that purpose.",
    parameters: {
      type: "object",
      properties: {
        scriptId: {
          type: "string",
          description:
            "Exact script ID string for precise match (e.g. 'customscript_my_suitelet'). Only use when you know the full exact ID."
        },
        scriptType: {
          type: "string",
          description:
            "Filter by script type (e.g. 'CLIENT', 'USEREVENT', 'SCRIPTLET', 'MAPREDUCE', 'SCHEDULED', 'SUITELET', 'RESTLET', 'WORKFLOWACTION', 'PORTLET', 'BUNDLEINSTALLATION', 'MASSUPDATESCRIPT'). Case-insensitive. Filters at the SQL level."
        },
        name: {
          type: "string",
          description:
            "Partial script name to search for (case-insensitive LIKE match). Filters at the SQL level. E.g. 'Project' will match any script with 'Project' in the name."
        },
        owner: {
          type: "string",
          description:
            "Partial owner name to filter by (case-insensitive LIKE match). Filters at the SQL level. E.g. 'John' will match scripts owned by any user with 'John' in their entity ID."
        },
        search: {
          type: "string",
          description:
            "Fuzzy client-side keyword search across name, scriptid, owner, and scriptfile (case-insensitive). Use this as a general-purpose search when you don't know which specific field to filter on. Applied AFTER server-side filters."
        }
      },
      required: []
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.SCRIPTS, {
        scriptId: input.scriptId,
        scriptType: input.scriptType,
        name: input.name,
        owner: input.owner
      });
      let results = response.message;
      if (input.search && !input.scriptId && Array.isArray(results)) {
        const term = String(input.search).toLowerCase();
        results = results.filter(
          (s: Record<string, unknown>) =>
            String(s.name ?? "")
              .toLowerCase()
              .includes(term) ||
            String(s.scriptid ?? "")
              .toLowerCase()
              .includes(term) ||
            String(s.owner ?? "")
              .toLowerCase()
              .includes(term) ||
            String(s.scriptfile ?? "")
              .toLowerCase()
              .includes(term)
        );
      }
      return results;
    }
  },

  {
    name: "netsuite_get_script_types",
    description:
      "Get all script types available in NetSuite. Returns an array of objects with fields: label (type name) and id (internal numeric ID).",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async () => {
      const response = await callApi(RequestRoutes.SCRIPT_TYPES);
      return response.message;
    }
  },

  {
    name: "netsuite_get_script_url",
    description:
      "Get the URL to open a script record page in NetSuite. Requires the script's internal numeric ID (the 'id' field from netsuite_get_scripts NUMERIC), NOT the string scriptid.",
    parameters: {
      type: "object",
      properties: {
        scriptId: {
          type: "string",
          description:
            "The script's internal numeric ID (e.g. '523'). This is the 'id' field from netsuite_get_scripts results."
        }
      },
      required: ["scriptId"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.SCRIPT_URL, {
        scriptId: input.scriptId
      });
      return response.message;
    }
  },

  {
    name: "netsuite_get_deployed_scripts",
    description:
      "Get all deployed scripts attached to a specific record type. Source files are stored in the conversation cache automatically to handle large scripts. Returns metadata with cacheKey and sizeChars. Use cache_retrieve(cacheKey) to analyze a specific script. If you already know specific script numeric IDs and just need their source code, use netsuite_get_script_files instead.",
    parameters: {
      type: "object",
      properties: {
        recordType: {
          type: "string",
          description:
            "The record type ID in lowercase (e.g. 'salesorder', 'customer', 'itemfulfillment', 'invoice'). Will be uppercased automatically."
        }
      },
      required: ["recordType"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.SCRIPTS_DEPLOYED, {
        recordType: input.recordType
      });
      const scripts = response.message as Array<{
        scriptName: string;
        scriptType: string;
        scriptFile: string | null;
        scriptId: string;
        id: number;
      }>;
      if (!Array.isArray(scripts)) return scripts;
      return scripts.map((s) => {
        const cacheKey = `deployed_script_${input.recordType}_${s.id}`;
        agentCache.set(
          cacheKey,
          s.scriptFile ?? `// Script content not available for ${s.scriptName} (ID ${s.id})`,
          `${s.scriptName} (${s.scriptType}, ${input.recordType}, ID ${s.id})`
        );
        const { scriptFile: _, ...meta } = s;
        return { ...meta, cacheKey, sizeChars: s.scriptFile?.length ?? 0 };
      });
    }
  },

  {
    name: "netsuite_get_script_files",
    description:
      "Fetch the source code for one or more scripts by their internal numeric IDs. " +
      "Each script's source is stored in the conversation cache automatically — it does NOT appear in your context. " +
      "Returns metadata only: an array of { scriptName, scriptType, scriptId, id, cacheKey, sizeChars }. " +
      "To DISPLAY a script: call cache_display(cacheKey) AND include [VIEW:{cacheKey}] verbatim in your text response. " +
      "To ANALYZE a script, call cache_retrieve(cacheKey) to bring it into context. " +
      "Accepts a single ID like [523] or multiple IDs like [523, 841, 102].",
    parameters: {
      type: "object",
      properties: {
        scriptIds: {
          type: "array",
          items: { type: "number" },
          description:
            "One or more internal numeric script IDs (the 'id' field from netsuite_get_scripts, e.g. [523] or [523, 841, 102])."
        }
      },
      required: ["scriptIds"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.SCRIPT_FILES, {
        scriptIds: input.scriptIds
      });
      const scripts = response.message as Array<{
        scriptName: string;
        scriptType: string;
        scriptId: string;
        id: number;
        fileId?: number;
        fileFolderId?: number;
        scriptFile: string | null;
      }>;
      if (!Array.isArray(scripts)) return scripts;
      return scripts.map((s) => {
        const cacheKey = `script_${s.id}`;
        agentCache.set(
          cacheKey,
          s.scriptFile ?? `// Script content not available for ${s.scriptName} (ID ${s.id})`,
          `${s.scriptName} (${s.scriptType}, ID ${s.id})`
        );
        const { scriptFile: _, ...meta } = s;
        return { ...meta, cacheKey, sizeChars: s.scriptFile?.length ?? 0 };
      });
    }
  },

  {
    name: "netsuite_get_script_deployments",
    description:
      "Get deployment records for one or more scripts. Requires the script's internal numeric ID (the 'id' field from netsuite_get_scripts), NOT the string scriptid. Returns an array of objects with: scriptid (deployment string ID like 'customdeploy_xxx'), recordtype, isdeployed ('T'/'F'), status, loglevel, primarykey (deployment record internal ID), id (script internal ID), scriptname. IMPORTANT: for SuiteQL scriptdeployment rows, primarykey is the actual scriptdeployment record internal ID; scriptdeployment.id is not. Use primarykey with deployment URL, load, and execute tools. Use 'search' to filter results by keyword.",
    parameters: {
      type: "object",
      properties: {
        scriptId: {
          type: "string",
          description:
            "A single script internal numeric ID (the 'id' field from netsuite_get_scripts, e.g. '523'). Do NOT pass the string scriptid here."
        },
        scriptIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Multiple script internal numeric IDs. Use this to fetch deployments for several scripts at once."
        },
        search: {
          type: "string",
          description:
            "Fuzzy search keyword to filter deployment results by scriptid (deployment ID), scriptname, or recordtype (case-insensitive)."
        }
      },
      required: []
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.SCRIPT_DEPLOYMENTS, {
        scriptId: input.scriptId,
        scriptIds: input.scriptIds
      });
      let results = response.message;
      if (input.search && Array.isArray(results)) {
        const term = String(input.search).toLowerCase();
        results = results.filter(
          (d: Record<string, unknown>) =>
            String(d.scriptid ?? "")
              .toLowerCase()
              .includes(term) ||
            String(d.scriptname ?? "")
              .toLowerCase()
              .includes(term) ||
            String(d.recordtype ?? "")
              .toLowerCase()
              .includes(term)
        );
      }
      return results;
    }
  },

  {
    name: "netsuite_get_script_deployment_url",
    description:
      "Get the URL to open a script deployment in NetSuite. If the deployment came from a SuiteQL scriptdeployment query, pass scriptdeployment.primarykey, not scriptdeployment.id.",
    parameters: {
      type: "object",
      properties: {
        deployment: {
          type: "string",
          description:
            "The scriptdeployment record internal ID. From SuiteQL scriptdeployment results this is primarykey, not id."
        }
      },
      required: ["deployment"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.SCRIPT_DEPLOYMENT_URL, {
        deployment: input.deployment
      });
      return response.message;
    }
  },

  {
    name: "netsuite_get_suitelet_url",
    description:
      "Get the URL to open a Suitelet in NetSuite (for copying/sharing). " +
      "Does NOT open the URL — use netsuite_open_deployment_suitelet to open it in a browser tab.",
    parameters: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "The script ID"
        },
        deployment: {
          type: "string",
          description: "The deployment ID"
        }
      },
      required: ["script", "deployment"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.SUITELET_URL, {
        script: input.script,
        deployment: input.deployment
      });
      return response.message;
    }
  },

  {
    name: "netsuite_open_deployment_suitelet",
    description:
      "Open a Suitelet directly in a new browser tab. " +
      "Use this when the user asks to open, launch, or run a Suitelet. " +
      "Does NOT return the URL — use netsuite_get_suitelet_url if you just need the link.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "The script ID (e.g. 'customscript_my_suitelet')"
        },
        deployment: {
          type: "string",
          description: "The deployment ID (e.g. 'customdeploy_my_suitelet')"
        }
      },
      required: ["script", "deployment"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.OPEN_DEPLOYMENT_SUITELET, {
        script: input.script,
        deployment: input.deployment
      });
      const url = response.message;
      if (url) {
        window.open(url, "_blank");
      }
      return url || "Failed to generate Suitelet URL";
    }
  },

  // ========== NetSuite Custom Records ==========
  {
    name: "netsuite_get_custom_records",
    description: "Get all custom record types defined in NetSuite.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async () => {
      const response = await callApi(RequestRoutes.CUSTOM_RECORDS);
      return response.message;
    }
  },

  {
    name: "netsuite_get_custom_record_url",
    description: "Get the URL to open a custom record in NetSuite.",
    parameters: {
      type: "object",
      properties: {
        recordId: {
          type: "string",
          description: "The custom record ID"
        }
      },
      required: ["recordId"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.CUSTOM_RECORD_URL, {
        recordId: input.recordId
      });
      return response.message;
    }
  },

  {
    name: "netsuite_get_custom_record_list_url",
    description: "Get the URL to open the list view for a custom record type.",
    parameters: {
      type: "object",
      properties: {
        recordId: {
          type: "string",
          description: "The custom record type ID"
        }
      },
      required: ["recordId"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.CUSTOM_RECORD_LIST_URL, {
        recordId: input.recordId
      });
      return response.message;
    }
  },

  // ========== NetSuite Record Types ==========
  {
    name: "netsuite_get_all_record_types",
    description:
      "Get all available record types (standard and custom) in NetSuite. " +
      "Use ONLY when you cannot infer the recordType string from context. " +
      "Common types you already know: customer, lead, prospect, contact, vendor, employee, salesorder, invoice, purchaseorder, itemfulfillment, vendorbill, estimate, creditnote, journalentry, inventoryadjustment, script, scriptdeployment, workflowdefinition. " +
      "Do NOT call this just to load a record — use netsuite_load_record directly with the type you infer.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async () => {
      const response = await callApi(RequestRoutes.GET_ALL_RECORD_TYPES);
      return response.message;
    }
  },

  {
    name: "netsuite_load_record",
    description:
      "ALWAYS use this when the user asks to show, view, get, open, or retrieve a specific NetSuite record. " +
      "Returns body fields only (no sublist rows) — fast and token-efficient. " +
      "If the user also needs line items or sublist rows, call netsuite_get_record_sublists afterward. " +
      "Do NOT use SuiteQL as a substitute — SuiteQL internal IDs do NOT match record API IDs. " +
      "Common recordType values: customer, lead, prospect, contact, vendor, employee, salesorder, invoice, purchaseorder, itemfulfillment, vendorbill, estimate, journalentry, inventoryadjustment, script, scriptdeployment, workflowdefinition. " +
      "For custom records use the custom record type internal ID string (e.g. 'customrecord_my_type').",
    parameters: {
      type: "object",
      properties: {
        recordType: {
          type: "string",
          description:
            "The record type string (e.g. 'customer', 'salesorder', 'invoice', 'script'). See tool description for common values."
        },
        id: {
          type: "string",
          description: "The internal numeric ID of the record to load."
        }
      },
      required: ["recordType", "id"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.LOAD_RECORD, {
        type: input.recordType,
        id: input.id
      });
      return response.message;
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
    parameters: {
      type: "object",
      properties: {
        recordType: {
          type: "string",
          description: "The record type string (e.g. 'salesorder', 'invoice')."
        },
        id: {
          type: "string",
          description: "The internal numeric ID of the record."
        },
        sublistIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional list of sublist IDs to include (e.g. ['item', 'expense']). Omit to get all sublists."
        }
      },
      required: ["recordType", "id"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.LOAD_RECORD_SUBLISTS, {
        type: input.recordType,
        id: input.id,
        sublistIds: input.sublistIds ?? null
      });
      return response.message;
    }
  },

  {
    name: "netsuite_get_record_fields",
    description:
      "Get the list of all body fields and sublists available on a given record type — without loading a specific record. " +
      "Use this when you need to know field IDs before building a query or script. " +
      "NOT needed before netsuite_load_record — load the record directly to see both field metadata and values.",
    parameters: {
      type: "object",
      properties: {
        recordType: {
          type: "string",
          description:
            "The record type string (e.g. 'customer', 'salesorder', 'invoice')."
        }
      },
      required: ["recordType"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.GET_RECORD_FIELDS, {
        type: input.recordType
      });
      return response.message;
    }
  },

  {
    name: "netsuite_get_current_record",
    description: "Get the current record's ID and type from the NetSuite page.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async () => {
      const response = await callApi(RequestRoutes.CURRENT_REC_TYPE);
      return response.message;
    }
  },

  {
    name: "netsuite_get_current_user",
    description:
      "Get the currently logged-in NetSuite user's information (id, name, email, role, location, department, subsidiary).",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async () => {
      const response = await callApi(RequestRoutes.CURRENT_USER);
      return response.message;
    }
  },

  // ========== NetSuite PDF Templates ==========
  {
    name: "netsuite_get_pdf_templates",
    description: "Get all Advanced PDF/HTML templates in NetSuite.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async () => {
      const response = await callApi(RequestRoutes.ADVANCED_PDF_TEMPLATES);
      return response.message;
    }
  },

  {
    name: "netsuite_get_template_content",
    description:
      "Get the content of a specific PDF/HTML template. For transaction templates, always provide 'transactionType'. For custom record templates, provide 'customRecordType'. Omitting these may result in empty or incorrect output, even though they are technically optional.",
    parameters: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        printType: {
          type: "string",
          description: "Print type (TRANSACTION, CUSTOMRECORD, etc.)"
        },
        transactionType: {
          type: "string",
          description:
            "Transaction type (e.g., 'CustInvc' for invoices). Strongly recommended for transaction templates."
        },
        customRecordType: {
          type: "string",
          description:
            "Custom record type (required for custom record templates)."
        },
        savedSearch: {
          type: "string",
          description:
            "Saved search ID for templates based on a search (optional)."
        },
        version: {
          type: "number",
          description: "Template version (optional, defaults to current)."
        }
      },
      required: ["templateId", "printType"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.GET_TEMPLATES_CONTENT, {
        templateId: input.templateId,
        printType: input.printType,
        transactionType: input.transactionType,
        customRecordType: input.customRecordType,
        savedSearch: input.savedSearch,
        version: input.version
      });
      return response.message;
    }
  },

  {
    name: "netsuite_save_template",
    description: "Save changes to an Advanced PDF/HTML template.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        printType: { type: "string", description: "Print type" },
        tranType: { type: "string", description: "Transaction type" },
        savedSearch: { type: "string", description: "Saved search ID" },
        name: { type: "string", description: "Template name" },
        fromVersion: { type: "number", description: "Current version number" },
        recordType: { type: "string", description: "Record type" },
        templateScriptId: { type: "string", description: "Template script ID" },
        xmlBody: { type: "string", description: "Template XML content" }
      },
      required: ["templateId", "printType", "name", "fromVersion", "xmlBody"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.SAVE_TEMPLATE, {
        templateId: input.templateId,
        printType: input.printType,
        tranType: input.tranType,
        savedSearch: input.savedSearch,
        name: input.name,
        fromVersion: input.fromVersion,
        recordType: input.recordType,
        templateScriptId: input.templateScriptId,
        xmlBody: input.xmlBody
      });
      return response.message;
    }
  },

  {
    name: "netsuite_preview_template",
    description: "Preview an Advanced PDF/HTML template.",
    parameters: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        tranType: { type: "string", description: "Transaction type" },
        printType: { type: "string", description: "Print type" },
        recordType: { type: "string", description: "Record type" },
        savedSearch: { type: "string", description: "Saved search ID" },
        templateScriptId: { type: "string", description: "Template script ID" },
        template: { type: "string", description: "Template XML content" }
      },
      required: ["templateId", "printType", "template"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.PREVIEW, {
        templateId: input.templateId,
        tranType: input.tranType,
        printType: input.printType,
        recordType: input.recordType,
        savedSearch: input.savedSearch,
        templateScriptId: input.templateScriptId,
        template: input.template
      });
      return response.message;
    }
  },

  // ========== NetSuite Code Execution ==========
  {
    name: "netsuite_run_script",
    description:
      "Execute arbitrary SuiteScript 2.0 code in NetSuite. Returns logs and results.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "The SuiteScript 2.0 code to execute. You have access to all Client SuiteScript N/* modules."
        },
        mode: {
          type: "string",
          enum: ["normal", "stream"],
          description:
            "Execution mode: 'normal' or 'stream' for streaming output"
        }
      },
      required: ["code"]
    },
    execute: async (input) => {
      const apiMode =
        input.mode === "stream" ? ApiRequestType.STREAM : ApiRequestType.NORMAL;

      const response = await callApi(
        RequestRoutes.RUN_QUICK_SCRIPT,
        { code: input.code },
        apiMode
      );
      return response.message;
    }
  },

  // ========== NetSuite Logs ==========
  {
    name: "netsuite_get_logs",
    description:
      "Get script execution logs from NetSuite. Defaults to the last 7 days if no startDate is provided. " +
      "IMPORTANT: Always pass scriptIds to filter by the specific script you're investigating. " +
      "Results are returned newest-first. Use startDate/endDate to narrow the time range. " +
      "For debugging, focus on 'ERROR' and 'System' type logs — they contain the actual failures.",
    parameters: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description: "Start date (ISO string, e.g. '2025-05-11T00:00:00Z'). Defaults to 7 days ago if omitted."
        },
        endDate: {
          type: "string",
          description: "End date (ISO string). Defaults to now if omitted."
        },
        scriptIds: {
          type: "array",
          items: { type: "number" },
          description: "Filter by script internal IDs (numeric, e.g. [886]). ALWAYS provide this when investigating a specific script."
        },
        deploymentIds: {
          type: "array",
          items: { type: "number" },
          description: "Filter by deployment internal IDs (numeric)"
        },
        scriptTypes: {
          type: "array",
          items: { type: "string" },
          description: "Filter by script types (e.g. ['SCHEDULED', 'USEREVENT'])"
        },
        type: {
          type: "string",
          description: "Filter by log type: 'ERROR', 'DEBUG', 'AUDIT', 'EMERGENCY', or 'System'. Use 'ERROR' or 'System' for debugging."
        }
      },
      required: []
    },
    execute: async (input) => {
      // Normalize IDs so both ["886"] and [886] work reliably.
      const normalizeNumericIds = (value: unknown): number[] => {
        if (!Array.isArray(value)) return [];
        return value
          .map((v) => Number(v))
          .filter((v) => Number.isInteger(v) && v > 0);
      };

      // Default to the last 7 days using full-day bounds so we don't
      // accidentally hide logs with a restrictive time-of-day filter.
      const now = new Date();
      const defaultStartDate = new Date(now);
      defaultStartDate.setDate(defaultStartDate.getDate() - 7);
      defaultStartDate.setHours(0, 0, 0, 0);

      const startDate = input.startDate || defaultStartDate.toISOString();
      const endDate = input.endDate || now.toISOString();

      const response = await callApi(RequestRoutes.LOGS, {
        startDate,
        endDate,
        scriptIds: normalizeNumericIds(input.scriptIds),
        deploymentIds: normalizeNumericIds(input.deploymentIds),
        scriptTypes: input.scriptTypes || [],
        type: input.type
      });

      let results = response.message;

      // Limit to most recent 50 entries to prevent overwhelming context
      if (Array.isArray(results) && results.length > 50) {
        const total = results.length;
        results = results.slice(0, 50);
        results.push({ _note: `Showing 50 of ${total} logs. Narrow your date range or add type filter for more specific results.` });
      }

      return results;
    }
  },

  // ========== NetSuite File Cabinet ==========
  {
    name: "netsuite_get_root_folders",
    description:
      "Get the top-level (root) folders in the NetSuite File Cabinet. " +
      "Use this ONLY to list folders at the root level. " +
      "Do NOT use this when looking for a specific folder by name — use netsuite_find_folder instead, which searches the entire File Cabinet globally.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async () => {
      const response = await callApi(RequestRoutes.ROOT_FOLDERS);
      return response.message;
    }
  },

  {
    name: "netsuite_find_folder",
    description:
      "Search the ENTIRE NetSuite File Cabinet for folders matching a name or ID. Searches globally — not just root. " +
      "ALWAYS use this first when you need a folder's internal ID and don't already know it. " +
      "After finding the folder, call netsuite_list_folder with the returned id to see its contents. " +
      "Returns matching folders with id, name, and parent folder id.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description:
            "Exact internal ID of the folder (e.g. '67890'). Use for direct lookup."
        },
        name: {
          type: "string",
          description:
            "Partial folder name to search for globally (case-insensitive LIKE match). E.g. 'SuiteScripts' will match any folder containing that text anywhere in the File Cabinet."
        }
      },
      required: []
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.FIND_FOLDER, {
        id: input.id,
        name: input.name
      });
      return response.message;
    }
  },

  {
    name: "netsuite_list_folder",
    description:
      "List the immediate contents of a File Cabinet folder — returns both subfolders and files in a single call. " +
      "Use this after netsuite_find_folder to explore a folder's contents. " +
      "Returns { folderId, subfolders: [{id, name}], files: [{id, name, filesize, filetype, url}] }.",
    parameters: {
      type: "object",
      properties: {
        folderId: {
          type: "string",
          description:
            "Internal numeric ID of the folder to list (e.g. '12345'). Obtain this from netsuite_find_folder."
        }
      },
      required: ["folderId"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.LIST_FOLDER, {
        folderId: input.folderId
      });
      return response.message;
    }
  },

  {
    name: "netsuite_find_record_related_file",
    description:
      "Find a NetSuite File Cabinet report/file/document linked to a record ID, such as 'the report file with lead id 181'. " +
      "Use this FIRST when the user mentions a lead/customer/entity/transaction ID and asks for a report, file, PDF, document, or attachment. " +
      "It treats the number as the record ID, discovers likely SuiteQL relationship tables/fields, queries them, and returns the verified linked File Cabinet file ID and evidence. " +
      "Do not use netsuite_find_file(fileId) for these requests until this tool or a SuiteQL relationship query returns the actual file ID.",
    parameters: {
      type: "object",
      properties: {
        recordType: {
          type: "string",
          description:
            "Record type from the user request, e.g. 'lead', 'customer', 'entity', 'transaction', 'invoice', or 'salesorder'."
        },
        recordId: {
          type: "string",
          description:
            "Internal ID of the record/entity from the user request. Example: for 'lead id 181', pass '181'."
        },
        purpose: {
          type: "string",
          description:
            "Optional file purpose keyword, e.g. 'report', 'pdf', 'attachment', or 'document'. Defaults to 'report'."
        },
        readContent: {
          type: "boolean",
          description:
            "Optional. When true, also fetches and caches the linked file content. Leave false when the user only asked to find the file."
        }
      },
      required: ["recordType", "recordId"]
    },
    execute: async (input) => {
      const recordType = String(input.recordType ?? "").trim().toLowerCase();
      const recordId = toPositiveInteger(input.recordId);
      const purpose = String(input.purpose ?? "report").trim() || "report";
      const readContent = input.readContent === true;

      if (!recordType || !recordId) {
        return {
          success: false,
          error:
            "recordType and a positive numeric recordId are required. Example: { recordType: 'lead', recordId: '181' }"
        };
      }

      const tableResponse = await callApi(RequestRoutes.FETCH_SUITEQL_TABLES);
      const tables = normalizeSuiteqlTables(tableResponse.message);
      const candidates = rankRelatedFileTables(tables, recordType, purpose);
      const attempts: Array<Record<string, unknown>> = [];

      for (const table of candidates) {
        if (!isSuiteqlIdentifier(table.id)) {
          attempts.push({
            table: table.id,
            skipped: "Unsafe SuiteQL identifier from schema metadata."
          });
          continue;
        }

        const detailResponse = await callApi(RequestRoutes.FETCH_SUITEQL_TABLE_DETAIL, {
          tableName: table.id
        });
        const fields = normalizeSuiteqlFields(detailResponse.message);
        const linkFields = rankLinkFields(fields, recordType);
        const fileFields = rankFileFields(fields, purpose);

        if (linkFields.length === 0 || fileFields.length === 0) {
          attempts.push({
            table: table.id,
            label: table.label,
            fieldCount: fields.length,
            skipped:
              "Could not identify both a record reference field and a file/report field."
          });
          continue;
        }

        const hasName = fields.some((field) => field.id.toLowerCase() === "name");

        for (const linkField of linkFields) {
          if (!isSuiteqlIdentifier(linkField.id)) continue;
          for (const fileField of fileFields) {
            if (!isSuiteqlIdentifier(fileField.id)) continue;

            const selectColumns = [
              "id",
              ...(hasName ? ["name"] : []),
              `${linkField.id} AS linked_record_id`,
              `${fileField.id} AS linked_file_id`
            ];
            const sql =
              `SELECT ${selectColumns.join(", ")} FROM ${table.id} ` +
              `WHERE ${linkField.id} = ${recordId} ` +
              `AND ${fileField.id} IS NOT NULL AND ROWNUM <= 5`;
            const queryResponse = await callApi(RequestRoutes.RUN_SUITEQL_QUERY, {
              sql,
              limit: 5
            });

            if (queryResponse.status === "error") {
              attempts.push({
                table: table.id,
                linkField: linkField.id,
                fileField: fileField.id,
                sql,
                error: queryResponse.message || "Query execution failed."
              });
              continue;
            }

            const { rows, totalCount } = normalizeSuiteqlRows(queryResponse.message);
            attempts.push({
              table: table.id,
              label: table.label,
              linkField: linkField.id,
              fileField: fileField.id,
              rowCount: rows.length,
              totalCount,
              sql
            });

            for (const row of rows) {
              const linkedRecordId = findAliasedValue(
                row,
                "linked_record_id",
                linkField.id
              );
              const fileId = toPositiveInteger(
                findAliasedValue(row, "linked_file_id", fileField.id)
              );
              if (!fileId) continue;

              let fileMessage: unknown = null;
              let file: SuiteqlRow | null = null;
              try {
                const found = await findFileCabinetFile(fileId);
                fileMessage = found.message;
                file = found.file;
              } catch (err) {
                fileMessage = { error: String(err) };
              }

              let cachedContent: unknown = undefined;
              if (readContent) {
                try {
                  cachedContent = await fetchAndCacheFileContent(
                    fileId,
                    file?.url ? String(file.url) : undefined
                  );
                } catch (err) {
                  cachedContent = { error: String(err) };
                }
              }

              return {
                success: true,
                recordType,
                recordId,
                purpose,
                fileId,
                file,
                fileLookup: fileMessage,
                relationship: {
                  table: table.id,
                  tableLabel: table.label,
                  linkField: linkField.id,
                  linkFieldLabel: linkField.label,
                  fileField: fileField.id,
                  fileFieldLabel: fileField.label,
                  linkedRecordId,
                  row,
                  sql
                },
                cachedContent,
                attempts,
                next:
                  readContent
                    ? "The linked file content was fetched and cached when possible. Use cache_display(cacheKey) to display it if a cacheKey is present."
                    : "Use netsuite_get_file_content with this fileId if the user needs the file contents displayed or analyzed."
              };
            }
          }
        }
      }

      return {
        success: false,
        recordType,
        recordId,
        purpose,
        candidateTables: candidates.map((table) => ({
          id: table.id,
          label: table.label,
          type: table.type
        })),
        attempts,
        next:
          "No linked file was found through the best relationship candidates. Search more specific custom record tables or inspect joins for attachment/media relationships."
      };
    }
  },

  {
    name: "netsuite_find_file",
    description:
      "Search the ENTIRE NetSuite File Cabinet for files matching a file name or internal FILE ID. Searches globally across all folders. " +
      "Returns matching files with id, name, folder (parent folder id), filesize, filetype, and url. " +
      "Do NOT pass a lead/customer/entity/transaction ID as fileId. If the user asks for a report/file related to a record ID (for example 'lead id 181'), use SuiteQL relationship discovery first and only use this tool with a verified File Cabinet file ID or distinctive file name.",
    parameters: {
      type: "object",
      properties: {
        fileId: {
          type: "string",
          description:
            "Internal FILE ID only (e.g. '12345'). Do not use a lead/customer/entity/transaction ID here."
        },
        name: {
          type: "string",
          description:
            "Partial file name to search globally (case-insensitive LIKE match). E.g. 'myScript' will match 'myScript.js' anywhere in the File Cabinet."
        }
      },
      required: []
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.FIND_FILE, {
        id: input.fileId ?? input.id,
        name: input.name
      });
      const message = response.message as Record<string, unknown>;
      const files = message?.files as
        | { results?: unknown[]; totalCount?: number }
        | unknown[]
        | undefined;
      let totalCount: number | null = null;
      if (Array.isArray(files)) {
        totalCount = files.length;
      } else if (files && typeof files === "object") {
        totalCount = files.totalCount ?? files.results?.length ?? null;
      }

      if ((input.fileId ?? input.id) && !input.name && totalCount === 0) {
        return {
          ...message,
          hint:
            "No File Cabinet file has that internal ID. If the number came from a lead/customer/entity/transaction request, it is probably a record ID; use SuiteQL relationship discovery to find the linked file ID."
        };
      }

      return message;
    }
  },

  {
    name: "netsuite_get_file_content",
    description:
      "Read a file from the NetSuite File Cabinet by its numeric ID. " +
      "The full content is stored in the conversation cache automatically — it does NOT appear in your context. " +
      "Returns metadata only: { cacheKey, fileId, contentType, sizeChars, binary }. " +
      "To DISPLAY the content to the user: call cache_display(cacheKey) AND include [VIEW:{cacheKey}] verbatim in your text response. " +
      "To ANALYZE the content, call cache_retrieve(cacheKey) to bring it into context. " +
      "Pass the file's internal numeric ID (from netsuite_find_file, netsuite_list_folder, or SuiteQL results). " +
      "Do NOT guess that a user-provided number is a file ID if they also mentioned an entity type (e.g. 'lead 181' — 181 is the lead ID, not a file ID). " +
      "Use SuiteQL to find files related to that entity instead.",
    parameters: {
      type: "object",
      properties: {
        fileId: {
          type: "number",
          description:
            "Internal numeric ID of the file to read (e.g. 21301). Obtain from netsuite_find_file or SuiteQL."
        }
      },
      required: ["fileId"]
    },
    execute: async (input) => {
      const fileId = toPositiveInteger(input.fileId);
      if (!fileId) return { error: "fileId must be a positive numeric File Cabinet ID." };

      try {
        return await fetchAndCacheFileContent(fileId);
      } catch (err) {
        return { error: String(err) };
      }
    }
  },

  {
    name: "netsuite_create_folder",
    description:
      "Create a new folder in the NetSuite File Cabinet. Use this when asked to create a folder for uploading scripts or organizing files. Returns the created folder id from NetSuite on success.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The name of the folder to create."
        },
        parentFolderId: {
          type: "number",
          description:
            "ALWAYS REQUIRED. Internal ID of the parent folder. " +
            "If the user specified a folder ID, pass that exact number. " +
            "If the user did not specify a parent folder, pass -15 (SuiteScripts root)."
        }
      },
      required: ["name", "parentFolderId"]
    },
    execute: async (input) => {
      if (input.parentFolderId === undefined || input.parentFolderId === null) {
        console.warn(
          "[netsuite_create_folder] parentFolderId not provided by AI — falling back to -15 (SuiteScripts root). " +
            "If the user specified a parent folder ID, the AI failed to pass it."
        );
      }
      const response = await callApi(RequestRoutes.CREATE_FOLDER, {
        name: input.name,
        parentFolder: input.parentFolderId ?? -15
      });
      return response.message;
    }
  },

  {
    name: "netsuite_upload_file",
    description:
      "Upload a file to the NetSuite File Cabinet. Two modes:\n" +
      "(1) Content mode — provide 'fileName', 'fileContent', and 'folderId'. Use this when the AI needs to upload a script or any text file it has generated.\n" +
      "(2) Picker mode — omit 'fileName'/'fileContent' and the tool opens a file picker dialog so the user can select files from their machine.\n\n" +
      "Returns { uploaded: string[], errors: string[] }.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        fileName: {
          type: "string",
          description:
            "Name of the file to create and upload (e.g. 'my_script.js'). Required in content mode. Omit to open the file picker."
        },
        fileContent: {
          type: "string",
          description:
            "Raw text content of the file (e.g. the full SuiteScript source). Required in content mode."
        },
        folderId: {
          type: "number",
          description:
            "ALWAYS REQUIRED. Internal numeric ID of the target folder in the File Cabinet. " +
            "If the user specified a folder ID (e.g. '2543'), pass that exact number. " +
            "If the user did not specify a folder, pass -15 (SuiteScripts root)."
        }
      },
      required: ["folderId"]
    },
    execute: async (input) => {
      const folderId = input.folderId ?? -15;
      if (input.folderId === undefined || input.folderId === null) {
        console.warn(
          "[netsuite_upload_file] folderId not provided by AI — falling back to -15 (SuiteScripts root). " +
            "If the user specified a folder ID, the AI failed to pass it."
        );
      }
      const response = await callApi(RequestRoutes.UPLOAD_FILE, {
        fileName: input.fileName,
        fileContent: input.fileContent,
        folderId
      });
      return response.message;
    }
  },

  {
    name: "netsuite_create_script",
    description:
      "Create a NetSuite Script record for an already-uploaded .js file. " +
      "IMPORTANT: scriptType uses the NETSUITE SYSTEM NAME, NOT the UI label. " +
      "Common mappings — UI label → system name: " +
      "Suitelet → SCRIPTLET, RESTlet → RESTLET, SSP Application → WEBAPP, " +
      "User Event → USEREVENT, Scheduled Script → SCHEDULED. " +
      "Returns { scriptRecordId, scriptUrl } on success.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Human-readable name for the script record (e.g. 'Customer Dashboard Suitelet')."
        },
        scriptId: {
          type: "string",
          description:
            "Script ID in NetSuite format (e.g. 'customscript_customer_dashboard')."
        },
        fileId: {
          type: "string",
          description:
            "Internal ID of the uploaded .js file in the File Cabinet."
        },
        scriptType: {
          type: "string",
          description:
            "NetSuite script type constant. Common values: SUITELET, USEREVENT, SCHEDULED, RESTLET, PORTLET. Defaults to SUITELET."
        },
        description: {
          type: "string",
          description: "Optional description for the script record."
        },
        apiVersion: {
          type: "string",
          description: "SuiteScript API version. Defaults to '2.1'."
        }
      },
      required: ["name", "scriptId", "fileId"]
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.CREATE_SCRIPT, {
        name: input.name,
        scriptId: input.scriptId,
        fileId: input.fileId,
        scriptType: input.scriptType,
        description: input.description ?? "",
        apiVersion: input.apiVersion ?? "2.1"
      });
      return response.message;
    }
  },

  // ========== NetSuite Export ==========
  {
    name: "netsuite_export_record",
    description: "Export the current record's data (body fields and sublists).",
    parameters: {
      type: "object",
      properties: {
        blackListFields: {
          type: "array",
          items: { type: "string" },
          description: "Fields to exclude"
        },
        blackListSublistFields: {
          type: "array",
          items: { type: "string" },
          description: "Sublist fields to exclude"
        },
        blackListSublists: {
          type: "array",
          items: { type: "string" },
          description: "Sublists to exclude"
        },
        whiteListFields: {
          type: "array",
          items: { type: "string" },
          description:
            "Fields to include (if specified, only these are included)"
        },
        whiteListSublists: {
          type: "array",
          items: { type: "string" },
          description: "Sublists to include"
        },
        whiteListSublistFields: {
          type: "array",
          items: { type: "string" },
          description: "Sublist fields to include"
        },
        include: {
          type: "array",
          items: { type: "string" },
          description:
            "What to include per field: 'fieldId', 'fieldName', 'text', 'value'"
        }
      },
      required: []
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.EXPORT_RECORD, {
        config: {
          blackListFields: input.blackListFields,
          blackListSublistFields: input.blackListSublistFields,
          blackListSublists: input.blackListSublists,
          whiteListFields: input.whiteListFields,
          whiteListSublists: input.whiteListSublists,
          whiteListSublistFields: input.whiteListSublistFields,
          include: input.include
        }
      });
      return response.message;
    }
  },

  // ========== NetSuite System ==========
  {
    name: "netsuite_check_connection",
    description: "Check if the NetSuite API is available and connected.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async () => {
      const response = await callApi(RequestRoutes.CHECK_CONNECTION);
      return response.message;
    }
  },

  {
    name: "netsuite_get_available_modules",
    description:
      "Get list of available NetSuite modules (N/*) in the current context.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    execute: async () => {
      const response = await callApi(RequestRoutes.AVAILABLE_MODULES);
      return response.message;
    }
  },

  // ========== SuiteScript Module Documentation ==========
  {
    name: "netsuite_search_module_docs",
    description:
      "Search the local SuiteScript 2.x module documentation. Returns methods, objects, properties, and enums from N/* modules (e.g. N/record, N/search, N/query, N/file). Use this BEFORE writing any SuiteScript code to look up correct method signatures, parameters, and return types. Also use it when you are unsure how a specific API works.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search term — a method name, object name, keyword, or description fragment (e.g. 'record.load', 'search.create', 'file', 'submit')."
        },
        moduleName: {
          type: "string",
          description:
            "Optional: filter results to a specific module, e.g. 'N/record', 'N/search', 'N/query', 'N/file'."
        },
        memberType: {
          type: "string",
          enum: ["Method", "Object", "Property", "Enum"],
          description: "Optional: filter by member type."
        }
      },
      required: ["query"]
    },
    execute: async (input) => {
      const count = await getModuleCount();
      if (count === 0) {
        return {
          error:
            "No SuiteScript module documentation loaded. Ask the user to load it from the SuiteScript Modules view first."
        };
      }

      const query = String(input.query ?? "");
      const moduleName = input.moduleName
        ? String(input.moduleName)
        : undefined;
      const memberType = input.memberType
        ? String(input.memberType)
        : undefined;

      const results = await searchMembers(query, {
        moduleName,
        memberType: memberType as string | undefined,
        limit: 20
      });

      if (results.length === 0) {
        return {
          message: `No documentation found for "${query}".`,
          results: []
        };
      }

      return {
        query,
        count: results.length,
        results: results.map((r) => ({
          id: r.id,
          module: r.moduleName,
          type: r.memberType,
          name: r.name,
          returnType: r.returnType || undefined,
          description: r.description
        }))
      };
    }
  },

  {
    name: "netsuite_get_module_member_details",
    description:
      "Get the full documentation details for a specific SuiteScript module member — including parameters, return type, supported script types, errors, syntax examples, and enum values. Call this after netsuite_search_module_docs to get the complete signature for a method or object you plan to use.",
    parameters: {
      type: "object",
      properties: {
        memberId: {
          type: "number",
          description:
            "The numeric id of the member returned by netsuite_search_module_docs."
        }
      },
      required: ["memberId"]
    },
    execute: async (input) => {
      const id = Number(input.memberId);
      const member = await getMemberById(id);
      if (!member) {
        return { error: `No module member found with id ${id}.` };
      }

      return {
        module: member.moduleName,
        type: member.memberType,
        name: member.name,
        returnType: member.returnType || undefined,
        scriptTypes: member.scriptTypes || undefined,
        description: member.description,
        details: member.details ?? undefined
      };
    }
  },

  // ============================================================
  // Conversation Cache
  // ============================================================

  {
    name: "cache_store",
    description:
      "Store any string content in the conversation cache under a key. " +
      "Use this to save large file contents, generated scripts, or query results so you can retrieve them later without repeating them in your response. " +
      "The cache is scoped to the current conversation and cleared when a new chat starts.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "A short unique key to identify this content (e.g. 'original_script', 'generated_code', 'query_results')."
        },
        content: {
          type: "string",
          description: "The full string content to store."
        },
        description: {
          type: "string",
          description: "Optional short description of what this content is (e.g. 'Customer onboarding suitelet, file ID 12345')."
        }
      },
      required: ["key", "content"]
    },
    execute: (input) => {
      const key = String(input.key);
      const content = String(input.content);
      agentCache.set(key, content, input.description ? String(input.description) : undefined);
      return { stored: true, key, sizeChars: content.length };
    }
  },

  {
    name: "cache_retrieve",
    description:
      "Retrieve content previously stored in the conversation cache. Returns the full content. " +
      "Always call this before cache_upload_file to verify the content is correct before writing.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "The cache key to retrieve." }
      },
      required: ["key"]
    },
    execute: (input) => {
      const entry = agentCache.get(String(input.key));
      if (!entry) return { found: false, key: input.key, message: "No entry found for this key." };
      return {
        found: true,
        key: input.key,
        content: entry.content,
        description: entry.description,
        storedAt: entry.storedAt,
        sizeChars: entry.sizeChars
      };
    }
  },

  {
    name: "cache_display",
    description:
      "Signal that cached content should be displayed to the user. " +
      "This call is kept in conversation history so the AI remembers what was shown. " +
      "IMPORTANT: After calling this tool you MUST also write [VIEW:{key}] verbatim in your text response " +
      "(e.g. 'Here is the file: [VIEW:file_21301]'). The UI replaces that token with the rendered content. " +
      "Do NOT reproduce the content in your text — only the [VIEW:{key}] marker.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "The cache key to display." }
      },
      required: ["key"]
    },
    execute: (input) => {
      const entry = agentCache.get(String(input.key));
      if (!entry) return { found: false, key: input.key, message: "No entry found for this key. Fetch the file first." };
      return {
        found: true,
        key: input.key,
        description: entry.description,
        sizeChars: entry.sizeChars
        // content intentionally omitted — template reads from agentCache directly to avoid truncation
      };
    }
  },

  {
    name: "cache_list",
    description: "List all keys currently in the conversation cache with their descriptions and sizes. Use this to see what is cached.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: () => {
      const entries = agentCache.list();
      if (entries.length === 0) return { entries: [], message: "Cache is empty." };
      return { entries };
    }
  },

  {
    name: "cache_delete",
    description: "Remove a specific entry from the conversation cache.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "The cache key to remove." }
      },
      required: ["key"]
    },
    execute: (input) => {
      const deleted = agentCache.delete(String(input.key));
      return { deleted, key: input.key };
    }
  },

  {
    name: "cache_upload_file",
    description:
      "Upload a file from the conversation cache directly to the NetSuite File Cabinet. " +
      "The cached content is written as-is WITHOUT passing through your response, preserving the exact structure. " +
      "IMPORTANT: Always call cache_retrieve first to verify the content is correct. " +
      "If the content needs changes to fix errors, update it with cache_store before calling this. " +
      "Returns the upload result.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        cacheKey: { type: "string", description: "The cache key containing the file content." },
        fileName: { type: "string", description: "File name to create (e.g. 'my_script.js')." },
        folderId: {
          type: "number",
          description: "Internal ID of the target NetSuite folder. Use -15 for the SuiteScripts root."
        }
      },
      required: ["cacheKey", "fileName", "folderId"]
    },
    execute: async (input) => {
      const entry = agentCache.get(String(input.cacheKey));
      if (!entry) {
        return {
          error: `No cache entry found for key "${input.cacheKey}". Use cache_store to store the content first.`
        };
      }
      const response = await callApi(RequestRoutes.UPLOAD_FILE, {
        fileName: input.fileName,
        fileContent: entry.content,
        folderId: input.folderId ?? -15
      });
      return response.message;
    }
  }
];
