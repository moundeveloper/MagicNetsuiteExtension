<script setup lang="ts">
import { onMounted, ref } from "vue";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import InputGroup from "primevue/inputgroup";
import InputGroupAddon from "primevue/inputgroupaddon";
import InputText from "primevue/inputtext";
import { FilterMatchMode } from "@primevue/core/api";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { ProgressSpinner } from "primevue";

interface ScriptItem {
  internalid: number;
  name: string;
  scriptid: string;
  owner: string;
}

const props = defineProps<{
  vhOffset: number;
}>();

const items = ref<ScriptItem[]>();

const loading = ref(false);

const filters = ref({
  global: { value: null, matchMode: FilterMatchMode.CONTAINS },
  internalid: { value: null, matchMode: FilterMatchMode.EQUALS },
  name: { value: null, matchMode: FilterMatchMode.STARTS_WITH },
  scriptid: { value: null, matchMode: FilterMatchMode.STARTS_WITH },
  owner: { value: null, matchMode: FilterMatchMode.STARTS_WITH },
});

// Row click handler
const onRowClick = (event: any) => {
  const script: ScriptItem = event.data;
  console.log("Row clicked:", script);

  getScriptUrl(script.internalid);
};

const getScriptUrl = async (scriptId: number) => {
  const response =
    (await callApi(RequestRoutes.SCRIPT_URL, { scriptId })) || {};

  if (!response) return;
  const { message: url } = response as ApiResponse;

  window.open(url, "_blank");
};

const getScripts = async () => {
  const response = (await callApi(RequestRoutes.SCRIPTS)) || {};

  if (!response) return;
  const { message: scripts } = response as ApiResponse;

  if (!scripts || !Array.isArray(scripts)) return;

  items.value = scripts.map((script: any) => ({
    internalid: script.id,
    name: script.name,
    scriptid: script.scriptid,
    owner: script.owner,
  }));

  console.log(items.value);
};

onMounted(async () => {
  loading.value = true;
  await getScripts();
  loading.value = false;
});
</script>

<template>
  <h1>::SCRIPTS</h1>

  <DataTable
    data-ignore
    :style="{ height: `${vhOffset}vh` }"
    v-model:filters="filters"
    :value="items"
    filterDisplay="row"
    dataKey="internalid"
    :globalFilterFields="['internalid', 'name', 'scriptid', 'owner']"
    scrollable
    scrollHeight="flex"
    :virtualScrollerOptions="{ itemSize: 44 }"
    class="p-datatable-gridlines table-custom"
    :loading="loading"
    @row-click="onRowClick"
  >
    <!-- Global Search using InputGroup -->
    <template #header>
      <div class="flex justify-end">
        <InputGroup style="max-width: 300px">
          <InputGroupAddon>
            <i class="pi pi-search"></i>
          </InputGroupAddon>
          <InputText
            v-model="filters['global'].value"
            placeholder="Keyword Search"
          />
        </InputGroup>
      </div>
    </template>

    <!-- Columns -->
    <Column field="internalid" header="Internal ID" sortable>
      <template #filter="{ filterModel, filterCallback }">
        <InputText
          v-model="filterModel.value"
          type="number"
          @input="filterCallback()"
          placeholder="Search by ID"
        />
      </template>
    </Column>

    <Column field="name" header="Name" sortable>
      <template #filter="{ filterModel, filterCallback }">
        <InputText
          v-model="filterModel.value"
          @input="filterCallback()"
          placeholder="Search by name"
        />
      </template>
    </Column>

    <Column field="scriptid" header="Script ID" sortable>
      <template #filter="{ filterModel, filterCallback }">
        <InputText
          v-model="filterModel.value"
          @input="filterCallback()"
          placeholder="Search by Script ID"
        />
      </template>
    </Column>

    <Column field="owner" header="Owner" sortable>
      <template #filter="{ filterModel, filterCallback }">
        <InputText
          v-model="filterModel.value"
          @input="filterCallback()"
          placeholder="Search by Owner"
        />
      </template>
    </Column>
    <template #loading>
      <div class="flex justify-center">
        <ProgressSpinner />
      </div>
    </template>

    <template #empty>No records found.</template>
  </DataTable>
</template>

<style scoped>
h1 {
  font-weight: 600;
  color: var(--text-color);
}

.table-custom {
  flex: 1;
}
</style>
