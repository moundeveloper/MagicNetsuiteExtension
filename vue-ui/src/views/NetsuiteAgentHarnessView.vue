<template>
  <div class="harness-view">
    <MCard
      class="harness-shell"
      flex
      direction="row"
      gap="0"
      padding=""
      outlined
      elevated
      :style="shellStyle"
    >
      <template #default>
        <ExpandableSidebar expandedWidth="268px" collapsedWidth="3rem" :defaultExpanded="true">
          <template #collapsed>
            <button type="button" class="sidebar-action" title="New harness thread" @click="harness.createThread()">
              <i class="pi pi-plus" />
            </button>
          </template>

          <template #default>
            <div class="harness-sidebar">
              <div class="sidebar-section">
                <div class="section-label">Mode</div>
                <div class="profile-list">
                  <button
                    type="button"
                    v-for="profile in harness.profiles"
                    :key="profile.id"
                    class="profile-option"
                    :class="{ active: harness.activeProfileId.value === profile.id }"
                    :title="profile.description"
                    @click="harness.setActiveProfile(profile.id)"
                  >
                    <span class="profile-mark" :style="{ background: profile.color }" />
                    <i :class="profile.icon" />
                    <span>{{ profile.shortName }}</span>
                  </button>
                </div>
              </div>

              <div class="sidebar-section sidebar-section--grow">
                <div class="section-heading">
                  <span class="section-label">Threads</span>
                  <button type="button" class="sidebar-action" title="New thread" @click="harness.createThread()">
                    <i class="pi pi-plus" />
                  </button>
                </div>
                <div class="thread-list">
                  <div
                    v-for="thread in harness.threads.value"
                    :key="thread.threadId"
                    role="button"
                    tabindex="0"
                    class="thread-item"
                    :class="{ active: harness.activeThread.value?.threadId === thread.threadId }"
                    @click="harness.loadThread(thread.threadId)"
                    @keydown.enter.prevent="harness.loadThread(thread.threadId)"
                    @keydown.space.prevent="harness.loadThread(thread.threadId)"
                  >
                    <span class="thread-name">{{ thread.title }}</span>
                    <span class="thread-meta">{{ formatDate(thread.updatedAt) }}</span>
                    <button
                      type="button"
                      class="thread-delete"
                      title="Delete thread"
                      @click.stop="harness.removeThread(thread.threadId)"
                    >
                      <i class="pi pi-trash" />
                    </button>
                  </div>
                </div>
              </div>

              <div class="sidebar-section">
                <div class="section-label">Permissions</div>
                <div class="mode-segment">
                  <button
                    type="button"
                    v-for="mode in modes"
                    :key="mode.id"
                    class="mode-btn"
                    :class="{ active: harness.permissionMode.value === mode.id }"
                    :title="mode.title"
                    @click="harness.setPermissionMode(mode.id)"
                  >
                    <i :class="mode.icon" />
                    <span>{{ mode.label }}</span>
                  </button>
                </div>
              </div>
            </div>
          </template>
        </ExpandableSidebar>

        <main class="harness-main">
          <header class="harness-toolbar">
            <div class="toolbar-left">
              <div class="toolbar-title">
                <i :class="harness.activeProfile.value.icon" />
                <span>NetSuite Agent</span>
              </div>
              <span class="profile-pill" :style="profilePillStyle" :title="harness.activeProfile.value.description">
                {{ harness.activeProfile.value.shortName }}
              </span>
              <span class="status-pill" :class="connectionClass">
                <span class="status-dot" />
                {{ connectionLabel }}
              </span>
            </div>
            <div class="toolbar-right">
              <span class="provider-chip">
                <i class="pi pi-microchip-ai" />
                {{ harness.providerLabel.value }}
              </span>
              <button
                type="button"
                class="icon-btn"
                title="Check NetSuite session"
                @click="harness.refreshEnvironment()"
              >
                <i
                  :class="harness.connectionStatus.value === 'checking' ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'"
                />
              </button>
              <button type="button" class="icon-btn" title="Clear current thread" @click="harness.clearThread()">
                <i class="pi pi-eraser" />
              </button>
            </div>
          </header>

          <div class="harness-body">
            <section
              class="workstream"
              :class="{ 'workstream--dragging': isDragOver }"
              @dragenter.prevent="onDragEnter"
              @dragover.prevent="onDragOver"
              @dragleave="onDragLeave"
              @drop.prevent="onDrop"
            >
              <div v-if="isDragOver" class="drop-overlay">
                <i class="pi pi-cloud-upload" />
                <span>Drop files to attach</span>
              </div>
              <div ref="streamRef" class="stream-list">
                <div v-if="harness.items.value.length === 0" class="empty-state">
                  <div class="empty-mark">
                    <i class="pi pi-bolt" />
                  </div>
                  <div class="quick-actions">
                    <button
                      type="button"
                      v-for="quick in quickPrompts"
                      :key="quick"
                      class="quick-btn"
                      @click="prompt = quick"
                    >
                      {{ quick }}
                    </button>
                  </div>
                </div>

                <article
                  v-for="item in harness.items.value"
                  :key="item.id"
                  class="stream-item"
                  :class="[`stream-item--${item.kind}`, `stream-item--${item.status}`]"
                >
                  <div class="item-rail">
                    <span class="item-icon" :class="itemIconClass(item)">
                      <i :class="itemIcon(item)" />
                    </span>
                  </div>

                  <div class="item-content">
                    <div class="item-header">
                      <span class="item-title">{{ itemTitle(item) }}</span>
                      <span class="item-meta">{{ formatTime(item.createdAt) }}</span>
                      <span v-if="item.status === 'running'" class="live-badge">
                        <span class="live-dot" />
                        running
                      </span>
                      <span v-else-if="item.kind === 'tool'" class="risk-badge" :class="`risk-${item.risk || 'none'}`">
                        {{ item.risk || "none" }}
                      </span>
                      <button
                        v-if="item.role === 'user'"
                        type="button"
                        class="item-action"
                        title="Edit and rerun from here"
                        @click="startEdit(item)"
                      >
                        <i class="pi pi-pencil" />
                      </button>
                    </div>

                    <div v-if="item.kind === 'tool' || item.kind === 'approval'" class="tool-card">
                      <button type="button" class="tool-card-head" @click="toggleTool(item.id)">
                        <span class="tool-card-title">
                          <i :class="isToolExpanded(item) ? 'pi pi-angle-down' : 'pi pi-angle-right'" />
                          <code>{{ item.toolName }}</code>
                        </span>
                        <span v-if="item.latencyMs !== undefined">{{ item.latencyMs }}ms</span>
                      </button>
                      <div v-if="isToolExpanded(item)" class="tool-card-body">
                        <pre v-if="item.toolInput" class="tool-input">{{ formatToolInput(item.toolInput) }}</pre>
                        <pre class="tool-output">{{ item.content }}</pre>
                      </div>
                      <div v-else class="tool-preview">
                        {{ toolPreview(item) }}
                      </div>
                    </div>

                    <MessageContentRenderer
                      v-else-if="item.content"
                      class="message-renderer"
                      :content="item.content"
                    />
                    <div v-if="item.attachments?.length" class="msg-attachments">
                      <span v-for="attachment in item.attachments" :key="attachment.name" class="attachment-chip">
                        <i :class="attachment.type === 'pdf' ? 'pi pi-file-pdf' : 'pi pi-file'" />
                        <span>{{ attachment.name }}</span>
                        <small>{{ formatFileSize(attachment.size) }}</small>
                      </span>
                    </div>

                    <div v-else-if="!item.content" class="typing-line">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </article>
              </div>

              <form class="composer" @submit.prevent="sendPrompt">
                <input
                  ref="fileInputRef"
                  type="file"
                  multiple
                  accept=".pdf,.txt,.md,.markdown,.json,.xml,.csv,.html,.htm,.js,.ts,.jsx,.tsx,.css,.scss,.sql,.py,.java,.c,.cpp,.cs,.go,.rb,.php,.sh,.yaml,.yml,.toml"
                  hidden
                  @change="onFileInputChange"
                />
                <div v-if="editingItemId" class="edit-strip">
                  <i class="pi pi-pencil" />
                  <span>Editing previous message</span>
                  <button type="button" @click="cancelEdit">
                    <i class="pi pi-times" />
                  </button>
                </div>
                <div v-if="pendingAttachments.length > 0" class="pending-attachments">
                  <span
                    v-for="(attachment, index) in pendingAttachments"
                    :key="`${attachment.name}-${index}`"
                    class="attachment-chip"
                  >
                    <i :class="attachment.type === 'pdf' ? 'pi pi-file-pdf' : 'pi pi-file'" />
                    <span>{{ attachment.name }}</span>
                    <small>{{ formatFileSize(attachment.size) }}</small>
                    <button type="button" title="Remove" @click="removeAttachment(index)">
                      <i class="pi pi-times" />
                    </button>
                  </span>
                </div>
                <div class="composer-row">
                  <button
                    type="button"
                    class="attach-btn"
                    :disabled="harness.loading.value || isProcessingFiles"
                    title="Attach PDF, text, or code"
                    @click="triggerFileInput"
                  >
                    <i v-if="isProcessingFiles" class="pi pi-spin pi-spinner" />
                    <i v-else class="pi pi-paperclip" />
                  </button>
                  <textarea
                    v-model="prompt"
                    class="composer-input"
                    :disabled="harness.loading.value"
                    rows="2"
                    placeholder="Ask for NetSuite data, scripts, files, bundles, or a deploy-safe change..."
                    @keydown="onComposerKeydown"
                  />
                  <button
                    v-if="harness.loading.value"
                    type="button"
                    class="composer-btn composer-btn--stop"
                    title="Stop"
                    @click="harness.stop()"
                  >
                    <i class="pi pi-stop-circle" />
                  </button>
                  <button
                    v-else
                    type="submit"
                    class="composer-btn"
                    :disabled="!canSubmit"
                    title="Send"
                  >
                    <i class="pi pi-arrow-up" />
                  </button>
                </div>
              </form>

              <div v-if="harness.error.value" class="error-strip">
                <i class="pi pi-exclamation-triangle" />
                <span>{{ String(harness.error.value) }}</span>
              </div>
            </section>

            <aside class="context-rail">
              <section class="rail-section">
                <div class="rail-heading">
                  <span>Toolsets</span>
                  <strong>{{ harness.selectedTools.value.length }} tools</strong>
                </div>
                <div class="toolset-list">
                  <div
                    v-for="toolset in harness.activeToolsets.value"
                    :key="toolset.id"
                    class="toolset-row"
                    :class="{ muted: !toolset.active }"
                  >
                    <i :class="toolset.icon" />
                    <span>{{ toolset.name }}</span>
                    <strong>{{ toolset.count }}</strong>
                  </div>
                </div>
              </section>

              <section class="rail-section">
                <div class="rail-heading">
                  <span>Recent Tools</span>
                </div>
                <div v-if="harness.telemetry.value.length === 0" class="rail-empty">
                  No tools have run in this thread yet.
                </div>
                <div
                  v-for="entry in harness.telemetry.value.slice(0, 8)"
                  :key="entry.id"
                  class="tool-activity-row"
                  :title="entry.resultSummary"
                >
                  <span :class="['activity-status', `activity-status--${entry.status}`]" />
                  <span class="activity-name">{{ entry.toolName }}</span>
                  <strong>{{ entry.latencyMs }}ms</strong>
                </div>
              </section>
            </aside>
          </div>
        </main>
      </template>
    </MCard>

    <ToolApprovalDialog
      :visible="approvalVisible"
      :tool-name="approvalRequest?.toolName ?? ''"
      :tool-input="approvalRequest?.toolInput"
      :requester-name="approvalRequest?.profileName"
      :requester-color="approvalRequest?.profileColor"
      @approve="resolveApproval(true)"
      @reject="resolveApproval(false)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import MCard from "../components/universal/card/MCard.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MessageContentRenderer from "../components/MessageContentRenderer.vue";
