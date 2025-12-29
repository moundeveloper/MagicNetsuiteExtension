<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import DataTable from "primevue/datatable";
import Column from "primevue/column";
import InputGroup from "primevue/inputgroup";
import InputGroupAddon from "primevue/inputgroupaddon";
import InputText from "primevue/inputtext";
import { FilterMatchMode } from "@primevue/core/api";
import { callApi, closePanel, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import { MultiSelect, Panel, ProgressSpinner } from "primevue";
import { useFormattedRouteName } from "../composables/useFormattedRouteName";

const { formattedRouteName } = useFormattedRouteName();

interface ScriptItem {
  internalid: number;
  name: string;
  scriptid: string;
  owner: string;
  scriptType: string;
  scriptDeployments: any[];
  deploymentsLoading?: boolean;
}

const props = defineProps<{
  vhOffset: number;
}>();

const items = ref<ScriptItem[]>();
const scriptTypes = ref<{ id: string; label: string }[]>([]);
const scriptTypesSelected = ref<{ id: string; label: string }[]>([]);
const loading = ref(false);
const dtRef = ref<HTMLElement | null>(null);
const filters = ref({
  global: { value: null, matchMode: FilterMatchMode.CONTAINS },
  internalid: { value: null, matchMode: FilterMatchMode.EQUALS },
  name: { value: null, matchMode: FilterMatchMode.STARTS_WITH },
  scriptid: { value: null, matchMode: FilterMatchMode.STARTS_WITH },
  owner: { value: null, matchMode: FilterMatchMode.STARTS_WITH },
  scriptfile: { value: null, matchMode: FilterMatchMode.STARTS_WITH },
});

const filteredItems = computed(() => {
  let result = items.value || [];

  if (scriptTypesSelected.value.length) {
    const selectedIds = scriptTypesSelected.value.map((s) => s.id);
    result = result.filter((item) => selectedIds.includes(item.scriptType));
  }

  // Optionally, apply other column filters manually here if needed

  return result;
});

const getScriptUrl = async (scriptId: number) => {
  const response =
    (await callApi(RequestRoutes.SCRIPT_URL, { scriptId })) || {};

  if (!response) return;
  const { message: url } = response as ApiResponse;

  return url;
};

const handleScriptClick = async (
  callback: () => string | Promise<string>,
  e: MouseEvent
) => {
  if (e.button !== 0 && e.button !== 1) return;

  const url = await callback();
  if (!url) return;

  if (e.button === 1) {
    chrome.runtime.sendMessage({ action: "openTab", url });
    return;
  }

  window.open(url, "_blank");
};

const getScriptTypes = async () => {
  const response = (await callApi(RequestRoutes.SCRIPT_TYPES)) || {};

  if (!response) return;
  const { message: scriptTypesFetched } = response as ApiResponse;

  console.log(scriptTypesFetched);

  if (!scriptTypesFetched || !Array.isArray(scriptTypesFetched)) return;

  scriptTypes.value = scriptTypesFetched;
};

const fetchDeployments = async (
  event: { originalEvent: Event; value: boolean },
  script: ScriptItem
) => {
  if (event.value) return;

  script.deploymentsLoading = true;

  const response =
    (await callApi(RequestRoutes.SCRIPT_DEPLOYMENTS, {
      scriptId: script.internalid,
    })) || {};

  script.scriptDeployments = (response as ApiResponse)?.message || [];
  script.deploymentsLoading = false;
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
    scriptfile: script.scriptfile,
    scriptType: script.scripttype,
    scriptDeployments: [],
    deploymentsLoading: false,
  }));

  console.log(items.value);
};

const getScriptDeploymentUrl = async (deployment: string) => {
  const response =
    (await callApi(RequestRoutes.SCRIPT_DEPLOYMENT_URL, {
      deployment,
    })) || {};

  if (!response) return;
  const { message: url } = response as ApiResponse;

  if (!url) return;

  return url;
};

const openSuitelet = async (script: string, deployment: string) => {
  const response =
    (await callApi(RequestRoutes.SUITELET_URL, {
      script,
      deployment,
    })) || {};

  if (!response) return;
  const { message: url } = response as ApiResponse;

  window.open(url, "_blank");
};

onMounted(async () => {
  loading.value = true;
  await getScripts();
  await getScriptTypes();
  loading.value = false;

  nextTick(() => {
    if (dtRef.value) {
      // @ts-ignore: $el exists on PrimeVue component instance
      const tableEl = dtRef.value.$el as HTMLElement;
      tableEl.addEventListener("mousedown", (e: MouseEvent) => {
        if (e.button === 1) e.preventDefault(); // middle click
      });
    }
  });
});
</script>

