// toolManager.ts
import type { ToolDefinition } from "../composables/useAgent";
import { callApi, ApiRequestType } from "./api";
import { RequestRoutes } from "../types/request";
import { Parser } from "expr-eval";

export const tools: ToolDefinition[] = [
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
      "Fetches the text content of a public URL, including JavaScript-rendered pages.",
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
      "Search and list scripts from NetSuite. Returns an array of objects with fields: scriptid (string ID like 'customscript_xxx'), id (internal numeric ID), name, scripttype, owner, scriptfile. Use 'search' for a fuzzy keyword search across name, scriptid, owner, and scriptfile. Use 'scriptId' only when you know the exact script ID string. Call with no parameters to list all scripts. To read the actual source code of scripts found here, pass the numeric 'id' values to netsuite_get_script_files — do NOT call this tool again for that purpose.",
    parameters: {
      type: "object",
      properties: {
        scriptId: {
          type: "string",
          description:
            "Exact script ID string for precise match (e.g. 'customscript_my_suitelet'). Only use when you know the full exact ID."
        },
        search: {
          type: "string",
          description:
            "Fuzzy search keyword to filter results by name, scriptid, owner, or scriptfile (case-insensitive). Use this when looking for scripts by partial name or keyword."
        }
      },
      required: []
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.SCRIPTS, {
        scriptId: input.scriptId
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
      "Get all deployed scripts attached to a specific record type, including their full source code. Returns an array of objects with: scriptName, scriptType, scriptId (string ID), id (internal numeric ID), and scriptFile (the full script source code). Use this to inspect what scripts run on a given record type. If you already know specific script numeric IDs and just need their source code, use netsuite_get_script_files instead.",
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
      return response.message;
    }
  },

  {
    name: "netsuite_get_script_files",
    description:
      "Fetch the source code files for one or more scripts by their internal numeric IDs. This is the follow-up tool after netsuite_get_scripts: first search scripts to get their numeric 'id' values, then pass those IDs here to retrieve the actual source code. Returns an array of objects with: scriptName, scriptType, scriptId (string ID), id (internal numeric ID), and scriptFile (the full script source code, or null on error). Accepts a single ID like [523] or multiple IDs like [523, 841, 102].",
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
      return response.message;
    }
  },

  {
    name: "netsuite_get_script_deployments",
    description:
      "Get deployment records for one or more scripts. Requires the script's internal numeric ID (the 'id' field from netsuite_get_scripts), NOT the string scriptid. Returns an array of objects with: scriptid (deployment string ID like 'customdeploy_xxx'), recordtype, isdeployed ('T'/'F'), status, loglevel, primarykey (deployment internal ID), id (script internal ID), scriptname. Use 'search' to filter results by keyword.",
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
    description: "Get the URL to open a script deployment in NetSuite.",
    parameters: {
      type: "object",
      properties: {
        deployment: {
          type: "string",
          description: "The deployment ID"
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
    description: "Get the URL to open a Suitelet in NetSuite.",
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
      "Generate the Suitelet URL for a given script ID and deployment ID, then open it in a new browser tab. Returns the generated URL.",
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
      "Get all available record types (standard and custom) in NetSuite.",
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
    description: "Get the content of a specific PDF/HTML template.",
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
          description: "Transaction type (optional)"
        },
        customRecordType: {
          type: "string",
          description: "Custom record type (optional)"
        },
        savedSearch: {
          type: "string",
          description: "Saved search ID (optional)"
        },
        version: {
          type: "number",
          description: "Template version (optional)"
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
      "Get script execution logs from NetSuite with optional date and filter criteria.",
    parameters: {
      type: "object",
      properties: {
        startDate: {
          type: "string",
          description: "Start date (ISO string)"
        },
        endDate: {
          type: "string",
          description: "End date (ISO string)"
        },
        scriptIds: {
          type: "array",
          items: { type: "string" },
          description: "Filter by script IDs"
        },
        deploymentIds: {
          type: "array",
          items: { type: "string" },
          description: "Filter by deployment IDs"
        },
        scriptTypes: {
          type: "array",
          items: { type: "string" },
          description: "Filter by script types"
        }
      },
      required: []
    },
    execute: async (input) => {
      const response = await callApi(RequestRoutes.LOGS, {
        startDate: input.startDate,
        endDate: input.endDate,
        scriptIds: input.scriptIds || [],
        deploymentIds: input.deploymentIds || [],
        scriptTypes: input.scriptTypes || []
      });
      return response.message;
    }
  },

  // ========== NetSuite File Cabinet ==========
  {
    name: "netsuite_get_root_folders",
    description: "Get root folders in the NetSuite file cabinet.",
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
  }
];
