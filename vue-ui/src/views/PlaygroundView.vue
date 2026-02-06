<!-- Usage in Playground -->
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
    <!-- Buttons to trigger search and navigate matches -->
    <InputText v-model="searchTerm" placeholder="Search..." />
    <Button @click="triggerSearch">Search</Button>
    <Button @click="next">Next</Button>
    <Button @click="previous">Previous</Button>

    <!-- CodeViewer component -->
    <CodeViewer
      ref="codeViewerRef"
      :code="javascriptCode"
      language="javascript"
    />
  </MCard>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import CodeViewer from "../components/CodeViewer.vue";
import MCard from "../components/universal/card/MCard.vue";
import { Button, InputText } from "primevue";

const javascriptCode = `
const greeting = "Hello, World!";

function calculateSum(a, b) {
  // This is a comment
  return a + b;
}

class Person {
  constructor(name, age) {
    this.name = name;
    this.age = age;
  }
  
  greet() {
    console.log(\`Hello, my name is \${this.name}\`);
  }
}

const person = new Person("Alice", 30);
person.greet();

async function fetchData() {
  try {
    const response = await fetch('https://api.example.com/data');
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error:', error);
  }
}
`;

const searchTerm = ref("");

const codeViewerRef = ref<InstanceType<typeof CodeViewer> | null>(null);

// Trigger search for "const"
const triggerSearch = () => {
  codeViewerRef.value?.search(searchTerm.value);
};

// Navigate to next match
const next = () => {
  codeViewerRef.value?.nextMatch();
};

// Navigate to previous match
const previous = () => {
  codeViewerRef.value?.previousMatch();
};

watch(searchTerm, () => {
  codeViewerRef.value?.search(searchTerm.value);
});
</script>
