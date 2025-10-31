<template>
  <div class="wraper">
    <h1>::SEARCH-SCRIPT-DEPLOYED</h1>

    <div v-if="loading" class="progress-spinner">
      <ProgressSpinner style="width: 3rem; height: 3rem; margin: 2rem auto" />
    </div>

    <div v-else class="code-container">
      <CodeViewer :files="files" :loading="loading" :toggleable="true" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import ProgressSpinner from "primevue/progressspinner";
import { callApi } from "../utils/api";
import { RequestRoutes } from "../types/request";
import CodeViewer from "../components/CodeViewer.vue";

const loading = ref(false);

type DeployedScript = {
  scriptName: string;
  scriptType: string;
  scriptFile: string;
};

type File = {
  name: string;
  content: string;
};

const deployedScripts = ref<DeployedScript[]>([]);

const files = ref<File[]>([]);

// --- Fetch scripts ---
const getDeployedScripts = async () => {
  loading.value = true;
  try {
    const { message: record } = await callApi(RequestRoutes.CURRENT_REC_TYPE);
    const { type } = record || {};
    if (!type) return;

    const { message: deployedScriptsResponse } = await callApi(
      RequestRoutes.SCRIPTS_DEPLOYED,
      {
        recordType: type,
      }
    );

    if (!deployedScriptsResponse) {
      console.error("Error fetching deployed scripts");
      return;
    }

    deployedScripts.value = deployedScriptsResponse as DeployedScript[];

    // Convert scripts to CodeViewer format
    files.value = deployedScripts.value.map((s) => ({
      name: `${s.scriptName} | ${s.scriptType}`,
      content: s.scriptFile,
    }));
  } catch (e) {
    console.error("Error fetching deployed scripts:", e);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  getDeployedScripts();
});
</script>

<style scoped>
.wraper {
  padding: 2rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.code-container {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: scroll;
  max-height: 80vh;
}

.progress-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
