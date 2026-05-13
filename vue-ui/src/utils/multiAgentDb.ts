// multiAgentDb.ts — IndexedDB-backed storage for Multi-Agent Orchestrator View using Dexie.js
import Dexie, { type EntityTable } from "dexie";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

/** A single message in the orchestrator or sub-agent conversation */
export interface MultiAgentMessage {
  id: number;
  role: "user" | "assistant" | "tool" | "compaction" | "system";
  content: string;
  toolName?: string;
  isStreaming?: boolean;
  compactedCount?: number;
  /** When present, identifies which sub-agent produced this message */
  agentContext?: {
    name: string;
    slug: string;
    color: string;
  };
}

/** A tracked sub-agent within a session */
export interface SubAgentRecord {
  id: string;
  agentId: string;
  name: string;
  slug: string;
  color: string;
  description: string;
  status: "idle" | "running" | "done" | "error";
  task: string;
  messages: MultiAgentMessage[];
  /** Whether this agent was created temporarily for this session */
  isTemporary: boolean;
  createdAt: string;
}

/** A multi-agent orchestrator session */
export interface MultiAgentSessionRecord {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Orchestrator-level messages (user prompts + orchestrator responses) */
  messages: MultiAgentMessage[];
  /** Sub-agents spawned during this session */
  subAgents: SubAgentRecord[];
  /** Configuration snapshot for this session */
  config: MultiAgentConfig;
}

/** Configuration for the multi-agent orchestrator */
export interface MultiAgentConfig {
  /** Maximum number of sub-agents that can be active simultaneously */
  maxAgents: number;
  /** Slugs of agents allowed to be spawned (empty = all allowed) */
  allowedAgentSlugs: string[];
  /** Whether the orchestrator can create temporary agents */
  allowTempAgents: boolean;
  /** Whether tool calls require user approval */
  requireToolApproval: boolean;
}

export interface MultiAgentUiStateRecord {
  key: string;
  value: unknown;
}

// ─────────────────────────────────────────────
// Default config
// ─────────────────────────────────────────────

export const DEFAULT_MULTI_AGENT_CONFIG: MultiAgentConfig = {
  maxAgents: 5,
  allowedAgentSlugs: [],
  allowTempAgents: true,
  requireToolApproval: true
};

// ─────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────

const db = new Dexie("MagicNetsuiteMultiAgent") as Dexie & {
  sessions: EntityTable<MultiAgentSessionRecord, "sessionId">;
  uiState: EntityTable<MultiAgentUiStateRecord, "key">;
};

db.version(1).stores({
  sessions: "&sessionId, title, createdAt, updatedAt",
  uiState: "&key"
});

// ─────────────────────────────────────────────
// Sessions CRUD
// ─────────────────────────────────────────────

export const getAllMultiAgentSessions = async (): Promise<MultiAgentSessionRecord[]> => {
  return db.sessions.orderBy("updatedAt").reverse().toArray();
};

export const getMultiAgentSession = async (
  sessionId: string
): Promise<MultiAgentSessionRecord | undefined> => {
  return db.sessions.get(sessionId);
};

export const upsertMultiAgentSession = async (
  session: MultiAgentSessionRecord
): Promise<void> => {
  await db.sessions.put(session);
};

export const deleteMultiAgentSession = async (sessionId: string): Promise<void> => {
  await db.sessions.delete(sessionId);
};

// ─────────────────────────────────────────────
// UI State
// ─────────────────────────────────────────────

export const getMultiAgentUiState = async <T>(
  key: string,
  defaultValue: T
): Promise<T> => {
  const record = await db.uiState.get(key);
  return record !== undefined ? (record.value as T) : defaultValue;
};

export const setMultiAgentUiState = async (
  key: string,
  value: unknown
): Promise<void> => {
  await db.uiState.put({ key, value });
};

export { db as multiAgentDb };
