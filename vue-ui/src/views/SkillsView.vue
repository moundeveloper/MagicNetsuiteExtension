<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import MCard from "../components/universal/card/MCard.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MessageContentRenderer from "../components/MessageContentRenderer.vue";
import {
  addSkill,
  deleteSkill,
  exportAllSkills,
  getAllSkills,
  importSkills,
  updateSkill,
  type Skill,
  type SkillExport
} from "../utils/skillsDb";

const props = defineProps<{ vhOffset: number }>();

type SkillForm = {
  name: string;
  description: string;
  tags: string;
  content: string;
  domain: "global" | "sql";
};

const skills = ref<Skill[]>([]);
const selectedId = ref<number | null>(null);
const searchQuery = ref("");
const showDisabled = ref(true);
const viewMode = ref<"edit" | "preview">("edit");
const saving = ref(false);
const statusMessage = ref("");
const fileInputRef = ref<HTMLInputElement | null>(null);
const skillListWidth = ref(34);
const isResizingSkillList = ref(false);

const emptyForm = (): SkillForm => ({
  name: "",
  description: "",
  tags: "",
  content: "# New Skill\n\n## When To Use\n\n- \n\n## Instructions\n\n- ",
  domain: "global"
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
      const haystack = `${skill.name} ${skill.description} ${skill.tags} ${skill.content}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
});

const isValid = computed(
  () => form.value.name.trim().length > 0 && form.value.content.trim().length > 0
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
    skillListWidth.value = Math.min(55, Math.max(22, startWidth + deltaPct));
  };
  const onUp = () => {
    isResizingSkillList.value = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
};

const selectSkill = (skill: Skill) => {
  selectedId.value = skill.id ?? null;
  form.value = {
    name: skill.name,
    description: skill.description,
    tags: skill.tags,
    content: skill.content,
    domain: skill.domain ?? "global"
  };
  statusMessage.value = "";
};

const createNewSkill = () => {
  selectedId.value = null;
  form.value = emptyForm();
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
    content: form.value.content.trim(),
    domain: form.value.domain
  };
  try {
    if (selectedId.value !== null) {
      await updateSkill(selectedId.value, payload);
    } else {
      selectedId.value = await addSkill({ ...payload, enabled: true });
    }
    statusMessage.value = "Saved";
    await loadSkills();
  } finally {
    saving.value = false;
  }
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
      content: text,
      enabled: true,
      domain: "global"
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
    .slice(0, 8);

const formatDate = (value?: string): string => {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
};

onMounted(loadSkills);

onBeforeUnmount(() => {
  isResizingSkillList.value = false;
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
    :style="{ height: `${vhOffset}vh`, overflow: 'hidden' }"
  >
    <template #default>
      <ExpandableSidebar expandedWidth="250px" :defaultExpanded="true">
        <template #collapsed>
          <button type="button" class="sidebar-icon-btn" title="New skill" @click="createNewSkill">
            <i class="pi pi-plus" />
          </button>
        </template>
        <template #default>
          <div class="sidebar-section">
            <div class="sidebar-section-header">
              <h4>Library</h4>
              <button type="button" class="sidebar-icon-btn" title="New skill" @click="createNewSkill">
                <i class="pi pi-plus" />
              </button>
            </div>
            <div class="stat-row">
              <span class="stat-label">Total</span>
              <span class="stat-value">{{ skills.length }}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Enabled</span>
              <span class="stat-value stat-value--enabled">{{ enabledCount }}</span>
            </div>
          </div>

          <div class="sidebar-section">
            <div class="sidebar-section-header">
              <h4>Filters</h4>
            </div>
            <label class="filter-toggle">
              <input v-model="showDisabled" type="checkbox" />
              <span>Show disabled</span>
            </label>
          </div>

          <div class="sidebar-section">
            <div class="sidebar-section-header">
              <h4>Import / Export</h4>
            </div>
            <input
              ref="fileInputRef"
              hidden
              multiple
              type="file"
              accept=".json,.md,.txt"
              @change="importSkillFiles"
            />
            <button type="button" class="side-action-btn" @click="triggerImport">
              <i class="pi pi-upload" />
              <span>Import</span>
            </button>
            <button type="button" class="side-action-btn" @click="exportSkills">
              <i class="pi pi-download" />
              <span>Export</span>
            </button>
          </div>
        </template>
      </ExpandableSidebar>

      <main class="skills-main">
        <header class="skills-toolbar">
          <div class="toolbar-left">
            <i class="pi pi-book text-[#7b2ff7]" />
            <span class="skills-title">Skills</span>
            <span class="skills-count">{{ filteredSkills.length }} / {{ skills.length }}</span>
          </div>
          <div class="toolbar-right">
            <InputText v-model="searchQuery" placeholder="Search skills..." class="skills-search" />
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
                  <span v-for="tag in parseTags(skill.tags)" :key="`${skill.id}-${tag}`" class="skill-tag">
                    {{ tag }}
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
            @mousedown="startSkillListResize"
          />

          <section class="skill-editor">
            <div class="editor-header">
              <div class="editor-title">
                <strong>{{ selectedId === null ? "New Skill" : form.name || "Untitled Skill" }}</strong>
                <span>{{ selectedSkill?.enabled === false ? "Disabled" : "Enabled" }}</span>
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
              </div>
            </div>

            <div class="editor-form">
              <div class="field-grid">
                <label>
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
                <label class="field-wide">
                  <span>Description</span>
                  <InputText v-model="form.description" class="skill-input" />
                </label>
                <label class="field-wide">
                  <span>Tags</span>
                  <InputText v-model="form.tags" class="skill-input" placeholder="suiteql, scripts, records" />
                </label>
              </div>

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
.skills-main {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
}

.skills-toolbar {
  display: flex;
  min-height: 48px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--p-slate-200);
  background: #fbfcfd;
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
.stat-value,
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

.skills-search {
  width: 240px;
}

.toolbar-btn,
.sidebar-icon-btn {
  display: inline-flex;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  background: white;
  color: var(--p-slate-600);
  cursor: pointer;
}

.toolbar-btn:hover,
.sidebar-icon-btn:hover,
.side-action-btn:hover {
  border-color: #d8c6ff;
  background: #faf7ff;
  color: #7b2ff7;
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
  flex: 0 0 5px;
  cursor: col-resize;
  border-right: 1px solid var(--p-slate-200);
  background: #f8fafc;
  transition: background 0.15s;
}

.skill-list-resize-handle:hover,
.skill-list-resize-handle--active {
  background: #d8c6ff;
}

.skill-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  min-width: 0;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid var(--p-slate-200);
  background: transparent;
  color: var(--p-slate-700);
  text-align: left;
  cursor: pointer;
}

.skill-row:hover,
.skill-row.active {
  background: #faf7ff;
  color: #7b2ff7;
  outline: 1px solid #d8c6ff;
  outline-offset: -1px;
}

.skill-row.muted {
  opacity: 0.58;
}

.skill-row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #7b2ff7;
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

.skill-tag--strong,
.stat-value--enabled {
  border-color: #d8c6ff;
  background: #faf7ff;
  color: #7b2ff7;
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
  padding: 10px 12px;
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
  border-radius: 7px;
  background: #f8fafc;
}

.mode-segment button,
.domain-toggle button,
.primary-btn,
.danger-btn,
.side-action-btn {
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
  background: white;
  color: #7b2ff7;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

.editor-form {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow: hidden;
}

.field-grid {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
}

.field-wide {
  grid-column: 1 / -1;
}

.field-grid label,
.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-grid label > span,
.sidebar-section h4 {
  margin: 0;
  color: var(--p-slate-400);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.skill-input,
.skill-content {
  width: 100%;
  border: 1px solid var(--p-slate-300);
  border-radius: 7px;
  background: white;
  color: var(--p-slate-800);
  font: inherit;
  font-size: 0.82rem;
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
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  background: #fbfcfd;
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
  padding: 10px 12px;
  border-top: 1px solid var(--p-slate-200);
  background: #fbfcfd;
}

.status-text {
  margin-right: auto;
  font-weight: 700;
}

.primary-btn,
.danger-btn,
.side-action-btn {
  border: 1px solid transparent;
  padding: 6px 11px;
}

.primary-btn {
  background: var(--p-slate-800);
  color: white;
}

.primary-btn:hover:not(:disabled) {
  background: #6d28d9;
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

.side-action-btn {
  width: 100%;
  border-color: var(--p-slate-200);
  background: var(--p-slate-100);
  color: var(--p-slate-600);
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
  border-color: #d8c6ff;
  background: #faf7ff;
}

.switch.active span {
  transform: translateX(14px);
  background: #7b2ff7;
}

.sidebar-section {
  padding: 0.65rem 0.55rem;
  border-bottom: 1px solid var(--p-slate-200);
}

.sidebar-section-header,
.stat-row,
.filter-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.filter-toggle {
  justify-content: flex-start;
  color: var(--p-slate-600);
  font-size: 0.75rem;
}

.filter-toggle input {
  accent-color: #7b2ff7;
}

.stat-label {
  color: var(--p-slate-500);
  font-size: 0.75rem;
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
}
</style>