<template>
  <h1>{{ formattedRouteName }}</h1>

  <DataTable
    ref="dtRef"
    data-ignore
    :style="{ height: `${vhOffset}vh` }"
    v-model:filters="filters"
    :value="filteredItems"
    filterDisplay="row"
    dataKey="internalid"
    :globalFilterFields="[
      'internalid',
      'name',
      'scriptid',
      'owner',
      'scriptfile',
    ]"
    scrollable
    scrollHeight="flex"
    :virtualScrollerOptions="{ itemSize: 44 }"
    class="p-datatable-gridlines table-custom"
    :loading="loading"
  >
    <!-- Global Search using InputGroup -->
    <template #header>
      <div class="flex justify-end gap-4">
        <InputGroup style="max-width: 300px">
          <InputGroupAddon>
            <i class="pi pi-search"></i>
          </InputGroupAddon>
          <InputText
            v-model="filters['global'].value"
            placeholder="Keyword Search"
            autofocus
          />
        </InputGroup>

        <MultiSelect
          v-model="scriptTypesSelected"
          :options="scriptTypes"
          optionLabel="label"
          filter
          placeholder="Select Script Types"
          class="w-full md:w-80"
        />
      </div>
    </template>

    <!-- Columns -->

    <Column field="name" header="Name" sortable>
      <template #filter="{ filterModel, filterCallback }">
        <InputText
          v-model="filterModel.value"
          @input="filterCallback()"
          placeholder="Search by name"
        />
      </template>

      <template #body="{ data }">
        <div class="flex gap-2 flex-col w-[60rem]">
          <div
            class="cursor-pointer p-2 bg-slate-400 color-white rounded-[0.25rem] flex items-center hover:bg-slate-500"
            @mousedown="
              (e) => handleScriptClick(() => getScriptUrl(data.internalid), e)
            "
          >
            🔗 {{ data.name }}
          </div>

          <Panel
            header="Deployments"
            toggleable
            collapsed
            @toggle="(e) => fetchDeployments(e, data)"
          >
            <div v-if="data.deploymentsLoading" class="flex justify-center p-4">
              <ProgressSpinner />
            </div>
            <DataTable
              v-else
              :value="data.scriptDeployments"
              class="nested-table"
              size="small"
            >
              <Column field="id" header="ID" sortable>
                <template #body="{ data: deploymentData }">
                  <div class="flex gap-2">
                    <div
                      class="cursor-pointer p-2 bg-slate-400 color-white rounded-[0.25rem] flex items-center hover:bg-slate-500 flex-1"
                      @mousedown="
                        (e) =>
                          handleScriptClick(
                            () =>
                              getScriptDeploymentUrl(deploymentData.primarykey),
                            e
                          )
                      "
                    >
                      🔗 {{ deploymentData.scriptid }}
                    </div>
                    <div
                      v-if="data.scriptType === 'SCRIPTLET'"
                      class="cursor-pointer p-2 bg-[#C3BEF7] color-white rounded-[0.25rem] flex items-center hover:bg-[#ADA7F2]"
                      @click="
                        openSuitelet(data.scriptid, deploymentData.scriptid)
                      "
                    >
                      🔗 Open Suitelet
                    </div>
                  </div>
                </template>
              </Column>

              <Column
                field="appliesTo"
                header="Applies To"
                sortable
                v-if="['USEREVENT', 'CLIENT'].includes(data.scriptType)"
              >
                <template #body="{ data: deploymentData }">
                  {{ deploymentData.recordtype }}
                </template>
              </Column>

              <Column field="isDeployed" header="Deployed?" sortable>
                <template #body="{ data: deploymentData }">
                  <span
                    v-if="deploymentData.isdeployed"
                    class="text-green-600 font-semibold"
                    >✅</span
                  >
                  <span v-else class="text-red-600 font-semibold">❌</span>
                </template>
              </Column>

              <Column field="status" header="Status" sortable>
                <template #body="{ data: deploymentData }">
                  {{ deploymentData.status }}
                </template>
              </Column>

              <Column field="logLevel" header="Log Level" sortable>
                <template #body="{ data: deploymentData }">
                  {{ deploymentData.loglevel }}
                </template>
              </Column>
            </DataTable>
          </Panel>
        </div>
      </template>
    </Column>

    <Column field="scriptfile" header="scriptfile" sortable>
      <template #filter="{ filterModel, filterCallback }">
        <InputText
          v-model="filterModel.value"
          @input="filterCallback()"
          placeholder="Search by Script File"
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

    <Column field="scriptid" header="Script ID" sortable>
      <template #filter="{ filterModel, filterCallback }">
        <InputText
          v-model="filterModel.value"
          @input="filterCallback()"
          placeholder="Search by Script ID"
        />
      </template>
    </Column>

    <Column field="scriptType" header="Script Type" sortable> </Column>

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