import ToolApprovalDialog from "../components/ToolApprovalDialog.vue";
import {
  useNetsuiteAgentHarness,
  type HarnessAttachment,
  type HarnessApprovalRequest,
} from "../composables/useNetsuiteAgentHarness";
import type {
  HarnessItemRecord,
  HarnessPermissionMode,
} from "../utils/agentHarnessDb";
import { extractPdfText } from "../utils/pdfUtils";

type HarnessItemView = Omit<Readonly<HarnessItemRecord>, "attachments"> & {
  readonly attachments?: readonly HarnessAttachment[];
};

withDefaults(defineProps<{ vhOffset?: number }>(), {
  vhOffset: 100,
});

const approvalVisible = ref(false);
const approvalRequest = ref<HarnessApprovalRequest | null>(null);
let approvalResolver: ((approved: boolean) => void) | null = null;

const harness = useNetsuiteAgentHarness(
  (request) =>
    new Promise<boolean>((resolve) => {
      approvalRequest.value = request;
      approvalVisible.value = true;
      approvalResolver = resolve;
    })
);

const prompt = ref("");
const streamRef = ref<HTMLDivElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const pendingAttachments = ref<HarnessAttachment[]>([]);
const isProcessingFiles = ref(false);
const isDragOver = ref(false);
const expandedToolIds = ref(new Set<string>());
const editingItemId = ref<string | null>(null);

