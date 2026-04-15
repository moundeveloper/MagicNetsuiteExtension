// chainedTools.ts — Concrete chained tool definitions.
//
// Each step references a real registered tool by name. The chain executor in
// useAgent.ts looks that tool up in the registry and calls its execute()
// function directly, so every step fires the full hook lifecycle (onToolStart,
// onToolResult, approval gate) and appears in the UI exactly like a standalone
// tool call.

import type { ChainedToolDefinition } from "./chainedToolManager";

// ═════════════════════════════════════════════
// Chain: generate_suitelet
//
// Steps (all reference real registered tools):
//   1. netsuite_create_folder  — create a folder for the script
//   2. generate_suitelet_code  — load skills + produce the JS scaffold
//   3. netsuite_upload_file    — upload the generated file to the folder
// ═════════════════════════════════════════════

export const generateSuiteletChain: ChainedToolDefinition = {
  name: "generate_suitelet",

  description:
    "End-to-end Suitelet generation pipeline. In three sequential steps it:\n" +
    "  1. Creates a dedicated folder in the NetSuite File Cabinet\n" +
    "  2. Generates the SuiteScript 2.1 Suitelet source code (with skills)\n" +
    "  3. Uploads the generated file to the new folder\n\n" +
    "Use this tool whenever the user asks to create, generate, build, or scaffold " +
    "a new Suitelet. Do NOT call netsuite_create_folder, generate_suitelet_code, " +
    "and netsuite_upload_file separately — this pipeline handles the full workflow " +
    "in the correct order and threads data between steps automatically.\n\n" +
    "Returns a summary with folderId, fileId, fileName, scriptId, and the generated code.",

  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Human-readable name for the Suitelet (e.g. 'Customer Dashboard'). " +
          "Used to derive the folder name, file name, and script ID."
      },
      description: {
        type: "string",
        description:
          "What the Suitelet should do — purpose, data displayed, form fields, " +
          "actions performed, record types it interacts with."
      },
      parentFolderId: {
        type: "number",
        description:
          "Parent folder ID in the File Cabinet. Defaults to -15 (SuiteScripts root)."
      }
    },
    required: ["name", "description"]
  },

  destructive: true,

  intentPatterns: [
    /\b(create|generate|build|scaffold|make|write)\b.*\bsuitelet\b/i,
    /\bsuitelet\b.*\b(create|generate|build|scaffold|make|write)\b/i,
    /\bnew\s+suitelet\b/i
  ],

  steps: [
    // ── Step 1: Create folder in the File Cabinet ──────────────────────────
    {
      label: "Create folder in File Cabinet",
      toolName: "netsuite_create_folder",

      inputMapper: (userInput, _context) => {
        const rawName = String(userInput.name || "NewSuitelet");
        // Derive a clean folder name: "Customer Dashboard" → "CustomerDashboard"
        const folderName = rawName.replace(/[^a-zA-Z0-9]/g, "");
        const parentFolderId = (userInput.parentFolderId as number) ?? -15;

        return {
          name: folderName,
          parentFolderId
        };
      },

      outputMapper: (result, _context) => {
        // netsuite_create_folder returns { folderId } or { id } or the raw id
        const r = result as Record<string, unknown> | null;
        const folderId =
          r?.folderId ??
          r?.id ??
          (typeof result === "number" ? result : null);

        if (!folderId) {
          return {
            _error: `Step "Create folder" did not return a folder ID. Got: ${JSON.stringify(result)}`
          };
        }

        return { folderId };
      }
    },

    // ── Step 2: Generate Suitelet source code ──────────────────────────────
    {
      label: "Generate Suitelet source code",
      toolName: "generate_suitelet_code",

      inputMapper: (userInput, _context) => ({
        name: String(userInput.name || "NewSuitelet"),
        description: String(userInput.description || "")
      }),

      outputMapper: (result, _context) => {
        const r = result as Record<string, unknown>;
        return {
          generatedCode: r.generatedCode,
          fileName: r.fileName,
          scriptId: r.scriptId,
          skillsUsed: r.skillsUsed
        };
      }
    },

    // ── Step 3: Upload file to the created folder ──────────────────────────
    {
      label: "Upload file to File Cabinet",
      toolName: "netsuite_upload_file",

      inputMapper: (_userInput, context) => ({
        fileName: context.fileName as string,
        fileContent: context.generatedCode as string,
        folderId: context.folderId as number
      }),

      outputMapper: (result, _context) => {
        const r = result as { uploaded?: Array<{ fileId?: unknown; id?: unknown; name?: string }> ; errors?: unknown[] };
        const uploaded = r?.uploaded ?? [];
        const errors = r?.errors ?? [];

        if (errors.length > 0 || uploaded.length === 0) {
          return {
            _error: `Step "Upload file" failed. Errors: ${JSON.stringify(errors)}`
          };
        }

        const fileId = uploaded[0]?.fileId ?? uploaded[0]?.id ?? null;
        return { fileId };
      }
    }
  ]
};

// ─────────────────────────────────────────────
// Registry of all chained tools
// ─────────────────────────────────────────────

export const chainedTools: ChainedToolDefinition[] = [
  generateSuiteletChain
];
