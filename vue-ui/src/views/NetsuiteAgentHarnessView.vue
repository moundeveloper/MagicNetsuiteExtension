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
                <div class="section-heading">
                  <span class="section-label">Agents</span>
                  <button type="button" class="sidebar-action" title="Create agent" @click="openCreateAgentDialog">
                    <i class="pi pi-sparkles" />
                  </button>
                </div>
                <div class="profile-list">
                  <div
                    v-for="agent in harness.agents.value"
                    :key="agent.id"
                    class="profile-row"
                    :class="{ active: harness.activeAgentId.value === agent.id }"
                  >
                    <button
                      type="button"
                      class="profile-option"
                      :title="`${agent.name}: ${agent.description}`"
                      @click="harness.setActiveAgent(agent.id)"
                    >
                      <span class="profile-mark" :style="{ background: agent.color }" />
                      <i :class="agent.icon" />
                      <span>{{ agent.shortName }}</span>
                    </button>
                    <button
                      type="button"
                      class="agent-row-action"
                      title="Edit agent"
                      @click.stop="openEditAgentDialog(agent)"
                    >
                      <i class="pi pi-cog" />
                    </button>
                  </div>
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
                <i :class="harness.activeAgent.value.icon" />
                <span>NetSuite Agent</span>
              </div>
              <span class="profile-pill" :style="agentPillStyle" :title="harness.activeAgent.value.description">
                {{ harness.activeAgent.value.shortName }}
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

                <template v-for="turn in displayTurns" :key="turn.turnId">
                  <article
                    v-if="turn.userItem"
                    class="stream-item stream-item--message stream-item--user-turn"
                    :class="[`stream-item--${turn.userItem.status}`]"
                  >
                    <div class="item-rail">
                      <span class="item-icon" :class="itemIconClass(turn.userItem)">
                        <i :class="itemIcon(turn.userItem)" />
                      </span>
                    </div>

                    <div class="item-content">
                      <div class="item-header">
                        <span class="item-title">You</span>
                        <span class="item-meta">{{ formatTime(turn.userItem.createdAt) }}</span>
                        <button
                          v-if="!harness.loading.value"
                          type="button"
                          class="item-action"
                          title="Edit and rerun from here"
                          @click="startEdit(turn.userItem)"
                        >
                          <i class="pi pi-pencil" />
                        </button>
                      </div>

                      <div v-if="editingItemId === turn.userItem.id" class="harness-msg-edit-area">
                        <textarea v-model="editText" class="harness-msg-edit-textarea" />
                        <div class="harness-msg-edit-actions">
                          <button type="button" class="harness-msg-edit-cancel" @click="cancelEdit">
                            Cancel
                          </button>
                          <button type="button" class="harness-msg-edit-save" @click="saveEdit(turn.userItem)">
                            Save & Resubmit
                          </button>
                        </div>
                      </div>

                      <template v-else>
                        <MessageContentRenderer
                          v-if="turn.userItem.content"
                          class="message-renderer"
                          :content="resolveViewPlaceholders(turn.userItem.content)"
                        />
                        <div v-if="turn.userItem.attachments?.length" class="msg-attachments">
                          <span
                            v-for="attachment in turn.userItem.attachments"
                            :key="attachment.name"
                            class="attachment-chip"
                          >
                            <i :class="attachment.type === 'pdf' ? 'pi pi-file-pdf' : 'pi pi-file'" />
                            <span>{{ attachment.name }}</span>
                            <small>{{ formatFileSize(attachment.size) }}</small>
                          </span>
                        </div>
                      </template>
                    </div>
                  </article>

                  <article
                    v-if="turn.actionItems.length || turn.finalItem || turn.terminalItem || turn.isRunning"
                    class="stream-item stream-item--message stream-item--assistant-turn"
                    :class="{ 'stream-item--running': turn.isRunning, 'stream-item--error': turn.hasError }"
                  >
                    <div class="item-rail">
                      <span class="item-icon" :class="turnIconClass(turn)">
                        <i :class="turnIcon(turn)" />
                      </span>
                    </div>

                    <div class="item-content assistant-turn-content">
                      <div class="item-header">
                        <span class="item-title">{{ assistantTurnTitle(turn) }}</span>
                        <span class="item-meta">{{ formatTime(assistantTurnTime(turn)) }}</span>
                        <span v-if="turn.isRunning" class="live-badge">
                          <span class="live-dot" />
                          running
                        </span>
                      </div>

                      <section
                        v-if="turn.actionItems.length"
                        class="action-group"
                        :class="{ 'action-group--running': turn.isRunning }"
                      >
                        <button type="button" class="action-summary" @click="toggleActionGroup(turn.turnId)">
                          <span class="action-summary-left">
                            <i :class="isActionGroupExpanded(turn) ? 'pi pi-angle-down' : 'pi pi-angle-right'" />
                            <span>{{ actionSummaryLabel(turn) }}</span>
                          </span>
                          <span class="action-summary-icons" aria-hidden="true">
                            <span
                              v-for="action in turn.actionItems.slice(0, 6)"
                              :key="action.id"
                              class="action-mini-icon"
                              :class="itemIconClass(action)"
                            >
                              <i :class="itemIcon(action)" />
                            </span>
                          </span>
                        </button>

                        <div v-if="isActionGroupExpanded(turn)" class="action-list">
                          <div
                            v-for="action in turn.actionItems"
                            :key="action.id"
                            class="action-row"
                            :class="[`action-row--${action.status}`]"
                          >
                            <button type="button" class="action-row-main" @click="toggleTool(action.id)">
                              <span class="action-row-icon" :class="itemIconClass(action)">
                                <i :class="itemIcon(action)" />
                              </span>
                              <span class="action-row-text">
                                <span class="action-row-title">{{ itemTitle(action) }}</span>
                                <span class="action-row-preview">{{ toolPreview(action) }}</span>
                              </span>
                              <span v-if="action.latencyMs !== undefined" class="action-row-latency">
                                {{ action.latencyMs }}ms
                              </span>
                              <i
                                class="action-row-chevron"
                                :class="isToolExpanded(action) ? 'pi pi-angle-up' : 'pi pi-angle-down'"
                              />
                            </button>

                            <div v-if="isToolExpanded(action)" class="action-row-details">
                              <pre v-if="action.toolInput" class="tool-input">{{ formatToolInput(action.toolInput) }}</pre>
                              <MessageContentRenderer
                                v-if="action.kind === 'message'"
                                class="message-renderer action-message-renderer"
                                :content="resolveViewPlaceholders(action.content)"
                              />
                              <pre v-else class="tool-output">{{ action.content }}</pre>
                            </div>
                          </div>
                        </div>
                      </section>

                      <div v-if="turn.artifacts.length" class="artifact-list">
                        <section
                          v-for="artifact in turn.artifacts"
                          :key="artifact.id"
                          class="artifact-card"
                          :class="`artifact-card--${artifact.kind}`"
                        >
                          <div class="artifact-header">
                            <span class="artifact-title">
                              <i :class="artifactIcon(artifact)" />
                              <span>{{ artifact.title }}</span>
                            </span>
                            <span class="artifact-meta">
                              {{ artifact.filename }}
                              <template v-if="artifact.bytes"> · {{ formatFileSize(artifact.bytes) }}</template>
                              <template v-if="artifact.cacheKey"> · {{ artifact.cacheKey }}</template>
                            </span>
                            <div class="artifact-actions">
                              <a
                                :href="artifact.url"
                                target="_blank"
                                rel="noreferrer"
                                class="artifact-action"
                                title="Open"
                              >
                                <i class="pi pi-external-link" />
                              </a>
                              <button
                                v-if="artifact.kind === 'generated-pdf'"
                                type="button"
                                class="artifact-action"
                                title="Download PDF"
                                @click="downloadArtifact(artifact)"
                              >
                                <i class="pi pi-download" />
                              </button>
                              <a
                                v-else
                                :href="artifact.url"
                                :download="artifact.filename"
                                class="artifact-action"
                                title="Download"
                              >
                                <i class="pi pi-download" />
                              </a>
                            </div>
                          </div>
                          <img
                            v-if="artifact.kind === 'image'"
                            class="artifact-image"
                            :src="artifact.url"
                            :alt="artifact.title"
                          />
                          <iframe
                            v-else
                            class="artifact-frame"
                            :src="artifact.url"
                            :title="artifact.title"
                          />
                        </section>
                      </div>

                      <div v-if="turn.finalItem" class="final-response">
                        <MessageContentRenderer
                          v-if="turn.finalItem.content"
                          class="message-renderer"
                          :content="resolveViewPlaceholders(turn.finalItem.content)"
                        />
                        <div
                          v-else-if="turn.finalItem.status === 'running' || turn.finalItem.status === 'pending'"
                          class="typing-line"
                        >
                          <span />
                          <span />
                          <span />
                        </div>
                        <div v-else class="final-empty">No final response was generated.</div>
                      </div>
                      <div v-else-if="turn.terminalItem" class="final-response final-response--system">
                        <MessageContentRenderer
                          class="message-renderer"
                          :content="resolveViewPlaceholders(turn.terminalItem.content)"
                        />
                      </div>
                      <div v-else-if="turn.isRunning" class="final-response final-response--pending">
                        <div class="typing-line">
                          <span />
                          <span />
                          <span />
                        </div>
                      </div>
                      <div v-else-if="turn.hasError" class="final-response final-response--system final-response--error">
                        Run stopped before a final response was generated.
                      </div>
                    </div>
                  </article>
                </template>
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
                    v-for="group in harness.toolGroups.value"
                    :key="group.id"
                    class="toolset-group"
                    :class="{ muted: !group.active }"
                  >
                    <div class="toolset-row">
                      <button type="button" class="toolset-expand" :title="`${group.name} tools`" @click="toggleToolsetPanel(group.id)">
                        <i :class="isToolsetPanelExpanded(group.id) ? 'pi pi-angle-down' : 'pi pi-angle-right'" />
                      </button>
                      <i :class="group.icon" />
                      <div class="toolset-name">
                        <span>{{ group.name }}</span>
                        <small>{{ group.count }} / {{ group.total }}</small>
                      </div>
                      <button
                        type="button"
                        class="toolset-switch"
                        :class="{ active: group.active }"
                        :title="group.active ? 'Hide this category from the agent' : 'Expose this category to the agent'"
                        @click="harness.toggleToolsetForActiveAgent(group.id)"
                      >
                        <span />
                      </button>
                    </div>
                    <div v-if="isToolsetPanelExpanded(group.id)" class="tool-list">
                      <label
                        v-for="tool in group.tools"
                        :key="`${group.id}-${tool.name}`"
                        class="tool-toggle-row"
                        :class="{ disabled: !group.active || tool.permission === 'deny' }"
                        :title="tool.description"
                      >
                        <input
                          type="checkbox"
                          :checked="tool.enabledByAgent"
                          :disabled="!group.active || tool.permission === 'deny'"
                          @change="harness.toggleToolForActiveAgent(tool.name, !tool.enabledByAgent)"
                        />
                        <span>{{ tool.name }}</span>
                        <small :class="`risk-${tool.risk}`">{{ tool.risk }}</small>
                      </label>
                    </div>
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

    <Dialog
      v-model:visible="agentDialogVisible"
      modal
      :header="editingAgentId ? 'Edit Agent' : 'Create Agent'"
      :style="{ width: 'min(780px, 94vw)' }"
      class="agent-dialog"
    >
      <div class="agent-editor">
        <div class="agent-tabs">
          <button type="button" :class="{ active: agentEditorMode === 'manual' }" @click="agentEditorMode = 'manual'">
            Manual
          </button>
          <button type="button" :class="{ active: agentEditorMode === 'generate' }" @click="agentEditorMode = 'generate'">
            Generate with AI
          </button>
        </div>

        <section v-if="agentEditorMode === 'generate'" class="agent-generate-panel">
          <Textarea
            v-model="agentGeneratePrompt"
            class="agent-textarea"
            rows="4"
            placeholder="Describe the NetSuite agent you want: scope, tools, permission level, and tone."
          />
          <div class="agent-generate-actions">
            <span v-if="agentGenerateProgress" class="generate-progress">{{ agentGenerateProgress }}</span>
            <span v-else-if="agentGenerateError" class="generate-error">{{ agentGenerateError }}</span>
            <button type="button" class="agent-primary-btn" :disabled="agentGenerating" @click="generateAgentWithAi">
              <i :class="agentGenerating ? 'pi pi-spin pi-spinner' : 'pi pi-sparkles'" />
              <span>{{ agentGenerating ? "Generating" : "Generate" }}</span>
            </button>
          </div>
        </section>

        <section class="agent-form">
          <label>
            <span>Name</span>
            <InputText v-model="agentForm.name" class="agent-input" placeholder="SuiteScript Reviewer" />
          </label>
          <label>
            <span>Short label</span>
            <InputText v-model="agentForm.shortName" class="agent-input" placeholder="Review" />
          </label>
          <label>
            <span>Icon class</span>
            <InputText v-model="agentForm.icon" class="agent-input" placeholder="pi pi-shield" />
          </label>
          <label>
            <span>Color</span>
            <div class="agent-color-field">
              <ColorPicker v-model="agentColorValue" format="hex" />
              <InputText v-model="agentForm.color" class="agent-input" placeholder="#7c3aed" />
            </div>
          </label>
          <label class="agent-form-wide">
            <span>Description</span>
            <InputText v-model="agentForm.description" class="agent-input" placeholder="What this agent is best at" />
          </label>
          <label>
            <span>Default permission</span>
            <Select
              v-model="agentForm.defaultPermissionMode"
              :options="permissionOptions"
              option-label="label"
              option-value="id"
              class="agent-prime-field"
            >
              <template #option="{ option }">
                <div class="agent-select-option">
                  <i :class="option.icon" />
                  <div>
                    <strong>{{ option.label }}</strong>
                    <small>{{ option.title }}</small>
                  </div>
                </div>
              </template>
            </Select>
          </label>
          <label>
            <span>Step limit</span>
            <InputNumber
              v-model="agentForm.maxSteps"
              class="agent-prime-field"
              :min="1"
              :max="20"
              show-buttons
            />
          </label>
          <label class="agent-form-wide">
            <span>System prompt</span>
            <Textarea v-model="agentForm.systemFocus" class="agent-textarea" rows="5" auto-resize />
          </label>
        </section>

        <section class="agent-toolsets-editor">
          <div class="agent-toolsets-heading">
            <span>Tool categories visible to this agent</span>
            <small>{{ agentForm.toolsets.length }} categories</small>
          </div>
          <div class="agent-toolset-grid">
            <button
              v-for="toolset in harness.toolsets"
              :key="toolset.id"
              type="button"
              class="agent-toolset-chip"
              :class="{ active: agentForm.toolsets.includes(toolset.id) }"
              :title="toolset.description"
              @click="toggleAgentFormToolset(toolset.id)"
            >
              <i :class="toolset.icon" />
              <span>{{ toolset.name }}</span>
            </button>
          </div>
        </section>
      </div>

      <template #footer>
        <div class="agent-dialog-footer">
          <button
            v-if="editingAgentId && !agentForm.builtIn"
            type="button"
            class="agent-danger-btn"
            @click="deleteEditingAgent"
          >
            Delete
          </button>
          <span class="agent-footer-spacer" />
          <button type="button" class="agent-secondary-btn" @click="agentDialogVisible = false">Cancel</button>
          <button type="button" class="agent-primary-btn" @click="saveAgentForm">
            <i class="pi pi-check" />
            <span>Save Agent</span>
          </button>
        </div>
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import ColorPicker from "primevue/colorpicker";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Textarea from "primevue/textarea";
import MCard from "../components/universal/card/MCard.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MessageContentRenderer from "../components/MessageContentRenderer.vue";
import ToolApprovalDialog from "../components/ToolApprovalDialog.vue";
import {
  useNetsuiteAgentHarness,
  type HarnessAgent,
  type HarnessAgentDraft,
  type HarnessAttachment,
  type HarnessApprovalRequest,
  type HarnessToolsetId,
} from "../composables/useNetsuiteAgentHarness";
import { useAiProvider } from "../composables/useAiProvider";
import { useAgent } from "../composables/useAgent";
import type {
  HarnessItemRecord,
  HarnessPermissionMode,
} from "../utils/agentHarnessDb";
import { agentCache, cacheVersion } from "../utils/agentCacheStore";
import { netsuiteDocsTools } from "../utils/netsuiteDocsTools";
import { downloadDocumentAsPdf, extractPdfText } from "../utils/pdfUtils";

