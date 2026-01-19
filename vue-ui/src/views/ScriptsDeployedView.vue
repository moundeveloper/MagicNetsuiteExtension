<template>
  <h1>{{ formattedRouteName }}</h1>

  <div class="search-container">
    <div class="search-bar">
      <InputText placeholder="Search" v-model="searchText" @keyup="handleKey" />
      <Button
        @click="caseSensitive = !caseSensitive"
        :class="{ active: caseSensitive }"
        class="search-option-btn"
        title="Match Case"
      >
        Aa
      </Button>
      <Button
        @click="wholeWord = !wholeWord"
        :class="{ active: wholeWord }"
        class="search-option-btn"
        title="Match Whole Word"
      >
        |ab|
      </Button>

      <span class="match-counter flex gap-4 items-center">
        <Button
          @click="goToPrevMatch"
          :disabled="totalMatches === 0"
          size="small"
          variant="outlined"
        >
          <i class="pi pi-arrow-up"></i>
        </Button>
        <Button
          @click="goToNextMatch"
          :disabled="totalMatches === 0"
          size="small"
          variant="outlined"
        >
          <i class="pi pi-arrow-down"></i>
        </Button>
        {{ currentMatchDisplay }} / {{ totalMatches }}
        <span
          class="cursor-pointer"
          v-if="currentScriptName"
          @mousedown="goToScript($event, currentScriptId)"
        >
          | {{ currentScriptName }}</span
        >
      </span>
    </div>
    <Panel header="Advanced Filters" toggleable>
      <div class="p-3 flex flex-wrap">
        <Panel header="Script Type ">
          <div class="p-2 flex gap-2">
            <Button
              @click="selectedScriptTypes.client = !selectedScriptTypes.client"
              class="search-option-btn"
              :class="{ active: selectedScriptTypes.client }"
              size="small"
              variant="outlined"
            >
              Client
            </Button>

            <Button
              @click="
                selectedScriptTypes.userevent = !selectedScriptTypes.userevent
              "
              class="search-option-btn"
              :class="{ active: selectedScriptTypes.userevent }"
              size="small"
              variant="outlined"
            >
              User-event
            </Button>
            <Button
              @click="
                selectedScriptTypes.workflowaction =
                  !selectedScriptTypes.workflowaction
              "
              class="search-option-btn"
              :class="{ active: selectedScriptTypes.workflowaction }"
              size="small"
              variant="outlined"
            >
              Worflow-action
            </Button>
          </div>
        </Panel>
      </div>
    </Panel>
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
      class="editor-accordion"
      v-for="item in computedEditors"
      :key="item.script?.scriptId"
      v-model:value="openedState[item.script?.scriptId!]"
    >
      <AccordionPanel value="0">
        <AccordionHeader class="bg-slate-200">
          <span
            class="p-3 bg-slate-300 rounded rounded-tr-none rounded-br-none"
            @mousedown="goToScript($event, item.script?.scriptId!)"
          >
            {{ item.script?.scriptName }} - {{ item.script?.scriptType }}
          </span>
        </AccordionHeader>
        <AccordionContent class="position-relative">
          <Button class="inspect-button" size="small" v-if="item.code"
            ><i class="pi pi-search"></i> Inspect</Button
          >
          <MonacoCodeEditor
            :ref="(el) => setItemRef(el, item)"
            class="editor"
            v-model="item.code"
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
  computed,
} from "vue";
import ProgressSpinner from "primevue/progressspinner";
import { callApi, isChromeExtension, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import * as monaco from "monaco-editor";
import {
  Accordion,
  AccordionContent,
  AccordionHeader,
  AccordionPanel,
  Button,
  InputText,
  MultiSelect,
  Panel,
} from "primevue";
import { completionItems } from "../utils/codeEditorJSCompletion";
import { defaultCode, temporaryCode } from "../utils/temp";
import { debounce } from "lodash";
import { useFormattedRouteName } from "../composables/useFormattedRouteName";

const { formattedRouteName } = useFormattedRouteName();

const props = defineProps<{
  vhOffset: number;
}>();

const openedState = reactive<Record<string, string>>({});
const loading = ref(false);
const scrollContainer = ref<HTMLElement | null>(null);

const selectedScriptTypes = reactive<{
  client: boolean;
  userevent: boolean;
  workflowaction: boolean;
}>({
  client: false,
  userevent: false,
  workflowaction: false,
});

type DeployedScript = {
  scriptName: string;
  scriptType: string;
  scriptFile: string;
  scriptId: string;
};

type Editors = {
  editor?: any; // Reference to MonacoCodeEditor component
  code: string;
  matches?: monaco.editor.FindMatch[];
  decorations?: string[];
  script?: DeployedScript;
};

const editors = reactive<Editors[]>([]);

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
// totalMatches and currentMatchDisplay remain refs
const totalMatches = ref(0);
const currentMatchDisplay = ref(0);

// MAKE THESE REACTIVE (fixes computed updates)
const globalMatchIndex = ref(0); // was let globalMatchIndex = 0;
const allMatches = ref<
  Array<{
    editorIndex: number;
    matchIndex: number;
    lineElement: HTMLElement | null;
  }>
>([]); // was plain array

const debouncedSearch = debounce((value: string) => {
  performGlobalSearch(value);
}, 250);

const computedEditors = computed(() => {
  // If no script types are selected, return all editors
  if (
    !selectedScriptTypes.client &&
    !selectedScriptTypes.userevent &&
    !selectedScriptTypes.workflowaction
  ) {
    return editors;
  }

  return editors.filter((editor) => {
    const type = editor.script?.scriptType?.toLowerCase();
    return (
      (selectedScriptTypes.client && type === "client") ||
      (selectedScriptTypes.userevent && type === "userevent") ||
      (selectedScriptTypes.workflowaction && type === "action")
    );
  });
});

// --- NEW computed using reactive refs ---
const currentScriptName = computed(() => {
  if (!allMatches.value.length) return "";
  const entry = allMatches.value[globalMatchIndex.value];
  if (!entry) return "";
  const script = editors[entry.editorIndex]?.script;
  if (!script) return "";
  return `${script.scriptName} (${script.scriptType})`;
});

const currentScriptId = computed(() => {
  if (!allMatches.value.length) return "";
  const entry = allMatches.value[globalMatchIndex.value];
  if (!entry) return "";
  const script = editors[entry.editorIndex]?.script;
  if (!script) return "";
  return script.scriptId;
});

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

watch(selectedScriptTypes, async () => {
  await nextTick();
  debouncedSearch(searchText.value);
});

// --- Functions ---
const performGlobalSearch = (text: string) => {
  allMatches.value = [];
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
      const lineElement = (lineElements[match.range.startLineNumber - 1] ||
        null) as HTMLElement | null;

      allMatches.value.push({ editorIndex, matchIndex, lineElement });
    });

    totalCount += matches.length;
  });

  totalMatches.value = totalCount;
  globalMatchIndex.value = 0;
  currentMatchDisplay.value = totalCount > 0 ? 1 : 0;

  // Update highlights on all editors
  updateAllHighlights();
};

