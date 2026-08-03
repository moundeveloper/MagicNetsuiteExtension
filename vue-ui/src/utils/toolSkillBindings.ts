import { getCustomTools } from "./customToolsDb";

export const TOOL_SKILL_BINDINGS_STORAGE_KEY =
  "magic_netsuite_tool_skill_bindings_v1";

export const SKILL_PREFLIGHT_TOOL_NAME = "magic_netsuite_prepare_tool";
export const CUSTOM_TOOL_EXPOSED_PREFIX = "magic_custom_";

export interface ToolSkillBinding {
  toolName: string;
  skillIds: number[];
  updatedAt: string;
}

export interface BindableTool {
  name: string;
  label: string;
  description: string;
  source: "built_in" | "custom";
}

const normalizeBindings = (value: unknown): ToolSkillBinding[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((binding) => {
      const candidate = binding as Partial<ToolSkillBinding>;
      return {
        toolName: String(candidate.toolName ?? "").trim(),
        skillIds: [
          ...new Set(
            (Array.isArray(candidate.skillIds) ? candidate.skillIds : [])
              .map(Number)
              .filter((id) => Number.isInteger(id) && id > 0)
          )
        ],
        updatedAt: String(candidate.updatedAt ?? "")
      };
    })
    .filter(
      (binding) =>
        binding.toolName &&
        binding.toolName !== SKILL_PREFLIGHT_TOOL_NAME &&
        binding.skillIds.length > 0
    )
    .sort((a, b) => a.toolName.localeCompare(b.toolName));
};

export const getToolSkillBindings = async (): Promise<ToolSkillBinding[]> => {
  const stored = await chrome.storage.local.get(
    TOOL_SKILL_BINDINGS_STORAGE_KEY
  );
  return normalizeBindings(stored[TOOL_SKILL_BINDINGS_STORAGE_KEY]);
};

export const setSkillToolBindings = async (
  skillId: number,
  toolNames: string[]
): Promise<ToolSkillBinding[]> => {
  const selected = new Set(
    toolNames
      .map((name) => String(name).trim())
      .filter((name) => name && name !== SKILL_PREFLIGHT_TOOL_NAME)
  );
  const now = new Date().toISOString();
  const current = await getToolSkillBindings();
  const byTool = new Map(current.map((binding) => [binding.toolName, binding]));
  const allToolNames = new Set([...byTool.keys(), ...selected]);

  const next = [...allToolNames]
    .map((toolName) => {
      const existing = byTool.get(toolName);
      const skillIds = new Set(existing?.skillIds ?? []);
      if (selected.has(toolName)) skillIds.add(skillId);
      else skillIds.delete(skillId);
      return {
        toolName,
        skillIds: [...skillIds].sort((a, b) => a - b),
        updatedAt:
          selected.has(toolName) !== Boolean(existing?.skillIds.includes(skillId))
            ? now
            : existing?.updatedAt || now
      };
    })
    .filter((binding) => binding.skillIds.length > 0)
    .sort((a, b) => a.toolName.localeCompare(b.toolName));

  await chrome.storage.local.set({
    [TOOL_SKILL_BINDINGS_STORAGE_KEY]: next
  });
  return next;
};

export const removeSkillFromToolBindings = async (
  skillId: number
): Promise<ToolSkillBinding[]> => setSkillToolBindings(skillId, []);

export const getBindableTools = async (): Promise<BindableTool[]> => {
  const [staticResponse, customTools] = await Promise.all([
    chrome.runtime
      .sendMessage({ type: "MCP_GET_TOOLS" })
      .catch(() => []),
    getCustomTools()
  ]);

  const staticTools = (Array.isArray(staticResponse) ? staticResponse : [])
    .filter(
      (tool) =>
        tool?.name &&
        tool.name !== SKILL_PREFLIGHT_TOOL_NAME
    )
    .map((tool) => ({
      name: String(tool.name),
      label: String(tool.name),
      description: String(tool.description ?? ""),
      source: "built_in" as const
    }));

  const custom = customTools.map((tool) => ({
    name: `${CUSTOM_TOOL_EXPOSED_PREFIX}${tool.name}`,
    label: tool.displayName || tool.name,
    description: tool.description,
    source: "custom" as const
  }));

  return [...staticTools, ...custom].sort(
    (a, b) =>
      a.source.localeCompare(b.source) ||
      a.label.localeCompare(b.label)
  );
};
