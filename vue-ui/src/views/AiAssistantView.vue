<template>
  <div class="ai-assistant-view">
    <MCard
      flex
      direction="row"
      gap="0"
      autoHeight
      outlined
      elevated
      padding=""
      :style="{ height: `${vhOffset}vh` }"
    >
      <template #default>
        <ExpandableSidebar
          :default-expanded="true"
          expanded-width="280px"
          collapsed-width="3rem"
        >
          <template #collapsed>
            <Button
              class="p-2!"
              size="small"
              @click="createNewChat"
              title="New Chat"
            >
              <i class="pi pi-plus"></i>
            </Button>
          </template>
          <template #default>
            <div class="sidebar-header">
              <h3>Chat History</h3>
              <Button class="p-2!" size="small" @click="createNewChat">
                <i class="pi pi-plus"></i>
                New Chat
              </Button>
            </div>
            <div class="chat-list">
              <div
                v-for="chat in chatHistory"
                :key="chat.id"
                class="chat-item"
                :class="{ active: activeChatId === chat.id }"
                @click="loadChat(chat.id)"
              >
                <div class="chat-item-content">
                  <span class="chat-title">{{ chat.title }}</span>
                  <span class="chat-date">{{
                    formatDate(chat.updatedAt)
                  }}</span>
                </div>
                <button
                  class="chat-delete-btn"
                  @click.stop="deleteChat(chat.id)"
                  title="Delete chat"
                >
                  <i class="pi pi-trash"></i>
                </button>
              </div>
              <div v-if="chatHistory.length === 0" class="no-chats">
                No chat history yet
              </div>
            </div>
          </template>
        </ExpandableSidebar>

        <div
          class="chat-area"
          :class="{ 'chat-drag-over': isDragOverChat }"
          @dragenter.prevent="onChatDragEnter"
          @dragover.prevent="onChatDragOver"
          @dragleave="onChatDragLeave"
          @drop.prevent="onChatDrop"
        >
          <!-- Drag zone overlay (FileCabinet-style) -->
          <div v-if="isDragOverChat" class="chat-drop-overlay">
            <i class="pi pi-cloud-upload" style="font-size: 2.5rem; color: var(--p-indigo-500)" />
            <p>Drop files to attach</p>
            <span>PDF, text, code files supported</span>
          </div>
          <!-- Empty state -->
          <div v-if="messages.length === 0" class="empty-state">
            <div class="empty-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <rect
                  width="40"
                  height="40"
                  rx="12"
                  fill="var(--p-slate-100)"
                />
                <path
                  d="M13 20c0-3.866 3.134-7 7-7s7 3.134 7 7"
                  stroke="var(--p-slate-400)"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
                <circle cx="20" cy="20" r="2.5" fill="var(--p-slate-400)" />
              </svg>
            </div>
            <p class="empty-title">How can I help you?</p>
            <p class="empty-sub">
              Ask me about NetSuite scripts, records, or any development
              question.
            </p>
          </div>

          <!-- Message thread -->
          <div v-else class="message-list" ref="messageListRef">
            <!-- Agent todos panel — sticky at top of chat while agent is working -->
            <div v-if="agentTodos.length > 0" class="agent-todos-panel">
              <div class="agent-todos-header" @click="todosPanelCollapsed = !todosPanelCollapsed">
                <i class="pi pi-check-square agent-todos-icon" />
                <span class="agent-todos-title">Agent Tasks</span>
                <span class="agent-todos-progress">
                  {{ agentTodos.filter(t => t.status === 'done').length }}/{{ agentTodos.length }}
                </span>
                <i :class="todosPanelCollapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'" class="agent-todos-chevron" />
              </div>
              <div v-if="!todosPanelCollapsed" class="agent-todos-list">
                <div
                  v-for="todo in agentTodos"
                  :key="todo.id"
                  :class="['todo-item', `todo-${todo.status}`]"
                >
                  <i :class="{
                    'pi pi-check-circle': todo.status === 'done',
                    'pi pi-spin pi-spinner': todo.status === 'in_progress',
                    'pi pi-circle': todo.status === 'pending'
                  }" class="todo-icon" />
                  <span class="todo-content">{{ todo.content }}</span>
                </div>
              </div>
            </div>

            <template v-for="msg in messages" :key="msg.id">
              <!-- Compaction indicator -->
              <div v-if="msg.role === 'compaction'" class="msg msg-compaction">
                <details class="compaction-details">
                  <summary class="compaction-summary">
                    <i class="pi pi-bolt compaction-icon" />
                    <span>
                      Context compacted — {{ msg.compactedCount }} earlier
                      messages summarized
                    </span>
                    <i class="pi pi-chevron-down compaction-chevron" />
                  </summary>
                  <div class="compaction-content">
                    <MessageContentRenderer :content="msg.content" @open-in-sql-editor="openInSqlEditor" @question-answer="handleQuestionAnswer" />
                  </div>
                </details>
              </div>

              <!-- User message -->
              <div v-else-if="msg.role === 'user'" class="msg msg-user">
                <div
                  v-if="msg.agentContext"
                  class="msg-agent-chip"
                  :style="chipStyle(msg.agentContext.color)"
                >
                  <span class="chip-dot" :style="{ background: msg.agentContext.color }" />
                  /{{ msg.agentContext.slug }}
                </div>
                <!-- Attachment chips on sent message -->
                <div v-if="msg.attachments && msg.attachments.length > 0" class="msg-attachments">
                  <div
                    v-for="(att, idx) in msg.attachments"
                    :key="idx"
                    class="msg-attachment-chip"
                  >
                    <i :class="att.type === 'pdf' ? 'pi pi-file-pdf' : 'pi pi-file'" class="attachment-chip-icon" />
                    <span class="attachment-chip-name">{{ att.name }}</span>
                    <span class="attachment-chip-size">{{ formatFileSize(att.size) }}</span>
                  </div>
                </div>
                <div class="msg-user-bubble-row">
                  <div v-if="editingMessageId === msg.id" class="msg-edit-area">
                    <textarea v-model="editText" class="msg-edit-textarea" />
                    <div class="msg-edit-actions">
                      <button class="msg-edit-btn-cancel" @click="cancelEdit">Cancel</button>
                      <button class="msg-edit-btn-save" @click="saveEdit(msg)">Save & Resubmit</button>
                    </div>
                  </div>
                  <template v-else>
                    <div class="msg-user-content">{{ msg.content }}</div>
                    <button
                      v-if="!loading"
                      class="msg-edit-btn"
                      @click="startEdit(msg)"
                      title="Edit message"
                    >
                      <i class="pi pi-pencil" />
                    </button>
                  </template>
                </div>
              </div>

              <!-- Assistant message -->
              <div
                v-else-if="msg.role === 'assistant'"
                class="msg msg-assistant"
              >
                <!-- Agent chip on assistant response -->
                <div
                  v-if="msg.agentContext"
                  class="msg-agent-chip msg-agent-chip--assistant"
                  :style="chipStyle(msg.agentContext.color)"
                >
                  <span class="chip-dot" :style="{ background: msg.agentContext.color }" />
                  {{ msg.agentContext.name }}
                </div>

                <!-- Thinking / Reasoning block -->
                <details
                  v-if="msg.thinking"
                  class="thinking-block"
                >
                  <summary class="thinking-block-summary">
                    <i class="pi pi-sparkles thinking-block-icon" />
                    <span>Reasoning</span>
                    <i class="pi pi-chevron-down thinking-block-chevron" />
                  </summary>
                  <pre class="thinking-block-content">{{ msg.thinking }}</pre>
                </details>
                <!-- Skill usage (shown above tools with distinct styling) -->
                <div
                  v-if="
                    getSkillMessagesForAssistant(msg.id).length > 0 ||
                    (msg.isStreaming &&
                      msg.id === currentAssistantMsgId &&
                      inProgressTools.filter(
                        (t) => t.status === 'running' && isSkillTool(t.name)
                      ).length > 0)
                  "
                  class="skill-group"
                >
                  <!-- While streaming: show running skills -->
                  <template
                    v-if="
                      msg.isStreaming &&
                      msg.id === currentAssistantMsgId &&
                      inProgressTools.filter(
                        (t) => t.status === 'running' && isSkillTool(t.name)
                      ).length > 0
                    "
                  >
                    <div
                      v-for="tm in inProgressTools.filter(
                        (t) => t.status === 'running' && isSkillTool(t.name)
                      )"
                      :key="'skill-running-' + tm.name"
                      class="skill-item skill-item-running"
                    >
                      <div class="skill-indicator">
                        <span class="skill-spinner" />
                      </div>
                      <span class="skill-label">{{
                        getSkillDisplayName(tm.name)
                      }}</span>
                    </div>
                  </template>
                  <!-- Completed skills -->
                  <template v-else>
                    <details class="skill-details">
                      <summary class="skill-summary">
                        <i class="pi pi-book skill-icon" />
                        <span>
                          Used
                          {{
                            getSkillMessagesForAssistant(msg.id).filter(
                              (m) => m.toolName === "load_skill"
                            ).length
                          }}
                          skill{{
                            getSkillMessagesForAssistant(msg.id).filter(
                              (m) => m.toolName === "load_skill"
                            ).length > 1
                              ? "s"
                              : ""
                          }}
                        </span>
                        <i class="pi pi-chevron-down skill-chevron" />
                      </summary>
                      <div class="skill-results-list">
                        <div
                          v-for="tm in getSkillMessagesForAssistant(msg.id)"
                          :key="tm.id"
                          class="skill-result-row"
                        >
                          <span class="skill-result-name">{{
                            getSkillDisplayName(tm.toolName ?? "")
                          }}</span>
                          <span class="skill-result-content">{{
                            truncate(tm.content, 200)
                          }}</span>
                        </div>
                      </div>
                    </details>
                  </template>
                </div>

                <!-- Tool executions (shown above the response text, excludes skill tools) -->
                <div
                  v-if="
                    getNonSkillToolMessagesForAssistant(msg.id).length > 0 ||
                    (msg.isStreaming &&
                      msg.id === currentAssistantMsgId &&
                      inProgressTools.filter(
                        (t) => t.status === 'running' && !isSkillTool(t.name)
                      ).length > 0)
                  "
                  class="tool-group"
                >
                  <!-- While streaming: show running tools -->
                  <template
                    v-if="
                      msg.isStreaming &&
                      msg.id === currentAssistantMsgId &&
                      inProgressTools.filter(
                        (t) => t.status === 'running' && !isSkillTool(t.name)
                      ).length > 0
                    "
                  >
                    <template
                      v-for="tm in inProgressTools.filter(
                        (t) => t.status === 'running' && !isSkillTool(t.name)
                      )"
                      :key="'running-' + tm.name + (tm.chainContext?.stepIndex ?? '')"
                    >
                      <!-- Chain step: show chain header + step info -->
                      <div v-if="tm.chainContext" class="chain-step-running">
                        <div class="chain-step-header">
                          <i class="pi pi-sitemap chain-step-icon" />
                          <span class="chain-step-chain-name">{{ tm.chainContext.chainName }}</span>
                          <span class="chain-step-progress">
                            Step {{ tm.chainContext.stepIndex }}/{{ tm.chainContext.totalSteps }}
                          </span>
                        </div>
                        <div class="chain-step-body">
                          <div class="tool-indicator">
                            <span class="tool-spinner" />
                          </div>
                          <span class="chain-step-label">{{ tm.chainContext.stepLabel }}</span>
                          <span class="chain-step-tool-name">{{ tm.name }}</span>
                        </div>
                      </div>
                      <!-- Standalone tool: plain spinner row -->
                      <div v-else class="tool-item tool-item-running">
                        <div class="tool-indicator">
                          <span class="tool-spinner" />
                        </div>
                        <span class="tool-label">{{ tm.name }}</span>
                      </div>
                    </template>
                  </template>
                  <!-- Completed tools -->
                  <template v-else>
                    <details class="tool-details">
                      <summary class="tool-summary">
                        <i class="pi pi-check-circle tool-check-icon" />
                        <span>
                          Used
                          {{
                            getNonSkillToolMessagesForAssistant(msg.id).length
                          }}
                          tool{{
                            getNonSkillToolMessagesForAssistant(msg.id).length >
                            1
                              ? "s"
                              : ""
                          }}
                        </span>
                        <i class="pi pi-chevron-down tool-chevron" />
                      </summary>
                      <div class="tool-results-list">
                        <div
                          v-for="tm in getNonSkillToolMessagesForAssistant(
                            msg.id
                          )"
                          :key="tm.id"
                          class="tool-result-row"
                        >
                          <span class="tool-result-name">{{
                            tm.toolName
                          }}</span>
                          <span class="tool-result-content">{{
                            truncate(tm.content, 200)
                          }}</span>
                        </div>
                      </div>
                    </details>
                  </template>
                </div>

                <!-- Chained tool results (indigo-styled pipeline breakdown) -->
                <div
                  v-if="getChainGroupsForAssistant(msg.id).size > 0"
                  class="chain-group"
                >
                  <template
                    v-for="[chainName, chainMsgs] in getChainGroupsForAssistant(msg.id)"
                    :key="'chain-' + chainName"
                  >
                    <details class="chain-details" open>
                      <summary class="chain-summary">
                        <i class="pi pi-sitemap chain-summary-icon" />
                        <span class="chain-summary-name">{{ chainName }}</span>
                        <span class="chain-summary-steps">
                          {{ chainMsgs.length }} step{{ chainMsgs.length > 1 ? 's' : '' }} completed
                        </span>
                        <i class="pi pi-chevron-down chain-summary-chevron" />
                      </summary>
                      <div class="chain-results-list">
                        <div
                          v-for="cm in chainMsgs"
                          :key="cm.id"
                          class="chain-result-row"
                        >
                          <div class="chain-result-step-badge">
                            {{ cm.chainContext?.stepIndex }}
                          </div>
                          <div class="chain-result-info">
                            <div class="chain-result-header">
                              <span class="chain-result-label">{{ cm.chainContext?.stepLabel }}</span>
                              <span class="chain-result-tool">{{ cm.toolName }}</span>
                            </div>
                            <span class="chain-result-content">{{
                              truncate(cm.content, 200)
                            }}</span>
                          </div>
                        </div>
                      </div>
                    </details>
                  </template>
                </div>

                <!-- Inline cache_display blocks — content rendered verbatim, bypassing collapsed tool list -->
                <template v-if="getCacheDisplayMessagesForAssistant(msg.id).length > 0">
                  <div
                    v-for="dm in getCacheDisplayMessagesForAssistant(msg.id)"
                    :key="dm.id"
                    class="cache-display-block"
                  >
                    <template v-if="parseCacheDisplayResult(dm.content).found">
                      <div class="cache-display-header">
                        <i class="pi pi-file-code cache-display-icon" />
                        <span class="cache-display-description">{{ parseCacheDisplayResult(dm.content).description ?? String(dm.id) }}</span>
                        <span class="cache-display-size">{{ ((parseCacheDisplayResult(dm.content).sizeChars ?? 0) / 1000).toFixed(1) }}k chars</span>
                      </div>
                      <MessageContentRenderer
                        :content="(() => { const c = agentCache.get(parseCacheDisplayResult(dm.content).key)?.content ?? ''; return '\`\`\`' + detectLanguage(c) + '\n' + c + '\n\`\`\`'; })()"
                        @open-in-sql-editor="openInSqlEditor"
                        @question-answer="handleQuestionAnswer"
                      />
                    </template>
                    <div v-else class="cache-display-error">
                      <i class="pi pi-exclamation-circle" />
                      {{ parseCacheDisplayResult(dm.content).message ?? 'Content not found in cache.' }}
                    </div>
                  </div>
                </template>

                <!-- Response content -->
                <div class="msg-assistant-content">
                  <div
                    v-if="msg.isStreaming && !msg.content && (!msg.generatedFiles || msg.generatedFiles.length === 0)"
                    class="thinking-indicator"
                  >
                    <span class="thinking-dot" />
                    <span class="thinking-dot" />
                    <span class="thinking-dot" />
                  </div>
                  <MessageContentRenderer v-else :content="msg.content" @open-in-sql-editor="openInSqlEditor" @question-answer="handleQuestionAnswer" />
                </div>

                <!-- Generated PDF viewer(s) -->
                <div
                  v-if="msg.generatedFiles && msg.generatedFiles.length > 0"
                  class="generated-pdf-list"
                >
                  <div
                     v-for="(gf, gIdx) in msg.generatedFiles"
                     :key="gIdx"
                     class="generated-pdf-card"
                   >
                     <div class="generated-pdf-header">
                       <i class="pi pi-file-pdf generated-pdf-icon" />
                       <span class="generated-pdf-name">{{ gf.filename }}</span>
                       <span class="generated-pdf-size">{{ formatFileSize(gf.bytes) }}</span>
                       <a
                         :href="gf.url"
                         target="_blank"
                         rel="noopener"
                         class="generated-pdf-action"
                         title="Open preview in new tab"
                       >
                         <i class="pi pi-external-link" />
                         Preview
                       </a>
                       <button
                         class="generated-pdf-action generated-pdf-download"
                         :class="{ 'generated-pdf-downloading': downloadingGfKey === `${msg.id}-${gIdx}` }"
                         :disabled="downloadingGfKey === `${msg.id}-${gIdx}`"
                         :title="downloadingGfKey === `${msg.id}-${gIdx}` ? 'Generating PDF…' : 'Download PDF'"
                         @click="downloadGeneratedDoc(gf, msg.id, gIdx)"
                       >
                         <i :class="downloadingGfKey === `${msg.id}-${gIdx}` ? 'pi pi-spin pi-spinner' : 'pi pi-download'" />
                         {{ downloadingGfKey === `${msg.id}-${gIdx}` ? 'Generating…' : 'Download' }}
                       </button>
                     </div>
                     <iframe
                       :src="gf.url"
                       class="generated-pdf-iframe"
                      frameborder="0"
                      title="Generated document preview"
                    />
                  </div>
                </div>
              </div>
            </template>

            <!-- Standalone loading indicator when waiting for first response -->
            <div
              v-if="loading && messages[messages.length - 1]?.role === 'user'"
              class="msg msg-assistant"
            >
              <div class="msg-assistant-content">
                <div v-if="settings.thinkingMode" class="thinking-in-progress">
                  <i class="pi pi-sparkles thinking-in-progress-icon" />
                  <span class="thinking-in-progress-label">Reasoning</span>
                  <span class="thinking-dot" />
                  <span class="thinking-dot" />
                  <span class="thinking-dot" />
                </div>
                <div v-else class="thinking-indicator">
                  <span class="thinking-dot" />
                  <span class="thinking-dot" />
                  <span class="thinking-dot" />
                </div>
              </div>
            </div>
          </div>

          <!-- Error banner -->
          <div v-if="agent.error.value" class="error-banner">
            <i class="pi pi-exclamation-triangle" />
            <span>{{ String(agent.error.value) }}</span>
          </div>

          <!-- Input wrapper (bg + border) -->
          <div class="input-wrapper">
            <div class="chat-toolbar">
              <!-- Active agent indicator -->
              <span
                v-if="activeAgentSlug && loading"
                class="agent-indicator"
              >
                <span
                  class="agent-indicator-dot"
                  :style="{ background: currentAgentColor }"
                />
                {{ currentAgentName }}
              </span>
              <span v-if="tokenCounterLabel" :class="tokenCounterClass">
                <i class="pi pi-database" style="font-size: 0.6rem" />
                {{ tokenCounterLabel }} tokens (Context-Window)
              </span>
            </div>

            <!-- Slash command suggestions -->
            <div v-if="showSlashSuggestions && slashSuggestions.length > 0" ref="suggestionListRef" class="slash-suggestions">
              <div
                v-for="(ag, idx) in slashSuggestions"
                :key="ag.agentId"
                class="slash-suggestion-item"
                :class="{ 'slash-suggestion-active': idx === selectedSuggestionIndex }"
                @mousedown.prevent="applySlashSuggestion(ag)"
              >
                <span class="slash-dot" :style="{ background: ag.color }" />
                <span class="slash-cmd">/{{ ag.slug }}</span>
                <span class="slash-desc">{{ ag.description }}</span>
              </div>
            </div>

            <div class="input-row">
              <!-- Hidden file input -->
              <input
                ref="fileInputRef"
                type="file"
                multiple
                accept=".pdf,.txt,.md,.markdown,.json,.xml,.csv,.html,.htm,.js,.ts,.jsx,.tsx,.css,.scss,.sql,.py,.java,.c,.cpp,.cs,.go,.rb,.php,.sh,.yaml,.yml,.toml"
                style="display: none"
                @change="onFileInputChange"
              />
              <div
                ref="inputRef"
                class="chat-input"
                :contenteditable="!loading"
                data-placeholder="Message... (type / for agents)"
                @keydown="onInputKeydown"
                @input="onPromptInput"
                @blur="onPromptBlur"
                @paste.prevent="onInputPaste"
              />
              <button
                class="attach-btn"
                :disabled="loading || isProcessingFiles"
                title="Attach file (PDF, text, code)"
                @click="triggerFileInput"
              >
                <i v-if="isProcessingFiles" class="pi pi-spin pi-spinner" style="font-size: 0.75rem" />
                <i v-else class="pi pi-paperclip" />
              </button>
              <button
                class="thinking-toggle-btn"
                :class="{ 'thinking-toggle-btn--active': settings.thinkingMode }"
                :title="settings.thinkingMode ? 'Thinking mode ON — click to disable' : 'Enable thinking mode for deeper reasoning'"
                :disabled="loading"
                @click="settings.thinkingMode = !settings.thinkingMode"
              >
                <i class="pi pi-sparkles" />
              </button>
              <button
                v-if="loading"
                class="stop-btn"
                @click="stopAgent"
                title="Stop generation"
              >
                <i class="pi pi-stop-circle" />
              </button>
              <button
                v-else
                class="send-btn"
                :disabled="!inputHasContent && pendingAttachments.length === 0"
                @click="() => sendMessage()"
              >
                <i class="pi pi-arrow-up" />
              </button>
            </div>

            <!-- Pending attachment chips (shown below input, above send) -->
            <div v-if="pendingAttachments.length > 0" class="pending-attachments">
              <div
                v-for="(att, idx) in pendingAttachments"
                :key="idx"
                class="pending-attachment-chip"
              >
                <i :class="att.type === 'pdf' ? 'pi pi-file-pdf' : 'pi pi-file'" class="attachment-chip-icon" />
                <span class="attachment-chip-name">{{ att.name }}</span>
                <span class="attachment-chip-size">{{ formatFileSize(att.size) }}</span>
                <button class="attachment-remove-btn" @click="removeAttachment(idx)" title="Remove">
                  <i class="pi pi-times" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </MCard>
  </div>

  <ToolApprovalDialog
    :visible="approvalVisible"
    :tool-name="approvalToolName"
    :tool-input="approvalToolInput"
    @approve="handleApprove"
    @reject="handleReject"
  />

  <!-- Compaction approval dialog -->
  <div v-if="compactionApprovalVisible" class="compaction-dialog-overlay">
    <div class="compaction-dialog">
      <div class="compaction-dialog-header">
        <i class="pi pi-bolt compaction-dialog-icon" />
        <span>Context Compaction</span>
      </div>
      <div class="compaction-dialog-body">
        <p>
          The conversation context is getting large (<strong
            >~{{ (compactionApprovalTokens / 1000).toFixed(1) }}k</strong
          >
          / {{ (compactionApprovalThreshold / 1000).toFixed(0) }}k tokens).
        </p>
        <p>
          Compact earlier messages into a summary to free up context space? The
          summary will be kept in the conversation.
        </p>
      </div>
      <div class="compaction-dialog-actions">
        <button
          class="compaction-btn compaction-btn--skip"
          @click="handleCompactionReject"
        >
          Skip
        </button>
        <button
          class="compaction-btn compaction-btn--compact"
          @click="handleCompactionApprove"
        >
          <i class="pi pi-bolt" />
          Compact
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, onMounted, onBeforeUnmount, computed } from "vue";
import { useRouter } from "vue-router";

