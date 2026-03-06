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
        <template #default>
          <div class="sidebar-section">
            <h4>Quick Script</h4>
            <div class="flex flex-col gap-2">
              <p>Run and test SuiteScript 2.1 code directly.</p>
            </div>
          </div>
          <div class="sidebar-section">
            <h4>Actions</h4>
            <div class="flex flex-col gap-2">
              <Button @click="runCode" :disabled="isExecuting" class="w-full">
                <i class="pi pi-play font-medium"></i>
                {{ isExecuting ? "Running..." : "Run" }}
              </Button>

              <!-- Progress Bar for Streaming -->
              <div
                v-if="isExecuting && progress.total > 0"
                class="flex flex-col gap-1"
              >
                <ProgressBar :value="progress.percentage" :showValue="true" />
                <span class="text-xs text-gray-600">
                  {{ progress.current }}/{{ progress.total }}
                </span>
              </div>

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
            <h4>Available Commands</h4>
            <div class="flex flex-col gap-1 text-xs">
              <p><code>clear</code> - Clear terminal</p>
              <p><code>help</code> - Show available commands</p>
              <p><code>echo [text]</code> - Print text</p>
              <p><code>modules</code> - List available modules</p>
            </div>
          </div>
        </template>
      </ExpandableSidebar>

      <div class="flex-1 flex flex-col" style="min-width: 0">
        <div class="flex items-center gap-2 p-2 bg-slate-100">
          <Button @click="runCode" :disabled="isExecuting">
            {{ isExecuting ? "Running..." : "Run" }}
          </Button>

          <!-- Progress Bar for Streaming -->
          <div
            v-if="isExecuting && progress.total > 0"
            class="flex items-center gap-2"
          >
            <ProgressBar
              :value="progress.percentage"
              :showValue="true"
              class="w-32"
            />
            <span class="text-xs text-gray-600">
              {{ progress.current }}/{{ progress.total }}
            </span>
          </div>

          <span v-if="saveStatus === 'saving'" class="text-xs text-yellow-500">
            Syncing…
          </span>

          <span
            v-else-if="saveStatus === 'saved'"
            class="text-xs text-green-500"
          >
            ✓ Saved
          </span>

          <span v-else-if="saveStatus === 'error'" class="text-xs text-red-500">
            Save failed
          </span>
        </div>

        <vue-splitter is-horizontal data-ignore class="flex-1 m-2">
          <template #top-pane>
            <MonacoCodeEditor
              v-model="code"
              :readonly="isExecuting"
              :completion-items="completionItems"
            />
          </template>
          <template #bottom-pane>
            <TerminalLogs :logs="logs" @command="handleCommand" />
          </template>
        </vue-splitter>
      </div>
    </template>
  </MCard>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ApiRequestType, callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { Button, ProgressBar } from "primevue";
import { defaultCode } from "../utils/temp";
import VueSplitter from "@rmp135/vue-splitter";
import TerminalLogs from "../components/TerminalLogs.vue";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import { completionItems } from "../utils/codeEditorJSCompletion";
import ViewHeader from "../components/ViewHeader.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MCard from "../components/universal/card/MCard.vue";

type Log = {
  type: "log" | "warn" | "error";
  values: string[];
};

// State
const codeEditorElement = ref<HTMLDivElement | null>(null);
const panelHeight = ref(0);
const logs = ref<Log[]>([]);
const code = ref<string>(defaultCode);
const localHeight = ref(0);
const isExecuting = ref(false);
let streamPort: chrome.runtime.Port | null = null;

// Progress tracking
const progress = ref({
  current: 0,
  total: 0,
  percentage: 0,
  message: ""
});

const props = defineProps<{
  vhOffset: number;
}>();

type CommandHandler = (args: string[]) => void;

const commands: Record<string, CommandHandler> = {
  clear() {
    logs.value = [];
  },

  help() {
    logs.value.push({
      type: "log",
      values: ["Available commands: " + Object.keys(commands).join(", ")]
    });
  },

  echo(args) {
    logs.value.push({
      type: "log",
      values: [args.join(" ")]
    });
  },

  modules: async () => {
    const modules = await getModules();
    logs.value.push({
      type: "log",
      values: [`Available modules: ${modules.join(", ")}`]
    });
  }
};

const handleCommand = (input: string) => {
  logs.value.push({ type: "log", values: [`$ ${input}`] });

  const [command, ...args] = input.trim().split(/\s+/);

  if (!command) return;

  const handler = commands[command];

  if (!handler) {
    logs.value.push({
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

// ============================================================================
// Streaming Response Handler
// ============================================================================
const handleStreamingResponse = (message: {
  isComplete: boolean;
  data: any;
}) => {
  console.log("[handleStreamingResponse]", message);
  if (message.isComplete) {
    isExecuting.value = false;

    return;
  }

  const { data } = message;
  const { type } = data;

  const allowedTypes = ["log", "warn", "error"];

  if (allowedTypes.includes(type)) {
    logs.value.push(data);
  }
};

// ============================================================================
// Run Code with Streaming
// ============================================================================

const runCode = async () => {
  isExecuting.value = true;

  // Reset state
  logs.value = [];

  try {
    // Call API with streaming mode
    await callApi(
      RequestRoutes.RUN_QUICK_SCRIPT,
      {
        code: code.value
      },
      ApiRequestType.STREAM,
      (message: any) => {
        try {
          handleStreamingResponse(message);
        } catch (error) {
          isExecuting.value = false;
        }
      }
    );

    // Note: The streaming handler in content script will call handleStreamingResponse
    // via the message listener setup below
  } catch (error) {
    console.error("Execution error:", error);
    logs.value.push({
      type: "error",
      values: [`Execution failed: ${error}`]
    });
    isExecuting.value = false;
  } finally {
    isExecuting.value = false;
  }
};

onMounted(() => {
  try {
    logs.value.push({
      type: "log",
      values: ["Available commands: " + Object.keys(commands).join(", ")]
    });

    chrome.storage.local.get("cachedCode", (result) => {
      code.value = result.cachedCode || defaultCode;
    });

    localHeight.value = props.vhOffset;

    if (codeEditorElement.value) {
      panelHeight.value = codeEditorElement.value.clientHeight;

      resizeObserver = new ResizeObserver(() => {
        if (codeEditorElement.value) {
          panelHeight.value = codeEditorElement.value.clientHeight;
        }
      });

      resizeObserver.observe(codeEditorElement.value);
    }
  } catch (error) {
    console.error(error);
  }
});

// ============================================================================
// Auto-save
// ============================================================================

type SaveStatus = "idle" | "saving" | "saved" | "error";
const saveStatus = ref<SaveStatus>("idle");
let saveTimeout: number | undefined;

watch(code, (newCode) => {
  saveStatus.value = "saving";

  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }

  saveTimeout = window.setTimeout(() => {
    chrome.storage.local.set({ cachedCode: newCode }, () => {
      if (chrome.runtime.lastError) {
        saveStatus.value = "error";
        return;
      }

      saveStatus.value = "saved";

      setTimeout(() => {
        if (saveStatus.value === "saved") {
          saveStatus.value = "idle";
        }
      }, 1500);
    });
  }, 2000);
});

let resizeObserver: ResizeObserver;

onBeforeUnmount(() => {
  try {
    chrome.storage.local.set({ cachedCode: code.value }, () => {
      console.log("Saved!");
    });

    resizeObserver?.disconnect();
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
</style>
