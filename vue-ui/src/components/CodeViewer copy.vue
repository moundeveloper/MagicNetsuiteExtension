<template>
  <div class="code-viewer-wraper">
    <!-- Toolbar -->
    <Toolbar>
      <template #start>
        <IconField>
          <InputIcon>
            <i class="pi pi-search" />
          </InputIcon>
          <InputText placeholder="Search" v-model="search" @keyup="handleKey" />
        </IconField>
        <div class="options">
          <label>
            <input type="checkbox" v-model="caseSensitive" /> Case Sensitive
          </label>
          <label>
            <input type="checkbox" v-model="wholeWord" /> Whole Word
          </label>
        </div>
      </template>

      <template #end>
        <div class="arrow-buttons">
          <span v-if="totalMatches > 0" class="match-counter">
            {{ currentMatch }} / {{ totalMatches }}
            <template v-if="currentFileName">
              <span class="script-id" @click="goToScript">
                — {{ currentFileName }}
                <span v-if="currentScriptId"> ({{ currentScriptId }}) </span>
              </span>
            </template>
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
        :legend="`${file.name || 'Code'} — ${file.scriptId || ''}`"
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
import { ref, computed, nextTick, watch, onMounted } from "vue";
import Toolbar from "primevue/toolbar";
import InputText from "primevue/inputtext";
import IconField from "primevue/iconfield";
import InputIcon from "primevue/inputicon";
import Button from "primevue/button";
import Fieldset from "primevue/fieldset";
import ProgressSpinner from "primevue/progressspinner";

import debounce from "lodash/debounce";
import Mark from "mark.js";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
hljs.registerLanguage("javascript", javascript);
import "highlight.js/styles/vs2015.css";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";

type File = {
  id?: string;
  name?: string;
  scriptId?: string;
  content: string;
};

type MarkFile = {
  fileName: string;
  scriptId?: string;
  el: HTMLElement;
};

// Props
const props = defineProps({
  files: {
    type: Array<File>,
    default: () => [{ name: "Code", scriptId: "", content: "" }],
  },
  toggleable: { type: Boolean, default: true },
  loading: { type: Boolean, default: false },
  language: { type: String, default: "javascript" },
});

const codeBlocks = ref<HTMLElement[]>([]);
const markInstances = ref<Mark[]>([]);
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
const currentScriptId = computed(
  () => allMarks.value[currentIndex.value]?.scriptId || ""
);

const highlightedCode = (code: string) => {
  if (!code && code !== "") return "";
  return hljs.highlight(code, { language: props.language }).value;
};

// Apply marks with Mark.js
function applyMarks() {
  allMarks.value = [];
  currentIndex.value = -1;

  markInstances.value.forEach((markInstance, i) => {
    const el = codeBlocks.value[i]!;
    const file = props.files[i]!;
    markInstance.unmark();

    if (!search.value.trim()) return;

    markInstance.mark(search.value, {
      separateWordSearch: !wholeWord.value,
      caseSensitive: caseSensitive.value,
      done: () => {
        const marks = el.querySelectorAll("mark");
        marks.forEach((m: HTMLElement) => {
          m.style.backgroundColor = "#facc15";
          m.style.color = "#000";
          m.style.borderRadius = "0.25rem";
          m.style.padding = "0 2px";
          allMarks.value.push({
            el: m,
            fileName: file.name || "",
            scriptId: file.scriptId || "",
          });
        });

        if (allMarks.value.length > 0 && currentIndex.value === -1) {
          currentIndex.value = 0;
          scrollToMark(0);
        }
      },
    });
  });
}

// Debounced version of applyMarks
const debouncedApplyMarks = debounce(() => {
  nextTick().then(() => applyMarks());
}, 400);

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

const goToScript = async () => {
  if (!currentScriptId.value) return;
  const response =
    (await callApi(RequestRoutes.SCRIPT_URL, {
      scriptId: currentScriptId.value,
    })) || {};

  if (!response) return;
  const { message: url } = response as ApiResponse;

  window.open(url, "_blank");
};

// Watch search-related inputs, but use debounce
watch([search, caseSensitive, wholeWord], debouncedApplyMarks);

onMounted(() => {
  markInstances.value = codeBlocks.value.map((el) => new Mark(el));
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

.script-id {
  margin-left: 0.5rem;
  color: #9cdcfe;
  font-style: italic;
  cursor: pointer;
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
  min-height: 0;
  overflow-y: auto;
}

.progress-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
