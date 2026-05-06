<template>
  <div class="agents-view">
    <MCard
      flex
      direction="column"
      autoHeight
      outlined
      elevated
      :style="{ height: `${vhOffset}vh` }"
    >
      <template #default="{ contentHeight }">
        <div class="agents-container" :style="{ height: `${contentHeight}px` }">
          <!-- Toolbar -->
          <div class="agents-toolbar">
            <div class="toolbar-left">
              <InputText
                v-model="searchQuery"
                placeholder="Search agents..."
                class="search-input"
              />
              <span class="agent-count">
                {{ filteredAgents.length }} agent{{ filteredAgents.length !== 1 ? "s" : "" }}
              </span>
            </div>
            <div class="toolbar-right">
              <Button size="small" outlined @click="onExportAll">
                <i class="pi pi-download" />
                Export
              </Button>
              <Button size="small" @click="openCreateDialog">
                <i class="pi pi-plus" />
                New Agent
              </Button>
            </div>
          </div>

          <!-- Agent list -->
          <div class="agents-list">
            <div v-if="filteredAgents.length === 0" class="empty-state">
              <i class="pi pi-users empty-icon" />
              <p class="empty-title">
                {{ searchQuery ? "No matching agents" : "No agents yet" }}
              </p>
              <p class="empty-sub">
                {{
                  searchQuery
                    ? "Try a different search term."
                    : "Create agents to give the AI assistant specialized personas with specific skills and tools."
                }}
              </p>
            </div>

            <div
              v-for="agent in filteredAgents"
              :key="agent.agentId"
              class="agent-card"
              :class="{ disabled: !agent.enabled }"
              @click="openEditDialog(agent)"
            >
              <div class="agent-card-header">
                <div class="agent-color-dot" :style="{ background: agent.color }" />
                <div class="agent-info">
                  <div class="agent-name-row">
                    <span class="agent-name">{{ agent.name }}</span>
                    <span class="agent-slug">/{{ agent.slug }}</span>
                    <span class="agent-mode-badge" :class="'mode-' + agent.mode">
                      {{ agent.mode }}
                    </span>
                  </div>
                  <span class="agent-description">{{ agent.description }}</span>
                </div>
                <div class="agent-actions">
                  <ToggleSwitch
                    :modelValue="agent.enabled"
                    class="agent-toggle"
                    title="Enable / disable agent"
                    @click.stop
                    @update:modelValue="toggleAgentEnabled(agent)"
                  />
                  <button
                    class="action-btn"
                    title="Duplicate"
                    @click.stop="duplicateAgent(agent)"
                  >
                    <i class="pi pi-copy" />
                  </button>
                  <button
                    class="action-btn action-btn-danger"
                    title="Delete"
                    @click.stop="confirmDelete(agent)"
                  >
                    <i class="pi pi-trash" />
                  </button>
                </div>
              </div>
              <div class="agent-meta">
                <span class="agent-meta-item">
                  <i class="pi pi-wrench" />
                  {{ agent.tools.length }} tool{{ agent.tools.length !== 1 ? "s" : "" }}
                </span>
                <span class="agent-meta-item">
                  <i class="pi pi-book" />
                  {{ agent.skillIds.length }} skill{{ agent.skillIds.length !== 1 ? "s" : "" }}
                </span>
                <span class="agent-meta-item">
                  <i class="pi pi-replay" />
                  {{ agent.limits.maxIterations }} iters
                </span>
                <span v-if="!agent.limits.canExecuteDestructive" class="agent-meta-item meta-safe">
                  <i class="pi pi-shield" />
                  safe
                </span>
                <span class="agent-meta-date">
                  Updated {{ formatDate(agent.updatedAt) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </MCard>

    <!-- ── Create / Edit Dialog ── -->
    <Dialog
      v-model:visible="dialogVisible"
      :header="isEditing ? 'Edit Agent' : 'Create Agent'"
      :style="{ width: '680px' }"
      modal
      :closable="true"
      :draggable="false"
    >
      <div class="dialog-form">
        <!-- Name -->
        <div class="form-field">
          <label for="agent-name">Name</label>
          <InputText
            id="agent-name"
            v-model="formData.name"
            placeholder="e.g., SuiteQL Expert"
            class="w-full"
            @input="onNameChange"
          />
        </div>

        <!-- Slug -->
        <div class="form-field">
          <label for="agent-slug">
            Command Slug
            <span class="label-hint">used as /{{ formData.slug || "..." }} in the AI chat</span>
          </label>
          <InputText
            id="agent-slug"
            v-model="formData.slug"
            placeholder="e.g., suiteql-expert"
            class="w-full slug-input"
          />
          <span v-if="slugError" class="field-error">{{ slugError }}</span>
        </div>

        <!-- Description -->
        <div class="form-field">
          <label for="agent-desc">Description</label>
          <InputText
            id="agent-desc"
            v-model="formData.description"
            placeholder="Short description of what this agent specializes in..."
            class="w-full"
          />
        </div>

        <!-- System Prompt -->
        <div class="form-field">
          <label for="agent-prompt">
            System Prompt
            <span class="label-hint">instructions that define the agent's behavior</span>
          </label>
          <Textarea
            id="agent-prompt"
            v-model="formData.systemPrompt"
            placeholder="You are a specialized agent that..."
            rows="8"
            class="w-full content-textarea"
            autoResize
          />
        </div>

        <!-- Mode -->
        <div class="form-field">
          <label>Invocation Mode</label>
          <div class="mode-toggle">
            <button
              v-for="m in (['active', 'passive', 'both'] as const)"
              :key="m"
              class="mode-btn"
              :class="{ 'mode-btn-active': formData.mode === m }"
              type="button"
              @click="formData.mode = m"
            >
              {{ m }}
            </button>
          </div>
          <span class="domain-hint">
            {{ modeHints[formData.mode] }}
          </span>
        </div>

        <!-- Tools -->
        <div class="form-field">
          <label>
            Tools
            <span class="label-hint">{{ formData.tools.length }} selected</span>
          </label>
          <div class="tool-picker">
            <div class="picker-search">
              <InputText
                v-model="toolSearch"
                placeholder="Filter tools..."
                class="w-full"
              />
            </div>
            <div class="picker-list">
              <label
                v-for="toolName in filteredToolNames"
                :key="toolName"
                class="picker-item"
              >
                <input
                  type="checkbox"
                  :checked="formData.tools.includes(toolName)"
                  @change="toggleTool(toolName)"
                />
                <span class="picker-item-name">{{ toolName }}</span>
              </label>
              <div v-if="filteredToolNames.length === 0" class="picker-empty">
                No matching tools
              </div>
            </div>
            <div class="picker-actions">
              <button type="button" class="picker-action-btn" @click="selectAllTools">Select All</button>
              <button type="button" class="picker-action-btn" @click="formData.tools = []">Clear</button>
            </div>
          </div>
        </div>

        <!-- Skills -->
        <div class="form-field">
          <label>
            Skills
            <span class="label-hint">{{ formData.skillIds.length }} selected</span>
          </label>
          <div class="tool-picker">
            <div class="picker-list">
              <template v-if="availableSkills.length > 0">
                <label
                  v-for="skill in availableSkills"
                  :key="skill.id"
                  class="picker-item"
                >
                  <input
                    type="checkbox"
                    :checked="formData.skillIds.includes(skill.id!)"
                    @change="toggleSkill(skill.id!)"
                  />
                  <span class="picker-item-name">{{ skill.name }}</span>
                  <span class="picker-item-desc">{{ skill.description }}</span>
                </label>
              </template>
              <div v-else class="picker-empty">
                No skills available. Add skills in the Skills view first.
              </div>
            </div>
          </div>
        </div>

        <!-- Limits -->
        <div class="form-field">
          <label>Limits &amp; Permissions</label>
          <div class="limits-grid">
            <div class="limit-item">
              <label for="max-iters" class="limit-label">Max iterations</label>
              <input
                id="max-iters"
                v-model.number="formData.limits.maxIterations"
                type="number"
                min="1"
                max="20"
                class="limit-input"
              />
            </div>
            <div class="limit-item">
              <label class="limit-label">Allow destructive tools</label>
              <ToggleSwitch v-model="formData.limits.canExecuteDestructive" />
            </div>
          </div>
          <!-- Blocked tools -->
          <div class="blocked-tools-field">
            <label for="blocked-tools" class="limit-label">Blocked tools (comma-separated)</label>
            <InputText
              id="blocked-tools"
              v-model="blockedToolsInput"
              placeholder="e.g., netsuite_run_script, netsuite_save_template"
              class="w-full"
            />
          </div>
        </div>

        <!-- Color -->
        <div class="form-field">
          <label>Agent Color</label>
          <div class="color-row">
            <div class="color-preview" :style="{ background: formData.color }" />
            <InputText
              v-model="formData.color"
              placeholder="#B8C9D4"
              class="color-input"
            />
            <Button size="small" outlined @click="regenerateColor" title="Auto-generate">
              <i class="pi pi-refresh" />
            </Button>
          </div>
        </div>
      </div>

      <template #footer>
        <Button
          label="Cancel"
          severity="secondary"
          outlined
          @click="dialogVisible = false"
        />
        <Button
          :label="isEditing ? 'Save Changes' : 'Create Agent'"
          @click="saveAgent"
          :disabled="!canSave"
        />
      </template>
    </Dialog>

    <!-- Delete confirmation -->
    <Dialog
      v-model:visible="deleteDialogVisible"
      header="Delete Agent"
      :style="{ width: '400px' }"
      modal
      :closable="true"
      :draggable="false"
    >
      <p class="delete-message">
        Are you sure you want to delete <strong>{{ deleteTarget?.name }}</strong>?
        This cannot be undone.
      </p>
      <template #footer>
        <Button
          label="Cancel"
          severity="secondary"
          outlined
          @click="deleteDialogVisible = false"
        />
        <Button label="Delete" severity="danger" @click="executeDelete" />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";

import MCard from "../components/universal/card/MCard.vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Dialog from "primevue/dialog";
import ToggleSwitch from "primevue/toggleswitch";

import {
  getAllAgents,
  addAgent,
  updateAgent,
  deleteAgent as deleteAgentDb,
  isSlugTaken,
  generateAgentColor,
  nameToSlug,
  type Agent,
  type AgentLimits,
  exportAllAgents
} from "../utils/agentsDb";
import { getAllSkills, type Skill } from "../utils/skillsDb";
import { tools as allToolDefinitions } from "../utils/toolManager";
import { skillTools } from "../utils/skillSearchTools";
import { createSqlAiTools } from "../utils/sqlAiTools";

// ── Props ──────────────────────────────────
const props = defineProps<{ vhOffset: number }>();

// ── All available tool names ───────────────
const allToolNames = computed(() => {
  const sqlTools = createSqlAiTools();
  const names = [
    ...allToolDefinitions.map((t) => t.name),
    ...skillTools.map((t) => t.name),
    ...sqlTools.map((t) => t.name)
  ];
  return names.sort();
});

// ── State ──────────────────────────────────
const agents = ref<Agent[]>([]);
const availableSkills = ref<Skill[]>([]);
const searchQuery = ref("");
const dialogVisible = ref(false);
const deleteDialogVisible = ref(false);
const isEditing = ref(false);
const editingId = ref<string | null>(null);
const deleteTarget = ref<Agent | null>(null);
const toolSearch = ref("");
const slugError = ref("");
const blockedToolsInput = ref("");

const defaultLimits: AgentLimits = {
  maxIterations: 6,
  canExecuteDestructive: false,
  blockedTools: []
};

const formData = ref({
  name: "",
  slug: "",
  description: "",
  systemPrompt: "",
  mode: "both" as "active" | "passive" | "both",
  tools: [] as string[],
  skillIds: [] as number[],
  limits: { ...defaultLimits },
  color: "#B8C9D4"
});

const modeHints: Record<string, string> = {
  active: "Only usable via /slug command in the AI chat.",
  passive: "The main agent can auto-delegate tasks to this agent when it detects a relevant query.",
  both: "Can be invoked manually via /slug or auto-delegated by the main agent."
};

// ── Computed ───────────────────────────────
const filteredAgents = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  if (!q) return agents.value;
  const terms = q.split(/\s+/);
  return agents.value.filter((agent) => {
    const haystack = `${agent.name} ${agent.description} ${agent.slug}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
});

const filteredToolNames = computed(() => {
  const q = toolSearch.value.toLowerCase().trim();
  if (!q) return allToolNames.value;
  return allToolNames.value.filter((name) => name.toLowerCase().includes(q));
});

const canSave = computed(() => {
  return (
    formData.value.name.trim().length > 0 &&
    formData.value.slug.trim().length > 0 &&
    formData.value.systemPrompt.trim().length > 0 &&
    !slugError.value
  );
});

// ── Lifecycle ──────────────────────────────
onMounted(async () => {
  await Promise.all([refreshAgents(), refreshSkills()]);
});

const refreshAgents = async () => {
  agents.value = await getAllAgents();
};

const refreshSkills = async () => {
  availableSkills.value = await getAllSkills();
};

// ── Name → Slug auto-generation ───────────
const onNameChange = () => {
  if (!isEditing.value || !editingId.value) {
    formData.value.slug = nameToSlug(formData.value.name);
  }
  validateSlug();
};

const validateSlug = async () => {
  const slug = formData.value.slug.trim();
  if (!slug) {
    slugError.value = "";
    return;
  }
  const taken = await isSlugTaken(slug, editingId.value ?? undefined);
  slugError.value = taken ? "This slug is already used by another agent." : "";
};

// ── Tool / Skill toggles ──────────────────
const toggleTool = (toolName: string) => {
  const idx = formData.value.tools.indexOf(toolName);
  if (idx >= 0) {
    formData.value.tools.splice(idx, 1);
  } else {
    formData.value.tools.push(toolName);
  }
};

const selectAllTools = () => {
  formData.value.tools = [...allToolNames.value];
};

const toggleSkill = (skillId: number) => {
  const idx = formData.value.skillIds.indexOf(skillId);
  if (idx >= 0) {
    formData.value.skillIds.splice(idx, 1);
  } else {
    formData.value.skillIds.push(skillId);
  }
};

// ── Color ─────────────────────────────────
const regenerateColor = () => {
  formData.value.color = generateAgentColor(
    formData.value.name,
    formData.value.description
  );
};

// ── CRUD ───────────────────────────────────
const openCreateDialog = () => {
  isEditing.value = false;
  editingId.value = null;
  toolSearch.value = "";
  slugError.value = "";
  blockedToolsInput.value = "";
  formData.value = {
    name: "",
    slug: "",
    description: "",
    systemPrompt: "",
    mode: "both",
    tools: [],
    skillIds: [],
    limits: { ...defaultLimits },
    color: generateAgentColor("", "")
  };
  dialogVisible.value = true;
};

const openEditDialog = (agent: Agent) => {
  isEditing.value = true;
  editingId.value = agent.agentId;
  toolSearch.value = "";
  slugError.value = "";
  blockedToolsInput.value = agent.limits.blockedTools.join(", ");
  formData.value = {
    name: agent.name,
    slug: agent.slug,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    mode: agent.mode,
    tools: [...agent.tools],
    skillIds: [...agent.skillIds],
    limits: {
      maxIterations: agent.limits.maxIterations,
      canExecuteDestructive: agent.limits.canExecuteDestructive,
      blockedTools: [...agent.limits.blockedTools]
    },
    color: agent.color
  };
  dialogVisible.value = true;
};

const saveAgent = async () => {
  const {
    name, slug, description, systemPrompt, mode, tools, skillIds, limits, color
  } = formData.value;

  if (!name.trim() || !slug.trim() || !systemPrompt.trim()) return;

  const parsedBlockedTools = blockedToolsInput.value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const agentData = {
    name: name.trim(),
    slug: slug.trim(),
    description: description.trim(),
    systemPrompt: systemPrompt.trim(),
    mode,
    tools,
    skillIds,
    limits: {
      ...limits,
      blockedTools: parsedBlockedTools
    },
    color,
    enabled: true
  };

  if (isEditing.value && editingId.value) {
    await updateAgent(editingId.value, agentData);
  } else {
    await addAgent(agentData);
  }

  dialogVisible.value = false;
  await refreshAgents();
};

const toggleAgentEnabled = async (agent: Agent) => {
  await updateAgent(agent.agentId, { enabled: !agent.enabled });
  await refreshAgents();
};

const duplicateAgent = async (agent: Agent) => {
  const newSlug = `${agent.slug}-copy`;
  await addAgent({
    name: `${agent.name} (Copy)`,
    slug: newSlug,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    mode: agent.mode,
    tools: [...agent.tools],
    skillIds: [...agent.skillIds],
    limits: { ...agent.limits, blockedTools: [...agent.limits.blockedTools] },
    color: agent.color,
    enabled: false
  });
  await refreshAgents();
};

const confirmDelete = (agent: Agent) => {
  deleteTarget.value = agent;
  deleteDialogVisible.value = true;
};

const executeDelete = async () => {
  if (!deleteTarget.value) return;
  await deleteAgentDb(deleteTarget.value.agentId);
  deleteDialogVisible.value = false;
  deleteTarget.value = null;
  await refreshAgents();
};

// ── Export ─────────────────────────────────
const onExportAll = async () => {
  const data = await exportAllAgents();
  if (data.length === 0) return;
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `agents-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

// ── Helpers ────────────────────────────────
const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};
</script>

<style scoped>
.agents-view {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: 100%;
}

/* ── Container ── */
.agents-container {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ── Toolbar ── */
.agents-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--p-slate-200);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
  min-width: 0;
}

.search-input {
  flex: 1;
  min-width: 140px;
  max-width: 300px;
}

.agent-count {
  font-size: 0.75rem;
  color: var(--p-slate-400);
  white-space: nowrap;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* ── Agent List ── */
.agents-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
}

/* ── Empty State ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  color: var(--p-slate-400);
  gap: 0.4rem;
}

.empty-icon {
  font-size: 2rem;
  margin-bottom: 0.5rem;
  color: var(--p-slate-300);
}

.empty-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--p-slate-600);
  margin: 0;
}

.empty-sub {
  font-size: 0.8rem;
  margin: 0;
  text-align: center;
  max-width: 340px;
}

/* ── Agent Card ── */
.agent-card {
  background: white;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.agent-card:hover {
  border-color: var(--p-slate-300);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
}

.agent-card.disabled {
  opacity: 0.5;
}

.agent-card-header {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
}

.agent-color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 3px;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

.agent-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.agent-name-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.agent-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--p-slate-800);
}

.agent-slug {
  font-size: 0.7rem;
  font-family: "JetBrains Mono", monospace;
  color: var(--p-slate-400);
  background: var(--p-slate-50);
  padding: 0.05rem 0.35rem;
  border-radius: 0.2rem;
  border: 1px solid var(--p-slate-150, var(--p-slate-200));
}

.agent-mode-badge {
  display: inline-block;
  padding: 0.05rem 0.4rem;
  border-radius: 0.25rem;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex-shrink: 0;
}

.mode-active {
  background: var(--p-blue-100);
  border: 1px solid var(--p-blue-200);
  color: var(--p-blue-600);
}

.mode-passive {
  background: var(--p-green-100);
  border: 1px solid var(--p-green-200);
  color: var(--p-green-600);
}

.mode-both {
  background: var(--p-violet-100, var(--p-purple-100));
  border: 1px solid var(--p-violet-200, var(--p-purple-200));
  color: var(--p-violet-600, var(--p-purple-600));
}

.agent-description {
  font-size: 0.75rem;
  color: var(--p-slate-500);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.agent-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.agent-card:hover .agent-actions {
  opacity: 1;
}

.agent-toggle {
  transform: scale(0.75);
  transform-origin: center;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.625rem;
  height: 1.625rem;
  border: none;
  border-radius: 0.25rem;
  background: transparent;
  color: var(--p-slate-400);
  cursor: pointer;
  font-size: 0.7rem;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: var(--p-slate-100);
  color: var(--p-slate-700);
}

.action-btn-danger:hover {
  background: var(--p-red-100);
  color: var(--p-red-600);
}

/* ── Agent Meta ── */
.agent-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.5rem;
  font-size: 0.675rem;
  color: var(--p-slate-400);
  flex-wrap: wrap;
}

.agent-meta-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.agent-meta-item i {
  font-size: 0.6rem;
}

.meta-safe {
  color: var(--p-green-500);
}

.agent-meta-date {
  margin-left: auto;
}

/* ── Dialog Form ── */
.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 65vh;
  overflow-y: auto;
  padding-right: 0.5rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.form-field > label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-slate-700);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.label-hint {
  font-weight: 400;
  font-size: 0.7rem;
  color: var(--p-slate-400);
}

