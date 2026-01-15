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
import { DatePicker, Panel, ProgressSpinner, Select, Tag } from "primevue";
import { useFormattedRouteName } from "../composables/useFormattedRouteName";

const { formattedRouteName } = useFormattedRouteName();

type LogItem = {
  datetime: string;
  title: string;
  level: string;
  message: string;
  scriptId: string;
  deploymentId: string;
  scriptType: string;
  scriptName: string;
  deploymentName: string;
};

const props = defineProps<{ vhOffset: number }>();

const items = ref<LogItem[]>([]);
const loading = ref(false);
const dtRef = ref<any>(null);

/* =======================
   LOOKUP DATA
======================= */

const scripts = ref<{ id: string; label: string }[]>([]);
const scriptDeployments = ref<{ id: string; label: string }[]>([]);
const scriptTypesQuery = ref<{ id: string; label: string }[]>([]);
const scriptTypesQuick = ref<{ id: string; label: string }[]>([]);

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
    result = result.filter((log) =>
      filtersState.quick.scriptTypes.includes(log.scriptType)
    );
  }

  if (filtersState.quick.startDate || filtersState.quick.endDate) {
    const start = filtersState.quick.startDate
      ? filtersState.quick.startDate.getTime()
      : -Infinity;

    const end = filtersState.quick.endDate
      ? (() => {
          const d = new Date(filtersState.quick.endDate);
          d.setSeconds(59, 999); // include full minute
          return d.getTime();
        })()
      : Infinity;

    result = result.filter((l) => {
      const logTime = Date.parse(l.datetime);
      return logTime >= start && logTime <= end;
    });
  }

  return result;
});

const formatToLocalDate = (value: string | Date) => {
  const d = value instanceof Date ? value : new Date(value);

  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

/* =======================
   API CALLS
======================= */

const getScriptTypes = async () => {
  const response = (await callApi(RequestRoutes.SCRIPT_TYPES)) || {};
  const { message } = response as ApiResponse;
  if (Array.isArray(message)) scriptTypesQuery.value = message;

  if (Array.isArray(message))
    scriptTypesQuick.value = message.map(({ label }) => {
      return {
        id: label,
        label: label,
      };
    });
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
  scriptDeployments.value = results.map(
    ({ primarykey, scriptid, scriptname }) => {
      return {
        id: primarykey,
        label: `${scriptid.toUpperCase()} (${scriptname})`,
      };
    }
  );
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
        title: log.title,
        level: log.type,
        message: log.detail,
        scriptId: log["script.scriptid"],
        deploymentId: log["scriptDeployment.internalid"],
        scriptType: log.scripttype,
        scriptName: log["script.name"],
        deploymentName: log["scriptDeployment.scriptid"],
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
        <label class="font-bold block mb-2">Start Datetime</label>
        <DatePicker
          v-model="filtersState.query.startDate"
          showTime
          hourFormat="24"
          fluid
        />
      </div>

      <div>
        <label class="font-bold block mb-2">End Datetime</label>
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
          :options="scriptTypesQuery"
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
    :globalFilterFields="[
      'message',
      'scriptName',
      'deploymentName',
      'level',
      'scriptType',
      'title',
    ]"
    scrollable
    scrollHeight="flex"
    :virtualScrollerOptions="{ itemSize: 44 }"
    class="p-datatable-gridlines table-custom"
    :loading="loading"
  >
    <!-- ===================== QUICK FILTERS ===================== -->

    <template #header>
      <div class="flex flex-col gap-2">
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
              <label class="font-bold block mb-2">Start Datetime</label>
              <DatePicker
                v-model="filtersState.quick.startDate"
                showTime
                hourFormat="24"
                fluid
              />
            </div>

            <div>
              <label class="font-bold block mb-2">End Datetime</label>
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
                :options="scriptTypesQuick"
                optionLabel="label"
                optionValue="id"
                filter
                class="w-full"
              />
            </div>
          </div>
        </Panel>

        <Tag
          severity="info"
          :value="`${filteredItems.length}`"
          class="w-fit"
        ></Tag>
      </div>
    </template>

    <Column field="datetime" header="Date / Time" sortable>
      <template #body="{ data }">
        {{ formatToLocalDate(data.datetime) }}
      </template>
    </Column>

    <Column field="title" header="Title" sortable />
    <Column field="level" header="Level" sortable />
    <Column field="scriptType" header="Script Type" sortable />
    <Column field="scriptName" header="Script" sortable />
    <Column field="deploymentName" header="Deployment" sortable />
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
