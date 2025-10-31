<template>
  <!-- Toolbar -->
  <div class="code-viewer-wraper">
    <Toolbar>
      <template #start>
        <IconField>
          <InputIcon>
            <i class="pi pi-search" />
          </InputIcon>
          <InputText placeholder="Search" v-model="search" @keyup="handleKey" />
        </IconField>
        <div class="options">
          <label
            ><input type="checkbox" v-model="caseSensitive" /> Case
            Sensitive</label
          >
          <label
            ><input type="checkbox" v-model="wholeWord" /> Whole Word</label
          >
        </div>
      </template>

      <template #end>
        <div class="arrow-buttons">
          <span v-if="totalMatches > 0" class="match-counter">
            {{ currentMatch }} / {{ totalMatches }}
            <template v-if="currentFileName">— {{ currentFileName }}</template>
          </span>
          <span v-else>No Results</span>
          <Button icon="pi pi-arrow-up" variant="outlined" @click="prevMatch" />
          <Button
            icon="pi pi-arrow-down"
            variant="outlined"
            @click="nextMatch"
          />
        </div>
      </template>
    </Toolbar>

    <!-- Loading -->
    <div v-if="loading" class="progress-spinner">
      <ProgressSpinner style="width: 3rem; height: 3rem; margin: 2rem auto" />
    </div>

    <!-- Code blocks -->
    <div v-else class="datatable-container">
      <Fieldset
        v-for="file in files"
        :key="file.id || file.name"
        :legend="file.name || 'Code'"
        :toggleable="toggleable"
      >
        <pre class="hljs language-javascript">
    <code ref="codeBlocks" v-html="highlightedCode(file.content)"></code>
  </pre>
      </Fieldset>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from "vue";
import Toolbar from "primevue/toolbar";
import InputText from "primevue/inputtext";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import Button from "primevue/button";
import Fieldset from "primevue/fieldset";
import ProgressSpinner from "primevue/progressspinner";

import Mark from "mark.js";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
hljs.registerLanguage("javascript", javascript);
import "highlight.js/styles/vs2015.css";

type File = {
  id?: string;
  name?: string;
  content: string;
};

type MarkFile = {
  fileName: string;
  el: any;
};

// Props
const props = defineProps({
  files: {
    type: Array<File>,
    default: () => [{ name: "Code", content: "" }],
  },
  toggleable: { type: Boolean, default: true },
  loading: { type: Boolean, default: false },
  language: { type: String, default: "javascript" },
});

const codeBlocks = ref([]);

// Search & navigation
const search = ref("");
const caseSensitive = ref(false);
const wholeWord = ref(false);
const allMarks = ref<MarkFile[]>([]);
const currentIndex = ref(-1);

const totalMatches = computed(() => allMarks.value.length);
const currentMatch = computed(() =>
  currentIndex.value >= 0 ? currentIndex.value + 1 : 0
);
const currentFileName = computed(
  () => allMarks.value[currentIndex.value]?.fileName || ""
);

const highlightedCode = (code: string) => {
  if (!code && code !== "") return "";
  return hljs.highlight(code, { language: "javascript" }).value;
};

function applyMarks() {
  allMarks.value = [];
  currentIndex.value = -1;

  codeBlocks.value.forEach((el: HTMLElement) => {
    const markInstance = new Mark(el);

    // Always unmark first
    markInstance.unmark();

    // If search is empty, stop here
    if (!search.value.trim()) return;

    // Apply new marks
    markInstance.mark(search.value, {
      separateWordSearch: !wholeWord.value,
      caseSensitive: caseSensitive.value,
      done: () => {
        const marks = el.querySelectorAll("mark");
        marks.forEach((m: any) => {
          const fieldset = m.closest("fieldset");
          const legend = fieldset?.querySelector("legend")?.textContent || "";
          m.style.backgroundColor = "#facc15";
          m.style.color = "#000";
          m.style.borderRadius = "0.25rem";
          m.style.padding = "0 2px";
          allMarks.value.push({ el: m, fileName: legend });
        });

        if (allMarks.value.length > 0) {
          currentIndex.value = 0;
          scrollToMark(0);
        }
      },
    });
  });
}

// Navigation
function nextMatch() {
  if (!allMarks.value.length) return;
  currentIndex.value = (currentIndex.value + 1) % allMarks.value.length;
  scrollToMark(currentIndex.value);
}

function prevMatch() {
  if (!allMarks.value.length) return;
  currentIndex.value =
    (currentIndex.value - 1 + allMarks.value.length) % allMarks.value.length;
  scrollToMark(currentIndex.value);
}

function scrollToMark(index: number) {
  allMarks.value.forEach((m, i) => {
    m.el.style.backgroundColor = i === index ? "#ff5722" : "#facc15";
  });
  const el = allMarks.value[index]?.el;
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}

function handleKey(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) nextMatch();
  else if (event.key === "Enter" && event.shiftKey) prevMatch();
}

// Watch search options
watch([search, caseSensitive, wholeWord], async () => {
  await nextTick();
  applyMarks();
});
</script>

<style scoped>
.code-viewer-wraper {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: 100%;
}

pre.hljs {
  border-radius: 0.5rem;
  padding: 1rem;
  font-size: 13px;
  background-color: #1e1e1e;
  overflow-x: auto;
}

mark {
  border-radius: 0.25rem;
  padding: 0 2px;
}

.arrow-buttons {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.match-counter {
  margin-right: 0.5rem;
  color: #ccc;
}

.options {
  margin-left: 1rem;
  display: flex;
  gap: 1rem;
  color: #ccc;
}

.datatable-container {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0; /* <-- allows scroll inside parent */
  overflow-y: auto; /* scrolls internally */
}

.progress-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
