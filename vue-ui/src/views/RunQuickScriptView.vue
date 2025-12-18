<template>
  <h1>{{ formattedRouteName }}</h1>
  <Button @click="runCode"> Run </Button>

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
import { onBeforeUnmount, onMounted, ref } from "vue";
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
