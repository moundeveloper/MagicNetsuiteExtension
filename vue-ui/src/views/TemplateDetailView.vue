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
import dummmytemplate from "../assets/template_dummy.ftl?raw";
import MonacoEditorDiff from "../components/MonacoEditorDiff.vue";

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
}

const props = defineProps<{
  vhOffset: number;
}>();

const route = useRoute();
const code = ref<string>(dummmytemplate);
const template = ref<RecordItem | null>(null);
const loading = ref(false);

const getTemplate = async () => {
  template.value = route.query.data
    ? JSON.parse(route.query.data as string)
    : null;
};

const tabs = ref([
  { id: "editor", label: "Editor" },
  { id: "compare", label: "Comapare Versions" },
  { id: "preview", label: "Preview" }
]);

const tabHeaders = computed(() =>
  tabs.value.map((tab) => ({
    name: tab.id,
    label: tab.label
  }))
);

const originalCode = ref(`
function sum(a, b) {
  return a + b;
}
`);

const modifiedCode = ref(`
function sum(a, b) {
  return a - b;
}
`);

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
  await getTemplate();
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
            <h4>Section 1</h4>
            <p>Content for section 1</p>
          </div>
          <div class="sidebar-section">
            <h4>Section 2</h4>
            <p>Content for section 2</p>
          </div>
          <div class="sidebar-section">
            <h4>Section 3</h4>
            <p>Content for section 3</p>
          </div>
          <div class="sidebar-section">
            <h4>Section 4</h4>
            <p>Content for section 4</p>
          </div>
        </template>
      </ExpandableSidebar>

      <div class="h-full flex-1 p-2" style="min-width: 0">
        <MTabs class="w-full" :tabs="tabHeaders">
          <template #editor="{ contentHeight }">
            <div :style="{ height: `${contentHeight}px`, padding: '1rem' }">
              <MonacoCodeEditor v-model="code" language="xml" />
            </div>
          </template>
          <template #compare="{ contentHeight }">
            <div :style="{ height: `${contentHeight}px`, padding: '1rem' }">
              <MonacoEditorDiff
                :originalValue="originalCode"
                v-model:modifiedValue="modifiedCode"
                language="javascript"
                theme="vs-dark"
                @change="handleChange"
                @focus="onFocus"
                @blur="onBlur"
              />
            </div>
          </template>
          <template #preview="{ contentHeight }">
            <div :style="{ height: `${contentHeight}px`, padding: '1rem' }">
              <p>Preview content here</p>
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
