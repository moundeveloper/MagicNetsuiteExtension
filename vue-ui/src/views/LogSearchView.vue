<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import InputGroup from "primevue/inputgroup";
import InputGroupAddon from "primevue/inputgroupaddon";
import InputText from "primevue/inputtext";
import MultiSelect from "primevue/multiselect";
import { FilterMatchMode } from "@primevue/core/api";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { DatePicker, ProgressSpinner } from "primevue";
import { useFormattedRouteName } from "../composables/useFormattedRouteName";

const { formattedRouteName } = useFormattedRouteName();

interface LogItem {
  datetime: string;
  level: string;
  message: string;
  scriptId: string;
  deploymentId: string;
  scriptType: string;
}

const props = defineProps<{ vhOffset: number }>();

const items = ref<LogItem[]>([]);
const loading = ref(false);
const dtRef = ref<any>(null);

// filters
const filters = ref({
  global: { value: null, matchMode: FilterMatchMode.CONTAINS },
});

// header filters
const startDate = ref<Date | null>(null);
const endDate = ref<Date | null>(null);

/* Deprecated */
const dateRange = ref<[Date | null, Date | null] | null>(null);
/* Deprecated */
const scriptTypes = ref<{ id: string; label: string }[]>([]);
const scriptTypesSelected = ref<{ id: string; label: string }[]>([]);

const filteredItems = computed(() => {
  let result = items.value;

  if (scriptTypesSelected.value.length) {
    const ids = scriptTypesSelected.value.map((s) => s.id);
    result = result.filter((l) => ids.includes(l.scriptType));
  }

  /*   if (dateRange.value?.[0] && dateRange.value?.[1]) {
    const [start, end] = dateRange.value;
    result = result.filter((l) => {
      const d = new Date(l.date);
      return d >= start! && d <= end!;
    });
  } */

  return result;
});

const getScriptTypes = async () => {
  const response = (await callApi(RequestRoutes.SCRIPT_TYPES)) || {};
  const { message } = response as ApiResponse;
  if (Array.isArray(message)) scriptTypes.value = message;
};

const getLogs = async () => {
  loading.value = true;

  const response =
    (await callApi(RequestRoutes.LOGS, {
      startDate: dateRange.value?.[0],
      endDate: dateRange.value?.[1],
      scriptTypes: scriptTypesSelected.value.map((s) => s.id),
    })) || {};

  const { message } = response as ApiResponse;

  if (Array.isArray(message)) {
    items.value = message.map((log: any) => {
      return {
        datetime: "",
        level: log.type,
        message: log.detail,
        scriptId: "2",
        deploymentId: "1",
        scriptType: log.scripttype,
      };
    });
  }

  loading.value = false;
};

watch([dateRange, scriptTypesSelected], () => {
  getLogs();
});

onMounted(async () => {
  await getScriptTypes();
  await getLogs();

  nextTick(() => {
    if (dtRef.value) {
      const tableEl = dtRef.value.$el as HTMLElement;
      tableEl.addEventListener("mousedown", (e: MouseEvent) => {
        if (e.button === 1) e.preventDefault();
      });
    }
  });
});
</script>

<template>
  <h1>{{ formattedRouteName }}</h1>

  <DataTable
    ref="dtRef"
    :style="{ height: `${vhOffset}vh` }"
    v-model:filters="filters"
    :value="filteredItems"
    dataKey="id"
    :globalFilterFields="['message', 'scriptId', 'deploymentId', 'level']"
    scrollable
    scrollHeight="flex"
    :virtualScrollerOptions="{ itemSize: 44 }"
    class="p-datatable-gridlines table-custom"
    :loading="loading"
  >
    <template #header>
      <div class="flex flex-wrap justify-end items-start gap-4">
        <div class="flex-auto">
          <label for="datepicker-24h" class="font-bold block mb-2"
            >Global Search
          </label>
          <InputGroup>
            <InputGroupAddon>
              <i class="pi pi-search" />
            </InputGroupAddon>
            <InputText
              v-model="filters.global.value"
              placeholder="Search logs"
            />
          </InputGroup>
        </div>

        <div class="flex-auto">
          <label for="datepicker-24h" class="font-bold block mb-2"
            >Start Date
          </label>
          <DatePicker
            id="datepicker-24h"
            v-model="startDate"
            showTime
            hourFormat="24"
            fluid
          />
        </div>

        <div class="flex-auto">
          <label for="datepicker-24h" class="font-bold block mb-2"
            >End Date
          </label>
          <DatePicker
            id="datepicker-24h"
            v-model="endDate"
            showTime
            hourFormat="24"
            fluid
          />
        </div>
        <div class="flex-auto">
          <label for="datepicker-24h" class="font-bold block mb-2"
            >Script Types
          </label>

          <MultiSelect
            v-model="scriptTypesSelected"
            :options="scriptTypes"
            optionLabel="label"
            filter
            placeholder="Script Types"
            class="w-full md:w-64"
          />
        </div>
      </div>
    </template>

    <Column field="datetime" header="Date / Time" sortable> </Column>

    <Column field="level" header="Level" sortable />

    <Column field="scriptType" header="Script Type" sortable />

    <Column field="scriptId" header="Script" sortable />

    <Column field="deploymentId" header="Deployment" sortable />

    <Column field="message" header="Message" />

    <template #loading>
      <div class="flex justify-center"><ProgressSpinner /></div>
    </template>

    <template #empty>No logs found.</template>
  </DataTable>
</template>

<style scoped>
.table-custom {
  flex: 1;
}
pre {
  margin: 0;
  font-family: inherit;
}
</style>
