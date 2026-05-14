// bundleTools.ts — AI agent tools for listing and inspecting NetSuite bundles
import type { ToolDefinition } from "../composables/useAgent";
import { getNetsuiteEnvironment } from "./api";

// ── Types ──────────────────────────────────────────────────────────────────

export type BundleFilter = "all" | "installed" | "created";

export interface Bundle {
  name: string;
  bundleId: string;
  version: string;
  appId: string;
  abstract: string;
  createdBy: string;
  createdOn: string;
  lastUpdate: string;
  /** "installed" = downloaded from SuiteApp marketplace (type=I);
   *  "created"   = built and published in-house (type=S) */
  type: "installed" | "created";
}

export interface BundleComponent {
  name: string;
  id: string;
  referencedBy: string;
  isLocked: boolean;
  category: string;
  subCategory: string;
}

// ── CSV helpers ────────────────────────────────────────────────────────────

/**
 * Parse a single CSV line, correctly handling quoted fields that may
 * contain commas or escaped double-quotes ("").
 */
export const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote inside a quoted field
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
};

const BUNDLE_FIELD_MAP: Record<string, Exclude<keyof Bundle, "type">> = {
  Name: "name",
  "Bundle ID": "bundleId",
  Version: "version",
  "App ID": "appId",
  Abstract: "abstract",
  "Created By": "createdBy",
  "Created On": "createdOn",
  "Last Update": "lastUpdate",
};

/**
 * Parse the bundle list CSV.
 * The first line is a description/title row (skipped); the second line is the header row.
 * @param bundleType - tag every parsed bundle with this type field
 */
export const parseBundleListCSV = (
  csv: string,
  bundleType: "installed" | "created"
): Bundle[] => {
  const lines = csv.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  lines.shift(); // Drop first line (title/description row)
  const headers = parseCSVLine(lines[0] ?? "");
  const bundles: Bundle[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i] ?? "");
    const obj: Partial<Bundle> = {};

    headers.forEach((header, idx) => {
      const key = BUNDLE_FIELD_MAP[header];
      if (key !== undefined) {
        obj[key] = values[idx] ?? "";
      }
    });

    if (obj.bundleId) {
      bundles.push({ ...(obj as Bundle), type: bundleType });
    }
  }

  return bundles;
};

/**
 * Parse the bundle components CSV.
 * Lines where only the first column has a value are category / subcategory markers.
 * Category: marker line followed by another marker line.
 * Subcategory: marker line followed by a data line.
 */
export const parseBundleComponentsCSV = (csv: string): BundleComponent[] => {
  const lines = csv.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  let currentCategory = "";
  let currentSubCategory = "";
  const components: BundleComponent[] = [];

  const isMarker = (line: string): boolean => {
    if (!line) return false;
    const cols = parseCSVLine(line);
    return Boolean(cols[0]) && !cols[1] && !cols[2] && !cols[3];
  };

  // Skip index 0 (header row)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const next = lines[i + 1] ?? "";

    if (isMarker(line)) {
      if (next && !isMarker(next)) {
        // Followed by a data line → this is a subcategory
        currentSubCategory = parseCSVLine(line)[0] ?? "";
      } else {
        // Followed by another marker (or end of data) → this is a main category
        currentCategory = parseCSVLine(line)[0] ?? "";
        currentSubCategory = "";
      }
      continue;
    }

    const [name, id, referencedBy, isLockedStr] = parseCSVLine(line);
    if (!name) continue;

    components.push({
      name,
      id: id ?? "",
      referencedBy: referencedBy ?? "",
      isLocked: Boolean(isLockedStr),
      category: currentCategory,
      subCategory: currentSubCategory,
    });
  }

  return components;
};

// ── Fetch helpers ──────────────────────────────────────────────────────────

/**
 * Derive the fetchcompid from the NetSuite domain.
 * e.g. "1234567-sb1.app.netsuite.com" → "1234567_sb1"
 */
const deriveFetchCompId = (domain: string): string => {
  const partBeforeDot = domain.split(".")[0] ?? "";
  return partBeforeDot.toLowerCase().replace(/-/g, "_");
};

const fetchCSV = async (url: string): Promise<string> => {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
};

export const fetchBundleList = async (
  domain: string,
  filter: BundleFilter = "all"
): Promise<Bundle[]> => {
  const fetchType = async (type: "I" | "S"): Promise<Bundle[]> => {
    const bundleType = type === "I" ? "installed" : "created";
    const url = `https://${domain}/app/bundler/bundlelist.csv?type=${type}&sortcol=bundlename&sortdir=ASC&csv=Export`;
    const csv = await fetchCSV(url);
    return parseBundleListCSV(csv, bundleType);
  };

  if (filter === "installed") return fetchType("I");
  if (filter === "created") return fetchType("S");
  // "all": fetch both in parallel and merge
  const [installed, created] = await Promise.all([fetchType("I"), fetchType("S")]);
  return [...installed, ...created];
};

