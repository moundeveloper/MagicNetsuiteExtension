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
// Chain: generate_script_deployment
//
// Steps:
//   1. (tool) netsuite_create_folder  — create a folder for the script
//   2. (ai)   search_skills + load_skill + chatCompletion → script code
//   3. (tool) netsuite_upload_file    — upload the generated file to the folder
//   4. (tool) netsuite_create_script  — create the NetSuite Script record
// ═════════════════════════════════════════════

export const generateSuitescriptChain: ChainedToolDefinition = {
  name: "generate_script_deployment",

  description:
    "End-to-end script generation + deployment pipeline. In four sequential steps it:\n" +
    "  1. Creates a dedicated folder in the NetSuite File Cabinet\n" +
    "  2. Searches skills, loads the relevant SuiteScript skill, and generates\n" +
    "     the SuiteScript 2.1 source code guided by those skills\n" +
    "  3. Uploads the generated file to the new folder\n" +
    "  4. Creates the NetSuite Script record and deploys it\n\n" +
    "Use this tool whenever the user asks to create, generate, build, or scaffold " +
    "ANY NetSuite script AND want it deployed in NetSuite.\n" +
    "Do NOT call netsuite_create_folder, search_skills, load_skill, " +
    "netsuite_upload_file, or netsuite_create_script separately.\n\n" +
    "If the user ONLY wants code (for manual upload/deployment), do NOT use this tool.\n\n" +
    "Returns a summary with folderId, fileId, fileName, scriptId, scriptType, scriptRecordId, and the generated code.",

  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Human-readable name for the script (e.g. 'Customer Dashboard'). " +
          "Used to derive the folder name, file name, and script ID."
      },
      description: {
        type: "string",
        description:
          "What the script should do — type (Suitelet, RESTlet, User Event, Scheduled, etc.), " +
          "purpose, data displayed, form fields, actions performed, record types it interacts with."
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
    /\b(create|generate|build|scaffold|make|write)\b.*\b(suitelet|restlet|user.?event|scheduled|portlet|sessionmanager|workflowaction|csvimport|cmapimapping)\b/i,
    /\b(suitelet|restlet|user.?event|scheduled|portlet)\b.*\b(create|generate|build|scaffold|make|write)\b/i,
    /\bnew\s+(suitelet|restlet|user.?event|scheduled|portlet)\b/i,
    /\b(suitelet|restlet|user.?event|scheduled|portlet)\b\s+script\b/i
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
      toolName: "generate_suitescript_code",

      // Only skill tools are exposed to this mini loop
      allowedTools: ["search_skills", "load_skill"],

      systemPrompt:
        "You are a SuiteScript 2.1 expert. Your task is to generate a complete, " +
        "production-ready NetSuite script of the type requested by the user. You MUST:\n" +
        "1. Detect the script type from the user's request and output its NetSuite system name:\n" +
        "   - Suitelet / form-based script → scriptType 'SCRIPTLET'\n" +
        "   - REST API endpoint → scriptType 'RESTLET'\n" +
        "   - SSP Application → scriptType 'WEBAPP'\n" +
        "   - Record-level script (beforeLoad/afterSubmit) → scriptType 'USEREVENT'\n" +
        "   - Scheduled/batch script → scriptType 'SCHEDULED'\n" +
        "   - Dashboard portlet → scriptType 'PORTLET'\n" +
        "2. Call search_skills with relevant keywords (e.g. 'suitelet suitescript', 'userevent suitescript')\n" +
        "3. Call load_skill for every relevant skill returned\n" +
        "4. Apply the skill rules strictly — they override your defaults\n" +
        "5. Generate the code matching the detected script type (correct @NScriptType annotation, entry points, etc.)\n\n" +
        "Code requirements (enforced by skills):\n" +
        "- @NApiVersion 2.1\n" +
        "- Use const/let, never var\n" +
        "- Proper define() module pattern\n" +
        "- Include @NScriptType annotation matching the detected type\n" +
        "- Include JSDoc comments\n" +
        "- Handle errors with try/catch\n\n" +
        "After generating the code, respond with a JSON object on a SEPARATE line in this exact format:\n" +
        '{"fileName":"<camelCase>.js","scriptId":"customscript_<snake_case>","scriptType":"<system name from step 1>","generatedCode":"<full code here>"}',

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
          `Generate a SuiteScript 2.1 NetSuite script with the following specification:\n\n` +
          `Name: ${name}\n` +
          `Description: ${description}\n` +
          `File name to use: ${camelName}.js\n` +
          `Script ID to use: customscript_${snakeName}\n` +
          `Target folder ID: ${folderId ?? "unknown"}\n\n` +
          `Detect the script type from the description above (Suitelet, User Event, RESTlet, Scheduled, etc.), ` +
          `search and load relevant skills, then generate the complete script code. ` +
          `End your response with the JSON metadata object as described in your instructions.`
        );
      },

      outputMapper: (aiResult, _context) => {
        const content = aiResult.assistantContent;

        const jsonMatch = content.match(/\{[^{}]*"fileName"[^{}]*"scriptId"[^{}]*"scriptType"[^{}]*"generatedCode"[^{}]*\}/s);

        if (jsonMatch) {
          try {
            const meta = JSON.parse(jsonMatch[0]) as {
              fileName?: string;
              scriptId?: string;
              scriptType?: string;
              generatedCode?: string;
            };

            if (meta.fileName && meta.generatedCode) {
              return {
                fileName: meta.fileName,
                scriptId: meta.scriptId ?? "",
                scriptType: meta.scriptType ?? "SCRIPTLET",
                generatedCode: meta.generatedCode,
                skillsUsed: Object.keys(aiResult.toolResults)
              };
            }
          } catch {
            // Fall through to fallback
          }
        }

        // Fallback: extract code block from the response
        const codeMatch = content.match(/```(?:javascript|js)?\n([\s\S]*?)```/);
        const rawName = String(_context.name ?? "NewScript");
        const camelName = rawName
          .replace(/[^a-zA-Z0-9 ]/g, "")
          .replace(/\s+(.)/g, (_, c: string) => c.toUpperCase())
          .replace(/^(.)/, (_, c: string) => c.toLowerCase());

        return {
          fileName: `${camelName}.js`,
          scriptId: `customscript_${camelName.toLowerCase()}`,
          scriptType: "SCRIPTLET",
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
    },

    // ── Step 4: Resolve correct scriptType and create the Script record ───────
    // type: 'ai' so the mini loop can call netsuite_get_script_types first to get
    // the live system names from NetSuite, then call netsuite_create_script with
    // the correct value — no static mapping, always up to date.
    {
      type: "ai",
      label: "Create NetSuite Script record",
      toolName: "netsuite_create_script",

      allowedTools: ["netsuite_get_script_types", "netsuite_create_script"],

      systemPrompt:
        "You are a NetSuite automation assistant. Your ONLY task is to create a Script record. " +
        "You MUST:\n" +
        "1. Call netsuite_get_script_types to get the full list of available types\n" +
        "2. Find the entry whose 'label' matches the requested script type " +
        "(e.g. the user wants a Suitelet → find label='SCRIPTLET', " +
        "User Event → label='USEREVENT', RESTlet → label='RESTLET', etc.)\n" +
        "3. Call netsuite_create_script using that exact 'label' value as scriptType\n" +
        "Do not generate any code. Do not explain. Just call the two tools and report the result.",

      promptBuilder: (userInput, context) => (
        `Create a NetSuite Script record with these details:\n` +
        `name: ${String(userInput.name || "NewScript")}\n` +
        `scriptId: ${String(context.scriptId)}\n` +
        `fileId: ${String(context.fileId)}\n` +
        `requestedScriptType: ${String(context.scriptType)} (this is a hint — verify the correct system name via netsuite_get_script_types)\n` +
        `description: ${String(userInput.description || "")}\n` +
        `apiVersion: 2.1`
      ),

      outputMapper: (aiResult, _context) => {
        // netsuite_create_script result is in toolResults
        const createResult = Object.values(aiResult.toolResults).find(
          (r) => r && typeof r === "object" && "scriptRecordId" in r
        ) as { scriptRecordId?: string | null; scriptUrl?: string | null } | undefined;

        if (!createResult?.scriptRecordId) {
          console.warn("[generateSuitescriptChain] Step 4: could not extract scriptRecordId:", aiResult.toolResults);
          return {
            scriptRecordId: null,
            scriptUrl: createResult?.scriptUrl ?? null
          };
        }

        return {
          scriptRecordId: createResult.scriptRecordId,
          scriptUrl: createResult.scriptUrl ?? null
        };
      }
    }
  ]
};

// ─────────────────────────────────────────────
// Registry of all chained tools
// ─────────────────────────────────────────────

export const chainedTools: ChainedToolDefinition[] = [
  generateSuitescriptChain
];
