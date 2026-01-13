<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import InputGroup from "primevue/inputgroup";
import InputGroupAddon from "primevue/inputgroupaddon";
import InputText from "primevue/inputtext";
import MultiSelect from "primevue/multiselect";
import { FilterMatchMode } from "@primevue/core/api";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { DatePicker, Panel, ProgressSpinner, Select } from "primevue";
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

/* =======================
   LOOKUP DATA
======================= */

const scripts = ref<{ id: string; label: string }[]>([]);
const scriptDeployments = ref<{ id: string; label: string }[]>([]);
const scriptTypes = ref<{ id: string; label: string }[]>([]);

/* =======================
   FILTER STATE (SINGLE SOURCE)
======================= */

const filtersState = reactive({
  query: {
    startDate: null as Date | null,
    endDate: null as Date | null,
    scriptIds: [] as string[],
    deploymentIds: [] as string[],
    scriptTypes: [] as string[],
  },
  quick: {
    global: null as string | null,
    startDate: null as Date | null,
    endDate: null as Date | null,
    scriptTypes: [] as string[],
  },
});

/* =======================
   DATATABLE FILTERS
======================= */

const tableFilters = computed(() => ({
  global: {
    value: filtersState.quick.global,
    matchMode: FilterMatchMode.CONTAINS,
  },
}));

/* =======================
   CLIENT-SIDE FILTERING
======================= */

const filteredItems = computed(() => {
  let result = [...items.value];

  if (filtersState.quick.scriptTypes.length) {
    result = result.filter((l) =>
      filtersState.quick.scriptTypes.includes(l.scriptType)
    );
  }

  if (filtersState.quick.startDate && filtersState.quick.endDate) {
    result = result.filter((l) => {
      const d = new Date(l.datetime);
      return (
        d >= filtersState.quick.startDate! && d <= filtersState.quick.endDate!
      );
    });
  }

  return result;
});

/* =======================
   API CALLS
======================= */

const getScriptTypes = async () => {
  const response = (await callApi(RequestRoutes.SCRIPT_TYPES)) || {};
  const { message } = response as ApiResponse;
  if (Array.isArray(message)) scriptTypes.value = message;
};

const getScripts = async () => {
  const response = (await callApi(RequestRoutes.SCRIPTS)) || {};
  const { message: results } = response as ApiResponse;
  if (!Array.isArray(results)) return;
  scripts.value = results.map(({ id, name }) => {
    return {
      id: id,
      label: name,
    };
  });
};

const getDeployments = async () => {
  console.log("deployment filters", filtersState.query.scriptIds);
  const response =
    (await callApi(RequestRoutes.SCRIPT_DEPLOYMENTS, {
      scriptIds: filtersState.query.scriptIds,
    })) || {};
  const { message: results } = response as ApiResponse;
  if (!Array.isArray(results)) return;
  scriptDeployments.value = results.map(({ primarykey, scriptid }) => {
    return {
      id: primarykey,
      label: scriptid,
    };
  });
};

const getLogs = async () => {
  loading.value = true;

  const response =
    (await callApi(RequestRoutes.LOGS, {
      startDate: filtersState.query.startDate,
      endDate: filtersState.query.endDate,
      scriptIds: filtersState.query.scriptIds,
      deploymentIds: filtersState.query.deploymentIds,
      scriptTypes: filtersState.query.scriptTypes,
    })) || {};

  const { message } = response as ApiResponse;

  items.value = Array.isArray(message)
    ? message.map((log: any) => ({
        datetime: log.datetime,
        level: log.type,
        message: log.detail,
        scriptId: log.scriptid,
        deploymentId: log.deploymentid,
        scriptType: log.scripttype,
      }))
    : [];

  loading.value = false;
};

/* =======================
   REACTIVE QUERY WATCH
======================= */

watch(
  () => filtersState.query,
  () => getLogs(),
  { deep: true }
);

watch(
  () => filtersState.query.scriptIds,
  () => getDeployments(),

  { deep: true }
);

/* =======================
   LIFECYCLE
======================= */

