<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch
} from "vue";
import InputGroup from "primevue/inputgroup";
import InputGroupAddon from "primevue/inputgroupaddon";
import InputText from "primevue/inputtext";
import MultiSelect from "primevue/multiselect";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import MLoader from "../components/universal/patterns/MLoader.vue";
import { Button, DatePicker, Tag } from "primevue";
import MPanel from "../components/universal/panels/MPanel.vue";
import MCard from "../components/universal/card/MCard.vue";
import MTable from "../components/universal/table/MTable.vue";
import MTableColumn from "../components/universal/table/MTableColumn.vue";
import { useFormattedRouteName } from "../composables/useFormattedRouteName";
import { type ContextMenuItem } from "../composables/useMContextMenu";

const { formattedRouteName } = useFormattedRouteName();

type LogItem = {
  id: string;
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

/* =======================
   LOOKUP DATA
  ======================= */

const scripts = ref<{ id: number; label: string }[]>([]);
const scriptDeployments = ref<{ id: number; label: string }[]>([]);
const scriptTypesQuery = ref<{ id: string; label: string }[]>([]);
const scriptTypesQuick = ref<{ id: string; label: string }[]>([]);

/* =======================
   FILTER STATE (SINGLE SOURCE)
  ======================= */

const filtersState = reactive({
  query: {
    startDate: null as Date | null,
    endDate: null as Date | null,
    scriptIds: [] as number[],
    deploymentIds: [] as number[],
    scriptTypes: [] as string[]
  },
  quick: {
    global: null as string | null,
    startDate: null as Date | null,
    endDate: null as Date | null,
    scriptTypes: [] as string[]
  },
  quickOptions: {
    caseSensitive: false,
    wholeWord: false,
    regex: false
  }
});

const deploymentsLoaded = ref(false);

const addToQueryFilters = async (
  row: LogItem,
  context: "script" | "deployment"
) => {
  if (context === "script") {
    console.log("addToQueryFilters called with context: script, row:", row);
    const scriptId = Number(row.scriptId);
    console.log("scriptId extracted:", scriptId, "row.scriptId:", row.scriptId);
    if (!isNaN(scriptId)) {
      const currentIds = [...filtersState.query.scriptIds];
      if (!currentIds.includes(scriptId)) {
        currentIds.push(scriptId);
      }
      filtersState.query.scriptIds = currentIds;
      console.log("scriptIds after update:", filtersState.query.scriptIds);
      getDeployments();
    }
  } else if (context === "deployment" && row.scriptId && row.deploymentId) {
    console.log("addToQueryFilters called with context: deployment, row:", row);
    const scriptId = Number(row.scriptId);
    const deploymentId = Number(row.deploymentId);
    console.log("scriptId:", scriptId, "deploymentId:", deploymentId);

    const currentIds = [...filtersState.query.scriptIds];
    if (!currentIds.includes(scriptId)) {
      currentIds.push(scriptId);
    }
    filtersState.query.scriptIds = currentIds;
    console.log("scriptIds after update:", filtersState.query.scriptIds);
    getDeployments();

    // Wait for the specific deployment to be available in the list
    const waitForDeployment = () => {
      const foundDeployment = scriptDeployments.value.find(
        (deployment) => deployment.id === deploymentId
      );

      if (foundDeployment) {
        if (!filtersState.query.deploymentIds.includes(deploymentId)) {
          filtersState.query.deploymentIds = [
            ...filtersState.query.deploymentIds,
            deploymentId
          ];
        }
        return true;
      }
      return false;
    };

    // Check immediately first (in case deployments are already loaded)
    if (!waitForDeployment()) {
      // If not found, wait for deployments to load
      const checkDeploymentsInterval = setInterval(() => {
        if (waitForDeployment()) {
          clearInterval(checkDeploymentsInterval);
        }
      }, 100);

      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkDeploymentsInterval);
      }, 5000);
    }
  }
};

const scriptContextMenu: ContextMenuItem[] = [
  {
    label: "Add Script to Query Filters",
    icon: "pi pi-filter",
    action: (row: LogItem) => addToQueryFilters(row, "script")
  }
];

const deploymentContextMenu: ContextMenuItem[] = [
  {
    label: "Add Deployment to Query Filters",
    icon: "pi pi-filter",
    action: (row: LogItem) => addToQueryFilters(row, "deployment")
  }
];