const ACCEPTED_TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "xml",
  "csv",
  "html",
  "htm",
  "js",
  "ts",
  "jsx",
  "tsx",
  "css",
  "scss",
  "sql",
  "py",
  "java",
  "c",
  "cpp",
  "cs",
  "go",
  "rb",
  "php",
  "sh",
  "yaml",
  "yml",
  "toml",
]);

const modes: Array<{
  id: HarnessPermissionMode;
  label: string;
  icon: string;
  title: string;
}> = [
  { id: "read", label: "Read", icon: "pi pi-eye", title: "Read-only account exploration" },
  { id: "build", label: "Build", icon: "pi pi-wrench", title: "Prepare changes, approve writes" },
  { id: "release", label: "Ship", icon: "pi pi-shield", title: "Release-sensitive approval mode" },
];

const quickPrompts = [
  "Find scripts related to invoices and summarize deployments",
  "Inspect installed bundles and flag locked script components",
  "Search official docs for Map/Reduce governance limits",
  "Find the file cabinet source for a Suitelet by script name",
];

const shellStyle = computed(() => ({
  height: "100%",
  overflow: "hidden",
}));

const canSubmit = computed(
  () => prompt.value.trim().length > 0 || pendingAttachments.value.length > 0
);

const profilePillStyle = computed(() => ({
  background: `${harness.activeProfile.value.color}18`,
  borderColor: `${harness.activeProfile.value.color}55`,
  color: harness.activeProfile.value.color,
}));