.slug-input {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.8rem;
}

.field-error {
  font-size: 0.72rem;
  color: var(--p-red-500);
}

.content-textarea {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  min-height: 120px;
}

.w-full {
  width: 100%;
}

/* ── Mode Toggle ── */
.mode-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.375rem;
  overflow: hidden;
  width: fit-content;
}

.mode-btn {
  padding: 0.35rem 0.875rem;
  font-size: 0.8rem;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--p-slate-500);
  cursor: pointer;
  transition: all 0.15s ease;
  text-transform: capitalize;
}

.mode-btn:hover {
  background: var(--p-slate-100);
  color: var(--p-slate-700);
}

.mode-btn-active {
  background: var(--p-slate-700);
  color: white;
}

.domain-hint {
  font-size: 0.72rem;
  color: var(--p-slate-400);
  margin-top: 0.1rem;
}

/* ── Tool/Skill Picker ── */
.tool-picker {
  border: 1px solid var(--p-slate-200);
  border-radius: 0.375rem;
  overflow: hidden;
}

.picker-search {
  padding: 0.4rem;
  border-bottom: 1px solid var(--p-slate-100);
}

.picker-list {
  max-height: 180px;
  overflow-y: auto;
  padding: 0.25rem 0;
}

.picker-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.6rem;
  cursor: pointer;
  transition: background 0.1s;
  font-size: 0.78rem;
}