import MCard from "../components/universal/card/MCard.vue";
import Button from "primevue/button";
import { useAgent, ToolRejectedError } from "../composables/useAgent";
import type { ToolDefinition } from "../composables/useAgent";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MessageContentRenderer from "../components/MessageContentRenderer.vue";
import ToolApprovalDialog from "../components/ToolApprovalDialog.vue";
import { tools } from "../utils/toolManager";
import { skillTools } from "../utils/skillSearchTools";
import { chainedTools } from "../utils/chainedTools";
import { createSqlAiTools } from "../utils/sqlAiTools";
import { netsuiteDocsTools, NETSUITE_DOCS_SYSTEM_PROMPT } from "../utils/netsuiteDocsTools";
import { bundleTools, BUNDLE_TOOLS_SYSTEM_PROMPT } from "../utils/bundleTools";
import { useSettings } from "../states/settingsState";
import {
  getAllAiChats,
  upsertAiChat,
  deleteAiChat,
  getAiAssistantUiState,
  setAiAssistantUiState
} from "../utils/aiAssistantDb";
import {
  getEnabledAgents,
  getAgentBySlug,
  getPassiveAgents,
  type Agent
} from "../utils/agentsDb";
import { getSkillContent } from "../utils/skillsDb";
import { DIAGRAM_DOCS } from "../utils/diagramDocs";
import { extractPdfText, revokePdfUrl, downloadDocumentAsPdf } from "../utils/pdfUtils";
import type { MessageAttachment } from "../composables/useAgent";
import { agentCache } from "../utils/agentCacheStore";
import { createTodoTools } from "../utils/todoTools";
import type { AgentTodo } from "../utils/todoTools";

const { settings } = useSettings();
const router = useRouter();

interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "tool" | "compaction";
  content: string;
  toolName?: string;
  isStreaming?: boolean;
  isRunning?: boolean;
  compactedCount?: number;
  /** Present when this tool message originated from a chained tool step */
  chainContext?: {
    chainName: string;
    stepIndex: number;
    totalSteps: number;
    stepLabel: string;
  };
  /** Present when this message was routed through a specific agent */
  agentContext?: {
    name: string;
    slug: string;
    color: string;
  };
  /** Files attached by the user (text or PDF) */
  attachments?: MessageAttachment[];
  /** PDFs generated by the AI via the generate_pdf tool */
  generatedFiles?: GeneratedFile[];
  /** Reasoning/thinking content — shown in a collapsible block above the response */
  thinking?: string;
}

/** A document produced by the generate_pdf tool, held on the assistant message */
interface GeneratedFile {
  filename: string;
  /** Blob URL — transient, invalidated on page refresh. Always recreate from htmlContent. */
  url: string;
  bytes: number;
  /** Raw HTML source — persisted to DB so the blob URL can be recreated after refresh. */
  htmlContent: string;
  /** Original markdown — used by pdfmake to generate a real text-based PDF on download. */
  markdown: string;
  /** Document title — used as the PDF heading. */
  title: string;
}

interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

const props = defineProps<{ vhOffset: number }>();

// ── Agent state ──
const availableAgents = ref<Agent[]>([]);
const activeAgentSlug = ref<string | null>(null);
const slashSuggestions = ref<Agent[]>([]);
const showSlashSuggestions = ref(false);

const loadAgents = async () => {
  availableAgents.value = await getEnabledAgents();
};

/**
 * Parse a /slash-command from the start of a prompt.
 * Returns { slug, prompt } if found, null otherwise.
 */
const parseSlashCommand = (text: string): { slug: string; prompt: string } | null => {
  const match = text.match(/^\/([a-z0-9][-a-z0-9]*)\s+([\s\S]+)/i);
  if (!match) return null;
  return { slug: match[1]!, prompt: match[2]!.trim() };
};

/**
 * Build an agent-specific system prompt by combining the agent's
 * system prompt with any loaded skills.
 */
const buildAgentSystemPrompt = async (agentConfig: Agent): Promise<string> => {
  const parts: string[] = [agentConfig.systemPrompt];

  // Load agent-specific skills
  if (agentConfig.skillIds.length > 0) {
    const skillContents: string[] = [];
    for (const skillId of agentConfig.skillIds) {
      const skill = await getSkillContent(skillId);
      if (skill) {
        skillContents.push(`## Skill: ${skill.name}\n${skill.content}`);
      }
    }
    if (skillContents.length > 0) {
      parts.push("\n\n# Loaded Skills\n" + skillContents.join("\n\n---\n\n"));
    }
  }

  // Add limits context
  const limitNotes: string[] = [];
  if (!agentConfig.limits.canExecuteDestructive) {
    limitNotes.push("You are NOT allowed to execute destructive operations (creating, modifying, or deleting data).");
  }
  if (agentConfig.limits.blockedTools.length > 0) {
    limitNotes.push(`You must NOT use the following tools: ${agentConfig.limits.blockedTools.join(", ")}.`);
  }
  if (limitNotes.length > 0) {
    parts.push("\n\n# Restrictions\n" + limitNotes.join("\n"));
  }

  return parts.join("\n");
};

// ── Tool approval state ──
const approvalVisible = ref(false);
const approvalToolName = ref("");
const approvalToolInput = ref<unknown>(null);
let approvalResolve: ((approved: boolean) => void) | null = null;

