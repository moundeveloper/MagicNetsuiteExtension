<template>
  <div>Playground</div>

  <MCard
    flex
    direction="column"
    gap="1rem"
    padding="1rem"
    outlined
    class="overflow-y-auto"
  >
    <!-- Global search input -->
    <InputText
      v-model="searchTerm"
      placeholder="Search..."
      @keyup="handleCodeEditorSearch"
    />
    <Button @click="next">Next</Button>
    <Button @click="previous">Previous</Button>

    <!-- Multiple CodeViewers -->
    <CodeViewer
      v-for="(code, i) in codes"
      :key="i"
      :ref="(el) => registerViewer(el as unknown as CodeViewerAPI | null)"
      :code="code"
      language="javascript"
      showId
    />
  </MCard>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import CodeViewer from "../components/CodeViewer.vue";
import MCard from "../components/universal/card/MCard.vue";
import { Button, InputText } from "primevue";
import {
  useCodeViewerSearch,
  type CodeViewerAPI
} from "../composables/useCodeViewerSearch";

defineProps<{ vhOffset: number }>();

const searchTerm = ref("");
const codes = [
  `const greeting = "Hello, World!";
function calculateSum(a, b) { return a + b; }`,
  `class Person {
  constructor(name, age) { this.name = name; this.age = age; }
  greet() { console.log(\`Hello, \${this.name}\`); }
}`,
  `const greeting = "Hello, World!";
function calculateSum(a, b) { return a + b; }`,
  `class Person {
  constructor(name, age) { this.name = name; this.age = age; }
  greet() { console.log(\`Hello, \${this.name}\`); }
}`,
  `const greeting = "Hello, World!";
function calculateSum(a, b) { return a + b; }`,
  `class Person {
  constructor(name, age) { this.name = name; this.age = age; }
  greet() { console.log(\`Hello, \${this.name}\`); }
}`,
  `const greeting = "Hello, World!";
function calculateSum(a, b) { return a + b; }`,
  `class Person {
  constructor(name, age) { this.name = name; this.age = age; }
  greet() { console.log(\`Hello, \${this.name}\`); }
}`,
  `const greeting = "Hello, World!";
function calculateSum(a, b) { return a + b; }`,
  `class Person {
  constructor(name, age) { this.name = name; this.age = age; }
  greet() { console.log(\`Hello, \${this.name}\`); }
}`
];

const { registerViewer, search, next, previous } = useCodeViewerSearch();

const handleCodeEditorSearch = (event: KeyboardEvent) => {
  if (event.key === "Enter" && event.shiftKey) {
    previous(); // Shift+Enter → go backwards
  } else if (event.key === "Enter" && !event.shiftKey) {
    next(); // Enter → go forwards
  }
};
</script>
