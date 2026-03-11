<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import MCard from "../components/universal/card/MCard.vue";
import MTable from "../components/universal/table/MTable.vue";
import MTableColumn from "../components/universal/table/MTableColumn.vue";
import ViewHeader from "../components/ViewHeader.vue";

const router = useRouter();

type RecordItem = {
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
  customRecordTypeScriptId: string;
  recordType: string;
};

const records = ref<RecordItem[]>([]);
const loading = ref(false);

const navigateToTemplate = (template: RecordItem) => {
  router.push({
    path: `/templates/${template.id}`,
    query: {
      data: JSON.stringify(template)
    }
  });
};

const props = defineProps<{
  vhOffset: number;
}>();

const getAdvancedPdfTemplates = async () => {
  loading.value = true;
  try {
    const response = await callApi(RequestRoutes.ADVANCED_PDF_TEMPLATES);
    if (!response) return;
    const { message: templates } = response as ApiResponse;

    if (!templates || !Array.isArray(templates)) return;

    records.value = templates.map((record: any) => ({
      id: record.id,
      name: record.name,
      scriptId: record.scriptid,
      inactive: record.inactive,
      preferred: record.preferred,
      printType: record.printtype,
      customRecordType: record.customrecordtype,
      customTransactionType: record.customtransactiontype,
      tranType: record.trantype,
      savedSearch: record.savedsearch,
      customRecordTypeScriptId: record.customrecordtypescriptid,
      recordType: record.recordtype
    }));
  } catch (error) {
    console.error("getAdvancedPdfTemplates error:", error);
  } finally {
    loading.value = false;
  }
};

onMounted(async () => {
  await getAdvancedPdfTemplates();

  records.value.push({
    id: 411,
    name: "Testing Invoice",
    scriptId: "CUSTTMPL_TESTING_INVOICE",
    printType: "TRANSACTION",
    preferred: true,
    inactive: true,
    tranType: "CustInvc",
    customRecordType: "",
    customTransactionType: "",
    savedSearch: "",
    customRecordTypeScriptId: "",
    recordType: "transaction"
  });
});
</script>

<template>
  <ViewHeader />

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
        :rows="records || []"
        :height="`${contentHeight}px`"
        :loading="loading"
        searchable
        filterable
        auto-row-height
        search-placeholder="Search templates..."
        collapsible
        collapsible-key="advanced-pdf-templates"
      >
        <MTableColumn
          label="Name"
          field="name"
          width="1fr"
          searchable
          filterable
          clickable
        >
          <template #default="{ value, row }">
            <div
              @click="navigateToTemplate(row)"
              class="group flex items-center gap-4 cursor-pointer text-left"
            >
              <i class="pi pi-eye text-sm"></i>
              <span class="group-hover:underline">{{ value }}</span>
            </div>
          </template>
        </MTableColumn>

        <MTableColumn
          label="Script ID"
          field="scriptId"
          width="1fr"
          searchable
          filterable
        />

        <MTableColumn
          label="Print Type"
          field="printType"
          width="100px"
          searchable
          filterable
        />

        <MTableColumn label="Preferred" field="preferred" width="100px">
          <template #default="{ value }">
            <span :class="value ? 'text-green-600' : 'text-gray-400'">
              {{ value ? "Yes" : "No" }}
            </span>
          </template>
        </MTableColumn>

        <MTableColumn label="Inactive" field="inactive" width="100px">
          <template #default="{ value }">
            <span :class="value ? 'text-red-600' : 'text-green-600'">
              {{ value ? "Yes" : "No" }}
            </span>
          </template>
        </MTableColumn>

        <MTableColumn
          label="Transaction Type"
          field="tranType"
          width="100px"
          searchable
          filterable
        />

        <MTableColumn
          label="Custom Record Type"
          field="customRecordType"
          width="1fr"
          searchable
          filterable
        />

        <MTableColumn
          label="Custom Transaction Type"
          field="customTransactionType"
          width="1fr"
          searchable
          filterable
        />

        <MTableColumn
          label="Saved Search"
          field="recordType"
          width="1fr"
          searchable
          filterable
        />

        <MTableColumn
          label="Internal ID"
          field="id"
          width="100px"
          searchable
          filterable
        />

        <template #empty>
          <div class="flex flex-col items-center justify-center p-8 gap-4">
            <i class="pi pi-inbox text-4xl text-[var(--p-slate-400)]"></i>
            <p class="text-[var(--p-slate-500)]">No templates found.</p>
          </div>
        </template>
      </MTable>
    </template>
  </MCard>
</template>
