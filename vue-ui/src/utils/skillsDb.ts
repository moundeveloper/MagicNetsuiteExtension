// skillsDb.ts — IndexedDB-backed skill storage using Dexie.js
import Dexie, { type EntityTable } from "dexie";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface Skill {
  id?: number;
  name: string;
  description: string;
  /** Comma-separated or space-separated tags for search */
  tags: string;
  /** The full skill content (instructions, code, docs, etc.) */
  content: string;
  /** Whether this skill is active and visible to the AI agent. Defaults to true. */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillSearchResult {
  id: number;
  name: string;
  description: string;
  tags: string;
}

// ─────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────

const db = new Dexie("MagicNetsuiteSkills") as Dexie & {
  skills: EntityTable<Skill, "id">;
};

db.version(1).stores({
  // id is auto-incremented, name/tags/description are indexed for search
  skills: "++id, name, tags, description"
});

db.version(2).stores({
  skills: "++id, name, tags, description, enabled"
}).upgrade((tx) => {
  return tx.table("skills").toCollection().modify((skill) => {
    if (skill.enabled === undefined) {
      skill.enabled = true;
    }
  });
});

// ─────────────────────────────────────────────
// CRUD operations
// ─────────────────────────────────────────────

export const addSkill = async (
  skill: Omit<Skill, "id" | "createdAt" | "updatedAt">
): Promise<number> => {
  const now = new Date().toISOString();
  const id = await db.skills.add({
    ...skill,
    enabled: skill.enabled ?? true,
    createdAt: now,
    updatedAt: now
  });
  return id as number;
};

export const updateSkill = async (
  id: number,
  updates: Partial<Omit<Skill, "id" | "createdAt">>
): Promise<void> => {
  await db.skills.update(id, {
    ...updates,
    updatedAt: new Date().toISOString()
  });
};

export const deleteSkill = async (id: number): Promise<void> => {
  await db.skills.delete(id);
};

export const getSkill = async (id: number): Promise<Skill | undefined> => {
  return db.skills.get(id);
};

export const getAllSkills = async (): Promise<Skill[]> => {
  return db.skills.toArray();
};

export const getSkillCount = async (): Promise<number> => {
  return db.skills.filter((s) => s.enabled !== false).count();
};

// ─────────────────────────────────────────────
// Search — returns metadata only, NOT the full content
// ─────────────────────────────────────────────

export const searchSkills = async (
  query: string
): Promise<SkillSearchResult[]> => {
  const term = query.toLowerCase().trim();

  const all = await db.skills.filter((s) => s.enabled !== false).toArray();

  if (!term) {
    // Return all skills (metadata only)
    return all.map(({ id, name, description, tags }) => ({
      id: id!,
      name,
      description,
      tags
    }));
  }

  const terms = term.split(/\s+/);

  // Score each skill: +2 for each matching term, +1 for partial substring match
  const scored = all
    .map((skill) => {
      const haystack =
        `${skill.name} ${skill.description} ${skill.tags}`.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (haystack.includes(t)) {
          score += 2;
        }
      }
      return { skill, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  // If specific query matched some skills, return them ranked by relevance
  if (scored.length > 0) {
    return scored.map(({ skill: { id, name, description, tags } }) => ({
      id: id!,
      name,
      description,
      tags
    }));
  }

  // No matches — return empty array so the agent knows nothing is relevant
  // and proceeds without loading skills. Returning all skills as a fallback
  // caused the agent to load irrelevant skills for unrelated tasks.
  return [];
};

/**
 * Retrieve the full content of a skill by ID.
 * This is the only way the AI can access skill content — by explicitly
 * requesting it after a search, keeping context lean.
 */
export const getSkillContent = async (
  id: number
): Promise<{ name: string; content: string } | null> => {
  const skill = await db.skills.get(id);
  if (!skill) return null;
  return { name: skill.name, content: skill.content };
};

// ─────────────────────────────────────────────
// Bulk import / export for file uploads
// ─────────────────────────────────────────────

export interface SkillExport {
  name: string;
  description: string;
  tags: string;
  content: string;
}

export const importSkills = async (
  skills: SkillExport[]
): Promise<number> => {
  const now = new Date().toISOString();
  const records = skills.map((s) => ({
    name: s.name,
    description: s.description,
    tags: s.tags,
    content: s.content,
    enabled: true,
    createdAt: now,
    updatedAt: now
  }));
  const lastKey = await db.skills.bulkAdd(records);
  return skills.length;
};

export const exportAllSkills = async (): Promise<SkillExport[]> => {
  const all = await db.skills.toArray();
  return all.map(({ name, description, tags, content }) => ({
    name,
    description,
    tags,
    content
  }));
};

export { db };
