<template>
  <h1>{{ formattedRouteName }}</h1>
  <div class="flex items-center gap-2">
    <Button @click="runCode">Run</Button>

    <span v-if="saveStatus === 'saving'" class="text-xs text-yellow-500">
      Syncing…
    </span>

    <span v-else-if="saveStatus === 'saved'" class="text-xs text-green-500">
      ✓ Saved
    </span>

    <span v-else-if="saveStatus === 'error'" class="text-xs text-red-500">
      Save failed
    </span>
  </div>

  <vue-splitter
    is-horizontal
    data-ignore
    :style="{ height: `85vh` }"
    class="max-h-[80vh]"
  >
    <template #top-pane>
      <MonacoCodeEditor
        ref="editorRef"
        v-model="code"
        :readonly="false"
        :completion-items="completionItems"
      />
    </template>
    <template #bottom-pane>
      <TerminalLogs :logs="logs" @command="handleCommand" />
    </template>
  </vue-splitter>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { Button } from "primevue";
import { defaultCode } from "../utils/temp";
import VueSplitter from "@rmp135/vue-splitter";
import TerminalLogs from "../components/TerminalLogs.vue";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import { completionItems } from "../utils/codeEditorJSCompletion";
import { useFormattedRouteName } from "../composables/useFormattedRouteName";

const { formattedRouteName } = useFormattedRouteName();

type Log = {
  type: "log" | "warn" | "error";
  values: string[];
};
// v-model code
const codeEditorElement = ref<HTMLDivElement | null>(null);
const panelHeight = ref(0);
const logs = ref<Log[]>([]);
const code = ref<string>(defaultCode);
const localHeight = ref(0);
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
      values: ["Available commands: " + Object.keys(commands).join(", ")],
    });
  },

  echo(args) {
    logs.value.push({
      type: "log",
      values: [args.join(" ")],
    });
  },
  modules: async () => {
    const modules = await getModules();
    logs.value.push({
      type: "log",
      values: [`Available modules: ${modules.join(", ")}`],
    });
  },
};

const handleCommand = (input: string) => {
  logs.value.push({ type: "log", values: [`$ ${input}`] });

  const [command, ...args] = input.trim().split(/\s+/);

  if (!command) return;

  const handler = commands[command];

  if (!handler) {
    logs.value.push({
      type: "error",
      values: [`Command not found: ${command}`],
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

const runCode = async () => {
  const response = await callApi(RequestRoutes.RUN_QUICK_SCRIPT, {
    code: code.value,
  });
  console.log(response);
  logs.value = response.message as Log[];
};

let resizeObserver: ResizeObserver;

onMounted(() => {
  try {
    logs.value.push({
      type: "log",
      values: ["Available commands: " + Object.keys(commands).join(", ")],
    });

    chrome.storage.local.get("cachedCode", (result) => {
      console.log("Value:", result.cachedCode);
      code.value = result.cachedCode;
    });

    localHeight.value = props.vhOffset;
    if (codeEditorElement.value) {
      // set initial height
      panelHeight.value = codeEditorElement.value.clientHeight;

      // observe size changes
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

type SaveStatus = "idle" | "saving" | "saved" | "error";
const saveStatus = ref<SaveStatus>("idle");
let saveTimeout: number | undefined;

watch(code, (newCode) => {
  // User typed → mark as dirty
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

      // Optional: return to idle after a bit
      setTimeout(() => {
        if (saveStatus.value === "saved") {
          saveStatus.value = "idle";
        }
      }, 1500);
    });
  }, 2000);
});

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

<style scoped></style>
