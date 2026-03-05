<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import ViewHeader from "../components/ViewHeader.vue";
import MCard from "../components/universal/card/MCard.vue";
import ExpandableSidebar from "../components/universal/sidebar/ExpandableSidebar.vue";
import MTabs from "../components/universal/tabs/MTabs.vue";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import MLoader from "../components/universal/patterns/MLoader.vue";
import MonacoEditorDiff from "../components/MonacoEditorDiff.vue";
import { Select } from "primevue";

interface RecordItem {
  id: number;
  name: string;
  scriptId: string;
  inactive: boolean;
  preferred: boolean;
  printType: string;
  customRecordType: string;
  customTransactionType: string;
  tranType: string;
  savedSearch: string;
  recordType: string;
}

const props = defineProps<{
  vhOffset: number;
}>();

const route = useRoute();
const code = ref<string>("");
const template = ref<RecordItem | null>(null);
const loading = ref(false);
const versions = ref<number[]>([]);
const selectedVersion = ref<number | null>(null);
const compareVersionLeft = ref<number | null>(null);
const compareVersionRight = ref<number | null>(null);
const leftCode = ref("");
const rightCode = ref("");
const loadingDiff = ref(false);

const getTemplate = async (version?: number | null) => {
  const templateData = route.query.data
    ? JSON.parse(route.query.data as string)
    : null;

  if (!templateData) return;

  template.value = templateData;
  loading.value = true;

  try {
    const { message: templateResponse } = await callApi(
      RequestRoutes.GET_TEMPLATES_CONTENT,
      {
        templateId: templateData.id,
        printType: templateData.printType,
        transactionType: templateData.tranType,
        customRecordType: templateData.customRecordTypeScriptId,
        savedSearch: templateData.savedSearch,

        version: version ?? undefined
      }
    );

    const { templateContent, currentVersion } = templateResponse;

    code.value = templateContent;
    versions.value = Array.from({ length: currentVersion }, (_, i) => i + 1);
    selectedVersion.value = currentVersion;
  } catch (error) {
    console.error("Error fetching template content:", error);
  } finally {
    loading.value = false;
  }
};

const handleVersionChange = () => {
  getTemplate(selectedVersion.value);
};

const fetchCompareVersion = async (version: number | null, isLeft: boolean) => {
  const templateData = route.query.data
    ? JSON.parse(route.query.data as string)
    : null;

  if (!templateData || version === null) return;

  loadingDiff.value = true;
  try {
    const { message: templateResponse } = await callApi(
      RequestRoutes.GET_TEMPLATES_CONTENT,
      {
        templateId: templateData.id,
        printType: templateData.printType,
        transactionType: templateData.tranType,
        customRecordType: templateData.customRecordTypeScriptId,
        version
      }
    );

    const { templateContent } = templateResponse;

    if (isLeft) {
      leftCode.value = templateContent;
    } else {
      rightCode.value = templateContent;
    }
  } catch (error) {
    console.error("Error fetching compare version:", error);
  } finally {
    loadingDiff.value = false;
  }
};

const handleCompareVersionLeftChange = () => {
  fetchCompareVersion(compareVersionLeft.value, true);
};

const handleCompareVersionRightChange = () => {
  fetchCompareVersion(compareVersionRight.value, false);
};

const tabs = ref([
  { id: "editor", label: "Editor" },
  { id: "compare", label: "Compare Versions" }
]);

const tabHeaders = computed(() =>
  tabs.value.map((tab) => ({
    name: tab.id,
    label: tab.label
  }))
);

const handleChange = (val: string) => {
  console.log("Modified changed:", val);
};

const onFocus = () => {
  console.log("Editor focused");
};

const onBlur = () => {
  console.log("Editor blurred");
};

onMounted(async () => {
  await getTemplate(null);
});
</script>

