// agentsDb.ts — IndexedDB-backed agent storage using Dexie.js
import Dexie, { type EntityTable } from "dexie";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface AgentLimits {
  /** Whether the agent may execute destructive tools (default: false) */
  canExecuteDestructive: boolean;
  /** Tool names explicitly blocked (empty = nothing blocked) */
  blockedTools: string[];
}

export interface Agent {
  agentId: string;
  /** Human-readable name */
  name: string;
  /** URL-safe slug used as the /command prefix (e.g. "sql-expert") */
  slug: string;
  /** Short description of what this agent does */
  description: string;
  /** Full system prompt injected when this agent is invoked */
  systemPrompt: string;
  /** IDs of skills (from skillsDb) this agent has access to */
  skillIds: number[];
  /** Tool names (from toolManager) this agent is allowed to use */
  tools: string[];
  /** Behavioral limits */
  limits: AgentLimits;
  /** Pastel desaturated hex color representing the agent's specialization */
  color: string;
  /** Whether the agent is active and usable */
  enabled: boolean;
  /**
   * How the agent can be invoked:
   * - "active": only via /slug command
   * - "passive": main agent can auto-delegate to it
   * - "both": can be used either way
   */
  mode: "active" | "passive" | "both";
  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// Color generation
// ─────────────────────────────────────────────

/**
 * Domain-to-hue mapping for specialization-based pastel colors.
 * Falls back to a hash-derived hue for unknown domains.
 */
const DOMAIN_HUES: Record<string, number> = {
  sql: 210,         // soft blue
  suiteql: 210,
  query: 210,
  script: 150,      // soft green
  suitescript: 150,
  code: 150,
  record: 30,       // soft amber/orange
  customer: 30,
  transaction: 30,
  template: 280,    // soft purple
  pdf: 280,
  file: 60,         // soft yellow
  deploy: 340,      // soft pink
  deployment: 340,
  email: 180,       // soft teal
  search: 120,      // soft lime-green
  workflow: 300,     // soft violet
  inventory: 45,    // soft gold
  general: 200,     // soft sky blue
};

/**
 * Simple FNV-1a hash to derive a deterministic hue from a string.
 */
const hashToHue = (str: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash % 360;
};

/**
 * Generate a pastel desaturated color based on text content.
 * Analyzes the description/name for domain keywords and picks
 * a matching hue, otherwise derives one from a hash.
 *
 * Returns a hex color string like "#B8C9D4".
 */
export const generateAgentColor = (name: string, description: string): string => {
  const text = `${name} ${description}`.toLowerCase();

  let hue: number | null = null;

  for (const [keyword, h] of Object.entries(DOMAIN_HUES)) {
    if (text.includes(keyword)) {
      hue = h;
      break;
    }
  }

  if (hue === null) {
    hue = hashToHue(text);
  }

  // HSL to hex with pastel desaturated values:
  // Saturation: 25-35%, Lightness: 75-82%
  const saturation = 28 + (hue % 10); // 28-37
  const lightness = 76 + (hue % 7);   // 76-82

  return hslToHex(hue, saturation, lightness);
};

/**
 * Convert HSL values to a hex color string.
 */
const hslToHex = (h: number, s: number, l: number): string => {
  const sNorm = s / 100;
  const lNorm = l / 100;

  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  const toHex = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

// ─────────────────────────────────────────────
// Slug generation
// ─────────────────────────────────────────────

/**
 * Convert a name into a URL-safe slug for use as a /command.
 * e.g. "SQL Query Expert" → "sql-query-expert"
 */
export const nameToSlug = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
};

// ─────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────

const db = new Dexie("MagicNetsuiteAgents") as Dexie & {
  agents: EntityTable<Agent, "agentId">;
};

db.version(1).stores({
  agents: "&agentId, name, slug, enabled, mode, createdAt, updatedAt"
});

// ─────────────────────────────────────────────
// CRUD operations
// ─────────────────────────────────────────────

export const addAgent = async (
  agent: Omit<Agent, "agentId" | "createdAt" | "updatedAt">
): Promise<string> => {
  const now = new Date().toISOString();
  const agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.agents.add({
    ...agent,
    agentId,
    createdAt: now,
    updatedAt: now
  });
  return agentId;
};

export const updateAgent = async (
  agentId: string,
  updates: Partial<Omit<Agent, "agentId" | "createdAt">>
): Promise<void> => {
  await db.agents.update(agentId, {
    ...updates,
    updatedAt: new Date().toISOString()
  });
};

export const deleteAgent = async (agentId: string): Promise<void> => {
  await db.agents.delete(agentId);
};

export const getAgent = async (agentId: string): Promise<Agent | undefined> => {
  return db.agents.get(agentId);
};

export const getAllAgents = async (): Promise<Agent[]> => {
  return db.agents.orderBy("updatedAt").reverse().toArray();
};

export const getEnabledAgents = async (): Promise<Agent[]> => {
  return db.agents.filter((a) => a.enabled).toArray();
};

export const getAgentBySlug = async (slug: string): Promise<Agent | undefined> => {
  return db.agents.where("slug").equals(slug).first();
};

/**
 * Get all agents that can be passively delegated to.
 */
export const getPassiveAgents = async (): Promise<Agent[]> => {
  return db.agents
    .filter((a) => a.enabled && (a.mode === "passive" || a.mode === "both"))
    .toArray();
};

/**
 * Check if a slug is already taken by another agent (for validation).
 */
export const isSlugTaken = async (
  slug: string,
  excludeAgentId?: string
): Promise<boolean> => {
  const existing = await db.agents.where("slug").equals(slug).first();
  if (!existing) return false;
  return existing.agentId !== excludeAgentId;
};

// ─────────────────────────────────────────────
// Import / Export
// ─────────────────────────────────────────────

export interface AgentExport {
  name: string;
  slug: string;
  description: string;
  systemPrompt: string;
  skillIds: number[];
  tools: string[];
  limits: AgentLimits;
  color: string;
  mode: "active" | "passive" | "both";
}

export const exportAllAgents = async (): Promise<AgentExport[]> => {
  const all = await db.agents.toArray();
  return all.map(({ name, slug, description, systemPrompt, skillIds, tools, limits, color, mode }) => ({
    name, slug, description, systemPrompt, skillIds, tools, limits, color, mode
  }));
};

export const importAgents = async (agents: AgentExport[]): Promise<number> => {
  const now = new Date().toISOString();
  const records = agents.map((a) => ({
    ...a,
    agentId: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    enabled: true,
    createdAt: now,
    updatedAt: now
  }));
  await db.agents.bulkAdd(records);
  return agents.length;
};

export { db as agentsDb };