type HarnessItemView = Omit<Readonly<HarnessItemRecord>, "attachments"> & {
  readonly attachments?: readonly HarnessAttachment[];
};

type HarnessArtifactKind = "generated-pdf" | "pdf" | "image";

interface HarnessArtifactView {
  id: string;
  kind: HarnessArtifactKind;
  title: string;
  filename: string;
  url: string;
  bytes?: number;
  contentType?: string;
  cacheKey?: string;
  markdown?: string;
  htmlContent?: string;
}

interface HarnessTurnView {
  turnId: string;
  userItem: HarnessItemView | null;
  finalItem: HarnessItemView | null;
  terminalItem: HarnessItemView | null;
  actionItems: HarnessItemView[];
  artifacts: HarnessArtifactView[];
  createdAt: string;
  isRunning: boolean;
  hasError: boolean;
}

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
const { chatCompletion } = useAiProvider();

const prompt = ref("");
const streamRef = ref<HTMLDivElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const pendingAttachments = ref<HarnessAttachment[]>([]);
const isProcessingFiles = ref(false);
const isDragOver = ref(false);
const expandedToolIds = ref(new Set<string>());
const expandedToolsetIds = ref(new Set<HarnessToolsetId>());
const expandedActionTurnIds = ref(new Set<string>());
const collapsedActionTurnIds = ref(new Set<string>());
const editingItemId = ref<string | null>(null);
const editText = ref("");
const agentDialogVisible = ref(false);
const agentEditorMode = ref<"manual" | "generate">("manual");
const editingAgentId = ref<string | null>(null);
const agentGenerating = ref(false);
const agentGeneratePrompt = ref("");
const agentGenerateProgress = ref("");
const agentGenerateError = ref("");

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