// ── File attachment state ──
const pendingAttachments = ref<MessageAttachment[]>([]);
const fileInputRef = ref<HTMLInputElement | null>(null);
const isProcessingFiles = ref(false);
/** FileCabinet-style drag-over for the whole chat area */
const isDragOverChat = ref(false);

const ACCEPTED_TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "xml", "csv", "html", "htm",
  "js", "ts", "jsx", "tsx", "css", "scss", "sql", "py", "java",
  "c", "cpp", "cs", "go", "rb", "php", "sh", "yaml", "yml", "toml"
]);

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileExtension = (name: string): string =>
  name.split(".").pop()?.toLowerCase() ?? "";

const processFiles = async (files: FileList | File[]) => {
  isProcessingFiles.value = true;
  const fileArray = Array.from(files);

  for (const file of fileArray) {
    const ext = getFileExtension(file.name);
    const isPdf = ext === "pdf" || file.type === "application/pdf";
    const isText = ACCEPTED_TEXT_EXTENSIONS.has(ext) || file.type.startsWith("text/");

    if (!isPdf && !isText) continue;

    try {
      let content: string;
      if (isPdf) {
        const result = await extractPdfText(file);
        content = result.pages
          .map((p) => `<page ${p.pageNumber}>\n${p.text}\n</page ${p.pageNumber}>`)
          .join("\n\n");
      } else {
        content = await file.text();
      }

      pendingAttachments.value.push({
        name: file.name,
        type: isPdf ? "pdf" : "text",
        content,
        size: file.size
      });
    } catch (err) {
      console.error(`[AiAssistant] Failed to process file "${file.name}":`, err);
    }
  }

  isProcessingFiles.value = false;
};

const triggerFileInput = () => {
  fileInputRef.value?.click();
};

const onFileInputChange = async (e: Event) => {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) {
    await processFiles(input.files);
  }
  // Reset so the same file can be re-selected
  input.value = "";
};

const removeAttachment = (index: number) => {
  pendingAttachments.value.splice(index, 1);
};

// ── Chat-area drag zone (FileCabinet-style) ──────────────────────────────────
const onChatDragEnter = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes("Files")) {
    isDragOverChat.value = true;
  }
};

const onChatDragOver = (e: DragEvent) => {
  if (e.dataTransfer?.types.includes("Files")) {
    isDragOverChat.value = true;
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }
};

const onChatDragLeave = (e: DragEvent) => {
  // Only dismiss when leaving the container itself, not a child element
  const related = e.relatedTarget as Node | null;
  const target = e.currentTarget as HTMLElement;
  if (!related || !target.contains(related)) {
    isDragOverChat.value = false;
  }
};

const onChatDrop = async (e: DragEvent) => {
  isDragOverChat.value = false;
  if (e.dataTransfer?.files?.length) {
    await processFiles(e.dataTransfer.files);
  }
};

// ── Download generated document as PDF ─────────────────────────────────────
/** Key of the file currently being downloaded, e.g. "msgId-0". Drives loading state. */
const downloadingGfKey = ref<string | null>(null);

const downloadGeneratedDoc = async (
  gf: GeneratedFile,
  msgId: number,
  idx: number
) => {
  const key = `${msgId}-${idx}`;
  if (downloadingGfKey.value === key) return; // already in progress
  downloadingGfKey.value = key;
  try {
    await downloadDocumentAsPdf(gf.markdown, gf.title || gf.filename, gf.filename);
  } catch (err) {
    console.error("[downloadGeneratedDoc] Failed:", err);
  } finally {
    downloadingGfKey.value = null;
  }
};

const requestToolApproval = (
  name: string,
  input: unknown
): Promise<boolean> => {
  approvalToolName.value = name;
  approvalToolInput.value = input;
  approvalVisible.value = true;
  return new Promise<boolean>((resolve) => {
    approvalResolve = resolve;
  });
};

const handleApprove = () => {
  approvalVisible.value = false;
  approvalResolve?.(true);
  approvalResolve = null;
};

const handleReject = () => {
  approvalVisible.value = false;
  approvalResolve?.(false);
  approvalResolve = null;
};

// ── Compaction approval state ──
const compactionApprovalVisible = ref(false);
const compactionApprovalTokens = ref(0);
const compactionApprovalThreshold = ref(0);
let compactionApprovalResolve: ((approved: boolean) => void) | null = null;

const requestCompactionApproval = (
  tokenEstimate: number,
  threshold: number
): Promise<boolean> => {
  compactionApprovalTokens.value = tokenEstimate;
  compactionApprovalThreshold.value = threshold;
  compactionApprovalVisible.value = true;
  return new Promise<boolean>((resolve) => {
    compactionApprovalResolve = resolve;
  });
};

const handleCompactionApprove = () => {
  compactionApprovalVisible.value = false;
  compactionApprovalResolve?.(true);
  compactionApprovalResolve = null;
};

const handleCompactionReject = () => {
  compactionApprovalVisible.value = false;
  compactionApprovalResolve?.(false);
  compactionApprovalResolve = null;
};

// ── Delegate-to-agent tool ──
// This tool allows the main agent to delegate tasks to specialized agents.
// It runs a sub-call through the agent's system prompt with filtered tools.
const delegateToAgentTool: ToolDefinition = {
  name: "delegate_to_agent",
  description:
    "Delegate a task to a specialized agent, or list available agents. " +
    "Call with just agent_slug='list' to see available agents and their capabilities. " +
    "Call with agent_slug and task to delegate work. " +
    "The agent will handle the task with its own system prompt, tools, and skills, and return the result.",
  parameters: {
    type: "object",
    properties: {
      agent_slug: {
        type: "string",
        description:
          "The slug of the agent to delegate to (e.g. 'sql-expert'), or 'list' to see available agents."
      },
      task: {
        type: "string",
        description:
          "The task description to send to the agent. Not required when listing agents."
      }
    },
    required: ["agent_slug"]
  },
  execute: async (input) => {
    const slug = String(input.agent_slug ?? "");
    const task = String(input.task ?? "");

    // List mode
    if (slug === "list") {
      const passive = await getPassiveAgents();
      if (passive.length === 0) {
        return { message: "No passive agents available. Agents can be created in the Agents view." };
      }
      return {
        agents: passive.map((a) => ({
          slug: a.slug,
          name: a.name,
          description: a.description,
          mode: a.mode,
          tools: a.tools.length,
          skills: a.skillIds.length
        }))
      };
    }

    const agentConfig = await getAgentBySlug(slug);
    if (!agentConfig) {
      return { error: `No agent found with slug "${slug}". Call with agent_slug='list' to see available agents.` };
    }
    if (!agentConfig.enabled) {
      return { error: `Agent "${agentConfig.name}" is disabled.` };
    }
    if (agentConfig.mode === "active") {
      return { error: `Agent "${agentConfig.name}" is set to active-only mode. It can only be invoked directly by the user via /${agentConfig.slug}.` };
    }

    if (!task) {
      return { error: "A task description is required when delegating to an agent." };
    }

    const agentSystemPrompt = await buildAgentSystemPrompt(agentConfig);

    try {
      const result = await agent.run(task, {
        systemPrompt: agentSystemPrompt,
        allowedTools: agentConfig.tools.length > 0 ? agentConfig.tools : undefined,
        blockedTools: agentConfig.limits.blockedTools.length > 0
          ? agentConfig.limits.blockedTools
          : undefined,
        blockDestructive: !agentConfig.limits.canExecuteDestructive
      });
      return {
        agent: agentConfig.name,
        response: result
      };
    } catch (err) {
      return {
        agent: agentConfig.name,
        error: `Agent failed: ${String(err)}`
      };
    }
  }
};

// Agent task todos — created by agent_todo_write, displayed in the chat
const agentTodos = ref<AgentTodo[]>([]);
const todosPanelCollapsed = ref(false);

const todoTools = createTodoTools(
  (todos) => { agentTodos.value = todos; },
  () => agentTodos.value
);

