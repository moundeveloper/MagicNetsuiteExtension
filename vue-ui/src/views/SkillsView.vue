<template>
  <div class="skills-view">
    <MCard
      flex
      direction="column"
      autoHeight
      outlined
      elevated
      :style="{ height: `${vhOffset}vh` }"
    >
      <template #default="{ contentHeight }">
        <div class="skills-container" :style="{ height: `${contentHeight}px` }">
          <!-- Toolbar -->
          <div class="skills-toolbar">
            <div class="toolbar-left">
              <InputText
                v-model="searchQuery"
                placeholder="Search skills..."
                class="search-input"
                @input="onSearch"
              />
              <span class="skill-count"
                >{{ filteredSkills.length }} skill{{
                  filteredSkills.length !== 1 ? "s" : ""
                }}</span
              >
            </div>
            <div class="toolbar-right">
              <Button size="small" outlined @click="onImportClick">
                <i class="pi pi-upload" />
                Import
              </Button>
              <Button size="small" outlined @click="onExportAll">
                <i class="pi pi-download" />
                Export All
              </Button>
              <Button size="small" @click="openCreateDialog">
                <i class="pi pi-plus" />
                Add Skill
              </Button>
              <input
                ref="fileInputRef"
                type="file"
                accept=".json,.md,.txt"
                multiple
                style="display: none"
                @change="onFileSelected"
              />
            </div>
          </div>

          <!-- Skills list -->
          <div class="skills-list">
            <div v-if="filteredSkills.length === 0" class="empty-state">
              <i class="pi pi-book empty-icon" />
              <p class="empty-title">
                {{ searchQuery ? "No matching skills" : "No skills yet" }}
              </p>
              <p class="empty-sub">
                {{
                  searchQuery
                    ? "Try a different search term."
                    : "Add skills to give the AI assistant specialized knowledge and instructions."
                }}
              </p>
            </div>

            <div
              v-for="skill in filteredSkills"
              :key="skill.id"
              class="skill-card"
              :class="{ active: selectedSkillId === skill.id, disabled: skill.enabled === false }"
              @click="selectSkill(skill.id!)"
            >
              <div class="skill-card-header">
                <div class="skill-info">
                  <div class="skill-name-row">
                    <span class="skill-name">{{ skill.name }}</span>
                    <span v-if="skill.domain === 'sql'" class="skill-domain-badge">SQL</span>
                  </div>
                  <span class="skill-description">{{ skill.description }}</span>
                </div>
                <div class="skill-actions">
                  <ToggleSwitch
                    :modelValue="skill.enabled !== false"
                    class="skill-toggle"
                    title="Enable / disable skill"
                    @click.stop
                    @update:modelValue="toggleSkillEnabled(skill)"
                  />
                  <button
                    class="action-btn"
                    title="Edit"
                    @click.stop="openEditDialog(skill)"
                  >
                    <i class="pi pi-pencil" />
                  </button>
                  <button
                    class="action-btn action-btn-danger"
                    title="Delete"
                    @click.stop="confirmDelete(skill)"
                  >
                    <i class="pi pi-trash" />
                  </button>
                </div>
              </div>
              <div v-if="skill.tags" class="skill-tags">
                <span
                  v-for="tag in parseTags(skill.tags)"
                  :key="tag"
                  class="skill-tag"
                >
                  {{ tag }}
                </span>
              </div>
              <div class="skill-meta">
                <span>Updated {{ formatDate(skill.updatedAt) }}</span>
                <span class="skill-size">{{
                  formatSize(skill.content.length)
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </MCard>

    <!-- Create / Edit Dialog -->
    <Dialog
      v-model:visible="dialogVisible"
      :header="isEditing ? 'Edit Skill' : 'Add Skill'"
      :style="{ width: '640px' }"
      modal
      :closable="true"
      :draggable="false"
    >
      <div class="dialog-form">
        <!-- ── Mode toggle ── -->
        <div class="skill-mode-bar">
          <div class="skill-mode-toggle">
            <button
              class="skill-mode-btn"
              :class="{ 'skill-mode-btn-active': skillGenMode === 'manual' }"
              type="button"
              @click="skillGenMode = 'manual'"
            >
              <i class="pi pi-pencil" />
              Manual
            </button>
            <button
              class="skill-mode-btn"
              :class="{ 'skill-mode-btn-active': skillGenMode === 'ai' }"
              type="button"
              @click="skillGenMode = 'ai'"
            >
              <i class="pi pi-sparkles" />
              {{ isEditing ? 'AI Improve' : 'AI Generate' }}
            </button>
          </div>
        </div>

        <!-- ── AI Generate / Improve panel ── -->
        <template v-if="skillGenMode === 'ai'">
          <div class="form-field">
            <label for="ai-skill-prompt">
              {{ isEditing ? 'What to improve or add' : 'Describe the skill' }}
              <span class="label-hint">
                {{ isEditing
                  ? 'the AI will update only what needs changing'
                  : 'the AI will generate all fields automatically' }}
              </span>
            </label>
            <Textarea
              id="ai-skill-prompt"
              v-model="aiSkillPrompt"
              :placeholder="isEditing
                ? 'e.g., Add more examples for sublist operations and update the description to mention sublists.'
                : 'e.g., A skill covering SuiteScript 2.1 record search patterns, filters, columns, and pagination.'"
              rows="5"
              class="w-full"
              autoResize
            />
          </div>
          <div v-if="skillGenerateError" class="generate-error">
            <i class="pi pi-exclamation-triangle" />
            {{ skillGenerateError }}
          </div>
          <div v-if="isGeneratingSkill && skillGenerateProgress" class="generate-progress">
            <i class="pi pi-spin pi-spinner" style="font-size:0.75rem" />
            {{ skillGenerateProgress }}
          </div>
          <div class="generate-row">
            <Button
              :label="isGeneratingSkill ? 'Generating...' : (isEditing ? 'Improve Skill' : 'Generate Skill')"
              :disabled="!aiSkillPrompt.trim() || isGeneratingSkill"
              :loading="isGeneratingSkill"
              @click="generateSkillFromAi"
            />
            <span class="generate-hint">
              {{ isEditing
                ? 'Fields will be updated — review before saving.'
                : 'All fields will be filled in — review before saving.' }}
            </span>
          </div>
        </template>

        <!-- ── Manual form ── -->
        <template v-if="skillGenMode === 'manual'">
        <div class="form-field">
          <label for="skill-name">Name</label>
          <InputText
            id="skill-name"
            v-model="formData.name"
            placeholder="e.g., SuiteScript Search Patterns"
            class="w-full"
          />
        </div>

        <div class="form-field">
          <label for="skill-desc">Description</label>
          <InputText
            id="skill-desc"
            v-model="formData.description"
            placeholder="Brief description for AI search..."
            class="w-full"
          />
        </div>

        <div class="form-field">
          <label for="skill-tags">Tags</label>
          <InputText
            id="skill-tags"
            v-model="formData.tags"
            placeholder="Comma-separated: suitescript, search, query"
            class="w-full"
          />
        </div>

        <div class="form-field">
          <label>Domain</label>
          <div class="domain-toggle">
            <button
              class="domain-btn"
              :class="{ 'domain-btn-active': formData.domain === 'global' }"
              type="button"
              @click="formData.domain = 'global'"
            >
              Global
            </button>
            <button
              class="domain-btn"
              :class="{ 'domain-btn-active': formData.domain === 'sql' }"
              type="button"
              @click="formData.domain = 'sql'"
            >
              SQL Editor
            </button>
          </div>
          <span class="domain-hint">
            {{ formData.domain === 'sql' ? 'Injected only into the SQL AI Editor system prompt.' : 'Available to all AI agents.' }}
          </span>
        </div>

        <div class="form-field">
          <label for="skill-content">Content</label>
          <Textarea
            id="skill-content"
            v-model="formData.content"
            placeholder="Skill instructions, code patterns, documentation..."
            rows="14"
            class="w-full content-textarea"
            autoResize
          />
        </div>
        </template><!-- end manual -->
      </div>

      <template #footer>
        <Button
          label="Cancel"
          severity="secondary"
          outlined
          @click="dialogVisible = false"
        />
        <Button
          :label="isEditing ? 'Save Changes' : 'Add Skill'"
          @click="saveSkill"
          :disabled="!formData.name.trim() || !formData.content.trim()"
        />
      </template>
    </Dialog>

    <!-- Delete confirmation -->
    <Dialog
      v-model:visible="deleteDialogVisible"
      header="Delete Skill"
      :style="{ width: '400px' }"
      modal
      :closable="true"
      :draggable="false"
    >
      <p class="delete-message">
        Are you sure you want to delete <strong>{{ deleteTarget?.name }}</strong
        >? This cannot be undone.
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
import { useAgent } from "../composables/useAgent";
import { netsuiteDocsTools } from "../utils/netsuiteDocsTools";

import MCard from "../components/universal/card/MCard.vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Dialog from "primevue/dialog";
import ToggleSwitch from "primevue/toggleswitch";
import {
  getAllSkills,
  addSkill,
  updateSkill,
  deleteSkill,
  importSkills,
  exportAllSkills,
  type Skill,
  type SkillExport
} from "../utils/skillsDb";

// ── State ──────────────────────────────────
const skills = ref<Skill[]>([]);
const searchQuery = ref("");
const selectedSkillId = ref<number | null>(null);
const dialogVisible = ref(false);
const deleteDialogVisible = ref(false);
const isEditing = ref(false);
const editingId = ref<number | null>(null);
const deleteTarget = ref<Skill | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const props = defineProps<{ vhOffset: number }>();

// ── AI Generate state ──────────────────────
const skillGenMode = ref<"manual" | "ai">("manual");
const aiSkillPrompt = ref("");
const isGeneratingSkill = ref(false);
const skillGenerateError = ref("");
const skillGenerateProgress = ref("");

const formData = ref<{
  name: string;
  description: string;
  tags: string;
  content: string;
  domain: "global" | "sql";
}>({
  name: "",
  description: "",
  tags: "",
  content: "",
  domain: "global"
});

// ── Computed ───────────────────────────────
const filteredSkills = computed(() => {
  const q = searchQuery.value.toLowerCase().trim();
  if (!q) return skills.value;

  const terms = q.split(/\s+/);
  return skills.value.filter((skill) => {
    const haystack =
      `${skill.name} ${skill.description} ${skill.tags}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
});

// ── Lifecycle ──────────────────────────────
onMounted(async () => {
  await refreshSkills();
});

const refreshSkills = async () => {
  skills.value = await getAllSkills();
};

// ── Search ─────────────────────────────────
const onSearch = () => {
  // Filtering is reactive via computed
};

// ── CRUD ───────────────────────────────────
const openCreateDialog = () => {
  isEditing.value = false;
  editingId.value = null;
  formData.value = { name: "", description: "", tags: "", content: "", domain: "global" };
  skillGenMode.value = "manual";
  aiSkillPrompt.value = "";
  skillGenerateError.value = "";
  dialogVisible.value = true;
};

const openEditDialog = (skill: Skill) => {
  isEditing.value = true;
  editingId.value = skill.id!;
  formData.value = {
    name: skill.name,
    description: skill.description,
    tags: skill.tags,
    content: skill.content,
    domain: skill.domain ?? "global"
  };
  skillGenMode.value = "manual";
  aiSkillPrompt.value = "";
  skillGenerateError.value = "";
  dialogVisible.value = true;
};

const saveSkill = async () => {
  const { name, description, tags, content, domain } = formData.value;
  if (!name.trim() || !content.trim()) return;

  if (isEditing.value && editingId.value !== null) {
    await updateSkill(editingId.value, { name, description, tags, content, domain });
  } else {
    await addSkill({ name, description, tags, content, domain, enabled: true });
  }

  dialogVisible.value = false;
  await refreshSkills();
};

// ── AI Skill Generation ────────────────────
const generateSkillFromAi = async () => {
  const prompt = aiSkillPrompt.value.trim();
  if (!prompt) return;

  isGeneratingSkill.value = true;
  skillGenerateError.value = "";
  skillGenerateProgress.value = "";

  try {
    const isEdit = isEditing.value;
    const existing = isEdit ? formData.value : null;

    const systemPrompt = isEdit
      ? `You are a skill content improver for a NetSuite SuiteScript AI assistant browser extension.
A skill is a knowledge document injected into the AI's context to help it specialise in a topic.
The user will provide guidance on what to improve or add to the existing skill.

You have access to NetSuite documentation tools. Use \`search_netsuite_docs\` and \`read_netsuite_doc_page\`
to look up accurate, up-to-date NetSuite documentation relevant to the skill topic BEFORE generating content.
This ensures the skill contains correct API signatures, field names, and current behaviour.

Current skill data:
name: "${existing?.name}"
description: "${existing?.description}"
tags: "${existing?.tags}"
domain: "${existing?.domain}"
content:
${existing?.content}

After researching, return ONLY a valid JSON object — no markdown, no code blocks, just raw JSON.
JSON schema (only include fields you want to change):
{
  "name": "...",
  "description": "...",
  "tags": "comma, separated, tags",
  "domain": "global" | "sql",
  "content": "Full improved skill content..."
}
Keep fields you don't need to change exactly as-is.`
      : `You are a skill generator for a NetSuite SuiteScript AI assistant browser extension.
A skill is a knowledge document injected into the AI's context to help it specialise in a topic.

You have access to NetSuite documentation tools. Use \`search_netsuite_docs\` and \`read_netsuite_doc_page\`
to look up accurate, up-to-date NetSuite documentation relevant to the skill topic BEFORE generating content.
This ensures the skill contains correct API signatures, field names, and current behaviour.

After researching, return ONLY a valid JSON object — no markdown, no code blocks, just raw JSON.
JSON schema:
{
  "name": "Short descriptive skill name",
  "description": "One sentence for AI search",
  "tags": "comma, separated, tags",
  "domain": "global" | "sql",
  "content": "Detailed skill body — instructions, patterns, examples, documentation..."
}

domain "sql" means the skill is only injected into the SQL Editor AI context.
domain "global" means the skill is available to all AI agents.`;

    const agent = useAgent({
      systemPrompt,
      tools: netsuiteDocsTools,
      keepHistory: false,
      onToolStart: (name, input) => {
        const inputRecord = input as Record<string, unknown>;
        if (name === "search_netsuite_docs") {
          skillGenerateProgress.value = `Searching docs: "${inputRecord.query ?? ""}"`;
        } else if (name === "read_netsuite_doc_page") {
          const url = String(inputRecord.url ?? "");
          const page = url.split("/").pop() ?? url;
          skillGenerateProgress.value = `Reading: ${decodeURIComponent(page)}`;
        }
      },
      onToolResult: () => {
        skillGenerateProgress.value = "Analysing results…";
      }
    });

    await agent.run(prompt);

    // Extract the last assistant message — that's the JSON output
    const lastMsg = [...agent.history.value]
      .reverse()
      .find((m) => m.role === "assistant");
    let raw = (lastMsg?.content ?? "").trim();
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    const parsed = JSON.parse(raw);

    formData.value = {
      name: String(parsed.name ?? formData.value.name),
      description: String(parsed.description ?? formData.value.description),
      tags: String(parsed.tags ?? formData.value.tags),
      content: String(parsed.content ?? formData.value.content),
      domain: (["global", "sql"] as const).includes(parsed.domain)
        ? parsed.domain
        : formData.value.domain
    };

    skillGenMode.value = "manual";
  } catch (err) {
    skillGenerateError.value = `Generation failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    isGeneratingSkill.value = false;
    skillGenerateProgress.value = "";
  }
};

const selectSkill = (id: number) => {
  selectedSkillId.value = selectedSkillId.value === id ? null : id;
};

const toggleSkillEnabled = async (skill: Skill) => {
  await updateSkill(skill.id!, { enabled: !skill.enabled });
  await refreshSkills();
};

const confirmDelete = (skill: Skill) => {
  deleteTarget.value = skill;
  deleteDialogVisible.value = true;
};

const executeDelete = async () => {
  if (!deleteTarget.value?.id) return;
  await deleteSkill(deleteTarget.value.id);
  deleteDialogVisible.value = false;
  deleteTarget.value = null;
  await refreshSkills();
};

// ── Import / Export ────────────────────────
const onImportClick = () => {
  fileInputRef.value?.click();
};

const onFileSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;

  for (const file of Array.from(files)) {
    try {
      const text = await file.text();

      if (file.name.endsWith(".json")) {
        // JSON: expects an array of SkillExport, or a single SkillExport object
        const parsed = JSON.parse(text);
        const items: SkillExport[] = Array.isArray(parsed) ? parsed : [parsed];

        // Validate structure
        const valid = items.filter(
          (item) =>
            typeof item.name === "string" && typeof item.content === "string"
        );

        if (valid.length > 0) {
          await importSkills(
            valid.map((item) => ({
              name: item.name,
              description: item.description || "",
              tags: item.tags || "",
              content: item.content,
              domain: item.domain ?? "global"
            }))
          );
        }
      } else {
        // .md or .txt: use filename as name, entire content as content
        const name = file.name.replace(/\.(md|txt)$/, "");
        await addSkill({
          name,
          description: `Imported from ${file.name}`,
          tags: "",
          content: text,
          enabled: true
        });
      }
    } catch (err) {
      console.error(`Failed to import ${file.name}:`, err);
    }
  }

  // Reset file input
  input.value = "";
  await refreshSkills();
};

const onExportAll = async () => {
  const data = await exportAllSkills();
  if (data.length === 0) return;

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `skills-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

// ── Helpers ────────────────────────────────
const parseTags = (tags: string): string[] => {
  return tags
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
};

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

const formatSize = (chars: number): string => {
  if (chars < 1000) return `${chars} chars`;
  if (chars < 1_000_000) return `${(chars / 1000).toFixed(1)}K chars`;
  return `${(chars / 1_000_000).toFixed(1)}M chars`;
};
</script>

<style scoped>
.skills-view {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: 100%;
}

/* ── Container ── */
.skills-container {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ── Toolbar ── */
.skills-toolbar {
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

.skill-count {
  font-size: 0.75rem;
  color: var(--p-slate-400);
  white-space: nowrap;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* ── Skills List ── */
.skills-list {
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
  max-width: 320px;
}

/* ── Skill Card ── */
.skill-card {
  background: white;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.skill-card:hover {
  border-color: var(--p-slate-300);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
}

.skill-card.active {
  border-color: var(--p-blue-300);
  background: var(--p-blue-50);
}

.skill-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.skill-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.skill-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--p-slate-800);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-description {
  font-size: 0.75rem;
  color: var(--p-slate-500);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skill-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.skill-card:hover .skill-actions {
  opacity: 1;
}

.skill-toggle {
  transform: scale(0.75);
  transform-origin: center;
}

.skill-card.disabled {
  opacity: 0.5;
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

/* ── Tags ── */
.skill-tags {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}

.skill-tag {
  display: inline-block;
  padding: 0.1rem 0.45rem;
  background: var(--p-slate-100);
  border: 1px solid var(--p-slate-200);
  border-radius: 0.25rem;
  font-size: 0.65rem;
  color: var(--p-slate-600);
  font-weight: 500;
}

/* ── Meta ── */
.skill-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.5rem;
  font-size: 0.675rem;
  color: var(--p-slate-400);
}

.skill-size {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.625rem;
}

/* ── Dialog Form ── */
.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.form-field label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-slate-700);
}

.content-textarea {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  min-height: 200px;
}

.w-full {
  width: 100%;
}

.skill-name-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.skill-domain-badge {
  display: inline-block;
  padding: 0.05rem 0.4rem;
  background: var(--p-indigo-100);
  border: 1px solid var(--p-indigo-200);
  border-radius: 0.25rem;
  font-size: 0.6rem;
  color: var(--p-indigo-600);
  font-weight: 700;
  letter-spacing: 0.04em;
  flex-shrink: 0;
}

/* ── Domain Toggle ── */
.domain-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.375rem;
  overflow: hidden;
  width: fit-content;
}

.domain-btn {
  padding: 0.35rem 0.875rem;
  font-size: 0.8rem;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--p-slate-500);
  cursor: pointer;
  transition: all 0.15s ease;
}

.domain-btn:hover {
  background: var(--p-slate-100);
  color: var(--p-slate-700);
}

.domain-btn-active {
  background: var(--p-slate-700);
  color: white;
}

.domain-hint {
  font-size: 0.72rem;
  color: var(--p-slate-400);
  margin-top: 0.1rem;
}

/* ── Delete Dialog ── */
.delete-message {
  font-size: 0.875rem;
  color: var(--p-slate-700);
  margin: 0;
  line-height: 1.6;
}

/* ── Skill Mode Toggle ── */
.skill-mode-bar {
  display: flex;
  align-items: center;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--p-slate-100);
}

.skill-mode-toggle {
  display: flex;
  gap: 0;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.375rem;
  overflow: hidden;
}

.skill-mode-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.875rem;
  font-size: 0.8rem;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--p-slate-500);
  cursor: pointer;
  transition: all 0.15s ease;
}

.skill-mode-btn:hover {
  background: var(--p-slate-100);
  color: var(--p-slate-700);
}

.skill-mode-btn-active {
  background: var(--p-slate-700);
  color: white;
}

.skill-mode-btn i {
  font-size: 0.75rem;
}

/* ── AI Generate Panel ── */
.generate-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.generate-hint {
  font-size: 0.72rem;
  color: var(--p-slate-400);
}

.generate-error {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--p-red-500);
  background: var(--p-red-50);
  border: 1px solid var(--p-red-200);
  border-radius: 0.375rem;
  padding: 0.5rem 0.75rem;
}

.generate-error i {
  font-size: 0.8rem;
  flex-shrink: 0;
}

.generate-progress {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  color: var(--p-blue-600);
  opacity: 0.85;
  padding: 0.25rem 0.25rem;
}

.label-hint {
  font-weight: 400;
  font-size: 0.7rem;
  color: var(--p-slate-400);
}
</style>