const permissionOptions = modes;

const createBlankAgentForm = (): HarnessAgentDraft => ({
  name: "",
  shortName: "",
  icon: "pi pi-sparkles",
  color: "#7c3aed",
  description: "",
  defaultPermissionMode: "read",
  toolsets: ["context", "suiteql", "records", "docs"],
  maxSteps: 8,
  systemFocus:
    "Work as a focused NetSuite agent. Use live NetSuite tools for evidence, respect permissions, and return concise operational answers.",
  enabled: true,
});

const agentForm = ref<HarnessAgentDraft>(createBlankAgentForm());

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

const isAssistantMessage = (item: HarnessItemView): boolean =>
  item.kind === "message" && item.role === "assistant";

const isCallingAssistantMessage = (item: HarnessItemView): boolean =>
  isAssistantMessage(item) &&
  /^Calling\s+\d+\s+tool/i.test(item.content.trim());

const artifactPreviewUrls = new Map<string, string>();

const parseToolJson = (content: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const dataUrlContentType = (url: string): string | null => {
  const match = /^data:([^;,]+)(?:;[^,]*)?,/i.exec(url);
  return match?.[1]?.toLowerCase() ?? null;
};

const cacheDescriptionContentType = (description: string | undefined): string | null => {
  const match = /\(([^)]+)\)\s*$/.exec(description ?? "");
  return match?.[1]?.toLowerCase() ?? null;
};

const isPdfContentType = (contentType: string | null | undefined): boolean =>
  Boolean(contentType && contentType.toLowerCase().includes("application/pdf"));

const isImageContentType = (contentType: string | null | undefined): boolean =>
  Boolean(contentType && contentType.toLowerCase().startsWith("image/"));