const connectionClass = computed(() => ({
  "status-pill--ok": harness.connectionStatus.value === "connected",
  "status-pill--warn":
    harness.connectionStatus.value === "unknown" ||
    harness.connectionStatus.value === "disconnected",
  "status-pill--error": harness.connectionStatus.value === "error",
}));

const connectionLabel = computed(() => {
  if (harness.connectionStatus.value === "checking") return "Checking NetSuite";
  if (harness.connectionStatus.value === "connected") return harness.environment.value;
  if (harness.environment.value !== "unknown") return harness.environment.value;
  return "Connect NetSuite";
});

const resolveApproval = (approved: boolean) => {
  approvalVisible.value = false;
  approvalResolver?.(approved);
  approvalResolver = null;
  approvalRequest.value = null;
};

const sendPrompt = async () => {
  const text = prompt.value.trim();
  const attachments =
    pendingAttachments.value.length > 0 ? [...pendingAttachments.value] : undefined;
  if (!text && (!attachments || attachments.length === 0)) return;
  const editingId = editingItemId.value;
  prompt.value = "";
  pendingAttachments.value = [];
  editingItemId.value = null;
  if (editingId) {
    await harness.rerunFromItem(editingId, text, { attachments });
  } else {
    await harness.runTurn(text, { attachments });
  }
  await scrollToBottom();
};

const onComposerKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendPrompt();
  }
};

const startEdit = (item: HarnessItemView) => {
  if (item.role !== "user" || harness.loading.value) return;
  editingItemId.value = item.id;
  prompt.value = item.content;
  pendingAttachments.value = item.attachments
    ? item.attachments.map((attachment) => ({ ...attachment }))
    : [];
};

const cancelEdit = () => {
  editingItemId.value = null;
  prompt.value = "";
  pendingAttachments.value = [];
};

