<template>
  <h1>::SEARCH-SCRIPT-DEPLOYED</h1>

  <div v-if="loading" class="progress-spinner">
    <ProgressSpinner style="width: 3rem; height: 3rem; margin: 2rem auto" />
  </div>

  <div class="search-bar">
    <InputText placeholder="Search" v-model="searchText" @keyup="handleKey" />
    <button
      @click="caseSensitive = !caseSensitive"
      :class="{ active: caseSensitive }"
      class="search-option-btn"
      title="Match Case"
    >
      Aa
    </button>
    <button
      @click="wholeWord = !wholeWord"
      :class="{ active: wholeWord }"
      class="search-option-btn"
      title="Match Whole Word"
    >
      |ab|
    </button>
    <span class="match-counter"
      >{{ currentMatchDisplay }} / {{ totalMatches }}</span
    >
  </div>

  <div
    class="flex flex-col gap-4 overflow-y-auto overflow-x-hidden"
    data-ignore
    ref="scrollContainer"
    :style="{ height: `${vhOffset}vh` }"
  >
    <div v-for="(item, index) in editors" :key="index">
      <MonacoCodeEditor
        :ref="(el) => setItemRef(el, index)"
        class="editor"
        v-model="editors[index]!.code"
        :readonly="true"
        :completion-items="completionItems"
        :config="editorConfig"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  reactive,
  onMounted,
  watch,
  nextTick,
  type ComponentPublicInstance,
  computed,
} from "vue";
import ProgressSpinner from "primevue/progressspinner";
import { callApi } from "../utils/api";
import { RequestRoutes } from "../types/request";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import * as monaco from "monaco-editor";
import { InputText } from "primevue";
import { completionItems } from "../utils/codeEditorJSCompletion";
import { defaultCode } from "../utils/temp";
import { min } from "lodash";

const props = defineProps<{
  vhOffset: number;
}>();

const loading = ref(false);
const scrollContainer = ref<HTMLElement | null>(null);

/*  */
type Editors = {
  editor?: any; // Reference to MonacoCodeEditor component
  code: string;
  opened: boolean;
  matches?: monaco.editor.FindMatch[];
  decorations?: string[];
};

const editors = reactive<Editors[]>([
  {
    code: `function greet(name) {
  console.log('Hello, ' + name);
  return 'Welcome!';
}

greet('World');`,
    opened: false,
    matches: [],
    decorations: [],
  },
  {
    code: `
  console.log('Hello World');
`,
    opened: false,
    matches: [],
    decorations: [],
  },

  {
    code: defaultCode,
    opened: false,
    matches: [],
    decorations: [],
  },
]);

const editorConfig = {
  suppressNativeFind: true,
  defocusScroll: true,
  minimap: false,
};
const searchText = ref("");
const wholeWord = ref(false); // Toggle for whole word search
const caseSensitive = ref(false); // Toggle for case sensitive search

// --- State ---
const totalMatches = ref(0);
const currentMatchDisplay = ref(0);
let globalMatchIndex = 0; // Current match across all editors
let allMatches: Array<{ editorIndex: number; matchIndex: number }> = [];

// --- Reactive watch for live search ---
watch(searchText, async (newValue) => {
  await nextTick(); // Wait for editors to be ready
  performGlobalSearch(newValue);
});

// Watch for changes in search options
watch([caseSensitive, wholeWord], async () => {
  await nextTick();
  performGlobalSearch(searchText.value);
});

// --- Functions ---
const performGlobalSearch = (text: string) => {
  allMatches = [];
  let totalCount = 0;

  editors.forEach((editorItem, editorIndex) => {
    const editor = editorItem.editor?.getEditor?.();
    if (!editor) return;

    const model = editor.getModel();
    if (!model) return;

    if (!text) {
      // Clear decorations if empty
      editorItem.decorations = editor.deltaDecorations(
        editorItem.decorations || [],
        []
      );
      editorItem.matches = [];
      return;
    }

    // Find matches in this editor
    const matches = model.findMatches(
      text,
      true, // search all
      false, // isRegex - set to false for literal search
      caseSensitive.value, // matchCase
      wholeWord.value ? "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?" : null, // wordSeparators - standard word boundaries
      true // captureMatches
    );

    editorItem.matches = matches;

    // Build global match index
    matches.forEach((_: monaco.editor.FindMatch, matchIndex: number) => {
      allMatches.push({ editorIndex, matchIndex });
    });

    totalCount += matches.length;
  });

  totalMatches.value = totalCount;
  globalMatchIndex = 0;
  currentMatchDisplay.value = totalCount > 0 ? 1 : 0;

  // Update highlights on all editors
  updateAllHighlights();
};

