// skillSearchTools.ts — AI agent tools for searching & loading skills from IndexedDB
import type { ToolDefinition } from "../composables/useAgent";
import {
  searchSkills,
  getSkillContent,
  getSkillCount,
  type SkillSearchResult
} from "./skillsDb";
import { DIAGRAM_DOCS } from "./diagramDocs";

const BUILTIN_DIAGRAM_SKILL_ID = -1001;

const builtinSkills: Array<SkillSearchResult & { content: string }> = [
  {
    id: BUILTIN_DIAGRAM_SKILL_ID,
    name: "Diagram DSL",
    description:
      "Instructions for rendering flowcharts and sequence diagrams in chat with ```diagram fences.",
    tags:
      "diagram diagrams flowchart flowcharts sequence visual workflow process architecture chart",
    triggers: "draw a diagram\ncreate a flowchart\nsequence diagram\nvisualize the workflow",
    status: "active",
    priority: 50,
    source: "built_in",
    score: 0,
    matchType: "metadata",
    content: DIAGRAM_DOCS
  }
];

const stripSkillContent = ({
  id,
  name,
  description,
  tags,
  triggers,
  status,
  priority,
  source,
  lastReviewedAt,
  confidence,
  score,
  matchType
}: SkillSearchResult & { content?: string }): SkillSearchResult => ({
  id,
  name,
  description,
  tags,
  triggers,
  status,
  priority,
  source,
  lastReviewedAt,
  confidence,
  score,
  matchType
});

const searchBuiltinSkills = (query: string): SkillSearchResult[] => {
  const term = query.toLowerCase().trim();
  if (!term) return builtinSkills.map(stripSkillContent);

  const terms = term.split(/\s+/).filter(Boolean);
  return builtinSkills
    .map((skill) => {
      const trigger = skill.triggers.toLowerCase();
      const haystack = `${skill.name} ${skill.description} ${skill.tags}`.toLowerCase();
      const triggerScore = trigger.split("\n").some((phrase) => phrase && term.includes(phrase)) ? 120 : 0;
      const metadataScore = terms.reduce(
        (sum, t) => sum + (haystack.includes(t) ? 2 : 0),
        0
      );
      const score = triggerScore || metadataScore;
      return { skill: { ...skill, score, matchType: triggerScore ? "trigger" as const : "metadata" as const }, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ skill }) => stripSkillContent(skill));
};

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
      "Search local skills before external sources. Trigger phrases are weighted above metadata and content. Results include trust/status, priority, review date, score, and match type but not full content. Deprecated skills are ignored unless explicitly requested. Use load_skill for the selected skill.",
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
      const query = String(input.query ?? "").trim();
      const count = await getSkillCount();
      const builtins = searchBuiltinSkills(query);
      const storedResults = await searchSkills(query);
      const results = [
        ...builtins,
        ...storedResults.filter(
          (result) => !builtins.some((builtin) => builtin.id === result.id)
        )
      ].sort((a, b) =>
        b.score - a.score ||
        b.priority - a.priority ||
        (Date.parse(b.lastReviewedAt ?? "") || 0) - (Date.parse(a.lastReviewedAt ?? "") || 0)
      );

      return {
        total: count + builtinSkills.length,
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
        },
        includeDeprecated: {
          type: "boolean",
          description:
            "Set true only when the user explicitly asked for this deprecated skill."
        }
      },
      required: ["skillId"]
    },
    execute: async (input) => {
      const id = Number(input.skillId);
      if (isNaN(id)) {
        return { error: "Invalid skill ID — must be a number." };
      }

      const builtin = builtinSkills.find((skill) => skill.id === id);
      if (builtin) {
        return {
          name: builtin.name,
          content: builtin.content
        };
      }

      const result = await getSkillContent(id, {
        includeDeprecated: input.includeDeprecated === true
      });
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