const agent = useAgent({
  systemPrompt: `You are a helpful NetSuite assistant that provides well-structured, expressive responses.

## Tool Usage — ALWAYS prefer tools
You have tools available. **Always use the appropriate tool** when one exists for the task — even for simple tasks. Do NOT answer from memory when a tool can provide a verified result.

**DO NOT narrate, plan, or explain what you are about to do before calling a tool.**
Call the tool immediately as your very first action. Write text ONLY after you have received tool results.
Never write phrases like "I'll start by...", "First I need to...", "Let me search for...", "I'm going to call..." — just call the tool.

Examples:
- Math questions → call \`calculate\`
- Need current time → call \`get_current_time\`
- Need to fetch a **public** URL (docs, articles) → call \`fetch_url\` — **NEVER for NetSuite URLs**
- Need to read a file from NetSuite File Cabinet → ALWAYS use \`netsuite_get_file_content\` — NEVER use \`fetch_url\` for this (NetSuite requires an authenticated session that only the netsuite_* tools have)
- Need to find scripts or files in NetSuite → call the appropriate \`netsuite_*\` tool
- **Need to find, fetch, or query records/data → use \`sql_execute_query\` with SuiteQL — always**
- Need to write code → first call \`search_skills\`, then \`load_skill\`, then \`netsuite_search_module_docs\`
- Need to OPEN a Suitelet → use \`netsuite_open_deployment_suitelet\` (opens in new tab)
- Just need Suitelet URL to copy → use \`netsuite_get_suitelet_url\`

**Efficiency rules** (for multi-tool chains only):
- Never repeat a tool call if you already have its result in the conversation.
- When chaining tools, extract IDs from previous results — don't re-query.
- If you need to filter data, do it from results you already received.

## Fetching / Searching Records — SuiteQL First
When a user asks you to find, fetch, retrieve, or search for any record (standard or custom):
1. **Always use SuiteQL** via \`sql_execute_query\` — never navigate to list views or ask the user for field IDs.
2. If you don't know the field IDs, call \`sql_get_table_fields\` to discover them first.
3. If you don't know the table name, call \`sql_search_tables\` to find it.
4. For status/type/category fields, call \`sql_discover_field_values\` to find the correct coded values before filtering.
5. **Never ask the user for field IDs or table names** — discover them yourself with the SQL tools.

Custom record tables use the format \`customrecord_<scriptid_lowercase>\`.

## Skills Library
You have access to a local skill library with specialized knowledge, code patterns, and documentation. Skill rules **override your default knowledge** when applicable.

**Before writing ANY code, call \`search_skills\` first — no exceptions.**
This includes: writing scripts, creating suitelets, generating examples, modifying code, debugging, scaffolding, or producing any code snippet.

When \`search_skills\` is NOT needed:
- Retrieving or displaying existing scripts/files/records from the environment
- Answering questions that require no code output

**Code-writing workflow:**
1. Call \`search_skills\` with keywords for the code you're about to write.
2. Call \`load_skill\` for every relevant skill returned.
3. Call \`netsuite_search_module_docs\` for every N/* module you plan to use.
4. Call \`netsuite_get_module_member_details\` for any method/object whose exact signature you need.
5. Apply loaded skill rules (they override your defaults).
6. Generate code only AFTER steps 1–5.

## SuiteScript Module Documentation
You have access to the local SuiteScript 2.x module documentation via:
- \`netsuite_search_module_docs\` — search methods, objects, properties, and enums across all N/* modules
- \`netsuite_get_module_member_details\` — get full parameter list, return type, syntax, and errors for a specific member

**Always look up the correct API signature before using any N/* module member in code.** Do NOT rely on your training knowledge for method signatures — the docs tool is authoritative.

## Context Compaction
If you see a "[Context Summary]" system message, treat it as authoritative prior context. Do NOT ask the user to repeat compacted information.

## Response Formatting
Format responses using standard markdown:
- **Bold** and *italic* for emphasis
- Headings (##, ###) to organize sections
- Bullet/numbered lists for grouped items
- \`inline code\` for identifiers, field names, script IDs
- Fenced code blocks with language tags
- Tables for structured data
- Blockquotes for callouts

Keep responses concise and well-structured.

## Diff View — Code Changes
When you are **modifying, refactoring, or showing an updated version of existing code**, use the \`diff-view\` fence to show a side-by-side diff instead of a plain code block:

\`\`\`diff-view
---ORIGINAL---
// the original code here
---MODIFIED---
// the updated code here
\`\`\`

Use this ONLY when you have both the original and the modified version. For new code (no original exists), use a regular code block.

## File Upload — Folder ID Rules
When the user mentions a folder ID in their message (e.g. "folder 2543", "put it in 2543", "upload to folder 123"), you **MUST** pass that exact numeric ID as the \`folderId\` parameter when calling \`netsuite_upload_file\` or as \`parentFolderId\` when calling \`netsuite_create_folder\`. **Never ignore or omit a user-specified folder ID.** The default folder (-15) should ONLY be used when the user has NOT mentioned any folder.

## Clarifying Questions
When you need the user to choose between options before you can proceed (e.g. ambiguous intent, multiple valid approaches), use the \`question\` fence instead of asking in plain text:

\`\`\`question
What type of script do you want to create?
---
UserEventScript
Suitelet
RESTlet
MapReduceScript
\`\`\`

Rules:
- The question text goes **before** the \`---\` separator.
- Each answer option goes on its own line **after** the separator.
- Provide 2–6 meaningful options. The UI automatically adds a "Type your own answer" field.
- **Always use this format** when asking the user any question — never ask in plain prose.
  This includes when you need to clarify requirements, gather preferences, or the user explicitly asks you to ask them questions.
- For multiple questions at once, emit multiple consecutive \`question\` fences — one per question.
- After the user selects or types an answer, continue the task using their response.

${NETSUITE_DOCS_SYSTEM_PROMPT}

${BUNDLE_TOOLS_SYSTEM_PROMPT}

## Chained Tools — Pipeline Priority
When a chained tool is available (e.g. \`generate_script_deployment\`), **always prefer it** over manually calling individual tools for the same task. Chained tools handle the full pipeline (folder creation, code generation, file upload) in a single call with guaranteed data flow between steps. Only fall back to individual tools if the chained tool is not available or if the user explicitly asks you to do things step by step.

## Agent Delegation
You may have specialized agents available via the \`delegate_to_agent\` tool. When a task clearly falls within a specialized agent's domain, delegate to it by calling the tool with the agent's slug and the task description. The agent will handle the task with its own specialized tools and skills, and return the result. Only delegate when the agent's specialization is a strong match — otherwise handle the task yourself.

## Entity Types
Each entity type has its own table and its own ID namespace. A Lead ID and a File ID are different things even if the number is the same.
| Entity Type | Table | ID Field |
|-------------|-------|----------|
| Lead | lead | id |
| File | file | id |
| Customer | customer | id |
| Transaction | transaction | id |

When asked for data related to an entity (e.g. "files for lead 181"):
1. Query the entity's table by its ID
2. Use sql_get_table_joins to find how it relates to the target table
3. Write a JOIN to get the related data

Do NOT search filenames by a bare number or pass one entity's ID to another entity's tool.

## Task Management — Todos
For any request that involves 2 or more distinct steps, call \`agent_todo_write\` as your FIRST action to create a task list. **Break the work into concrete, specific steps** — not vague categories. Each todo should be one actionable unit of work (e.g. "Fetch script source for ID 1324" not "Get scripts").

- Set the current task to \`in_progress\`, all others to \`pending\`.
- Call \`agent_todo_write\` again each time a task is completed or a new one starts.
- Only one task may be \`in_progress\` at a time.
- Before sending your final response, call \`agent_todo_read\` to confirm all todos are \`done\`. If any are not, continue working.

## Content Cache
The cache exists for one purpose: **to prevent content from passing through your text generation**. When content goes through your output, tokens can be dropped, lines reordered, or code silently modified. The cache bypasses this entirely.

Tools:
- \`cache_store(key, content, description?)\` — save content under a short key. For manually created content only; read tools auto-cache.
- \`cache_display(key)\` — **show content verbatim to the user from the cache**. The content renders as-is, bypassing your text output. Use this for all view/read requests.
- \`cache_retrieve(key)\` — bring cached content into your context. Use this only when you need to **analyze** the content (inspect, debug, modify).
- \`cache_list()\` — see what is cached.
- \`cache_delete(key)\` — remove an entry.
- \`cache_upload_file(cacheKey, fileName, folderId)\` — write cached bytes directly to the NetSuite File Cabinet, bypassing your text output entirely.

**Read tools auto-cache.** \`netsuite_get_file_content\` and \`netsuite_get_script_files\` automatically store content in the cache and return only metadata (cacheKey, size, type). You never see the full content unless you explicitly call \`cache_retrieve\`.

**Viewing content (user wants to see a file/script):**
1. Call the read tool → get metadata + cacheKey back.
2. Call \`cache_display(cacheKey)\` — content shown to user verbatim.
3. Your text: one short sentence ("Here is the file:"). Nothing else. Do NOT reproduce the content.

**Analyzing content (user wants you to inspect, debug, or modify):**
1. Call the read tool → get metadata + cacheKey.
2. Call \`cache_retrieve(cacheKey)\` → content enters your context.
3. Now analyze it. Keep your analysis to what was asked.

**Upload workflow (content must not change):**
1. Read tool → cacheKey.
2. \`cache_retrieve\` — verify it is what you expect, point out any issues you notice to the user.
3. \`cache_upload_file\` — bytes written to NetSuite verbatim.

**Upload workflow (targeted modification requested):**
1. Read tool → cacheKey.
2. \`cache_retrieve\` — content in context.
3. Apply only the requested change. Do not rewrite surrounding code.
4. \`cache_store\` with the modified content.
5. \`cache_retrieve\` again — confirm only the intended change is present.
6. \`cache_upload_file\`.

${DIAGRAM_DOCS}`,
  tools: [...tools, ...skillTools, ...createSqlAiTools(), ...netsuiteDocsTools, ...bundleTools, ...todoTools, delegateToAgentTool],
  chainedTools,
  ephemeralTools: ["search_skills", "load_skill"],
  compactionThreshold: () => settings.compactionThreshold,
  onToolApprovalRequest: requestToolApproval,
  onCompactionRequest(tokenEstimate, threshold) {
    // Only intercept when mode is "ask"; "auto" proceeds without prompting
    if (settings.compactionMode === "ask") {
      return requestCompactionApproval(tokenEstimate, threshold);
    }
    return Promise.resolve(true);
  },
  onCompaction(summary, compactedCount) {
    // Insert a compaction message into the UI messages
    const compactionMsg: ChatMessage = {
      id: Date.now() + Math.random(),
      role: "compaction",
      content: summary,
      compactedCount
    };
    messages.value.push(compactionMsg);
    scrollToBottom();
  },
  onToolCall(name) {
    activeTools.value.push(name);
  },
  onToolStart(name, input) {
    inProgressTools.value.push({
      name,
      input,
      status: "running",
      timestamp: Date.now(),
      // Attach chain context if a chain step is currently executing
      chainContext: activeChainContext.value ? { ...activeChainContext.value } : undefined
    });
    scrollToBottom();
  },
  onToolResult(name, result) {
    activeTools.value = activeTools.value.filter((t) => t !== name);
    // Remove matching entry — find last match to handle unlikely duplicate names
    const toolIndex = [...inProgressTools.value].reverse()
      .findIndex((t) => t.name === name);
    if (toolIndex !== -1) {
      inProgressTools.value.splice(inProgressTools.value.length - 1 - toolIndex, 1);
    }
    // Clear active chain context once the step finishes
    if (activeChainContext.value) {
      activeChainContext.value = null;
    }

    // ── Intercept generate_pdf results ──────────────────────────────
    // When the AI calls generate_pdf, attach the blob URL to the current
    // streaming assistant message so the inline viewer renders immediately.
    if (name === "generate_pdf" && result && typeof result === "object") {
      const r = result as Record<string, unknown>;
      if (r.__pdf_result__ && typeof r.url === "string") {
        const assistantMsg = messages.value.find(
          (m) => m.id === currentAssistantMsgId.value
        );
        if (assistantMsg) {
          if (!assistantMsg.generatedFiles) {
            assistantMsg.generatedFiles = [];
          }
          assistantMsg.generatedFiles.push({
            filename: String(r.filename ?? "document.pdf"),
            url: String(r.url),
            bytes: Number(r.bytes ?? 0),
            htmlContent: String(r.htmlContent ?? ""),
            markdown: String(r.markdown ?? ""),
            title: String(r.title ?? ""),
          });
          messages.value = [...messages.value];
        }
      }
    }
  },
  onChainProgress(event) {
    // Store chain context so the next onToolStart can attach it
    activeChainContext.value = {
      chainName: event.chainName,
      stepIndex: event.stepIndex,
      totalSteps: event.totalSteps,
      stepLabel: event.stepLabel
    };
    // Also record by tool name so the watcher can tag completed tool messages
    chainContextByToolKey.value.set(event.toolName, {
      chainName: event.chainName,
      stepIndex: event.stepIndex,
      totalSteps: event.totalSteps,
      stepLabel: event.stepLabel
    });
    console.log(
      `[ChainProgress] ${event.chainName} — Step ${event.stepIndex}/${event.totalSteps}: ${event.stepLabel} → ${event.toolName}`
    );
  },
  onChainStepMessage(stepMsg) {
    // Push a real ChatMessage per chain step in real-time so all steps
    // render in the indigo chain block as they complete, not all at once.
    const lastAssistant = messages.value
      .slice()
      .reverse()
      .find((m) => m.role === "assistant");

    const newToolMsg: ChatMessage = {
      id: Date.now() + Math.random(),
      role: "tool",
      content: stepMsg.content,
      toolName: stepMsg.toolName,
      chainContext: stepMsg.chainContext
    };

    messages.value.push(newToolMsg);

    if (lastAssistant) {
      toolMessageToAssistant.value.set(newToolMsg.id, lastAssistant.id);
    }

    // Also register in chainContextByToolKey so the history watcher
    // doesn't duplicate this step when it processes the agent history
    chainContextByToolKey.value.set(stepMsg.toolName + "_" + stepMsg.chainContext.stepIndex, stepMsg.chainContext);
    // Mark key as synced so the history watcher skips it
    syncedToolCallIds.value.add(stepMsg.toolCallId);

    scrollToBottom();
  }
});

const { loading } = agent;
const contextTokens = agent.contextTokens;
let abortController: AbortController | null = null;

/** Estimate tokens from UI messages (used as fallback when agent history is empty, e.g. after chat load) */
const estimateUiTokens = (): number => {
  let total = 0;
  for (const m of messages.value) {
    total += Math.ceil((m.content?.length ?? 0) / 4);
  }
  return total;
};

const effectiveTokens = computed(() => {
  const agentTokens = contextTokens.value;
  // If agent has token count (active run or after messages), use it.
  // Otherwise fall back to estimating from UI messages (e.g. after chat load).
  return agentTokens > 0 ? agentTokens : estimateUiTokens();
});

const tokenCounterLabel = computed(() => {
  const t = effectiveTokens.value;
  if (t === 0) return null;
  const k = (t / 1000).toFixed(1);
  const threshK = (settings.compactionThreshold / 1000).toFixed(
    settings.compactionThreshold >= 10000 ? 0 : 1
  );
  return `~${k}k / ${threshK}k`;
});

const tokenCounterClass = computed(() => {
  const ratio = effectiveTokens.value / settings.compactionThreshold;
  if (ratio >= 0.85) return "token-counter token-counter--danger";
  if (ratio >= 0.6) return "token-counter token-counter--warn";
  return "token-counter token-counter--ok";
});

const messages = ref<ChatMessage[]>([]);
const prompt = ref("");
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const inputRef = ref<HTMLDivElement | null>(null);
const suggestionListRef = ref<HTMLDivElement | null>(null);
const messageListRef = ref<HTMLElement | null>(null);
const activeTools = ref<string[]>([]);
const selectedSuggestionIndex = ref(-1);
const activeChipAgent = ref<Agent | null>(null);
const editingMessageId = ref<number | null>(null);
const editText = ref("");

interface InProgressTool {
  name: string;
  input: unknown;
  status: "running" | "done";
  result?: string;
  timestamp: number;
  /** Set when this tool is a step inside a chained tool execution */
  chainContext?: {
    chainName: string;
    stepIndex: number;
    totalSteps: number;
    stepLabel: string;
  };
}

const inProgressTools = ref<InProgressTool[]>([]);
const currentAssistantMsgId = ref<number>(0);


/**
 * Tracks the active chain execution so onToolStart can attach chain context
 * to the InProgressTool entry for the current step.
 */
const activeChainContext = ref<{
  chainName: string;
  stepIndex: number;
  totalSteps: number;
  stepLabel: string;
} | null>(null);

/**
 * Maps tool-call keys (toolCallId or `toolName::content`) to their chain context,
 * so when the watcher syncs agent history → ChatMessage[], it can tag chain-originating
 * tool messages with their chain step info for rendering.
 */
const chainContextByToolKey = ref<Map<string, {
  chainName: string;
  stepIndex: number;
  totalSteps: number;
  stepLabel: string;
}>>(new Map());

/** Set of chain tool names — used to skip outer chain wrapper messages in the history watcher */
const chainNameSet = new Set(chainedTools.map((c) => c.name));

const chatHistory = ref<Chat[]>([]);
const activeChatId = ref<string>("");
const isRestoring = ref(true);

const generateChatId = () => "chat_" + Date.now();

const getFirstUserMessage = (msgs: ChatMessage[]) => {
  const firstUser = msgs.find((m) => m.role === "user");
  return firstUser ? firstUser.content.slice(0, 50) : "New Chat";
};

let saveChatDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const saveChatHistoryImmediate = async () => {
  try {
    await Promise.all(
      chatHistory.value.map((chat) => {
        const plain = JSON.parse(JSON.stringify(chat));
        return upsertAiChat({
          chatId: plain.id,
          title: plain.title,
          createdAt: plain.createdAt,
          updatedAt: plain.updatedAt,
          messages: plain.messages
        });
      })
    );
  } catch (error) {
    console.error("Failed to save chat history:", error);
  }
};

const saveChatHistory = (immediate = false) => {
  if (saveChatDebounceTimer) {
    clearTimeout(saveChatDebounceTimer);
    saveChatDebounceTimer = null;
  }

  if (immediate) {
    saveChatHistoryImmediate();
    return;
  }

  saveChatDebounceTimer = setTimeout(saveChatHistoryImmediate, 1000);
};

const saveActiveChatId = () => {
  setAiAssistantUiState("activeChatId", activeChatId.value).catch(console.error);
};

/**
 * Blob URLs die on page refresh. After loading persisted messages, recreate
 * fresh blob URLs for every generated file that has stored htmlContent.
 */
const refreshBlobUrls = (msgs: ChatMessage[]) => {
  for (const msg of msgs) {
    if (!msg.generatedFiles) continue;
    for (const gf of msg.generatedFiles) {
      if (!gf.htmlContent) continue;
      // Revoke the stale URL (no-op if already dead) and create a fresh one
      try { URL.revokeObjectURL(gf.url); } catch { /* ignore */ }
      const blob = new Blob([gf.htmlContent], { type: "text/html; charset=utf-8" });
      gf.url = URL.createObjectURL(blob);
    }
  }
};

const loadChatHistory = async () => {
  try {
    // One-time migration from chrome.storage.local
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await new Promise<void>((resolve) => {
        chrome.storage.local.get(
          ["aiAssistantChatHistory", "aiAssistantActiveChatId"],
          async (result) => {
            const existingChats = await getAllAiChats();
            if (existingChats.length === 0) {
              const rawHistory = result["aiAssistantChatHistory"];
              let history: Chat[] = [];
              if (Array.isArray(rawHistory)) {
                history = rawHistory;
              } else if (rawHistory && typeof rawHistory === "object") {
                history = Object.values(rawHistory);
              }
              if (history.length > 0) {
                await Promise.all(
                  history.map((chat) =>
                    upsertAiChat({
                      chatId: chat.id,
                      title: chat.title,
                      createdAt: chat.createdAt,
                      updatedAt: chat.updatedAt,
                      messages: Array.isArray(chat.messages)
                        ? chat.messages
                        : Object.values(chat.messages || {})
                    })
                  )
                );
                const activeId = result["aiAssistantActiveChatId"];
                if (typeof activeId === "string" && activeId) {
                  await setAiAssistantUiState("activeChatId", activeId);
                }
                chrome.storage.local.remove(["aiAssistantChatHistory", "aiAssistantActiveChatId"]);
              }
            }
            resolve();
          }
        );
      });
    }

    // Restore from IndexedDB
    const [storedChats, storedActiveId] = await Promise.all([
      getAllAiChats(),
      getAiAssistantUiState<string>("activeChatId", "")
    ]);

    chatHistory.value = storedChats.map((c) => ({
      id: c.chatId,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messages: Array.isArray(c.messages) ? c.messages : Object.values(c.messages || {})
    }));

    // Recreate blob URLs for all generated files across all loaded chats
    for (const chat of chatHistory.value) {
      refreshBlobUrls(chat.messages);
    }

    if (typeof storedActiveId === "string" && storedActiveId) {
      const chat = chatHistory.value.find((c) => c.id === storedActiveId);
      if (chat) {
        activeChatId.value = storedActiveId;
        messages.value = chat.messages;
        const restoredHistory = chatMessagesToAgentHistory(messages.value);
        agent.setHistory(restoredHistory);
        rebuildToolMessageMap();
      }
    }

    inProgressTools.value = [];
    activeTools.value = [];
    currentAssistantMsgId.value = 0;
  } catch (error) {
    console.error("Failed to load chat history:", error);
    chatHistory.value = [];
  }

  isRestoring.value = false;
};

