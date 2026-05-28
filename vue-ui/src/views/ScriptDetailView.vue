<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import DatePicker from "primevue/datepicker";
import InputText from "primevue/inputtext";
import MultiSelect from "primevue/multiselect";
import { useToast } from "primevue/usetoast";
import MCard from "../components/universal/card/MCard.vue";
import FileCodeEditor from "../components/FileCodeEditor.vue";
import DiffViewer from "../components/DiffViewer.vue";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import {
  clearVersionHistory,
  deleteVersion,
  formatVersionDate,
  getVersionsForFile,
  saveVersion,
  type FileVersion,
} from "../utils/fileVersionsDb";

interface ScriptItem {
  id: number;
  name: string;
  scriptid: string;
  owner?: string;
  scriptfile?: string;
  scriptType: string;
}

interface DeploymentItem {
  primarykey: string;
  scriptid: string;
  deploymentid?: string | number;
  recordtype?: string;
  isdeployed?: boolean;
  status?: string;
  loglevel?: string;
}

interface LogItem {
  id: string;
  datetime: string;
  title: string;
  level: string;
  message: string;
  deploymentId: string;
  deploymentName: string;
}

const props = defineProps<{ vhOffset: number }>();
const route = useRoute();
const router = useRouter();
const toast = useToast();

const scriptId = computed(() => Number(route.params.scriptId));
const loading = ref(false);
const saving = ref(false);
const script = ref<ScriptItem | null>(null);
const deployments = ref<DeploymentItem[]>([]);
const code = ref("");
const savedCode = ref("");
const fileId = ref<number | null>(null);
const fileFolderId = ref<number | null>(null);
const loadError = ref("");

const versions = ref<FileVersion[]>([]);
const selectedVersion = ref<FileVersion | null>(null);
const showHistory = ref(false);

const logs = ref<LogItem[]>([]);
const logsLoading = ref(false);
const clearingLogs = ref(false);
const logSearch = ref("");
const selectedDeploymentIds = ref<number[]>([]);
const selectedSuiteletDeploymentId = ref<string>("");
const suiteletUrl = ref("");
const suiteletUrlLoading = ref(false);
const suiteletUrlError = ref("");
const showSuiteletPreviewPanel = ref(true);
const suiteletPanelWidth = ref(520);
const isResizingSuiteletPanel = ref(false);
const scriptSidePanelWidth = ref(420);
const isResizingScriptSidePanel = ref(false);
const selectedLogLevels = ref<string[]>([]);
const startDate = ref<Date | null>(null);
const endDate = ref<Date | null>(null);

const LOG_LEVELS = [
  { id: "DEBUG", label: "Debug" },
  { id: "AUDIT", label: "Audit" },
  { id: "ERROR", label: "Error" },
  { id: "EMERGENCY", label: "Emergency" },
];

const dirty = computed(() => code.value !== savedCode.value);
const isSuiteletScript = computed(() => {
  const type = script.value?.scriptType?.toLowerCase() ?? "";
  return type === "scriptlet" || type.includes("suitelet");
});

const selectedSuiteletDeployment = computed(() =>
  deployments.value.find((deployment) => deployment.primarykey === selectedSuiteletDeploymentId.value) ??
  deployments.value[0] ??
  null
);

const shouldShowSuiteletPreviewPanel = computed(
  () => isSuiteletScript.value && showSuiteletPreviewPanel.value
);

const deploymentOptions = computed(() =>
  deployments.value.map((deployment) => ({
    id: Number(deployment.primarykey),
    label: `${deployment.scriptid}${deployment.deploymentid ? ` · #${deployment.deploymentid}` : ""}${deployment.recordtype ? ` · ${deployment.recordtype}` : ""}`,
  }))
);

const deploymentsTargetedForLogClear = computed(() => {
  if (selectedDeploymentIds.value.length === 0) return deployments.value;
  const selected = new Set(selectedDeploymentIds.value.map(String));
  return deployments.value.filter((deployment) =>
    selected.has(String(deployment.primarykey))
  );
});

