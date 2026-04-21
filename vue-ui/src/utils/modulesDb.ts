// modulesDb.ts — IndexedDB-backed SuiteScript module documentation storage using Dexie.js
import Dexie, { type EntityTable } from "dexie";

// ─────────────────────────────────────────────
// Types (mirror the suitescript-modules.json structure)
// ─────────────────────────────────────────────

export interface ModuleParameter {
  Parameter: string;
  Type: string;
  "Required / Optional": string;
  Description: string;
}

export interface ModuleError {
  "Error Code": string;
  "Thrown If": string;
}

export interface MemberDetails {
  overview?: Record<string, string>;
  notes?: string[];
  parameters?: ModuleParameter[];
  errors?: ModuleError[];
  syntax?: string;
}

export interface ModuleMember {
  "Member Type": string;
  Name: string;
  "Return Type / Value Type": string;
  "Supported Script Types": string;
  Description: string;
  details?: MemberDetails;
}

export interface ModuleSection {
  section: string;
  table: ModuleMember[];
}

/** Raw module shape from suitescript-modules.json */
export interface RawModule {
  module: string;
  data: ModuleSection[];
}

/** Flattened member stored in IndexedDB for fast search */
export interface StoredMember {
  id?: number;
  /** e.g. "N/record" */
  moduleName: string;
  /** e.g. "N/record Module Members" */
  sectionName: string;
  /** Method, Object, Property, Enum */
  memberType: string;
  /** e.g. "RECORD.LOAD(OPTIONS)" */
  name: string;
  /** Lowercase searchable version of name */
  nameLower: string;
  returnType: string;
  scriptTypes: string;
  description: string;
  /** Full details blob (overview, params, errors, syntax) */
  details: MemberDetails | null;
}

/** Module-level metadata */
export interface StoredModule {
  id?: number;
  /** e.g. "N/record" */
  name: string;
  /** Count of members */
  memberCount: number;
  importedAt: string;
}

export interface ModuleSearchResult {
  id: number;
  moduleName: string;
  memberType: string;
  name: string;
  returnType: string;
  description: string;
  score: number;
}

// ─────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────

const db = new Dexie("MagicNetsuiteModules") as Dexie & {
  modules: EntityTable<StoredModule, "id">;
  members: EntityTable<StoredMember, "id">;
};

db.version(1).stores({
  modules: "++id, name",
  members: "++id, moduleName, memberType, nameLower, name",
});

// ─────────────────────────────────────────────
// Import from JSON
// ─────────────────────────────────────────────

/**
 * Strip " Module" suffix to get clean module name.
 * e.g. "N/record Module" -> "N/record"
 */
const cleanModuleName = (raw: string): string =>
  raw.replace(/\s+Module$/i, "").trim();

/**
 * Import all modules from the suitescript-modules.json structure.
 * Clears existing data first for a clean import.
 */
export const importModules = async (rawModules: RawModule[]): Promise<{ moduleCount: number; memberCount: number }> => {
  // Clear existing data
  await db.modules.clear();
  await db.members.clear();

  const now = new Date().toISOString();
  const storedModules: Omit<StoredModule, "id">[] = [];
  const storedMembers: Omit<StoredMember, "id">[] = [];

  for (const rawModule of rawModules) {
    const moduleName = cleanModuleName(rawModule.module);
    let memberCount = 0;

    for (const section of rawModule.data) {
      for (const member of section.table) {
        // Skip rows that have no Name (malformed table rows from the scraper)
        const name = member.Name?.trim();
        if (!name) continue;

        memberCount++;
        storedMembers.push({
          moduleName,
          sectionName: section.section,
          memberType: member["Member Type"] || "",
          name,
          nameLower: name.toLowerCase(),
          returnType: member["Return Type / Value Type"] || "",
          scriptTypes: member["Supported Script Types"] || "",
          description: member.Description || "",
          details: member.details || null,
        });
      }
    }

    storedModules.push({
      name: moduleName,
      memberCount,
      importedAt: now,
    });
  }

  await db.modules.bulkAdd(storedModules as StoredModule[]);
  await db.members.bulkAdd(storedMembers as StoredMember[]);

  return { moduleCount: storedModules.length, memberCount: storedMembers.length };
};

// ─────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────

export const getModuleCount = async (): Promise<number> => {
  return db.modules.count();
};

export const getMemberCount = async (): Promise<number> => {
  return db.members.count();
};

export const getAllModules = async (): Promise<StoredModule[]> => {
  return db.modules.orderBy("name").toArray();
};

export const getModuleMembers = async (moduleName: string): Promise<StoredMember[]> => {
  return db.members.where("moduleName").equals(moduleName).toArray();
};

export const getMemberById = async (id: number): Promise<StoredMember | undefined> => {
  return db.members.get(id);
};

/**
 * Search members across all modules. Scores results by relevance.
 * Searches name, description, and module name.
 */
export const searchMembers = async (
  query: string,
  options?: { moduleName?: string; memberType?: string; limit?: number }
): Promise<ModuleSearchResult[]> => {
  const term = query.toLowerCase().trim();
  const limit = options?.limit ?? 50;

  let collection = db.members.toCollection();

  // Filter by module if specified
  if (options?.moduleName) {
    collection = db.members.where("moduleName").equals(options.moduleName);
  }

  const all = await collection.toArray();

  // Filter by member type in memory
  const filtered = options?.memberType
    ? all.filter((m) => m.memberType === options.memberType)
    : all;

  if (!term) {
    return filtered.slice(0, limit).map((m) => ({
      id: m.id!,
      moduleName: m.moduleName,
      memberType: m.memberType,
      name: m.name,
      returnType: m.returnType,
      description: m.description,
      score: 0,
    }));
  }

  const terms = term.split(/\s+/);

  const scored = filtered
    .map((m) => {
      const haystack = `${m.nameLower} ${(m.description || "").toLowerCase()} ${m.moduleName.toLowerCase()}`;
      let score = 0;

      for (const t of terms) {
        // Exact name match gets highest score
        if (m.nameLower === t) {
          score += 10;
        } else if (m.nameLower.includes(t)) {
          score += 5;
        } else if (haystack.includes(t)) {
          score += 2;
        }
      }

      return { member: m, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ member: m, score }) => ({
    id: m.id!,
    moduleName: m.moduleName,
    memberType: m.memberType,
    name: m.name,
    returnType: m.returnType,
    description: m.description,
    score,
  }));
};

/**
 * Clear all module data from IndexedDB.
 */
export const clearModules = async (): Promise<void> => {
  await db.modules.clear();
  await db.members.clear();
};

export { db as modulesDatabase };
