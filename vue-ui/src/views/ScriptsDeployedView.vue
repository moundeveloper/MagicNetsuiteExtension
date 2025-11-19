<template>
  <h1>::SEARCH-SCRIPT-DEPLOYED</h1>

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

    <MultiSelect
      v-model="selectedScriptTypes"
      display="chip"
      :options="scriptTypes"
      optionLabel="label"
      optionValue="value"
      filter
      placeholder="Select Script Types"
      :maxSelectedLabels="3"
      class="w-full md:w-80"
    />

    <span class="match-counter"
      >{{ currentMatchDisplay }} / {{ totalMatches }}</span
    >
  </div>

  <div v-if="loading" class="progress-spinner">
    <ProgressSpinner style="width: 3rem; height: 3rem; margin: 2rem auto" />
  </div>

  <div
    v-else
    id="scrollContainerEditors"
    class="flex flex-col gap-4 overflow-y-auto overflow-x-hidden p-4"
    data-ignore
    ref="scrollContainer"
    :style="{ height: `${vhOffset}vh` }"
  >
    <Accordion
      v-for="(item, index) in editors"
      :key="index"
      v-model:value="item.opened"
    >
      <AccordionPanel value="0">
        <AccordionHeader class="bg-slate-200">
          <span class="p-3 bg-slate-300 rounded rounded-tr-none rounded-br-none"
            >{{ item.script?.scriptName }} - {{ item.script?.scriptType }}
          </span>
        </AccordionHeader>
        <AccordionContent>
          <MonacoCodeEditor
            :ref="(el) => setItemRef(el, index)"
            class="editor"
            v-model="editors[index]!.code"
            :readonly="true"
            :completion-items="completionItems"
            :config="editorConfig"
          />
        </AccordionContent>
      </AccordionPanel>
    </Accordion>
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
} from "vue";
import ProgressSpinner from "primevue/progressspinner";
import { callApi } from "../utils/api";
import { RequestRoutes } from "../types/request";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import * as monaco from "monaco-editor";
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionPanel,
  InputText,
  MultiSelect,
} from "primevue";
import { completionItems } from "../utils/codeEditorJSCompletion";
import { defaultCode } from "../utils/temp";
import { debounce } from "lodash";

const props = defineProps<{
  vhOffset: number;
}>();

const loading = ref(false);
const scrollContainer = ref<HTMLElement | null>(null);

const selectedScriptTypes = ref<string[]>([]);

const scriptTypes = ref([
  { label: "Client", value: "client" },
  { label: "User Event", value: "user_event" },
  { label: "Workflows", value: "workflows" },
]);

// Custom completion items
type DeployedScript = {
  scriptName: string;
  scriptType: string;
  scriptFile: string;
  scriptId: string;
};

type Editors = {
  editor?: any; // Reference to MonacoCodeEditor component
  code: string;
  opened: string;
  matches?: monaco.editor.FindMatch[];
  decorations?: string[];
  script?: DeployedScript;
};

const editors = reactive<Editors[]>([
  {
    code: `function greet(name) {
console.log('Hello, ' + name);
return 'Welcome!';
}

greet('World');`,
    opened: "0",
    matches: [],
    decorations: [],
  },
  {
    code: `
  console.log('Hello World');
`,
    opened: "0",
    matches: [],
    decorations: [],
  },

  {
    code: defaultCode,
    opened: "0",
    matches: [],
    decorations: [],
  },
  {
    code: defaultCode,
    opened: "0",
    matches: [],
    decorations: [],
  },

  {
    code: defaultCode,
    opened: "0",
    matches: [],
    decorations: [],
  },
]);

const editorConfig = {
  suppressNativeFind: true,
  defocusScroll: true,
  minimap: false,
  disableAutoScrollOnFocus: true,
};
const searchText = ref("");
const wholeWord = ref(false); // Toggle for whole word search
const caseSensitive = ref(false); // Toggle for case sensitive search

// --- State ---
const totalMatches = ref(0);
const currentMatchDisplay = ref(0);
let globalMatchIndex = 0; // Current match across all editors
let allMatches: Array<{
  editorIndex: number;
  matchIndex: number;
  lineElement: HTMLElement;
}> = [];

const debouncedSearch = debounce((value: string) => {
  performGlobalSearch(value);
}, 250);

// --- Reactive watch for live search ---
watch(searchText, async (newValue) => {
  await nextTick(); // Wait for editors to be ready
  debouncedSearch(newValue);
});

// Watch for changes in search options
watch([caseSensitive, wholeWord], async () => {
  await nextTick();
  debouncedSearch(searchText.value);
});

// --- Functions ---
const performGlobalSearch = (text: string) => {
  allMatches = [];
  let totalCount = 0;

  editors.forEach((editorItem, editorIndex) => {
    const editor: monaco.editor.IStandaloneCodeEditor =
      editorItem.editor?.getEditor?.();

    if (!editor) return;

    const model: monaco.editor.ITextModel = editor.getModel()!;
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
    matches.forEach((match: monaco.editor.FindMatch, matchIndex: number) => {
      const editorDom = editor.getContainerDomNode();

      const lineElements = editorDom.querySelectorAll(`.line-numbers`);

      const lineElement = lineElements[
        match.range.startLineNumber - 1
      ] as HTMLElement;

      allMatches.push({ editorIndex, matchIndex, lineElement });
    });

    totalCount += matches.length;
  });

  totalMatches.value = totalCount;
  globalMatchIndex = 0;
  currentMatchDisplay.value = totalCount > 0 ? 1 : 0;

  // Update highlights on all editors
  updateAllHighlights();
};

const scrollToEditor = (lineElement: HTMLElement) => {
  // Scroll the container to the editor
  if (scrollContainer.value) {
    if (lineElement) {
      lineElement.scrollIntoView({
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
        scrollToEditor(currentGlobalMatch.lineElement);
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

    const deployedScripts = deployedScriptsResponse as DeployedScript[];

    // Convert scripts to editor format
    editors.length = 0; // Clear existing editors
    deployedScripts.forEach((scriptItem) => {
      editors.push({
        code: scriptItem.scriptFile,
        opened: "0",
        matches: [],
        decorations: [],
        script: scriptItem,
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
  scrollContainer.value?.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
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

.overlay {
  width: 100%;
  height: 100%;
  cursor: text;
}

.p-accordionheader {
  box-shadow: rgba(100, 100, 111, 0.2) 0px 7px 20px 0px;
  padding: 0;
  padding-right: 1rem;
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

.p-accordioncontent-content {
  padding: 0 !important;
}
</style>