const scrollToBottom = async () => {
  await nextTick();
  if (streamRef.value) {
    streamRef.value.scrollTop = streamRef.value.scrollHeight;
  }
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

const itemIcon = (item: HarnessItemView): string => {
  if (item.kind === "tool") return "pi pi-bolt";
  if (item.kind === "approval") return "pi pi-lock";
  if (item.kind === "system") return "pi pi-info-circle";
  if (item.role === "user") return "pi pi-user";
  return harness.activeProfile.value.icon;
};

const itemIconClass = (item: HarnessItemView): string => {
  if (item.status === "error") return "item-icon--error";
  if (item.status === "rejected") return "item-icon--rejected";
  if (item.status === "running" || item.status === "pending") return "item-icon--running";
  if (item.role === "user") return "item-icon--user";
  return "item-icon--done";
};

const itemTitle = (item: HarnessItemView): string => {
  if (item.role === "user") return "You";
  if (item.kind === "tool") return item.toolName ?? "Tool";
  if (item.kind === "approval") return item.title ?? "Approval";
  if (item.kind === "system") return item.title ?? "System";
  return item.title || harness.activeProfile.value.shortName;
};

const formatToolInput = (input: unknown): string => {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
};

const isToolExpanded = (item: HarnessItemView): boolean =>
  item.status === "running" || expandedToolIds.value.has(item.id);

const toggleTool = (itemId: string) => {
  const next = new Set(expandedToolIds.value);
  if (next.has(itemId)) next.delete(itemId);
  else next.add(itemId);
  expandedToolIds.value = next;
};

const toolPreview = (item: HarnessItemView): string => {
  if (item.status === "running") return "Running...";
  const text = item.content.replace(/\s+/g, " ").trim();
  return text.length > 180 ? `${text.slice(0, 180)}...` : text || "No output.";
};

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileExtension = (name: string): string =>
  name.split(".").pop()?.toLowerCase() ?? "";

const processFiles = async (files: FileList | File[]) => {
  isProcessingFiles.value = true;
  try {
    for (const file of Array.from(files)) {
      const ext = getFileExtension(file.name);
      const isPdf = ext === "pdf" || file.type === "application/pdf";
      const isText = ACCEPTED_TEXT_EXTENSIONS.has(ext) || file.type.startsWith("text/");
      if (!isPdf && !isText) continue;

      let content = "";
      if (isPdf) {
        const result = await extractPdfText(file);
        content = result.pages
          .map((page) => `<page ${page.pageNumber}>\n${page.text}\n</page ${page.pageNumber}>`)
          .join("\n\n");
      } else {
        content = await file.text();
      }

      pendingAttachments.value.push({
        name: file.name,
        type: isPdf ? "pdf" : "text",
        content,
        size: file.size,
      });
    }
  } finally {
    isProcessingFiles.value = false;
  }
};

const triggerFileInput = () => {
  fileInputRef.value?.click();
};

const onFileInputChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) await processFiles(input.files);
  input.value = "";
};

const removeAttachment = (index: number) => {
  pendingAttachments.value.splice(index, 1);
};

const onDragEnter = (event: DragEvent) => {
  if (event.dataTransfer?.types.includes("Files")) isDragOver.value = true;
};

const onDragOver = (event: DragEvent) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  isDragOver.value = true;
  event.dataTransfer.dropEffect = "copy";
};

const onDragLeave = (event: DragEvent) => {
  const related = event.relatedTarget as Node | null;
  const target = event.currentTarget as HTMLElement;
  if (!related || !target.contains(related)) isDragOver.value = false;
};

const onDrop = async (event: DragEvent) => {
  isDragOver.value = false;
  if (event.dataTransfer?.files?.length) await processFiles(event.dataTransfer.files);
};

watch(
  () => harness.items.value.map((item) => `${item.id}:${item.content.length}:${item.status}`).join("|"),
  () => {
    void scrollToBottom();
  }
);

onMounted(async () => {
  await harness.initialize();
  await scrollToBottom();
});
</script>

