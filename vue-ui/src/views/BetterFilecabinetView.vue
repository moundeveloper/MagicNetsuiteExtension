<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useFormattedRouteName } from "../composables/useFormattedRouteName";
import {
  Button,
  Column,
  DataTable,
  Splitter,
  SplitterPanel,
  Toolbar,
  Tree,
} from "primevue";
import { RequestRoutes } from "../types/request";
import { callApi, type ApiResponse } from "../utils/api";

type File = {
  id: number;
  name: string;
  size: string;
  modified: string;
};

const { formattedRouteName } = useFormattedRouteName();
defineProps<{
  vhOffset: number;
}>();

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

const files = ref<File[]>([
  { id: 1, name: "File1.docx", size: "12 KB", modified: "2025-12-23" },
  { id: 2, name: "Project.docx", size: "50 KB", modified: "2025-12-23" },
  { id: 3, name: "File2.docx", size: "12 KB", modified: "2025-12-23" },
  { id: 4, name: "File3.docx", size: "12 KB", modified: "2025-12-23" },
  { id: 5, name: "File4.docx", size: "12 KB", modified: "2025-12-23" },
]);

const selectedMediaItems = ref<File[]>([]);
const metaKey = ref(true);

const onTableMouseDown = (event: MouseEvent) => {
  if (
    event.shiftKey &&
    (event.target as HTMLElement)?.closest("tr.p-selectable-row")
  ) {
    event.preventDefault();
  }
};

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Shift") {
    document.body.classList.add("shift-selecting");
  }
};

const onKeyUp = (event: KeyboardEvent) => {
  if (event.key === "Shift") {
    document.body.classList.remove("shift-selecting");
  }
};

const getRootFolders = async () => {
  const response = (await callApi(RequestRoutes.ROOT_FOLDERS)) || {};

  if (!response) return;
  const { message: rootFolders } = response as ApiResponse;

  console.log(rootFolders);
};

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  getRootFolders();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
});
</script>

<template>
  <h1>
    {{ formattedRouteName }}
  </h1>

  <Toolbar>
    <template #start>
      <Button label="New" icon="pi pi-plus" class="p-button-success mr-2" />
      <Button label="Upload" icon="pi pi-upload" class="p-button-help" />
    </template>
  </Toolbar>

  <Splitter data-ignore :style="{ height: `${vhOffset}vh` }">
    <SplitterPanel class="flex flex-col" :size="20" :min-size="20">
      <Tree v-model:value="nodes"></Tree>
    </SplitterPanel>

    <SplitterPanel class="flex flex-col items-center justify-center" :size="85">
      <DataTable
        :value="files"
        class="h-full w-full"
        scrollable
        scrollHeight="flex"
        :virtualScrollerOptions="{ itemSize: 100 }"
        v-model:selection="selectedMediaItems"
        selectionMode="multiple"
        :metaKeySelection="metaKey"
        dataKey="id"
        @mousedown="onTableMouseDown"
      >
        <Column field="id" header="ID" />
        <Column field="name" header="Name" />
        <Column field="size" header="Size" />
        <Column field="modified" header="Modified" />
      </DataTable>
    </SplitterPanel>
  </Splitter>
</template>

<style>
:root {
  --p-datatable-row-selected-background: var(--p-slate-200) !important;
}

.p-tree {
  padding: 0;
}

.shift-selecting .p-datatable .p-datatable-tbody > tr {
  user-select: none;
}
</style>

<style scoped></style>
