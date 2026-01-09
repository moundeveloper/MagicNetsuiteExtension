// ParentComponent.vue
<template>
  <div class="w-full h-screen p-4">
    <ExecutionGraph :logs="logs" entryPoint="main" />
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import ExecutionGraph from "../components/ExecutionGraph.vue";

interface LogEntry {
  timestamp: number;
  function: string;
  event: "enter" | "exit";
}

// Example log data
const logs = ref<LogEntry[]>([
  { timestamp: 1, function: "main", event: "enter" },
  { timestamp: 2, function: "init", event: "enter" },
  { timestamp: 3, function: "init", event: "exit" },
  { timestamp: 4, function: "processData", event: "enter" },
  { timestamp: 5, function: "validate", event: "enter" },
  { timestamp: 6, function: "validate", event: "exit" },
  { timestamp: 7, function: "processData", event: "exit" },
  { timestamp: 8, function: "main", event: "exit" },
]);
</script>

<style scoped>
/* Make sure the graph fills the container */
div {
  width: 100%;
  height: 100%;
}
</style>