<style scoped>
.harness-view {
  width: 100%;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.harness-shell {
  width: 100%;
  min-height: 0;
  transition: box-shadow 0.2s ease;
}

.harness-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: linear-gradient(180deg, #f8fafc 0%, #f5f3ff 100%);
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.sidebar-action,
.icon-btn,
.mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--p-slate-200);
  background: white;
  color: var(--p-slate-600);
  cursor: pointer;
  transition: all 0.14s ease;
}

.sidebar-action {
  width: 28px;
  height: 28px;
  border-radius: 6px;
}

.sidebar-action:hover,
.icon-btn:hover,
.mini-btn:hover {
  background: #f5f3ff;
  border-color: #c4b5fd;
  color: #6d28d9;
}

.sidebar-section {
  padding: 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--p-slate-200) 80%, transparent);
}

.sidebar-section--grow {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
}

.section-label,
.rail-heading {
  font-size: 0.68rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-slate-400);
}

.profile-list,
.thread-list,
.toolset-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 7px;
}

.thread-list {
  overflow-y: auto;
  min-height: 0;
  padding-right: 2px;
}

.profile-option,
.thread-item {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  color: var(--p-slate-600);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.14s ease;
}

.profile-option {
  display: grid;
  grid-template-columns: 8px 18px 1fr;
  align-items: center;
  gap: 7px;
  padding: 7px 8px;
  text-align: left;
  font-size: 0.78rem;
  font-weight: 650;
}

.profile-mark {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.profile-option:hover,
.thread-item:hover {
  background: rgba(255, 255, 255, 0.72);
  border-color: var(--p-slate-200);
}

.profile-option.active,
.thread-item.active {
  background: white;
  border-color: #c4b5fd;
  box-shadow: 0 1px 0 rgba(124, 58, 237, 0.08);
  color: var(--p-slate-800);
}

.thread-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 8px 30px 8px 8px;
  text-align: left;
}

.thread-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.77rem;
  font-weight: 600;
}

.thread-meta {
  color: var(--p-slate-400);
  font-size: 0.64rem;
}

.thread-delete {
  position: absolute;
  right: 5px;
  top: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  transform: translateY(-50%);
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--p-slate-400);
  opacity: 0;
  cursor: pointer;
}

.thread-item:hover .thread-delete {
  opacity: 1;
}

.thread-delete:hover {
  background: var(--p-red-50);
  color: var(--p-red-600);
}

.mode-segment {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  margin-top: 8px;
  padding: 3px;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: white;
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  padding: 5px 4px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--p-slate-500);
  font-size: 0.68rem;
  font-weight: 700;
  cursor: pointer;
}

.mode-btn.active {
  background: #ede9fe;
  color: #6d28d9;
}

.mode-btn i {
  font-size: 0.68rem;
}

.harness-main {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: #ffffff;
}

.harness-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 50px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--p-slate-200);
  background: #ffffff;
}

.toolbar-left,
.toolbar-right {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.toolbar-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 0.95rem;
  font-weight: 750;
  color: var(--p-slate-900);
  white-space: nowrap;
}

.toolbar-title i {
  color: #7c3aed;
}

.profile-pill,
.status-pill,
.provider-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  border-radius: 6px;
  border: 1px solid var(--p-slate-200);
  padding: 2px 8px;
  font-size: 0.68rem;
  font-weight: 700;
  white-space: nowrap;
}

.status-pill,
.provider-chip {
  color: var(--p-slate-500);
  background: var(--p-slate-50);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--p-slate-300);
}

.status-pill--ok .status-dot {
  background: #22c55e;
}

.status-pill--warn .status-dot {
  background: #f59e0b;
}

.status-pill--error .status-dot {
  background: #ef4444;
}

.icon-btn {
  width: 30px;
  height: 30px;
  border-radius: 7px;
}

.harness-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.workstream {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid var(--p-slate-200);
  overflow: hidden;
}

.workstream--dragging {
  outline: 2px dashed #a78bfa;
  outline-offset: -4px;
}

.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.88);
  color: #6d28d9;
  pointer-events: none;
  font-size: 0.85rem;
  font-weight: 700;
}

.drop-overlay i {
  font-size: 2rem;
}

.stream-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px;
  background:
    linear-gradient(180deg, rgba(245, 243, 255, 0.36), transparent 180px),
    #ffffff;
  contain: layout paint;
}

.empty-state {
  display: flex;
  min-height: 100%;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 18px;
}