const filteredLogs = computed(() => {
  const q = logSearch.value.trim().toLowerCase();
  return logs.value.filter((log) => {
    const matchesLevel =
      selectedLogLevels.value.length === 0 ||
      selectedLogLevels.value.includes(log.level?.toUpperCase());
    const matchesText =
      !q ||
      `${log.title} ${log.message} ${log.deploymentName} ${log.level}`
        .toLowerCase()
        .includes(q);
    return matchesLevel && matchesText;
  });
});

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
};

const normalizeScript = (row: any): ScriptItem => ({
  id: Number(row.id),
  name: String(row.name ?? ""),
  scriptid: String(row.scriptid ?? ""),
  owner: row.owner ? String(row.owner) : undefined,
  scriptfile: row.scriptfile ? String(row.scriptfile) : undefined,
  scriptType: String(row.scripttype ?? row.scriptType ?? ""),
});

const loadVersions = async () => {
  versions.value = fileId.value ? await getVersionsForFile(fileId.value) : [];
};

const loadScript = async () => {
  if (!Number.isFinite(scriptId.value)) return;
  loading.value = true;
  loadError.value = "";
  try {
    const scriptsResponse = await callApi(RequestRoutes.SCRIPTS);
    const scripts = Array.isArray(scriptsResponse.message)
      ? scriptsResponse.message.map(normalizeScript)
      : [];
    script.value = scripts.find((item) => item.id === scriptId.value) ?? null;

    const [fileResponse, deploymentsResponse] = await Promise.all([
      callApi(RequestRoutes.SCRIPT_FILES, { scriptIds: [scriptId.value] }),
      callApi(RequestRoutes.SCRIPT_DEPLOYMENTS, { scriptId: scriptId.value }),
    ]);

    const file = ((fileResponse as ApiResponse).message ?? [])[0];
    code.value = String(file?.scriptFile ?? "");
    savedCode.value = code.value;
    fileId.value = file?.fileId != null ? Number(file.fileId) : null;
    fileFolderId.value = file?.fileFolderId != null ? Number(file.fileFolderId) : null;
    deployments.value = (deploymentsResponse as ApiResponse).message ?? [];
    selectedSuiteletDeploymentId.value = deployments.value[0]?.primarykey ?? "";
    if (isSuiteletScript.value && selectedSuiteletDeployment.value) {
      await loadSuiteletPreviewUrl();
    } else {
      suiteletUrl.value = "";
      suiteletUrlError.value = "";
    }
    await loadVersions();
    await fetchLogs();
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
};

const saveScript = async () => {
  if (!fileId.value || !dirty.value || saving.value) return;
  saving.value = true;
  try {
    await saveVersion(fileId.value, script.value?.scriptfile || script.value?.name || "script.js", savedCode.value);
    const response = await callApi(RequestRoutes.UPDATE_FILE_CONTENT, {
      fileId: fileId.value,
      fileContent: code.value,
      fileName: script.value?.scriptfile || `${script.value?.scriptid || "script"}.js`,
      folderId: fileFolderId.value,
      mediaType: "JAVASCRIPT",
    });
    const result = response.message ?? response;
    if (result?.isUpdated === false) throw new Error("NetSuite returned a save failure.");
    savedCode.value = code.value;
    selectedVersion.value = null;
    await loadVersions();
  } finally {
    saving.value = false;
  }
};

const restoreVersion = (version: FileVersion) => {
  code.value = version.content;
  selectedVersion.value = null;
};

const removeVersion = async (version: FileVersion) => {
  if (!version.id) return;
  await deleteVersion(version.id);
  if (selectedVersion.value?.id === version.id) selectedVersion.value = null;
  await loadVersions();
};

const clearHistory = async () => {
  if (!fileId.value) return;
  await clearVersionHistory(fileId.value);
  selectedVersion.value = null;
  versions.value = [];
};

const openScriptInNetSuite = async () => {
  const response = await callApi(RequestRoutes.SCRIPT_URL, { scriptId: scriptId.value });
  if (response.message) window.open(response.message, "_blank");
};

const openDeployment = async (deploymentId: string) => {
  const response = await callApi(RequestRoutes.SCRIPT_DEPLOYMENT_URL, {
    deployment: deploymentId,
  });
  if (response.message) window.open(response.message, "_blank");
};

const loadSuiteletPreviewUrl = async () => {
  if (!isSuiteletScript.value || !script.value?.scriptid || !selectedSuiteletDeployment.value?.scriptid) {
    suiteletUrl.value = "";
    return;
  }

  suiteletUrlLoading.value = true;
  suiteletUrlError.value = "";
  try {
    const response = await callApi(RequestRoutes.SUITELET_URL, {
      script: script.value.scriptid,
      deployment: selectedSuiteletDeployment.value.scriptid,
      iframe: true,
    });
    suiteletUrl.value = String(response.message ?? "");
  } catch (err) {
    suiteletUrl.value = "";
    suiteletUrlError.value = err instanceof Error ? err.message : String(err);
  } finally {
    suiteletUrlLoading.value = false;
  }
};

const selectSuiteletDeployment = async (deployment: DeploymentItem) => {
  selectedSuiteletDeploymentId.value = deployment.primarykey;
  showSuiteletPreviewPanel.value = true;
  await loadSuiteletPreviewUrl();
};

const openSuiteletPreview = () => {
  showSuiteletPreviewPanel.value = true;
  if (!suiteletUrl.value) void loadSuiteletPreviewUrl();
};

const toggleSuiteletPreview = () => {
  if (showSuiteletPreviewPanel.value) {
    showSuiteletPreviewPanel.value = false;
    return;
  }

  openSuiteletPreview();
};

const openSuiteletInNewTab = () => {
  if (suiteletUrl.value) window.open(suiteletUrl.value, "_blank");
};

const startSuiteletPanelResize = (e: MouseEvent) => {
  e.preventDefault();
  isResizingSuiteletPanel.value = true;
  const startX = e.clientX;
  const startWidth = suiteletPanelWidth.value;
  const onMove = (ev: MouseEvent) => {
    const delta = startX - ev.clientX;
    suiteletPanelWidth.value = Math.min(900, Math.max(320, startWidth + delta));
  };
  const onUp = () => {
    isResizingSuiteletPanel.value = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
};

const startScriptSidePanelResize = (e: MouseEvent) => {
  e.preventDefault();
  isResizingScriptSidePanel.value = true;
  const startX = e.clientX;
  const startWidth = scriptSidePanelWidth.value;
  const onMove = (ev: MouseEvent) => {
    const delta = startX - ev.clientX;
    scriptSidePanelWidth.value = Math.min(760, Math.max(320, startWidth + delta));
  };
  const onUp = () => {
    isResizingScriptSidePanel.value = false;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
};

const fetchLogs = async () => {
  if (!Number.isFinite(scriptId.value)) return;
  logsLoading.value = true;
  try {
    const response = await callApi(RequestRoutes.LOGS, {
      startDate: startDate.value,
      endDate: endDate.value,
      scriptIds: [scriptId.value],
      deploymentIds: selectedDeploymentIds.value,
      scriptTypes: [],
    });
    const rows = Array.isArray(response.message) ? response.message : [];
    logs.value = rows.map((log: any) => ({
      id: String(log.internalid ?? ""),
      datetime: String(log.datetime ?? ""),
      title: String(log.title ?? ""),
      level: String(log.type ?? "DEBUG").toUpperCase(),
      message: String(log.detail ?? ""),
      deploymentId: String(log["scriptDeployment.internalid"] ?? ""),
      deploymentName: String(log["scriptDeployment.scriptid"] ?? ""),
    }));
  } finally {
    logsLoading.value = false;
  }
};

const clearExecutionLogs = async () => {
  if (!Number.isFinite(scriptId.value) || clearingLogs.value) return;
  const targets = deploymentsTargetedForLogClear.value;
  if (targets.length === 0) {
    toast.add({
      severity: "warn",
      summary: "No deployments",
      detail: "There are no deployments available to clear.",
      life: 3000,
    });
    return;
  }

  const missingDeploymentNumbers = targets.filter(
    (deployment) => !deployment.deploymentid
  );
  if (missingDeploymentNumbers.length > 0) {
    toast.add({
      severity: "error",
      summary: "Cannot clear logs",
      detail: "NetSuite did not return a deployment number for one or more deployments.",
      life: 5000,
    });
    return;
  }

  const scope =
    selectedDeploymentIds.value.length > 0
      ? `${targets.length} selected deployment${targets.length === 1 ? "" : "s"}`
      : `all ${targets.length} deployment${targets.length === 1 ? "" : "s"} for this script`;

  clearingLogs.value = true;
  try {
    for (const deployment of targets) {
      await callApi(RequestRoutes.CLEAR_SCRIPT_LOGS, {
        scriptId: scriptId.value,
        deploymentNumber: deployment.deploymentid,
        deploymentRecordId: deployment.primarykey,
      });
    }
    toast.add({
      severity: "success",
      summary: "Logs cleared",
      detail: `Cleared execution logs for ${scope}.`,
      life: 3000,
    });
    await fetchLogs();
  } catch (err) {
    toast.add({
      severity: "error",
      summary: "Clear logs failed",
      detail: err instanceof Error ? err.message : String(err),
      life: 6000,
    });
  } finally {
    clearingLogs.value = false;
  }
};

const setLastHour = () => {
  endDate.value = new Date();
  startDate.value = new Date(Date.now() - 60 * 60 * 1000);
  void fetchLogs();
};

const setToday = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  startDate.value = start;
  endDate.value = new Date();
  void fetchLogs();
};

const showErrors = () => {
  selectedLogLevels.value = ["ERROR", "EMERGENCY"];
};

onMounted(loadScript);
</script>

<template>
  <MCard
    flex
    direction="column"
    autoHeight
    outlined
    elevated
    :style="{ height: `${props.vhOffset}vh` }"
  >
    <template #default="{ contentHeight }">
      <div class="script-detail" :style="{ height: `${contentHeight}px` }">
        <header class="script-detail-header">
          <button type="button" class="icon-btn" title="Back to scripts" @click="router.push('/scripts')">
            <i class="pi pi-angle-left" />
          </button>
          <div class="script-heading">
            <strong>{{ script?.name || `Script #${scriptId}` }}</strong>
            <span>{{ script?.scriptid }} · {{ script?.scriptType }} · {{ script?.scriptfile || 'No file name' }}</span>
          </div>
          <div class="header-actions">
            <button type="button" class="secondary-btn" @click="openScriptInNetSuite">
              <i class="pi pi-external-link" />
              <span>Open</span>
            </button>
            <button
              v-if="isSuiteletScript"
              type="button"
              class="secondary-btn"
              :disabled="deployments.length === 0"
              @click="toggleSuiteletPreview"
            >
              <i :class="showSuiteletPreviewPanel ? 'pi pi-window-minimize' : 'pi pi-window-maximize'" />
              <span>{{ showSuiteletPreviewPanel ? 'Hide Preview' : 'Show Preview' }}</span>
            </button>
            <button type="button" class="primary-btn" :disabled="!dirty || saving || !fileId" @click="saveScript">
              <i :class="saving ? 'pi pi-spin pi-spinner' : 'pi pi-save'" />
              <span>{{ saving ? 'Saving' : 'Save' }}</span>
              <kbd v-if="!saving" class="shortcut-kbd">Ctrl+S</kbd>
            </button>
          </div>
        </header>

        <div v-if="loadError" class="error-strip">{{ loadError }}</div>
        <div v-if="loading" class="loading-state">
          <i class="pi pi-spin pi-spinner" />
          <span>Loading script...</span>
        </div>

        <div v-else class="script-detail-body">
          <section class="editor-column">
            <div class="editor-toolbar">
              <div class="editor-status">
                <span v-if="dirty" class="dirty-dot" />
                <span>{{ dirty ? 'Unsaved changes' : 'Saved' }}</span>
              </div>
              <button type="button" class="secondary-btn" :disabled="versions.length === 0" @click="showHistory = !showHistory">
                <i class="pi pi-history" />
                <span>History {{ versions.length }}</span>
              </button>
            </div>

            <div v-if="showHistory" class="history-panel">
              <div class="history-list">
                <button
                  v-for="version in versions"
                  :key="version.id"
                  type="button"
                  :class="{ active: selectedVersion?.id === version.id }"
                  @click="selectedVersion = selectedVersion?.id === version.id ? null : version"
                >
                  <span>{{ formatVersionDate(version.savedAt) }}</span>
                  <small>{{ version.fileName }}</small>
                </button>
              </div>
              <button v-if="versions.length" type="button" class="danger-btn" @click="clearHistory">
                Clear History
              </button>
            </div>

            <div v-if="selectedVersion" class="diff-shell">
              <div class="diff-toolbar">
                <span>Comparing {{ formatVersionDate(selectedVersion.savedAt) }} against current editor</span>
                <div>
                  <button type="button" class="secondary-btn" @click="restoreVersion(selectedVersion)">Restore</button>
                  <button type="button" class="danger-btn" @click="removeVersion(selectedVersion)">Delete Version</button>
                  <button type="button" class="secondary-btn" @click="selectedVersion = null">Close</button>
                </div>
              </div>
              <DiffViewer :original="selectedVersion.content" :modified="code" language="javascript" />
            </div>
            <FileCodeEditor
              v-else
              v-model="code"
              language="javascript"
              :readonly="!fileId"
              @ctrl-s="saveScript"
            />
          </section>

          <div
            class="script-side-resize-handle"
            :class="{ 'script-side-resize-handle--active': isResizingScriptSidePanel }"
            @mousedown="startScriptSidePanelResize"
          />

          <aside class="script-side" :style="{ width: `${scriptSidePanelWidth}px` }">
            <div
              v-if="isResizingScriptSidePanel"
              class="script-side-drag-shield"
            />
            <section class="side-section">
              <div class="section-title">
                <span>Deployments</span>
                <strong>{{ deployments.length }}</strong>
              </div>
              <div class="deployment-list">
                <button
                  v-for="deployment in deployments"
                  :key="deployment.primarykey"
                  type="button"
                  class="deployment-row"
                  :class="{ active: isSuiteletScript && selectedSuiteletDeploymentId === deployment.primarykey }"
                  @click="isSuiteletScript ? selectSuiteletDeployment(deployment) : openDeployment(deployment.primarykey)"
                >
                  <span>
                    <strong>{{ deployment.scriptid }}</strong>
                    <small>{{ deployment.recordtype || 'All records' }}</small>
                  </span>
                  <span class="deployment-actions">
                    <span :class="deployment.isdeployed ? 'status-on' : 'status-off'">
                      {{ deployment.isdeployed ? 'Deployed' : 'Off' }}
                    </span>
                    <button
                      type="button"
                      class="deployment-open-btn"
                      title="Open deployment record"
                      @click.stop="openDeployment(deployment.primarykey)"
                    >
                      <i class="pi pi-external-link" />
                    </button>
                  </span>
                </button>
              </div>
            </section>

            <section class="side-section side-section--logs">
              <div class="section-title">
                <span>Execution Logs</span>
                <div class="section-actions">
                  <button
                    type="button"
                    class="danger-btn"
                    :disabled="logsLoading || clearingLogs || deployments.length === 0"
                    title="Clear execution logs"
                    @click="clearExecutionLogs"
                  >
                    <i :class="clearingLogs ? 'pi pi-spin pi-spinner' : 'pi pi-trash'" />
                    <span>Clear</span>
                  </button>
                  <button type="button" class="secondary-btn" :disabled="logsLoading || clearingLogs" @click="fetchLogs">
                    <i :class="logsLoading ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" />
                  </button>
                </div>
              </div>
              <div class="log-filters">
                <DatePicker v-model="startDate" showTime hourFormat="24" placeholder="Start" />
                <DatePicker v-model="endDate" showTime hourFormat="24" placeholder="End" />
                <MultiSelect
                  v-model="selectedDeploymentIds"
                  :options="deploymentOptions"
                  option-label="label"
                  option-value="id"
                  placeholder="Deployments"
                  display="chip"
                />
                <MultiSelect
                  v-model="selectedLogLevels"
                  :options="LOG_LEVELS"
                  option-label="label"
                  option-value="id"
                  placeholder="Levels"
                  display="chip"
                />
                <InputText v-model="logSearch" placeholder="Filter logs..." />
                <div class="quick-filter-row">
                  <button type="button" @click="setLastHour">Last Hour</button>
                  <button type="button" @click="setToday">Today</button>
                  <button type="button" @click="showErrors">Errors</button>
                </div>
              </div>
              <div class="log-list">
                <div v-if="logsLoading" class="loading-state compact">
                  <i class="pi pi-spin pi-spinner" />
                  <span>Fetching logs...</span>
                </div>
                <article v-for="log in filteredLogs" v-else :key="log.id" class="log-row">
                  <div class="log-row-head">
                    <strong :class="`level-${log.level.toLowerCase()}`">{{ log.level }}</strong>
                    <span>{{ formatDateTime(log.datetime) }}</span>
                  </div>
                  <div class="log-title">{{ log.title || log.deploymentName }}</div>
                  <pre>{{ log.message }}</pre>
                </article>
                <div v-if="!logsLoading && filteredLogs.length === 0" class="empty-state">
                  No logs match the current filters.
                </div>
              </div>
            </section>
          </aside>

          <aside
            v-if="shouldShowSuiteletPreviewPanel"
            class="suitelet-preview-panel"
            :style="{ width: `${suiteletPanelWidth}px` }"
          >
            <div
              class="suitelet-preview-resize-handle"
              :class="{ 'suitelet-preview-resize-handle--active': isResizingSuiteletPanel }"
              @mousedown="startSuiteletPanelResize"
            />
            <div class="suitelet-preview-header">
              <i class="pi pi-window-maximize text-sm" />
              <div class="suitelet-preview-title">
                <h4>Suitelet Preview</h4>
                <span>{{ selectedSuiteletDeployment?.scriptid || 'No deployment selected' }}</span>
              </div>
              <button
                type="button"
                class="suitelet-preview-action"
                title="Refresh preview"
                :disabled="suiteletUrlLoading"
                @click="loadSuiteletPreviewUrl"
              >
                <i :class="suiteletUrlLoading ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'" />
              </button>
              <button
                type="button"
                class="suitelet-preview-action"
                title="Open Suitelet in new tab"
                :disabled="!suiteletUrl"
                @click="openSuiteletInNewTab"
              >
                <i class="pi pi-external-link" />
              </button>
              <button type="button" class="suitelet-preview-action" title="Close preview" @click="showSuiteletPreviewPanel = false">
                <i class="pi pi-times" />
              </button>
            </div>
            <div class="suitelet-preview-body">
              <div
                v-if="isResizingSuiteletPanel"
                class="suitelet-preview-drag-shield"
              />
              <div v-if="suiteletUrlLoading" class="loading-state compact">
                <i class="pi pi-spin pi-spinner" />
                <span>Loading Suitelet...</span>
              </div>
              <div v-else-if="suiteletUrlError" class="suitelet-preview-empty">
                <i class="pi pi-exclamation-triangle" />
                <span>{{ suiteletUrlError }}</span>
              </div>
              <iframe
                v-else-if="suiteletUrl"
                :key="suiteletUrl"
                :src="suiteletUrl"
                class="suitelet-preview-frame"
                title="Suitelet Preview"
              />
              <div v-else class="suitelet-preview-empty">
                <i class="pi pi-window-maximize" />
                <span>Select a deployment to preview.</span>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </template>
  </MCard>
</template>

<style scoped>
.script-detail {
  display: flex;
  min-height: 0;
  flex-direction: column;
  background: #ffffff;
}

.script-detail-header,
.editor-toolbar,
.diff-toolbar,
.section-title,
.section-actions,
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.script-detail-header {
  min-height: 54px;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 8px 12px;
}

.script-heading {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.script-heading strong,
.script-heading span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.script-heading span,
.section-title strong,
.deployment-row small,
.log-row-head span {
  color: var(--p-slate-400);
  font-size: 0.72rem;
}

.script-detail-body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.editor-column,
.script-side,
.side-section,
.side-section--logs {
  display: flex;
  min-height: 0;
  flex-direction: column;
}

.editor-column {
  flex: 1;
  min-width: 0;
}

.editor-toolbar {
  justify-content: space-between;
  min-height: 42px;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 6px 10px;
}

.editor-status {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--p-slate-500);
  font-size: 0.76rem;
  font-weight: 700;
}

.dirty-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f59e0b;
}

.history-panel {
  border-bottom: 1px solid var(--p-slate-200);
  background: #f8fafc;
  padding: 8px;
}

.history-list {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 6px;
}

.history-list button {
  display: flex;
  min-width: 140px;
  flex-direction: column;
  gap: 2px;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: white;
  color: var(--p-slate-600);
  cursor: pointer;
  padding: 6px 8px;
  text-align: left;
}

.history-list button.active {
  border-color: #c4b5fd;
  background: #f5f3ff;
}

.diff-shell {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.diff-toolbar {
  justify-content: space-between;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 6px 10px;
  color: var(--p-slate-500);
  font-size: 0.75rem;
}

.script-side {
  position: relative;
  flex: 0 0 auto;
  min-width: 320px;
  max-width: 760px;
  background: #fbfdff;
  overflow: hidden;
}

.script-side-resize-handle {
  flex: 0 0 5px;
  cursor: col-resize;
  border-left: 1px solid var(--p-slate-200);
  border-right: 1px solid var(--p-slate-200);
  background: #f8fafc;
  transition: background 0.15s;
}

.script-side-resize-handle:hover,
.script-side-resize-handle--active {
  background: var(--p-blue-200);
}

.script-side-drag-shield {
  position: fixed;
  inset: 0;
  z-index: 30;
  cursor: col-resize;
  background: transparent;
}

.side-section {
  border-bottom: 1px solid var(--p-slate-200);
  padding: 10px;
  gap: 8px;
}

.side-section--logs {
  flex: 1;
}

.section-title {
  justify-content: space-between;
  color: var(--p-slate-700);
  font-size: 0.8rem;
  font-weight: 800;
}

.section-actions {
  gap: 6px;
  flex-shrink: 0;
}

.deployment-list,
.log-list {
  display: flex;
  min-height: 0;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}

.deployment-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: white;
  color: var(--p-slate-700);
  cursor: pointer;
  padding: 7px 8px;
  text-align: left;
}

.deployment-row.active {
  border-color: var(--p-indigo-300);
  background: var(--p-indigo-50);
}

.deployment-row span:first-child {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.deployment-actions {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.deployment-open-btn,
.suitelet-preview-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--p-slate-400);
  cursor: pointer;
}

.deployment-open-btn {
  width: 24px;
  height: 24px;
}

.deployment-open-btn:hover,
.suitelet-preview-action:hover:not(:disabled) {
  border-color: var(--p-slate-200);
  background: white;
  color: var(--p-slate-700);
}

.deployment-open-btn i,
.suitelet-preview-action i {
  font-size: 0.72rem;
}

.status-on,
.status-off {
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 0.65rem;
  font-weight: 800;
}

.status-on {
  background: #dcfce7;
  color: #166534;
}

.status-off {
  background: #fee2e2;
  color: #991b1b;
}

.suitelet-preview-panel {
  position: relative;
  display: flex;
  min-width: 320px;
  max-width: 900px;
  flex-shrink: 0;
  flex-direction: column;
  border-left: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  overflow: hidden;
}

.suitelet-preview-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 10;
  width: 5px;
  cursor: col-resize;
  transition: background 0.15s;
}

