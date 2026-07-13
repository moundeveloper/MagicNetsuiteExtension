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
  "triggers" | "status" | "priority" | "source" | "supersedes"
> => ({
  ...skill,
  triggers: skill.triggers ?? "",
  status: skill.status ?? "active",
  priority: Math.min(100, Math.max(0, Number(skill.priority ?? 50))),
  source: skill.source ?? "manual",
  supersedes: Array.isArray(skill.supersedes) ? skill.supersedes : []
});

export type NewSkill = Omit<
  Skill,
  "id" | "createdAt" | "updatedAt" | "triggers" | "status" | "priority" | "source" | "supersedes"
> & Partial<Pick<Skill, "triggers" | "status" | "priority" | "source" | "supersedes">>;

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
  await db.skills.update(id, { ...normalized, updatedAt: new Date().toISOString() });
};

export const deleteSkill = async (id: number): Promise<void> => { await db.skills.delete(id); };
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
    lastReviewedAt: skill.lastReviewedAt, confidence: skill.confidence, score, matchType
  }));
};

export const getSkillContent = async (
  id: number,
  options: { includeDeprecated?: boolean } = {}
): Promise<{ name: string; content: string } | null> => {
  const skill = await db.skills.get(id);
  if (
    !skill ||
    skill.enabled === false ||
    ((skill.status ?? "active") === "deprecated" && !options.includeDeprecated)
  ) return null;
  return { name: skill.name, content: skill.content };
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
