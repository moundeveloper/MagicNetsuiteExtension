<template>
  <ViewHeader />

  <MCard
    flex
    autoHeight
    direction="row"
    gap="0.5"
    padding=""
    outlined
    elevated
    :style="{ height: `90vh` }"
  >
    <template #default>
      <ExpandableSidebar>
          <template #collapsed>
    <button
      class="p-2 rounded bg-slate-600 hover:opacity-100 hover:bg-slate-500 transition-opacity duration-150 text-[var(--p-slate-50)]"
      @click="runCurrentFile"
      :disabled="currentFile?.isExecuting"
      :title="currentFile?.isExecuting ? 'Running...' : 'Run'"
      size="small"
    >
      <i class="pi pi-play text-sm"></i>
    </button>
  </template>
        <template #default>
                    <div class="sidebar-section">
            <h4>Actions</h4>
            <div class="flex flex-col gap-2">
              <Button
                @click="runCurrentFile"
                :disabled="currentFile?.isExecuting"
                class="w-full"
              >
                <i class="pi pi-play font-medium"></i>
                {{ currentFile?.isExecuting ? "Running..." : "Run" }}
              </Button>
              <div class="text-xs text-gray-500">
                <span v-if="saveStatus === 'saving'" class="text-yellow-500">
                  Syncing…
                </span>
                <span v-else-if="saveStatus === 'saved'" class="text-green-500">
                  ✓ Saved
                </span>
                <span v-else-if="saveStatus === 'error'" class="text-red-500">
                  Save failed
                </span>
              </div>
            </div>
          </div>
          <div class="sidebar-section">
            <h4>Files</h4>
            <InputText
              v-model="fileSearchTerm"
              type="text"
              placeholder="Search files..."
              size="small"
              class="w-full mb-2"
            />
            <div class="flex flex-col gap-1 max-h-32 overflow-y-auto pr-2" >
              <div
                v-for="file in filteredFiles"
                :key="file.id"
                class="file-item flex items-center gap-2 py-2 px-4 rounded cursor-pointer hover:bg-slate-200 transition-colors group"
                :class="{ 'bg-slate-200': activeFileId === file.id }"
                @click="openFileInTab(file.id)"
              >
                <i class="pi pi-file text-sm" style="color: var(--p-slate-600)"></i>
                <MInput
                  v-model="file.name"
                  outlined
                  item-dynamic
                  class="flex-1 text-ellipsis overflow-hidden"
                />
                <button
                  class="ml-auto p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-300"
                  @click.stop="removeFile(file.id)"
                >
                  <i class="pi pi-times text-xs"></i>
                </button>
              </div>
            </div>
            <Button size="small" text class="mt-2 w-full" @click="addNewFile">
              <i class="pi pi-plus text-sm mr-1"></i>
              New File
            </Button>
          </div>

          <div class="sidebar-section">
            <h4>Available Commands</h4>
            <InputText
              v-model="commandSearchTerm"
              type="text"
              placeholder="Search commands..."
              size="small"
              class="w-full mb-2"
            />
            <div class="flex flex-col gap-1 text-xs max-h-32 overflow-y-auto">
              <p v-for="cmd in filteredCommands" :key="cmd.name">
                <code>{{ cmd.name }}</code> - {{ cmd.description }}
              </p>
            </div>
          </div>
        </template>
      </ExpandableSidebar>

      <div class="flex-1 flex flex-col p-2" style="min-width: 0">
       <MTabs
  v-if="openTabs.length > 0"
  :tabs="tabs"
  :dynamic="true"
  v-model="activeFileId"
  @add-tab="addNewFile"
  @delete-tab="removeFileByTab"
