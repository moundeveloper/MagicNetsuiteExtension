<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Button } from "primevue";
import { useToast } from "primevue/usetoast";
import { strFromU8, unzipSync } from "fflate";
import MonacoCodeEditor from "../components/MonacoCodeEditor.vue";
import MLoader from "../components/universal/patterns/MLoader.vue";
import {
  fetchBundleSdfArchive,
  fetchBundleSdfFileState,
  type Bundle,
  type BundleSdfFileState,
} from "../utils/bundleTools";

defineProps<{ vhOffset: number }>();

interface ProjectEntry {
  path: string;
  name: string;
  parentPath: string;
  directory: boolean;
  bytes: Uint8Array | null;
  children: ProjectEntry[];
}

interface TreeRow {
  entry: ProjectEntry;
  depth: number;
}

const route = useRoute();
const router = useRouter();
const toast = useToast();
const bundle = ref<Bundle | null>(null);
const fileState = ref<BundleSdfFileState | null>(null);
const roots = ref<ProjectEntry[]>([]);
const selected = ref<ProjectEntry | null>(null);
const expanded = ref(new Set<string>());
const loading = ref(true);
const errorMessage = ref("");
const filter = ref("");
const previewUrl = ref<string | null>(null);

const normalizePath = (path: string) =>
  path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

const baseName = (path: string) => path.split("/").pop() || path;
const parentPath = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

const sortEntries = (entries: ProjectEntry[]) => {
  entries.sort((a, b) =>
    a.directory === b.directory
      ? a.name.localeCompare(b.name, undefined, { numeric: true })
      : a.directory ? -1 : 1
  );
  entries.forEach((entry) => sortEntries(entry.children));
};

const buildTree = (archive: Record<string, Uint8Array>) => {
  const entries = new Map<string, ProjectEntry>();
  const ensureDirectory = (path: string): ProjectEntry | null => {
    if (!path) return null;
    const existing = entries.get(path);
    if (existing) return existing;
    const parent = parentPath(path);
    ensureDirectory(parent);
    const entry: ProjectEntry = {
      path,
      name: baseName(path),
      parentPath: parent,
      directory: true,
      bytes: null,
      children: [],
    };
    entries.set(path, entry);
    return entry;
  };

  for (const [rawPath, bytes] of Object.entries(archive)) {
    const path = normalizePath(rawPath);
    if (!path) continue;
    const explicitDirectory = rawPath.endsWith("/");
    ensureDirectory(parentPath(path));
    const current = entries.get(path);
    if (current) {
      if (!explicitDirectory) {
        current.directory = false;
        current.bytes = bytes;
      }
      continue;
    }
    entries.set(path, {
      path,
      name: baseName(path),
      parentPath: parentPath(path),
      directory: explicitDirectory,
      bytes: explicitDirectory ? null : bytes,
      children: [],
    });
  }

  const treeRoots: ProjectEntry[] = [];
  entries.forEach((entry) => {
    const parent = entry.parentPath ? entries.get(entry.parentPath) : null;
    (parent?.children ?? treeRoots).push(entry);
  });
  sortEntries(treeRoots);
  return treeRoots;
};

const allEntries = computed(() => {
  const result: ProjectEntry[] = [];
  const walk = (items: ProjectEntry[]) => items.forEach((item) => {
    result.push(item);
    walk(item.children);
  });
  walk(roots.value);
  return result;
});

const fileCount = computed(() => allEntries.value.filter((entry) => !entry.directory).length);
const folderCount = computed(() => allEntries.value.filter((entry) => entry.directory).length);

const visibleRows = computed<TreeRow[]>(() => {
  const result: TreeRow[] = [];
  const query = filter.value.trim().toLowerCase();
  if (query) {
    allEntries.value
      .filter((entry) => entry.path.toLowerCase().includes(query))
      .forEach((entry) => result.push({ entry, depth: entry.path.split("/").length - 1 }));
    return result;
  }
  const walk = (items: ProjectEntry[], depth: number) => items.forEach((entry) => {
    result.push({ entry, depth });
    if (entry.directory && expanded.value.has(entry.path)) walk(entry.children, depth + 1);
  });
  walk(roots.value, 0);
  return result;
});