/* =======================
   CLIENT-SIDE FILTERING
  ======================= */

const filteredItems = computed(() => {
  let result = [...items.value];
  const query = filtersState.quick.global?.trim();

  // Quick filter global
  if (query) {
    const { caseSensitive, wholeWord, regex } = filtersState.quickOptions;
    const flags = caseSensitive ? "g" : "gi";
    let searchRegex: RegExp;

    try {
      if (regex) {
        searchRegex = new RegExp(query, flags);
      } else if (wholeWord) {
        searchRegex = new RegExp(`\\b${query}\\b`, flags);
      } else {
        searchRegex = new RegExp(
          query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          flags
        ); // escape regex
      }
    } catch (e) {
      searchRegex = /$^/; // never match if invalid regex
    }

    result = result.filter((log) =>
      [
        "message",
        "scriptName",
        "deploymentName",
        "level",
        "scriptType",
        "title"
      ].some((field) => searchRegex.test((log as any)[field]))
    );
  }

  // Script Types quick filter
  if (filtersState.quick.scriptTypes.length) {
    result = result.filter((log) =>
      filtersState.quick.scriptTypes.includes(log.scriptType)
    );
  }

  // Start / End Date quick filter
  if (filtersState.quick.startDate || filtersState.quick.endDate) {
    const start = filtersState.quick.startDate
      ? filtersState.quick.startDate.getTime()
      : -Infinity;

    const end = filtersState.quick.endDate
      ? (() => {
          const d = new Date(filtersState.quick.endDate);
          d.setSeconds(59, 999);
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
    second: "2-digit"
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
        label: label
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
      label: name
    };
  });
};

const getDeployments = async () => {
  console.log(
    "getDeployments called with scriptIds:",
    filtersState.query.scriptIds
  );
  const response =
    (await callApi(RequestRoutes.SCRIPT_DEPLOYMENTS, {
      scriptIds: filtersState.query.scriptIds
    })) || {};
  console.log("getDeployments response:", response);
  const { message: results } = response as ApiResponse;
  if (!Array.isArray(results)) return;
  scriptDeployments.value = results.map(
    ({ primarykey, scriptid, scriptname }) => {
      return {
        id: Number(primarykey),
        label: `${scriptid.toUpperCase()} (${scriptname})`
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
      scriptTypes: filtersState.query.scriptTypes
    })) || {};

  const { message } = response as ApiResponse;

  items.value = Array.isArray(message)
    ? message.map((log: any) => ({
        id: log.internalid,
        datetime: log.datetime,
        title: log.title,
        level: log.type,
        message: log.detail,
        scriptId: log["script.internalid"],
        deploymentId: log["scriptDeployment.internalid"],
        scriptType: log.scripttype,
        scriptName: log["script.name"],
        deploymentName: log["scriptDeployment.scriptid"]
      }))
    : [];

  loading.value = false;
};

/* =======================
   REACTIVE QUERY WATCH
 ======================= */

watch(
  () => filtersState.query.scriptIds,
  () => getDeployments(),

  { deep: true }
);

/* =======================
   LIFECYCLE
 ======================= */

onMounted(async () => {
  loading.value = true;
  await getScriptTypes();
  await getScripts();
  await getDeployments();
  await getLogs();

  const stopMenuRightClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest(".p-contextmenu")) {
      e.preventDefault(); // stop browser menu
      e.stopPropagation(); // stop event from bubbling
    }
  };

  document.addEventListener("contextmenu", stopMenuRightClick, true);

  onBeforeUnmount(() => {
    document.removeEventListener("contextmenu", stopMenuRightClick, true);
  });
});
</script>

