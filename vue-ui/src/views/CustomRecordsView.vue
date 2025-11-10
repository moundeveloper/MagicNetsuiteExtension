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

interface RecordItem {
  internalid: number;
  name: string;
  scriptid: string;
  description: string;
  owner: string;
}

const records = ref<RecordItem[]>();
const loading = ref(false);
const filters = ref({
  global: { value: null, matchMode: FilterMatchMode.CONTAINS },
  internalid: { value: null, matchMode: FilterMatchMode.EQUALS },
  name: { value: null, matchMode: FilterMatchMode.STARTS_WITH },
  scriptid: { value: null, matchMode: FilterMatchMode.STARTS_WITH },
  description: { value: null, matchMode: FilterMatchMode.CONTAINS },
  owner: { value: null, matchMode: FilterMatchMode.STARTS_WITH },
});

// Row click handler
const onRowClick = (event: any) => {
  const record: RecordItem = event.data;
  console.log("Row clicked:", record);
  getCustomRecordUrl(record.internalid);
};

const getCustomRecords = async () => {
  const response = await callApi(RequestRoutes.CUSTOM_RECORDS);
  if (!response) return;
  const { message: customRecords } = response as ApiResponse;

  if (!customRecords || !Array.isArray(customRecords)) return;

  records.value = customRecords.map((record: any) => ({
    internalid: record.internalid,
    name: record.name,
    scriptid: record.scriptid,
    description: record.description,
    owner: record.owner,
  }));
};

const getCustomRecordUrl = async (recordId: number) => {
  const response = await callApi(RequestRoutes.CUSTOM_RECORD_URL, {
    recordId,
  });
  if (!response) return;
  const { message: url } = response as ApiResponse;

  window.open(url, "_blank");
};

onMounted(async () => {
  loading.value = true;
  await getCustomRecords();
  loading.value = false;
});
</script>

<template>
  <div class="wraper">
    <h1>::CUSTOM-RECORDS</h1>
    <DataTable
      v-model:filters="filters"
      :value="records"
      filterDisplay="row"
      dataKey="internalid"
      :loading="loading"
      :globalFilterFields="[
        'internalid',
        'name',
        'scriptid',
        'description',
        'owner',
      ]"
      scrollable
      scrollHeight="flex"
      :virtualScrollerOptions="{ itemSize: 44 }"
      class="p-datatable-gridlines table-custom"
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

      <Column field="description" header="Description" sortable>
        <template #filter="{ filterModel, filterCallback }">
          <InputText
            v-model="filterModel.value"
            @input="filterCallback()"
            placeholder="Search by Description"
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
  </div>
</template>

<style scoped>
.wraper {
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

h1 {
  margin-bottom: 1.5rem;
  font-weight: 600;
  color: var(--text-color);
}

.table-custom {
  flex: 1;
}
</style>
