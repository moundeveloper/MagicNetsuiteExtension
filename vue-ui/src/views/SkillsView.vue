<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Textarea from "primevue/textarea";
import MSelect from "../components/universal/input/MSelect.vue";
import MCard from "../components/universal/card/MCard.vue";
import MessageContentRenderer from "../components/MessageContentRenderer.vue";
import {
  addSkill,
  deleteSkill,
  exportAllSkills,
  getAllSkills,
  importSkills,
  updateSkill,
  type Skill,
  type SkillExport,
  type SkillStatus,
  type SkillSource,
  type SkillConfidence
} from "../utils/skillsDb";

const props = defineProps<{ vhOffset: number }>();

type SkillForm = {
  name: string;
  description: string;
  tags: string;
  triggers: string;
  content: string;
  domain: "global" | "sql";
  status: SkillStatus;
  priority: number;
  source: SkillSource;
  supersedes: string;
  dependencies: number[];
  lastReviewedAt: string;
  confidence: SkillConfidence | "";
};

const statusOptions = ["active", "draft", "deprecated"];
const sourceOptions = ["manual", "ai_saved", "imported", "built_in"];
const confidenceOptions = ["", "low", "medium", "high"].map((value) => ({
  value,
  label: value || "Not set"
}));

const skills = ref<Skill[]>([]);
const selectedId = ref<number | null>(null);
const searchQuery = ref("");
const showDisabled = ref(true);
const viewMode = ref<"edit" | "preview">("edit");
const saving = ref(false);
const statusMessage = ref("");
const dependencyToAdd = ref<number | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const skillListWidth = ref(27);
const isResizingSkillList = ref(false);
const metadataWidth = ref(43);
const isResizingSkillWorkspace = ref(false);
let stopSkillWorkspaceResize: (() => void) | null = null;

const emptyForm = (): SkillForm => ({
  name: "",
  description: "",
  tags: "",
  triggers: "",
  content: "# New Skill\n\n## When To Use\n\n- \n\n## Instructions\n\n- ",
  domain: "global",
  status: "active",
  priority: 50,
  source: "manual",
  supersedes: "",
  dependencies: [],
  lastReviewedAt: new Date().toISOString().slice(0, 10),
  confidence: ""
});

const form = ref<SkillForm>(emptyForm());

const selectedSkill = computed(() =>
  skills.value.find((skill) => skill.id === selectedId.value) ?? null
);

const enabledCount = computed(
  () => skills.value.filter((skill) => skill.enabled !== false).length
);