<template>
  <h1>{{ formattedRouteName }}</h1>

  <!-- ===================== QUERY FILTERS ===================== -->

  <MPanel outline toggleable box-shadow>
    <template #header>
      <div class="flex justify-between items-center gap-4 h-full flex-1">
        <span>Query Filters</span>
        <Button
          @click="getLogs"
          class="h-full bg-[var(--p-slate-300)] !rounded-sm"
        >
          <i class="pi pi-search text-white"></i>
          Run Search</Button
        >
      </div>
    </template>
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
          :virtualScrollerOptions="{ itemSize: 44 }"
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
          :virtualScrollerOptions="{ itemSize: 44 }"
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
  </MPanel>

  <!-- ===================== QUICK FILTERS ===================== -->

  <MPanel
    outline
    header="Quick Filters (Current Results)"
    toggleable
    box-shadow
  >
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div>
        <label class="font-bold block mb-2">Global Search</label>
        <InputGroup>
          <InputGroupAddon class="flex-1">
            <InputText
              v-model="filtersState.quick.global"
              placeholder="Search..."
              class="w-full"
            />
          </InputGroupAddon>

          <InputGroupAddon>
            <div
              :style="{
                backgroundColor: filtersState.quickOptions.caseSensitive
                  ? 'var(--p-slate-300)'
                  : 'var(--p-slate-100)'
              }"
              @click="
                filtersState.quickOptions.caseSensitive =
                  !filtersState.quickOptions.caseSensitive
              "
              class="w-full h-full text-color-slate-600 flex items-center justify-center cursor-pointer select-none"
              title="Case Sensitive"
            >
              Aa
            </div>
          </InputGroupAddon>

          <InputGroupAddon>
            <div
              :style="{
                backgroundColor: filtersState.quickOptions.wholeWord
                  ? 'var(--p-slate-300)'
                  : 'var(--p-slate-100)'
              }"
              @click="
                filtersState.quickOptions.wholeWord =
                  !filtersState.quickOptions.wholeWord
              "
              class="w-full h-full text-color-slate-600 flex items-center justify-center cursor-pointer select-none"
              title="Whole Word"
            >
              "W"
            </div>
          </InputGroupAddon>

          <InputGroupAddon>
            <div
              :style="{
                backgroundColor: filtersState.quickOptions.regex
                  ? 'var(--p-slate-300)'
                  : 'var(--p-slate-100)'
              }"
              @click="
                filtersState.quickOptions.regex =
                  !filtersState.quickOptions.regex
              "
              class="w-full h-full text-color-slate-600 flex items-center justify-center cursor-pointer select-none"
              title="Regex"
            >
              .*
            </div>
          </InputGroupAddon>
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
  </MPanel>

  <Tag
    severity="info"
    :value="`${filteredItems.length} Limited to 6000 for performance reasons.`"
    class="w-fit"
  ></Tag>

  <!-- ===================== TABLE ===================== -->
  <MCard
    flex
    direction="column"
    autoHeight
    outlined
    elevated
    :style="{ height: `${vhOffset}vh` }"
  >
    <template #default="{ contentHeight }">
      <MTable
        :rows="filteredItems"
        :height="`${contentHeight}px`"
        :loading="loading"
        searchable
        search-placeholder="Search logs..."
        collapsible
        collapsible-key="log-search-view"
        :auto-row-height="true"
      >
        <template #toolbar>
          <Button label="Export" icon="pi pi-download" />
          <Button label="Add New" icon="pi pi-plus" />
        </template>
        <MTableColumn label="Date / Time" field="datetime" width="180px">
          <template #default="{ value }">
            {{ formatToLocalDate(value) }}
          </template>
        </MTableColumn>

        <MTableColumn label="Title" field="title" width="1fr" />

        <MTableColumn label="Level" field="level" width="100px" />

        <MTableColumn label="Script Type" field="scriptType" width="150px" />

        <MTableColumn
          label="Script"
          field="scriptName"
          width="1fr"
          :context-menu="scriptContextMenu"
        />

        <MTableColumn
          label="Deployment"
          field="deploymentName"
          width="1fr"
          :context-menu="deploymentContextMenu"
        />

        <MTableColumn label="Message" field="message" width="2fr" />

        <template #loading>
          <div class="flex justify-center">
            <MLoader />
          </div>
        </template>

        <template #empty>
          <div class="flex flex-col items-center justify-center p-8 gap-4">
            <i class="pi pi-inbox text-4xl text-[var(--p-slate-400)]"></i>
            <p class="text-[var(--p-slate-500)]">No logs found.</p>
          </div>
        </template>
      </MTable>
    </template>
  </MCard>
</template>

<style scoped>
.p-inputtext {
  border-top-right-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
  border-color: transparent !important;
}
.p-inputtext:active,
.p-inputtext:focus {
  border: 1px solid var(--p-slate-500) !important;
}

.p-inputgroupaddon {
  padding: 0 !important;
}
</style>

<style>
.query-panel .p-panel-header {
  padding-block: 0 !important;
}
</style>