const generatedPreviewUrl = (
  artifactId: string,
  htmlContent: string,
  fallbackUrl: string
): string => {
  if (!htmlContent) return fallbackUrl;
  const existing = artifactPreviewUrls.get(artifactId);
  if (existing) return existing;
  const url = URL.createObjectURL(
    new Blob([htmlContent], { type: "text/html;charset=utf-8" })
  );
  artifactPreviewUrls.set(artifactId, url);
  return url;
};

const cacheArtifact = (
  key: string,
  fallbackBytes?: number,
  fallbackContentType?: string
): HarnessArtifactView | null => {
  const entry = agentCache.get(key);
  const url = entry?.content ?? "";
  if (!url.startsWith("data:")) return null;

  const contentType =
    dataUrlContentType(url) ??
    fallbackContentType?.toLowerCase() ??
    cacheDescriptionContentType(entry?.description);
  const kind = isPdfContentType(contentType)
    ? "pdf"
    : isImageContentType(contentType)
      ? "image"
      : null;
  if (!kind) return null;

  const title = entry?.description || key;
  const extension = kind === "pdf" ? "pdf" : (contentType?.split("/")[1] || "image");
  return {
    id: `cache:${key}`,
    kind,
    title,
    filename: `${key}.${extension.replace(/[^a-z0-9]+/gi, "").slice(0, 12) || extension}`,
    url,
    bytes: fallbackBytes ?? entry?.sizeChars,
    contentType: contentType ?? undefined,
    cacheKey: key,
  };
};

const artifactFromAction = (item: HarnessItemView): HarnessArtifactView | null => {
  if (item.kind !== "tool") return null;
  const result = parseToolJson(item.content);
  if (!result) return null;

  if (item.toolName === "generate_pdf" && result.__pdf_result__) {
    const filename = String(result.filename ?? "document.pdf");
    const htmlContent = String(result.htmlContent ?? "");
    const fallbackUrl = String(result.url ?? "");
    if (!htmlContent && !fallbackUrl) return null;
    return {
      id: `${item.id}:generated-pdf`,
      kind: "generated-pdf",
      title: String(result.title ?? filename),
      filename,
      url: generatedPreviewUrl(item.id, htmlContent, fallbackUrl),
      bytes: Number(result.bytes ?? 0),
      markdown: String(result.markdown ?? ""),
      htmlContent,
      contentType: "text/html",
    };
  }

  const cacheKey = typeof result.cacheKey === "string"
    ? result.cacheKey
    : typeof result.key === "string"
      ? result.key
      : "";
  if (!cacheKey) return null;

  const contentType =
    typeof result.contentType === "string" ? result.contentType : undefined;
  const bytes = typeof result.sizeChars === "number" ? result.sizeChars : undefined;
  return cacheArtifact(cacheKey, bytes, contentType);
};

const buildArtifactsForItems = (items: HarnessItemView[]): HarnessArtifactView[] => {
  void cacheVersion.value;
  const seen = new Set<string>();
  const artifacts: HarnessArtifactView[] = [];
  for (const item of items) {
    const artifact = artifactFromAction(item);
    if (!artifact || seen.has(artifact.id)) continue;
    seen.add(artifact.id);
    artifacts.push(artifact);
  }
  return artifacts;
};

const findFinalAssistantIndex = (items: HarnessItemView[]): number => {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!;
    if (!isAssistantMessage(item) || isCallingAssistantMessage(item)) continue;
    const trimmedContent = item.content.trim();
    if (!trimmedContent) continue;
    if (item.status === "error" && /^\[no response\]$/i.test(trimmedContent)) continue;
    const hasLaterAction = items
      .slice(index + 1)
      .some((later) => later.kind === "tool" || later.kind === "approval");
    if (!hasLaterAction) return index;
  }
  return -1;
};

const displayTurns = computed<HarnessTurnView[]>(() => {
  const grouped = new Map<string, HarnessItemView[]>();
  for (const item of harness.items.value as HarnessItemView[]) {
    const group = grouped.get(item.turnId) ?? [];
    group.push(item);
    grouped.set(item.turnId, group);
  }

  return Array.from(grouped.entries()).map(([turnId, turnItems]) => {
    const userItem =
      turnItems.find((item) => item.kind === "message" && item.role === "user") ?? null;
    const finalIndex = findFinalAssistantIndex(turnItems);
    const finalItem = finalIndex >= 0 ? turnItems[finalIndex]! : null;
    const terminalItem =
      finalItem === null
        ? [...turnItems].reverse().find((item) => item.kind === "system") ?? null
        : null;
    const actionItems = turnItems.filter(
      (item) =>
        item.id !== userItem?.id &&
        item.id !== finalItem?.id &&
        item.id !== terminalItem?.id
    );
    const artifacts = buildArtifactsForItems(actionItems);
    const isRunning = turnItems.some(
      (item) => item.status === "running" || item.status === "pending"
    );
    const hasError = turnItems.some((item) => item.status === "error");

    return {
      turnId,
      userItem,
      finalItem,
      terminalItem,
      actionItems,
      artifacts,
      createdAt: turnItems[0]?.createdAt ?? new Date().toISOString(),
      isRunning,
      hasError,
    };
  });
});