const textContentFor = (entry: ProjectEntry | null) => {
  if (!entry?.bytes || !isTextEntry(entry)) return "";
  try {
    return strFromU8(entry.bytes);
  } catch {
    return new TextDecoder().decode(entry.bytes);
  }
};

const selectedContent = computed(() => textContentFor(selected.value));

const selectedSize = computed(() => selected.value?.bytes?.byteLength ?? 0);

const textExtensions = new Set([
  "xml", "js", "ts", "json", "html", "htm", "css", "scss", "txt", "md",
  "csv", "ftl", "properties", "yml", "yaml", "sql", "sh", "bat", "ps1",
  "project", "manifest", "lock", "gitignore",
]);

function extension(entry: ProjectEntry) {
  const dot = entry.name.lastIndexOf(".");
  return dot >= 0 ? entry.name.slice(dot + 1).toLowerCase() : entry.name.toLowerCase();
}

function isTextEntry(entry: ProjectEntry) {
  if (!entry.bytes || entry.directory) return false;
  if (textExtensions.has(extension(entry))) return true;
  return !entry.bytes.subarray(0, 4096).some((byte) => byte === 0);
}

const editorLanguage = computed(() => {
  const ext = selected.value ? extension(selected.value) : "plaintext";
  if (["js", "cjs", "mjs"].includes(ext)) return "javascript";
  if (["ts", "tsx"].includes(ext)) return "typescript";
  if (["json", "project"].includes(ext)) return "json";
  if (["xml", "ftl", "html", "htm"].includes(ext)) return "xml";
  if (ext === "css" || ext === "scss") return "css";
  if (ext === "sql") return "sql";
  if (ext === "md") return "markdown";
  if (["yml", "yaml"].includes(ext)) return "yaml";
  return "plaintext";
});

const isImage = computed(() => selected.value && ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension(selected.value)));
const isPdf = computed(() => selected.value && extension(selected.value) === "pdf");

const mimeForSelected = () => {
  const ext = selected.value ? extension(selected.value) : "";
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf" } as Record<string, string>)[ext] || "application/octet-stream";
};

watch(selected, (entry) => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = null;
  if (entry?.bytes && (isImage.value || isPdf.value)) {
    const previewBytes = new Uint8Array(entry.bytes).buffer as ArrayBuffer;
    previewUrl.value = URL.createObjectURL(new Blob([previewBytes], { type: mimeForSelected() }));
  }
});

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});

const selectEntry = (entry: ProjectEntry) => {
  if (entry.directory) {
    const next = new Set(expanded.value);
    next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path);
    expanded.value = next;
  } else {
    selected.value = entry;
  }
};

const iconFor = (entry: ProjectEntry) => {
  if (entry.directory) return expanded.value.has(entry.path) ? "pi pi-folder-open" : "pi pi-folder";
  const ext = extension(entry);
  if (["js", "ts", "json"].includes(ext)) return "pi pi-code";
  if (["xml", "ftl", "html"].includes(ext)) return "pi pi-file-edit";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return "pi pi-image";
  return "pi pi-file";
};

