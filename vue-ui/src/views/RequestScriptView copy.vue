<template>
  <div class="wraper">
    <h1>Request Script</h1>

    <Splitter class="flex-1">
      <SplitterPanel
        class="flex flex-col justify-center"
        :size="15"
        :minSize="10"
      >
        <div class="p-4 bg-slate-200">Requests Collection</div>
        <Tree
          v-model:value="nodes"
          class="w-full h-full overflow-y-auto"
          draggableNodes
          droppableNodes
        ></Tree>
      </SplitterPanel>

      <SplitterPanel class="flex flex-col items-center justify-center">
        <!-- Toolbar -->
        <div class="flex w-full p-4 gap-2 toolbar-custom">
          <Select
            v-model="selectedSuitelet"
            :options="suiteletScripts"
            filter
            optionLabel="label"
            placeholder="Select a Script"
            class="w-full md:w-56"
            @change="handleSuiteletChange"
          >
            <template #value="slotProps">
              <div v-if="slotProps.value" class="flex items-center">
                <div>{{ slotProps.value.label }}</div>
              </div>
              <span v-else>{{ slotProps.placeholder }}</span>
            </template>
          </Select>
          <Select
            v-model="selectedDeployment"
            :options="suiteletDeployments"
            filter
            optionLabel="label"
            placeholder="Select a Deployment"
            class="w-full md:w-56"
          />
          <Select
            v-model="selectedRequestMethod"
            :options="requestMethods"
            optionLabel="label"
            optionValue="value"
            placeholder="Select a Request Method"
            class="w-full md:w-56"
          />
          <Button>Send</Button>
        </div>

        <!-- Content -->
        <Splitter layout="vertical" class="h-full w-full">
          <SplitterPanel class="flex items-center justify-center">
            <Tabs v-model:value="activeIndex" class="h-full w-full">
              <TabList class="h-full w-full">
                <Tab v-for="(tab, index) in tabs" :key="tab.id" :value="tab.id">
                  <div class="flex items-center gap-4">
                    <span class="text-base">{{ tab.title }}</span>
                    <button
                      class="text-gray-500 hover:text-red-500 text-xs"
                      @click.stop="closeTab(index)"
                    >
                      <i class="pi pi-times"></i>
                    </button>
                  </div>
                </Tab>
              </TabList>

              <TabPanels class="h-full">
                <TabPanel
                  v-for="tab in tabs"
                  :key="tab.id"
                  :value="tab.id"
                  class="h-full"
                >
                  {{ tab.content }}
                </TabPanel>
              </TabPanels>
            </Tabs>
          </SplitterPanel>
          <SplitterPanel class="flex items-center justify-center">
            Panel 2
          </SplitterPanel>
        </Splitter>
      </SplitterPanel>
    </Splitter>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import Tabs from "primevue/tabs";
import TabList from "primevue/tablist";
import Tab from "primevue/tab";
import TabPanels from "primevue/tabpanels";
import TabPanel from "primevue/tabpanel";
import { Button, Select, Splitter, SplitterPanel, Tree } from "primevue";

const tabs = ref([
  { id: 1, title: "main.js", content: 'console.log("Hello world")' },
  { id: 2, title: "App.vue", content: "<template>Hello Vue</template>" },
]);

const suiteletScripts = ref([]);
const suiteletDeployments = ref([]);
const requestMethods = [
  { label: "GET", value: "GET" },
  { label: "POST", value: "POST" },
];

const nodes = ref([
  {
    key: "0",
    label: ".github",
    data: ".github folder",
    icon: "pi pi-fw pi-folder",
    children: [
      {
        key: "0-0",
        label: "workflows",
        data: "workflows folder",
        icon: "pi pi-fw pi-folder",
        children: [
          {
            key: "0-0-0",
            label: "node.js.yml",
            data: "node.js.yml file",
            icon: "pi pi-fw pi-file",
          },
        ],
      },
    ],
  },
  {
    key: "1",
    label: ".vscode",
    data: ".vscode folder",
    icon: "pi pi-fw pi-folder",
    children: [
      {
        key: "1-0",
        label: "extensions.json",
        data: "extensions.json file",
        icon: "pi pi-fw pi-file",
      },
    ],
  },
  {
    key: "2",
    label: "public",
    data: "public folder",
    icon: "pi pi-fw pi-folder",
    children: [
      {
        key: "2-0",
        label: "vite.svg",
        data: "vite.svg file",
        icon: "pi pi-fw pi-file",
      },
    ],
  },
  {
    key: "3",
    label: "src",
    data: "src folder",
    icon: "pi pi-fw pi-folder",
    children: [
      {
        key: "3-0",
        label: "assets",
        data: "assets folder",
        icon: "pi pi-fw pi-folder",
        children: [
          {
            key: "3-0-0",
            label: "vue.svg",
            data: "vue.svg file",
            icon: "pi pi-fw pi-file",
          },
        ],
      },
      {
        key: "3-1",
        label: "components",
        data: "components folder",
        icon: "pi pi-fw pi-folder",
        children: [
          {
            key: "3-1-0",
            label: "HelloWorld.vue",
            data: "HelloWorld.vue file",
            icon: "pi pi-fw pi-file",
          },
        ],
      },
      {
        key: "3-2",
        label: "App.vue",
        data: "App.vue file",
        icon: "pi pi-fw pi-file",
      },
      {
        key: "3-3",
        label: "main.js",
        data: "main.js file",
        icon: "pi pi-fw pi-file",
      },
      {
        key: "3-4",
        label: "style.css",
        data: "style.css file",
        icon: "pi pi-fw pi-file",
      },
    ],
  },
  {
    key: "4",
    label: "index.html",
    data: "index.html file",
    icon: "pi pi-fw pi-file",
  },
  {
    key: "5",
    label: "package.json",
    data: "package.json file",
    icon: "pi pi-fw pi-file",
  },
  {
    key: "6",
    label: "vite.config.js",
    data: "vite.config.js file",
    icon: "pi pi-fw pi-file",
  },
]);

const selectedSuitelet = ref(null);
const selectedDeployment = ref(null);
const selectedRequestMethod = ref(requestMethods[0]!.value);

const activeIndex = ref(1);

function closeTab(index: number) {
  tabs.value.splice(index, 1);
  if (activeIndex.value >= tabs.value.length) {
    activeIndex.value = tabs.value.length - 1;
  }
}

function addTab() {
  const id = Date.now();
  tabs.value.push({
    id,
    title: `new-${id}.js`,
    content: "// New file",
  });
  activeIndex.value = tabs.value.length - 1;
}

const handleSuiteletChange = () => {};
</script>

<style>
.wraper {
  padding: 2rem;
  display: flex;
  gap: 1rem;
  flex-direction: column;
}
button {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
}

.toolbar-custom > *:not(:last-child) {
  flex: 1;
}
</style>
