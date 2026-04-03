// toolManager.ts
import type { ToolDefinition } from "../composables/useAgent";
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
        // r.jina.ai renders JS and returns clean markdown text
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
  }
];
