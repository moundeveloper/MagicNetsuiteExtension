import type { Artifact, Project, Relationship } from "./model";

/** A presentation projection: source files stay in the domain/explorer/editor. */
export function projectArchitecture(project: Project) {
  const byId = new Map(project.artifacts.map((a) => [a.id, a]));
  const representatives = new Map<string, Set<string>>();
  const representedSources = new Set<string>();
  for (const e of project.relationships) {
    if (
      ["Script", "Deployment"].includes(byId.get(e.source)?.kind || "") &&
      byId.get(e.target)?.kind === "Module" &&
      ["Loads source", "Executes"].includes(e.label)
    ) {
      representedSources.add(e.target);
      const owners = representatives.get(e.target) || new Set<string>();
      owners.add(e.source);
      representatives.set(e.target, owners);
    }
  }
  const artifacts: Artifact[] = project.artifacts.flatMap((a) => {
    if (a.kind !== "Module") return [a];
    if (
      representedSources.has(a.id) ||
      !a.source ||
      !a.metadata.scriptType ||
      /^(Library|Unknown)$/i.test(a.metadata.scriptType)
    )
      return [];
    return [{ ...a, kind: "Script" as const }];
  });
  for (const a of artifacts) representatives.set(a.id, new Set([a.id]));
  const visibleIds = new Set(artifacts.map((a) => a.id));
  // Attribute library record/integration references to their owning architectural scripts.
  // Fixed-point propagation handles shared libraries and cycles without recursion.
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of project.relationships) {
      if (
        e.label !== "Loads module" ||
        byId.get(e.target)?.kind !== "Module" ||
        representedSources.has(e.target) ||
        visibleIds.has(e.target)
      )
        continue;
      const owners = representatives.get(e.target) || new Set<string>();
      for (const owner of representatives.get(e.source) || [])
        if (!owners.has(owner)) {
          owners.add(owner);
          changed = true;
        }
      representatives.set(e.target, owners);
    }
  }
  const relationships: Relationship[] = [];
  for (const e of project.relationships) {
    if (["Loads source", "Loads module"].includes(e.label)) continue;
    if (
      byId.get(e.target)?.kind === "Module" &&
      !visibleIds.has(e.target) &&
      !representedSources.has(e.target)
    )
      continue;
    for (const source of representatives.get(e.source) || [])
      for (const target of representatives.get(e.target) || []) {
        if (source === target) continue;
        // Built-in APIs and unresolved module references are implementation details.
        if (
          byId.get(e.target)?.kind === "Module" &&
          !byId.get(e.target)?.source
        )
          continue;
        relationships.push({
          ...e,
          id: `${e.id}:canvas:${source}:${target}`,
          source,
          target,
          evidence:
            source !== e.source
              ? `${e.evidence} (via ${byId.get(e.source)?.name || e.source})`
              : e.evidence,
        });
      }
  }
  return { artifacts, relationships, representatives };
}
