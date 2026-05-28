<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Textarea from "primevue/textarea";
import { useToast } from "primevue/usetoast";
import MCard from "../components/universal/card/MCard.vue";
import { getExtensionUserId } from "../utils/extensionUser";
import {
  closeFeatureRequest,
  createFeatureRequest,
  getFeatureFeedbackConfigState,
  listFeatureRequests,
  reopenFeatureRequest,
  updateFeatureRequest,
  type FeatureRequestPriority,
  type FeatureRequestRecord,
  type FeatureRequestStatus,
} from "../utils/featureFeedbackApi";

const props = defineProps<{ vhOffset: number }>();
const toast = useToast();

const isAdmin = import.meta.env.VITE_PRIVILEGE_LEVEL === "ADMIN";
const configState = getFeatureFeedbackConfigState();

const requests = ref<FeatureRequestRecord[]>([]);
const selectedId = ref("");
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const search = ref("");
const statusFilter = ref<FeatureRequestStatus | "all">("all");
const userId = ref("");

const draft = ref({
  title: "",
  description: "",
  category: "Feature",
  priority: "normal" as FeatureRequestPriority,
});

const adminStatus = ref<FeatureRequestStatus>("reviewing");
const adminResponse = ref("");

const statusOptions: Array<{ label: string; value: FeatureRequestStatus | "all" }> = [
  { label: "All", value: "all" },
  { label: "New", value: "new" },
  { label: "Reviewing", value: "reviewing" },
  { label: "Planned", value: "planned" },
  { label: "In progress", value: "in_progress" },
  { label: "Released", value: "released" },
  { label: "Declined", value: "declined" },
  { label: "Closed", value: "closed" },
];

const requestStatusOptions = statusOptions.filter(
  (option): option is { label: string; value: FeatureRequestStatus } => option.value !== "all"
);

const categoryOptions = [
  { label: "Feature", value: "Feature" },
  { label: "Improvement", value: "Improvement" },
  { label: "Bug", value: "Bug" },
  { label: "Workflow", value: "Workflow" },
  { label: "Performance", value: "Performance" },
];

const priorityOptions: Array<{ label: string; value: FeatureRequestPriority }> = [
  { label: "Low", value: "low" },
  { label: "Normal", value: "normal" },
  { label: "High", value: "high" },
];

const selectedRequest = computed(() =>
  requests.value.find((request) => request.id === selectedId.value) ?? requests.value[0] ?? null
);

const filteredRequests = computed(() => {
  const q = search.value.trim().toLowerCase();
  return requests.value.filter((request) => {
    const matchesStatus = statusFilter.value === "all" || request.status === statusFilter.value;
    const text = `${request.title} ${request.description} ${request.user_id} ${request.category}`.toLowerCase();
    return matchesStatus && (!q || text.includes(q));
  });
});

const openCount = computed(() =>
  requests.value.filter((request) => request.status !== "closed" && request.status !== "released").length
);

const hasDraft = computed(
  () => draft.value.title.trim().length > 0 && draft.value.description.trim().length > 0
);

const formatDate = (value: string | null): string => {
  if (!value) return "Not closed";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
};

const statusLabel = (status: FeatureRequestStatus): string =>
  requestStatusOptions.find((option) => option.value === status)?.label ?? status;

