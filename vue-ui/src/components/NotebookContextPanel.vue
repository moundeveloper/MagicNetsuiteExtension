<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "primevue/usetoast";
import {
  getNotebookEntries,
  upsertNotebookEntry,
  type NotebookEntry,
  type NotebookEntryType
} from "../utils/notebookDb";

export interface NotebookContext {
  type: NotebookEntryType;
  title: string;
  summary?: string;
  url?: string;
  netsuiteId?: string | number | null;
  recordType?: string;
  scriptId?: string;
  filePath?: string;
  code?: string;
  tags?: string[];
}

const props = defineProps<{
  context: NotebookContext;
  compact?: boolean;
}>();

const router = useRouter();
const toast = useToast();

const entries = ref<NotebookEntry[]>([]);
const noteText = ref("");
const search = ref("");
const saving = ref(false);
const expanded = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});

const contextTags = computed(() =>
  [
    props.context.type,
    props.context.recordType,
    props.context.scriptId,
    ...(props.context.tags ?? [])
  ]
    .map((tag) => String(tag ?? "").trim())
    .filter(Boolean)
);

const loadEntries = async () => {
  entries.value = await getNotebookEntries();
};

const isRelated = (entry: NotebookEntry) => {
  const netsuiteId = props.context.netsuiteId != null ? String(props.context.netsuiteId) : "";
  const fieldMatches = [
    netsuiteId && entry.netsuiteId === netsuiteId,
    props.context.scriptId && entry.scriptId === props.context.scriptId,
    props.context.filePath && entry.filePath === props.context.filePath,
    props.context.recordType && entry.recordType === props.context.recordType && entry.netsuiteId === netsuiteId,
    props.context.url && entry.url === props.context.url
  ].some(Boolean);

  const tagSet = new Set(contextTags.value.map((tag) => tag.toLowerCase()));
  const tagMatches = entry.tags.some((tag) => tagSet.has(tag.toLowerCase()));

  return fieldMatches || (entry.type === props.context.type && tagMatches);
};

