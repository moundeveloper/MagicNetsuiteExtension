<template>
  <div class="wraper">
    <h1>Request Script</h1>

    <Splitter class="flex-1">
      <SplitterPanel
        class="flex flex-col justify-center"
        :size="15"
        :minSize="15"
      >
        <div class="p-4 bg-slate-200">Requests Collection</div>
        <Tree
          v-model:value="nodes"
          class="w-full h-full overflow-y-auto"
          draggableNodes
          droppableNodes
        />
      </SplitterPanel>

      <SplitterPanel
        class="flex flex-col items-center justify-center"
        :size="85"
      >
        <Tabs v-model:value="activeIndex" class="h-full w-full">
          <TabList class="w-full">
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

          <TabPanels class="h-full tab-pannels">
            <TabPanel
              v-for="tab in tabs"
              :key="tab.id"
              :value="tab.id"
              class="h-full flex flex-col"
            >
              <!-- Toolbar -->
              <div class="flex w-full p-4 gap-2 toolbar-custom">
                <!-- Each Select is bound to the current tab -->
                <Select
                  v-model="tab.selectedSuitelet"
                  :options="suiteletScripts"
                  filter
                  optionLabel="label"
                  placeholder="Select a Script"
                  class="w-full md:w-56"
                  @change="handleSuiteletChange(tab)"
                />

                <Select
                  v-model="tab.selectedDeployment"
                  :options="suiteletDeployments"
                  filter
                  optionLabel="label"
                  placeholder="Select a Deployment"
                  class="w-full md:w-56"
                />

                <Select
                  v-model="tab.selectedRequestMethod"
                  :options="requestMethods"
                  optionLabel="label"
                  optionValue="value"
                  placeholder="Select a Request Method"
                  class="w-full md:w-56"
                />

                <Button @click="sendRequest(tab)">Send</Button>
              </div>

              <vue-splitter is-horizontal class="flex-1">
                <template #top-pane>Top Pane content</template>
                <template #bottom-pane>Bottom Pane content</template>
              </vue-splitter>
            </TabPanel>
          </TabPanels>
        </Tabs>
      </SplitterPanel>
    </Splitter>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import Tabs from "primevue/tabs";
import TabList from "primevue/tablist";
import Tab from "primevue/tab";
import TabPanels from "primevue/tabpanels";
import TabPanel from "primevue/tabpanel";
import { Button, Select, Splitter, SplitterPanel, Tree } from "primevue";
import VueSplitter from "@rmp135/vue-splitter";
import { treeNodes } from "../utils/temp";

type Tab = {
  id: number;
  title: string;
  content: string;
  selectedSuitelet: any;
  selectedDeployment: any;
  selectedRequestMethod: string;
};

const tabs = reactive<Tab[]>([
  {
    id: 1,
    title: "main.js",
    content: 'console.log("Hello world")',
    selectedSuitelet: null,
    selectedDeployment: null,
    selectedRequestMethod: "GET",
  },
  {
    id: 2,
    title: "App.vue",
    content: "<template>Hello Vue</template>",
    selectedSuitelet: null,
    selectedDeployment: null,
    selectedRequestMethod: "GET",
  },
]);

const suiteletScripts = ref([]);
const suiteletDeployments = ref([]);
const requestMethods = [
  { label: "GET", value: "GET" },
  { label: "POST", value: "POST" },
];

const activeIndex = ref(1);

const nodes = ref(treeNodes);

function closeTab(index: number) {
  tabs.splice(index, 1);
  if (activeIndex.value >= tabs.length) {
    activeIndex.value = tabs.length - 1;
  }
}

const addTab = () => {
  const id = Date.now();
  tabs.push({
    id,
    title: `new-${id}.js`,
    content: "// New file",
    selectedSuitelet: null,
    selectedDeployment: null,
    selectedRequestMethod: "GET",
  });
  activeIndex.value = tabs.length - 1;
};

const handleSuiteletChange = (tab: Tab) => {};

const sendRequest = (tab: Tab) => {};
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

.tab-pannels {
  padding: 0 !important;
}
</style>