.suitelet-preview-resize-handle:hover,
.suitelet-preview-resize-handle--active {
  background: var(--p-blue-200);
}

.suitelet-preview-header {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 9px 10px 9px 13px;
}

.suitelet-preview-title {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.suitelet-preview-title h4 {
  margin: 0;
  color: var(--p-slate-800);
  font-size: 0.8rem;
  font-weight: 800;
}

.suitelet-preview-title span {
  overflow: hidden;
  color: var(--p-slate-400);
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suitelet-preview-action {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

.suitelet-preview-action:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.suitelet-preview-body {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  background: white;
}

.suitelet-preview-drag-shield {
  position: absolute;
  inset: 0;
  z-index: 9;
  cursor: col-resize;
  background: transparent;
}

.suitelet-preview-frame {
  width: 100%;
  height: 100%;
  flex: 1;
  border: none;
  background: white;
}

.suitelet-preview-empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: var(--p-slate-400);
  font-size: 0.78rem;
  text-align: center;
}

.log-filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.log-filters :deep(.p-datepicker),
.log-filters :deep(.p-multiselect),
.log-filters :deep(.p-inputtext) {
  width: 100%;
  font-size: 0.76rem;
}

.quick-filter-row {
  display: flex;
  grid-column: 1 / -1;
  gap: 6px;
}

.quick-filter-row button,
.secondary-btn,
.primary-btn,
.danger-btn,
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 7px;
  cursor: pointer;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 750;
}

.quick-filter-row button,
.secondary-btn,
.icon-btn {
  border: 1px solid var(--p-slate-200);
  background: white;
  color: var(--p-slate-600);
  min-height: 30px;
  padding: 5px 9px;
}

.primary-btn {
  min-height: 32px;
  border: 1px solid var(--p-slate-800);
  background: var(--p-slate-800);
  color: white;
  padding: 6px 10px;
}

.shortcut-kbd {
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.85);
  font-family: "JetBrains Mono", monospace;
  font-size: 0.58rem;
  line-height: 1;
  padding: 2px 4px;
}