const filteredSkills = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return skills.value
    .filter((skill) => showDisabled.value || skill.enabled !== false)
    .filter((skill) => {
      if (!query) return true;
      const haystack = `${skill.name} ${skill.description} ${skill.tags} ${skill.triggers ?? ""} ${skill.content}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
});

const isValid = computed(
  () => form.value.name.trim().length > 0 && form.value.content.trim().length > 0
);

const dependencyOptions = computed(() =>
  skills.value
    .filter(
      (skill) =>
        skill.id !== undefined &&
        skill.id !== selectedId.value &&
        skill.enabled !== false &&
        skill.status !== "deprecated" &&
        !form.value.dependencies.includes(skill.id)
    )
    .map((skill) => ({
      value: skill.id!,
      label: skill.name
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
);

const dependencySkills = computed(() =>
  form.value.dependencies
    .map((id) => skills.value.find((skill) => skill.id === id))
    .filter((skill): skill is Skill => Boolean(skill))
);

const loadSkills = async () => {
  skills.value = await getAllSkills();
  if (selectedId.value && skills.value.some((skill) => skill.id === selectedId.value)) {
    return;
  }
  const first = skills.value[0];
  if (first) {
    selectSkill(first);
  } else {
    createNewSkill();
  }
};

const refreshSkills = async () => {
  statusMessage.value = "";
  await loadSkills();
};

const startSkillListResize = (event: MouseEvent) => {
  event.preventDefault();
  isResizingSkillList.value = true;
  const container = (event.currentTarget as HTMLElement).parentElement;
  const startX = event.clientX;
  const startWidth = skillListWidth.value;
  const containerWidth = container?.clientWidth || window.innerWidth;
  const onMove = (moveEvent: MouseEvent) => {
    const deltaPct = ((moveEvent.clientX - startX) / containerWidth) * 100;
    skillListWidth.value = Math.min(45, Math.max(20, startWidth + deltaPct));
  };
  const onUp = () => {
    isResizingSkillList.value = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
};

const resizeSkillList = (delta: number) => {
  skillListWidth.value = Math.min(45, Math.max(20, skillListWidth.value + delta));
};

const startSkillWorkspaceResize = (event: PointerEvent) => {
  if (event.button !== 0) return;
  event.preventDefault();
  isResizingSkillWorkspace.value = true;
  const workspace = (event.currentTarget as HTMLElement).parentElement;
  const startX = event.clientX;
  const startWidth = metadataWidth.value;
  const workspaceWidth = workspace?.clientWidth || window.innerWidth;
  const onMove = (moveEvent: PointerEvent) => {
    const deltaPct = ((moveEvent.clientX - startX) / workspaceWidth) * 100;
    metadataWidth.value = Math.min(62, Math.max(30, startWidth + deltaPct));
  };
  const onUp = () => {
    isResizingSkillWorkspace.value = false;
    document.body.classList.remove("skills-workspace-resizing");
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    stopSkillWorkspaceResize = null;
  };
  document.body.classList.add("skills-workspace-resizing");
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  stopSkillWorkspaceResize = onUp;
};

const resizeSkillWorkspace = (delta: number) => {
  metadataWidth.value = Math.min(62, Math.max(30, metadataWidth.value + delta));
};

const selectSkill = (skill: Skill) => {
  selectedId.value = skill.id ?? null;
  form.value = {
    name: skill.name,
    description: skill.description,
    tags: skill.tags,
    triggers: skill.triggers ?? "",
    content: skill.content,
    domain: skill.domain ?? "global",
    status: skill.status ?? "active",
    priority: skill.priority ?? 50,
    source: skill.source ?? "manual",
    supersedes: (skill.supersedes ?? []).join(", "),
    dependencies: [...(skill.dependencies ?? [])],
    lastReviewedAt: (skill.lastReviewedAt ?? "").slice(0, 10),
    confidence: skill.confidence ?? ""
  };
  statusMessage.value = "";
};

const createNewSkill = () => {
  selectedId.value = null;
  form.value = emptyForm();
  dependencyToAdd.value = null;
  viewMode.value = "edit";
  statusMessage.value = "";
};

const saveSkill = async () => {
  if (!isValid.value || saving.value) return;
  saving.value = true;
  const payload = {
    name: form.value.name.trim(),
    description: form.value.description.trim(),
    tags: form.value.tags.trim(),
    triggers: form.value.triggers.trim(),
    content: form.value.content.trim(),
    domain: form.value.domain,
    status: form.value.status,
    priority: Math.min(100, Math.max(0, Number(form.value.priority) || 0)),
    source: form.value.source,
    supersedes: form.value.supersedes.split(/[\s,]+/).map(Number).filter((id) => Number.isInteger(id) && id > 0),
    dependencies: [...form.value.dependencies],
    lastReviewedAt: form.value.lastReviewedAt
      ? new Date(`${form.value.lastReviewedAt}T00:00:00`).toISOString()
      : undefined,
    confidence: form.value.confidence || undefined
  };
  try {
    if (selectedId.value !== null) {
      await updateSkill(selectedId.value, payload);
    } else {
      selectedId.value = await addSkill({ ...payload, enabled: true });
    }
    statusMessage.value = "Saved";
    await loadSkills();
  } catch (error) {
    statusMessage.value =
      error instanceof Error ? error.message : "Could not save skill.";
  } finally {
    saving.value = false;
  }
};

const addDependency = (value: string | number | null) => {
  const id = Number(value);
  dependencyToAdd.value = null;
  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    id === selectedId.value ||
    form.value.dependencies.includes(id)
  ) return;
  form.value.dependencies.push(id);
};

const removeDependency = (id: number) => {
  form.value.dependencies = form.value.dependencies.filter(
    (dependencyId) => dependencyId !== id
  );
};

const toggleSkillEnabled = async (skill: Skill) => {
  if (skill.id === undefined) return;
  await updateSkill(skill.id, { enabled: skill.enabled === false });
  await loadSkills();
};

const removeSelectedSkill = async () => {
  if (selectedId.value === null) return;
  const target = selectedSkill.value;
  if (!target) return;
  const confirmed = window.confirm(`Delete "${target.name}"?`);
  if (!confirmed) return;
  await deleteSkill(selectedId.value);
  selectedId.value = null;
  await loadSkills();
};

const triggerImport = () => fileInputRef.value?.click();

const importSkillFiles = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!files.length) return;

  for (const file of files) {
    const text = await file.text();
    if (file.name.toLowerCase().endsWith(".json")) {
      const parsed = JSON.parse(text);
      const items: SkillExport[] = Array.isArray(parsed) ? parsed : [parsed];
      await importSkills(items);
      continue;
    }
    const name = file.name.replace(/\.(md|txt)$/i, "");
    await addSkill({
      name,
      description: `Imported from ${file.name}`,
      tags: "imported",
      triggers: "",
      content: text,
      enabled: true,
      domain: "global",
      status: "draft",
      source: "imported"
    });
  }
  input.value = "";
  statusMessage.value = `Imported ${files.length} file${files.length === 1 ? "" : "s"}`;
  await loadSkills();
};

const exportSkills = async () => {
  const data = await exportAllSkills();
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `skills-export-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const parseTags = (tags: string): string[] =>
  tags
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 4);

const formatDate = (value?: string): string => {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
};

onMounted(async () => {
  await chrome.runtime
    .sendMessage({ type: "ENSURE_RECORD_BINDING_SKILL" })
    .catch(() => undefined);
  await loadSkills();
});

onBeforeUnmount(() => {
  isResizingSkillList.value = false;
  stopSkillWorkspaceResize?.();
});
</script>

<template>
  <MCard
    flex
    autoHeight
    direction="row"
    gap="0.5"
    padding=""
    outlined
    elevated
    class="skills-shell"
    :style="{ height: `${vhOffset}vh`, overflow: 'hidden' }"
  >
    <template #default>
      <main class="skills-main">
        <header class="skills-toolbar">
          <div class="toolbar-left">
            <i class="pi pi-book skills-toolbar-icon" />
            <span class="skills-title">Skills</span>
            <span class="skills-count">{{ filteredSkills.length }} / {{ skills.length }}</span>
            <span class="skills-count skills-count--enabled">{{ enabledCount }} enabled</span>
          </div>
          <div class="toolbar-right">
            <InputText v-model="searchQuery" placeholder="Search skills..." class="skills-search" />
            <label class="toolbar-filter" title="Include disabled skills in the list">
              <input v-model="showDisabled" type="checkbox" />
              <span>Disabled</span>
            </label>
            <input
              ref="fileInputRef"
              hidden
              multiple
              type="file"
              accept=".json,.md,.txt"
              @change="importSkillFiles"
            />
            <button type="button" class="toolbar-btn" title="Import skills" @click="triggerImport">
              <i class="pi pi-upload" />
            </button>
            <button type="button" class="toolbar-btn" title="Export skills" @click="exportSkills">
              <i class="pi pi-download" />
            </button>
            <button
              type="button"
              class="toolbar-btn"
              title="Refresh skills"
              @click="refreshSkills"
            >
              <i class="pi pi-refresh" />
            </button>
            <button type="button" class="toolbar-btn" title="New skill" @click="createNewSkill">
              <i class="pi pi-plus" />
            </button>
          </div>
        </header>

        <section class="skills-body">
          <aside class="skill-list" :style="{ flexBasis: `${skillListWidth}%` }">
            <button
              v-for="skill in filteredSkills"
              :key="skill.id"
              type="button"
              class="skill-row"
              :class="{ active: skill.id === selectedId, muted: skill.enabled === false }"
              @click="selectSkill(skill)"
            >
              <span class="skill-row-icon"><i class="pi pi-book" /></span>
              <span class="skill-row-main">
                <strong>{{ skill.name }}</strong>
                <small>{{ skill.description || "No description" }}</small>
                <span class="skill-tags">
                  <span v-if="skill.domain === 'sql'" class="skill-tag skill-tag--strong">SQL</span>
                  <span class="skill-tag" :class="`skill-tag--${skill.status ?? 'active'}`">
                    {{ skill.status ?? "active" }}
                  </span>
                  <span v-for="tag in parseTags(skill.tags)" :key="`${skill.id}-${tag}`" class="skill-tag">
                    {{ tag }}
                  </span>
                  <span v-if="skill.dependencies?.length" class="skill-tag skill-tag--dependency">
                    {{ skill.dependencies.length }} sub
                  </span>
                </span>
              </span>
              <span class="skill-row-meta">{{ formatDate(skill.updatedAt) }}</span>
            </button>
            <div v-if="filteredSkills.length === 0" class="skill-empty">
              <i class="pi pi-search" />
              <span>No skills found.</span>
            </div>
          </aside>

          <div
            class="skill-list-resize-handle"
            :class="{ 'skill-list-resize-handle--active': isResizingSkillList }"
            role="separator"
            tabindex="0"
            aria-label="Resize the skill list"
            aria-orientation="vertical"
            :aria-valuenow="Math.round(skillListWidth)"
            aria-valuemin="20"
            aria-valuemax="45"
            @mousedown="startSkillListResize"
            @keydown.left.prevent="resizeSkillList(-2)"
            @keydown.right.prevent="resizeSkillList(2)"
          />

          <section class="skill-editor">
            <div class="editor-header">
              <div class="editor-title">
                <strong>{{ selectedId === null ? "New Skill" : form.name || "Untitled Skill" }}</strong>
                <span>{{ selectedSkill?.enabled === false ? "Disabled" : "Enabled" }} · {{ form.status }} · priority {{ form.priority }}</span>
              </div>
              <div class="editor-actions">
                <button
                  v-if="selectedSkill"
                  type="button"
                  class="switch"
                  :class="{ active: selectedSkill.enabled !== false }"
                  title="Enable or disable skill"
                  @click="toggleSkillEnabled(selectedSkill)"
                >
                  <span />
                </button>
              </div>
            </div>

            <div class="skill-editor-workspace">
              <div class="editor-form" :style="{ flexBasis: `${metadataWidth}%` }">
                <div class="workspace-heading">
                  <i class="pi pi-sliders-h" />
                  <span>Skill settings</span>
                </div>
                <div class="field-grid">
                  <label class="skill-name-field">
                    <span>Name</span>
                    <InputText v-model="form.name" class="skill-input" />
                  </label>
                  <label>
                    <span>Domain</span>
                    <div class="domain-toggle">
                      <button type="button" :class="{ active: form.domain === 'global' }" @click="form.domain = 'global'">
                        Global
                      </button>
                      <button type="button" :class="{ active: form.domain === 'sql' }" @click="form.domain = 'sql'">
                        SQL
                      </button>
                    </div>
                  </label>
                  <label>
                    <span>Status</span>
                    <MSelect v-model="form.status" :options="statusOptions" size="small" />
                  </label>
                  <label class="field-wide">
                    <span>Description</span>
                    <InputText v-model="form.description" class="skill-input" />
                  </label>
                  <label class="field-wide">
                    <span>Tags</span>
                    <InputText v-model="form.tags" class="skill-input" placeholder="suiteql, scripts, records" />
                  </label>
                  <label class="field-wide">
                    <span>Routing triggers (one phrase per line)</span>
                    <Textarea v-model="form.triggers" class="skill-input skill-triggers" rows="4" placeholder="characters spaced out&#10;advanced pdf spacing&#10;freemarker pdf layout" />
                  </label>
                  <label>
                    <span>Priority (0–100)</span>
                    <InputNumber v-model="form.priority" :min="0" :max="100" :use-grouping="false" class="skill-input" />
                  </label>
                  <label>
                    <span>Source</span>
                    <MSelect v-model="form.source" :options="sourceOptions" size="small" />
                  </label>
                  <label>
                    <span>Confidence</span>
                    <MSelect v-model="form.confidence" :options="confidenceOptions" option-label="label" option-value="value" size="small" />
                  </label>
                  <label>
                    <span>Last reviewed</span>
                    <InputText v-model="form.lastReviewedAt" type="date" class="skill-input" />
                  </label>
                  <label class="field-wide">
                    <span>Supersedes skill IDs</span>
                    <InputText v-model="form.supersedes" class="skill-input" placeholder="12, 18" />
                  </label>
                  <div class="field-wide dependency-field">
                    <span>Calls sub-skills</span>
                    <MSelect
                      :model-value="dependencyToAdd"
                      :options="dependencyOptions"
                      option-label="label"
                      option-value="value"
                      searchable
                      size="small"
                      placeholder="Add reusable sub-skill…"
                      @update:model-value="addDependency"
                    />
                    <div v-if="dependencySkills.length" class="dependency-list">
                      <span
                        v-for="dependency in dependencySkills"
                        :key="dependency.id"
                        class="dependency-chip"
                        :title="`Loaded automatically with ${form.name || 'this skill'}`"
                      >
                        <i class="pi pi-share-alt" />
                        <span>{{ dependency.name }}</span>
                        <button
                          type="button"
                          :aria-label="`Remove ${dependency.name}`"
                          @click="removeDependency(dependency.id!)"
                        >
                          <i class="pi pi-times" />
                        </button>
                      </span>
                    </div>
                    <small>Loaded recursively in this order; circular calls are rejected.</small>
                  </div>
                </div>
              </div>

              <div
                class="skill-workspace-resize-handle"
                :class="{ 'skill-workspace-resize-handle--active': isResizingSkillWorkspace }"
                role="separator"
                tabindex="0"
                aria-label="Resize skill settings and content panels"
                aria-orientation="vertical"
                :aria-valuenow="Math.round(metadataWidth)"
                aria-valuemin="30"
                aria-valuemax="62"
                @pointerdown="startSkillWorkspaceResize"
                @keydown.left.prevent="resizeSkillWorkspace(-2)"
                @keydown.right.prevent="resizeSkillWorkspace(2)"
              >
                <span />
              </div>

              <section class="skill-content-workspace">
                <header class="content-toolbar">
                  <div class="content-title">
                    <i class="pi pi-file-edit" />
                    <span>Skill content</span>
                  </div>
                  <div class="mode-segment">
                    <button type="button" :class="{ active: viewMode === 'edit' }" @click="viewMode = 'edit'">
                      <i class="pi pi-pencil" />
                      <span>Edit</span>
                    </button>
                    <button type="button" :class="{ active: viewMode === 'preview' }" @click="viewMode = 'preview'">
                      <i class="pi pi-eye" />
                      <span>Preview</span>
                    </button>
                  </div>
                </header>
                <div class="content-panel">
                  <Textarea
                    v-if="viewMode === 'edit'"
                    v-model="form.content"
                    class="skill-content"
                    rows="18"
                  />
                  <div v-else class="markdown-preview">
                    <MessageContentRenderer :content="form.content || '_No Markdown content yet._'" />
                  </div>
                </div>
              </section>
            </div>

            <footer class="editor-footer">
              <span class="status-text">{{ statusMessage }}</span>
              <button
                v-if="selectedId !== null"
                type="button"
                class="danger-btn"
                title="Delete skill"
                @click="removeSelectedSkill"
              >
                <i class="pi pi-trash" />
                <span>Delete</span>
              </button>
              <button type="button" class="primary-btn" :disabled="!isValid || saving" @click="saveSkill">
                <i :class="saving ? 'pi pi-spin pi-spinner' : 'pi pi-check'" />
                <span>{{ saving ? "Saving" : "Save Skill" }}</span>
              </button>
            </footer>
          </section>
        </section>
      </main>
    </template>
  </MCard>
</template>

<style scoped>
.skills-shell {
  --skills-accent: #4f46e5;
  --skills-accent-border: #a5b4fc;
  --skills-accent-surface: #f1f4fe;
  --skills-accent-icon-surface: #e0e7ff;
  gap: 0 !important;
}

.skills-main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
}