const relatedEntries = computed(() =>
  entries.value
    .filter((entry) => !entry.archived && isRelated(entry))
    .filter((entry) => {
      const q = search.value.trim().toLowerCase();
      if (!q) return true;
      return [
        entry.title,
        entry.summary,
        entry.body,
        entry.scriptId,
        entry.netsuiteId,
        entry.filePath,
        entry.tags.join(" ")
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .slice(0, props.compact ? 4 : 8)
);

const contextPayload = () => ({
  type: props.context.type,
  title: props.context.title,
  summary: props.context.summary ?? "",
  url: props.context.url ?? "",
  netsuiteId: props.context.netsuiteId != null ? String(props.context.netsuiteId) : "",
  recordType: props.context.recordType ?? "",
  scriptId: props.context.scriptId ?? "",
  filePath: props.context.filePath ?? "",
  code: props.context.code ?? "",
  group: props.context.type === "query" ? "SuiteQL" : props.context.type === "script" ? "Scripts" : "General",
  tags: contextTags.value,
  pinned: true
});

const pinContext = async () => {
  if (saving.value) return;
  saving.value = true;
  try {
    await upsertNotebookEntry(contextPayload());
    await loadEntries();
    toast.add({ severity: "success", summary: "Pinned", detail: "Context saved to Notebook", life: 2200 });
  } finally {
    saving.value = false;
  }
};

const addNote = async () => {
  const body = noteText.value.trim();
  if (!body || saving.value) return;
  saving.value = true;
  try {
    await upsertNotebookEntry({
      ...contextPayload(),
      type: "note",
      title: `Note: ${props.context.title}`,
      summary: props.context.summary ?? `Attached to ${props.context.title}`,
      body,
      pinned: false
    });
    noteText.value = "";
    await loadEntries();
    toast.add({ severity: "success", summary: "Note saved", detail: "It will reappear in this context", life: 2200 });
  } finally {
    saving.value = false;
  }
};

const openNotebook = (entry?: NotebookEntry) => {
  const query = entry ? `?q=${encodeURIComponent(entry.title)}` : "";
  router.push(`/notebook${query}`);
};

const openPanel = () => {
  if (props.compact && triggerRef.value) {
    const rect = triggerRef.value.getBoundingClientRect();
    const width = Math.min(352, window.innerWidth - 24);
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
    const top = Math.max(12, Math.min(window.innerHeight - 220, rect.bottom + 8));
    popoverStyle.value = {
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`
    };
  }
  expanded.value = true;
};

const closePanel = () => {
  expanded.value = false;
};

const handleEscape = (event: KeyboardEvent) => {
  if (event.key === "Escape") closePanel();
};

watch(() => props.context, loadEntries, { deep: true });
onMounted(() => {
  window.addEventListener("keydown", handleEscape);
  void loadEntries();
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleEscape);
});
</script>

<template>
  <div class="notebook-context" :class="{ compact, expanded }">
    <button
      ref="triggerRef"
      class="notebook-peek"
      :class="{ active: expanded }"
      type="button"
      title="Related notebook notes"
      @click="expanded ? closePanel() : openPanel()"
    >
      <i class="pi pi-bookmark"></i>
      <span v-if="!compact">Notes</span>
      <strong v-if="relatedEntries.length">{{ relatedEntries.length }}</strong>
    </button>

    <Teleport v-if="compact" to="body">
      <section v-if="expanded" class="notebook-panel" :class="{ compact }" :style="popoverStyle">
        <div class="notebook-panel-head">
          <div>
            <span class="panel-kicker">Notebook</span>
            <strong>{{ relatedEntries.length }} related</strong>
          </div>
          <div class="panel-actions">
            <button title="Pin current context" :disabled="saving" @click="pinContext">
              <i :class="saving ? 'pi pi-spin pi-spinner' : 'pi pi-thumbtack'"></i>
            </button>
            <button title="Open Notebook" @click="openNotebook()">
              <i class="pi pi-search"></i>
            </button>
            <button title="Hide notes" @click="closePanel">
              <i class="pi pi-times"></i>
            </button>
          </div>
        </div>

        <div class="note-capture">
          <input
            v-model="noteText"
            placeholder="Add a note to this context..."
            @keydown.enter.prevent="addNote"
          />
          <button :disabled="!noteText.trim() || saving" @click="addNote">Add</button>
        </div>

        <div class="related-search">
          <i class="pi pi-filter"></i>
          <input v-model="search" placeholder="Filter related notes..." />
        </div>

        <div class="related-list">
          <button
            v-for="entry in relatedEntries"
            :key="entry.id"
            class="related-entry"
            @click="openNotebook(entry)"
          >
            <span>
              <strong>{{ entry.title }}</strong>
              <small>{{ entry.summary || entry.body || entry.scriptId || entry.filePath }}</small>
            </span>
            <i class="pi pi-angle-right"></i>
          </button>
          <div v-if="relatedEntries.length === 0" class="related-empty">
            Notes you add here will come back when this context is open.
          </div>
        </div>
      </section>
    </Teleport>

    <section v-else-if="expanded" class="notebook-panel">
      <div class="notebook-panel-head">
        <div>
          <span class="panel-kicker">Notebook</span>
          <strong>{{ relatedEntries.length }} related</strong>
        </div>
        <div class="panel-actions">
          <button title="Pin current context" :disabled="saving" @click="pinContext">
            <i :class="saving ? 'pi pi-spin pi-spinner' : 'pi pi-thumbtack'"></i>
          </button>
          <button title="Open Notebook" @click="openNotebook()">
            <i class="pi pi-search"></i>
          </button>
        <button title="Hide notes" @click="closePanel">
          <i class="pi pi-times"></i>
        </button>
      </div>
      </div>

      <div class="note-capture">
        <input
          v-model="noteText"
          placeholder="Add a note to this context..."
          @keydown.enter.prevent="addNote"
        />
        <button :disabled="!noteText.trim() || saving" @click="addNote">Add</button>
      </div>

      <div class="related-search">
        <i class="pi pi-filter"></i>
        <input v-model="search" placeholder="Filter related notes..." />
      </div>

      <div class="related-list">
        <button
          v-for="entry in relatedEntries"
          :key="entry.id"
          class="related-entry"
          @click="openNotebook(entry)"
        >
          <span>
            <strong>{{ entry.title }}</strong>
            <small>{{ entry.summary || entry.body || entry.scriptId || entry.filePath }}</small>
          </span>
          <i class="pi pi-angle-right"></i>
        </button>
        <div v-if="relatedEntries.length === 0" class="related-empty">
          Notes you add here will come back when this context is open.
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.notebook-context {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: max-content;
  max-width: 100%;
}

.notebook-context.expanded {
  z-index: 2147483000;
}

.notebook-panel {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.75rem;
  border-radius: 8px;
  background: #f8fafc;
  outline: 1px solid #dbe3ee;
  color: #1e293b;
}

.notebook-panel.compact {
  z-index: 2147483000;
  max-height: min(28rem, calc(100vh - 24px));
  overflow-y: auto;
  box-shadow: 0 18px 45px rgba(15, 23, 42, 0.16);
}

.notebook-peek {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: white;
  color: #475569;
  outline: 1px solid #cbd5e1;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 800;
  cursor: pointer;
}

.notebook-peek.active {
  color: #1e3a8a;
  background: #dbeafe;
  outline-color: #93c5fd;
}

.notebook-context.compact .notebook-peek {
  width: 1.9rem;
  height: 1.9rem;
}

.notebook-peek span {
  display: inline-flex;
}

.notebook-peek strong {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1rem;
  height: 1rem;
  border-radius: 999px;
  color: #1d4ed8;
  background: #dbeafe;
  font-size: 0.58rem;
  line-height: 1;
}

.notebook-context:not(.compact) .notebook-peek {
  width: max-content;
  min-width: 0;
  padding: 0 0.55rem;
}

.notebook-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.notebook-panel-head > div:first-child {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.panel-kicker {
  color: #64748b;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.notebook-panel strong {
  font-size: 0.86rem;
  color: #0f172a;
}

.panel-actions {
  display: flex;
  gap: 0.35rem;
}

button {
  border: 0;
  cursor: pointer;
  font: inherit;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.panel-actions button {
  width: 1.8rem;
  height: 1.8rem;
  border-radius: 6px;
  background: white;
  color: #475569;
  outline: 1px solid #cbd5e1;
}

.note-capture,
.related-search {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2rem;
  padding: 0 0.45rem;
  border-radius: 6px;
  background: white;
  outline: 1px solid #dbe3ee;
}

.note-capture input,
.related-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #1e293b;
  font-size: 0.76rem;
}

.note-capture button {
  padding: 0.3rem 0.48rem;
  border-radius: 5px;
  background: #475569;
  color: #f8fafc;
  outline: 1px solid #475569;
  font-size: 0.72rem;
  font-weight: 800;
}

.note-capture button:hover:not(:disabled) {
  background: #334155;
  color: white;
  outline-color: #334155;
}

.related-search {
  color: #94a3b8;
}

.related-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-height: 0;
  padding: 1px;
  overflow: visible;
}

.related-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  min-width: 0;
  padding: 0.4rem 0.45rem;
  border-radius: 6px;
  text-align: left;
  background: white;
  color: #475569;
  outline: 1px solid #e2e8f0;
  min-height: 2.35rem;
}

.related-entry span {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.related-entry strong,
.related-entry small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.related-entry strong {
  font-size: 0.78rem;
  line-height: 1.15;
}

.related-entry small {
  color: #64748b;
  font-size: 0.66rem;
  line-height: 1.1;
}

.related-entry > i {
  flex: 0 0 auto;
  font-size: 0.72rem;
  color: #94a3b8;
}

.related-empty {
  padding: 0.65rem;
  border-radius: 6px;
  color: #64748b;
  background: white;
  font-size: 0.74rem;
  line-height: 1.35;
}
</style>