.danger-btn {
  min-height: 30px;
  border: 1px solid var(--p-red-200);
  background: var(--p-red-50);
  color: var(--p-red-600);
  padding: 5px 9px;
}

.primary-btn:disabled,
.secondary-btn:disabled,
.danger-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.log-row {
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: white;
  padding: 8px;
}

.log-row-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.log-row-head strong {
  font-size: 0.68rem;
}

.level-error,
.level-emergency {
  color: #dc2626;
}

.level-audit {
  color: #0f766e;
}

.level-debug {
  color: #2563eb;
}

.log-title {
  color: var(--p-slate-700);
  font-size: 0.76rem;
  font-weight: 750;
  margin-top: 4px;
}

.log-row pre {
  margin: 5px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--p-slate-600);
  font-family: "JetBrains Mono", monospace;
  font-size: 0.68rem;
}

.loading-state,
.empty-state,
.error-strip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--p-slate-400);
  min-height: 120px;
}

.loading-state.compact {
  min-height: 80px;
}

.error-strip {
  min-height: 34px;
  justify-content: flex-start;
  border-bottom: 1px solid var(--p-red-200);
  background: var(--p-red-50);
  color: var(--p-red-700);
  padding: 6px 10px;
}

@media (max-width: 980px) {
  .script-detail-body {
    flex-direction: column;
  }

  .script-side,
  .script-side-resize-handle,
  .suitelet-preview-panel {
    display: none;
  }
}
</style>
