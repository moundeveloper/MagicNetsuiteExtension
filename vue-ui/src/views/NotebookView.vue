<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useToast } from "primevue/usetoast";
import MCard from "../components/universal/card/MCard.vue";
import MSelect from "../components/universal/input/MSelect.vue";
import {
  bulkImportNotebookEntries,
  deleteNotebookEntry,
  getNotebookEntries,
  upsertNotebookEntry,
  type NotebookEntry,
  type NotebookEntryType
} from "../utils/notebookDb";

const toast = useToast();
const route = useRoute();

const entries = ref<NotebookEntry[]>([]);
const selectedId = ref("");
const search = ref("");
const typeFilter = ref<NotebookEntryType | "all">("all");
const groupFilter = ref("all");
const showArchived = ref(false);
const saving = ref(false);
const customGroups = ref<string[]>([]);
const creatingGroup = ref(false);
const newGroupName = ref("");
const NOTEBOOK_GROUPS_KEY = "magic-netsuite-notebook-groups";

type DraftEntry = Omit<NotebookEntry, "createdAt" | "updatedAt">;

const blankDraft = (type: NotebookEntryType = "note"): DraftEntry => ({
  id: "",
  type,
  title: "",
  summary: "",
  body: "",
  tags: [],
  url: "",
  netsuiteId: "",
  recordType: "",
  scriptId: "",
  filePath: "",
  code: "",
  group: "General",
  pinned: false,
  archived: false
});

const draft = ref<DraftEntry>(blankDraft());
const tagInput = ref("");

const typeOptions: Array<{
  label: string;
  value: NotebookEntryType | "all";
  icon: string;
}> = [
  { label: "All", value: "all", icon: "pi pi-sparkles" },
  { label: "Notes", value: "note", icon: "pi pi-pencil" },
  { label: "Records", value: "record", icon: "pi pi-id-card" },
  { label: "Scripts", value: "script", icon: "pi pi-code" },
  { label: "Queries", value: "query", icon: "pi pi-database" },
  { label: "Files", value: "file", icon: "pi pi-folder" },
  { label: "Docs", value: "docs", icon: "pi pi-book" },
  { label: "Links", value: "link", icon: "pi pi-link" }
];

const entryTypes = typeOptions.filter(
  (
    option
  ): option is { label: string; value: NotebookEntryType; icon: string } =>
    option.value !== "all"
);

const selectedEntry = computed(
  () => entries.value.find((entry) => entry.id === selectedId.value) ?? null
);

const filteredEntries = computed(() => {
  const q = search.value.trim().toLowerCase();
  return entries.value.filter((entry) => {
    if (!showArchived.value && entry.archived) return false;
    if (typeFilter.value !== "all" && entry.type !== typeFilter.value)
      return false;
    if (
      groupFilter.value !== "all" &&
      (entry.group || "General") !== groupFilter.value
    )
      return false;
    const haystack = [
      entry.title,
      entry.summary,
      entry.body,
      entry.url,
      entry.netsuiteId,
      entry.recordType,
      entry.scriptId,
      entry.filePath,
      entry.code,
      entry.group,
      entry.tags.join(" ")
    ]
      .join(" ")
      .toLowerCase();
    return !q || haystack.includes(q);
  });
});

const groups = computed(() =>
  Array.from(
    new Set([
      "General",
      ...customGroups.value,
      ...entries.value.map((entry) => entry.group || "General")
    ])
  )
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
);
const groupOptions = computed(() => [
  { label: "All groups", value: "all" },
  ...groups.value.map((group) => ({ label: group, value: group }))
]);
const draftGroupOptions = computed(() =>
  Array.from(
    new Set(["General", ...groups.value, draft.value.group].filter(Boolean))
  ).map((group) => ({
    label: group,
    value: group
  }))
);

const singularTypeLabels: Record<NotebookEntryType, string> = {
  note: "Note",
  record: "Record",
  script: "Script",
  query: "Query",
  file: "File",
  docs: "Docs",
  link: "Link"
};

const typeLabel = (type: NotebookEntryType) => singularTypeLabels[type] ?? type;

const typeIcon = (type: NotebookEntryType) =>
  entryTypes.find((option) => option.value === type)?.icon ?? "pi pi-bookmark";