const createNewChat = () => {
  if (messages.value.length > 0) {
    const firstUserMsg = getFirstUserMessage(messages.value);
    const existingChat = chatHistory.value.find(
      (c) => c.id === activeChatId.value
    );

    if (existingChat) {
      existingChat.messages = normalizeMessages(messages.value);
      existingChat.updatedAt = new Date().toISOString();
      if (!existingChat.title || existingChat.title === "New Chat") {
        existingChat.title = firstUserMsg;
      }
    } else {
      const newChat: Chat = {
        id: generateChatId(),
        title: firstUserMsg,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [...messages.value]
      };
      chatHistory.value.unshift(newChat);
      activeChatId.value = newChat.id;
    }

    saveChatHistory();
    saveActiveChatId();
  }

  messages.value = [];
  activeChatId.value = "";
  agent.clearHistory();
  syncedToolCallIds.value.clear();
  agentTodos.value = [];
  agentCache.clear();
  scrollToBottom();
};

const normalizeMessages = (msgs: unknown): ChatMessage[] => {
  if (Array.isArray(msgs)) return msgs;
  if (msgs && typeof msgs === "object") return Object.values(msgs);
  return [];
};

/**
 * Convert saved ChatMessage[] back to AgentMessage[] for agent history restoration.
 * Tool messages without a toolCallId get a synthetic one so buildMessages() can match them.
 */
const chatMessagesToAgentHistory = (
  msgs: ChatMessage[]
): import("../composables/useAgent").AgentMessage[] => {
  const agentMsgs: import("../composables/useAgent").AgentMessage[] = [];
  let syntheticCallCounter = 0;
  let i = 0;

  while (i < msgs.length) {
    const m = msgs[i]!;

    if (m.role === "user") {
      agentMsgs.push({
        role: "user",
        content: m.content,
        timestamp: new Date()
      });
      i++;
    } else if (m.role === "assistant") {
      // Look ahead to collect any immediately-following tool messages.
      // We need to synthesize toolCalls on the assistant message so the
      // API sees a valid assistant→tool sequence.
      const toolMsgs: ChatMessage[] = [];
      let j = i + 1;
      while (j < msgs.length && msgs[j]!.role === "tool") {
        toolMsgs.push(msgs[j]!);
        j++;
      }

      // Filter out ephemeral tool messages (e.g. search_skills, load_skill)
      // so they don't get re-injected into the agent history on restore.
      const nonEphemeralToolMsgs = toolMsgs.filter(
        (tm) => !SKILL_TOOL_NAMES.has(tm.toolName ?? "")
      );

      if (nonEphemeralToolMsgs.length > 0) {
        // Build synthetic toolCalls that match the tool_call_ids we'll assign
        const toolCalls = nonEphemeralToolMsgs.map((tm) => {
          syntheticCallCounter++;
          return {
            id: `restored_${syntheticCallCounter}`,
            type: "function" as const,
            function: {
              name: tm.toolName ?? "unknown_tool",
              arguments: "{}"
            }
          };
        });

        agentMsgs.push({
          role: "assistant",
          content: m.content ?? "",
          toolCalls,
          timestamp: new Date()
        });

        // Now push the tool messages with matching IDs
        let callIdx = 0;
        for (const tm of nonEphemeralToolMsgs) {
          agentMsgs.push({
            role: "tool",
            content: tm.content,
            toolName: tm.toolName,
            toolCallId: toolCalls[callIdx]!.id,
            timestamp: new Date()
          });
          callIdx++;
        }

        i = j; // skip past assistant + all its tool messages
      } else {
        // Plain assistant message (no tool calls follow, or all were ephemeral)
        agentMsgs.push({
          role: "assistant",
          content: m.content,
          timestamp: new Date()
        });
        i = j; // skip past assistant + any ephemeral tool messages
      }
    } else if (m.role === "tool") {
      // Orphan tool message — skip if ephemeral, otherwise wrap in a synthetic pair
      if (SKILL_TOOL_NAMES.has(m.toolName ?? "")) {
        i++;
        continue;
      }
      syntheticCallCounter++;
      const callId = `restored_${syntheticCallCounter}`;
      agentMsgs.push({
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: callId,
            type: "function" as const,
            function: {
              name: m.toolName ?? "unknown_tool",
              arguments: "{}"
            }
          }
        ],
        timestamp: new Date()
      });
      agentMsgs.push({
        role: "tool",
        content: m.content,
        toolName: m.toolName,
        toolCallId: callId,
        timestamp: new Date()
      });
      i++;
    } else if (m.role === "compaction") {
      agentMsgs.push({
        role: "compaction",
        content: m.content,
        compactedCount: m.compactedCount,
        timestamp: new Date()
      });
      i++;
    } else {
      i++;
    }
  }
  return agentMsgs;
};

const loadChat = (chatId: string) => {
  if (messages.value.length > 0 && activeChatId.value) {
    const existingChat = chatHistory.value.find(
      (c) => c.id === activeChatId.value
    );
    if (existingChat) {
      existingChat.messages = normalizeMessages(messages.value);
      existingChat.updatedAt = new Date().toISOString();
    } else if (messages.value.length > 0) {
      const newChat: Chat = {
        id: generateChatId(),
        title: getFirstUserMessage(messages.value),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [...messages.value]
      };
      chatHistory.value.unshift(newChat);
    }
    saveChatHistory();
  }

  const chat = chatHistory.value.find((c) => c.id === chatId);
  if (chat) {
    activeChatId.value = chatId;
    refreshBlobUrls(chat.messages);
    messages.value = Array.isArray(chat.messages)
      ? [...chat.messages]
      : Object.values(chat.messages || {});
    // Restore agent history from saved messages so AI has full context
    const restoredHistory = chatMessagesToAgentHistory(messages.value);
    agent.setHistory(restoredHistory);
    rebuildToolMessageMap();
    agentTodos.value = [];
    agentCache.clear();
    saveActiveChatId();
    scrollToBottom();
  }
};

const deleteChat = (chatId: string) => {
  chatHistory.value = chatHistory.value.filter((c) => c.id !== chatId);

  if (activeChatId.value === chatId) {
    messages.value = [];
    activeChatId.value = "";
    agent.clearHistory();
    syncedToolCallIds.value.clear();
  }

  deleteAiChat(chatId).catch(console.error);
  saveChatHistory(true);
  saveActiveChatId();
};

const autoSaveCurrentChat = () => {
  if (messages.value.length === 0) return;

  if (activeChatId.value) {
    const chat = chatHistory.value.find((c) => c.id === activeChatId.value);
    if (chat) {
      chat.messages = [...messages.value];
      chat.updatedAt = new Date().toISOString();
      saveChatHistory();
      return;
    }
  }

  const firstUserMsg = getFirstUserMessage(messages.value);
  const newChat: Chat = {
    id: generateChatId(),
    title: firstUserMsg,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [...messages.value]
  };
  chatHistory.value.unshift(newChat);
  activeChatId.value = newChat.id;
  saveChatHistory();
  saveActiveChatId();
};

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
};

onMounted(() => {
  loadChatHistory();
  loadAgents();

  const onHide = () => {
    if (document.visibilityState === "hidden") {
      if (saveChatDebounceTimer) { clearTimeout(saveChatDebounceTimer); saveChatDebounceTimer = null; }
      saveChatHistoryImmediate();
      saveActiveChatId();
    }
  };
  document.addEventListener("visibilitychange", onHide);
});

onBeforeUnmount(() => {
  if (saveChatDebounceTimer) { clearTimeout(saveChatDebounceTimer); saveChatDebounceTimer = null; }
  saveChatHistoryImmediate();
  saveActiveChatId();
});

const truncate = (str: string | null | undefined, n: number) => {
  if (!str) return "";
  return str.length > n ? str.slice(0, n) + "..." : str;
};

// ── Skill vs Tool identification ──
const SKILL_TOOL_NAMES = new Set(["search_skills", "load_skill"]);

const isSkillTool = (name: string | undefined): boolean => {
  return SKILL_TOOL_NAMES.has(name ?? "");
};

const getSkillMessagesForAssistant = (assistantId: number) => {
  return getToolMessagesForAssistant(assistantId).filter((m) =>
    isSkillTool(m.toolName)
  );
};

const getNonSkillToolMessagesForAssistant = (assistantId: number) => {
  return getToolMessagesForAssistant(assistantId).filter(
    (m) => !isSkillTool(m.toolName) && !m.chainContext && !chainNameSet.has(m.toolName ?? "") && m.toolName !== "cache_display"
  );
};

/** Tool messages that were part of a chained tool execution */
const getChainToolMessagesForAssistant = (assistantId: number) => {
  return getToolMessagesForAssistant(assistantId).filter(
    (m) => !!m.chainContext
  );
};

/** Group chain tool messages by chainName → ordered steps */
const getChainGroupsForAssistant = (assistantId: number) => {
  const chainMsgs = getChainToolMessagesForAssistant(assistantId);
  const groups = new Map<string, ChatMessage[]>();
  for (const m of chainMsgs) {
    const key = m.chainContext!.chainName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  // Sort each group by stepIndex
  for (const msgs of groups.values()) {
    msgs.sort((a, b) => (a.chainContext?.stepIndex ?? 0) - (b.chainContext?.stepIndex ?? 0));
  }
  return groups;
};

/** cache_display tool messages — rendered inline as code blocks, not in the collapsed tool list */
const getCacheDisplayMessagesForAssistant = (assistantId: number) => {
  return getToolMessagesForAssistant(assistantId).filter(
    (m) => m.toolName === "cache_display"
  );
};

interface CacheDisplayResult {
  found: boolean;
  key: string;
  description?: string;
  sizeChars?: number;
  message?: string;
  // content is NOT in the tool result — read from agentCache directly to avoid truncation
}

const parseCacheDisplayResult = (raw: string | null | undefined): CacheDisplayResult => {
  try {
    return JSON.parse(raw ?? "{}") as CacheDisplayResult;
  } catch {
    return { found: false, key: "", message: "Could not parse display result." };
  }
};

const detectLanguage = (content: string): string => {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.includes("@NApiVersion") || trimmed.includes("define(") || trimmed.includes("function ")) return "javascript";
  if (trimmed.startsWith("<")) return "xml";
  return "text";
};

const getSkillDisplayName = (toolName: string): string => {
  if (toolName === "search_skills") return "Searching skills";
  if (toolName === "load_skill") return "Loading skill";
  return toolName;
};

// ── Contenteditable input helpers ──────────
/** Returns a rgba string from hex + alpha (0-1). */
const hexAlpha = (hex: string, alpha: number): string => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

/** Inline style object for an agent chip given its color. */
const chipStyle = (color: string) => ({
  background: hexAlpha(color, 0.12),
  border: `1px solid ${hexAlpha(color, 0.4)}`
});

/** Extract plain text from the contenteditable, skipping chip spans. */
const getInputText = (): string => {
  const el = inputRef.value;
  if (!el) return "";
  let text = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    } else if (node.nodeName === "BR") {
      text += "\n";
    } else if ((node as HTMLElement).classList?.contains("agent-chip")) {
      // skip chip
    } else {
      text += (node as HTMLElement).textContent ?? "";
    }
  }
  return text.replace(/\u200B/g, "").replace(/\u00A0/g, " ");
};

const hasChip = (): boolean =>
  !!inputRef.value &&
  Array.from(inputRef.value.childNodes).some((n) =>
    (n as HTMLElement).classList?.contains("agent-chip")
  );

const clearInput = () => {
  if (inputRef.value) inputRef.value.innerHTML = "";
  activeChipAgent.value = null;
  prompt.value = "";
};

const insertAgentChip = (ag: Agent) => {
  const el = inputRef.value;
  if (!el) return;

  el.innerHTML = "";

  const chip = document.createElement("span");
  chip.className = "agent-chip";
  chip.contentEditable = "false";
  chip.dataset.slug = ag.slug;
  // All visual styles inline — scoped CSS does not reach dynamically injected nodes
  chip.style.display = "inline-flex";
  chip.style.alignItems = "center";
  chip.style.gap = "3px";
  chip.style.borderRadius = "20px";
  chip.style.padding = "1px 8px 1px 5px";
  chip.style.fontFamily = '"JetBrains Mono", monospace';
  chip.style.fontSize = "0.72rem";
  chip.style.fontWeight = "600";
  chip.style.color = "#334155";
  chip.style.verticalAlign = "middle";
  chip.style.marginRight = "4px";
  chip.style.userSelect = "none";
  chip.style.cursor = "default";
  chip.style.whiteSpace = "nowrap";
  chip.style.background = hexAlpha(ag.color, 0.12);
  chip.style.border = `1px solid ${hexAlpha(ag.color, 0.4)}`;

  const dot = document.createElement("span");
  dot.className = "chip-dot";
  dot.style.display = "inline-block";
  dot.style.width = "7px";
  dot.style.height = "7px";
  dot.style.borderRadius = "50%";
  dot.style.flexShrink = "0";
  dot.style.background = ag.color;
  chip.appendChild(dot);
  chip.appendChild(document.createTextNode(`/${ag.slug}`));
  el.appendChild(chip);

  // Zero-width space so cursor lands after the chip
  const spacer = document.createTextNode("\u200B");
  el.appendChild(spacer);

  const range = document.createRange();
  range.setStartAfter(chip);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  activeChipAgent.value = ag;
  prompt.value = "";
};

const inputHasContent = computed(
  () => !!prompt.value.trim() || !!activeChipAgent.value
);

const autoResize = () => {
  // contenteditable grows via CSS min/max-height — no JS needed
};

// ── Slash-command autocomplete ──
const onPromptInput = () => {
  const text = getInputText();
  prompt.value = text;

  // Detect chip removal
  if (activeChipAgent.value && !hasChip()) {
    activeChipAgent.value = null;
  }

  if (!activeChipAgent.value && text.startsWith("/")) {
    const partial = text.slice(1).split(/\s/)[0]?.toLowerCase() ?? "";
    if (!text.includes(" ")) {
      slashSuggestions.value = availableAgents.value.filter((a) =>
        a.slug.toLowerCase().includes(partial)
      );
      showSlashSuggestions.value = slashSuggestions.value.length > 0;
      selectedSuggestionIndex.value = -1;
    } else {
      showSlashSuggestions.value = false;
    }
  } else {
    showSlashSuggestions.value = false;
  }
};