>
          <template #[`'${activeFileId}-toolbar'`]>
            <div class="flex items-center gap-2 p-2 bg-slate-100">
              <Button @click="runCurrentFile" :disabled="currentFile?.isExecuting">
                {{ currentFile?.isExecuting ? "Running..." : "Run" }}
              </Button>
            </div>
          </template>

          <template #tab-content="{ activeTab: activeTabName, contentHeight }">
            <div
              v-for="file in files"
              :key="file.id"
              v-show="activeTabName === file.id"
              class="h-full"
              :style="{ height: `${contentHeight}px` }"
            >
              <vue-splitter is-horizontal data-ignore class="h-full">
                <template #top-pane>
                  <MonacoCodeEditor
                    v-model="file.code"
                    :readonly="file.isExecuting"
                    :completion-items="completionItems"
                  />
                </template>
                <template #bottom-pane>
                  <TerminalLogs
                    :logs="file.logs"
                    @command="(input) => handleCommand(input, file.id)"
                  />
                </template>
              </vue-splitter>
            </div>
          </template>
        </MTabs>

        <div
          v-if="openTabs.length === 0 && files.length > 0"
          class="flex-1 flex items-center justify-center text-gray-500"
        >
          <div class="text-center">
            <i class="pi pi-folder-open text-4xl mb-2"></i>
            <p>No tabs open</p>
            <p class="text-sm">Click a file in the sidebar to open it</p>
          </div>
        </div>

        <div
          v-else-if="files.length === 0"
          class="flex-1 flex items-center justify-center text-gray-500"
        >
          <div class="text-center">
            <i class="pi pi-file text-4xl mb-2"></i>
            <p>No files open</p>
            <Button size="small" class="mt-2" @click="addNewFile">
              <i class="pi pi-plus mr-1"></i>
              New File
            </Button>
          </div>
        </div>
      </div>
    </template>
  </MCard>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref, watch, computed, nextTick } from "vue";
