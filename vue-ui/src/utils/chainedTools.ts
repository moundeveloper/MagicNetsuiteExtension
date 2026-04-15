// chainedTools.ts — Concrete chained tool definitions.
//
// Each step is either:
//   type: 'tool' — delegates to a real registered tool in the registry
//   type: 'ai'   — runs a mini agent loop with a curated set of tools, then
//                  feeds the final assistant content + tool results back into
//                  the chain context for subsequent steps.
//
// This lets the pipeline mix deterministic tool calls (folder creation, file
// upload) with AI-driven steps that need multiple tool interactions of their
// own (skill search + code generation).

import type { ChainedToolDefinition } from "./chainedToolManager";

// ═════════════════════════════════════════════
// Chain: generate_suitelet
//
// Steps:
//   1. (tool) netsuite_create_folder  — create a folder for the script
//   2. (ai)   search_skills + load_skill + chatCompletion → Suitelet code
//   3. (tool) netsuite_upload_file    — upload the generated file to the folder
// ═════════════════════════════════════════════

export const generateSuiteletChain: ChainedToolDefinition = {
  name: "generate_suitelet",

  description:
    "End-to-end Suitelet generation pipeline. In three sequential steps it:\n" +
    "  1. Creates a dedicated folder in the NetSuite File Cabinet\n" +
    "  2. Searches skills, loads the relevant SuiteScript skill, and generates\n" +
    "     the SuiteScript 2.1 Suitelet source code guided by those skills\n" +
    "  3. Uploads the generated file to the new folder\n\n" +
    "Use this tool whenever the user asks to create, generate, build, or scaffold " +
    "a new Suitelet. Do NOT call netsuite_create_folder, search_skills, load_skill, " +
    "or netsuite_upload_file separately — this pipeline handles the full workflow " +
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
      type: "tool",
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

    // ── Step 2: AI-driven code generation (search skills → load → generate) ─
    {
      type: "ai",
      label: "Generate Suitelet source code",

      // Virtual tool name for UI tracking — not in registry, just for display
      toolName: "generate_suitelet_code",

      // Only skill tools are exposed to this mini loop
      allowedTools: ["search_skills", "load_skill"],

      systemPrompt:
        "You are a SuiteScript 2.1 expert. Your task is to generate a complete, " +
        "production-ready Suitelet script. You MUST:\n" +
        "1. Call search_skills with relevant keywords (e.g. 'suitelet suitescript')\n" +
        "2. Call load_skill for every relevant skill returned\n" +
        "3. Apply the skill rules strictly — they override your defaults\n" +
        "4. Then output ONLY the final generated JavaScript code as a plain code block\n\n" +
        "Code requirements (enforced by skills):\n" +
        "- @NApiVersion 2.1\n" +
        "- Use const/let, never var\n" +
        "- Proper define() module pattern\n" +
        "- Include JSDoc comments\n" +
        "- Handle errors with try/catch\n\n" +
        "After generating the code, respond with a JSON object on a SEPARATE line in this exact format:\n" +
        '{"fileName":"<camelCase>.js","scriptId":"customscript_<snake_case>","generatedCode":"<full code here>"}',

      promptBuilder: (userInput, context) => {
        const name = String(userInput.name || "NewSuitelet");
        const description = String(userInput.description || "");
        const folderId = context.folderId;

        // Derive file and script naming
        const camelName = name
          .replace(/[^a-zA-Z0-9 ]/g, "")
          .replace(/\s+(.)/g, (_, c: string) => c.toUpperCase())
          .replace(/^(.)/, (_, c: string) => c.toLowerCase());
        const snakeName = name
          .replace(/[^a-zA-Z0-9 ]/g, "")
          .toLowerCase()
          .replace(/\s+/g, "_");

        return (
          `Generate a SuiteScript 2.1 Suitelet with the following specification:\n\n` +
          `Name: ${name}\n` +
          `Description: ${description}\n` +
          `File name to use: ${camelName}.js\n` +
          `Script ID to use: customscript_${snakeName}\n` +
          `Target folder ID: ${folderId ?? "unknown"}\n\n` +
          `First search and load relevant skills, then generate the complete Suitelet code. ` +
          `End your response with the JSON metadata object as described in your instructions.`
        );
      },

      outputMapper: (aiResult, _context) => {
        // Try to extract the JSON metadata line from the assistant's response
        const content = aiResult.assistantContent;

        // Look for a JSON object at the end of the response
        const jsonMatch = content.match(/\{[^{}]*"fileName"[^{}]*"scriptId"[^{}]*"generatedCode"[^{}]*\}/s);

        if (jsonMatch) {
          try {
            const meta = JSON.parse(jsonMatch[0]) as {
              fileName?: string;
              scriptId?: string;
              generatedCode?: string;
            };

            if (meta.fileName && meta.generatedCode) {
              return {
                fileName: meta.fileName,
                scriptId: meta.scriptId ?? "",
                generatedCode: meta.generatedCode,
                skillsUsed: Object.keys(aiResult.toolResults)
              };
            }
          } catch {
            // Fall through to extraction from content
          }
        }

        // Fallback: extract code block from the response
        const codeMatch = content.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
        const rawName = String(_context.fileName ?? "newSuitelet");
        const camelName = rawName
          .replace(/[^a-zA-Z0-9 ]/g, "")
          .replace(/\s+(.)/g, (_, c: string) => c.toUpperCase())
          .replace(/^(.)/, (_, c: string) => c.toLowerCase());

        return {
          fileName: `${camelName}.js`,
          scriptId: `customscript_${camelName.toLowerCase()}`,
          generatedCode: codeMatch ? codeMatch[1]!.trim() : content,
          skillsUsed: Object.keys(aiResult.toolResults)
        };
      }
    },

    // ── Step 3: Upload file to the created folder ──────────────────────────
    {
      type: "tool",
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