const scrollToEditor = (lineElement: HTMLElement | null) => {
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
    const currentGlobalMatch = allMatches.value[globalMatchIndex.value];
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
        scrollToEditor(currentGlobalMatch.lineElement || null);
      }
    }
  });
};

// Navigate matches globally
const goToNextMatch = () => {
  if (!allMatches.value.length) return;
  globalMatchIndex.value =
    (globalMatchIndex.value + 1) % allMatches.value.length;
  currentMatchDisplay.value = globalMatchIndex.value + 1;
  updateAllHighlights();
};

const goToPrevMatch = () => {
  if (!allMatches.value.length) return;
  globalMatchIndex.value =
    (globalMatchIndex.value - 1 + allMatches.value.length) %
    allMatches.value.length;
  currentMatchDisplay.value = globalMatchIndex.value + 1;
  updateAllHighlights();
};

// --- Key navigation ---
const handleKey = (event: KeyboardEvent) => {
  if (!allMatches.value.length) return;

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
  item: Editors
) => {
  if (el && item) {
    const originalEditor = editors.find(
      (e) => e.script?.scriptId === item.script?.scriptId
    );
    if (originalEditor) {
      originalEditor.editor = el;
    }
  }
};

// --- Fetch scripts ---
const getDeployedScripts = async () => {
  loading.value = true;
  try {
    if (!isChromeExtension) return;
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
        matches: [],
        decorations: [],
        script: scriptItem,
      });
      openedState[scriptItem.scriptId] = "0"; // initialize
    });
  } catch (error) {
    console.error("Error fetching deployed scripts:", error);
    loading.value = false;
  } finally {
    loading.value = false;
  }
};

const goToScript = async (event: MouseEvent, scriptId: string) => {
  if (!scriptId) return;

  // Only react to left (0) or middle (1) click
  if (event.button !== 0 && event.button !== 1) return;

  event.preventDefault();

  const response =
    (await callApi(RequestRoutes.SCRIPT_URL, { scriptId })) || {};

  if (!response) return;

  const { message: url } = response as ApiResponse;

  if (event.button === 1) {
    // Middle click → open in new tab, stay on current page
    chrome.runtime.sendMessage({ type: "openTab", url });
  } else {
    window.open(url, "_blank");
  }
};

onMounted(() => {
  getDeployedScripts();
});
</script>

<style scoped>
:root {
  --p-panel-background: #fff !important;
}
.search-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  background: white;
  padding: 0.5rem 0;
  z-index: 10;
  padding: 0.5rem;
  border-radius: 0.5rem;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
}

.match-counter {
  font-size: 0.9rem;
  color: #1d1d1d;
  white-space: nowrap;
}

.search-option-btn {
  padding: 0.25rem 0.5rem;
  border: 1px solid #ccc;
  border-radius: 0.25rem;
  color: var(--p-slate-500);
  background: white;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s;
}

.search-option-btn.active {
  background: var(--p-slate-500);
  color: white;
  border-color: var;
}

.search-option-btn:hover {
  background: var(--p-slate-500) !important;
  color: white !important;
}

.progress-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
}

.inspect-button {
  position: absolute;
  top: 0;
  right: 0;
  margin: 1rem;
  z-index: 1;
  background-color: rgba(0, 0, 0, 0.5) !important;
}

.inspect-button:hover {
  background-color: var(--p-slate-500) !important;
}
.editor {
  scroll-margin-top: 2rem;
}

.overlay {
  width: 100%;
  height: 100%;
  cursor: text;
}

.editor-accordion .p-accordionheader {
  box-shadow: rgba(100, 100, 111, 0.2) 0px 7px 20px 0px;
  padding: 0;
  padding-right: 1rem;
}

.search-container {
  background-color: #fff;
  border-radius: 0.5rem;
  overflow: hidden;
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

.editor-accordion .p-accordioncontent-content {
  padding: 0 !important;
}

.search-container .p-panel-header {
  background-color: #fff !important;
  justify-content: start !important;
  gap: 1rem !important;
}

.search-container .p-panel-content {
  background-color: #fff !important;
}

.search-container .p-panel {
  outline: none !important;
  border: none !important;
}
</style>