export const fetchBundleComponents = async (
  domain: string,
  bundleId: string
): Promise<BundleComponent[]> => {
  const fetchCompId = deriveFetchCompId(domain);
  const url = `https://${domain}/app/bundler/bundlecontents.csv?csv=Export&OfficeXML=F&id=${bundleId}&fetchcompid=${fetchCompId}`;
  const csv = await fetchCSV(url);
  return parseBundleComponentsCSV(csv);
};

// ── Tool definitions ───────────────────────────────────────────────────────

export const bundleTools: ToolDefinition[] = [
  {
    name: "list_bundles",
    description:
      "List SuiteApp bundles in the current NetSuite account. Returns each bundle's name, ID, version, app ID, abstract, creator, dates, and a `type` field ('installed' or 'created'). Use the `filter` parameter to narrow results: 'installed' returns only marketplace/3rd-party bundles, 'created' returns only bundles built and published in-house, 'all' (default) returns both.",
    parameters: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["all", "installed", "created"],
          description:
            "'all' (default) – both installed and created bundles. 'installed' – only bundles downloaded from the SuiteApp marketplace (type=I). 'created' – only bundles built and published in-house (type=S).",
        },
      },
    },
    execute: async (input) => {
      try {
        const domain = await getNetsuiteEnvironment();
        if (domain === "unknown") {
          return {
            error:
              "No active NetSuite tab found. Make sure you are on a NetSuite page before using this tool.",
          };
        }

        const filter: BundleFilter = (input?.filter as BundleFilter) ?? "all";
        const bundles = await fetchBundleList(domain, filter);
        const installed = bundles.filter((b) => b.type === "installed").length;
        const created = bundles.filter((b) => b.type === "created").length;
        return { bundles, count: bundles.length, installed, created };
      } catch (err: any) {
        return { error: String(err?.message ?? err) };
      }
    },
  },

  {
    name: "get_bundle_components",
    description:
      "Get the detailed list of components installed by a specific bundle, identified by its Bundle ID. Returns all components grouped by category (e.g. 'Script Files', 'Custom Records') and subcategory (e.g. 'Server Side', 'Client Side'), with each component's name, script/record ID, references, and lock status.",
    parameters: {
      type: "object",
      properties: {
        bundleId: {
          type: "string",
          description:
            "The numeric Bundle ID to inspect (e.g. '123456'). Obtain this from list_bundles.",
        },
        bundleName: {
          type: "string",
          description: "Optional bundle name for context. Not required for the fetch.",
        },
      },
      required: ["bundleId"],
    },
    execute: async (input) => {
      try {
        const domain = await getNetsuiteEnvironment();
        if (domain === "unknown") {
          return {
            error:
              "No active NetSuite tab found. Make sure you are on a NetSuite page before using this tool.",
          };
        }

        const bundleId = String(input.bundleId);
        const components = await fetchBundleComponents(domain, bundleId);
        return { bundleId, components, count: components.length };
      } catch (err: any) {
        return { error: String(err?.message ?? err) };
      }
    },
  },
];

// ── System prompt ──────────────────────────────────────────────────────────

export const BUNDLE_TOOLS_SYSTEM_PROMPT = `## Bundle Research Tools
You have two tools for inspecting SuiteApp bundles in the current NetSuite account: \`list_bundles\` and \`get_bundle_components\`.

**Bundle types:**
- **installed** – bundles downloaded from the SuiteApp marketplace or installed from a third party (NetSuite internal type=I).
- **created** – bundles built and published in-house by the account's developers (NetSuite internal type=S).

**When to use \`list_bundles\`:**
- Use it when the user asks what bundles are installed, wants an overview of SuiteApps, or when you need to find a bundle ID before inspecting its contents.
- Use the \`filter\` parameter to scope results: \`"installed"\` for marketplace bundles, \`"created"\` for in-house bundles, \`"all"\` (default) for both.
- Each result includes a \`type\` field ("installed" or "created") so you can always tell them apart.

**When to use \`get_bundle_components\`:**
- Use it when the user wants to know what scripts, records, fields, or other objects a specific bundle installs.
- Always supply the numeric \`bundleId\` (from \`list_bundles\` if not already known).

**Presenting results:**
Bundle components are grouped by **category** (e.g. "Script Files", "Custom Records", "Custom Fields") and **subcategory** (e.g. "Server Side", "Client Side"). Present this hierarchical structure clearly in your response.`;