.empty-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 8px;
  background: #ede9fe;
  color: #7c3aed;
  border: 1px solid #ddd6fe;
}

.quick-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(180px, 260px));
  gap: 8px;
}

.quick-btn {
  min-height: 38px;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: white;
  color: var(--p-slate-600);
  font-size: 0.76rem;
  font-weight: 600;
  text-align: left;
  padding: 8px 10px;
  cursor: pointer;
}

.quick-btn:hover {
  border-color: #c4b5fd;
  color: #6d28d9;
  background: #faf9ff;
}

.stream-item {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 9px;
  width: min(100%, 980px);
  max-width: 980px;
  margin: 0 auto 14px;
}

.item-rail {
  display: flex;
  justify-content: center;
  padding-top: 2px;
}

.item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 1px solid var(--p-slate-200);
  background: white;
  color: var(--p-slate-400);
  font-size: 0.72rem;
}

.item-icon--user {
  background: var(--p-slate-700);
  color: white;
  border-color: var(--p-slate-700);
}

.item-icon--done {
  background: #f5f3ff;
  color: #7c3aed;
  border-color: #ddd6fe;
}

.item-icon--running {
  background: #eef2ff;
  color: #4f46e5;
  border-color: #c7d2fe;
}

.item-icon--error {
  background: var(--p-red-50);
  color: var(--p-red-600);
  border-color: var(--p-red-200);
}

.item-icon--rejected {
  background: var(--p-amber-50);
  color: var(--p-amber-700);
  border-color: var(--p-amber-200);
}

.item-content {
  min-width: 0;
}

.item-header {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 24px;
  margin-bottom: 4px;
}

.item-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: auto;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--p-slate-400);
  cursor: pointer;
  opacity: 0;
}

.stream-item:hover .item-action {
  opacity: 1;
}

.item-action:hover {
  border-color: #ddd6fe;
  background: #f5f3ff;
  color: #6d28d9;
}

.item-title {
  font-size: 0.76rem;
  font-weight: 750;
  color: var(--p-slate-700);
}

.item-meta {
  font-size: 0.64rem;
  color: var(--p-slate-400);
}

.live-badge,
.risk-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 99px;
  padding: 1px 6px;
  font-size: 0.58rem;
  font-weight: 800;
  text-transform: uppercase;
}

.live-badge {
  background: #eef2ff;
  color: #4f46e5;
}

.live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse-dot 1.2s ease-in-out infinite;
}

.risk-none {
  background: var(--p-slate-100);
  color: var(--p-slate-500);
}

.risk-low {
  background: #dcfce7;
  color: #15803d;
}

.risk-medium {
  background: #fef3c7;
  color: #92400e;
}

.risk-high {
  background: #fee2e2;
  color: #b91c1c;
}

.message-renderer {
  color: var(--p-slate-700);
  font-size: 0.86rem;
  line-height: 1.65;
}

.stream-item--message .item-content {
  padding: 4px 0;
}

.stream-item--message.stream-item--done .item-content {
  color: var(--p-slate-700);
}

.tool-card {
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  overflow: hidden;
  background: #ffffff;
}

.tool-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  cursor: pointer;
  text-align: left;
  background: #f8fafc;
  border-bottom: 1px solid var(--p-slate-200);
}

.tool-card-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.tool-card-title i {
  color: var(--p-slate-400);
  font-size: 0.7rem;
}

.tool-card-head code {
  color: #6d28d9;
  font-size: 0.72rem;
  font-weight: 750;
}

.tool-card-head span {
  color: var(--p-slate-400);
  font-size: 0.65rem;
  font-weight: 700;
}

.tool-card-body {
  min-width: 0;
}

.tool-input,
.tool-output {
  margin: 0;
  padding: 8px 10px;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.7rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--p-slate-700);
}

.tool-input {
  max-height: 120px;
  overflow: auto;
  background: #faf9ff;
  border-bottom: 1px solid #ede9fe;
}

.tool-output {
  max-height: 240px;
  overflow: auto;
  background: white;
}

.tool-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 8px 10px;
  color: var(--p-slate-500);
  font-size: 0.72rem;
  background: white;
}

.typing-line {
  display: inline-flex;
  gap: 4px;
  padding: 7px 0;
}