const onPromptBlur = () => {
  setTimeout(() => {
    showSlashSuggestions.value = false;
  }, 150);
};

const applySlashSuggestion = (ag: Agent) => {
  insertAgentChip(ag);
  showSlashSuggestions.value = false;
  selectedSuggestionIndex.value = -1;
  inputRef.value?.focus();
};

const onInputKeydown = (e: KeyboardEvent) => {
  // ── Arrow / Tab / Enter inside suggestion dropdown ──
  if (showSlashSuggestions.value && slashSuggestions.value.length > 0) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      const max = slashSuggestions.value.length - 1;
      selectedSuggestionIndex.value =
        selectedSuggestionIndex.value >= max ? 0 : selectedSuggestionIndex.value + 1;
      scrollSuggestionIntoView();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (selectedSuggestionIndex.value <= -1) {
        selectedSuggestionIndex.value = slashSuggestions.value.length - 1;
      } else {
        selectedSuggestionIndex.value = selectedSuggestionIndex.value - 1;
      }
      scrollSuggestionIntoView();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const target =
        selectedSuggestionIndex.value >= 0
          ? slashSuggestions.value[selectedSuggestionIndex.value]
          : slashSuggestions.value[0];
      if (target) applySlashSuggestion(target);
      return;
    }
    if (e.key === "Enter" && selectedSuggestionIndex.value >= 0) {
      e.preventDefault();
      const sel = slashSuggestions.value[selectedSuggestionIndex.value];
      if (sel) applySlashSuggestion(sel);
      return;
    }
    if (e.key === "Escape") {
      showSlashSuggestions.value = false;
      selectedSuggestionIndex.value = -1;
      return;
    }
  }

  // ── Alt+Enter = newline ──
  if (e.key === "Enter" && e.altKey) {
    e.preventDefault();
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const br = document.createElement("br");
      range.insertNode(br);
      range.setStartAfter(br);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      onPromptInput();
    }
    return;
  }

  // ── Send on Enter (Shift+Enter = newline) ──
  if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    sendMessage();
  }
};

const onInputPaste = (e: ClipboardEvent) => {
  const text = e.clipboardData?.getData("text/plain") ?? "";
  const sel = window.getSelection();
  if (!sel?.rangeCount) return;
  sel.deleteFromDocument();
  sel.getRangeAt(0).insertNode(document.createTextNode(text));
  sel.collapseToEnd();
  onPromptInput();
};

const scrollSuggestionIntoView = () => {
  const list = suggestionListRef.value;
  if (!list) return;
  const idx = selectedSuggestionIndex.value;
  const items = list.querySelectorAll<HTMLElement>(".slash-suggestion-item");
  items[idx]?.scrollIntoView({ block: "nearest" });
};

// ── Agent display helpers ──
const currentAgentName = computed(() => {
  if (!activeAgentSlug.value) return "";
  const ag = availableAgents.value.find((a) => a.slug === activeAgentSlug.value);
  return ag?.name ?? activeAgentSlug.value;
});

const currentAgentColor = computed(() => {
  if (!activeAgentSlug.value) return "";
  const ag = availableAgents.value.find((a) => a.slug === activeAgentSlug.value);
  return ag?.color ?? "#B8C9D4";
});

const scrollToBottom = async () => {
  await nextTick();
  requestAnimationFrame(() => {
    const el = messageListRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
};

// Map tool messages to their parent assistant message
const toolMessageToAssistant = ref<Map<number, number>>(new Map());

const rebuildToolMessageMap = () => {
  toolMessageToAssistant.value.clear();
  // Mark all restored tool messages as already synced so the watch doesn't
  // re-add them when agent.setHistory() triggers it.
  syncedToolCallIds.value.clear();
  for (const am of agent.history.value) {
    if (am.role === "tool") {
      const key = am.toolCallId ?? `${am.toolName}::${am.content}`;
      syncedToolCallIds.value.add(key);
    }
  }

  let lastAssistantId: number | null = null;
  for (const msg of messages.value) {
    if (msg.role === "assistant") {
      lastAssistantId = msg.id;
    } else if (msg.role === "tool" && lastAssistantId) {
      toolMessageToAssistant.value.set(msg.id, lastAssistantId);
    }
  }
};

const getToolMessagesForAssistant = (assistantId: number) => {
  const toolIds = Array.from(toolMessageToAssistant.value.entries())
    .filter(([, assocId]) => assocId === assistantId)
    .map(([toolMsgId]) => toolMsgId);

  return messages.value.filter(
    (m) => m.role === "tool" && toolIds.includes(m.id)
  );
};

// Track which agent tool messages have already been synced to the UI messages array.
// Keyed by toolCallId when present, otherwise by toolName+content to avoid duplicates
// from restored history. This prevents both:
//   (a) re-adding restored tool messages on chat load, and
//   (b) the old content-based dedup that would silently drop a second call to the
//       same tool returning the same result.
const syncedToolCallIds = ref<Set<string>>(new Set());

// Watch for new tool messages and link them to the last assistant message
watch(
  agent.history,
  () => {
    const toolMsgs = agent.history.value.filter((m) => m.role === "tool");
    for (const tm of toolMsgs) {
      // Build a stable key for this tool message
      const key = tm.toolCallId ?? `${tm.toolName}::${tm.content}`;
      if (syncedToolCallIds.value.has(key)) continue;

      // Skip the outer chain wrapper result — chain steps were already pushed
      // individually by onChainStepMessage in real-time. The wrapper message
      // is only needed in agent history context (for the AI), not the UI.
      if (tm.chainContext === undefined && tm.toolName && chainNameSet.has(tm.toolName)) {
        syncedToolCallIds.value.add(key);
        continue;
      }

      // Find the last assistant message to link this tool to
      const lastAssistant = messages.value
        .slice()
        .reverse()
        .find((m) => m.role === "assistant");

      const newToolMsg: ChatMessage = {
        id: Date.now() + Math.random(),
        role: "tool",
        content: tm.content,
        toolName: tm.toolName,
        // Tag with chain context if this tool was part of a chain step
        chainContext: tm.chainContext ?? (tm.toolName
          ? chainContextByToolKey.value.get(tm.toolName)
          : undefined)
      };

      messages.value.push(newToolMsg);
      syncedToolCallIds.value.add(key);

      if (lastAssistant) {
        toolMessageToAssistant.value.set(newToolMsg.id, lastAssistant.id);
      }

      scrollToBottom();
    }
  },
  { deep: true }
);

const openInSqlEditor = (code: string) => {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.set({ suiteql_pendingQuery: code }, () => {
      router.push("/suiteql");
    });
  } else {
    router.push("/suiteql");
  }
};

const stopAgent = () => {
  abortController?.abort();
  abortController = null;
  const streaming = messages.value.find((m) => m.isStreaming);
  if (streaming) {
    streaming.isStreaming = false;
    if (!streaming.content) {
      streaming.content = "Generation stopped.";
    }
  }
  inProgressTools.value = [];
  activeTools.value = [];
  currentAssistantMsgId.value = 0;
};

const startEdit = (msg: ChatMessage) => {
  editingMessageId.value = msg.id;
  editText.value = msg.content;
};

const cancelEdit = () => {
  editingMessageId.value = null;
  editText.value = "";
};

const saveEdit = (msg: ChatMessage) => {
  const idx = messages.value.findIndex((m) => m.id === msg.id);
  if (idx === -1) return;

  messages.value = messages.value.slice(0, idx);
  const restoredHistory = chatMessagesToAgentHistory(messages.value);
  agent.setHistory(restoredHistory);
  rebuildToolMessageMap();
  editingMessageId.value = null;

  sendMessage(editText.value);
};

const sendMessage = async (overrideText?: string) => {
  const rawText = overrideText !== undefined ? overrideText : getInputText().trim();
  const chipAgent = activeChipAgent.value;
  const hasAgent = overrideText === undefined && !!chipAgent;
  if (!rawText && !hasAgent && pendingAttachments.value.length === 0) return;
  if (loading.value) return;

  // Snapshot attachments then clear pending list
  const attachmentsSnapshot = [...pendingAttachments.value];
  pendingAttachments.value = [];

  inProgressTools.value = [];
  if (overrideText === undefined) {
    clearInput();
    showSlashSuggestions.value = false;
  }

  // ── Resolve agent config ──
  let agentConfig: Agent | undefined;
  let actualPrompt = rawText;

  if (hasAgent && chipAgent) {
    agentConfig = await getAgentBySlug(chipAgent.slug);
    if (agentConfig?.enabled) {
      activeAgentSlug.value = agentConfig.slug;
    } else {
      agentConfig = undefined;
    }
    // actualPrompt is rawText (without the slug prefix)
  } else {
    // Fall back to parsing a manually typed /slug
    const slashCmd = parseSlashCommand(rawText);
    if (slashCmd) {
      agentConfig = await getAgentBySlug(slashCmd.slug);
      if (agentConfig?.enabled) {
        actualPrompt = slashCmd.prompt;
        activeAgentSlug.value = slashCmd.slug;
      } else {
        agentConfig = undefined;
      }
    }
  }

  const userMsg: ChatMessage = {
    id: Date.now() + Math.random(),
    role: "user",
    content: actualPrompt,
    attachments: attachmentsSnapshot.length > 0 ? attachmentsSnapshot : undefined,
    agentContext: agentConfig
      ? { name: agentConfig.name, slug: agentConfig.slug, color: agentConfig.color }
      : undefined
  };
  messages.value.push(userMsg);
  await scrollToBottom();

  const assistantMsg: ChatMessage = {
    id: Date.now() + Math.random(),
    role: "assistant",
    content: "",
    isStreaming: true,
    agentContext: agentConfig
      ? { name: agentConfig.name, slug: agentConfig.slug, color: agentConfig.color }
      : undefined
  };
  messages.value.push(assistantMsg);
  currentAssistantMsgId.value = assistantMsg.id;
  inProgressTools.value = [];
  await scrollToBottom();

  try {
    abortController = new AbortController();

    let finalText: string;

    if (agentConfig) {
      // ── Agent-specific run ──
      const agentSystemPrompt = await buildAgentSystemPrompt(agentConfig);
      finalText = await agent.run(actualPrompt, {
        systemPrompt: agentSystemPrompt,
        signal: abortController.signal,
        allowedTools: agentConfig.tools.length > 0 ? agentConfig.tools : undefined,
        blockedTools: agentConfig.limits.blockedTools.length > 0
          ? agentConfig.limits.blockedTools
          : undefined,
        blockDestructive: !agentConfig.limits.canExecuteDestructive,
        attachments: attachmentsSnapshot.length > 0 ? attachmentsSnapshot : undefined
      });
    } else {
      // ── Normal run (with passive agent awareness) ──
      finalText = await agent.run(actualPrompt, {
        signal: abortController.signal,
        attachments: attachmentsSnapshot.length > 0 ? attachmentsSnapshot : undefined
      });
    }

    assistantMsg.content =
      typeof finalText === "string"
        ? finalText
        : JSON.stringify(finalText, null, 2);

    // Extract thinking content from the final assistant history entry and attach
    // to the UI message for display. Thinking is NOT stored in agent history context
    // (formatMessageForApi ignores the field) — this is the token efficiency benefit.
    const lastHistoryEntry = agent.history.value[agent.history.value.length - 1];
    if (lastHistoryEntry?.role === "assistant" && lastHistoryEntry.thinking) {
      assistantMsg.thinking = lastHistoryEntry.thinking;
    }

    assistantMsg.isStreaming = false;
    messages.value = [...messages.value];

    inProgressTools.value = [];
    activeTools.value = [];
    currentAssistantMsgId.value = 0;
    activeAgentSlug.value = null;

    autoSaveCurrentChat();
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      if (!assistantMsg.content) {
        assistantMsg.content = "Generation stopped.";
      }
    } else if (e instanceof ToolRejectedError) {
      assistantMsg.content = `Stopped -- tool **\`${e.toolName}\`** was rejected.`;
    } else {
      assistantMsg.content =
        "An error occurred. Check the console for details.";
      console.error(e);
    }
    assistantMsg.isStreaming = false;
    messages.value = [...messages.value];

    inProgressTools.value = [];
    activeTools.value = [];
    currentAssistantMsgId.value = 0;
    activeAgentSlug.value = null;

    autoSaveCurrentChat();
  } finally {
    abortController = null;
    await scrollToBottom();
  }
};

const handleQuestionAnswer = (answer: string) => {
  sendMessage(answer);
};
</script>

<style scoped>
.ai-assistant-view {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  height: 100%;
}

/* ── Chat Area Layout ── */
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: white;
  position: relative; /* needed for the drop overlay */
}

/* Dashed outline when files are dragged over the whole chat */
.chat-area.chat-drag-over {
  outline: 2px dashed var(--p-indigo-400);
  outline-offset: -4px;
  background: rgba(99, 102, 241, 0.02);
}

/* Full-area overlay shown during drag */
.chat-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  background: rgba(255, 255, 255, 0.93);
  pointer-events: none;
  border-radius: 4px;
}

.chat-drop-overlay p {
  font-size: 1rem;
  font-weight: 600;
  color: var(--p-indigo-600);
  margin: 0;
}

.chat-drop-overlay span {
  font-size: 0.78rem;
  color: var(--p-indigo-400);
}

/* ── Empty State ── */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: var(--p-slate-400);
}

.empty-icon {
  margin-bottom: 0.25rem;
}

.empty-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--p-slate-700);
  margin: 0;
}

.empty-sub {
  font-size: 0.8rem;
  margin: 0;
  color: var(--p-slate-400);
}

/* ── Message List ── */
.message-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0;
  scroll-behavior: smooth;
}