const loadRequests = async () => {
  if (!configState.configured) return;
  loading.value = true;
  error.value = "";
  try {
    requests.value = await listFeatureRequests(isAdmin);
    if (!selectedId.value || !requests.value.some((request) => request.id === selectedId.value)) {
      selectedId.value = requests.value[0]?.id ?? "";
    }
    syncAdminEditor();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
};

const syncAdminEditor = () => {
  if (!selectedRequest.value) return;
  adminStatus.value = selectedRequest.value.status;
  adminResponse.value = selectedRequest.value.admin_response ?? "";
};

const selectRequest = (request: FeatureRequestRecord) => {
  selectedId.value = request.id;
  syncAdminEditor();
};

const submitRequest = async () => {
  if (!hasDraft.value || saving.value) return;
  saving.value = true;
  try {
    const created = await createFeatureRequest(draft.value);
    requests.value = [created, ...requests.value];
    selectedId.value = created.id;
    draft.value = {
      title: "",
      description: "",
      category: "Feature",
      priority: "normal",
    };
    toast.add({ severity: "success", summary: "Sent", detail: "Feedback request created", life: 2600 });
  } catch (err) {
    toast.add({ severity: "error", summary: "Could not send", detail: err instanceof Error ? err.message : String(err), life: 5000 });
  } finally {
    saving.value = false;
  }
};

const saveAdminUpdate = async () => {
  if (!selectedRequest.value || saving.value) return;
  saving.value = true;
  try {
    const updated = await updateFeatureRequest(selectedRequest.value.id, {
      status: adminStatus.value,
      admin_response: adminResponse.value.trim() || null,
      closed_at: adminStatus.value === "closed" ? (selectedRequest.value.closed_at ?? new Date().toISOString()) : null,
    });
    replaceRequest(updated);
    toast.add({ severity: "success", summary: "Updated", detail: "Feedback request updated", life: 2600 });
  } catch (err) {
    toast.add({ severity: "error", summary: "Update failed", detail: err instanceof Error ? err.message : String(err), life: 5000 });
  } finally {
    saving.value = false;
  }
};

const closeSelected = async () => {
  if (!selectedRequest.value || saving.value) return;
  saving.value = true;
  try {
    replaceRequest(await closeFeatureRequest(selectedRequest.value.id));
    syncAdminEditor();
  } finally {
    saving.value = false;
  }
};

const reopenSelected = async () => {
  if (!selectedRequest.value || saving.value) return;
  saving.value = true;
  try {
    replaceRequest(await reopenFeatureRequest(selectedRequest.value.id));
    syncAdminEditor();
  } finally {
    saving.value = false;
  }
};

const replaceRequest = (updated: FeatureRequestRecord) => {
  const index = requests.value.findIndex((request) => request.id === updated.id);
  if (index === -1) requests.value.unshift(updated);
  else requests.value[index] = updated;
};

onMounted(async () => {
  userId.value = await getExtensionUserId();
  await loadRequests();
});
</script>

<template>
  <MCard
    flex
    direction="column"
    autoHeight
    outlined
    elevated
    :style="{ height: `${props.vhOffset}vh`, overflow: 'hidden' }"
  >
    <template #default="{ contentHeight }">
      <div class="feedback-view" :style="{ height: `${contentHeight}px` }">
        <header class="feedback-header">
          <div class="feedback-title">
            <span class="eyebrow">{{ isAdmin ? "Admin feedback board" : "Feedback" }}</span>
            <h2>{{ isAdmin ? "Feature Requests" : "Requests & Updates" }}</h2>
          </div>
          <div class="header-metrics">
            <div>
              <strong>{{ requests.length }}</strong>
              <span>Total</span>
            </div>
            <div>
              <strong>{{ openCount }}</strong>
              <span>Open</span>
            </div>
            <button type="button" class="icon-btn" title="Refresh" :disabled="loading" @click="loadRequests">
              <i :class="loading ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" />
            </button>
          </div>
        </header>

        <div v-if="!configState.configured" class="setup-state">
          <i class="pi pi-database" />
          <strong>Supabase is not configured</strong>
          <span>Add {{ configState.missing.join(" and ") }} to the Vite environment files, then rebuild the extension.</span>
        </div>

        <div v-else class="feedback-body">
          <aside class="request-list-panel">
            <div class="panel-toolbar">
              <span>Your ID</span>
              <code :title="userId">{{ userId }}</code>
            </div>
            <div class="filter-row">
              <span class="search-field">
                <i class="pi pi-search" />
                <InputText v-model="search" placeholder="Search requests..." />
              </span>
              <Select v-model="statusFilter" :options="statusOptions" option-label="label" option-value="value" />
            </div>

            <div v-if="error" class="error-strip">{{ error }}</div>
            <div v-if="loading" class="loading-state">
              <i class="pi pi-spin pi-spinner" />
              <span>Loading feedback...</span>
            </div>
            <div v-else-if="!error" class="request-list">
              <button
                v-for="request in filteredRequests"
                :key="request.id"
                type="button"
                class="request-row"
                :class="{ active: selectedRequest?.id === request.id }"
                @click="selectRequest(request)"
              >
                <span class="request-row-head">
                  <strong>{{ request.title }}</strong>
                  <span class="status-pill" :class="`status-${request.status}`">{{ statusLabel(request.status) }}</span>
                </span>
                <span class="request-row-meta">
                  <span>{{ request.category }}</span>
                  <span>{{ formatDate(request.updated_at) }}</span>
                </span>
                <span v-if="isAdmin" class="request-user">{{ request.user_id }}</span>
              </button>
              <div v-if="filteredRequests.length === 0" class="empty-state">
                No feedback requests match the current filters.
              </div>
            </div>
          </aside>

          <main class="request-workspace">
            <section v-if="!isAdmin" class="composer-panel">
              <div class="section-title">
                <span>New Request</span>
                <small>{{ draft.description.length }}/2000</small>
              </div>
              <div class="composer-grid">
                <InputText v-model="draft.title" placeholder="Short title" maxlength="120" />
                <Select v-model="draft.category" :options="categoryOptions" option-label="label" option-value="value" />
                <Select v-model="draft.priority" :options="priorityOptions" option-label="label" option-value="value" />
              </div>
              <Textarea
                v-model="draft.description"
                auto-resize
                maxlength="2000"
                rows="5"
                placeholder="What would make Magic NetSuite better for you?"
              />
              <div class="composer-actions">
                <Button size="small" :disabled="!hasDraft" :loading="saving" @click="submitRequest">
                  <i class="pi pi-send" />
                  Send
                </Button>
              </div>
            </section>

            <section v-if="selectedRequest" class="detail-panel">
              <div class="detail-header">
                <div>
                  <span class="eyebrow">{{ selectedRequest.category }} · {{ selectedRequest.priority }}</span>
                  <h3>{{ selectedRequest.title }}</h3>
                  <small>{{ formatDate(selectedRequest.created_at) }} · {{ selectedRequest.user_id }}</small>
                </div>
                <span class="status-pill large" :class="`status-${selectedRequest.status}`">
                  {{ statusLabel(selectedRequest.status) }}
                </span>
              </div>

              <div class="detail-content">
                <section>
                  <h4>Request</h4>
                  <p>{{ selectedRequest.description }}</p>
                </section>
                <section>
                  <h4>Admin Response</h4>
                  <p v-if="selectedRequest.admin_response">{{ selectedRequest.admin_response }}</p>
                  <p v-else class="muted">No response yet.</p>
                </section>
                <section v-if="selectedRequest.closed_at">
                  <h4>Closed</h4>
                  <p>{{ formatDate(selectedRequest.closed_at) }}</p>
                </section>
              </div>

              <div v-if="isAdmin" class="admin-editor">
                <div class="section-title">
                  <span>Decision</span>
                  <small>Users see this response on their panel</small>
                </div>
                <Select v-model="adminStatus" :options="requestStatusOptions" option-label="label" option-value="value" />
                <Textarea v-model="adminResponse" auto-resize rows="5" placeholder="Write a response, next step, or reason..." />
                <div class="admin-actions">
                  <Button size="small" :loading="saving" @click="saveAdminUpdate">
                    <i class="pi pi-check" />
                    Save Update
                  </Button>
                  <Button
                    v-if="selectedRequest.status !== 'closed'"
                    size="small"
                    severity="secondary"
                    outlined
                    :disabled="saving"
                    @click="closeSelected"
                  >
                    <i class="pi pi-lock" />
                    Close
                  </Button>
                  <Button v-else size="small" severity="secondary" outlined :disabled="saving" @click="reopenSelected">
                    <i class="pi pi-lock-open" />
                    Reopen
                  </Button>
                </div>
              </div>
            </section>

            <section v-else class="detail-panel empty-detail">
              <i class="pi pi-comments" />
              <span>Select a request to see its status and response.</span>
            </section>
          </main>
        </div>
      </div>
    </template>
  </MCard>
</template>

<style scoped>
.feedback-view {
  display: flex;
  min-height: 0;
  flex-direction: column;
  background: #ffffff;
}

.feedback-header,
.feedback-body,
.header-metrics,
.request-row-head,
.request-row-meta,
.section-title,
.detail-header,
.admin-actions,
.composer-actions,
.panel-toolbar {
  display: flex;
  align-items: center;
}

.feedback-header {
  min-height: 58px;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 9px 12px;
}

.feedback-title {
  min-width: 0;
}

.eyebrow {
  color: var(--p-slate-400);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

h2,
h3,
h4 {
  margin: 0;
  color: var(--p-slate-800);
}

h2 {
  font-size: 1.08rem;
}

h3 {
  font-size: 1rem;
}

h4 {
  font-size: 0.78rem;
}

.header-metrics {
  gap: 8px;
}

.header-metrics div {
  display: flex;
  min-width: 64px;
  flex-direction: column;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: var(--p-slate-50);
  padding: 5px 8px;
}

.header-metrics strong {
  color: var(--p-slate-800);
  font-size: 0.92rem;
}

.header-metrics span,
.detail-header small,
.section-title small,
.request-row-meta,
.request-user,
.muted {
  color: var(--p-slate-400);
  font-size: 0.7rem;
}

.icon-btn {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: white;
  color: var(--p-slate-600);
  cursor: pointer;
}

.feedback-body {
  min-height: 0;
  flex: 1;
  align-items: stretch;
}

.request-list-panel {
  display: flex;
  width: 360px;
  min-width: 300px;
  flex-direction: column;
  border-right: 1px solid var(--p-slate-200);
  background: #fbfdff;
}

.panel-toolbar {
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 8px 10px;
  color: var(--p-slate-500);
  font-size: 0.72rem;
  font-weight: 800;
}

.panel-toolbar code {
  overflow: hidden;
  max-width: 220px;
  color: var(--p-slate-700);
  font-family: "JetBrains Mono", monospace;
  font-size: 0.68rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 132px;
  gap: 7px;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 8px;
}

.search-field {
  position: relative;
}

.search-field i {
  position: absolute;
  left: 9px;
  top: 50%;
  z-index: 1;
  color: var(--p-slate-400);
  font-size: 0.72rem;
  transform: translateY(-50%);
}

.search-field :deep(.p-inputtext) {
  width: 100%;
  padding-left: 28px;
}

.filter-row :deep(.p-inputtext),
.filter-row :deep(.p-select),
.composer-grid :deep(.p-inputtext),
.composer-grid :deep(.p-select),
.admin-editor :deep(.p-select) {
  width: 100%;
  font-size: 0.76rem;
}

.request-list {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  padding: 8px;
}

.request-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: white;
  color: inherit;
  cursor: pointer;
  padding: 8px;
  text-align: left;
}

.request-row:hover,
.request-row.active {
  border-color: var(--p-indigo-300);
  background: var(--p-indigo-50);
}

.request-row-head,
.request-row-meta {
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.request-row strong {
  min-width: 0;
  overflow: hidden;
  color: var(--p-slate-750, #334155);
  font-size: 0.78rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.request-user {
  overflow: hidden;
  font-family: "JetBrains Mono", monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.request-workspace {
  display: grid;
  min-width: 0;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(320px, 440px) minmax(0, 1fr);
  gap: 10px;
  overflow: hidden;
  padding: 10px;
}

.composer-panel,
.detail-panel,
.admin-editor {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 9px;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  background: white;
  padding: 10px;
}

.composer-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 132px 112px;
  gap: 7px;
}

.composer-panel :deep(.p-textarea),
.admin-editor :deep(.p-textarea) {
  width: 100%;
  font-size: 0.78rem;
  resize: vertical;
}

.composer-actions,
.admin-actions {
  justify-content: flex-end;
  gap: 7px;
}

.detail-panel {
  overflow-y: auto;
}

.detail-header {
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  border-bottom: 1px solid var(--p-slate-200);
  padding-bottom: 10px;
}

.detail-header > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.detail-content {
  display: grid;
  gap: 9px;
}

.detail-content section {
  border: 1px solid var(--p-slate-100);
  border-radius: 7px;
  background: var(--p-slate-50);
  padding: 10px;
}

.detail-content p {
  margin: 6px 0 0;
  color: var(--p-slate-600);
  font-size: 0.8rem;
  line-height: 1.5;
  white-space: pre-wrap;
}

.admin-editor {
  background: #fbfdff;
}

.section-title {
  justify-content: space-between;
  gap: 8px;
  color: var(--p-slate-700);
  font-size: 0.82rem;
  font-weight: 850;
}

.status-pill {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 0.62rem;
  font-weight: 850;
  white-space: nowrap;
}

.status-pill.large {
  padding: 4px 9px;
  font-size: 0.7rem;
}

.status-new { background: #e0f2fe; color: #0369a1; }
.status-reviewing { background: #ede9fe; color: #6d28d9; }
.status-planned { background: #dbeafe; color: #1d4ed8; }
.status-in_progress { background: #fef3c7; color: #92400e; }
.status-released { background: #dcfce7; color: #166534; }
.status-declined { background: #fee2e2; color: #991b1b; }
.status-closed { background: var(--p-slate-200); color: var(--p-slate-600); }

.setup-state,
.loading-state,
.empty-state,
.empty-detail,
.error-strip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--p-slate-400);
  font-size: 0.8rem;
}

.setup-state {
  flex: 1;
  flex-direction: column;
  padding: 24px;
  text-align: center;
}

.setup-state i,
.empty-detail i {
  color: var(--p-slate-300);
  font-size: 1.8rem;
}

.setup-state strong {
  color: var(--p-slate-700);
}

.loading-state,
.empty-state {
  min-height: 90px;
}

.empty-detail {
  flex-direction: column;
}

.error-strip {
  justify-content: flex-start;
  border-bottom: 1px solid var(--p-red-200);
  background: var(--p-red-50);
  color: var(--p-red-700);
  padding: 8px 10px;
}

@media (max-width: 980px) {
  .feedback-body,
  .request-workspace {
    flex-direction: column;
    display: flex;
  }

  .request-list-panel {
    width: auto;
    max-height: 42%;
    border-right: none;
    border-bottom: 1px solid var(--p-slate-200);
  }

  .composer-grid {
    grid-template-columns: 1fr;
  }
}
</style>