.typing-line span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--p-slate-400);
  animation: typing 1.2s ease-in-out infinite;
}

.typing-line span:nth-child(2) {
  animation-delay: 0.15s;
}

.typing-line span:nth-child(3) {
  animation-delay: 0.3s;
}

.composer {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 12px;
  border-top: 1px solid var(--p-slate-200);
  background: #f8fafc;
  flex-shrink: 0;
}

.composer-row {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 36px;
  gap: 8px;
  align-items: center;
}

.composer-input {
  width: 100%;
  min-height: 46px;
  max-height: 160px;
  resize: none;
  border: 1px solid var(--p-slate-300);
  border-radius: 8px;
  padding: 9px 10px;
  background: white;
  color: var(--p-slate-800);
  font: inherit;
  font-size: 0.84rem;
  line-height: 1.45;
  outline: none;
}

.composer-input:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.18);
}

.composer-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: var(--p-slate-800);
  color: white;
  cursor: pointer;
  transition: background 0.14s ease;
}

.attach-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  background: white;
  color: var(--p-slate-600);
  cursor: pointer;
}

.attach-btn:hover:not(:disabled) {
  border-color: #c4b5fd;
  background: #f5f3ff;
  color: #6d28d9;
}

.attach-btn:disabled {
  color: var(--p-slate-300);
  cursor: not-allowed;
}

.composer-btn:hover:not(:disabled) {
  background: #6d28d9;
}

.composer-btn:disabled {
  background: var(--p-slate-300);
  cursor: not-allowed;
}

.composer-btn--stop {
  background: var(--p-red-600);
}

.error-strip {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
  border-top: 1px solid var(--p-red-200);
  background: var(--p-red-50);
  color: var(--p-red-700);
  font-size: 0.78rem;
}

.edit-strip {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #6d28d9;
  font-size: 0.72rem;
  font-weight: 700;
}

.edit-strip button,
.attachment-chip button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.pending-attachments,
.msg-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.msg-attachments {
  margin-top: 6px;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 260px;
  min-height: 24px;
  padding: 3px 7px;
  border: 1px solid #ddd6fe;
  border-radius: 6px;
  background: #faf9ff;
  color: var(--p-slate-600);
  font-size: 0.7rem;
  font-weight: 650;
}

.attachment-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-chip small {
  flex-shrink: 0;
  color: var(--p-slate-400);
}

.context-rail {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 0;
  background: #fbfdff;
  overflow-y: auto;
}

.rail-section {
  padding: 12px;
  border-bottom: 1px solid var(--p-slate-200);
}

.rail-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.rail-heading strong {
  color: var(--p-slate-400);
  font-size: 0.68rem;
}

.toolset-row,
.tool-activity-row {
  display: grid;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.toolset-row {
  grid-template-columns: 18px 1fr auto;
  padding: 6px 0;
  color: var(--p-slate-600);
  font-size: 0.75rem;
}

.toolset-row i {
  color: #7c3aed;
  font-size: 0.75rem;
}

.toolset-row strong {
  font-size: 0.68rem;
  color: var(--p-slate-400);
}

.toolset-row.muted {
  opacity: 0.42;
}

.rail-empty {
  color: var(--p-slate-400);
  font-size: 0.74rem;
  padding: 7px 0;
}

.tool-activity-row {
  grid-template-columns: 8px 1fr auto;
  padding: 5px 0;
  color: var(--p-slate-600);
  font-size: 0.72rem;
}

.activity-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-activity-row strong {
  color: var(--p-slate-400);
  font-size: 0.65rem;
}

.activity-status {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--p-slate-300);
}

.activity-status--done {
  background: #22c55e;
}

.activity-status--error {
  background: #ef4444;
}

.activity-status--rejected {
  background: #f59e0b;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.38; }
}

@keyframes typing {
  0%, 80%, 100% {
    opacity: 0.25;
    transform: scale(0.86);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (max-width: 980px) {
  .harness-body {
    grid-template-columns: 1fr;
  }

  .context-rail {
    display: none;
  }

  .quick-actions {
    grid-template-columns: minmax(220px, 1fr);
  }

  .profile-pill,
  .provider-chip {
    display: none;
  }
}
</style>