.skills-toolbar {
  display: flex;
  min-height: 44px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--p-slate-200);
  background: #fbfcfd;
}

.skills-toolbar-icon {
  color: var(--skills-accent);
}

.toolbar-left,
.toolbar-right,
.editor-actions,
.editor-footer,
.skill-tags {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.skills-title {
  color: var(--p-slate-800);
  font-size: 1rem;
  font-weight: 700;
}

.skills-count,
.skill-tag {
  border: 1px solid var(--p-slate-200);
  border-radius: 999px;
  background: var(--p-slate-100);
  color: var(--p-slate-500);
  font-size: 0.68rem;
  font-weight: 700;
  padding: 2px 7px;
  white-space: nowrap;
}

.skills-count--enabled {
  border-color: var(--skills-accent-border);
  background: var(--skills-accent-surface);
  color: var(--skills-accent);
}

.skills-search {
  width: 240px;
}

.toolbar-filter,
.toolbar-btn {
  display: inline-flex;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  background: white;
  color: var(--p-slate-600);
  font-size: 0.72rem;
  white-space: nowrap;
}

.toolbar-filter {
  gap: 5px;
  padding: 0 8px;
  cursor: pointer;
}

.toolbar-filter input {
  margin: 0;
  accent-color: var(--skills-accent);
}

.toolbar-btn {
  width: 30px;
  flex-shrink: 0;
  cursor: pointer;
}

.toolbar-btn:hover,
.toolbar-filter:hover {
  border-color: var(--skills-accent-border);
  background: var(--skills-accent-surface);
  color: var(--skills-accent);
}

.skills-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.skill-list {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow-y: auto;
  border-right: 1px solid var(--p-slate-200);
  background: #f8fafc;
  flex: 0 0 auto;
}

.skill-list-resize-handle {
  position: relative;
  flex: 0 0 7px;
  cursor: col-resize;
  border-inline: 1px solid var(--p-slate-200);
  background: #eef2f6;
  transition: background 0.15s, border-color 0.15s;
}

.skill-list-resize-handle::after {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 30px;
  border-radius: 999px;
  background: #a8b3bf;
  content: "";
  transform: translate(-50%, -50%);
}

.skill-list-resize-handle:hover,
.skill-list-resize-handle:focus-visible,
.skill-list-resize-handle--active {
  outline: none;
  border-color: var(--skills-accent-border);
  background: var(--skills-accent-icon-surface);
}

.skill-list-resize-handle:hover::after,
.skill-list-resize-handle:focus-visible::after,
.skill-list-resize-handle--active::after {
  background: var(--skills-accent);
}

.skill-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  min-width: 0;
  padding: 8px 10px;
  border: 0;
  border-bottom: 1px solid var(--p-slate-200);
  background: transparent;
  color: var(--p-slate-700);
  text-align: left;
  cursor: pointer;
}

