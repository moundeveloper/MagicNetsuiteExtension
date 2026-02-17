<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import MCard from "../components/universal/card/MCard.vue";
import MTable from "../components/universal/table/MTable.vue";
import MTableColumn from "../components/universal/table/MTableColumn.vue";
import MPanel from "../components/universal/panels/MPanel.vue";
import MLoader from "../components/universal/patterns/MLoader.vue";
import { MultiSelect } from "primevue";
import { useFormattedRouteName } from "../composables/useFormattedRouteName";

const { formattedRouteName } = useFormattedRouteName();

interface ScriptItem {
  id: number;
  internalid: number;
  name: string;
  scriptid: string;
  owner: string;
  scriptType: string;
  scriptfile: string;
  scriptDeployments: any[];
  deploymentsLoading?: boolean;
}

const props = defineProps<{
  vhOffset: number;
}>();

const items = ref<ScriptItem[]>([]);
const scriptTypes = ref<{ id: string; label: string }[]>([]);
const scriptTypesSelected = ref<{ id: string; label: string }[]>([]);
const loading = ref(false);

const filteredItems = computed(() => {
  let result = items.value || [];

  if (scriptTypesSelected.value.length) {
    const selectedIds = scriptTypesSelected.value.map((s) => s.id);
    result = result.filter((item) => selectedIds.includes(item.scriptType));
  }

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
    chrome.runtime.sendMessage({ type: "OPEN_NON_ACTIVE_TAB", url });
    return;
  }

  window.open(url, "_blank");
};

const getScriptTypes = async () => {
  const response = (await callApi(RequestRoutes.SCRIPT_TYPES)) || {};

  if (!response) return;
  const { message: scriptTypesFetched } = response as ApiResponse;

  if (!scriptTypesFetched || !Array.isArray(scriptTypesFetched)) return;

  scriptTypes.value = scriptTypesFetched;
};

const fetchDeployments = async (script: ScriptItem) => {
  if (script.scriptDeployments.length > 0) return;

  script.deploymentsLoading = true;

  const response =
    (await callApi(RequestRoutes.SCRIPT_DEPLOYMENTS, {
      scriptId: script.internalid
    })) || {};

  script.scriptDeployments = (response as ApiResponse)?.message || [];
  await nextTick();
  script.deploymentsLoading = false;
};

const getScripts = async () => {
  const response = (await callApi(RequestRoutes.SCRIPTS)) || {};

  if (!response) return;
  const { message: scripts } = response as ApiResponse;

  if (!scripts || !Array.isArray(scripts)) return;

  items.value = scripts.map((script: any) => ({
    id: script.id,
    internalid: script.id,
    name: script.name,
    scriptid: script.scriptid,
    owner: script.owner,
    scriptfile: script.scriptfile,
    scriptType: script.scripttype,
    scriptDeployments: [],
    deploymentsLoading: false
  }));
};

const getScriptDeploymentUrl = async (deployment: string) => {
  const response =
    (await callApi(RequestRoutes.SCRIPT_DEPLOYMENT_URL, {
      deployment
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
      deployment
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
});
</script>

<template>
  <h1>{{ formattedRouteName }}</h1>

  <MCard
    flex
    direction="column"
    autoHeight
    outlined
    elevated
    :style="{ height: `${props.vhOffset}vh` }"
  >
    <template #default="{ contentHeight }">
      <MTable
        :rows="filteredItems"
        :height="`${contentHeight}px`"
        :loading="loading"
        :expandable="true"
        :autoRowHeight="true"
        searchable
        search-placeholder="Search scripts..."
      >
        <template #toolbar>
          <MultiSelect
            v-model="scriptTypesSelected"
            :options="scriptTypes"
            optionLabel="label"
            filter
            placeholder="Select Script Types"
            class="w-full md:w-80"
          />
        </template>

        <template #expand="{ row }">
          <MPanel
            header="Deployments"
            :outline="!row.deploymentsLoading"
            :boxShadow="!row.deploymentsLoading"
            @vue:mounted="fetchDeployments(row)"
          >
            <div v-if="row.deploymentsLoading" class="flex justify-center p-4">
              <MLoader />
            </div>
            <MTable
              v-else
              :rows="row.scriptDeployments"
              :height="'200px'"
              :rowHeight="36"
              :autoRowHeight="true"
            >
              <MTableColumn label="ID" field="scriptid" width="1fr">
                <template #default="{ value, row: deploymentData }">
                  <div
                    class="flex gap-2 cursor-pointer hover:underline"
                    @mousedown="
                      (e) =>
                        handleScriptClick(
                          () =>
                            getScriptDeploymentUrl(deploymentData.primarykey),
                          e
                        )
                    "
                  >
                    <i class="pi pi-link text-[var(--p-slate-600)]"></i>
                    <span class="text-[var(--p-slate-600)]">{{ value }}</span>
                  </div>
                </template>
              </MTableColumn>

              <MTableColumn
                v-if="['USEREVENT', 'CLIENT'].includes(row.scriptType)"
                label="Applies To"
                field="recordtype"
                width="1fr"
              />

              <MTableColumn label="Deployed?" field="isdeployed" width="100px">
                <template #default="{ value }">
                  <span v-if="value" class="text-green-600 font-semibold"
                    >✅</span
                  >
                  <span v-else class="text-red-600 font-semibold">❌</span>
                </template>
              </MTableColumn>

              <MTableColumn label="Status" field="status" width="120px" />

              <MTableColumn label="Log Level" field="loglevel" width="120px" />

              <MTableColumn
                v-if="row.scriptType === 'SCRIPTLET'"
                label="Action"
                field="scriptid"
                width="150px"
              >
                <template #default="{ row: deploymentData }">
                  <div
                    class="flex gap-2 cursor-pointer hover:underline text-[var(--p-purple-600)]"
                    @click="openSuitelet(row.scriptid, deploymentData.scriptid)"
                  >
                    <i
                      class="pi pi-external-link text-[var(--p-purple-600)]"
                    ></i>
                    <span class="text-[var(--p-purple-600)]"
                      >Open Suitelet</span
                    >
                  </div>
                </template>
              </MTableColumn>
            </MTable>
          </MPanel>
        </template>

        <MTableColumn label="Name" field="name" width="1fr" searchable>
          <template #default="{ value, row }">
            <div
              class="flex gap-2 cursor-pointer hover:underline"
              @mousedown="
                (e) => handleScriptClick(() => getScriptUrl(row.internalid), e)
              "
            >
              <i class="pi pi-link text-[var(--p-slate-600)]"></i>
              <span class="text-[var(--p-slate-600)]">
                {{ value }}
              </span>
            </div>
          </template>
        </MTableColumn>

        <MTableColumn
          label="Script File"
          field="scriptfile"
          width="1fr"
          searchable
        />

        <MTableColumn label="Owner" field="owner" width="1fr" searchable />

        <MTableColumn
          label="Script ID"
          field="scriptid"
          width="1fr"
          searchable
        />

        <MTableColumn
          label="Script Type"
          field="scriptType"
          width="150px"
          searchable
        />

        <template #empty>
          <div class="flex flex-col items-center justify-center p-8 gap-4">
            <i class="pi pi-inbox text-4xl text-[var(--p-slate-400)]"></i>
            <p class="text-[var(--p-slate-500)]">No records found.</p>
          </div>
        </template>
      </MTable>
    </template>
  </MCard>
</template>

<style scoped>
h1 {
  font-weight: 600;
  color: var(--text-color);
}
</style>