const agentPillStyle = computed(() => ({
  background: `${harness.activeAgent.value.color}18`,
  borderColor: `${harness.activeAgent.value.color}55`,
  color: harness.activeAgent.value.color,
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

const agentColorValue = computed({
  get: () => agentForm.value.color.replace(/^#/, ""),
  set: (value: string | null) => {
    const normalized = String(value ?? "").replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
      agentForm.value.color = `#${normalized}`;
    }
  },
});

const agentForItem = (item: HarnessItemView): HarnessAgent =>
  harness.getAgentById(item.profileId);

const detectCacheLanguage = (content: string): string => {
  const text = content.trimStart();
  if (text.startsWith("{") || text.startsWith("[")) return "json";
  if (text.includes("@NApiVersion") || text.includes("define(") || /\bfunction\b/.test(text)) {
    return "javascript";
  }
  if (text.startsWith("<")) return "xml";
  if (/^SELECT\b/i.test(text)) return "sql";
  return "text";
};

const resolveViewPlaceholders = (content: string | null | undefined): string => {
  if (!content) return content ?? "";
  void cacheVersion.value;
  return content.replace(/\[VIEW:([^\]]+)\]/g, (_match, key: string) => {
    const entry = agentCache.get(key);
    if (!entry || !entry.content) {
      return `\n\n> **[Cache miss: \`${key}\`]** - This cached content is not loaded. Ask me to re-fetch it.\n\n`;
    }
    const contentType = dataUrlContentType(entry.content);
    if (isPdfContentType(contentType) || isImageContentType(contentType)) {
      return `\n\n> **Displayed cached ${isPdfContentType(contentType) ? "PDF" : "image"}:** \`${key}\`\n\n`;
    }
    const lang = detectCacheLanguage(entry.content);
    return `\n\n\`\`\`${lang}\n${entry.content}\n\`\`\`\n\n`;
  });
};

const openCreateAgentDialog = () => {
  editingAgentId.value = null;
  agentEditorMode.value = "manual";
  agentGeneratePrompt.value = "";
  agentGenerateError.value = "";
  agentGenerateProgress.value = "";
  agentForm.value = createBlankAgentForm();
  agentDialogVisible.value = true;
};

const openEditAgentDialog = (agent: Readonly<HarnessAgent>) => {
  editingAgentId.value = agent.id;
  agentEditorMode.value = "manual";
  agentGeneratePrompt.value = "";
  agentGenerateError.value = "";
  agentGenerateProgress.value = "";
  agentForm.value = {
    id: agent.id,
    name: agent.name,
    shortName: agent.shortName,
    icon: agent.icon,
    color: agent.color,
    description: agent.description,
    defaultPermissionMode: agent.defaultPermissionMode,
    toolsets: [...agent.toolsets],
    enabledToolNames: agent.enabledToolNames ? [...agent.enabledToolNames] : undefined,
    maxSteps: agent.maxSteps,
    systemFocus: agent.systemFocus,
    enabled: agent.enabled !== false,
    builtIn: agent.builtIn,
  };
  agentDialogVisible.value = true;
};

const toggleAgentFormToolset = (toolsetId: HarnessToolsetId) => {
  const selected = new Set(agentForm.value.toolsets);
  if (selected.has(toolsetId)) selected.delete(toolsetId);
  else selected.add(toolsetId);
  agentForm.value.toolsets = Array.from(selected);
};

const saveAgentForm = async () => {
  if (!agentForm.value.name.trim()) return;
  const saved = await harness.saveAgent({
    ...agentForm.value,
    shortName: agentForm.value.shortName.trim() || agentForm.value.name.trim().slice(0, 18),
    systemFocus: agentForm.value.systemFocus.trim() || createBlankAgentForm().systemFocus,
  });
  await harness.setActiveAgent(saved.id);
  agentDialogVisible.value = false;
};

const deleteEditingAgent = async () => {
  if (!editingAgentId.value) return;
  await harness.removeAgent(editingAgentId.value);
  agentDialogVisible.value = false;
};

const generateAgentWithAi = async () => {
  const request = agentGeneratePrompt.value.trim();
  if (!request || agentGenerating.value) return;

  agentGenerating.value = true;
  agentGenerateError.value = "";
  agentGenerateProgress.value = "";

  try {
    const toolList = harness.toolCatalog.value
      .map((tool) => `${tool.name} [${tool.toolsetIds.join(", ")}; risk=${tool.risk}] - ${tool.description}`)
      .join("\n");
    const toolsetList = harness.toolsets
      .map((toolset) => `${toolset.id}: ${toolset.name} - ${toolset.description}`)
      .join("\n");

    const systemPrompt = `You generate focused NetSuite agent configurations for the Magic NetSuite Agent Harness.
Return one raw JSON object only. Do not wrap it in markdown.

Before generating, use the NetSuite documentation tools when the requested agent depends on NetSuite product behavior.

Available toolsets:
${toolsetList}

Available tool names:
${toolList}

JSON schema:
{
  "name": "2-5 word agent name",
  "shortName": "1-2 word label",
  "description": "One sentence",
  "systemFocus": "Detailed agent system prompt for this specialty",
  "defaultPermissionMode": "read" | "build" | "release",
  "toolsets": ["context"],
  "enabledToolNames": ["exact_tool_name"],
  "maxSteps": 8,
  "icon": "pi pi-compass",
  "color": "#7c3aed"
}

Rules:
- Only use toolset ids from the available toolsets.
- Only use enabledToolNames from the available tool names.
- Use read for auditors/explorers, build for preparation, release for deployment-sensitive agents.
- Keep maxSteps between 4 and 14.
- Use a light slate/lavender compatible color, not black or dark-mode colors.`;

    const generator = useAgent({
      chatCompletion,
      systemPrompt,
      tools: netsuiteDocsTools,
      keepHistory: false,
      onToolStart: (name, input) => {
        const inputRecord = input as Record<string, unknown>;
        if (name === "search_netsuite_docs") {
          agentGenerateProgress.value = `Searching docs: ${String(inputRecord.query ?? "")}`;
        } else if (name === "read_netsuite_doc_page") {
          agentGenerateProgress.value = "Reading NetSuite docs";
        } else {
          agentGenerateProgress.value = `Using ${name}`;
        }
      },
      onToolResult: () => {
        agentGenerateProgress.value = "Shaping agent";
      },
    });

    await generator.run(request);
    const lastMessage = [...generator.history.value]
      .reverse()
      .find((message) => message.role === "assistant");
    const raw = (lastMessage?.content ?? "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(raw) as Partial<HarnessAgentDraft>;
    const validToolsets = new Set(harness.toolsets.map((toolset) => toolset.id));
    const validTools = new Set(harness.toolCatalog.value.map((tool) => tool.name));
    const validModes = new Set<HarnessPermissionMode>(["read", "build", "release"]);
    const generatedToolsets = Array.isArray(parsed.toolsets)
      ? parsed.toolsets.filter((id): id is HarnessToolsetId => validToolsets.has(id as HarnessToolsetId))
      : createBlankAgentForm().toolsets;
    const generatedTools = Array.isArray(parsed.enabledToolNames)
      ? parsed.enabledToolNames.filter((name) => validTools.has(name))
      : undefined;
    const generatedColor =
      typeof parsed.color === "string" && /^#[0-9a-fA-F]{6}$/.test(parsed.color)
        ? parsed.color
        : "#7c3aed";

    agentForm.value = {
      ...createBlankAgentForm(),
      ...agentForm.value,
      name: String(parsed.name || agentForm.value.name || "Generated Agent"),
      shortName: String(parsed.shortName || parsed.name || "Agent").slice(0, 18),
      description: String(parsed.description || "Generated NetSuite agent."),
      systemFocus: String(parsed.systemFocus || createBlankAgentForm().systemFocus),
      defaultPermissionMode: validModes.has(parsed.defaultPermissionMode as HarnessPermissionMode)
        ? (parsed.defaultPermissionMode as HarnessPermissionMode)
        : "read",
      toolsets: generatedToolsets.length > 0 ? generatedToolsets : ["context"],
      enabledToolNames: generatedTools,
      maxSteps: Math.max(1, Math.min(20, Number(parsed.maxSteps || 8))),
      icon: String(parsed.icon || "pi pi-sparkles"),
      color: generatedColor,
      builtIn: false,
    };
    agentEditorMode.value = "manual";
  } catch (err) {
    agentGenerateError.value = `Generation failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    agentGenerating.value = false;
    agentGenerateProgress.value = "";
  }
};

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
  prompt.value = "";
  pendingAttachments.value = [];
  editingItemId.value = null;
  editText.value = "";
  await harness.runTurn(text, { attachments });
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
  editText.value = item.content;
};

const cancelEdit = () => {
  editingItemId.value = null;
  editText.value = "";
};

const saveEdit = async (item: HarnessItemView) => {
  if (item.role !== "user" || harness.loading.value) return;
  const text = editText.value.trim();
  const attachments = item.attachments
    ? item.attachments.map((attachment) => ({ ...attachment }))
    : undefined;
  if (!text && (!attachments || attachments.length === 0)) return;
  editingItemId.value = null;
  editText.value = "";
  await harness.rerunFromItem(item.id, text, { attachments });
  await scrollToBottom();
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

const firstActionItem = (turn: HarnessTurnView): HarnessItemView | null =>
  turn.finalItem ?? turn.terminalItem ?? turn.actionItems[0] ?? turn.userItem;

const turnIcon = (turn: HarnessTurnView): string => {
  const item = firstActionItem(turn);
  return item ? itemIcon(item) : harness.activeAgent.value.icon;
};

const turnIconClass = (turn: HarnessTurnView): string => {
  const item = firstActionItem(turn);
  if (!item) return "item-icon--done";
  if (turn.isRunning) return "item-icon--running";
  if (turn.hasError) return "item-icon--error";
  return itemIconClass(item);
};

const assistantTurnTitle = (turn: HarnessTurnView): string => {
  if (turn.finalItem?.title === "Final synthesis") return "Final response";
  if (turn.finalItem) return itemTitle(turn.finalItem);
  if (turn.terminalItem) return itemTitle(turn.terminalItem);
  return turn.isRunning ? "Working" : "Agent work";
};

const assistantTurnTime = (turn: HarnessTurnView): string =>
  (turn.finalItem ?? turn.terminalItem ?? turn.actionItems[0])?.createdAt ?? turn.createdAt;

const actionSummaryLabel = (turn: HarnessTurnView): string => {
  const count = turn.actionItems.length;
  const toolCount = turn.actionItems.filter(
    (item) => item.kind === "tool" || item.kind === "approval"
  ).length;
  const passCount = count - toolCount;
  const pieces = [
    `${count} action${count === 1 ? "" : "s"}`,
    toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : "",
    passCount > 0 ? `${passCount} pass${passCount === 1 ? "" : "es"}` : "",
  ].filter(Boolean);
  return `${turn.isRunning ? "Working" : "Actions"} · ${pieces.join(" · ")}`;
};

const isActionGroupExpanded = (turn: HarnessTurnView): boolean => {
  if (collapsedActionTurnIds.value.has(turn.turnId)) return false;
  return turn.isRunning || expandedActionTurnIds.value.has(turn.turnId);
};

const toggleActionGroup = (turnId: string) => {
  const expanded = new Set(expandedActionTurnIds.value);
  const collapsed = new Set(collapsedActionTurnIds.value);
  const turn = displayTurns.value.find((candidate) => candidate.turnId === turnId);
  const currentlyExpanded = turn ? isActionGroupExpanded(turn) : expanded.has(turnId);

  if (currentlyExpanded) {
    expanded.delete(turnId);
    collapsed.add(turnId);
  } else {
    collapsed.delete(turnId);
    expanded.add(turnId);
  }

  expandedActionTurnIds.value = expanded;
  collapsedActionTurnIds.value = collapsed;
};

const itemIcon = (item: HarnessItemView): string => {
  if (item.kind === "tool") return "pi pi-bolt";
  if (item.kind === "approval") return "pi pi-lock";
  if (item.kind === "system") return "pi pi-info-circle";
  if (item.role === "user") return "pi pi-user";
  return agentForItem(item).icon;
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
  return item.title || agentForItem(item).shortName;
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

const isToolsetPanelExpanded = (toolsetId: HarnessToolsetId): boolean =>
  expandedToolsetIds.value.has(toolsetId);

const toggleToolsetPanel = (toolsetId: HarnessToolsetId) => {
  const next = new Set(expandedToolsetIds.value);
  if (next.has(toolsetId)) next.delete(toolsetId);
  else next.add(toolsetId);
  expandedToolsetIds.value = next;
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

const artifactIcon = (artifact: HarnessArtifactView): string => {
  if (artifact.kind === "image") return "pi pi-image";
  return "pi pi-file-pdf";
};

const downloadArtifact = async (artifact: HarnessArtifactView) => {
  if (artifact.kind !== "generated-pdf") return;
  await downloadDocumentAsPdf(
    artifact.markdown ?? "",
    artifact.title || artifact.filename,
    artifact.filename
  );
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

onBeforeUnmount(() => {
  for (const url of artifactPreviewUrls.values()) {
    URL.revokeObjectURL(url);
  }
  artifactPreviewUrls.clear();
});
</script>

<style scoped>
.harness-view {
  --harness-accent: #7c3aed;
  --harness-accent-strong: #6d28d9;
  --harness-accent-soft: #f5f3ff;
  --harness-accent-softer: #faf9ff;
  --harness-accent-mid: #ede9fe;
  --harness-accent-border: #ddd6fe;
  --harness-indigo-soft: #eef2ff;
  --harness-indigo-border: #c7d2fe;
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
  background:
    linear-gradient(180deg, #f8fafc 0%, var(--harness-accent-soft) 56%, #eef2f7 100%);
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
  background: var(--harness-accent-soft);
  border-color: #c4b5fd;
  color: var(--harness-accent-strong);
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

.profile-row,
.thread-item {
  width: 100%;
  border: 1px solid transparent;
  background: transparent;
  color: var(--p-slate-600);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.14s ease;
}

.profile-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 26px;
  align-items: center;
  overflow: hidden;
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
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.profile-mark {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.profile-row:hover,
.thread-item:hover {
  background: rgba(255, 255, 255, 0.72);
  border-color: var(--p-slate-200);
}

.profile-row.active,
.thread-item.active {
  background: white;
  border-color: #c4b5fd;
  box-shadow: 0 1px 0 rgba(124, 58, 237, 0.08), 0 8px 20px rgba(100, 116, 139, 0.08);
  color: var(--p-slate-800);
}

.agent-row-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-right: 4px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--p-slate-400);
  cursor: pointer;
  opacity: 0;
}

.profile-row:hover .agent-row-action,
.profile-row.active .agent-row-action {
  opacity: 1;
}

.agent-row-action:hover {
  background: var(--harness-accent-soft);
  color: var(--harness-accent-strong);
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
  background: var(--harness-accent-mid);
  color: var(--harness-accent-strong);
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
  color: var(--harness-accent-strong);
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
    linear-gradient(180deg, rgba(245, 243, 255, 0.42), transparent 180px),
    linear-gradient(90deg, rgba(248, 250, 252, 0.72), transparent 320px),
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
  background: var(--harness-accent-mid);
  color: var(--harness-accent);
  border: 1px solid var(--harness-accent-border);
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
  color: var(--harness-accent-strong);
  background: var(--harness-accent-softer);
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
  background: var(--harness-accent-soft);
  color: var(--harness-accent);
  border-color: var(--harness-accent-border);
}

.item-icon--running {
  background: var(--harness-indigo-soft);
  color: #4f46e5;
  border-color: var(--harness-indigo-border);
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
  border-color: var(--harness-accent-border);
  background: var(--harness-accent-soft);
  color: var(--harness-accent-strong);
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
  background: var(--harness-indigo-soft);
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

.message-renderer :deep(.md-table) {
  border-radius: 8px;
  box-shadow: 0 1px 0 rgba(124, 58, 237, 0.06);
}

.message-renderer :deep(.md-table th) {
  background: var(--harness-accent-soft);
  color: #5b21b6;
}

.message-renderer :deep(.md-table tr:hover td) {
  background: var(--harness-accent-softer);
}

.message-renderer :deep(.code-block-header) {
  background: #f8fafc;
  border-bottom-color: var(--p-slate-200);
}

.message-renderer :deep(.code-lang),
.message-renderer :deep(.code-copy-btn) {
  color: var(--p-slate-500);
}

.message-renderer :deep(.code-copy-btn),
.message-renderer :deep(.code-action-btn) {
  border-color: var(--p-slate-200);
  background: white;
}

.message-renderer :deep(.code-copy-btn:hover),
.message-renderer :deep(.code-action-btn:hover) {
  background: var(--harness-accent-soft);
  color: var(--harness-accent-strong);
  border-color: #c4b5fd;
}

.stream-item--message .item-content {
  padding: 4px 0;
}

.stream-item--message.stream-item--done .item-content {
  color: var(--p-slate-700);
}

.stream-item--assistant-turn {
  margin-bottom: 18px;
}

.assistant-turn-content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8px;
}

.harness-msg-edit-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
}

.harness-msg-edit-textarea {
  width: 100%;
  min-height: 84px;
  resize: vertical;
  border: 1px solid var(--p-slate-300);
  border-radius: 8px;
  padding: 9px 10px;
  background: #ffffff;
  color: var(--p-slate-800);
  font: inherit;
  font-size: 0.84rem;
  line-height: 1.45;
  outline: none;
}

.harness-msg-edit-textarea:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.18);
}

.harness-msg-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
}

.harness-msg-edit-cancel,
.harness-msg-edit-save {
  min-height: 28px;
  border-radius: 6px;
  padding: 4px 9px;
  font-size: 0.7rem;
  font-weight: 750;
  cursor: pointer;
}

.harness-msg-edit-cancel {
  border: 1px solid var(--p-slate-200);
  background: white;
  color: var(--p-slate-500);
}

.harness-msg-edit-save {
  border: 1px solid #7c3aed;
  background: #7c3aed;
  color: white;
}

.action-group {
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  background: #ffffff;
}

.action-group--running {
  border-color: var(--harness-indigo-border);
  background: #f8faff;
}

.action-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 32px;
  border: none;
  padding: 5px 8px;
  background: linear-gradient(90deg, #f8fafc 0%, var(--harness-accent-softer) 100%);
  color: var(--p-slate-600);
  cursor: pointer;
  font: inherit;
}

.action-summary-left {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 650;
}

.action-summary-left i {
  color: var(--p-slate-400);
  font-size: 0.66rem;
}

.action-summary-icons {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.action-mini-icon,
.action-row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--p-slate-200);
  background: white;
}

.action-mini-icon {
  width: 16px;
  height: 16px;
  border-radius: 5px;
  font-size: 0.52rem;
}

.action-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  border-top: 1px solid var(--p-slate-200);
}

.action-row {
  min-width: 0;
  border-top: 1px solid color-mix(in srgb, var(--p-slate-200) 70%, transparent);
}

.action-row:first-child {
  border-top: none;
}

.action-row-main {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto 16px;
  align-items: center;
  gap: 7px;
  width: 100%;
  border: none;
  padding: 6px 8px;
  background: white;
  color: var(--p-slate-600);
  text-align: left;
  cursor: pointer;
  font: inherit;
}

.action-row-main:hover {
  background: var(--harness-accent-softer);
}

.action-row-icon {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  font-size: 0.56rem;
}

.action-row-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.action-row-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--p-slate-700);
  font-size: 0.75rem;
  font-weight: 650;
}

.action-row-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--p-slate-400);
  font-size: 0.7rem;
}

.action-row-latency {
  color: var(--p-slate-400);
  font-size: 0.68rem;
  font-weight: 650;
}

.action-row-chevron {
  color: var(--p-slate-300);
  font-size: 0.62rem;
}

.action-row-details {
  border-top: 1px solid var(--p-slate-200);
  background: #ffffff;
}

.action-message-renderer {
  padding: 8px 10px;
  font-size: 0.76rem;
  line-height: 1.5;
}

.artifact-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.artifact-card {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--harness-accent-border) 60%, var(--p-slate-200));
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 30px rgba(124, 58, 237, 0.06);
}

.artifact-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--p-slate-200);
  background: linear-gradient(90deg, var(--harness-accent-soft) 0%, #f8fafc 100%);
}

.artifact-title {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 7px;
  color: var(--p-slate-800);
  font-size: 0.76rem;
  font-weight: 750;
}

.artifact-title i {
  color: var(--harness-accent);
  font-size: 0.72rem;
}

.artifact-title span,
.artifact-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-meta {
  max-width: 360px;
  color: var(--p-slate-400);
  font-size: 0.66rem;
  font-weight: 650;
}

.artifact-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.artifact-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  background: white;
  color: var(--p-slate-500);
  cursor: pointer;
  text-decoration: none;
}

.artifact-action:hover {
  border-color: #c4b5fd;
  background: var(--harness-accent-soft);
  color: var(--harness-accent);
}

.artifact-frame {
  display: block;
  width: 100%;
  height: min(56vh, 620px);
  min-height: 360px;
  border: none;
  background: white;
}

.artifact-image {
  display: block;
  width: 100%;
  max-height: min(62vh, 720px);
  object-fit: contain;
  background:
    linear-gradient(45deg, var(--p-slate-50) 25%, transparent 25%),
    linear-gradient(-45deg, var(--p-slate-50) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--p-slate-50) 75%),
    linear-gradient(-45deg, transparent 75%, var(--p-slate-50) 75%);
  background-color: #ffffff;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
}

.final-response {
  min-width: 0;
}

.final-response--pending {
  min-height: 30px;
}

.final-response--system {
  padding: 8px 10px;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  background: #f8fafc;
}

.final-response--error,
.final-empty {
  color: var(--p-slate-500);
  font-size: 0.78rem;
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
  background: var(--harness-accent-softer);
  border-bottom: 1px solid var(--harness-accent-mid);
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
  background: var(--harness-accent-soft);
  color: var(--harness-accent-strong);
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
  border: 1px solid var(--harness-accent-border);
  border-radius: 6px;
  background: var(--harness-accent-softer);
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

.tool-activity-row {
  display: grid;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.toolset-group {
  border: 1px solid transparent;
  border-radius: 7px;
  margin-bottom: 5px;
}

.toolset-group.muted {
  opacity: 0.62;
}

.toolset-row {
  display: grid;
  grid-template-columns: 18px 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 6px 4px;
  color: var(--p-slate-600);
  font-size: 0.75rem;
}

.toolset-row i {
  color: #7c3aed;
  font-size: 0.75rem;
}

.toolset-expand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--p-slate-400);
  cursor: pointer;
}

.toolset-expand:hover {
  background: var(--harness-accent-soft);
  color: var(--harness-accent-strong);
}

.toolset-name {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.toolset-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolset-name small {
  font-size: 0.62rem;
  color: var(--p-slate-400);
}

.toolset-switch {
  position: relative;
  width: 30px;
  height: 17px;
  border: 1px solid var(--p-slate-300);
  border-radius: 99px;
  background: var(--p-slate-100);
  cursor: pointer;
}

.toolset-switch span {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.2);
  transition: transform 0.14s ease;
}

.toolset-switch.active {
  border-color: #c4b5fd;
  background: var(--harness-accent-mid);
}

.toolset-switch.active span {
  transform: translateX(13px);
  background: #7c3aed;
}

.tool-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 2px 4px 8px 28px;
}

.tool-toggle-row {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--p-slate-600);
  font-size: 0.66rem;
}

.tool-toggle-row input {
  width: 13px;
  height: 13px;
  accent-color: #7c3aed;
}

.tool-toggle-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: "JetBrains Mono", monospace;
}

.tool-toggle-row small {
  border-radius: 99px;
  padding: 1px 5px;
  font-size: 0.55rem;
  font-weight: 800;
  text-transform: uppercase;
}

.tool-toggle-row.disabled {
  color: var(--p-slate-400);
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

.agent-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--p-slate-700);
}

.agent-tabs {
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-self: flex-start;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  background: #f8fafc;
}

.agent-tabs button,
.agent-primary-btn,
.agent-secondary-btn,
.agent-danger-btn,
.agent-toolset-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 7px;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 750;
  cursor: pointer;
}

.agent-tabs button {
  border: none;
  padding: 6px 10px;
  background: transparent;
  color: var(--p-slate-500);
}

.agent-tabs button.active {
  background: white;
  color: #6d28d9;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

.agent-generate-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--harness-accent-border);
  border-radius: 8px;
  background: var(--harness-accent-softer);
}

.agent-generate-actions,
.agent-dialog-footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.generate-progress {
  color: #6d28d9;
  font-size: 0.75rem;
  font-weight: 700;
}

.generate-error {
  color: var(--p-red-600);
  font-size: 0.75rem;
  font-weight: 700;
}

.agent-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.agent-form label,
.agent-toolsets-editor {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.agent-form label span,
.agent-toolsets-heading {
  color: var(--p-slate-500);
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.agent-form-wide {
  grid-column: 1 / -1;
}

.agent-input,
.agent-textarea {
  width: 100%;
  border: 1px solid var(--p-slate-300);
  border-radius: 7px;
  background: white;
  color: var(--p-slate-800);
  font: inherit;
  font-size: 0.82rem;
  outline: none;
}

.agent-input {
  min-height: 34px;
  padding: 7px 9px;
}

.agent-prime-field,
.agent-prime-field :deep(.p-inputnumber-input) {
  width: 100%;
}

.agent-prime-field :deep(.p-select-label),
.agent-prime-field :deep(.p-inputnumber-input) {
  font-size: 0.82rem;
}

.agent-color-field {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.agent-color-field :deep(.p-colorpicker-preview) {
  width: 34px;
  height: 34px;
  border: 1px solid var(--p-slate-300);
  border-radius: 7px;
}

.agent-textarea {
  resize: vertical;
  min-height: 78px;
  padding: 8px 9px;
  line-height: 1.45;
}

.agent-input:focus,
.agent-textarea:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.16);
}

.agent-select-option {
  display: flex;
  align-items: center;
  gap: 9px;
}

.agent-select-option i {
  color: #7c3aed;
  font-size: 0.78rem;
}

.agent-select-option div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.agent-select-option strong {
  color: var(--p-slate-700);
  font-size: 0.78rem;
}

.agent-select-option small {
  color: var(--p-slate-400);
  font-size: 0.68rem;
}

.agent-toolsets-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.agent-toolsets-heading small {
  color: var(--p-slate-400);
  font-size: 0.68rem;
  text-transform: none;
}

.agent-toolset-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.agent-toolset-chip {
  min-height: 34px;
  border: 1px solid var(--p-slate-200);
  background: white;
  color: var(--p-slate-600);
}

.agent-toolset-chip.active {
  border-color: #c4b5fd;
  background: var(--harness-accent-soft);
  color: var(--harness-accent-strong);
}

.agent-dialog-footer {
  width: 100%;
}

.agent-footer-spacer {
  flex: 1;
}

.agent-primary-btn,
.agent-secondary-btn,
.agent-danger-btn {
  min-height: 34px;
  border: 1px solid transparent;
  padding: 7px 12px;
}

.agent-primary-btn {
  background: var(--p-slate-800);
  color: white;
}

.agent-primary-btn:hover:not(:disabled) {
  background: #6d28d9;
}

.agent-primary-btn:disabled {
  background: var(--p-slate-300);
  cursor: not-allowed;
}

.agent-secondary-btn {
  border-color: var(--p-slate-200);
  background: white;
  color: var(--p-slate-600);
}

.agent-secondary-btn:hover {
  border-color: #c4b5fd;
  background: var(--harness-accent-soft);
  color: var(--harness-accent-strong);
}

.agent-danger-btn {
  border-color: var(--p-red-200);
  background: var(--p-red-50);
  color: var(--p-red-600);
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

  .agent-form,
  .agent-toolset-grid {
    grid-template-columns: 1fr;
  }
}
</style>
