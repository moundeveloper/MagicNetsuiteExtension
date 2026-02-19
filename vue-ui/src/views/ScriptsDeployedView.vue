<template>
  <h1>{{ formattedRouteName }}</h1>

  <MCard flex direction="column" gap="1rem" padding="1rem" outlined elevated>
    <MCard flex direction="row" gap="1rem" padding="0">
      <InputText
        placeholder="Search"
        v-model="searchTerm"
        @keydown.enter.prevent="handleEnter"
      />

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
          :disabled="matchesCount === 0"
          size="small"
          variant="outlined"
        >
          <i class="pi pi-arrow-up"></i>
        </Button>
        <Button
          @click="goToNextMatch"
          :disabled="matchesCount === 0"
          size="small"
          variant="outlined"
        >
          <i class="pi pi-arrow-down"></i>
        </Button>
        {{ currentIndex }} / {{ matchesCount }}
        <span
          class="cursor-pointer"
          v-if="currentScriptName"
          @mousedown="goToScript($event, currentScriptId)"
        >
          | {{ currentScriptName }}
        </span>
      </span>
    </MCard>

    <MPanel outline toggleable header="Advanced Filters">
      <div class="p-3 flex flex-wrap gap-4">
        <MPanel outline header="Script Type">
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
              Workflow-action
            </Button>
          </div>
        </MPanel>

        <MPanel outline header="Record">
          <div class="p-2">
            <Select
              v-model="selectedRecord"
              :options="availableRecords"
              filter
              optionLabel="name"
              optionValue="id"
              placeholder="Select a Record"
              :virtualScrollerOptions="{ itemSize: 44 }"
              class="w-[25rem]"
              :loading="recordsLoading"
              @change="handleRecordChange"
            />
          </div>
        </MPanel>

        <MPanel outline header="Status">
          <div class="p-2">
            <Checkbox
              v-model="showLockedScripts"
              :binary="true"
              inputId="showLockedScripts"
            />
            <label for="showLockedScripts" class="ml-2 cursor-pointer"
              >Show Locked Scripts</label
            >
          </div>
        </MPanel>
      </div>
    </MPanel>
  </MCard>

  <div v-if="loading" class="flex items-center justify-center h-full w-full">
    <MLoader />
  </div>

  <div
    v-else
    id="scrollContainerEditors"
    class="flex flex-col gap-4 overflow-y-auto overflow-x-hidden p-4 editor-scroller"
    data-ignore
    :style="{ height: `${vhOffset}vh` }"
  >
    <MPanel
      v-for="(item, index) in computedEditors"
      :key="item.script?.scriptId"
      outline
      :expanded="!item.failed"
      class="editor-panel"
    >
      <template #header>
        <span
          class="p-3 bg-slate-300 rounded rounded-tr-none rounded-br-none cursor-pointer flex items-center gap-2"
          @click="goToScript($event, item.script?.id!)"
        >
          <i v-if="item.failed" class="pi pi-lock"></i>
          {{ item.script?.scriptName }} - {{ item.script?.scriptType }}
          <span v-if="item.failed" class="text-red-600 text-sm">(Locked)</span>
        </span>
      </template>

      <div v-if="item.failed" class="p-4 text-center text-gray-500">
        <i class="pi pi-lock text-2xl mb-2"></i>
        <p>Failed to load script content</p>
      </div>
      <CodeViewer
        v-else
        :ref="
          (el) => {
            if (el) registerEditor(el as unknown as CodeViewerAPI, item);
            else unregisterEditor(item);
          }
        "
        :code="item.code || ''"
        language="javascript"
        autoHeight
      />
    </MPanel>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  reactive,
  nextTick,
  watch,
  computed,
  onMounted,
  toRefs
} from "vue";
import MCard from "../components/universal/card/MCard.vue";
import MPanel from "../components/universal/panels/MPanel.vue";
import MLoader from "../components/universal/patterns/MLoader.vue";
import { Button, InputText, Select, Checkbox } from "primevue";
import CodeViewer from "../components/CodeViewer.vue";
import { useFormattedRouteName } from "../composables/useFormattedRouteName";
import { callApi, isChromeExtension, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import {
  useCodeViewerSearch,
  type CodeViewerAPI
} from "../composables/useCodeViewerSearch";

type DeployedScript = {
  scriptName: string;
  scriptType: string;
  scriptFile: string;
  scriptId: string;
  id: number;
};
type Editors = {
  editor?: CodeViewerAPI | null;
  code: string | null;
  script?: DeployedScript;
  failed?: boolean;
};

const { formattedRouteName } = useFormattedRouteName();

const props = defineProps<{ vhOffset: number }>();

const loading = ref(false);
const recordsLoading = ref(false);
const searchTerm = ref("");
const wholeWord = ref(false);
const caseSensitive = ref(false);
const selectedRecord = ref<string | null>(null);
const showLockedScripts = ref(true);
const availableRecords = ref<{ name: string; id: string }[]>([]);

/* New Code Start */
const {
  registerViewer,
  unregisterViewer,
  search,
  next,
  previous,
  matchesCount,
  currentIndex,
  activeViewerId
} = useCodeViewerSearch();

const selectedScriptTypes = reactive({
  client: false,
  userevent: false,
  workflowaction: false
});

const { client, userevent, workflowaction } = toRefs(selectedScriptTypes);

const editors = ref<Editors[]>([]);
const isNavigating = ref(false);

const computedEditors = computed(() => {
  let filtered = editors.value;

  if (!showLockedScripts.value) {
    filtered = filtered.filter((editor) => !editor.failed);
  }

  if (!client.value && !userevent.value && !workflowaction.value) {
    return [...filtered];
  }
  return filtered.filter((editor) => {
    const type = editor.script?.scriptType?.toLowerCase();
    return (
      (client.value && type === "client") ||
      (userevent.value && type === "userevent") ||
      (workflowaction.value && type === "action")
    );
  });
});

const currentScriptName = computed(() => {
  const activeId = activeViewerId.value;
  if (!activeId) return "";

  const match = editors.value.find((item) => item.editor?.id === activeId);
  return match?.script?.scriptName || "";
});

const currentScriptId = computed(() => {
  const activeId = activeViewerId.value;
  if (!activeId) return "";

  const match = editors.value.find((item) => item.editor?.id === activeId);
  return match?.script?.id ?? "";
});

// Navigation
const goToNextMatch = () => {
  isNavigating.value = true;
  next();
  nextTick(() => {
    isNavigating.value = false;
  });
};

const goToPrevMatch = () => {
  isNavigating.value = true;
  previous();
  nextTick(() => {
    isNavigating.value = false;
  });
};

const handleEnter = (event: KeyboardEvent) => {
  if (event.shiftKey) {
    previous();
  } else {
    next();
  }
};

watch(
  [searchTerm, caseSensitive, wholeWord, client, userevent, workflowaction, showLockedScripts],
  async (
    [term, cs, ww, cl, ue, wa, locked],
    [prevTerm, prevCs, prevWw, prevCl, prevUe, prevWa, prevLocked]
  ) => {
    // Do not rebuild index while navigating
    if (isNavigating.value) {
      isNavigating.value = false;
      return;
    }

    // Always rebuild search when filters change
    const filtersChanged = cl !== prevCl || ue !== prevUe || wa !== prevWa || locked !== prevLocked;

    // Ignore no-op changes ONLY when both filters and search params unchanged
    if (
      !filtersChanged &&
      term === prevTerm &&
      cs === prevCs &&
      ww === prevWw
    ) {
      return;
    }

    // Wait for filtered editors to render when filters change
    if (filtersChanged) {
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // If filters changed OR search params changed, rebuild
    search(term, computedEditors.value, {
      caseSensitive: cs,
      wholeWord: ww
    });
  }
);

// Fetch scripts
const getDeployedScripts = async (recordType?: string) => {
  loading.value = true;
  try {
    if (!isChromeExtension) return;

    let type = recordType;
    if (!type) {
      const { message: record } = await callApi(RequestRoutes.CURRENT_REC_TYPE);
      type = record?.type;
    }
    if (!type) return;

    const { message: deployedScriptsResponse } = await callApi(
      RequestRoutes.SCRIPTS_DEPLOYED,
      { recordType: type }
    );
    const deployedScripts = deployedScriptsResponse as DeployedScript[];

    editors.value.length = 0;
    deployedScripts.forEach((scriptItem) => {
      editors.value.push({
        code: scriptItem.scriptFile,
        script: scriptItem,
        failed: !scriptItem.scriptFile
      });
    });

    await nextTick(); // wait for v-for to render
  } catch (error) {
    console.error(error);
  } finally {
    loading.value = false;
  }
};

const getAllRecordTypes = async () => {
  recordsLoading.value = true;
  try {
    if (!isChromeExtension) return;
    const response = await callApi(RequestRoutes.GET_ALL_RECORD_TYPES);
    const records = response.message as { name: string; id: string }[];
    availableRecords.value = records || [];
  } catch (error) {
    console.error("Error fetching records:", error);
  } finally {
    recordsLoading.value = false;
  }
};

const handleRecordChange = () => {
  console.log("Selected record:", selectedRecord.value);
  if (selectedRecord.value) {
    getDeployedScripts(selectedRecord.value);
  }
};

const initializeSelectedRecord = async () => {
  if (!isChromeExtension) return;
  try {
    const { message: record } = await callApi(RequestRoutes.CURRENT_REC_TYPE);
    if (record?.type) {
      selectedRecord.value = record.type;
    }
  } catch (error) {
    console.error("Error getting current record type:", error);
  }
};

onMounted(() => {
  getDeployedScripts();
  getAllRecordTypes();
  initializeSelectedRecord();
});

const goToScript = async (event: MouseEvent, scriptId: string | number) => {
  console.log("scriptId", scriptId);
  if (!scriptId) return;
  event.preventDefault();
  event.stopPropagation();

  const response =
    (await callApi(RequestRoutes.SCRIPT_URL, { scriptId })) || {};
  if (!response) return;
  const { message: url } = response as ApiResponse;

  if (event.button === 1) {
    chrome.runtime.sendMessage({
      type: "OPEN_NON_ACTIVE_TAB",
      url: url
    });
    return;
  }

  window.open(url, "_blank");
};

const registerEditor = (editor: CodeViewerAPI, item: Editors) => {
  const wasNull = !item.editor;
  item.editor = editor;
  if (wasNull) {
    registerViewer(editor);
  }
};

const unregisterEditor = (item: Editors) => {
  if (item.editor) {
    unregisterViewer(item.editor.id);
    item.editor = null;
  }
};
</script>

<style>
.search-option-btn {
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  color: var(--p-slate-500) !important;
  background: var(--m-slate-150) !important;
  outline: 1px solid var(--p-slate-300);
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.25s ease-in-out;
}

.search-option-btn.active {
  background: var(--p-slate-500) !important;
  color: #fff !important;
}
</style>