<template>
  <ViewHeader />

  <MCard
    v-if="template"
    flex
    autoHeight
    direction="row"
    gap="0.5"
    padding=""
    outlined
    elevated
    :style="{ height: `${vhOffset}vh` }"
  >
    <template #default>
      <ExpandableSidebar>
        <template #default>
          <div class="sidebar-section">
            <h4 class="font-bold">{{ template.name }}</h4>
            <p>Script ID: {{ template.scriptId }}</p>
            <p v-if="template.printType">
              Print Type: {{ template.printType }}
            </p>
            <p v-if="template.tranType">
              Transaction Type: {{ template.tranType }}
            </p>
            <p v-if="template.customRecordType">
              Custom Record Type: {{ template.customRecordType }}
            </p>
            <p v-if="template.customTransactionType">
              Custom Transaction Type: {{ template.customTransactionType }}
            </p>
            <p v-if="template.savedSearch">
              Saved Search: {{ template.recordType }}
            </p>
          </div>
          <div class="sidebar-section">
            <h4>Version</h4>
            <Select
              v-model="selectedVersion"
              :options="versions"
              placeholder="Select Version"
              class="w-full"
              @change="handleVersionChange"
            >
              <template #value="slotProps">
                <span class="flex items-center gap-2">
                  <span v-if="!slotProps.value">{{
                    slotProps.placeholder
                  }}</span>
                  <span v-else-if="Math.max(...versions) === slotProps.value"
                    >{{ slotProps.value }} Latest</span
                  >
                  <span v-else>{{ slotProps.value }}</span>
                </span>
              </template>
              <template #option="slotProps">
                <span class="flex items-center gap-2">
                  <span v-if="Math.max(...versions) === slotProps.option"
                    >{{ slotProps.option }} Latest</span
                  >
                  <span v-else>{{ slotProps.option }}</span>
                </span>
              </template>
            </Select>
          </div>
          <div class="sidebar-section">
            <h4>Compare Versions</h4>
            <div class="flex flex-col gap-2">
              <Select
                v-model="compareVersionLeft"
                :options="versions"
                placeholder="Left Version"
                class="w-full"
                @change="handleCompareVersionLeftChange"
              >
                <template #value="slotProps">
                  <span class="flex items-center gap-2">
                    <span v-if="!slotProps.value">{{
                      slotProps.placeholder
                    }}</span>
                    <span v-else-if="Math.max(...versions) === slotProps.value"
                      >{{ slotProps.value }} Latest</span
                    >
                    <span v-else>{{ slotProps.value }}</span>
                  </span>
                </template>
                <template #option="slotProps">
                  <span class="flex items-center gap-2">
                    <span v-if="Math.max(...versions) === slotProps.option"
                      >{{ slotProps.option }} Latest</span
                    >
                    <span v-else>{{ slotProps.option }}</span>
                  </span>
                </template>
              </Select>
              <Select
                v-model="compareVersionRight"
                :options="versions"
                placeholder="Right Version"
                class="w-full"
                @change="handleCompareVersionRightChange"
              >
                <template #value="slotProps">
                  <span class="flex items-center gap-2">
                    <span v-if="!slotProps.value">{{
                      slotProps.placeholder
                    }}</span>
                    <span v-else-if="Math.max(...versions) === slotProps.value"
                      >{{ slotProps.value }} Latest</span
                    >
                    <span v-else>{{ slotProps.value }}</span>
                  </span>
                </template>
                <template #option="slotProps">
                  <span class="flex items-center gap-2">
                    <span v-if="Math.max(...versions) === slotProps.option"
                      >{{ slotProps.option }} Latest</span
                    >
                    <span v-else>{{ slotProps.option }}</span>
                  </span>
                </template>
              </Select>
            </div>
          </div>
        </template>
      </ExpandableSidebar>

      <div class="h-full flex-1 p-2" style="min-width: 0">
        <MTabs class="w-full" :tabs="tabHeaders">
          <template #editor="{ contentHeight }">
            <div :style="{ height: `${contentHeight}px`, padding: '1rem' }">
              <div
                v-if="loading"
                class="flex items-center justify-center h-full"
              >
                <MLoader />
              </div>
              <MonacoCodeEditor v-else v-model="code" language="xml" />
            </div>
          </template>
          <template #compare="{ contentHeight }">
            <div :style="{ height: `${contentHeight}px`, padding: '1rem' }">
              <div
                v-if="loadingDiff"
                class="flex items-center justify-center h-full"
              >
                <MLoader />
              </div>
              <MonacoEditorDiff
                v-else
                :originalValue="leftCode"
                v-model:modifiedValue="rightCode"
                language="xml"
                theme="vs-dark"
                @change="handleChange"
                @focus="onFocus"
                @blur="onBlur"
              />
            </div>
          </template>
        </MTabs>
      </div>
    </template>
  </MCard>

  <div v-else-if="loading" class="flex items-center justify-center p-8">
    <i class="pi pi-spin pi-spinner text-2xl"></i>
  </div>

  <div v-else class="flex items-center justify-center p-8">
    <p>Template not found.</p>
  </div>
</template>

<style scoped>
.sidebar-section {
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  background: var(--p-slate-100);
  border-radius: 4px;
  border: 1px solid var(--p-slate-200);
}

.sidebar-section h4 {
  margin: 0 0 0.5rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-slate-700);
}

.sidebar-section p {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-slate-600);
}
</style>
