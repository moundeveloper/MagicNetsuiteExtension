<template>
  <div class="w-full h-full bg-slate-50 rounded-xl shadow-sm">
    <VueFlow :nodes="nodes" :edges="edges" fit-view class="rounded-xl">
      <Background pattern-color="#aaa" :gap="16" />
      <MiniMap />
      <Controls position="top-left" />
    </VueFlow>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { VueFlow, type Node, type Edge } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";

interface LogEntry {
  timestamp: number;
  function: string;
  event: "enter" | "exit";
}

const props = defineProps<{
  logs: LogEntry[];
  entryPoint: string;
}>();

function buildGraph(logs: LogEntry[]) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const stack: string[] = [];
  let idCounter = 0;

  logs.forEach((log) => {
    if (log.event === "enter") {
      const nodeId = `n-${idCounter++}`;

      nodes.push({
        id: nodeId,
        label: log.function,
        position: { x: 0, y: 0 }, // auto-layout handled later
        style: {
          borderRadius: "12px",
          padding: "10px 14px",
          background: "#4f46e5", // indigo-600
          color: "white",
          fontWeight: 500,
          boxShadow: "0 8px 24px rgba(79,70,229,0.25)",
        },
      });

      if (stack.length > 0) {
        edges.push({
          id: `e-${stack[stack.length - 1]}-${nodeId}`,
          source: stack[stack.length - 1]!,
          target: nodeId,
          animated: true,
          style: { stroke: "#c7d2fe" },
          type: "smoothstep",
        });
      }

      stack.push(nodeId);
    }

    if (log.event === "exit") {
      stack.pop();
    }
  });

  return { nodes, edges };
}

const graph = computed(() => buildGraph(props.logs));

const nodes = computed(() => graph.value.nodes);
const edges = computed(() => graph.value.edges);
</script>

<style scoped>
.vue-flow__node {
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.vue-flow__node:hover {
  transform: translateY(-2px) scale(1.02);
}
</style>
