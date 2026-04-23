// sqlAiTools.ts — AI agent tools specialized for SuiteQL query building
// These are "dynamic skills" that fetch live schema data to augment the AI's context.
import type { ToolDefinition } from "../composables/useAgent";
import { callApi, type ApiResponse } from "./api";
import { RequestRoutes } from "../types/request";

/**
 * Creates SQL AI tools bound to the live schema context.
 *
 * "Dynamic skills" pattern: these tools self-discover schema data (tables, fields,
 * joins) at runtime and feed it back to the agent, augmenting its accuracy when
 * building SuiteQL queries.
 */
export const createSqlAiTools = (): ToolDefinition[] => [
  // ── Dynamic Skill: Search tables ──
  {
    name: "sql_search_tables",
    description:
      "Search available SuiteQL tables by keyword. Returns table IDs and labels matching the search term. Use this to discover which tables exist before building a query. This is a dynamic skill — it fetches live data from NetSuite.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search keyword to filter tables by ID or label (e.g. 'customer', 'transaction', 'item'). Leave empty to list all tables."
        }
      },
      required: []
    },
    execute: async (input) => {
      try {
        const response = (await callApi(
          RequestRoutes.FETCH_SUITEQL_TABLES
        )) as ApiResponse;
        const data = response.message;
        const list: { id: string; label: string; type: string }[] = (
          data?.data ?? (Array.isArray(data) ? data : [])
        ).map((t: { id: string; label: string; type: string }) => ({
          id: t.id,
          label: t.label,
          type: t.type
        }));

        const query = String(input.query ?? "").trim().toLowerCase();
        const filtered = query
          ? list.filter(
              (t) =>
                t.id.toLowerCase().includes(query) ||
                t.label.toLowerCase().includes(query)
            )
          : list;

        return {
          total: list.length,
          matched: filtered.length,
          tables: filtered.slice(0, 50) // cap to keep context small
        };
      } catch (error) {
        return { error: `Failed to fetch tables: ${String(error)}` };
      }
    }
  },

  // ── Dynamic Skill: Get table fields ──
  {
    name: "sql_get_table_fields",
    description:
      "Get all columns/fields for a specific SuiteQL table. Returns field IDs, labels, and data types. Use this to know which columns are available when building SELECT or WHERE clauses. This is a dynamic skill — it fetches live schema data.",
    parameters: {
      type: "object",
      properties: {
        tableName: {
          type: "string",
          description:
            "The exact table ID (e.g. 'customer', 'transaction', 'item'). Must match a table from sql_search_tables."
        }
      },
      required: ["tableName"]
    },
    execute: async (input) => {
      try {
        const tableName = String(input.tableName);
        const response = (await callApi(
          RequestRoutes.FETCH_SUITEQL_TABLE_DETAIL,
          { tableName }
        )) as ApiResponse;
        const data = response.message;
        const raw = data?.data ?? data ?? {};
        // Patterns that typically hold coded enum values — must discover before filtering
        const ENUM_FIELD_PATTERNS =
          /^(status|type|category|class|subsidiary|currency|department|location|terms|shipmethod|paymentmethod|custbody_|custcol_)/i;

        const fields = (raw.fields ?? [])
          .filter((f: { isColumn: boolean }) => f.isColumn)
          .map((f: { id: string; label: string; dataType: string }) => ({
            id: f.id,
            label: f.label,
            dataType: f.dataType,
            ...(ENUM_FIELD_PATTERNS.test(f.id)
              ? {
                  requiresValueDiscovery: true,
                  note: "⚠️ Coded field — call sql_discover_field_values before using in WHERE"
                }
              : {})
          }));

        const flaggedCount = fields.filter(
          (f: { requiresValueDiscovery?: boolean }) => f.requiresValueDiscovery
        ).length;

        return {
          table: tableName,
          fieldCount: fields.length,
          flaggedCount,
          fields,
          reminder:
            flaggedCount > 0
              ? `${flaggedCount} field(s) marked requiresValueDiscovery — you MUST call sql_discover_field_values on each before using them in WHERE clauses`
              : undefined
        };
      } catch (error) {
        return {
          error: `Failed to fetch fields for "${input.tableName}": ${String(error)}`
        };
      }
    }
  },

  // ── Dynamic Skill: Get table joins ──
  {
    name: "sql_get_table_joins",
    description:
      "Get available joins/relationships for a specific SuiteQL table. Returns join labels, target tables, cardinality, join type, and join conditions. Use this to discover how to JOIN tables together. This is a dynamic skill.",
    parameters: {
      type: "object",
      properties: {
        tableName: {
          type: "string",
          description: "The exact table ID to get joins for."
        }
      },
      required: ["tableName"]
    },
    execute: async (input) => {
      try {
        const tableName = String(input.tableName);
        const response = (await callApi(
          RequestRoutes.FETCH_SUITEQL_TABLE_DETAIL,
          { tableName }
        )) as ApiResponse;
        const data = response.message;
        const raw = data?.data ?? data ?? {};
        const joins = (raw.joins ?? []).map(
          (j: {
            id: string;
            label: string;
            joinType: string;
            cardinality: string;
            sourceTargetType?: {
              id: string;
              label: string;
              joinPairs?: { id: string; label: string }[];
            };
          }) => ({
            id: j.id,
            label: j.label,
            joinType: j.joinType,
            cardinality: j.cardinality,
            targetTable: j.sourceTargetType?.id ?? null,
            targetLabel: j.sourceTargetType?.label ?? null,
            joinCondition:
              j.sourceTargetType?.joinPairs?.[0]?.label ?? null
          })
        );

        return {
          table: tableName,
          joinCount: joins.length,
          joins
        };
      } catch (error) {
        return {
          error: `Failed to fetch joins for "${input.tableName}": ${String(error)}`
        };
      }
    }
  },

  // ── Execute SuiteQL Query (with LIMIT 5 for preview) ──
  {
    name: "sql_execute_query",
    description:
      "Execute a SuiteQL query and return the results. The query is automatically limited to 5 rows for preview purposes. Use this to test and validate queries you build. Returns column names and row data so you can verify the data structure.",
    parameters: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "The SuiteQL query to execute."
        }
      },
      required: ["sql"]
    },
    execute: async (input) => {
      try {
        const sql = String(input.sql);
        const response = (await callApi(RequestRoutes.RUN_SUITEQL_QUERY, {
          sql,
          limit: 5
        })) as ApiResponse;

        if (response.status === "error") {
          return {
            success: false,
            error: response.message || "Query execution failed"
          };
        }

        const payload = response.message as
          | { results: Record<string, unknown>[]; totalCount: number }
          | Record<string, unknown>[];

        const results = Array.isArray(payload)
          ? payload
          : ((payload as { results: Record<string, unknown>[] }).results ?? []);
        const totalCount = Array.isArray(payload)
          ? results.length
          : ((payload as { totalCount: number }).totalCount ?? results.length);

        const columns =
          results.length > 0 ? Object.keys(results[0] as object) : [];

        return {
          success: true,
          columns,
          rowCount: results.length,
          totalCount,
          results,
          note:
            totalCount > 5
              ? `Showing 5 of ${totalCount} total rows (preview mode).`
              : undefined
        };
      } catch (error) {
        return {
          success: false,
          error: `Execution failed: ${String(error)}`
        };
      }
    }
  },

  // ── Dynamic Skill: Discover field values ──
  {
    name: "sql_discover_field_values",
    description:
      "Sample DISTINCT actual values for a specific column in a table. Use this BEFORE writing WHERE clauses on text/string fields to discover the exact casing and format of real values (e.g. 'COMPLETED' vs 'Completed'). Returns up to 20 distinct non-null values. This is a dynamic skill — it runs a live query against NetSuite data.",
    parameters: {
      type: "object",
      properties: {
        tableName: {
          type: "string",
          description:
            "The exact table ID (e.g. 'transaction', 'customrecord_foo'). Must match a real SuiteQL table."
        },
        fieldId: {
          type: "string",
          description:
            "The column ID to sample values for (e.g. 'status', 'custrecord_ctkc_enrichment_status')."
        }
      },
      required: ["tableName", "fieldId"]
    },
    execute: async (input) => {
      try {
        const tableName = String(input.tableName);
        const fieldId = String(input.fieldId);
        const sql = `SELECT DISTINCT ${fieldId} FROM ${tableName} WHERE ${fieldId} IS NOT NULL AND ROWNUM <= 20`;
        const response = (await callApi(RequestRoutes.RUN_SUITEQL_QUERY, {
          sql,
          limit: 20
        })) as ApiResponse;

        if (response.status === "error") {
          return {
            success: false,
            error: response.message || "Query failed"
          };
        }

        const payload = response.message as
          | { results: Record<string, unknown>[] }
          | Record<string, unknown>[];
        const results = Array.isArray(payload)
          ? payload
          : ((payload as { results: Record<string, unknown>[] }).results ?? []);

        const values = results
          .map((r) => r[fieldId] ?? Object.values(r)[0])
          .filter((v) => v !== null && v !== undefined && v !== "");

        return {
          success: true,
          table: tableName,
          field: fieldId,
          sampleCount: values.length,
          distinctValues: values,
          note:
            values.length === 0
              ? "No non-null values found in the first 20 rows."
              : `Found ${values.length} distinct value(s). Use exact casing in WHERE clauses.`
        };
      } catch (error) {
        return {
          success: false,
          error: `Field value discovery failed: ${String(error)}`
        };
      }
    }
  },

  // ── Get current editor query (read-only context) ──
  {
    name: "sql_get_editor_query",
    description:
      "Get the current SuiteQL query from the main editor. Use this to understand what the user is working on. You CANNOT modify the main editor query — this is read-only.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    // This execute is a placeholder — it gets replaced at runtime by the component
    // with a function that reads the actual editor content.
    execute: async () => {
      return { query: "", note: "No editor context available." };
    }
  }
];