.picker-item:hover {
  background: var(--p-slate-50);
}

.picker-item input[type="checkbox"] {
  flex-shrink: 0;
  accent-color: var(--p-slate-700);
}

.picker-item-name {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.72rem;
  color: var(--p-slate-700);
}

.picker-item-desc {
  font-size: 0.68rem;
  color: var(--p-slate-400);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.picker-empty {
  padding: 1rem;
  text-align: center;
  font-size: 0.75rem;
  color: var(--p-slate-400);
}

.picker-actions {
  display: flex;
  gap: 0.5rem;
  padding: 0.35rem 0.6rem;
  border-top: 1px solid var(--p-slate-100);
}

.picker-action-btn {
  font-size: 0.7rem;
  color: var(--p-blue-500);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.picker-action-btn:hover {
  text-decoration: underline;
}

/* ── Limits ── */
.limits-grid {
  display: flex;
  gap: 1.5rem;
  align-items: center;
}

.limit-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.limit-label {
  font-size: 0.75rem;
  color: var(--p-slate-600);
}

.limit-input {
  width: 60px;
  text-align: center;
}

.blocked-tools-field {
  margin-top: 0.5rem;
}

/* ── Color ── */
.color-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.color-preview {
  width: 28px;
  height: 28px;
  border-radius: 0.375rem;
  border: 1px solid rgba(0, 0, 0, 0.08);
  flex-shrink: 0;
}

.color-input {
  width: 100px;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.8rem;
}

/* ── Delete Dialog ── */
.delete-message {
  font-size: 0.875rem;
  color: var(--p-slate-700);
  margin: 0;
  line-height: 1.6;
}
</style>