import { ApiRequestType, callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { Button } from "primevue";
import { InputText } from "primevue";
import { defaultCode } from "../utils/temp";
import VueSplitter from "@rmp135/vue-splitter";
import TerminalLogs from "../components/TerminalLogs.vue";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import { completionItems } from "../utils/codeEditorJSCompletion";
import ViewHeader from "../components/ViewHeader.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MCard from "../components/universal/card/MCard.vue";
import MTabs from "../components/universal/tabs/MTabs.vue";
import MInput from "../components/universal/input/MInput.vue";
import { generateId } from "../utils/utilities";

type Log = {
  type: "log" | "warn" | "error";
  values: string[];
};

interface ScriptFile {
  id: string;
  name: string;
  code: string;
  logs: Log[];
  isExecuting: boolean;
}

const props = defineProps<{
  vhOffset: number;
}>();

const files = ref<ScriptFile[]>([]);
const openTabs = ref<string[]>([]);
const activeFileId = ref("");
const fileSearchTerm = ref("");
const commandSearchTerm = ref("");
const isRestoring = ref(true);

const persistedState = computed(() => ({
  files: files.value.map(f => ({
    id: f.id,
    name: f.name,
    code: f.code
  })),
  openTabs: openTabs.value,
  activeTab: activeFileId.value
}));

const tabs = computed(() =>
  openTabs.value
    .map((id) => {
      const file = files.value.find((f) => f.id === id);
      return file ? { name: file.id, label: file.name } : null;
    })
    .filter((t): t is { name: string; label: string } => t !== null)
);

const filteredFiles = computed(() => {
  const searchTerm = fileSearchTerm.value.toLowerCase();
  if (!searchTerm) return files.value;
  return files.value.filter((file) =>
    file.name.toLowerCase().includes(searchTerm)
  );
});

interface CommandInfo {
  name: string;
  description: string;
}

const availableCommands = ref<CommandInfo[]>([
  { name: "clear", description: "Clear terminal" },
  { name: "help", description: "Show available commands" },
  { name: "echo [text]", description: "Print text" },
  { name: "modules", description: "List available modules" }
]);

const filteredCommands = computed(() => {
  const searchTerm = commandSearchTerm.value.toLowerCase();
  if (!searchTerm) return availableCommands.value;
  return availableCommands.value.filter((cmd) =>
    cmd.name.toLowerCase().includes(searchTerm) ||
    cmd.description.toLowerCase().includes(searchTerm)
  );
});

const currentFile = computed(() =>
  files.value.find((f) => f.id === activeFileId.value)
);

const addNewFile = () => {
  const newId = generateId();
  files.value.push({
    id: newId,
    name: `script${newId}`,
    code: "",
    logs: [],
    isExecuting: false
  });
  openTabs.value.push(newId);
  activeFileId.value = newId;
};

const openFileInTab = (fileId: string) => {
  if (!openTabs.value.includes(fileId)) {
    openTabs.value.push(fileId);
  }
  activeFileId.value = fileId;
};

const removeFile = (fileId: string) => {
  openTabs.value = openTabs.value.filter((id) => id !== fileId);
  
  const index = files.value.findIndex((f) => f.id === fileId);
  if (index > -1) {
    files.value.splice(index, 1);
  }
  
  if (activeFileId.value === fileId) {
    activeFileId.value = openTabs.value[0] || files.value[0]?.id || "";
  }
};

const removeFileByTab = ({ tabId, nextTabId }: { tabId: string; nextTabId: string | null }) => {
  openTabs.value = openTabs.value.filter((id) => id !== tabId);
  
  if (activeFileId.value === tabId) {
    activeFileId.value = nextTabId || openTabs.value[0] || files.value[0]?.id || "";
  }
};

type CommandHandler = (args: string[]) => void;

const getCommands = (fileId: string): Record<string, CommandHandler> => ({
  clear() {
    const file = files.value.find((f) => f.id === fileId);
    if (file) file.logs = [];
  },

  help() {
    const file = files.value.find((f) => f.id === fileId);
    if (file) {
      file.logs.push({
        type: "log",
        values: [`Available commands: ${availableCommands.value.map((c) => c.name).join(", ")}`]
      });
    }
  },

  echo(args) {
    const file = files.value.find((f) => f.id === fileId);
    if (file) {
      file.logs.push({
        type: "log",
        values: [args.join(" ")]
      });
    }
  },

  modules: async () => {
    const file = files.value.find((f) => f.id === fileId);
    if (file) {
      const modules = await getModules();
      file.logs.push({
        type: "log",
        values: [`Available modules: ${modules.join(", ")}`]
      });
    }
  }
});

const handleCommand = (input: string, fileId: string) => {
  const file = files.value.find((f) => f.id === fileId);
  if (!file) return;

  file.logs.push({ type: "log", values: [`$ ${input}`] });

  const [command, ...args] = input.trim().split(/\s+/);

  if (!command) return;

  const commands = getCommands(fileId);
  const handler = commands[command];

  if (!handler) {
    file.logs.push({
      type: "error",
      values: [`Command not found: ${command}`]
    });
    return;
  }

  handler(args);
};

const getModules = async () => {
  const response = await callApi(RequestRoutes.AVAILABLE_MODULES);
  const { message: modules } = response as ApiResponse;
  return modules || [];
};

const handleStreamingResponse = (
  message: { isComplete: boolean; data: any },
  fileId: string
) => {
  const file = files.value.find((f) => f.id === fileId);
  if (!file) return;

  console.log("[handleStreamingResponse]", message);
  if (message.isComplete) {
    file.isExecuting = false;
    return;
  }

  const { data } = message;
  const { type } = data;

  const allowedTypes = ["log", "warn", "error"];

  if (allowedTypes.includes(type)) {
    file.logs.push(data);
  }
};

const runFile = async (fileId: string) => {
  const file = files.value.find((f) => f.id === fileId);
  if (!file) return;

  file.isExecuting = true;
  file.logs = [];

  try {
    await callApi(
      RequestRoutes.RUN_QUICK_SCRIPT,
      {
        code: file.code
      },
      ApiRequestType.STREAM,
      (message: any) => {
        try {
          handleStreamingResponse(message, fileId);
        } catch (error) {
          if (file) file.isExecuting = false;
        }
      }
    );
  } catch (error) {
    console.error("Execution error:", error);
    if (file) {
      file.logs.push({
        type: "error",
        values: [`Execution failed: ${error}`]
      });
      file.isExecuting = false;
    }
  } finally {
    if (file) file.isExecuting = false;
  }
};

const runCurrentFile = () => {
  if (activeFileId.value) {
    runFile(activeFileId.value);
  }
};

type SaveStatus = "idle" | "saving" | "saved" | "error";
const saveStatus = ref<SaveStatus>("idle");
let saveTimeout: number | undefined;

const saveAllFiles = (state: any) => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;

  saveStatus.value = "saving";

  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = window.setTimeout(() => {
    chrome.storage.local.set(
      {
        cachedFiles: state.files,
        cachedOpenTabs: state.openTabs,
        cachedActiveTab: state.activeTab
      },
      () => {
        if (chrome.runtime.lastError) {
          saveStatus.value = "error";
          return;
        }

        saveStatus.value = "saved";

        setTimeout(() => {
          if (saveStatus.value === "saved") saveStatus.value = "idle";
        }, 1500);
      }
    );
  }, 1000);
};