const groupedEntries = computed(() => {
  const map = new Map<string, NotebookEntry[]>();
  for (const entry of filteredEntries.value) {
    const group = entry.group || "General";
    if (!map.has(group)) map.set(group, []);
    map.get(group)?.push(entry);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, items]) => ({ group, items }));
});

const saveGroups = () => {
  localStorage.setItem(NOTEBOOK_GROUPS_KEY, JSON.stringify(customGroups.value));
};

const loadGroups = () => {
  try {
    const raw = localStorage.getItem(NOTEBOOK_GROUPS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    customGroups.value = Array.isArray(parsed)
      ? parsed.map((group) => String(group).trim()).filter(Boolean)
      : [];
  } catch {
    customGroups.value = [];
  }
};

const createGroup = () => {
  const name = newGroupName.value.trim();
  if (!name) return;
  const exists = groups.value.some(
    (group) => group.toLowerCase() === name.toLowerCase()
  );
  if (!exists) {
    customGroups.value = [...customGroups.value, name].sort((a, b) =>
      a.localeCompare(b)
    );
    saveGroups();
  }
  groupFilter.value = exists
    ? (groups.value.find(
        (group) => group.toLowerCase() === name.toLowerCase()
      ) ?? name)
    : name;
  draft.value.group = groupFilter.value;
  newGroupName.value = "";
  creatingGroup.value = false;
  toast.add({
    severity: "success",
    summary: "Group ready",
    detail: `${groupFilter.value} selected`,
    life: 1800
  });
};

const loadEntries = async () => {
  entries.value = await getNotebookEntries();
  if (
    !selectedId.value ||
    !entries.value.some((entry) => entry.id === selectedId.value)
  ) {
    selectedId.value = filteredEntries.value[0]?.id ?? "";
  }
  if (selectedEntry.value) loadDraft(selectedEntry.value);
};

const loadDraft = (entry: NotebookEntry) => {
  draft.value = {
    id: entry.id,
    type: entry.type,
    title: entry.title,
    summary: entry.summary,
    body: entry.body,
    tags: [...entry.tags],
    url: entry.url,
    netsuiteId: entry.netsuiteId,
    recordType: entry.recordType,
    scriptId: entry.scriptId,
    filePath: entry.filePath,
    code: entry.code,
    group: entry.group || "General",
    pinned: entry.pinned,
    archived: entry.archived
  };
  tagInput.value = entry.tags.join(", ");
};

const selectEntry = (entry: NotebookEntry) => {
  selectedId.value = entry.id;
  loadDraft(entry);
};

const createEntry = (type: NotebookEntryType = "note") => {
  selectedId.value = "";
  draft.value = blankDraft(type);
  if (groupFilter.value !== "all") draft.value.group = groupFilter.value;
  tagInput.value = "";
};

const syncTags = () => {
  draft.value.tags = tagInput.value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter(
      (tag, index, all) =>
        all.findIndex((item) => item.toLowerCase() === tag.toLowerCase()) ===
        index
    );
};

const saveEntry = async () => {
  if (!draft.value.title.trim() || saving.value) return;
  saving.value = true;
  syncTags();
  try {
    const saved = await upsertNotebookEntry(draft.value);
    await loadEntries();
    selectedId.value = saved.id;
    loadDraft(saved);
    toast.add({
      severity: "success",
      summary: "Saved",
      detail: "Notebook entry updated",
      life: 2200
    });
  } catch (err) {
    toast.add({
      severity: "error",
      summary: "Save failed",
      detail: err instanceof Error ? err.message : String(err),
      life: 4500
    });
  } finally {
    saving.value = false;
  }
};

const togglePinned = async (entry: NotebookEntry) => {
  await upsertNotebookEntry({ ...entry, pinned: !entry.pinned });
  await loadEntries();
};

const toggleDraftPinned = async () => {
  draft.value.pinned = !draft.value.pinned;
  if (!selectedEntry.value) return;
  const updated = await upsertNotebookEntry({
    ...selectedEntry.value,
    pinned: draft.value.pinned
  });
  await loadEntries();
  selectedId.value = updated.id;
  loadDraft(updated);
};

const toggleArchived = async (entry: NotebookEntry) => {
  await upsertNotebookEntry({ ...entry, archived: !entry.archived });
  await loadEntries();
};

const removeEntry = async (entry: NotebookEntry) => {
  await deleteNotebookEntry(entry.id);
  toast.add({
    severity: "success",
    summary: "Deleted",
    detail: "Notebook entry removed",
    life: 2200
  });
  selectedId.value = "";
  await loadEntries();
  if (selectedEntry.value) loadDraft(selectedEntry.value);
  else createEntry();
};

const copyReference = async (entry: NotebookEntry) => {
  const parts = [
    entry.title,
    entry.url,
    entry.recordType && entry.netsuiteId
      ? `${entry.recordType} #${entry.netsuiteId}`
      : "",
    entry.scriptId ? `Script: ${entry.scriptId}` : "",
    entry.filePath
  ].filter(Boolean);
  await navigator.clipboard?.writeText(parts.join("\n"));
  toast.add({
    severity: "success",
    summary: "Copied",
    detail: "Reference copied",
    life: 1800
  });
};

const copyValue = async (label: string, value: string) => {
  const text = value.trim();
  if (!text) return;
  await navigator.clipboard?.writeText(text);
  toast.add({
    severity: "success",
    summary: "Copied",
    detail: `${label} copied`,
    life: 1600
  });
};

const openEntry = (entry: NotebookEntry) => {
  if (!entry.url) return;
  window.open(entry.url, "_blank", "noopener,noreferrer");
};

const exportEntries = () => {
  const blob = new Blob([JSON.stringify(entries.value, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `magic-netsuite-notebook-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const importEntries = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      if (!Array.isArray(parsed))
        throw new Error("Notebook export must be an array.");
      await bulkImportNotebookEntries(parsed);
      await loadEntries();
      toast.add({
        severity: "success",
        summary: "Imported",
        detail: `${parsed.length} entries imported`,
        life: 2600
      });
    } catch (err) {
      toast.add({
        severity: "error",
        summary: "Import failed",
        detail: err instanceof Error ? err.message : String(err),
        life: 4500
      });
    } finally {
      input.value = "";
    }
  };
  reader.readAsText(file);
};

const handleNotebookShortcut = (event: KeyboardEvent) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s")
    return;
  event.preventDefault();
  void saveEntry();
};

const formatDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });

onMounted(async () => {
  const query = route.query.q;
  if (typeof query === "string") search.value = query;
  loadGroups();
  window.addEventListener("keydown", handleNotebookShortcut);
  await loadEntries();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleNotebookShortcut);
});
</script>

<template>
  <MCard
    flex
    direction="column"
    autoHeight
    outlined
    elevated
    padding="0"
    :style="{ height: '90vh' }"
  >
    <div class="notebook-shell">
      <aside class="notebook-sidebar">
        <div class="notebook-brand">
          <div>
            <p class="eyebrow">Personal Knowledge Base</p>
            <h1>NetSuite Notebook</h1>
          </div>
        </div>

        <div class="notebook-utility-toolbar">
          <span>Notebook data</span>
          <button title="Export notebook" @click="exportEntries">
            <i class="pi pi-download"></i>
          </button>
          <label title="Import notebook">
            <i class="pi pi-upload"></i>
            <input
              type="file"
              accept="application/json"
              @change="importEntries"
            />
          </label>
        </div>

        <div class="search-box">
          <i class="pi pi-search"></i>
          <input v-model="search" placeholder="Search notes, IDs, tags..." />
          <span class="search-count">{{ filteredEntries.length }}</span>
          <button v-if="search" title="Clear search" @click="search = ''">
            <i class="pi pi-times"></i>
          </button>
        </div>

        <div class="type-tabs">
          <button
            v-for="option in typeOptions"
            :key="option.value"
            :class="{ active: typeFilter === option.value }"
            @click="typeFilter = option.value"
          >
            <i :class="option.icon"></i>
            <span>{{ option.label }}</span>
          </button>
        </div>

        <label class="archive-toggle">
          <input v-model="showArchived" type="checkbox" />
          <span>Show archived</span>
        </label>

        <div class="notes-list-header">
          <div>
            <span>Notes</span>
            <strong>{{ filteredEntries.length }}</strong>
          </div>
          <div class="notes-list-actions">
            <MSelect
              v-model="groupFilter"
              :options="groupOptions"
              size="small"
              class="group-select"
              placeholder="All groups"
            />
            <button
              class="new-note-btn"
              title="New note"
              @click="createEntry('note')"
            >
              <i class="pi pi-plus"></i>
            </button>
            <button
              class="new-group-btn"
              title="New group"
              @click="creatingGroup = !creatingGroup"
            >
              <i class="pi pi-folder-plus"></i>
            </button>
          </div>
        </div>

        <form
          v-if="creatingGroup"
          class="group-create"
          @submit.prevent="createGroup"
        >
          <input v-model="newGroupName" placeholder="New group name" />
          <button type="submit" :disabled="!newGroupName.trim()">Create</button>
        </form>

        <div class="entry-list">
          <section
            v-for="section in groupedEntries"
            :key="section.group"
            class="entry-group"
          >
            <div class="entry-group-header">
              <span>{{ section.group }}</span>
              <strong>{{ section.items.length }}</strong>
            </div>
            <button
              v-for="entry in section.items"
              :key="entry.id"
              class="entry-card"
              :class="{
                active: selectedId === entry.id,
                archived: entry.archived
              }"
              @click="selectEntry(entry)"
            >
              <div class="entry-card-top">
                <span class="type-chip">
                  <i :class="typeIcon(entry.type)"></i>
                  {{ typeLabel(entry.type) }}
                </span>
                <span class="entry-card-actions">
                  <button
                    v-if="entry.url"
                    title="Open link"
                    @click.stop="openEntry(entry)"
                  >
                    <i class="pi pi-external-link"></i>
                  </button>
                  <button
                    title="Copy reference"
                    @click.stop="copyReference(entry)"
                  >
                    <i class="pi pi-copy"></i>
                  </button>
                  <button title="Pin" @click.stop="togglePinned(entry)">
                    <i
                      :class="
                        entry.pinned ? 'pi pi-star-fill pin-star' : 'pi pi-star'
                      "
                    ></i>
                  </button>
                </span>
              </div>
              <strong>{{ entry.title }}</strong>
              <p>{{ entry.summary || entry.body || "No description yet." }}</p>
              <div class="tag-row" v-if="entry.tags.length">
                <span v-for="tag in entry.tags.slice(0, 3)" :key="tag"
                  >#{{ tag }}</span
                >
              </div>
            </button>
          </section>

          <div v-if="filteredEntries.length === 0" class="empty-list">
            <i class="pi pi-book"></i>
            <span>No notebook entries match this view.</span>
          </div>
        </div>
      </aside>

      <main class="notebook-detail">
        <div class="detail-toolbar">
          <div class="type-picker">
            <button
              v-for="option in entryTypes"
              :key="option.value"
              :class="{ active: draft.type === option.value }"
              @click="draft.type = option.value"
            >
              <i :class="option.icon"></i>
              <span>{{ option.label }}</span>
            </button>
          </div>
          <div class="toolbar-actions">
            <button
              class="icon-btn"
              title="Pin"
              :class="{ active: draft.pinned }"
              @click="toggleDraftPinned"
            >
              <i :class="draft.pinned ? 'pi pi-star-fill' : 'pi pi-star'"></i>
            </button>
            <button
              class="icon-btn"
              title="Open link"
              :disabled="!draft.url"
              @click="selectedEntry && openEntry(selectedEntry)"
            >
              <i class="pi pi-external-link"></i>
            </button>
            <button
              class="icon-btn"
              title="Copy reference"
              :disabled="!selectedEntry"
              @click="selectedEntry && copyReference(selectedEntry)"
            >
              <i class="pi pi-copy"></i>
            </button>
            <button
              class="ghost-btn"
              :disabled="!selectedEntry"
              @click="selectedEntry && toggleArchived(selectedEntry)"
            >
              {{ selectedEntry?.archived ? "Restore" : "Archive" }}
            </button>
            <button
              class="danger-btn"
              :disabled="!selectedEntry"
              @click="selectedEntry && removeEntry(selectedEntry)"
            >
              Delete
            </button>
            <button
              class="save-btn"
              :disabled="!draft.title.trim() || saving"
              @click="saveEntry"
            >
              <i :class="saving ? 'pi pi-spin pi-spinner' : 'pi pi-save'"></i>
              <span>{{ saving ? "Saving" : "Save" }}</span>
              <kbd v-if="!saving" class="shortcut-kbd">Ctrl+S</kbd>
            </button>
          </div>
        </div>

        <section class="editor-grid">
          <div class="field full">
            <div class="field-heading">
              <label>Title</label>
              <button
                title="Copy title"
                @click="copyValue('Title', draft.title)"
              >
                <i class="pi pi-copy"></i>
              </button>
            </div>
            <input
              v-model="draft.title"
              placeholder="What should future-you search for?"
            />
          </div>
          <div class="field full">
            <div class="field-heading">
              <label>Summary</label>
              <button
                title="Copy summary"
                @click="copyValue('Summary', draft.summary)"
              >
                <i class="pi pi-copy"></i>
              </button>
            </div>
            <input
              v-model="draft.summary"
              placeholder="Short context for the list view"
            />
          </div>
          <div class="field">
            <div class="field-heading">
              <label>NetSuite URL or docs link</label>
              <button title="Copy URL" @click="copyValue('URL', draft.url)">
                <i class="pi pi-copy"></i>
              </button>
            </div>
            <input v-model="draft.url" placeholder="https://..." />
          </div>
          <div class="field">
            <div class="field-heading">
              <label>Tags</label>
              <button title="Copy tags" @click="copyValue('Tags', tagInput)">
                <i class="pi pi-copy"></i>
              </button>
            </div>
            <input
              v-model="tagInput"
              placeholder="billing, map-reduce, customer"
              @blur="syncTags"
            />
          </div>
          <div class="field">
            <div class="field-heading">
              <label>Group</label>
              <button
                title="Copy group"
                @click="copyValue('Group', draft.group)"
              >
                <i class="pi pi-copy"></i>
              </button>
            </div>
            <MSelect
              v-model="draft.group"
              :options="draftGroupOptions"
              class="field-select"
              placeholder="Select group"
            />
          </div>
          <div class="field">
            <div class="field-heading">
              <label>Record type</label>
              <button
                title="Copy record type"
                @click="copyValue('Record type', draft.recordType)"
              >
                <i class="pi pi-copy"></i>
              </button>
            </div>
            <input
              v-model="draft.recordType"
              placeholder="customer, salesorder, customrecord..."
            />
          </div>
          <div class="field">
            <div class="field-heading">
              <label>Internal ID</label>
              <button
                title="Copy internal ID"
                @click="copyValue('Internal ID', draft.netsuiteId)"
              >
                <i class="pi pi-copy"></i>
              </button>
            </div>
            <input v-model="draft.netsuiteId" placeholder="12345" />
          </div>
          <div class="field">
            <div class="field-heading">
              <label>Script ID</label>
              <button
                title="Copy script ID"
                @click="copyValue('Script ID', draft.scriptId)"
              >
                <i class="pi pi-copy"></i>
              </button>
            </div>
            <input v-model="draft.scriptId" placeholder="customscript_..." />
          </div>
          <div class="field">
            <div class="field-heading">
              <label>File path</label>
              <button
                title="Copy file path"
                @click="copyValue('File path', draft.filePath)"
              >
                <i class="pi pi-copy"></i>
              </button>
            </div>
            <input v-model="draft.filePath" placeholder="/SuiteScripts/..." />
          </div>
          <div class="field full">
            <div class="field-heading">
              <label>Notes</label>
              <button
                title="Copy notes"
                @click="copyValue('Notes', draft.body)"
              >
                <i class="pi pi-copy"></i>
              </button>
            </div>
            <textarea
              v-model="draft.body"
              placeholder="Why this matters, caveats, related records, deployment notes..."
            />
          </div>
          <div class="field full">
            <div class="field-heading">
              <label>Query or snippet</label>
              <button
                title="Copy snippet"
                @click="copyValue('Snippet', draft.code)"
              >
                <i class="pi pi-copy"></i>
              </button>
            </div>
            <textarea
              v-model="draft.code"
              class="code-box"
              placeholder="SELECT ... or a SuiteScript snippet you want to keep close"
            />
          </div>
        </section>

        <footer class="detail-footer">
          <span v-if="selectedEntry"
            >Updated {{ formatDate(selectedEntry.updatedAt) }}</span
          >
          <span v-else>New notebook entry</span>
        </footer>
      </main>
    </div>
  </MCard>
</template>

<style scoped>
.notebook-shell {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: #f8fafc;
  color: #1e293b;
}

.notebook-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid #cbd5e1;
  background: #eef2f7;
  padding: 1rem;
  gap: 0.9rem;
}

.notebook-brand {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.eyebrow {
  margin: 0 0 0.2rem;
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #64748b;
  font-weight: 700;
}

h1 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 800;
  color: #0f172a;
}

button,
label {
  font: inherit;
}

button {
  border: 0;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.icon-btn {
  width: 2rem;
  height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: #475569;
  background: white;
  outline: 1px solid #cbd5e1;
}

.icon-btn:hover,
.icon-btn.active {
  color: #0f172a;
  background: #e2e8f0;
}

.icon-btn.primary {
  color: #475569;
  background: white;
  outline-color: #cbd5e1;
}

.notebook-utility-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.35rem;
  min-height: 2.25rem;
  padding: 0.3rem 0.4rem;
  border-radius: 6px;
  background: white;
  outline: 1px solid #dbe3ee;
}

.notebook-utility-toolbar span {
  margin-right: auto;
  color: #64748b;
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.notebook-utility-toolbar button,
.notebook-utility-toolbar label {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.8rem;
  height: 1.8rem;
  border-radius: 5px;
  color: #475569;
  background: #f8fafc;
  outline: 1px solid #dbe3ee;
  cursor: pointer;
}

.notebook-utility-toolbar button:hover,
.notebook-utility-toolbar label:hover {
  color: #0f172a;
  background: #e2e8f0;
}

.notebook-utility-toolbar input {
  display: none;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.3rem;
  padding: 0 0.65rem;
  border-radius: 6px;
  background: white;
  outline: 1px solid #cbd5e1;
  color: #64748b;
}

.search-box input,
.field input,
.field textarea {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: #1e293b;
}

.search-box button {
  color: #64748b;
  background: transparent;
}

.search-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.25rem;
  border-radius: 999px;
  background: #e2e8f0;
  color: #475569;
  font-size: 0.68rem;
  font-weight: 800;
}

.type-tabs,
.type-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.type-tabs button,
.type-picker button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-radius: 6px;
  padding: 0.42rem 0.55rem;
  color: #64748b;
  background: white;
  outline: 1px solid #dbe3ee;
  font-size: 0.75rem;
  font-weight: 700;
}

.type-tabs button.active,
.type-picker button.active {
  color: #1e3a8a;
  background: #dbeafe;
  outline-color: #93c5fd;
}

.archive-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: #475569;
  font-size: 0.78rem;
  cursor: pointer;
}

.notes-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.notes-list-header > div:first-child {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: #334155;
  font-size: 0.78rem;
  font-weight: 800;
}

.notes-list-header strong {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.35rem;
  height: 1.15rem;
  border-radius: 999px;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 0.66rem;
}

.notes-list-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.notes-list-actions .group-select {
  width: 8.6rem;
}

.notes-list-actions .new-note-btn,
.notes-list-actions .new-group-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.8rem;
  height: 1.8rem;
  min-width: 1.8rem;
  border-radius: 6px;
}

.notes-list-actions .new-note-btn {
  color: #475569;
  background: white;
  outline: 1px solid #cbd5e1;
}

.notes-list-actions .new-note-btn:hover,
.notes-list-actions .new-group-btn:hover {
  color: #0f172a;
  background: #e2e8f0;
}

.notes-list-actions .new-group-btn {
  color: #475569;
  background: white;
  outline: 1px solid #cbd5e1;
}

.group-create {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem;
  border-radius: 6px;
  background: white;
  outline: 1px solid #dbe3ee;
}

.group-create input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: #1e293b;
  font-size: 0.76rem;
}

.group-create button {
  min-height: 1.75rem;
  border-radius: 5px;
  color: #475569;
  background: #f8fafc;
  outline: 1px solid #cbd5e1;
  padding: 0 0.6rem;
  font-size: 0.72rem;
  font-weight: 800;
}

.entry-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  gap: 0.4rem;
  padding: 1px 0.2rem 1px 1px;
}

.entry-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.entry-group-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.2rem 0.15rem;
  color: #64748b;
  background: #eef2f7;
  font-size: 0.68rem;
  font-weight: 850;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.entry-group-header strong {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.15rem;
  height: 1rem;
  border-radius: 999px;
  color: #475569;
  background: #e2e8f0;
  font-size: 0.6rem;
}

.entry-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.28rem;
  text-align: left;
  padding: 0.5rem 0.55rem;
  border-radius: 7px;
  background: white;
  color: #334155;
  outline: 1px solid #dbe3ee;
}

.entry-card:hover,
.entry-card.active {
  outline-color: #94a3b8;
  background: #f8fafc;
}

.entry-card.archived {
  opacity: 0.65;
}

.entry-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.entry-card-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  flex: 0 0 auto;
}

.entry-card-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 4px;
  color: #64748b;
  background: transparent;
}

.entry-card-actions button:hover {
  color: #0f172a;
  background: #e2e8f0;
}

.type-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: #475569;
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
}

.pin-star {
  color: #ca8a04;
}

.entry-card strong {
  color: #0f172a;
  font-size: 0.82rem;
  line-height: 1.2;
}

.entry-card p {
  margin: 0;
  color: #64748b;
  font-size: 0.7rem;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.tag-row span {
  font-size: 0.64rem;
  color: #1d4ed8;
  background: #eff6ff;
  border-radius: 999px;
  padding: 0.15rem 0.4rem;
}

.empty-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem 1rem;
  color: #94a3b8;
  font-size: 0.8rem;
}

.notebook-detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #f8fafc;
}

.detail-toolbar {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  border-bottom: 1px solid #dbe3ee;
  background: white;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.ghost-btn,
.danger-btn,
.save-btn,
.link-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border-radius: 6px;
  padding: 0.55rem 0.75rem;
  font-size: 0.78rem;
  font-weight: 800;
}

.ghost-btn {
  color: #475569;
  background: #f8fafc;
  outline: 1px solid #cbd5e1;
}

.danger-btn {
  color: #b91c1c;
  background: #fef2f2;
  outline: 1px solid #fecaca;
}

.save-btn {
  min-height: 32px;
  border: 1px solid #475569;
  color: #f8fafc;
  background: #475569;
  padding: 6px 10px;
}

.save-btn:hover:not(:disabled) {
  border-color: #334155;
  color: white;
  background: #334155;
}

.save-btn:disabled {
  border-color: #cbd5e1;
  color: #f8fafc;
  background: #cbd5e1;
}

.shortcut-kbd {
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.18);
  color: #f8fafc;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.58rem;
  line-height: 1;
  padding: 2px 4px;
}

.editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.85rem;
  padding: 1rem;
  overflow: auto;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 0.75rem;
  border-radius: 8px;
  background: white;
  outline: 1px solid #dbe3ee;
}

.field.full {
  grid-column: 1 / -1;
}

.field-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.field-heading button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.35rem;
  height: 1.35rem;
  border-radius: 4px;
  color: #64748b;
  background: transparent;
}

.field-heading button:hover {
  color: #0f172a;
  background: #e2e8f0;
}

.field label {
  color: #64748b;
  font-size: 0.7rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.field-select {
  width: 100%;
}

.field textarea {
  min-height: 9rem;
  resize: vertical;
  line-height: 1.45;
}

.field .code-box {
  min-height: 12rem;
  font-family: "JetBrains Mono", "Consolas", monospace;
  font-size: 0.78rem;
}

.detail-footer {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid #dbe3ee;
  color: #64748b;
  font-size: 0.78rem;
  background: white;
}

.link-btn {
  padding: 0;
  color: #2563eb;
  background: transparent;
}

@media (max-width: 860px) {
  .notebook-shell {
    grid-template-columns: 1fr;
  }

  .notebook-sidebar {
    max-height: 46vh;
    border-right: 0;
    border-bottom: 1px solid #cbd5e1;
  }

  .detail-toolbar,
  .detail-footer {
    align-items: stretch;
    flex-direction: column;
  }

  .editor-grid {
    grid-template-columns: 1fr;
  }
}
</style>
