// skillsDb.ts — IndexedDB-backed skill storage using Dexie.js
import Dexie, { type EntityTable } from "dexie";

export type SkillStatus = "active" | "deprecated" | "draft";
export type SkillSource = "manual" | "ai_saved" | "imported" | "built_in";
export type SkillConfidence = "low" | "medium" | "high";
export type SkillMatchType = "trigger" | "metadata" | "content";

export interface SkillConversationSource {
  threadId?: string;
  turnId?: string;
  userPrompt: string;
  assistantResponse: string;
  savedAt: string;
}

export interface Skill {
  id?: number;
  name: string;
  description: string;
  /** Comma-separated or space-separated display/search tags. */
  tags: string;
  /** Newline-separated phrases used only by the router. */
  triggers: string;
  content: string;
  enabled: boolean;
  domain?: "global" | "sql";
  status: SkillStatus;
  priority: number;
  source: SkillSource;
  supersedes: number[];
  /** Ordered IDs of reusable sub-skills loaded with this skill. */
  dependencies: number[];
  lastReviewedAt?: string;
  confidence?: SkillConfidence;
  sourceConversation?: SkillConversationSource;
  createdAt: string;
  updatedAt: string;
}

export interface SkillSearchResult {
  id: number;
  name: string;
  description: string;
  tags: string;
  triggers: string;
  status: SkillStatus;
  priority: number;
  source: SkillSource;
  lastReviewedAt?: string;
  confidence?: SkillConfidence;
  dependencies: number[];
  score: number;
  matchType: SkillMatchType;
}

export interface SkillSearchOptions {
  /** Auto-routing only considers reviewed, active skills. */
  routing?: boolean;
  includeDeprecated?: boolean;
}

export const SKILL_AUTO_ROUTE_THRESHOLD = 70;
export const SKILL_MULTI_MATCH_DELTA = 18;

const db = new Dexie("MagicNetsuiteSkills") as Dexie & {
  skills: EntityTable<Skill, "id">;
};

db.version(1).stores({ skills: "++id, name, tags, description" });
db.version(2).stores({ skills: "++id, name, tags, description, enabled" }).upgrade((tx) =>
  tx.table("skills").toCollection().modify((skill) => {
    if (skill.enabled === undefined) skill.enabled = true;
  })
);
db.version(3).stores({ skills: "++id, name, tags, description, enabled, domain" }).upgrade((tx) =>
  tx.table("skills").toCollection().modify((skill) => {
    if (skill.domain === undefined) skill.domain = "global";
  })
);
db.version(4).stores({
  skills: "++id, name, tags, description, enabled, domain, status, priority, source, lastReviewedAt"
}).upgrade((tx) =>
  tx.table("skills").toCollection().modify((skill) => {
    skill.triggers ??= "";
    skill.status ??= "active";
    skill.priority ??= 50;
    skill.source ??= "manual";
    skill.supersedes ??= [];
    skill.lastReviewedAt ??= skill.updatedAt ?? skill.createdAt;
  })
);

const withDefaults = <T extends Partial<Skill>>(skill: T): T & Pick<Skill,
  "triggers" | "status" | "priority" | "source" | "supersedes" | "dependencies"