watch(
  persistedState,
  (state) => {
    if (isRestoring.value) return;
    saveAllFiles(state);
  },
  { deep: true }
);

onMounted(() => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    isRestoring.value = false;
    return;
  }

  chrome.storage.local.get(
    ["cachedFiles", "cachedOpenTabs", "cachedActiveTab"],
    (result) => {

      try {
        const restoredFiles = Array.isArray(result.cachedFiles)
          ? result.cachedFiles.map((f: any) => ({
              id: f.id || generateId(),
              name: f.name || "script.js",
              code: f.code || "",
              logs: [],
              isExecuting: false
            }))
          : [];

        files.value = restoredFiles;

        let cachedTabs: string[] = [];

        // Validate cachedOpenTabs
        if (Array.isArray(result.cachedOpenTabs)) {
          cachedTabs = result.cachedOpenTabs;
        } else if (
          result.cachedOpenTabs &&
          typeof result.cachedOpenTabs === "object"
        ) {
          // Handle legacy object format
          cachedTabs = Object.values(result.cachedOpenTabs);
        } else if (result.cachedOpenTabs !== undefined) {
          // Invalid format → clear it from storage
          chrome.storage.local.remove("cachedOpenTabs");
        }

        // Only keep tabs that still have a valid file
        const validTabs = cachedTabs.filter((id: string) =>
          restoredFiles.some((file: ScriptFile) => file.id === id)
        );

        // 🚨 DO NOT auto-open files if storage had none
        openTabs.value = validTabs;

        const active = result.cachedActiveTab;

        activeFileId.value =
          typeof active === "string" && openTabs.value.includes(active)
            ? active
            : openTabs.value[0] || "";

      } catch (error) {
        console.error("Restore failed, resetting tabs:", error);

        // Reset corrupted tab state
        openTabs.value = [];
        activeFileId.value = "";

        chrome.storage.local.remove(["cachedOpenTabs", "cachedActiveTab"]);
      }

      isRestoring.value = false;
    }
  );
});


onBeforeUnmount(() => {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const filesData = files.value.map((f) => ({
        id: f.id,
        name: f.name,
        code: f.code
      }));
      chrome.storage.local.set({ 
        cachedFiles: filesData,
        cachedOpenTabs: openTabs.value,
        cachedActiveTab: activeFileId.value
      }, () => {
        console.log("Saved!");
      });
    }
  } catch (error) {
    console.error(error);
  }
});
</script>

<style scoped>
.sidebar-section {
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  background: var(--p-slate-100);
  border-radius: 4px;
  border: 1px solid var(--p-slate-200);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sidebar-section h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-slate-700);
}

.sidebar-section p {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-slate-600);
}

.sidebar-section code {
  background: var(--p-slate-200);
  padding: 0.125rem 0.25rem;
  border-radius: 2px;
  font-size: 0.7rem;
}

.file-item {
  font-size: 0.875rem;
}

.file-item:hover .opacity-0 {
  opacity: 1;
}

.sidebar-section :deep(.p-inputtext) {
  font-size: 0.75rem;
}

.sidebar-section :deep(.max-h-32) {
  max-height: 8rem;
}
</style>