.skill-row:hover {
  background: #f4f6f8;
}

.skill-row.active {
  background: var(--skills-accent-surface);
  color: var(--skills-accent);
  outline: 1px solid var(--skills-accent-border);
  outline-offset: -1px;
}

.skill-row.muted {
  opacity: 0.58;
}

.skill-row-icon {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: var(--p-slate-500);
}

.skill-row.active .skill-row-icon {
  color: var(--skills-accent);
  background: var(--skills-accent-icon-surface);
}

.skill-row-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.skill-row-main strong,
.skill-row-main small,
.skill-row-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-row-main strong {
  color: var(--p-slate-800);
  font-size: 0.82rem;
}

.skill-row-main small,
.skill-row-meta,
.status-text {
  color: var(--p-slate-400);
  font-size: 0.68rem;
}

.skill-tag {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-tag--strong {
  border-color: var(--skills-accent-border);
  background: var(--skills-accent-surface);
  color: var(--skills-accent);
}

.skill-tag--dependency {
  border-color: var(--skills-accent-border);
  background: var(--skills-accent-icon-surface);
  color: var(--skills-accent);
}

.skill-tag--draft {
  border-color: var(--p-amber-200);
  background: var(--p-amber-50);
  color: var(--p-amber-700);
}

.skill-tag--deprecated {
  text-decoration: line-through;
  opacity: 0.72;
}

.skill-editor {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: white;
}

.editor-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--p-slate-200);
  background: #fbfcfd;
}

