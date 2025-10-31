<template>
  <div class="wraper">
    <h1>Run Quick Script</h1>
    <Button @click="runCode"> Run </Button>

    <vue-splitter is-horizontal class="flex-1 max-h-[76vh]">
      <template #top-pane> <CodeEditor v-model:model-value="code" /> </template>
      <template #bottom-pane>
        <TerminalLogs :logs="logs" @command="handleCommand" />
      </template>
    </vue-splitter>
  </div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import CodeEditor from "../components/CodeEditor.vue";
import { callApi } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { Button } from "primevue";
import { terminalResponse, defaultCode } from "../utils/temp";
import VueSplitter from "@rmp135/vue-splitter";
import TerminalLogs from "../components/TerminalLogs.vue";

type Log = {
  type: "log" | "warn" | "error";
  values: string[];
};
// v-model code
const codeEditorElement = ref<HTMLDivElement | null>(null);
const panelHeight = ref(0);
const logs = ref<Log[]>([]);
const code = ref<string>(defaultCode);

const handleCommand = (cmd: string) => {
  logs.value.push({ type: "log", values: [`$ ${cmd}`] });

  const commandMapping: Record<string, () => any> = {
    clear: () => (logs.value = []),
    help: () => {
      logs.value.push({
        type: "log",
        values: ["Available commands: clear, help, echo <text>"],
      });
    },
    echo: () => {
      const text = cmd.split(" ").slice(1).join(" ");
      logs.value.push({ type: "log", values: [text] });
    },
  };

  const handler = commandMapping[cmd.split(" ")[0]!];

  if (!handler) {
    logs.value.push({ type: "error", values: [`Command not found: ${cmd}`] });
    return;
  }

  handler();
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
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});
</script>

<style scoped></style>
