<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Button from "primevue/button";
import { useToast } from "primevue/usetoast";
import { ApiRequestType, callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";

type ComponentStatus = {
  folderExists?: boolean;
  serverFileExists?: boolean;
  suiteletScriptExists?: boolean;
  suiteletDeployed?: boolean;
  allReady?: boolean;
};

export interface RemoveStep {
  name: string;
  status: "removed" | "skipped" | "error";
  error?: string;
}

const props = withDefaults(
  defineProps<{
    title?: string;
    deployLabel?: string;
    checkLabel?: string;
    removeLabel?: string;
    confirmLabel?: string;
    autoCheck?: boolean;
    showAllReady?: boolean;
    showDeploy?: boolean;
  }>(),
  {
    title: "Server",
    deployLabel: "Deploy",
    checkLabel: "Check Server",
    removeLabel: "Remove Server Components",
    confirmLabel: "Click Again to Confirm",
    autoCheck: false,
    showAllReady: true,
    showDeploy: true
  }
);

const emit = defineEmits<{
  checked: [components: ComponentStatus | null];
  deployed: [result: unknown];
  removed: [steps: RemoveStep[]];
}>();

const toast = useToast();
const checking = ref(false);
const deploying = ref(false);
const hasChecked = ref(false);
const lastCheckedAt = ref("");
const components = ref<ComponentStatus | null>(null);
const error = ref<string | null>(null);
const removeConfirmPending = ref(false);
const isRemoving = ref(false);
let removeConfirmTimer: number | undefined;

const statusItems = [
  { key: "folderExists", label: "Folder" },
  { key: "serverFileExists", label: "Server File" },
  { key: "suiteletScriptExists", label: "Suitelet Script" },
  { key: "suiteletDeployed", label: "Suitelet Deployed" },
  { key: "allReady", label: "All Ready", allReady: true }
] as const;

const visibleStatusItems = () =>
  statusItems.filter((item) => props.showAllReady || !("allReady" in item));

const hasAnyDeployed = computed(() =>
  Boolean(
    components.value?.folderExists ||
      components.value?.serverFileExists ||
      components.value?.suiteletScriptExists ||
      components.value?.suiteletDeployed
  )
);

const removeDisabledReason = computed(() => {
  if (isRemoving.value) return "Removing server components";
  if (!hasAnyDeployed.value) return "No deployed server components to remove";
  return "";
});

const syncCheckMetadata = () => {
  hasChecked.value = true;
  lastCheckedAt.value = new Date().toLocaleTimeString();
};

const statusValue = (key: keyof ComponentStatus) => components.value?.[key];

const statusClass = (key: keyof ComponentStatus) => {
  const value = statusValue(key);
  if (value === true) return "server-status-row--ok";
  if (value === false) return "server-status-row--missing";
  if (checking.value || deploying.value) return "server-status-row--checking";
  return "server-status-row--unknown";
};

const statusIcon = (key: keyof ComponentStatus) => {
  const value = statusValue(key);
  if (value === true) return "pi pi-check";
  if (value === false) return "pi pi-times";
  if (checking.value || deploying.value) return "pi pi-spin pi-spinner";
  return "pi pi-circle";
};

const statusText = (key: keyof ComponentStatus) => {
  const value = statusValue(key);
  if (value === true) return "Ready";
  if (value === false) return "Missing";
  if (checking.value) return "Checking";
  if (deploying.value) return "Deploying";
  return hasChecked.value ? "Unknown" : "Not checked";
};

const check = async () => {
  checking.value = true;
  error.value = null;

  try {
    const response = await callApi(RequestRoutes.CHECK_SERVER_COMPONENTS);
    components.value = ((response as ApiResponse)?.message || response) as ComponentStatus;
    syncCheckMetadata();
    emit("checked", components.value);
  } catch (err: any) {
    error.value = err?.message || "Failed to check server components";
    syncCheckMetadata();
    emit("checked", null);
  } finally {
    checking.value = false;
  }
};

const deploy = async () => {
  deploying.value = true;
  error.value = null;
  removeConfirmPending.value = false;

  if (removeConfirmTimer) {
    clearTimeout(removeConfirmTimer);
    removeConfirmTimer = undefined;
  }

  try {
    const response = await callApi(
      RequestRoutes.DEPLOY_SERVER_COMPONENTS,
      {},
      ApiRequestType.NORMAL
    );
    const result = (response as ApiResponse)?.message || response;
    components.value = (result?.after || result?.components || result) as ComponentStatus;
    syncCheckMetadata();
    emit("deployed", result);

    toast.add({
      severity: components.value?.allReady ? "success" : "warn",
      summary: components.value?.allReady ? "Server Components Ready" : "Deploy Finished",
      detail: components.value?.allReady
        ? "Server-side components are deployed."
        : "Deployment finished, but one or more components still need attention.",
      life: 4000
    });

    return result;
  } catch (err: any) {
    error.value = err?.message || "Failed to deploy server components";
    syncCheckMetadata();
    toast.add({
      severity: "error",
      summary: "Deploy Failed",
      detail: error.value,
      life: 5000
    });
    throw err;
  } finally {
    deploying.value = false;
  }
};

const remove = async () => {
  if (!hasAnyDeployed.value) return;

  if (!removeConfirmPending.value) {
    removeConfirmPending.value = true;
    toast.add({
      severity: "warn",
      summary: "Confirm Removal",
      detail: "Click the button again within 3 seconds to confirm",
      life: 3000
    });
    removeConfirmTimer = window.setTimeout(() => {
      removeConfirmPending.value = false;
    }, 3000);
    return;
  }

  removeConfirmPending.value = false;
  if (removeConfirmTimer) {
    clearTimeout(removeConfirmTimer);
    removeConfirmTimer = undefined;
  }

  isRemoving.value = true;

  try {
    const response = await callApi(
      RequestRoutes.REMOVE_SERVER_COMPONENTS,
      {},
      ApiRequestType.NORMAL
    );
    const result = (response as ApiResponse)?.message || response;

    if (result?.steps && Array.isArray(result.steps)) {
      const removedCount = result.steps.filter((step: RemoveStep) => step.status === "removed").length;
      const errorCount = result.steps.filter((step: RemoveStep) => step.status === "error").length;
      toast.add({
        severity: errorCount > 0 ? "warn" : "success",
        summary: "Components Removed",
        detail: `${removedCount} removed, ${errorCount} error(s)`,
        life: 4000
      });
      emit("removed", result.steps);
    } else {
      toast.add({
        severity: "success",
        summary: "Components Removed",
        detail: "Server components were removed.",
        life: 4000
      });
      emit("removed", []);
    }

    await check();
  } catch (err: any) {
    toast.add({
      severity: "error",
      summary: "Removal Failed",
      detail: err?.message || "Unknown error",
      life: 5000
    });
  } finally {
    isRemoving.value = false;
  }
};

defineExpose({ check, deploy });

onMounted(() => {
  if (props.autoCheck) void check();
});
</script>

<template>
  <section class="server-components-panel">
    <div class="server-components-header">
      <div class="server-components-heading">
        <span class="server-components-badge">
          <i class="pi pi-server" />
        </span>
        <div class="server-components-title-block">
          <h4>{{ title }}</h4>
          <span class="server-components-meta">
            {{ lastCheckedAt ? `Checked ${lastCheckedAt}` : "Status not checked" }}
          </span>
        </div>
      </div>
      <div class="server-components-actions">
        <Button
          v-if="showDeploy"
          size="small"
          :loading="deploying"
          :disabled="checking || isRemoving"
          class="server-components-deploy"
          @click="deploy"
        >
          <i class="pi pi-cloud-upload" />
          <span>{{ deployLabel }}</span>
        </Button>
        <Button
          size="small"
          :loading="checking"
          :disabled="deploying || isRemoving"
          class="server-components-check"
          @click="check"
        >
          <i class="pi pi-refresh" />
          <span>{{ checkLabel }}</span>
        </Button>
      </div>
    </div>

    <div class="server-components-status">
      <div
        v-for="item in visibleStatusItems()"
        :key="item.key"
        class="server-status-row"
        :class="statusClass(item.key)"
      >
        <span class="server-status-icon">
          <i :class="statusIcon(item.key)" />
        </span>
        <span class="server-status-content">
          <span class="server-status-label">{{ item.label }}</span>
          <span class="server-status-state">{{ statusText(item.key) }}</span>
        </span>
      </div>
    </div>

    <div v-if="error" class="server-components-error">
      {{ error }}
    </div>

    <Button
      size="small"
      :severity="removeConfirmPending ? 'warn' : 'danger'"
      :loading="isRemoving"
      :disabled="isRemoving || !hasAnyDeployed"
      :title="removeDisabledReason"
      class="server-components-remove"
      @click="remove"
    >
      <i class="pi pi-trash" />
      {{ removeConfirmPending ? confirmLabel : removeLabel }}
    </Button>
  </section>
</template>

<style scoped>
.server-components-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.65rem;
  border: 1px solid #dbe3ea;
  border-radius: 8px;
  background: #fbfcfd;
}

