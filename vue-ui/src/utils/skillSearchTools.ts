// skillSearchTools.ts — AI agent tools for searching & loading skills from IndexedDB
import type { ToolDefinition } from "../composables/useAgent";
import {
  searchSkills,
  getSkillContent,
  getSkillCount
} from "./skillsDb";

/**
 * Two-step skill retrieval for the AI agent:
 *
 * 1. `search_skills` — Fuzzy search across skill names, descriptions, and tags.
 *    Returns lightweight metadata (id, name, description, tags) to keep context small.
 *
 * 2. `load_skill` — Fetch the full content of a specific skill by ID.
 *    Called only when the AI decides it actually needs a skill's content.
 *
 * This mirrors the pattern used for netsuite_get_scripts → netsuite_get_script_files.
 */
export const skillTools: ToolDefinition[] = [
  {
    name: "search_skills",
    description:
      "Search through available skills (knowledge, instructions, code patterns, documentation) stored in the local skill library. Returns an array of matching skills with id, name, description, and tags — but NOT the full content. Use 'load_skill' with the skill's id to retrieve its full content. Uses OR-based matching ranked by relevance. Returns an empty array if no skills match the query. Only use this tool when you need to generate, write, or modify code — NOT for viewing, reading, or exploring existing code.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search keyword(s) to match against skill names, descriptions, and tags. Terms are matched individually (OR logic) and results are ranked by relevance. Leave empty to list all skills."
        }
      },
      required: []
    },
    execute: async (input) => {
      const count = await getSkillCount();
      if (count === 0) {
        return {
          results: [],
          message: "No skills are available in the skill library. The user can add skills via the Skills management view."
        };
      }

      const query = String(input.query ?? "").trim();
      const results = await searchSkills(query);
      return {
        total: count,
        matched: results.length,
        results
      };
    }
  },

  {
    name: "load_skill",
    description:
      "Load the full content of a specific skill by its ID. Use this after 'search_skills' to retrieve the actual skill instructions, code patterns, or documentation. Only load skills you actually need to keep context efficient.",
    parameters: {
      type: "object",
      properties: {
        skillId: {
          type: "number",
          description:
            "The numeric ID of the skill to load (from search_skills results)."
        }
      },
      required: ["skillId"]
    },
    execute: async (input) => {
      const id = Number(input.skillId);
      if (isNaN(id)) {
        return { error: "Invalid skill ID — must be a number." };
      }

      const result = await getSkillContent(id);
      if (!result) {
        return { error: `Skill with ID ${id} not found.` };
      }

      return {
        name: result.name,
        content: result.content
      };
    }
  }
];