onMounted(async () => {
  await getScriptTypes();
  await getScripts();
  await getDeployments();
  await getLogs();

  nextTick(() => {
    if (dtRef.value) {
      const el = dtRef.value.$el as HTMLElement;
      el.addEventListener("mousedown", (e: MouseEvent) => {
        if (e.button === 1) e.preventDefault();
      });
    }
  });
});
</script>

<template>
  <h1>{{ formattedRouteName }}</h1>

  <!-- ===================== QUERY FILTERS ===================== -->

  <Panel header="Query Filters" toggleable>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div>
        <label class="font-bold block mb-2">Start Date</label>
        <DatePicker
          v-model="filtersState.query.startDate"
          showTime
          hourFormat="24"
          fluid
        />
      </div>

      <div>
        <label class="font-bold block mb-2">End Date</label>
        <DatePicker
          v-model="filtersState.query.endDate"
          showTime
          hourFormat="24"
          fluid
        />
      </div>

      <div>
        <label class="font-bold block mb-2">Script Types</label>
        <MultiSelect
          v-model="filtersState.query.scriptTypes"
          :options="scriptTypes"
          optionLabel="label"
          optionValue="id"
          filter
          class="w-full"
          placeholder="Script Types"
        />
      </div>

      <div>
        <label class="font-bold block mb-2">Script</label>
        <MultiSelect
          v-model="filtersState.query.scriptIds"
          :options="scripts"
          optionLabel="label"
          optionValue="id"
          filter
          class="w-full"
          placeholder="Select Scripts"
        />
      </div>

      <div>
        <label class="font-bold block mb-2">Deployment</label>
        <MultiSelect
          v-model="filtersState.query.deploymentIds"
          :options="scriptDeployments"
          optionLabel="label"
          optionValue="id"
          filter
          class="w-full"
          placeholder="Select Deployments"
        />
      </div>
    </div>
  </Panel>

  <!-- ===================== DATATABLE ===================== -->

  <DataTable
    ref="dtRef"
    :style="{ height: `${vhOffset}vh` }"
    v-model:filters="tableFilters"
    :value="filteredItems"
    dataKey="datetime"
    :globalFilterFields="['message', 'scriptId', 'deploymentId', 'level']"
    scrollable
    scrollHeight="flex"
    :virtualScrollerOptions="{ itemSize: 44 }"
    class="p-datatable-gridlines table-custom"
    :loading="loading"
  >
    <!-- ===================== QUICK FILTERS ===================== -->

    <template #header>
      <Panel header="Quick Filters (Current Results)" toggleable>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="font-bold block mb-2">Global Search</label>
            <InputGroup>
              <InputGroupAddon>
                <i class="pi pi-search" />
              </InputGroupAddon>
              <InputText v-model="filtersState.quick.global" />
            </InputGroup>
          </div>

          <div>
            <label class="font-bold block mb-2">Start Date</label>
            <DatePicker
              v-model="filtersState.quick.startDate"
              showTime
              hourFormat="24"
              fluid
            />
          </div>

          <div>
            <label class="font-bold block mb-2">End Date</label>
            <DatePicker
              v-model="filtersState.quick.endDate"
              showTime
              hourFormat="24"
              fluid
            />
          </div>

          <div>
            <label class="font-bold block mb-2">Script Types</label>
            <MultiSelect
              v-model="filtersState.quick.scriptTypes"
              :options="scriptTypes"
              optionLabel="label"
              optionValue="id"
              filter
              class="w-full"
            />
          </div>
        </div>
      </Panel>
    </template>

    <Column field="datetime" header="Date / Time" sortable />
    <Column field="level" header="Level" sortable />
    <Column field="scriptType" header="Script Type" sortable />
    <Column field="scriptId" header="Script" sortable />
    <Column field="deploymentId" header="Deployment" sortable />
    <Column field="message" header="Message" />

    <template #loading>
      <div class="flex justify-center">
        <ProgressSpinner />
      </div>
    </template>

    <template #empty>No logs found.</template>
  </DataTable>
</template>

<style scoped>
.table-custom {
  flex: 1;
}
</style>