.editor-title {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.editor-title strong {
  overflow: hidden;
  color: var(--p-slate-800);
  font-size: 0.9rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-title span {
  color: var(--p-slate-400);
  font-size: 0.68rem;
  font-weight: 700;
}

.mode-segment,
.domain-toggle {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  background: #f8fafc;
}

.mode-segment button,
.domain-toggle button,
.primary-btn,
.danger-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  border-radius: 6px;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 750;
  white-space: nowrap;
  cursor: pointer;
}

.mode-segment button,
.domain-toggle button {
  border: 0;
  padding: 0 10px;
  background: transparent;
  color: var(--p-slate-500);
}

.mode-segment button.active,
.domain-toggle button.active {
  outline: 1px solid var(--skills-accent-border);
  outline-offset: -1px;
  background: var(--skills-accent-surface);
  color: var(--skills-accent);
  box-shadow: none;
}

.skill-editor-workspace {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.editor-form {
  display: flex;
  flex: 0 0 auto;
  min-width: 300px;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
  padding: 9px 10px;
  overflow: auto;
  background: #fbfcfd;
}

.workspace-heading,
.content-title {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  color: var(--p-slate-700);
  font-size: 0.74rem;
  font-weight: 800;
}

.workspace-heading i,
.content-title i {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: var(--skills-accent-icon-surface);
  color: var(--skills-accent);
  font-size: 0.72rem;
}

.field-grid {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px 8px;
}

.field-wide {
  grid-column: 1 / -1;
}

.skill-name-field {
  grid-column: span 2;
}

.field-grid label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-grid label > span,
.dependency-field > span {
  margin: 0;
  color: var(--p-slate-400);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.dependency-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}

.dependency-field > small {
  color: var(--p-slate-400);
  font-size: 0.66rem;
}

.dependency-list {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 5px;
}

.dependency-chip {
  display: inline-flex;
  max-width: 100%;
  min-width: 0;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--skills-accent-border);
  border-radius: 5px;
  background: var(--skills-accent-surface);
  color: var(--skills-accent);
  padding: 3px 5px 3px 7px;
  font-size: 0.7rem;
  font-weight: 700;
}

.dependency-chip > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dependency-chip button {
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.dependency-chip button:hover {
  background: var(--skills-accent-icon-surface);
}

.skill-input,
.skill-content {
  width: 100%;
  border: 1px solid var(--p-slate-300);
  border-radius: 5px;
  background: white;
  color: var(--p-slate-800);
  font: inherit;
  font-size: 0.82rem;
}

.skill-triggers {
  min-height: 4.25rem;
  resize: none;
  padding: 7px 9px;
}

.skill-workspace-resize-handle {
  position: relative;
  z-index: 2;
  display: flex;
  flex: 0 0 7px;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  border-inline: 1px solid var(--p-slate-200);
  background: #eef2f6;
  touch-action: none;
  transition: background 0.15s, border-color 0.15s;
}

.skill-workspace-resize-handle span {
  width: 2px;
  height: 32px;
  border-radius: 999px;
  background: #a8b3bf;
}

.skill-workspace-resize-handle:hover,
.skill-workspace-resize-handle:focus-visible,
.skill-workspace-resize-handle--active {
  outline: none;
  border-color: var(--skills-accent-border);
  background: var(--skills-accent-icon-surface);
}

.skill-workspace-resize-handle:hover span,
.skill-workspace-resize-handle:focus-visible span,
.skill-workspace-resize-handle--active span {
  background: var(--skills-accent);
}

:global(body.skills-workspace-resizing) {
  cursor: col-resize;
  user-select: none;
}

.skill-content-workspace {
  display: flex;
  flex: 1 1 0;
  min-width: 360px;
  min-height: 0;
  flex-direction: column;
  background: white;
}

.content-toolbar {
  display: flex;
  min-height: 40px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px 4px 10px;
  border-bottom: 1px solid var(--p-slate-200);
  background: #eef3f7;
}

.skill-content {
  display: block;
  height: 100%;
  min-height: 0;
  resize: none;
  overflow: auto;
  padding: 10px;
  font-family: "JetBrains Mono", monospace;
  line-height: 1.5;
}

.content-panel {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: white;
}

.markdown-preview {
  height: 100%;
  overflow: auto;
  padding: 14px 16px;
  color: var(--p-slate-700);
}

.editor-footer {
  justify-content: flex-end;
  flex-shrink: 0;
  padding: 7px 10px;
  border-top: 1px solid var(--p-slate-200);
  background: #fbfcfd;
}

.status-text {
  margin-right: auto;
  font-weight: 700;
}

.primary-btn,
.danger-btn {
  border: 1px solid transparent;
  padding: 6px 11px;
}

.primary-btn {
  background: var(--p-slate-800);
  color: white;
}

.primary-btn:hover:not(:disabled) {
  background: var(--skills-accent);
}

.primary-btn:disabled {
  background: var(--p-slate-300);
  cursor: default;
}

.danger-btn {
  border-color: var(--p-red-200);
  background: var(--p-red-50);
  color: var(--p-red-600);
}

.switch {
  position: relative;
  width: 32px;
  height: 18px;
  flex-shrink: 0;
  border: 1px solid var(--p-slate-300);
  border-radius: 999px;
  background: var(--p-slate-100);
  cursor: pointer;
}

.switch span {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.2);
  transition: transform 0.14s ease;
}

.switch.active {
  border-color: var(--skills-accent-border);
  background: var(--skills-accent-surface);
}

.switch.active span {
  transform: translateX(14px);
  background: var(--skills-accent);
}

.skill-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 120px;
  color: var(--p-slate-400);
  font-size: 0.78rem;
}

@media (max-width: 980px) {
  .skills-body {
    flex-direction: column;
  }

  .skill-list {
    flex-basis: auto !important;
    max-height: 34vh;
    border-right: 0;
    border-bottom: 1px solid var(--p-slate-200);
  }

  .skill-list-resize-handle {
    display: none;
  }

  .skills-search {
    width: min(220px, 45vw);
  }

  .skill-editor-workspace {
    min-height: 560px;
  }

  .toolbar-filter span {
    display: none;
  }

  .toolbar-filter {
    width: 30px;
    padding: 0;
  }
}

@media (max-width: 760px) {
  .skill-editor-workspace {
    flex-direction: column;
  }

  .editor-form {
    flex-basis: auto !important;
    width: 100%;
    max-height: 44%;
  }

  .skill-workspace-resize-handle {
    display: none;
  }

  .skill-content-workspace {
    min-width: 0;
  }

  .skills-count--enabled {
    display: none;
  }
}
</style>