const formatBytes = (bytes: number | null) => {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const copyFile = async (entry: ProjectEntry | null = selected.value) => {
  if (!entry || !isTextEntry(entry)) return;
  try {
    await navigator.clipboard.writeText(textContentFor(entry));
    toast.add({
      severity: "success",
      summary: "File copied",
      detail: `${entry.name} copied to the clipboard.`,
      life: 2200,
    });
  } catch (error: any) {
    toast.add({
      severity: "error",
      summary: "Copy failed",
      detail: String(error?.message ?? error),
      life: 3500,
    });
  }
};

const downloadFile = (entry: ProjectEntry | null = selected.value) => {
  if (!entry?.bytes) return;
  const bytes = new Uint8Array(entry.bytes).buffer as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeForSelected() }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = entry.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const navigateBack = () => {
  if (!bundle.value) return router.push("/bundles");
  router.push({ path: `/bundles/${bundle.value.bundleId}`, query: { data: JSON.stringify(bundle.value) } });
};

const loadProject = async () => {
  loading.value = true;
  errorMessage.value = "";
  try {
    if (route.query.data) bundle.value = JSON.parse(String(route.query.data));
    const bundleId = String(route.params.bundleId || bundle.value?.bundleId || "");
    if (!bundleId) throw new Error("Missing bundle ID.");
    if (!bundle.value || bundle.value.type !== "created") {
      throw new Error("SDF projects are available only for created bundles.");
    }
    fileState.value = await fetchBundleSdfFileState(bundleId);
    if (!fileState.value.exists) throw new Error(`No sdf_conversion_${bundleId}.zip file was found.`);
    const bytes = await fetchBundleSdfArchive(fileState.value);
    roots.value = buildTree(unzipSync(bytes));
    expanded.value = new Set(allEntries.value.filter((entry) => entry.directory).map((entry) => entry.path));
    selected.value = allEntries.value.find((entry) => !entry.directory) ?? null;
  } catch (error: any) {
    errorMessage.value = String(error?.message ?? error);
  } finally {
    loading.value = false;
  }
};

onMounted(loadProject);
</script>

<template>
  <section class="sdf-workspace" :style="{ height: `${vhOffset}vh` }">
    <header class="workspace-header">
      <div class="header-identity">
        <Button icon="pi pi-arrow-left" text rounded title="Back to bundle" @click="navigateBack" />
        <span class="project-icon"><i class="pi pi-box"></i></span>
        <div class="header-copy">
          <strong>{{ bundle?.name || `Bundle ${route.params.bundleId}` }}</strong>
          <span>{{ fileState?.fileName || `sdf_conversion_${route.params.bundleId}.zip` }}</span>
        </div>
      </div>
      <div class="header-meta">
        <span><i class="pi pi-folder"></i>{{ folderCount }} folders</span>
        <span><i class="pi pi-file"></i>{{ fileCount }} files</span>
        <span v-if="fileState?.lastModified"><i class="pi pi-clock"></i>{{ fileState.lastModified }}</span>
        <Button icon="pi pi-refresh" size="small" outlined label="Reload archive" :loading="loading" @click="loadProject" />
      </div>
    </header>

    <div v-if="loading" class="workspace-state"><MLoader text="Unpacking SDF project…" /></div>
    <div v-else-if="errorMessage" class="workspace-state error-state">
      <i class="pi pi-exclamation-triangle"></i>
      <strong>Could not open the SDF project</strong>
      <span>{{ errorMessage }}</span>
      <Button size="small" label="Try again" @click="loadProject" />
    </div>

    <div v-else class="workspace-body">
      <aside class="project-explorer">
        <div class="explorer-title">
          <span>Project Explorer</span>
          <span class="archive-size">{{ formatBytes(fileState?.fileSize ?? null) }}</span>
        </div>
        <label class="tree-search">
          <i class="pi pi-search"></i>
          <input v-model="filter" type="search" placeholder="Filter project files" />
          <button v-if="filter" title="Clear filter" @click="filter = ''"><i class="pi pi-times"></i></button>
        </label>
        <div class="tree-scroll" role="tree" aria-label="SDF project files">
          <button
            v-for="row in visibleRows"
            :key="row.entry.path"
            class="tree-row"
            :class="{ selected: selected?.path === row.entry.path }"
            :style="{ paddingLeft: `${8 + row.depth * 16}px` }"
            :title="row.entry.path"
            @click="selectEntry(row.entry)"
          >
            <i v-if="row.entry.directory" :class="expanded.has(row.entry.path) ? 'pi pi-angle-down' : 'pi pi-angle-right'" class="tree-caret"></i>
            <span v-else class="tree-caret"></span>
            <i :class="iconFor(row.entry)" class="entry-icon"></i>
            <span class="entry-name">{{ row.entry.name }}</span>
            <span v-if="!row.entry.directory" class="tree-row-actions">
              <button
                type="button"
                title="Copy file content"
                :disabled="!isTextEntry(row.entry)"
                @click.stop="copyFile(row.entry)"
              ><i class="pi pi-copy"></i></button>
              <button
                type="button"
                title="Download file"
                @click.stop="downloadFile(row.entry)"
              ><i class="pi pi-download"></i></button>
            </span>
          </button>
          <p v-if="visibleRows.length === 0" class="empty-filter">No matching project files.</p>
        </div>
      </aside>

      <main class="file-preview">
        <template v-if="selected">
          <div class="file-toolbar">
            <div class="file-location" :title="selected.path">
              <i :class="iconFor(selected)"></i>
              <span>{{ selected.path }}</span>
            </div>
            <div class="file-actions">
              <span class="file-size">{{ formatBytes(selectedSize) }}</span>
              <Button
                icon="pi pi-copy"
                size="small"
                text
                label="Copy"
                title="Copy file content"
                :disabled="!isTextEntry(selected)"
                @click="copyFile()"
              />
              <Button
                icon="pi pi-download"
                size="small"
                text
                label="Download"
                title="Download this unpacked file"
                @click="downloadFile()"
              />
            </div>
          </div>
          <div v-if="isTextEntry(selected)" class="editor-shell">
            <MonacoCodeEditor
              :key="selected.path"
              :model-value="selectedContent"
              :language="editorLanguage"
              theme="vs"
              readonly
              :options="{ fontSize: 13, renderLineHighlight: 'none', wordWrap: 'off' }"
              :config="{ autoSizing: true, minimap: false, validateTags: false, formatOnMount: false }"
            />
          </div>
          <div v-else-if="isImage && previewUrl" class="visual-preview">
            <img :src="previewUrl" :alt="selected.name" />
          </div>
          <div v-else-if="isPdf && previewUrl" class="pdf-preview">
            <iframe :src="previewUrl" :title="selected.name"></iframe>
          </div>
          <div v-else class="binary-preview">
            <i class="pi pi-file"></i>
            <strong>{{ selected.name }}</strong>
            <span>Binary file · {{ formatBytes(selectedSize) }}</span>
          </div>
        </template>
        <div v-else class="binary-preview">
          <i class="pi pi-folder-open"></i>
          <strong>Select a file to view its content</strong>
        </div>
      </main>
    </div>
  </section>
</template>

<style scoped>
.sdf-workspace {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  color: #334e62;
  background: #f8fbfd;
  border: 1px solid #cddde8;
  border-radius: 0.375rem;
}

.workspace-header {
  min-height: 52px;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  background: #eef6fb;
  border-bottom: 1px solid #cddde8;
}

.header-identity,
.header-meta,
.header-meta span,
.file-location {
  display: flex;
  align-items: center;
}

.header-identity { min-width: 0; gap: 8px; }
.header-meta { flex-shrink: 0; gap: 8px; }
.header-meta span { gap: 5px; font-size: 0.72rem; color: #607d93; white-space: nowrap; }
.project-icon { display: grid; place-items: center; width: 30px; height: 30px; color: #517b99; background: #dcecf6; border: 1px solid #bfd5e4; border-radius: 0.25rem; }
.header-copy { display: flex; flex-direction: column; min-width: 0; }
.header-copy strong, .header-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.header-copy strong { font-size: 0.88rem; color: #243f52; }
.header-copy span { font: 0.7rem Consolas, monospace; color: #6d8799; }

.workspace-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(220px, 28%) minmax(0, 1fr); }
.project-explorer { min-width: 0; display: flex; flex-direction: column; background: #f3f8fb; border-right: 1px solid #cddde8; }
.explorer-title { height: 34px; padding: 0 10px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #d7e5ef; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.archive-size { color: #7a91a1; font-weight: 500; letter-spacing: 0; text-transform: none; }
.tree-search { height: 34px; margin: 7px; padding: 0 8px; display: flex; align-items: center; gap: 6px; background: #fff; border: 1px solid #c3d7e4; border-radius: 0.25rem; color: #7890a1; }
.tree-search:focus-within { border-color: #8fb4ca; outline: 2px solid #dcecf6; }
.tree-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: #334e62; font-size: 0.75rem; }
.tree-search button { border: 0; background: transparent; color: #7890a1; cursor: pointer; }
.tree-scroll { min-height: 0; flex: 1; overflow: auto; padding: 0 5px 8px; }
.tree-row { width: 100%; height: 27px; display: flex; align-items: center; gap: 5px; border: 1px solid transparent; border-radius: 0.25rem; background: transparent; color: #455f72; cursor: pointer; text-align: left; white-space: nowrap; }
.tree-row:hover { background: #e7f1f7; }
.tree-row.selected { background: #dcecf6; border-color: #a9c8da; color: #244e69; }
.tree-caret { width: 12px; flex: 0 0 12px; font-size: 0.62rem; color: #7890a1; }
.entry-icon { width: 14px; font-size: 0.75rem; color: #668da7; }
.tree-row .pi-folder, .tree-row .pi-folder-open { color: #6f9db8; }
.entry-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 0.75rem; }
.tree-row-actions { margin-left: auto; display: flex; flex: 0 0 auto; opacity: 0; }
.tree-row:hover .tree-row-actions, .tree-row.selected .tree-row-actions { opacity: 1; }
.tree-row-actions button { width: 22px; height: 22px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 0.25rem; background: transparent; color: #668da7; cursor: pointer; }
.tree-row-actions button:hover:not(:disabled) { background: #fff; color: #334e62; }
.tree-row-actions button:disabled { color: #a9bac6; cursor: not-allowed; }
.tree-row-actions i { font-size: 0.68rem; }
.empty-filter { padding: 12px; color: #7890a1; font-size: 0.75rem; text-align: center; }

.file-preview { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: #fbfdfe; }
.file-toolbar { height: 35px; padding: 0 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-shrink: 0; background: #f3f8fb; border-bottom: 1px solid #d7e5ef; }
.file-location { min-width: 0; gap: 7px; font: 0.72rem Consolas, monospace; color: #49697f; }
.file-location span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-size { flex-shrink: 0; color: #7890a1; font-size: 0.7rem; }
.file-actions { display: flex; align-items: center; gap: 3px; flex-shrink: 0; }
.file-actions :deep(.p-button) { height: 1.75rem; padding: 0 0.45rem; white-space: nowrap; }
.editor-shell, .visual-preview, .pdf-preview { flex: 1; min-height: 0; overflow: hidden; }
.editor-shell :deep(.monaco-editor), .editor-shell :deep(.overflow-guard) { border-radius: 0; }
.visual-preview { display: grid; place-items: center; padding: 18px; overflow: auto; background: #edf4f8; }
.visual-preview img { max-width: 100%; max-height: 100%; object-fit: contain; border: 1px solid #cddde8; }
.pdf-preview iframe { width: 100%; height: 100%; border: 0; }
.binary-preview, .workspace-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #7890a1; text-align: center; }
.binary-preview > i { font-size: 2.4rem; color: #9bb5c6; }
.binary-preview strong { color: #455f72; }
.binary-preview span { font-size: 0.78rem; }
.error-state { color: #9f3f4b; padding: 24px; }
.error-state > i { font-size: 2rem; }

@media (max-width: 760px) {
  .workspace-header { align-items: flex-start; }
  .header-meta span { display: none; }
  .workspace-body { grid-template-columns: minmax(180px, 40%) minmax(0, 1fr); }
}
</style>
