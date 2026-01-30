<!-- Usage in Playground -->
<template>
  <div>Playground</div>

  <MTabs
    :tabs="tabHeaders"
    @delete-tab="handleDeleteTab"
    @add-tab="handleAddTab"
  >
    <template
      v-for="codeEditor in codeEditors"
      :key="codeEditor.id"
      #[codeEditor.id]="{ contentHeight }"
    >
      <!-- Table -->
      <MTable
        :rows="users"
        :height="`${contentHeight}px`"
        searchable
        search-placeholder="Search users..."
        expandable
      >
        <MTableColumn label="Name" field="name" :searchable="true">
          <template #default="{ value }">
            <strong>{{ value }}</strong>
          </template>
        </MTableColumn>

        <MTableColumn
          label="Email"
          field="email"
          :searchable="true"
          :context-menu="emailContextMenu"
        >
          <template #default="{ value }">
            <a :href="`mailto:${value}`">{{ value }}</a>
          </template>
        </MTableColumn>

        <MTableColumn
          label="Actions"
          field="id"
          :searchable="false"
          :context-menu="actionsContextMenu"
        >
          <template #default="{ row }">
            <button @click="edit(row)">Edit</button>
          </template>
        </MTableColumn>

        <template #expand="{ row }">
          <div style="padding: 12px">
            <strong>Details:</strong>
            {{ row }}
          </div>
        </template>
      </MTable>
      <!-- Table -->
    </template>
  </MTabs>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import MTabs from "../components/universal/tabs/MTabs.vue";
import MTable from "../components/universal/table/MTable.vue";
import MTableColumn from "../components/universal/table/MTableColumn.vue";
import { defaultUsers } from "../utils/temp";

const props = defineProps<{
  vhOffset?: number;
}>();

const defaultCodeEditors = [
  {
    id: "controller",
    title: "Controller.js",
    content: "const getTime = () => new Date()"
  },
  {
    id: "model",
    title: "Model.js",
    content: "const setTime = () => new Date()"
  },
  {
    id: "view",
    title: "View.js",
    content: "const addTime = () => new Date()"
  }
];

const codeEditors = ref(defaultCodeEditors);

// User type
interface User {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
}

// Example data
const users: User[] = defaultUsers;

const tabHeaders = computed(() =>
  codeEditors.value.map((editor) => ({
    name: editor.id,
    label: editor.title
  }))
);

const handleDeleteTab = ({ tabId }: { tabId: string }) => {
  console.log("Tab ID: ", tabId);

  codeEditors.value = codeEditors.value.filter((editor) => editor.id !== tabId);
};

const handleAddTab = () => {
  const newId = `tab-${Date.now()}`;
  codeEditors.value = [
    ...codeEditors.value,
    { id: newId, title: "New Tab", content: "New Tab Content" }
  ];
};

const edit = (user: User) => {
  console.log("Editing user: ", user);
};
const emailContextMenu = [
  {
    label: "Copy Email",
    icon: "pi pi-copy",
    action: (row: User) => {
      navigator.clipboard.writeText(row.email);
      console.log("Copied:", row.email);
    }
  },
  {
    label: "Send Email",
    icon: "pi pi-envelope",
    action: (row: User) => {
      window.location.href = `mailto:${row.email}`;
    }
  },
  {
    label: "Delete",
    icon: "pi pi-trash",
    action: (row: User) => {
      console.log("Delete user:", row);
    }
  }
];

// Table

const actionsContextMenu = [
  {
    label: "View Details",
    icon: "pi pi-eye",
    action: (row: User) => {
      console.log("View details:", row);
    }
  },
  {
    label: "Edit",
    icon: "pi pi-pencil",
    action: (row: User) => {
      console.log("Edit user:", row);
    }
  },
  {
    label: "Archive",
    icon: "pi pi-archive",
    action: (row: User) => {
      console.log("Archive:", row);
    }
  }
];
</script>
