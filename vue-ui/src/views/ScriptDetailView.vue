<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import DatePicker from "primevue/datepicker";
import InputText from "primevue/inputtext";
import MultiSelect from "primevue/multiselect";
import { useToast } from "primevue/usetoast";
import MCard from "../components/universal/card/MCard.vue";
import FileCodeEditor from "../components/FileCodeEditor.vue";
import FileCabinetPane from "../components/FileCabinetPane.vue";
import DiffViewer from "../components/DiffViewer.vue";
import MContextMenu from "../components/universal/contextMenu/MContextMenu.vue";
import {
  useMContextMenu,
  type ContextMenuItem
} from "../composables/useMContextMenu";
import { callApi, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import {
  clearVersionHistory,
  deleteVersion,
  formatVersionDate,
  getVersionsForFile,
  saveVersion,
  type FileVersion
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

interface DeploymentParameter {
  id: string;
  label: string;
  type: string;
  value: unknown;
  text: unknown;
  originalValue: unknown;
}

interface RecordFieldValue {
  value: unknown;
  text: unknown;
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

interface RelatedFileTab {
  id: number;
  name: string;
  folder: number | null;
  filetype: string;
  filesize?: number;
  url?: string;
  content: string;
  savedContent: string;
  contentType?: string;
  binary?: boolean;
  loading?: boolean;
  error?: string;
}

interface FileSearchResult {
  id: number;
  name: string;
  folder: number | null;
  filetype: string;
  filesize?: number;
  url?: string;
}

const props = defineProps<{ vhOffset: number }>();
const route = useRoute();
const router = useRouter();
const toast = useToast();
const { showContextMenu } = useMContextMenu();

const scriptId = computed(() => Number(route.params.scriptId));
const loading = ref(false);
const saving = ref(false);
const script = ref<ScriptItem | null>(null);
const deployments = ref<DeploymentItem[]>([]);
const code = ref("");
const savedCode = ref("");
const fileId = ref<number | null>(null);
const fileFolderId = ref<number | null>(null);
const fileType = ref("JAVASCRIPT");
const loadError = ref("");
const activeEditorTabId = ref("script");
const relatedFiles = ref<RelatedFileTab[]>([]);
const relatedFilesLoading = ref(false);
const showFilePicker = ref(false);
const filePickerQuery = ref("");
const filePickerResults = ref<FileSearchResult[]>([]);
const filePickerLoading = ref(false);
const filePickerError = ref("");

const versions = ref<FileVersion[]>([]);
const selectedVersion = ref<FileVersion | null>(null);
const showHistory = ref(false);

const logs = ref<LogItem[]>([]);
const logsLoading = ref(false);
const clearingLogs = ref(false);
const runningDeploymentIds = ref<Set<string>>(new Set());
const showDeploymentParameters = ref(false);
const parameterDeployment = ref<DeploymentItem | null>(null);
const deploymentParameters = ref<DeploymentParameter[]>([]);
const deploymentParametersLoading = ref(false);
const deploymentParametersSaving = ref(false);
const deploymentParametersError = ref("");
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
  { id: "EMERGENCY", label: "Emergency" }
];

const SCRIPTABLE_FILE_TYPES = new Set([
  "JAVASCRIPT",
  "TYPESCRIPT",
  "PLAINTEXT",
  "CSV",
  "XMLDOC",
  "HTMLDOC",
  "JSON",
  "STYLESHEET",
  "FREEMARKER",
  "SVGIMAGE",
  "CONFIG"
]);
const emptyIdSet = new Set<number>();

const relatedStorageKey = computed(() => `script-detail-related-files:${scriptId.value}`);

const activeRelatedFile = computed(
  () =>
    relatedFiles.value.find(
      (file) => activeEditorTabId.value === `related-${file.id}`
    ) ?? null
);

const activeFileId = computed(() =>
  activeRelatedFile.value ? activeRelatedFile.value.id : fileId.value
);

const activeFileName = computed(() =>
  activeRelatedFile.value
    ? activeRelatedFile.value.name
    : script.value?.scriptfile || `${script.value?.scriptid || "script"}.js`
);

const activeFileFolderId = computed(() =>
  activeRelatedFile.value ? activeRelatedFile.value.folder : fileFolderId.value
);

const activeFileType = computed(() =>
  activeRelatedFile.value ? activeRelatedFile.value.filetype : fileType.value
);

const activeEditorContent = computed({
  get: () => activeRelatedFile.value?.content ?? code.value,
  set: (value: string) => {
    if (activeRelatedFile.value) {
      activeRelatedFile.value.content = value;
    } else {
      code.value = value;
    }
  }
});

const activeSavedContent = computed(
  () => activeRelatedFile.value?.savedContent ?? savedCode.value
);

const activeEditorKey = computed(
  () =>
    `${activeEditorTabId.value}:${activeFileId.value ?? "none"}:${activeRelatedFile.value?.savedContent.length ?? savedCode.value.length}`
);

const dirty = computed(() => activeEditorContent.value !== activeSavedContent.value);
const isSuiteletScript = computed(() => {
  const type = script.value?.scriptType?.toLowerCase() ?? "";
  return type === "scriptlet" || type.includes("suitelet");
});

const isRunnableScript = computed(() => {
  const type = (script.value?.scriptType ?? "").toLowerCase();
  const compactType = type.replace(/[\s_-]/g, "");
  return (
    compactType.includes("scheduled") ||
    compactType.includes("mapreduce") ||
    compactType.includes("mapreducescript")
  );
});

const selectedSuiteletDeployment = computed(
  () =>
    deployments.value.find(
      (deployment) =>
        deployment.primarykey === selectedSuiteletDeploymentId.value
    ) ??
    deployments.value[0] ??
    null
);

const shouldShowSuiteletPreviewPanel = computed(
  () => isSuiteletScript.value && showSuiteletPreviewPanel.value
);

const deploymentOptions = computed(() =>
  deployments.value.map((deployment) => ({
    id: Number(deployment.primarykey),
    label: `${deployment.scriptid}${deployment.deploymentid ? ` · #${deployment.deploymentid}` : ""}${deployment.recordtype ? ` · ${deployment.recordtype}` : ""}`
  }))
);

const editorTabs = computed(() => [
  {
    id: "script",
    label: script.value?.scriptfile || "Script file",
    subtitle: script.value?.scriptid || "Primary",
    dirty: code.value !== savedCode.value,
    loading: false,
    error: ""
  },
  ...relatedFiles.value.map((file) => ({
    id: `related-${file.id}`,
    label: file.name,
    subtitle: file.folder ? `Folder ${file.folder}` : "Related",
    dirty: file.content !== file.savedContent,
    loading: Boolean(file.loading),
    error: file.error || ""
  }))
]);

const attachedRelatedFileIds = computed(() => {
  const ids = new Set(relatedFiles.value.map((file) => file.id));
  if (fileId.value) ids.add(fileId.value);
  return ids;
});

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

const serializeParameterValue = (value: unknown) => {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value === null || value === undefined) return "";
  return String(value);
};

const dirtyDeploymentParameters = computed(() =>
  deploymentParameters.value.filter(
    (parameter) =>
      serializeParameterValue(parameter.value) !==
      serializeParameterValue(parameter.originalValue)
  )
);

const normalizedParameterType = (parameter: DeploymentParameter) =>
  parameter.type.trim().toLowerCase();

const isCheckboxParameter = (parameter: DeploymentParameter) =>
  normalizedParameterType(parameter) === "checkbox";

const isNumericParameter = (parameter: DeploymentParameter) =>
  ["currency", "float", "integer", "percent", "poscurrency", "rate"].includes(
    normalizedParameterType(parameter)
  );

const isLongTextParameter = (parameter: DeploymentParameter) =>
  ["clob", "help", "html", "inlinehtml", "longtext", "richtext", "textarea"].includes(
    normalizedParameterType(parameter)
  );

const isDateParameter = (parameter: DeploymentParameter) =>
  ["date", "datetime", "datetimetz", "timeofday"].includes(
    normalizedParameterType(parameter)
  );

const isMultiSelectParameter = (parameter: DeploymentParameter) =>
  normalizedParameterType(parameter) === "multiselect";

const parameterInputValue = (parameter: DeploymentParameter) => {
  if (Array.isArray(parameter.value)) return parameter.value.join(", ");
  return parameter.value === null || parameter.value === undefined
    ? ""
    : String(parameter.value);
};

const normalizeLoadedParameterValue = (value: unknown, type: string) => {
  if (type.trim().toLowerCase() !== "checkbox") {
    return Array.isArray(value) ? [...value] : value;
  }
  if (typeof value === "string") {
    return value === "T" || value.toLowerCase() === "true";
  }
  return Boolean(value);
};

const updateParameterTextValue = (
  parameter: DeploymentParameter,
  value: string
) => {
  if (isMultiSelectParameter(parameter)) {
    parameter.value = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return;
  }
  parameter.value = value;
};

const coerceParameterForSubmit = (parameter: DeploymentParameter) => {
  if (isCheckboxParameter(parameter)) return Boolean(parameter.value);
  if (isMultiSelectParameter(parameter)) {
    return Array.isArray(parameter.value) ? parameter.value : [];
  }
  if (isNumericParameter(parameter) && parameter.value !== "") {
    const numericValue = Number(parameter.value);
    return Number.isFinite(numericValue) ? numericValue : parameter.value;
  }
  return parameter.value ?? "";
};

const openDeploymentParameterEditor = async (deployment: DeploymentItem) => {
  parameterDeployment.value = deployment;
  deploymentParameters.value = [];
  deploymentParametersError.value = "";
  showDeploymentParameters.value = true;
  deploymentParametersLoading.value = true;

  try {
    const recordResponse = await callApi(RequestRoutes.LOAD_RECORD, {
      type: "scriptdeployment",
      id: deployment.primarykey
    });
    if (recordResponse.status === "error") {
      throw new Error(String(recordResponse.message));
    }

    const body = (recordResponse.message?.body ?? {}) as Record<
      string,
      RecordFieldValue
    >;
    const parameterEntries = Object.entries(body).filter(([fieldId]) =>
      fieldId.toLowerCase().startsWith("custscript")
    );
    const fieldIds = parameterEntries.map(([fieldId]) => fieldId);

    let metadata: Record<string, { label?: string; type?: string }> = {};
    if (fieldIds.length) {
      const metadataResponse = await callApi(
        RequestRoutes.GET_RECORD_FIELD_TYPES,
        {
          type: "scriptdeployment",
          id: deployment.primarykey,
          fieldIds
        }
      );
      if (metadataResponse.status !== "error") {
        metadata = metadataResponse.message?.fields ?? {};
      }
    }

    deploymentParameters.value = parameterEntries
      .map(([fieldId, field]) => {
        const type = metadata[fieldId]?.type || "";
        const value = normalizeLoadedParameterValue(field.value, type);
        return {
          id: fieldId,
          label: metadata[fieldId]?.label || fieldId,
          type,
          value,
          text: field.text,
          originalValue: Array.isArray(value) ? [...value] : value
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch (err) {
    deploymentParametersError.value =
      err instanceof Error ? err.message : String(err);
  } finally {
    deploymentParametersLoading.value = false;
  }
};

const saveDeploymentParameters = async () => {
  const deployment = parameterDeployment.value;
  if (
    !deployment ||
    deploymentParametersSaving.value ||
    dirtyDeploymentParameters.value.length === 0
  ) {
    return;
  }

  deploymentParametersSaving.value = true;
  deploymentParametersError.value = "";
  try {
    const values = Object.fromEntries(
      dirtyDeploymentParameters.value.map((parameter) => [
        parameter.id,
        coerceParameterForSubmit(parameter)
      ])
    );
    const response = await callApi(RequestRoutes.UPDATE_RECORD_FIELDS, {
      recordType: "scriptdeployment",
      recordId: deployment.primarykey,
      values,
      enableSourcing: true,
      ignoreMandatoryFields: false
    });
    if (response.status === "error") {
      throw new Error(String(response.message));
    }

    for (const parameter of deploymentParameters.value) {
      parameter.originalValue = Array.isArray(parameter.value)
        ? [...parameter.value]
        : parameter.value;
    }
    toast.add({
      severity: "success",
      summary: "Parameters updated",
      detail: `${Object.keys(values).length} parameter${Object.keys(values).length === 1 ? "" : "s"} saved on ${deployment.scriptid}.`,
      life: 3000
    });
    showDeploymentParameters.value = false;
  } catch (err) {
    deploymentParametersError.value =
      err instanceof Error ? err.message : String(err);
  } finally {
    deploymentParametersSaving.value = false;
  }
};

const copyDeploymentValue = async (label: string, value: string) => {
  await navigator.clipboard.writeText(value);
  toast.add({
    severity: "success",
    summary: "Copied",
    detail: `${label} copied to clipboard`,
    life: 1800
  });
};

const deploymentContextMenu: ContextMenuItem[] = [
  {
    label: "Copy deployment script ID",
    icon: "pi pi-copy",
    action: (deployment: DeploymentItem) =>
      void copyDeploymentValue("Deployment script ID", deployment.scriptid)
  },
  {
    label: "Copy deployment internal ID",
    icon: "pi pi-hashtag",
    action: (deployment: DeploymentItem) =>
      void copyDeploymentValue(
        "Deployment internal ID",
        String(deployment.primarykey)
      )
  }
];

const openDeploymentContextMenu = (
  event: MouseEvent,
  deployment: DeploymentItem
) => {
  showContextMenu(event, deployment, deploymentContextMenu);
};

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
};

const normalizeScript = (row: any): ScriptItem => ({
  id: Number(row.id),
  name: String(row.name ?? ""),
  scriptid: String(row.scriptid ?? ""),
  owner: row.owner ? String(row.owner) : undefined,
  scriptfile: row.scriptfile ? String(row.scriptfile) : undefined,
  scriptType: String(row.scripttype ?? row.scriptType ?? "")
});

const loadVersions = async () => {
  versions.value = activeFileId.value
    ? await getVersionsForFile(activeFileId.value)
    : [];
};

const persistRelatedFileRefs = () => {
  const refs = relatedFiles.value.map((file) => ({
    id: file.id,
    name: file.name,
    folder: file.folder,
    filetype: file.filetype,
    filesize: file.filesize,
    url: file.url
  }));
  localStorage.setItem(relatedStorageKey.value, JSON.stringify(refs));
};

const restoreRelatedFileRefs = (): FileSearchResult[] => {
  try {
    const raw = localStorage.getItem(relatedStorageKey.value);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed
          .map(normalizeFileSearchRow)
          .filter((file): file is FileSearchResult => Boolean(file))
      : [];
  } catch {
    return [];
  }
};

const getFileContent = async (file: Pick<FileSearchResult, "url">) => {
  if (!file.url) throw new Error("This file has no accessible URL.");
  const response = await callApi(RequestRoutes.FETCH_FILE_CONTENT, {
    fileUrl: file.url
  });
  const result = response.message ?? response;
  if (result?.error) throw new Error(result.error);
  return result;
};

const updateRelatedFile = (
  fileIdToUpdate: number,
  patch: Partial<RelatedFileTab>
) => {
  relatedFiles.value = relatedFiles.value.map((file) =>
    file.id === fileIdToUpdate ? { ...file, ...patch } : file
  );
};

const refreshActiveVersions = () => {
  void loadVersions().catch((err) => {
    console.warn("[ScriptDetail] Failed to load version history", err);
  });
};

const loadRelatedFile = async (file: FileSearchResult) => {
  const existing = relatedFiles.value.find((item) => item.id === file.id);
  if (existing) {
    activeEditorTabId.value = `related-${existing.id}`;
    refreshActiveVersions();
    return;
  }

  const tab: RelatedFileTab = {
    id: file.id,
    name: file.name,
    folder: file.folder,
    filetype: file.filetype || "JAVASCRIPT",
    filesize: file.filesize,
    url: file.url,
    content: "",
    savedContent: "",
    loading: true
  };
  relatedFiles.value.push(tab);
  activeEditorTabId.value = `related-${tab.id}`;
  try {
    const result = await getFileContent(file);
    const content = String(result?.content ?? "");
    const patch: Partial<RelatedFileTab> = {
      content,
      savedContent: content,
      contentType: result?.contentType,
      loading: false
    };
    if (result?.binary) {
      patch.binary = true;
      patch.error = "Binary files cannot be edited here.";
    }
    updateRelatedFile(tab.id, patch);
  } catch (err) {
    updateRelatedFile(tab.id, {
      error: err instanceof Error ? err.message : String(err),
      loading: false
    });
  } finally {
    persistRelatedFileRefs();
    refreshActiveVersions();
  }
};

const loadPersistedRelatedFiles = async () => {
  const refs = restoreRelatedFileRefs();
  if (refs.length === 0) return;
  relatedFilesLoading.value = true;
  try {
    for (const refItem of refs) {
      await loadRelatedFile(refItem);
    }
    activeEditorTabId.value = "script";
    await loadVersions();
  } finally {
    relatedFilesLoading.value = false;
  }
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
      callApi(RequestRoutes.SCRIPT_DEPLOYMENTS, { scriptId: scriptId.value })
    ]);

    const file = ((fileResponse as ApiResponse).message ?? [])[0];
    code.value = String(file?.scriptFile ?? "");
    savedCode.value = code.value;
    fileId.value = file?.fileId != null ? Number(file.fileId) : null;
    fileFolderId.value =
      file?.fileFolderId != null ? Number(file.fileFolderId) : null;
    fileType.value = String(file?.filetype ?? "JAVASCRIPT");
    deployments.value = (deploymentsResponse as ApiResponse).message ?? [];
    selectedSuiteletDeploymentId.value = deployments.value[0]?.primarykey ?? "";
    if (isSuiteletScript.value && selectedSuiteletDeployment.value) {
      await loadSuiteletPreviewUrl();
    } else {
      suiteletUrl.value = "";
      suiteletUrlError.value = "";
    }
    relatedFiles.value = [];
    activeEditorTabId.value = "script";
    await loadPersistedRelatedFiles();
    await loadVersions();
    await fetchLogs();
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
};

const saveActiveFile = async () => {
  if (!activeFileId.value || !dirty.value || saving.value) return;
  saving.value = true;
  try {
    await saveVersion(
      activeFileId.value,
      activeFileName.value,
      activeSavedContent.value
    );
    const response = await callApi(RequestRoutes.UPDATE_FILE_CONTENT, {
      fileId: activeFileId.value,
      fileContent: activeEditorContent.value,
      fileName: activeFileName.value,
      folderId: activeFileFolderId.value,
      mediaType: activeFileType.value || "JAVASCRIPT"
    });
    const result = response.message ?? response;
    if (result?.isUpdated === false)
      throw new Error("NetSuite returned a save failure.");
    if (activeRelatedFile.value) {
      activeRelatedFile.value.savedContent = activeRelatedFile.value.content;
    } else {
      savedCode.value = code.value;
    }
    selectedVersion.value = null;
    await loadVersions();
    toast.add({
      severity: "success",
      summary: "Saved",
      detail: `${activeFileName.value} saved to NetSuite`,
      life: 2600
    });
  } finally {
    saving.value = false;
  }
};

const saveScript = saveActiveFile;

const restoreVersion = (version: FileVersion) => {
  activeEditorContent.value = version.content;
  selectedVersion.value = null;
};

const selectEditorTab = async (tabId: string) => {
  activeEditorTabId.value = tabId;
  selectedVersion.value = null;
  showHistory.value = false;
  refreshActiveVersions();
};

const closeRelatedFile = async (file: RelatedFileTab) => {
  relatedFiles.value = relatedFiles.value.filter((item) => item.id !== file.id);
  if (activeEditorTabId.value === `related-${file.id}`) {
    activeEditorTabId.value = "script";
    selectedVersion.value = null;
    await loadVersions();
  }
  persistRelatedFileRefs();
};

const closeRelatedFileByTabId = async (tabId: string) => {
  const file = relatedFiles.value.find((item) => `related-${item.id}` === tabId);
  if (file) await closeRelatedFile(file);
};

const normalizeFileSearchRow = (row: any): FileSearchResult | null => {
  if (!row?.id) return null;
  return {
    id: Number(row.id),
    name: String(row.name ?? `File ${row.id}`),
    folder:
      row.folder != null && row.folder !== "" ? Number(row.folder) : null,
    filetype: String(row.filetype ?? row.fileType ?? "JAVASCRIPT"),
    filesize:
      row.filesize != null || row.fileSize != null
        ? Number(row.filesize ?? row.fileSize)
        : undefined,
    url: row.url ? String(row.url) : undefined
  };
};

const searchRelatedFiles = async () => {
  const query = filePickerQuery.value.trim();
  if (!query) return;
  filePickerLoading.value = true;
  filePickerError.value = "";
  try {
    const numericQuery = Number(query);
    const response = await callApi(RequestRoutes.FIND_FILE, {
      id: Number.isFinite(numericQuery) ? numericQuery : undefined,
      name: Number.isFinite(numericQuery) ? undefined : query
    });
    const payload = response.message ?? response;
    const rawFiles: any[] = Array.isArray(payload?.files)
      ? payload.files
      : Array.isArray(payload?.files?.results)
        ? payload.files.results
        : Array.isArray(payload?.results)
          ? payload.results
          : [];
    filePickerResults.value = rawFiles
      .map(normalizeFileSearchRow)
      .filter((file): file is FileSearchResult => Boolean(file));
    if (filePickerResults.value.length === 0) {
      filePickerError.value = payload?.hint || "No matching files found.";
    }
  } catch (err) {
    filePickerError.value = err instanceof Error ? err.message : String(err);
    filePickerResults.value = [];
  } finally {
    filePickerLoading.value = false;
  }
};

const addRelatedFile = async (file: FileSearchResult) => {
  showFilePicker.value = false;
  filePickerQuery.value = "";
  filePickerResults.value = [];
  await loadRelatedFile(file);
};

const addRelatedFileFromCabinet = async (file: {
  id: number;
  name: string;
  filetype: string;
  filesize: number;
  folder: number;
  url?: string;
}) => {
  showFilePicker.value = false;
  await loadRelatedFile({
    id: file.id,
    name: file.name,
    folder: file.folder,
    filetype: file.filetype || "JAVASCRIPT",
    filesize: file.filesize,
    url: file.url
  });
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
  const response = await callApi(RequestRoutes.SCRIPT_URL, {
    scriptId: scriptId.value
  });
  if (response.message) window.open(response.message, "_blank");
};

const openDependencyExplorer = () => {
  void router.push({
    path: "/dependency-explorer",
    query: { scriptId: String(scriptId.value) }
  });
};

const openDeployment = async (deploymentId: string) => {
  const response = await callApi(RequestRoutes.SCRIPT_DEPLOYMENT_URL, {
    deployment: deploymentId
  });
  if (response.message) window.open(response.message, "_blank");
};

const setDeploymentRunning = (deploymentId: string, running: boolean) => {
  const next = new Set(runningDeploymentIds.value);
  if (running) {
    next.add(deploymentId);
  } else {
    next.delete(deploymentId);
  }
  runningDeploymentIds.value = next;
};

const isDeploymentRunning = (deploymentId: string) =>
  runningDeploymentIds.value.has(String(deploymentId));

const runDeployment = async (deployment: DeploymentItem) => {
  const deploymentId = String(deployment.primarykey ?? "");
  if (!script.value || !deploymentId || isDeploymentRunning(deploymentId)) {
    return;
  }

  if (!deployment.isdeployed) {
    toast.add({
      severity: "warn",
      summary: "Deployment is off",
      detail: "Turn the deployment on in NetSuite before running it.",
      life: 3500
    });
    return;
  }

  setDeploymentRunning(deploymentId, true);
  try {
    await callApi(RequestRoutes.EXECUTE_SCRIPT_DEPLOYMENT, {
      scriptId: script.value.scriptid,
      scriptName: script.value.name,
      scriptType: script.value.scriptType,
      scriptInternalId: scriptId.value,
      deploymentScriptId: deployment.scriptid,
      deploymentNumber: deployment.deploymentid,
      status: deployment.status,
      logLevel: deployment.loglevel,
      isDeployed: deployment.isdeployed,
      deploymentRecordId: deploymentId
    });
    toast.add({
      severity: "success",
      summary: "Script started",
      detail: `${deployment.scriptid || script.value.scriptid} was submitted to NetSuite.`,
      life: 3200
    });
    await fetchLogs();
  } catch (err) {
    toast.add({
      severity: "error",
      summary: "Run failed",
      detail: err instanceof Error ? err.message : String(err),
      life: 6500
    });
  } finally {
    setDeploymentRunning(deploymentId, false);
  }
};

const loadSuiteletPreviewUrl = async () => {
  if (
    !isSuiteletScript.value ||
    !script.value?.scriptid ||
    !selectedSuiteletDeployment.value?.scriptid
  ) {
    suiteletUrl.value = "";
    return;
  }

  suiteletUrlLoading.value = true;
  suiteletUrlError.value = "";
  try {
    const response = await callApi(RequestRoutes.SUITELET_URL, {
      script: script.value.scriptid,
      deployment: selectedSuiteletDeployment.value.scriptid,
      iframe: true
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
    scriptSidePanelWidth.value = Math.min(
      760,
      Math.max(320, startWidth + delta)
    );
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
      scriptTypes: []
    });
    const rows = Array.isArray(response.message) ? response.message : [];
    logs.value = rows.map((log: any) => ({
      id: String(log.internalid ?? ""),
      datetime: String(log.datetime ?? ""),
      title: String(log.title ?? ""),
      level: String(log.type ?? "DEBUG").toUpperCase(),
      message: String(log.detail ?? ""),
      deploymentId: String(log["scriptDeployment.internalid"] ?? ""),
      deploymentName: String(log["scriptDeployment.scriptid"] ?? "")
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
      life: 3000
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
      detail:
        "NetSuite did not return a deployment number for one or more deployments.",
      life: 5000
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
        deploymentRecordId: deployment.primarykey
      });
    }
    toast.add({
      severity: "success",
      summary: "Logs cleared",
      detail: `Cleared execution logs for ${scope}.`,
      life: 3000
    });
    await fetchLogs();
  } catch (err) {
    toast.add({
      severity: "error",
      summary: "Clear logs failed",
      detail: err instanceof Error ? err.message : String(err),
      life: 6000
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
          <button
            type="button"
            class="icon-btn"
            title="Back to scripts"
            @click="router.push('/scripts')"
          >
            <i class="pi pi-angle-left" />
          </button>
          <div class="script-heading">
            <strong>{{ script?.name || `Script #${scriptId}` }}</strong>
            <span
              >{{ script?.scriptid }} · {{ script?.scriptType }} ·
              {{ script?.scriptfile || "No file name" }}</span
            >
          </div>
          <div class="header-actions">
            <button
              type="button"
              class="secondary-btn"
              @click="openScriptInNetSuite"
            >
              <i class="pi pi-external-link" />
              <span>Open</span>
            </button>
            <button
              type="button"
              class="secondary-btn"
              :disabled="!script"
              title="Inspect dependencies and change impact"
              @click="openDependencyExplorer"
            >
              <i class="pi pi-share-alt" />
              <span>Impact</span>
            </button>
            <button
              v-if="isSuiteletScript"
              type="button"
              class="secondary-btn"
              :disabled="deployments.length === 0"
              @click="toggleSuiteletPreview"
            >
              <i
                :class="
                  showSuiteletPreviewPanel
                    ? 'pi pi-window-minimize'
                    : 'pi pi-window-maximize'
                "
              />
              <span>{{
                showSuiteletPreviewPanel ? "Hide Preview" : "Show Preview"
              }}</span>
            </button>
            <button
              type="button"
              class="primary-btn"
              :disabled="!dirty || saving || !activeFileId || activeRelatedFile?.binary"
              @click="saveActiveFile"
            >
              <i :class="saving ? 'pi pi-spin pi-spinner' : 'pi pi-save'" />
              <span>{{ saving ? "Saving" : "Save" }}</span>
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
            <div class="editor-tabs">
              <button
                v-for="tab in editorTabs"
                :key="tab.id"
                type="button"
                class="editor-tab"
                :class="{
                  active: activeEditorTabId === tab.id,
                  dirty: tab.dirty,
                  error: tab.error
                }"
                :title="tab.subtitle"
                @click="selectEditorTab(tab.id)"
              >
                <i
                  :class="
                    tab.loading
                      ? 'pi pi-spin pi-spinner'
                      : tab.id === 'script'
                        ? 'pi pi-code'
                        : 'pi pi-file'
                  "
                />
                <span>{{ tab.label }}</span>
                <b v-if="tab.dirty" />
                <button
                  v-if="tab.id !== 'script'"
                  type="button"
                  class="editor-tab-close"
                  title="Remove related file"
                  @click.stop="closeRelatedFileByTabId(tab.id)"
                >
                  <i class="pi pi-times" />
                </button>
              </button>
              <button
                type="button"
                class="editor-tab-add"
                title="Add related file"
                @click="showFilePicker = true"
              >
                <i class="pi pi-plus" />
              </button>
              <span v-if="relatedFilesLoading" class="tabs-loading">
                <i class="pi pi-spin pi-spinner" />
                Loading related files
              </span>
            </div>
            <div class="editor-toolbar">
              <div class="editor-status">
                <span v-if="dirty" class="dirty-dot" />
                <span>{{
                  activeRelatedFile?.binary
                    ? "Read-only binary file"
                    : dirty
                      ? "Unsaved changes"
                      : "Saved"
                }}</span>
              </div>
              <div class="active-file-meta">
                <i class="pi pi-folder" />
                <span>{{ activeFileName }}</span>
              </div>
              <button
                type="button"
                class="secondary-btn"
                :disabled="versions.length === 0"
                @click="showHistory = !showHistory"
              >
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
                  @click="
                    selectedVersion =
                      selectedVersion?.id === version.id ? null : version
                  "
                >
                  <span>{{ formatVersionDate(version.savedAt) }}</span>
                  <small>{{ version.fileName }}</small>
                </button>
              </div>
              <button
                v-if="versions.length"
                type="button"
                class="danger-btn"
                @click="clearHistory"
              >
                Clear History
              </button>
            </div>

            <div v-if="selectedVersion" class="diff-shell">
              <div class="diff-toolbar">
                <span
                  >Comparing
                  {{ formatVersionDate(selectedVersion.savedAt) }} against
                  current editor</span
                >
                <div>
                  <button
                    type="button"
                    class="secondary-btn"
                    @click="restoreVersion(selectedVersion)"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    class="danger-btn"
                    @click="removeVersion(selectedVersion)"
                  >
                    Delete Version
                  </button>
                  <button
                    type="button"
                    class="secondary-btn"
                    @click="selectedVersion = null"
                  >
                    Close
                  </button>
                </div>
              </div>
              <DiffViewer
                :original="selectedVersion.content"
                :modified="activeEditorContent"
                language="javascript"
              />
            </div>
            <div v-else-if="activeRelatedFile?.loading" class="loading-state">
              <i class="pi pi-spin pi-spinner" />
              <span>Loading {{ activeRelatedFile.name }}...</span>
            </div>
            <div v-else-if="activeRelatedFile?.error" class="error-state">
              <i class="pi pi-exclamation-triangle" />
              <span>{{ activeRelatedFile.error }}</span>
            </div>
            <FileCodeEditor
              v-else
              :key="activeEditorKey"
              v-model="activeEditorContent"
              language="javascript"
              :readonly="!activeFileId || activeRelatedFile?.binary"
              @ctrl-s="saveActiveFile"
            />
          </section>

          <div
            class="script-side-resize-handle"
            :class="{
              'script-side-resize-handle--active': isResizingScriptSidePanel
            }"
            @mousedown="startScriptSidePanelResize"
          />

          <aside
            class="script-side"
            :style="{ width: `${scriptSidePanelWidth}px` }"
          >
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
                  :class="{
                    active:
                      isSuiteletScript &&
                      selectedSuiteletDeploymentId === deployment.primarykey
                  }"
                  @click="
                    isSuiteletScript
                      ? selectSuiteletDeployment(deployment)
                      : undefined
                  "
                  @contextmenu.prevent="
                    openDeploymentContextMenu($event, deployment)
                  "
                >
                  <span class="deployment-identity">
                    <strong>{{ deployment.scriptid }}</strong>
                    <small>{{ deployment.recordtype || "All records" }}</small>
                  </span>
                  <span class="deployment-actions">
                    <span
                      :class="
                        deployment.isdeployed ? 'status-on' : 'status-off'
                      "
                    >
                      {{ deployment.isdeployed ? "Deployed" : "Off" }}
                    </span>
                    <button
                      v-if="isRunnableScript"
                      type="button"
                      class="deployment-open-btn deployment-run-btn"
                      title="Run deployment"
                      :disabled="
                        !deployment.isdeployed ||
                        isDeploymentRunning(deployment.primarykey)
                      "
                      @click.stop="runDeployment(deployment)"
                    >
                      <i
                        :class="
                          isDeploymentRunning(deployment.primarykey)
                            ? 'pi pi-spin pi-spinner'
                            : 'pi pi-play'
                        "
                      />
                    </button>
                    <button
                      type="button"
                      class="deployment-open-btn"
                      title="Edit deployment parameters"
                      @click.stop="openDeploymentParameterEditor(deployment)"
                    >
                      <i class="pi pi-sliders-h" />
                    </button>
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
                    :disabled="
                      logsLoading || clearingLogs || deployments.length === 0
                    "
                    title="Clear execution logs"
                    @click="clearExecutionLogs"
                  >
                    <i
                      :class="
                        clearingLogs ? 'pi pi-spin pi-spinner' : 'pi pi-trash'
                      "
                    />
                    <span>Clear</span>
                  </button>
                  <button
                    type="button"
                    class="secondary-btn"
                    :disabled="logsLoading || clearingLogs"
                    @click="fetchLogs"
                  >
                    <i
                      :class="
                        logsLoading ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'
                      "
                    />
                  </button>
                </div>
              </div>
              <div class="log-filters">
                <DatePicker
                  v-model="startDate"
                  showTime
                  hourFormat="24"
                  placeholder="Start"
                />
                <DatePicker
                  v-model="endDate"
                  showTime
                  hourFormat="24"
                  placeholder="End"
                />
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
                <article
                  v-for="log in filteredLogs"
                  v-else
                  :key="log.id"
                  class="log-row"
                >
                  <div class="log-row-head">
                    <strong :class="`level-${log.level.toLowerCase()}`">{{
                      log.level
                    }}</strong>
                    <span>{{ formatDateTime(log.datetime) }}</span>
                  </div>
                  <div class="log-title">
                    {{ log.title || log.deploymentName }}
                  </div>
                  <pre>{{ log.message }}</pre>
                </article>
                <div
                  v-if="!logsLoading && filteredLogs.length === 0"
                  class="empty-state"
                >
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
              :class="{
                'suitelet-preview-resize-handle--active':
                  isResizingSuiteletPanel
              }"
              @mousedown="startSuiteletPanelResize"
            />
            <div class="suitelet-preview-header">
              <i class="pi pi-window-maximize text-sm" />
              <div class="suitelet-preview-title">
                <h4>Suitelet Preview</h4>
                <span>{{
                  selectedSuiteletDeployment?.scriptid ||
                  "No deployment selected"
                }}</span>
              </div>
              <button
                type="button"
                class="suitelet-preview-action"
                title="Refresh preview"
                :disabled="suiteletUrlLoading"
                @click="loadSuiteletPreviewUrl"
              >
                <i
                  :class="
                    suiteletUrlLoading
                      ? 'pi pi-spin pi-spinner'
                      : 'pi pi-refresh'
                  "
                />
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
              <button
                type="button"
                class="suitelet-preview-action"
                title="Close preview"
                @click="showSuiteletPreviewPanel = false"
              >
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

        <div
          v-if="showDeploymentParameters"
          class="modal-backdrop"
          @click.self="showDeploymentParameters = false"
        >
          <section class="deployment-parameters-modal">
            <header class="file-picker-header">
              <div>
                <strong>Deployment Parameters</strong>
                <span>
                  {{ parameterDeployment?.scriptid }}
                  <template v-if="parameterDeployment?.deploymentid">
                    · #{{ parameterDeployment.deploymentid }}
                  </template>
                </span>
              </div>
              <button
                type="button"
                class="icon-btn"
                title="Close"
                :disabled="deploymentParametersSaving"
                @click="showDeploymentParameters = false"
              >
                <i class="pi pi-times" />
              </button>
            </header>

            <div v-if="deploymentParametersLoading" class="loading-state parameter-loading">
              <i class="pi pi-spin pi-spinner" />
              <span>Loading deployment parameters...</span>
            </div>
            <div v-else class="deployment-parameters-body">
              <div v-if="deploymentParametersError" class="error-strip">
                {{ deploymentParametersError }}
              </div>
              <div
                v-if="deploymentParameters.length === 0 && !deploymentParametersError"
                class="empty-state parameter-empty"
              >
                No <code>custscript</code> parameters were found on this deployment.
              </div>
              <div v-else class="deployment-parameter-list">
                <label
                  v-for="parameter in deploymentParameters"
                  :key="parameter.id"
                  class="deployment-parameter-field"
                >
                  <span class="deployment-parameter-label">
                    <strong>{{ parameter.label }}</strong>
                    <code>{{ parameter.id }}</code>
                  </span>
                  <input
                    v-if="isCheckboxParameter(parameter)"
                    v-model="parameter.value"
                    type="checkbox"
                    class="deployment-parameter-checkbox"
                  />
                  <textarea
                    v-else-if="isLongTextParameter(parameter)"
                    :value="parameterInputValue(parameter)"
                    rows="4"
                    @input="
                      updateParameterTextValue(
                        parameter,
                        ($event.target as HTMLTextAreaElement).value
                      )
                    "
                  />
                  <input
                    v-else
                    :value="parameterInputValue(parameter)"
                    :type="isNumericParameter(parameter) ? 'number' : 'text'"
                    :placeholder="
                      isMultiSelectParameter(parameter)
                        ? 'Comma-separated internal IDs'
                        : isDateParameter(parameter)
                          ? 'Date or date/time value'
                          : ''
                    "
                    @input="
                      updateParameterTextValue(
                        parameter,
                        ($event.target as HTMLInputElement).value
                      )
                    "
                  />
                  <small
                    v-if="
                      parameter.text !== null &&
                      parameter.text !== undefined &&
                      String(parameter.text) !== parameterInputValue(parameter)
                    "
                  >
                    Current display value: {{ parameter.text }}
                  </small>
                </label>
              </div>
            </div>

            <footer class="deployment-parameters-footer">
              <span>
                {{ dirtyDeploymentParameters.length }}
                changed
              </span>
              <div>
                <button
                  type="button"
                  class="secondary-btn"
                  :disabled="deploymentParametersSaving"
                  @click="showDeploymentParameters = false"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="primary-btn"
                  :disabled="
                    deploymentParametersSaving ||
                    dirtyDeploymentParameters.length === 0
                  "
                  @click="saveDeploymentParameters"
                >
                  <i
                    :class="
                      deploymentParametersSaving
                        ? 'pi pi-spin pi-spinner'
                        : 'pi pi-save'
                    "
                  />
                  {{ deploymentParametersSaving ? "Saving" : "Save Parameters" }}
                </button>
              </div>
            </footer>
          </section>
        </div>

        <div
          v-if="showFilePicker"
          class="modal-backdrop"
          @click.self="showFilePicker = false"
        >
          <section class="file-picker-modal">
            <header class="file-picker-header">
              <div>
                <strong>Add Related File</strong>
                <span>Browse scriptable and text files in the File Cabinet.</span>
              </div>
              <button
                type="button"
                class="icon-btn"
                title="Close"
                @click="showFilePicker = false"
              >
                <i class="pi pi-times" />
              </button>
            </header>
            <div class="file-picker-pane">
              <FileCabinetPane
                :bookmarked-ids="emptyIdSet"
                current-environment="Script Detail"
                :initial-folder-id="fileFolderId"
                context-picker
                :attached-file-ids="attachedRelatedFileIds"
                :attaching-file-ids="emptyIdSet"
                :allowed-file-types="SCRIPTABLE_FILE_TYPES"
                @add-to-context="addRelatedFileFromCabinet"
              />
            </div>
          </section>
        </div>
        <MContextMenu />
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

.editor-tabs {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 37px;
  border-bottom: 1px solid var(--p-slate-200);
  background: #f6f8fb;
  padding: 6px 8px 0;
  overflow-x: auto;
}

.editor-tab,
.editor-tab-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border: 1px solid transparent;
  background: transparent;
  color: var(--p-slate-500);
  cursor: pointer;
  height: 30px;
  box-sizing: border-box;
}

.editor-tab {
  gap: 6px;
  max-width: 220px;
  border-radius: 6px 6px 0 0;
  padding: 0 8px;
  font-size: 0.74rem;
  font-weight: 750;
  position: relative;
}

.editor-tab:hover {
  background: #eef2f7;
  color: var(--p-slate-700);
}

.editor-tab span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-tab i,
.editor-tab-add i {
  flex-shrink: 0;
  font-size: 0.72rem;
}

.editor-tab.active {
  border-color: var(--p-slate-200);
  border-bottom-color: white;
  background: white;
  color: var(--p-slate-800);
  box-shadow: 0 -1px 0 rgba(15, 23, 42, 0.02);
}

.editor-tab.active::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 1px;
  background: white;
  content: "";
}