const scrollToEditor = (editorIndex: number) => {
  // Scroll the container to the editor
  if (scrollContainer.value) {
    const editorElements = scrollContainer.value.querySelectorAll(".editor");
    const targetEditor = editorElements[editorIndex] as HTMLElement;

    if (targetEditor) {
      targetEditor.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }
};

const updateAllHighlights = async () => {
  // Wait for next tick to ensure DOM is updated
  await nextTick();

  editors.forEach((editorItem, editorIndex) => {
    const editor = editorItem.editor?.getEditor?.();
    if (!editor || !editorItem.matches) return;

    if (!editorItem.matches.length) {
      editorItem.decorations = editor.deltaDecorations(
        editorItem.decorations || [],
        []
      );
      return;
    }

    // Determine if current global match is in this editor
    const currentGlobalMatch = allMatches[globalMatchIndex];
    const isCurrentEditor = currentGlobalMatch?.editorIndex === editorIndex;
    const currentLocalMatchIndex = currentGlobalMatch?.matchIndex;

    const newDecorations: monaco.editor.IModelDeltaDecoration[] =
      editorItem.matches.map((match, idx) => ({
        range: match.range,
        options: {
          inlineClassName:
            isCurrentEditor && idx === currentLocalMatchIndex
              ? "current-match-decoration"
              : "other-match-decoration",
        },
      }));

    editorItem.decorations = editor.deltaDecorations(
      editorItem.decorations || [],
      newDecorations
    );

    // If this editor has the current match, reveal it
    if (isCurrentEditor && currentLocalMatchIndex !== undefined) {
      const match = editorItem.matches[currentLocalMatchIndex];
      if (match) {
        // First, scroll the container to this editor
        scrollToEditor(editorIndex);

        // Then, after a short delay, scroll within the Monaco editor
        setTimeout(() => {
          // Don't use setSelection in readonly mode, just reveal the range
          editor.revealRangeInCenterIfOutsideViewport(
            match.range,
            monaco.editor.ScrollType.Smooth
          );

          // Alternative: use revealRangeInCenter for more aggressive scrolling
          // editor.revealRangeInCenter(match.range, monaco.editor.ScrollType.Smooth);

          // Don't focus the editor to avoid readonly warnings
        }, 100);
      }
    }
  });
};

// Navigate matches globally
const goToNextMatch = () => {
  if (!allMatches.length) return;
  globalMatchIndex = (globalMatchIndex + 1) % allMatches.length;
  currentMatchDisplay.value = globalMatchIndex + 1;
  updateAllHighlights();
};

const goToPrevMatch = () => {
  if (!allMatches.length) return;
  globalMatchIndex =
    (globalMatchIndex - 1 + allMatches.length) % allMatches.length;
  currentMatchDisplay.value = globalMatchIndex + 1;
  updateAllHighlights();
};

// --- Key navigation ---
const handleKey = (event: KeyboardEvent) => {
  if (!allMatches.length) return;

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    goToNextMatch();
  } else if (event.key === "Enter" && event.shiftKey) {
    event.preventDefault();
    goToPrevMatch();
  }
};

const setItemRef = (
  el: Element | ComponentPublicInstance | null,
  index: number
) => {
  if (el && editors[index]) {
    editors[index].editor = el;
  }
};

// Custom completion items
type DeployedScript = {
  scriptName: string;
  scriptType: string;
  scriptFile: string;
  scriptId: string;
};

type File = {
  name: string;
  content: string;
  scriptId: string;
};

const deployedScripts = ref<DeployedScript[]>([]);

const files = ref<File[]>([]);

// --- Fetch scripts ---
const getDeployedScripts = async () => {
  loading.value = true;
  try {
    const { message: record } = await callApi(RequestRoutes.CURRENT_REC_TYPE);
    const { type } = record || {};
    if (!type) return;

    const { message: deployedScriptsResponse } = await callApi(
      RequestRoutes.SCRIPTS_DEPLOYED,
      {
        recordType: type,
      }
    );

    if (!deployedScriptsResponse) {
      console.error("Error fetching deployed scripts");
      return;
    }

    deployedScripts.value = deployedScriptsResponse as DeployedScript[];

    // Convert scripts to editor format
    editors.length = 0; // Clear existing editors
    deployedScripts.value.forEach((scriptItem) => {
      editors.push({
        code: scriptItem.scriptFile,
        opened: false,
        matches: [],
        decorations: [],
      });
    });
  } catch (error) {
    console.error("Error fetching deployed scripts:", error);
    loading.value = false;
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  /* getDeployedScripts(); */
});
</script>

<style scoped>
.search-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  background: white;
  padding: 0.5rem 0;
  z-index: 10;
  padding: 0.5rem;
  border-radius: 0.5rem;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
}

.match-counter {
  font-size: 0.9rem;
  color: #666;
  white-space: nowrap;
}

.search-option-btn {
  padding: 0.25rem 0.5rem;
  border: 1px solid #ccc;
  border-radius: 0.25rem;
  background: white;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s;
}

.search-option-btn:hover {
  background: #f0f0f0;
}

.search-option-btn.active {
  background: var(--p-slate-500);
  color: white;
  border-color: var(--p-slate-500);
}

.progress-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
}

.editor {
  scroll-margin-top: 2rem;
}
</style>

<style>
.current-match-decoration {
  background-color: rgba(224, 132, 26, 0.5);
  border-radius: 2px;
}

.other-match-decoration {
  background-color: rgba(180, 200, 255, 0.3);
  border-radius: 2px;
}
</style>