> => ({
  ...skill,
  triggers: skill.triggers ?? "",
  status: skill.status ?? "active",
  priority: Math.min(100, Math.max(0, Number(skill.priority ?? 50))),
  source: skill.source ?? "manual",
  supersedes: Array.isArray(skill.supersedes) ? skill.supersedes : [],
  dependencies: Array.isArray(skill.dependencies)
    ? [...new Set(skill.dependencies.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : []
});

export type NewSkill = Omit<
  Skill,
  "id" | "createdAt" | "updatedAt" | "triggers" | "status" | "priority" | "source" | "supersedes" | "dependencies"
> & Partial<Pick<Skill, "triggers" | "status" | "priority" | "source" | "supersedes" | "dependencies">>;

export const addSkill = async (
  skill: NewSkill
): Promise<number> => {
  const now = new Date().toISOString();
  return await db.skills.add({
    ...withDefaults(skill),
    enabled: skill.enabled ?? true,
    createdAt: now,
    updatedAt: now
  }) as number;
};

export const updateSkill = async (
  id: number,
  updates: Partial<Omit<Skill, "id" | "createdAt">>
): Promise<void> => {
  const normalized = { ...updates };
  if (updates.priority !== undefined) normalized.priority = Math.min(100, Math.max(0, Number(updates.priority)));
  if (updates.supersedes !== undefined) normalized.supersedes = Array.isArray(updates.supersedes) ? updates.supersedes : [];
  if (updates.dependencies !== undefined) {
    normalized.dependencies = [
      ...new Set(
        updates.dependencies
          .map(Number)
          .filter((dependencyId) => Number.isInteger(dependencyId) && dependencyId > 0 && dependencyId !== id)
      )
    ];
    const all = await db.skills.toArray();
    const dependencyMap = new Map(
      all.map((skill) => [
        skill.id!,
        skill.id === id
          ? normalized.dependencies!
          : (skill.dependencies ?? [])
      ])
    );
    const visiting = new Set<number>();
    const visited = new Set<number>();
    const hasCycle = (skillId: number): boolean => {
      if (visiting.has(skillId)) return true;
      if (visited.has(skillId)) return false;
      visiting.add(skillId);
      for (const dependencyId of dependencyMap.get(skillId) ?? []) {
        if (dependencyMap.has(dependencyId) && hasCycle(dependencyId)) return true;
      }
      visiting.delete(skillId);
      visited.add(skillId);
      return false;
    };
    if (hasCycle(id)) {
      throw new Error("Skill dependencies cannot contain a cycle.");
    }
  }
  await db.skills.update(id, { ...normalized, updatedAt: new Date().toISOString() });
};

export const deleteSkill = async (id: number): Promise<void> => {
  await db.transaction("rw", db.skills, async () => {
    await db.skills.delete(id);
    await db.skills
      .filter((skill) => (skill.dependencies ?? []).includes(id))
      .modify((skill) => {
        skill.dependencies = (skill.dependencies ?? []).filter(
          (dependencyId) => dependencyId !== id
        );
      });
  });
};
export const getSkill = async (id: number): Promise<Skill | undefined> => db.skills.get(id);
export const getAllSkills = async (): Promise<Skill[]> => db.skills.toArray();
export const getSkillsByDomain = async (domain: "global" | "sql"): Promise<Skill[]> =>
  db.skills.filter((s) => s.enabled !== false && (s.domain ?? "global") === domain && (s.status ?? "active") === "active").toArray();
export const getSkillCount = async (): Promise<number> =>
  db.skills.filter((s) => s.enabled !== false && (s.status ?? "active") !== "deprecated").count();

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const phrases = (value: string): string[] => value.split(/[\n,]+/).map(normalize).filter(Boolean);

const scoreSkill = (skill: Skill, query: string): { score: number; matchType: SkillMatchType } => {
  const normalizedQuery = normalize(query);
  const terms = normalizedQuery.split(/\s+/).filter((term) => term.length > 1);
  const triggerPhrases = phrases(skill.triggers ?? "");
  let triggerScore = 0;
  for (const trigger of triggerPhrases) {
    if (normalizedQuery.includes(trigger)) {
      triggerScore = Math.max(triggerScore, 110 + Math.min(trigger.split(" ").length * 8, 40));
      continue;
    }
    const triggerTerms = trigger.split(" ");
    const matched = triggerTerms.filter((term) => normalizedQuery.includes(term)).length;
    if (matched >= 2 && matched / triggerTerms.length >= 0.6) {
      triggerScore = Math.max(triggerScore, 55 + Math.round((matched / triggerTerms.length) * 35));
    }
  }

  const metadata = normalize(`${skill.name} ${skill.description} ${skill.tags}`);
  const content = normalize(skill.content);
  const metadataMatches = terms.filter((term) => metadata.includes(term)).length;
  const contentMatches = terms.filter((term) => content.includes(term)).length;
  const nameExact = normalizedQuery.includes(normalize(skill.name)) ? 45 : 0;
  const metadataScore = nameExact + metadataMatches * 12;
  // Content is useful for ranking but never strong enough by itself to
  // auto-route; explicit triggers and specific metadata must win preflight.
  const contentScore = Math.min(contentMatches * 3, 45);

  if (triggerScore > 0) return { score: triggerScore + Math.min(metadataScore, 20), matchType: "trigger" };
  if (metadataScore > 0) return { score: metadataScore + Math.min(contentScore, 10), matchType: "metadata" };
  return { score: contentScore, matchType: "content" };
};

const reviewedTime = (skill: Skill): number =>
  Date.parse(skill.lastReviewedAt ?? skill.updatedAt ?? skill.createdAt ?? "") || 0;

/** Ranked metadata search. Trigger specificity dominates priority and recency. */
export const searchSkills = async (
  query: string,
  options: SkillSearchOptions = {}
): Promise<SkillSearchResult[]> => {
  const term = normalize(query);
  let all = await db.skills.filter((skill) => skill.enabled !== false).toArray();

  all = all.filter((skill) => {
    const status = skill.status ?? "active";
    if (options.routing) return status === "active";
    if (status !== "deprecated" || options.includeDeprecated) return true;
    return term.includes(normalize(skill.name)) || /\bdeprecated\b/.test(term);
  });

  // Active skills suppress anything they explicitly supersede.
  const supersededIds = new Set(
    all.filter((skill) => (skill.status ?? "active") === "active")
      .flatMap((skill) => skill.supersedes ?? [])
  );
  all = all.filter((skill) => !skill.id || !supersededIds.has(skill.id));

  const ranked = all.map((skill) => ({ skill, ...(term ? scoreSkill(skill, term) : { score: 1, matchType: "metadata" as const }) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      (b.skill.priority ?? 50) - (a.skill.priority ?? 50) ||
      reviewedTime(b.skill) - reviewedTime(a.skill)
    );

  return ranked.map(({ skill, score, matchType }) => ({
    id: skill.id!, name: skill.name, description: skill.description, tags: skill.tags,
    triggers: skill.triggers ?? "", status: skill.status ?? "active",
    priority: skill.priority ?? 50, source: skill.source ?? "manual",
    lastReviewedAt: skill.lastReviewedAt, confidence: skill.confidence,
    dependencies: skill.dependencies ?? [], score, matchType
  }));
};

export const getSkillContent = async (
  id: number,
  options: { includeDeprecated?: boolean } = {}
): Promise<{
  name: string;
  content: string;
  dependencies: Array<{ id: number; name: string }>;
} | null> => {
  const skill = await db.skills.get(id);
  if (
    !skill ||
    skill.enabled === false ||
    ((skill.status ?? "active") === "deprecated" && !options.includeDeprecated)
  ) return null;
  const all = await db.skills.toArray();
  const byId = new Map(all.filter((item) => item.id).map((item) => [item.id!, item]));
  const loaded = new Set<number>([id]);
  const dependencyMetadata: Array<{ id: number; name: string }> = [];
  const sections: string[] = [skill.content];
  const appendDependencies = (parent: Skill, depth: number) => {
    if (depth > 8) return;
    for (const dependencyId of parent.dependencies ?? []) {
      if (loaded.has(dependencyId)) continue;
      const dependency = byId.get(dependencyId);
      if (
        !dependency ||
        dependency.enabled === false ||
        (dependency.status ?? "active") === "deprecated"
      ) continue;
      loaded.add(dependencyId);
      dependencyMetadata.push({ id: dependencyId, name: dependency.name });
      sections.push(
        `\n\n---\n\n## Sub-skill: ${dependency.name}\n\n${dependency.content}`
      );
      appendDependencies(dependency, depth + 1);
    }
  };
  appendDependencies(skill, 1);
  return {
    name: skill.name,
    content: sections.join(""),
    dependencies: dependencyMetadata
  };
};

export interface SkillExport {
  name: string;
  description: string;
  tags: string;
  triggers?: string;
  content: string;
  domain?: "global" | "sql";
  status?: SkillStatus;
  priority?: number;
  source?: SkillSource;
  supersedes?: number[];
  dependencies?: number[];
  lastReviewedAt?: string;
  confidence?: SkillConfidence;
  sourceConversation?: SkillConversationSource;
}

export const importSkills = async (skills: SkillExport[]): Promise<number> => {
  const now = new Date().toISOString();
  await db.skills.bulkAdd(skills.map((skill) => ({
    ...withDefaults({ ...skill, source: skill.source ?? "imported" }),
    enabled: true, domain: skill.domain ?? "global", createdAt: now, updatedAt: now
  })) as Skill[]);
  return skills.length;
};

export const exportAllSkills = async (): Promise<SkillExport[]> =>
  (await db.skills.toArray()).map(({ id: _id, enabled: _enabled, createdAt: _createdAt, updatedAt: _updatedAt, ...skill }) => skill);

export { db };
