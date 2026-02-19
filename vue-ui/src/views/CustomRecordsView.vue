<script setup lang="ts">
import { onMounted, ref } from "vue";
import { callApi, closePanel, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import MCard from "../components/universal/card/MCard.vue";
import MTable from "../components/universal/table/MTable.vue";
import MTableColumn from "../components/universal/table/MTableColumn.vue";
import { useFormattedRouteName } from "../composables/useFormattedRouteName";

const { formattedRouteName } = useFormattedRouteName();

interface RecordItem {
  internalid: number;
  name: string;
  scriptid: string;
  description: string;
  owner: string;
}

const records = ref<RecordItem[]>();
const loading = ref(false);

const props = defineProps<{
  vhOffset: number;
}>();

const getCustomRecords = async () => {
  loading.value = true;
  try {
    const response = await callApi(RequestRoutes.CUSTOM_RECORDS);
    if (!response) return;
    const { message: customRecords } = response as ApiResponse;

    if (!customRecords || !Array.isArray(customRecords)) return;

    records.value = customRecords.map((record: any) => ({
      id: record.internalid,
      internalid: record.internalid,
      name: record.name,
      scriptid: record.scriptid,
      description: record.description,
      owner: record.owner
    }));
  } catch (error) {
    console.error("getCustomRecords error:", error);
  } finally {
    loading.value = false;
  }
};

const getCustomRecordUrl = async (recordId: number) => {
  const response = await callApi(RequestRoutes.CUSTOM_RECORD_URL, {
    recordId
  });
  if (!response) return;
  const { message: url } = response as ApiResponse;

  window.open(url, "_blank");
  closePanel();
};

onMounted(async () => {
  await getCustomRecords();
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
        :rows="records || []"
        :height="`${contentHeight}px`"
        :loading="loading"
        searchable
        search-placeholder="Search records..."
      >
        <MTableColumn label="Name" field="name" width="1fr" searchable>
          <template #default="{ value, row }">
            <div
              class="flex gap-2 cursor-pointer hover:underline"
              @click="getCustomRecordUrl(row.internalid)"
            >
              <i class="pi pi-link text-[var(--p-slate-600)]"></i>
              <span class="text-[var(--p-slate-600)]">
                {{ value }}
              </span>
            </div>
          </template>
        </MTableColumn>

        <MTableColumn
          label="Script ID"
          field="scriptid"
          width="1fr"
          searchable
        />

        <MTableColumn label="Owner" field="owner" width="1fr" searchable />

        <MTableColumn
          label="Internal ID"
          field="internalid"
          width="100px"
          searchable
        />

        <MTableColumn
          label="Description"
          field="description"
          width="1fr"
          searchable
        >
          <template #default="{ value }">
            <span class="truncate block max-w-[300px]" :title="value">
              {{ value || "-" }}
            </span>
          </template>
        </MTableColumn>

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