/* ── Agent Todos Panel ── */
.agent-todos-panel {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--p-surface-0, #fff);
  border: 1px solid var(--p-indigo-200, #c7d2fe);
  border-radius: 8px;
  margin-bottom: 1rem;
  overflow: hidden;
  box-shadow: 0 1px 4px rgba(99, 102, 241, 0.08);
}

.agent-todos-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  cursor: pointer;
  user-select: none;
  background: var(--p-indigo-50, #eef2ff);
  transition: background 0.15s;
}

.agent-todos-header:hover {
  background: var(--p-indigo-100, #e0e7ff);
}

.agent-todos-icon {
  color: var(--p-indigo-500, #6366f1);
  font-size: 0.9rem;
}

.agent-todos-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--p-indigo-700, #4338ca);
  flex: 1;
}

.agent-todos-progress {
  font-size: 0.75rem;
  color: var(--p-indigo-500, #6366f1);
  font-weight: 500;
}

.agent-todos-chevron {
  font-size: 0.7rem;
  color: var(--p-indigo-400, #818cf8);
}

.agent-todos-list {
  padding: 0.4rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.3rem 0.25rem;
  border-radius: 4px;
  font-size: 0.8rem;
  line-height: 1.4;
}

.todo-icon {
  margin-top: 0.1rem;
  font-size: 0.75rem;
  flex-shrink: 0;
}

.todo-pending .todo-icon { color: var(--p-slate-400, #94a3b8); }
.todo-in_progress .todo-icon { color: var(--p-indigo-500, #6366f1); }
.todo-done .todo-icon { color: var(--p-green-500, #22c55e); }

.todo-content { color: var(--p-slate-700, #334155); }
.todo-done .todo-content {
  text-decoration: line-through;
  color: var(--p-slate-400, #94a3b8);
}
.todo-in_progress .todo-content {
  font-weight: 500;
  color: var(--p-indigo-700, #4338ca);
}

/* ── Messages ── */
.msg {
  width: 100%;
}

/* ── User Message ── */
.msg-user {
  padding: 0.75rem 0;
}

.msg-user-content {
  background: var(--p-slate-100);
  border: 1px solid var(--p-slate-200);
  border-radius: 0.75rem;
  padding: 0.625rem 0.875rem;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--p-slate-800);
  margin-left: auto;
  max-width: 85%;
  width: fit-content;
  word-break: break-word;
}

/* ── User Message Bubble Row (edit btn + content) ── */
.msg-user-bubble-row {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 0.4rem;
}

.msg-edit-btn {
  flex-shrink: 0;
  width: 1.75rem;
  height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 0.375rem;
  color: var(--p-slate-400);
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
  font-size: 0.75rem;
  margin-top: 0.75rem;
}

.msg-user-bubble-row:hover .msg-edit-btn {
  opacity: 1;
}

.msg-edit-btn:hover {
  background: var(--p-slate-100);
  color: var(--p-slate-600);
  border-color: var(--p-slate-200);
}

.msg-edit-area {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.msg-edit-textarea {
  width: 100%;
  min-height: 80px;
  max-height: 300px;
  border: 1px solid var(--p-blue-300);
  border-radius: 0.5rem;
  padding: 0.625rem 0.75rem;
  font-family: inherit;
  font-size: 0.85rem;
  color: var(--p-slate-800);
  background: white;
  outline: none;
  resize: vertical;
  line-height: 1.5;
  box-sizing: border-box;
}

.msg-edit-textarea:focus {
  border-color: var(--p-blue-400);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-blue-400) 15%, transparent);
}

.msg-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.msg-edit-btn-save,
.msg-edit-btn-cancel {
  padding: 0.35rem 0.875rem;
  border-radius: 0.375rem;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
  font-family: inherit;
}

.msg-edit-btn-save {
  background: var(--p-blue-600);
  color: white;
  border-color: var(--p-blue-700);
}

.msg-edit-btn-save:hover {
  background: var(--p-blue-700);
}

.msg-edit-btn-cancel {
  background: var(--p-slate-100);
  color: var(--p-slate-600);
  border-color: var(--p-slate-200);
}

.msg-edit-btn-cancel:hover {
  background: var(--p-slate-200);
}

/* ── Assistant Message ── */
.msg-assistant {
  padding: 0.5rem 0;
}

.msg-assistant-content {
  font-size: 0.85rem;
  line-height: 1.65;
  color: var(--p-slate-700);
}

/* ── Tool Group ── */
.tool-group {
  margin-bottom: 0.5rem;
}

/* ── Skill Group ── */
.skill-group {
  margin-bottom: 0.5rem;
}

/* ── Compaction Indicator ── */
.msg-compaction {
  padding: 0.5rem 0;
}

.compaction-details {
  border: 1px solid var(--p-amber-200, #fde68a);
  border-radius: 0.5rem;
  overflow: hidden;
  font-size: 0.75rem;
}

.compaction-summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.65rem;
  background: var(--p-amber-50, #fffbeb);
  cursor: pointer;
  color: var(--p-amber-700, #b45309);
  font-size: 0.75rem;
  font-weight: 500;
  list-style: none;
  user-select: none;
  transition: background 0.15s ease;
}

.compaction-summary::-webkit-details-marker {
  display: none;
}

.compaction-summary:hover {
  background: var(--p-amber-100, #fef3c7);
}

.compaction-icon {
  font-size: 0.7rem;
  color: var(--p-amber-500, #f59e0b);
}

.compaction-chevron {
  font-size: 0.55rem;
  margin-left: auto;
  color: var(--p-amber-400, #fbbf24);
  transition: transform 0.2s ease;
}

.compaction-details[open] .compaction-chevron {
  transform: rotate(180deg);
}

.compaction-content {
  border-top: 1px solid var(--p-amber-200, #fde68a);
  padding: 0.65rem;
  max-height: 300px;
  overflow-y: auto;
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--p-amber-800, #92400e);
  background: var(--p-amber-50, #fffbeb);
}

/* Running skill indicator */
.skill-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0;
  font-size: 0.75rem;
}

.skill-item-running {
  color: var(--p-violet-600, #7c3aed);
}

.skill-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}

.skill-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--p-violet-200, #ddd6fe);
  border-top-color: var(--p-violet-500, #8b5cf6);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.skill-label {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.7rem;
  color: var(--p-violet-600, #7c3aed);
}

/* Completed skill details */
.skill-details {
  border: 1px solid var(--p-violet-200, #ddd6fe);
  border-radius: 0.5rem;
  overflow: hidden;
  font-size: 0.75rem;
}

.skill-summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.65rem;
  background: var(--p-violet-50, #f5f3ff);
  cursor: pointer;
  color: var(--p-violet-700, #6d28d9);
  font-size: 0.75rem;
  font-weight: 500;
  list-style: none;
  user-select: none;
  transition: background 0.15s ease;
}

.skill-summary::-webkit-details-marker {
  display: none;
}

.skill-summary:hover {
  background: var(--p-violet-100, #ede9fe);
}

.skill-icon {
  font-size: 0.7rem;
  color: var(--p-violet-500, #8b5cf6);
}

.skill-chevron {
  font-size: 0.55rem;
  margin-left: auto;
  color: var(--p-violet-400, #a78bfa);
  transition: transform 0.2s ease;
}

.skill-details[open] .skill-chevron {
  transform: rotate(180deg);
}

.skill-results-list {
  border-top: 1px solid var(--p-violet-200, #ddd6fe);
  max-height: 200px;
  overflow-y: auto;
}

.skill-result-row {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.4rem 0.65rem;
  border-bottom: 1px solid var(--p-violet-100, #ede9fe);
}

.skill-result-row:last-child {
  border-bottom: none;
}

.skill-result-name {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.675rem;
  font-weight: 600;
  color: var(--p-violet-700, #6d28d9);
}

.skill-result-content {
  font-size: 0.675rem;
  color: var(--p-violet-400, #a78bfa);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Running tool indicator */
.tool-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0;
  font-size: 0.75rem;
}

.tool-item-running {
  color: var(--p-slate-500);
}

/* Chain step running indicator */
.chain-step-running {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.3rem 0.5rem;
  border-left: 2px solid var(--p-indigo-300, #a5b4fc);
  border-radius: 0 0.375rem 0.375rem 0;
  background: var(--p-indigo-50, #eef2ff);
  margin-bottom: 0.25rem;
}

.chain-step-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.65rem;
  color: var(--p-indigo-500, #6366f1);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.chain-step-icon {
  font-size: 0.6rem;
  color: var(--p-indigo-400, #818cf8);
}

.chain-step-chain-name {
  font-family: "JetBrains Mono", monospace;
}

.chain-step-progress {
  margin-left: auto;
  font-weight: 500;
  color: var(--p-indigo-400, #818cf8);
}

.chain-step-body {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.chain-step-label {
  font-size: 0.72rem;
  color: var(--p-indigo-700, #4338ca);
  font-weight: 500;
}

.chain-step-tool-name {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.65rem;
  color: var(--p-indigo-400, #818cf8);
  margin-left: 0.15rem;
}

/* ── Completed chain group ── */
.chain-group {
  margin-bottom: 0.5rem;
}

.chain-details {
  border: 1px solid var(--p-indigo-200, #c7d2fe);
  border-radius: 0.5rem;
  overflow: hidden;
  font-size: 0.75rem;
  margin-bottom: 0.25rem;
}

.chain-summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.65rem;
  background: var(--p-indigo-50, #eef2ff);
  cursor: pointer;
  color: var(--p-indigo-700, #4338ca);
  font-size: 0.75rem;
  font-weight: 500;
  list-style: none;
  user-select: none;
  transition: background 0.15s ease;
}

.chain-summary::-webkit-details-marker {
  display: none;
}

.chain-summary:hover {
  background: var(--p-indigo-100, #e0e7ff);
}

.chain-summary-icon {
  font-size: 0.7rem;
  color: var(--p-indigo-500, #6366f1);
}

.chain-summary-name {
  font-family: "JetBrains Mono", monospace;
  font-weight: 600;
}

.chain-summary-steps {
  margin-left: auto;
  font-size: 0.65rem;
  color: var(--p-indigo-400, #818cf8);
  font-weight: 400;
}

.chain-summary-chevron {
  font-size: 0.55rem;
  color: var(--p-indigo-400, #818cf8);
  transition: transform 0.2s ease;
  margin-left: 0.25rem;
}

.chain-details[open] .chain-summary-chevron {
  transform: rotate(180deg);
}

.chain-results-list {
  border-top: 1px solid var(--p-indigo-200, #c7d2fe);
  max-height: 300px;
  overflow-y: auto;
}

.chain-result-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.45rem 0.65rem;
  border-bottom: 1px solid var(--p-indigo-100, #e0e7ff);
}

.chain-result-row:last-child {
  border-bottom: none;
}

.chain-result-step-badge {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--p-indigo-500, #6366f1);
  color: white;
  font-size: 0.6rem;
  font-weight: 700;
  margin-top: 0.1rem;
}

.chain-result-info {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  flex: 1;
}

.chain-result-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.chain-result-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--p-indigo-700, #4338ca);
}

.chain-result-tool {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.6rem;
  color: var(--p-indigo-400, #818cf8);
}

.chain-result-content {
  font-size: 0.65rem;
  color: var(--p-indigo-500, #6366f1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tool-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}

.tool-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--p-slate-300);
  border-top-color: var(--p-blue-500);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.tool-label {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.7rem;
  color: var(--p-slate-500);
}

/* Completed tool details */
.tool-details {
  border: 1px solid var(--p-slate-200);
  border-radius: 0.5rem;
  overflow: hidden;
  font-size: 0.75rem;
}

.tool-summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.65rem;
  background: var(--p-slate-50);
  cursor: pointer;
  color: var(--p-slate-600);
  font-size: 0.75rem;
  font-weight: 500;
  list-style: none;
  user-select: none;
  transition: background 0.15s ease;
}

.tool-summary::-webkit-details-marker {
  display: none;
}

.tool-summary:hover {
  background: var(--p-slate-100);
}

.tool-check-icon {
  font-size: 0.7rem;
  color: var(--p-green-600);
}

.tool-chevron {
  font-size: 0.55rem;
  margin-left: auto;
  color: var(--p-slate-400);
  transition: transform 0.2s ease;
}

.tool-details[open] .tool-chevron {
  transform: rotate(180deg);
}

.tool-results-list {
  border-top: 1px solid var(--p-slate-200);
  max-height: 200px;
  overflow-y: auto;
}

.tool-result-row {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.4rem 0.65rem;
  border-bottom: 1px solid var(--p-slate-100);
}

.tool-result-row:last-child {
  border-bottom: none;
}

/* ── Inline cache_display blocks ─────────────────────────────── */
.cache-display-block {
  margin: 8px 0;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
}

.cache-display-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: var(--color-bg-subtle, #2d2d2d);
  border-bottom: 1px solid var(--color-border, #3a3a3a);
  font-size: 12px;
  color: var(--color-text-muted, #94a3b8);
}

.cache-display-icon {
  font-size: 13px;
  color: var(--color-text-muted, #94a3b8);
  flex-shrink: 0;
}

.cache-display-description {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text, #cbd5e1);
  font-weight: 500;
}

.cache-display-size {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-muted, #64748b);
}

.cache-display-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  color: var(--color-error, #f87171);
  font-size: 13px;
}

.tool-result-name {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.675rem;
  font-weight: 600;
  color: var(--p-slate-600);
}

.tool-result-content {
  font-size: 0.675rem;
  color: var(--p-slate-400);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Thinking Indicator ── */
.thinking-indicator {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0.25rem 0;
}

.thinking-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--p-slate-400);
  animation: thinking 1.4s ease-in-out infinite;
}

.thinking-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.thinking-dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes thinking {
  0%,
  80%,
  100% {
    opacity: 0.25;
    transform: scale(0.85);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

/* ── Error Banner ── */
.error-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--p-red-50);
  border-top: 1px solid var(--p-red-200);
  color: var(--p-red-700);
  font-size: 0.8rem;
}

.error-banner i {
  font-size: 0.85rem;
}

/* ── Input Wrapper ── */
.input-wrapper {
  border-top: 1px solid var(--p-slate-200);
  background: var(--p-slate-50);
}

/* ── Chat Toolbar ── */
.chat-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0.35rem 0.875rem;
  border-bottom: 1px solid var(--p-slate-100);
  background: transparent;
  min-height: 2rem;
}

/* ── Input Row ── */
.input-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 0.875rem;
  background: transparent;
}

.chat-input {
  flex: 1;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.625rem;
  padding: 0.5rem 0.75rem;
  font-family: inherit;
  font-size: 0.85rem;
  color: var(--p-slate-800);
  background: white;
  outline: none;
  min-height: 2.5rem;
  max-height: 160px;
  overflow-y: auto;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
  line-height: 1.5;
  scrollbar-width: none;
  white-space: pre-wrap;
  word-break: break-word;
  cursor: text;
}

.chat-input::-webkit-scrollbar {
  display: none;
}

.chat-input:focus {
  border-color: var(--p-blue-400);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-blue-400) 15%, transparent);
}

/* Placeholder via data attribute (CSS :empty doesn't work reliably after DOM ops) */
.chat-input:empty::before {
  content: attr(data-placeholder);
  color: var(--p-slate-400);
  pointer-events: none;
}

/* Disabled state when loading */
.chat-input[contenteditable="false"] {
  opacity: 0.5;
  cursor: not-allowed;
  user-select: none;
}

/* ── Agent Chip (inside input + in messages) ── */
.agent-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border-radius: 20px;
  padding: 1px 8px 1px 5px;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-slate-700);
  vertical-align: middle;
  margin-right: 4px;
  user-select: none;
  cursor: default;
  white-space: nowrap;
  /* border and background set inline by JS */
}

.chip-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ── Agent Chip in Messages ── */
.msg-agent-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border-radius: 20px;
  padding: 0.1rem 0.55rem 0.1rem 0.4rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--p-slate-700);
  margin-bottom: 0.25rem;
  white-space: nowrap;
  /* border and background set inline */
}

.msg-agent-chip.msg-agent-chip--assistant {
  font-family: inherit;
  font-size: 0.72rem;
  letter-spacing: 0;
}

.send-btn {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--p-slate-800);
  color: white;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 0.8rem;
}

.send-btn:hover:not(:disabled) {
  background: var(--p-slate-900);
}

.send-btn:disabled {
  background: var(--p-slate-300);
  cursor: not-allowed;
}

.stop-btn {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--p-red-600);
  color: white;
  border: none;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 0.8rem;
}

.stop-btn:hover {
  background: var(--p-red-700);
}

/* ── Attach Button ── */
.attach-btn {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--p-slate-400);
  border: 1px solid var(--p-slate-200);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 0.8rem;
}

.attach-btn:hover:not(:disabled) {
  background: var(--p-slate-100);
  color: var(--p-slate-600);
  border-color: var(--p-slate-300);
}

.attach-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Pending Attachments (pre-send chips) ── */
.pending-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  padding: 0.375rem 0 0;
}

.pending-attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: var(--p-blue-50, #eff6ff);
  border: 1px solid var(--p-blue-200, #bfdbfe);
  border-radius: 0.375rem;
  padding: 0.2rem 0.375rem 0.2rem 0.5rem;
  font-size: 0.72rem;
  color: var(--p-blue-700, #1d4ed8);
  max-width: 220px;
}

.attachment-chip-icon {
  font-size: 0.7rem;
  flex-shrink: 0;
}

.attachment-chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.attachment-chip-size {
  color: var(--p-blue-400, #60a5fa);
  white-space: nowrap;
  font-size: 0.65rem;
}

.attachment-remove-btn {
  background: none;
  border: none;
  padding: 0 0 0 2px;
  cursor: pointer;
  color: var(--p-blue-400, #60a5fa);
  font-size: 0.6rem;
  line-height: 1;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  transition: color 0.15s;
}

.attachment-remove-btn:hover {
  color: var(--p-red-500);
}

/* ── Message Attachment Chips (on sent messages) ── */
.msg-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  justify-content: flex-end;
  margin-bottom: 0.3rem;
}

.msg-attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: var(--p-slate-200);
  border: 1px solid var(--p-slate-300);
  border-radius: 0.375rem;
  padding: 0.15rem 0.5rem;
  font-size: 0.7rem;
  color: var(--p-slate-600);
  max-width: 200px;
}

.msg-attachment-chip .attachment-chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Generated PDF Card ── */
.generated-pdf-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.generated-pdf-card {
  border: 1px solid var(--p-slate-200);
  border-radius: 0.5rem;
  overflow: hidden;
  background: var(--p-slate-50);
}

.generated-pdf-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--p-slate-100);
  border-bottom: 1px solid var(--p-slate-200);
  font-size: 0.78rem;
}

.generated-pdf-icon {
  color: var(--p-red-500);
  font-size: 0.85rem;
  flex-shrink: 0;
}

.generated-pdf-name {
  font-weight: 600;
  color: var(--p-slate-700);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.generated-pdf-size {
  color: var(--p-slate-400);
  font-size: 0.7rem;
  white-space: nowrap;
}

.generated-pdf-download {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.6rem;
  background: var(--p-slate-800);
  color: white;
  border-radius: 0.375rem;
  font-size: 0.72rem;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.15s;
  flex-shrink: 0;
}

.generated-pdf-download:hover {
  background: var(--p-slate-900);
}

.generated-pdf-action {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.6rem;
  background: var(--p-slate-100);
  color: var(--p-slate-700);
  border: 1px solid var(--p-slate-200);
  border-radius: 0.375rem;
  font-size: 0.72rem;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.15s;
  flex-shrink: 0;
  cursor: pointer;
  font-family: inherit;
}

.generated-pdf-action:hover {
  background: var(--p-slate-200);
}

.generated-pdf-download {
  background: var(--p-indigo-600);
  color: white;
  border-color: var(--p-indigo-700);
}

.generated-pdf-download:hover:not(:disabled) {
  background: var(--p-indigo-700);
}

.generated-pdf-downloading {
  opacity: 0.7;
  cursor: not-allowed;
}

.generated-pdf-iframe {
  width: 100%;
  height: 480px;
  display: block;
  border: none;
}

/* ── Token Counter styles ── */
.token-counter {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.65rem;
  font-family: "JetBrains Mono", monospace;
  font-weight: 500;
  padding: 0.15rem 0.45rem;
  border-radius: 0.25rem;
  border: 1px solid transparent;
  white-space: nowrap;
  line-height: 1.4;
  transition:
    color 0.2s ease,
    background 0.2s ease,
    border-color 0.2s ease;
}

.token-counter--ok {
  background: var(--p-slate-100);
  border-color: var(--p-slate-200);
  color: var(--p-slate-400);
}

.token-counter--warn {
  background: var(--p-amber-50, #fffbeb);
  border-color: var(--p-amber-200, #fde68a);
  color: var(--p-amber-600, #d97706);
}

.token-counter--danger {
  background: var(--p-red-50);
  border-color: var(--p-red-200);
  color: var(--p-red-600);
}

/* ── Sidebar ── */
.sidebar-header {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  border-bottom: 1px solid var(--p-slate-200);
}

.sidebar-header h3 {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-slate-700);
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.chat-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background 0.15s ease;
}

.chat-item:hover {
  background: var(--p-slate-100);
}

.chat-item.active {
  background: var(--p-blue-50);
  border: 1px solid var(--p-blue-200);
}

.chat-item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.chat-title {
  font-size: 0.775rem;
  font-weight: 500;
  color: var(--p-slate-700);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-date {
  font-size: 0.65rem;
  color: var(--p-slate-400);
}

.chat-delete-btn {
  opacity: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.375rem;
  height: 1.375rem;
  background: transparent;
  border: none;
  border-radius: 0.25rem;
  color: var(--p-slate-400);
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 0.7rem;
}

.chat-item:hover .chat-delete-btn {
  opacity: 1;
}

.chat-delete-btn:hover {
  background: var(--p-red-100);
  color: var(--p-red-600);
}

.no-chats {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  color: var(--p-slate-400);
  font-size: 0.775rem;
  text-align: center;
}

/* ── Markdown in assistant messages ── */
.msg-assistant-content :deep(p) {
  margin: 0 0 0.5rem;
  line-height: 1.7;
}

.msg-assistant-content :deep(p:last-child) {
  margin-bottom: 0;
}

.msg-assistant-content :deep(h1),
.msg-assistant-content :deep(h2),
.msg-assistant-content :deep(h3),
.msg-assistant-content :deep(h4) {
  font-weight: 600;
  color: var(--p-slate-900);
  line-height: 1.3;
}

.msg-assistant-content :deep(h1) {
  font-size: 1.05rem;
  margin: 1rem 0 0.4rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--p-slate-200);
}

.msg-assistant-content :deep(h2) {
  font-size: 0.95rem;
  margin: 0.85rem 0 0.35rem;
}

.msg-assistant-content :deep(h3) {
  font-size: 0.875rem;
  margin: 0.65rem 0 0.3rem;
}

.msg-assistant-content :deep(h4) {
  font-size: 0.8125rem;
  margin: 0.5rem 0 0.25rem;
}

.msg-assistant-content :deep(ul),
.msg-assistant-content :deep(ol) {
  margin: 0.35rem 0 0.5rem;
  padding-left: 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.msg-assistant-content :deep(li) {
  line-height: 1.6;
  color: var(--p-slate-700);
}

.msg-assistant-content :deep(ul > li) {
  list-style-type: disc;
}

.msg-assistant-content :deep(ol > li) {
  list-style-type: decimal;
}

.msg-assistant-content :deep(li > ul),
.msg-assistant-content :deep(li > ol) {
  margin: 0.15rem 0 0;
  padding-left: 1.1rem;
}

.msg-assistant-content :deep(li > ul > li) {
  list-style-type: circle;
}

.msg-assistant-content :deep(strong) {
  font-weight: 600;
  color: var(--p-slate-900);
}

.msg-assistant-content :deep(em) {
  font-style: italic;
  color: var(--p-slate-600);
}

.msg-assistant-content :deep(code) {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.775rem;
  background: var(--p-slate-100);
  padding: 2px 5px;
  border-radius: 3px;
  color: var(--p-slate-800);
  border: 1px solid var(--p-slate-200);
}

.msg-assistant-content :deep(a) {
  color: var(--p-blue-600);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.15s ease;
}

.msg-assistant-content :deep(a:hover) {
  border-bottom-color: var(--p-blue-400);
}

.msg-assistant-content :deep(blockquote) {
  border-left: 3px solid var(--p-blue-200);
  margin: 0.5rem 0;
  padding: 0.35rem 0.75rem;
  color: var(--p-slate-500);
  font-style: italic;
  background: var(--p-slate-50);
  border-radius: 0 0.25rem 0.25rem 0;
}

.msg-assistant-content :deep(hr) {
  border: none;
  border-top: 1px solid var(--p-slate-200);
  margin: 0.75rem 0;
}

/* ── Compaction Approval Dialog ── */
.compaction-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.compaction-dialog {
  background: white;
  border-radius: 0.75rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  width: 360px;
  max-width: 92vw;
  overflow: hidden;
}

.compaction-dialog-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 1rem 0.625rem;
  background: var(--p-amber-50, #fffbeb);
  border-bottom: 1px solid var(--p-amber-200, #fde68a);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-amber-800, #92400e);
}

.compaction-dialog-icon {
  color: var(--p-amber-500, #f59e0b);
  font-size: 0.85rem;
}

.compaction-dialog-body {
  padding: 1rem;
  font-size: 0.825rem;
  color: var(--p-slate-600);
  line-height: 1.6;
}

.compaction-dialog-body p {
  margin: 0 0 0.5rem;
}

.compaction-dialog-body p:last-child {
  margin-bottom: 0;
}

.compaction-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--p-slate-100);
}

.compaction-btn {
  padding: 0.4rem 0.875rem;
  border-radius: 0.4rem;
  border: 1px solid transparent;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.compaction-btn--skip {
  background: var(--p-slate-100);
  border-color: var(--p-slate-200);
  color: var(--p-slate-600);
}

.compaction-btn--skip:hover {
  background: var(--p-slate-200);
}

.compaction-btn--compact {
  background: var(--p-amber-500, #f59e0b);
  border-color: var(--p-amber-600, #d97706);
  color: white;
}

.compaction-btn--compact:hover {
  background: var(--p-amber-600, #d97706);
}

/* ── Agent Indicator (toolbar) ── */
.agent-indicator {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-slate-600);
  padding: 0.15rem 0.5rem;
  background: var(--p-slate-50);
  border-radius: 0.25rem;
  border: 1px solid var(--p-slate-200);
}

.agent-indicator-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ── Slash Command Suggestions ── */
.slash-suggestions {
  border-bottom: 1px solid var(--p-slate-100);
  padding: 0.25rem 0;
  max-height: 160px;
  overflow-y: auto;
}

.slash-suggestion-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  cursor: pointer;
  transition: background 0.1s;
  font-size: 0.8rem;
}

.slash-suggestion-item:hover {
  background: var(--p-slate-50);
}

.slash-suggestion-active {
  background: var(--p-blue-50) !important;
  outline: 1px solid var(--p-blue-200);
  outline-offset: -1px;
}

.slash-suggestion-active .slash-cmd {
  color: var(--p-blue-700);
}

.slash-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.slash-cmd {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-slate-700);
}

.slash-desc {
  font-size: 0.72rem;
  color: var(--p-slate-400);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

/* ── Legacy badge refs removed — replaced by .msg-agent-chip ── */
.agent-badge-dot { display: none; }
.msg-agent-badge { display: none; }
.msg-agent-response-badge { display: none; }

/* ── Thinking / Reasoning Block ── */
.thinking-block {
  margin-bottom: 0.5rem;
  border: 1px solid var(--p-violet-200, #ddd6fe);
  border-radius: 0.5rem;
  overflow: hidden;
  font-size: 0.75rem;
}

.thinking-block-summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.65rem;
  background: var(--p-violet-50, #f5f3ff);
  cursor: pointer;
  color: var(--p-violet-700, #6d28d9);
  font-size: 0.75rem;
  font-weight: 500;
  list-style: none;
  user-select: none;
  transition: background 0.15s ease;
}

.thinking-block-summary::-webkit-details-marker {
  display: none;
}

.thinking-block-summary:hover {
  background: var(--p-violet-100, #ede9fe);
}

.thinking-block-icon {
  font-size: 0.7rem;
  color: var(--p-violet-500, #8b5cf6);
}

.thinking-block-chevron {
  margin-left: auto;
  font-size: 0.6rem;
  color: var(--p-violet-400, #a78bfa);
  transition: transform 0.2s ease;
}

.thinking-block[open] .thinking-block-chevron {
  transform: rotate(180deg);
}

.thinking-block-content {
  padding: 0.625rem 0.75rem;
  background: var(--p-slate-50);
  border-top: 1px solid var(--p-violet-100, #ede9fe);
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--p-slate-600);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  font-family: inherit;
  max-height: 300px;
  overflow-y: auto;
}

/* ── Thinking Toggle Button ── */
.thinking-toggle-btn {
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--p-slate-400);
  border: 1px solid var(--p-slate-200);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 0.8rem;
}

.thinking-toggle-btn:hover:not(:disabled) {
  background: var(--p-violet-50, #f5f3ff);
  color: var(--p-violet-500, #8b5cf6);
  border-color: var(--p-violet-300, #c4b5fd);
}

.thinking-toggle-btn--active {
  background: var(--p-violet-50, #f5f3ff);
  color: var(--p-violet-600, #7c3aed);
  border-color: var(--p-violet-400, #a78bfa);
}

.thinking-toggle-btn--active:hover:not(:disabled) {
  background: var(--p-violet-100, #ede9fe);
  color: var(--p-violet-700, #6d28d9);
}

.thinking-toggle-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ── Thinking-in-progress indicator (loading state with thinking mode ON) ── */
.thinking-in-progress {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--p-violet-600, #7c3aed);
  font-size: 0.8rem;
}

.thinking-in-progress-icon {
  font-size: 0.75rem;
  animation: thinking-pulse 1.5s ease-in-out infinite;
}

.thinking-in-progress-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--p-violet-600, #7c3aed);
  margin-right: 0.15rem;
}

@keyframes thinking-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
</style>