.server-components-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-width: 0;
}

.server-components-heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.server-components-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 1.8rem;
  height: 1.8rem;
  border: 1px solid #d8c6ff;
  border-radius: 6px;
  background: #faf7ff;
  color: #7b2ff7;
  font-size: 0.85rem;
}

.server-components-title-block {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.05rem;
}

.server-components-title-block h4 {
  margin: 0;
  overflow: hidden;
  color: #27323a;
  font-size: 0.875rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-components-meta {
  overflow: hidden;
  color: #62696e;
  font-size: 0.7rem;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-components-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 0.35rem;
  min-width: 0;
}

.server-components-deploy,
.server-components-check,
.server-components-remove {
  min-height: 2rem;
  white-space: nowrap;
}

.server-components-deploy {
  border-color: #d8c6ff;
  background: #faf7ff;
  color: #7b2ff7;
}

.server-components-status {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr));
  gap: 0.35rem;
  min-width: 0;
}

.server-status-row {
  display: grid;
  grid-template-columns: 1.35rem minmax(0, 1fr);
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.server-status-row {
  min-height: 2.35rem;
  padding: 0.35rem 0.45rem;
  border: 1px solid #dbe3ea;
  border-radius: 6px;
  background: #ffffff;
}

.server-status-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
}

.server-status-icon {
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  background: #eef3f7;
}

.server-status-row--ok {
  color: var(--p-green-600);
}

.server-status-row--ok .server-status-icon {
  background: #ecfdf3;
}

.server-status-row--missing {
  color: var(--p-red-500);
}

.server-status-row--missing .server-status-icon {
  background: #fff1f2;
}

.server-status-row--checking {
  color: #7b2ff7;
}

.server-status-row--checking .server-status-icon {
  background: #faf7ff;
}

.server-status-row--unknown {
  color: #8a949b;
}

.server-status-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.05rem;
}

.server-status-label,
.server-status-state {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-status-label {
  color: #27323a;
  font-weight: 600;
}

.server-status-state {
  font-size: 0.68rem;
}

.server-components-error {
  color: var(--p-red-500);
  font-size: 0.75rem;
  line-height: 1.35;
}

@media (max-width: 680px) {
  .server-components-header {
    align-items: stretch;
    flex-direction: column;
  }

  .server-components-actions {
    width: 100%;
  }

  .server-components-actions > * {
    flex: 1 1 0;
  }
}
</style>