.editor-tab.dirty {
  color: #92400e;
}

.editor-tab.error {
  color: var(--p-red-600);
}

.editor-tab b {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #f59e0b;
}

.editor-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--p-slate-300);
  cursor: pointer;
  margin-left: 1px;
}

.editor-tab-close:hover {
  background: var(--p-slate-100);
  color: var(--p-slate-700);
}

.editor-tab-add {
  width: 30px;
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  background: white;
}

.editor-tab-add:hover {
  border-color: var(--p-indigo-200);
  background: var(--p-indigo-50);
  color: var(--p-indigo-700);
}

.tabs-loading,
.active-file-meta {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 6px;
  color: var(--p-slate-400);
  font-size: 0.72rem;
  font-weight: 700;
}

.tabs-loading {
  padding: 0 6px;
}

.active-file-meta {
  flex: 1;
  justify-content: flex-end;
}

.active-file-meta span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  cursor: default;
  padding: 7px 8px;
  text-align: left;
}

.deployment-row.active,
.deployment-row:has(.deployment-open-btn:hover) {
  cursor: pointer;
}

.deployment-row.active {
  border-color: var(--p-indigo-300);
  background: var(--p-indigo-50);
}

.deployment-identity {
  display: flex;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
}

.deployment-identity strong,
.deployment-identity small {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.deployment-actions {
  display: inline-flex;
  min-width: max-content;
  flex-shrink: 0;
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

.deployment-run-btn {
  color: var(--p-emerald-600);
}

.deployment-open-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.deployment-open-btn:disabled:hover {
  border-color: transparent;
  background: transparent;
  color: var(--p-slate-400);
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
  border: 1px solid var(--p-slate-300);
  background: var(--p-button-primary-background);
  color: var(--p-slate-100);
  padding: 6px 10px;
}

.primary-btn:hover:not(:disabled) {
  border-color: var(--p-slate-400);
  background: var(--p-button-primary-hover-background);
  color: var(--p-slate-100);
}

.shortcut-kbd {
  flex-shrink: 0;
  border: 1px solid var(--p-slate-300);
  border-radius: 3px;
  background: var(--p-slate-100);
  color: var(--p-slate-600);
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
.error-strip,
.error-state {
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

.error-state {
  flex: 1;
  color: var(--p-red-600);
  padding: 18px;
  text-align: center;
}

.error-strip {
  min-height: 34px;
  justify-content: flex-start;
  border-bottom: 1px solid var(--p-red-200);
  background: var(--p-red-50);
  color: var(--p-red-700);
  padding: 6px 10px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.42);
  padding: 18px;
}

.file-picker-modal {
  display: flex;
  width: min(1040px, 96vw);
  height: min(760px, 92vh);
  min-height: 520px;
  flex-direction: column;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  background: white;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.28);
  overflow: hidden;
}

.deployment-parameters-modal {
  display: flex;
  width: min(720px, 96vw);
  max-height: min(760px, 92vh);
  min-height: 320px;
  flex-direction: column;
  border: 1px solid var(--p-slate-200);
  border-radius: 10px;
  background: white;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.28);
  overflow: hidden;
}

.deployment-parameters-body {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}

.parameter-loading,
.parameter-empty {
  min-height: 240px;
}

.deployment-parameter-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  padding: 14px;
}

