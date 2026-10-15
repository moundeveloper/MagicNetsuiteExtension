<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import DashboardRuntime from "../features/dashboards/DashboardRuntime.vue";
import {
  dashboardCommand,
  observeDashboards,
  type Dashboard,
} from "../features/dashboards/api";
import { openDashboardTab } from "../utils/dashboardTabs";
const props = withDefaults(
  defineProps<{ tabFullPath?: string; tabActive?: boolean }>(),
  { tabActive: true },
);
const route = useRoute();
const router = useRouter();
// Workspace views stay mounted: resolve this tab's path, not the active tab's route.
const ownRoute = computed(() =>
  props.tabFullPath ? router.resolve(props.tabFullPath) : route,
);
const id = computed(() => String(ownRoute.value.params.dashboardId || ""));
const dashboard = ref<Dashboard>();
const error = ref("");
let sequence = 0;
async function load() {
  const seq = ++sequence;
  try {
    const result = await dashboardCommand<Dashboard>("get", {
      dashboardId: id.value,
    });
    if (seq !== sequence) return;
    dashboard.value = result;
    error.value = "";
  } catch (e) {
    if (seq !== sequence) return;
    dashboard.value = undefined;
    error.value = e instanceof Error ? e.message : String(e);
  }
}
watch(
  id,
  () => {
    dashboard.value = undefined;
    void load();
  },
  { immediate: true },
);
const stop = observeDashboards(() => void load());
onBeforeUnmount(() => {
  ++sequence;
  stop();
});
function manage() {
  openDashboardTab(`/dashboards?dashboard=${encodeURIComponent(id.value)}`, {
    label: "Dashboards",
  });
}
</script>
<template>
  <section
    class="dashboard-page"
    :data-dashboard-page="id"
    :data-dashboard-revision="dashboard?.revision"
  >
    <header class="dashboard-page-toolbar">
      <strong>{{ dashboard?.title || "Dashboard" }}</strong>
      <small v-if="dashboard"
        >{{ dashboard.mode
        }}<template v-if="dashboard.account">
          · {{ dashboard.account }}</template
        ></small
      >
      <Button
        label="Manage"
        icon="pi pi-sliders-h"
        size="small"
        text
        severity="secondary"
        @click="manage"
      />
    </header>
    <p v-if="error" role="alert" class="dashboard-page-message">{{ error }}</p>
    <div v-else-if="dashboard" class="dashboard-page-content">
      <DashboardRuntime
        :key="dashboard.id"
        :dashboard="dashboard"
        :active="tabActive"
        :preview="ownRoute.query.preview === '1'"
      />
    </div>
    <p v-else class="dashboard-page-message">
      <i class="pi pi-spin pi-spinner" /> Loading dashboard…
    </p>
  </section>
</template>
<style scoped>
.dashboard-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.dashboard-page-toolbar {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.3rem 0.8rem;
  border-bottom: 1px solid var(--p-content-border-color);
}
.dashboard-page-toolbar strong {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 0.85rem;
}
.dashboard-page-toolbar small {
  color: var(--p-text-muted-color);
  font-size: 0.7rem;
}
.dashboard-page-toolbar :deep(button) {
  margin-left: auto;
  flex-shrink: 0;
}
.dashboard-page-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.8rem;
}
.dashboard-page-message {
  padding: 1rem;
  color: var(--p-text-muted-color);
}
</style>
