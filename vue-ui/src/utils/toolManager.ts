// toolManager.ts
import type { ToolDefinition } from "../composables/useAgent";

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
          description:
            "A JS-safe math expression, e.g. '2 + 2' or '10 * (3 + 4)'"
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
        const result = Function(`"use strict"; return (${expr})`)();
        return { result };
      } catch {
        return { error: "Invalid expression" };
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
    description: "Fetches the text content of a public URL.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "The full URL to fetch, e.g. 'https://example.com/api/data'"
        }
      },
      required: ["url"]
    },
    execute: async (input) => {
      try {
        const res = await fetch(String(input.url));
        const text = await res.text();
        return { status: res.status, body: text.slice(0, 2000) }; // trim large responses
      } catch (err) {
        return { error: String(err) };
      }
    }
  }
];
