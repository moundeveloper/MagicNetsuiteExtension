<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import ViewHeader from "../components/ViewHeader.vue";
import MCard from "../components/universal/card/MCard.vue";

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
const router = useRouter();

const template = ref<RecordItem | null>(null);
const loading = ref(false);

const percent = ref(50);
const limitedPercent = computed({
  get() {
    return percent.value;
  },
  set(val) {
    percent.value = Math.max(15, Math.min(20, val));
  }
});

const getTemplate = async () => {
  template.value = route.query.data
    ? JSON.parse(route.query.data as string)
    : null;
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
    direction="column"
    gap="1rem"
    padding="1rem"
    outlined
    elevated
    :style="{ height: `${props.vhOffset}vh` }"
  >
    <template #default="{ contentHeight }">
      <div class="flex" :style="{ height: `${contentHeight}px` }">
        <!-- HERE IS WHERE THE EXPANDABLE SIDEBAR GOES -->

        <div>ciao</div>
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