.deployment-parameter-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
}

.deployment-parameter-label {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.deployment-parameter-label strong {
  color: var(--p-slate-700);
  font-size: 0.78rem;
}

.deployment-parameter-label code {
  color: var(--p-slate-400);
  font-size: 0.66rem;
}

.deployment-parameter-field input:not([type="checkbox"]),
.deployment-parameter-field textarea {
  width: 100%;
  border: 1px solid var(--p-slate-300);
  border-radius: 6px;
  background: white;
  color: var(--p-slate-800);
  padding: 7px 8px;
  font: inherit;
  font-size: 0.78rem;
  outline: none;
}

.deployment-parameter-field textarea {
  resize: vertical;
}

.deployment-parameter-field input:focus,
.deployment-parameter-field textarea:focus {
  border-color: var(--p-indigo-400);
  box-shadow: 0 0 0 2px var(--p-indigo-100);
}

.deployment-parameter-checkbox {
  width: 18px;
  height: 18px;
  accent-color: var(--p-indigo-600);
}

.deployment-parameter-field small {
  color: var(--p-slate-400);
  font-size: 0.66rem;
}

.deployment-parameters-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
  padding: 10px 12px;
}

.deployment-parameters-footer > span {
  color: var(--p-slate-500);
  font-size: 0.72rem;
}

.deployment-parameters-footer > div {
  display: flex;
  gap: 8px;
}

.file-picker-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--p-slate-200);
  padding: 12px;
}

.file-picker-header div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.file-picker-header strong {
  color: var(--p-slate-800);
  font-size: 0.92rem;
}

.file-picker-header span {
  color: var(--p-slate-400);
  font-size: 0.74rem;
}

.file-picker-pane {
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.file-picker-pane :deep(.fc-pane-wrapper) {
  height: 100%;
}

.file-picker-pane :deep(.fc-pane-main) {
  height: 100%;
}

.file-picker-pane :deep(.fc-filter-input) {
  max-width: 220px;
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

  .active-file-meta {
    display: none;
  }

  .deployment-parameter-list {
    grid-template-columns: 1fr;
  }
}
</style>
