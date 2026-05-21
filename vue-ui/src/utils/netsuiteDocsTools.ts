// netsuiteDocsTools.ts — AI agent tools for searching and reading NetSuite documentation
import type { ToolDefinition } from "../composables/useAgent";
import { getNetsuiteEnvironment } from "./api";

const NETSUITE_HELP_PATH = "/app/help/helpcenter.nl";

/**
 * Fetch a NetSuite help center page and return the raw HTML text.
 * Uses `credentials: "include"` so the user's active NetSuite session is used.
 */
const fetchHelpPage = async (url: string): Promise<string> => {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.text();
};

/**
 * Parse search results from a NetSuite help search page.
 * Each result block contains a `.result-title` element (with an anchor) and a
 * `.result-body` element (summary text).
 */
const parseSearchResults = (
  html: string,
  baseUrl: string
): Array<{ title: string; url: string; summary: string }> => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const results: Array<{ title: string; url: string; summary: string }> = [];

  const titleEls = doc.querySelectorAll(".result-title");
  const bodyEls = doc.querySelectorAll(".result-body");

  titleEls.forEach((titleEl, i) => {
    const anchor = titleEl.querySelector("a");
    const title = anchor?.textContent?.trim() ?? titleEl.textContent?.trim() ?? "";
    const href = anchor?.getAttribute("href") ?? "";
    const fullUrl = href.startsWith("http")
      ? href
      : href
        ? `${baseUrl}${href}`
        : "";
    const summary = bodyEls[i]?.textContent?.trim() ?? "";

    if (title && fullUrl) {
      results.push({ title, url: fullUrl, summary });
    }
  });

  return results;
};

/**
 * Extract the main content text from a NetSuite doc page.
 * Looks for `#nshelp_page` first, falls back to `<main>` then `<body>`.
 */
const parseDocPage = (html: string): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const contentEl =
    doc.getElementById("nshelp_page") ??
    doc.querySelector(".nshelp_page") ??
    doc.querySelector("main") ??
    doc.body;

  return contentEl?.textContent?.trim() ?? "";
};

export const netsuiteDocsTools: ToolDefinition[] = [
  {
    name: "search_netsuite_docs",
    description:
      "Search the NetSuite help documentation. Returns a list of matching pages with title, URL, and summary. Use this first to find relevant documentation, then call 'read_netsuite_doc_page' with a returned URL to get the full content of a specific page.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "The search keywords to look up in the NetSuite documentation (e.g. 'SuiteScript record load', 'saved search filters')."
        }
      },
      required: ["query"]
    },
    execute: async (input) => {
      try {
        const host = await getNetsuiteEnvironment();
        if (host === "unknown") {
          return {
            error:
              "No active NetSuite tab found. Make sure you are on a NetSuite page before using this tool."
          };
        }

        const baseUrl = `https://${host}`;
        const searchUrl = `${baseUrl}${NETSUITE_HELP_PATH}?search=${encodeURIComponent(String(input.query))}`;
        const html = await fetchHelpPage(searchUrl);
        const results = parseSearchResults(html, baseUrl);

        if (results.length === 0) {
          return { results: [], message: "No results found for the given query." };
        }

        return { results };
      } catch (err: any) {
        return { error: String(err?.message ?? err) };
      }
    }
  },

  {
    name: "read_netsuite_doc_page",
    description:
      "Read the full text content of a NetSuite documentation page. Pass a URL from 'search_netsuite_docs' results. Returns the main page text (up to 10 000 characters).",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "The full URL of the NetSuite help page to read (obtained from search_netsuite_docs results)."
        }
      },
      required: ["url"]
    },
    execute: async (input) => {
      try {
        const url = String(input.url);
        if (!url.includes("app.netsuite.com")) {
          return { error: "URL must point to an app.netsuite.com help page." };
        }

        const html = await fetchHelpPage(url);
        const content = parseDocPage(html);

        if (!content) {
          return { error: "Could not parse content from the page." };
        }

        return { url, content: content.slice(0, 10_000) };
      } catch (err: any) {
        return { error: String(err?.message ?? err) };
      }
    }
  }
];

/**
 * System-prompt block to inject into any agent that has access to the
 * NetSuite docs tools.  Import this constant and embed it in the agent's
 * system prompt so the docs-first rule is enforced consistently everywhere.
 */
export const NETSUITE_DOCS_SYSTEM_PROMPT = `## NetSuite Documentation — Mandatory Tool Use
You have two tools for accessing the official NetSuite documentation: \`search_netsuite_docs\` and \`read_netsuite_doc_page\`.

**When to use them:**
Use these tools when the user asks about **NetSuite product documentation** — how a feature works, what a field means, configuration steps, API behaviour, workflow rules, saved search capabilities, SuiteCommerce, SuiteTax, SuiteAnalytics, bundle management, permissions, roles, integrations, scripting reference, or any other general NetSuite topic.

**DO NOT use these tools for:**
- Locating records, scripts, files, or transactions in your NetSuite account — those are operational data queries. Use \`sql_execute_query\` (SuiteQL) or the appropriate \`netsuite_*\` tool instead.
- Looking up script deployment details, script IDs, script owners, or script status — use SuiteQL on the \`script\` or \`scriptdeployment\` tables.
- Any question that asks "find me X in my account" — that's a data query, not a documentation lookup.

**Do NOT answer NetSuite knowledge questions from your training data.** Your training data may be outdated or wrong. Always fetch the official docs first.

Workflow:
1. Call \`search_netsuite_docs\` with relevant keywords.
2. Call \`read_netsuite_doc_page\` for each relevant result (typically 1–3 pages).
3. Answer using only what the docs say.
4. **Always end the response with a References section** listing every doc page you read, as markdown links:

\`\`\`
**References:**
- [Page Title](https://...)
- [Page Title](https://...)
\`\`\`

The References section is mandatory whenever you used \`read_netsuite_doc_page\`. Never omit it.`;
