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
                <div class="section-label">Workspace</div>
                <div class="harness-section-nav">
                  <button
                    v-for="item in harnessNavItems"
                    :key="item.id"
                    type="button"
                    class="harness-section-btn"
                    :class="{ active: activeHarnessSection === item.id }"
                    @click="setHarnessSection(item.id)"
                  >
                    <i :class="item.icon" />
                    <span>{{ item.label }}</span>
                  </button>
                </div>
              </div>

              <div v-if="activeHarnessSection === 'chat'" class="sidebar-section">
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

              <div v-if="activeHarnessSection === 'chat'" class="sidebar-section sidebar-section--grow">
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

              <div v-if="activeHarnessSection === 'chat'" class="sidebar-section">
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

        <main v-if="activeHarnessSection === 'chat'" class="harness-main">
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
              <div ref="streamRef" class="stream-list" @scroll.passive="onStreamScroll">
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
                            <i :class="attachmentIcon(attachment)" />
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
                            @load="handleDynamicContentLoad"
                          />
                          <iframe
                            v-else
                            class="artifact-frame"
                            :src="artifact.url"
                            :title="artifact.title"
                            @load="handleDynamicContentLoad"
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
                    <i :class="attachmentIcon(attachment)" />
                    <span>{{ attachment.name }}</span>
                    <small v-if="attachment.deferred" class="attachment-pending">loads on send</small>
                    <small v-else>{{ formatFileSize(attachment.size) }}</small>
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
                    title="Add NetSuite record or File Cabinet context"
                    @click="openContextPicker('records')"
                  >
                    <i class="pi pi-database" />
                  </button>
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

        <main v-else-if="activeHarnessSection === 'agents'" class="harness-main harness-dashboard-main">
          <header class="dashboard-toolbar">
            <div>
              <div class="toolbar-title">
                <i class="pi pi-users" />
                <span>Agents</span>
              </div>
              <p>Configure the harness specialists, their permissions, and the tool categories they can see.</p>
            </div>
            <div class="dashboard-actions">
              <InputText v-model="agentManagerSearch" placeholder="Search agents..." class="dashboard-search" />
              <button type="button" class="agent-primary-btn" @click="openCreateAgentDialog">
                <i class="pi pi-plus" />
                <span>New Agent</span>
              </button>
            </div>
          </header>

          <section class="dashboard-grid">
            <article
              v-for="agent in filteredHarnessAgents"
              :key="agent.id"
              class="manager-card"
              :class="{ muted: agent.enabled === false }"
            >
              <div class="manager-card-header">
                <span class="manager-agent-mark" :style="{ background: agent.color }">
                  <i :class="agent.icon" />
                </span>
                <div class="manager-card-title">
                  <strong>{{ agent.name }}</strong>
                  <span>{{ agent.description }}</span>
                </div>
                <button
                  type="button"
                  class="toolset-switch"
                  :class="{ active: agent.enabled !== false }"
                  :title="agent.enabled === false ? 'Enable agent' : 'Disable agent'"
                  @click="toggleHarnessAgentEnabled(agent)"
                >
                  <span />
                </button>
              </div>
              <div class="manager-card-meta">
                <span><i class="pi pi-shield" />{{ agent.defaultPermissionMode }}</span>
                <span><i class="pi pi-forward" />{{ agent.maxSteps }} steps</span>
                <span><i class="pi pi-wrench" />{{ agent.toolsets.length }} toolsets</span>
              </div>
              <div class="manager-chip-row">
                <span v-for="toolset in agent.toolsets" :key="`${agent.id}-${toolset}`" class="manager-chip">
                  {{ toolset }}
                </span>
              </div>
              <div class="manager-card-actions">
                <button type="button" class="agent-secondary-btn" @click="harness.setActiveAgent(agent.id); setHarnessSection('chat')">
                  <i class="pi pi-comments" />
                  <span>Use</span>
                </button>
                <button type="button" class="agent-secondary-btn" @click="openEditAgentDialog(agent)">
                  <i class="pi pi-pencil" />
                  <span>Edit</span>
                </button>
                <button type="button" class="agent-secondary-btn" @click="harness.duplicateAgent(agent.id)">
                  <i class="pi pi-copy" />
                  <span>Duplicate</span>
                </button>
              </div>
            </article>
          </section>
        </main>

        <main v-else class="harness-main harness-dashboard-main">
          <header class="dashboard-toolbar">
            <div>
              <div class="toolbar-title">
                <i class="pi pi-book" />
                <span>Skills</span>
              </div>
              <p>Maintain reusable instructions and domain knowledge that the AI tools can retrieve.</p>
            </div>
            <div class="dashboard-actions">
              <InputText v-model="skillSearch" placeholder="Search skills..." class="dashboard-search" />
              <input
                ref="skillFileInputRef"
                type="file"
                accept=".json,.md,.txt"
                multiple
                hidden
                @change="importSkillFiles"
              />
              <button type="button" class="agent-secondary-btn" @click="triggerSkillImport">
                <i class="pi pi-upload" />
                <span>Import</span>
              </button>
              <button type="button" class="agent-secondary-btn" @click="exportSkills">
                <i class="pi pi-download" />
                <span>Export</span>
              </button>
              <button type="button" class="agent-primary-btn" @click="openCreateSkillDialog">
                <i class="pi pi-plus" />
                <span>Add Skill</span>
              </button>
            </div>
          </header>

          <section class="dashboard-list">
            <article
              v-for="skill in filteredHarnessSkills"
              :key="skill.id"
              class="manager-card skill-manager-card"
              :class="{ muted: skill.enabled === false }"
            >
              <div class="manager-card-header">
                <span class="manager-agent-mark manager-agent-mark--skill">
                  <i class="pi pi-book" />
                </span>
                <div class="manager-card-title">
                  <strong>{{ skill.name }}</strong>
                  <span>{{ skill.description }}</span>
                </div>
                <button
                  type="button"
                  class="toolset-switch"
                  :class="{ active: skill.enabled !== false }"
                  title="Enable or disable skill"
                  @click="toggleSkillEnabled(skill)"
                >
                  <span />
                </button>
              </div>
              <div class="manager-chip-row">
                <span v-if="skill.domain === 'sql'" class="manager-chip manager-chip--strong">SQL</span>
                <span v-for="tag in parseSkillTags(skill.tags)" :key="`${skill.id}-${tag}`" class="manager-chip">
                  {{ tag }}
                </span>
              </div>
              <div class="manager-card-meta">
                <span><i class="pi pi-clock" />{{ formatSkillDate(skill.updatedAt) }}</span>
                <span><i class="pi pi-align-left" />{{ formatSkillSize(skill.content.length) }}</span>
              </div>
              <div class="manager-card-actions">
                <button type="button" class="agent-secondary-btn" @click="openEditSkillDialog(skill)">
                  <i class="pi pi-pencil" />
                  <span>Edit</span>
                </button>
                <button type="button" class="agent-danger-btn" @click="confirmDeleteSkill(skill)">
                  <i class="pi pi-trash" />
                  <span>Delete</span>
                </button>
              </div>
            </article>
            <div v-if="filteredHarnessSkills.length === 0" class="dashboard-empty">
              <i class="pi pi-book" />
              <span>No skills match this search.</span>
            </div>
          </section>
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

    <Teleport to="body">
      <div
        v-if="contextPickerVisible"
        class="context-modal-overlay"
        @click.self="closeContextPicker"
      >
        <div
          class="context-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="context-modal-title"
          @click.stop
        >
          <header class="context-modal-header">
            <h2 id="context-modal-title">Add NetSuite Context</h2>
            <button type="button" class="context-modal-close" title="Close" @click="closeContextPicker">
              <i class="pi pi-times" />
            </button>
          </header>

          <div class="context-modal-body">
        <div class="context-tabs">
          <button
            type="button"
            :class="{ active: contextPickerTab === 'records' }"
            @click="contextPickerTab = 'records'; loadRecordTypes()"
          >
            <i class="pi pi-table" />
            <span>Records</span>
          </button>
          <button
            type="button"
            :class="{ active: contextPickerTab === 'files' }"
            @click="contextPickerTab = 'files'"
          >
            <i class="pi pi-folder" />
            <span>File Cabinet</span>
          </button>
        </div>

        <section v-if="contextPickerTab === 'records'" class="context-panel context-panel--records">
          <div class="context-toolbar">
            <Select
              v-model="selectedRecordTypeId"
              :options="recordTypes"
              option-label="name"
              option-value="id"
              data-key="id"
              placeholder="Record type"
              filter
              append-to="body"
              class="context-select"
              :loading="recordTypesLoading"
              :disabled="recordTypesLoading && recordTypes.length === 0"
              @change="selectRecordType"
            />
            <InputText
              v-model="recordSearch"
              placeholder="Search name, id, tranid..."
              class="context-search"
              @keydown.enter.prevent="loadRecordPage(1)"
            />
            <button type="button" class="agent-secondary-btn" :disabled="!selectedRecordType || recordsLoading" @click="loadRecordPage(1)">
              <i :class="recordsLoading ? 'pi pi-spin pi-spinner' : 'pi pi-search'" />
              <span>Search</span>
            </button>
          </div>
          <div v-if="recordListError" class="context-error">{{ recordListError }}</div>
          <div
            v-else-if="!recordTypesLoading && recordTypes.length === 0"
            class="context-error context-error--hint"
          >
            No record types loaded. Check your NetSuite connection and try again.
          </div>
          <div class="context-table-host">
            <DataTable
              :value="filteredRecordRows"
              data-key="id"
              class="context-data-table"
              size="small"
              paginator
              :rows="recordPageSize"
              :rows-per-page-options="[10, 20, 50]"
              scrollable
              scroll-height="flex"
            >
              <template #empty>
                <div class="context-empty context-empty--table">
                  {{ selectedRecordType ? "No records match this search." : "Select a record type to browse records." }}
                </div>
              </template>
              <Column field="label" header="Record" sortable>
                <template #body="{ data }">
                  <div class="context-primary-cell">
                    <strong>{{ data.label }}</strong>
                    <small>#{{ data.id }}</small>
                  </div>
                </template>
              </Column>
              <Column field="meta" header="Details">
                <template #body="{ data }">
                  <span class="context-muted-cell">{{ data.meta || selectedRecordType?.id }}</span>
                </template>
              </Column>
              <Column header="" class="context-action-column">
                <template #body="{ data }">
                  <button
                    type="button"
                    class="context-add-btn"
                    :class="{ attached: isRecordAttached(data) }"
                    :disabled="isRecordAttached(data)"
                    :title="isRecordAttached(data) ? 'Queued for send' : 'Queue record for send'"
                    @click.stop="attachRecordContext(data)"
                  >
                    <i :class="recordActionIcon(data)" />
                  </button>
                </template>
              </Column>
            </DataTable>
            <div v-if="recordsLoading" class="context-table-overlay">
              <MLoader />
            </div>
          </div>
        </section>

        <section v-else class="context-panel context-panel--fc">
          <div class="context-fc-host">
            <FileCabinetPane
              :bookmarkedIds="bookmarkedIds"
              :currentEnvironment="harness.environment.value"
              :contextPicker="true"
              :attachedFileIds="cabinetAttachedFileIds"
              @add-to-context="handleCabinetPaneAdd"
            />
          </div>
        </section>
          </div>
        </div>
      </div>
    </Teleport>

    <Dialog
      v-model:visible="skillDialogVisible"
      modal
      :header="skillEditingId === null ? 'Add Skill' : 'Edit Skill'"
      :style="{ width: 'min(720px, 94vw)' }"
    >
      <div class="skill-editor">
        <div class="agent-tabs">
          <button type="button" :class="{ active: skillEditorMode === 'manual' }" @click="skillEditorMode = 'manual'">
            Manual
          </button>
          <button type="button" :class="{ active: skillEditorMode === 'generate' }" @click="skillEditorMode = 'generate'">
            Generate with AI
          </button>
        </div>

        <section v-if="skillEditorMode === 'generate'" class="agent-generate-panel">
          <Textarea
            v-model="skillGeneratePrompt"
            class="agent-textarea"
            rows="4"
            placeholder="Describe the skill you want: NetSuite domain, common mistakes, APIs, searches, examples, and when the agent should use it."
          />
          <div class="agent-generate-actions">
            <span v-if="skillGenerateProgress" class="generate-progress">{{ skillGenerateProgress }}</span>
            <span v-else-if="skillGenerateError" class="generate-error">{{ skillGenerateError }}</span>
            <button type="button" class="agent-primary-btn" :disabled="skillGenerating" @click="generateSkillWithAi">
              <i :class="skillGenerating ? 'pi pi-spin pi-spinner' : 'pi pi-sparkles'" />
              <span>{{ skillGenerating ? "Generating" : "Generate" }}</span>
            </button>
          </div>
        </section>

        <div class="skill-editor-form">
          <label>
            <span>Name</span>
            <InputText v-model="skillForm.name" class="agent-input" />
          </label>
          <label>
            <span>Description</span>
            <InputText v-model="skillForm.description" class="agent-input" />
          </label>
          <label>
            <span>Tags</span>
            <InputText v-model="skillForm.tags" class="agent-input" placeholder="suiteql, records, scripts" />
          </label>
          <label>
            <span>Domain</span>
            <div class="skill-domain-toggle">
              <button type="button" :class="{ active: skillForm.domain === 'global' }" @click="skillForm.domain = 'global'">Global</button>
              <button type="button" :class="{ active: skillForm.domain === 'sql' }" @click="skillForm.domain = 'sql'">SQL</button>
            </div>
          </label>
          <label>
            <span>Content</span>
            <Textarea v-model="skillForm.content" class="agent-textarea skill-content-textarea" rows="12" auto-resize />
          </label>
        </div>
      </div>
      <template #footer>
        <button type="button" class="agent-secondary-btn" @click="skillDialogVisible = false">Cancel</button>
        <button type="button" class="agent-primary-btn" @click="saveSkillForm">
          <i class="pi pi-check" />
          <span>Save Skill</span>
        </button>
      </template>
    </Dialog>

    <Dialog
      v-model:visible="skillDeleteDialogVisible"
      modal
      header="Delete Skill"
      :style="{ width: 'min(420px, 92vw)' }"
    >
      <p class="delete-message">
        Delete <strong>{{ skillDeleteTarget?.name }}</strong>? This cannot be undone.
      </p>
      <template #footer>
        <button type="button" class="agent-secondary-btn" @click="skillDeleteDialogVisible = false">Cancel</button>
        <button type="button" class="agent-danger-btn" @click="executeDeleteSkill">Delete</button>
      </template>
    </Dialog>

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
import { useRoute, useRouter } from "vue-router";
import Dialog from "primevue/dialog";
import ColorPicker from "primevue/colorpicker";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Textarea from "primevue/textarea";
import { callApi, ApiRequestType, type ApiResponse } from "../utils/api";
import { RequestRoutes } from "../types/request";
import MCard from "../components/universal/card/MCard.vue";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import FileCabinetPane from "../components/FileCabinetPane.vue";
import MLoader from "../components/universal/patterns/MLoader.vue";
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
import {
  addSkill,
  deleteSkill,
  exportAllSkills,
  getAllSkills,
  importSkills,
  updateSkill,
  type Skill,
  type SkillExport,
} from "../utils/skillsDb";

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

type HarnessSection = "chat" | "agents" | "skills";
type ContextPickerTab = "records" | "files";

interface RecordTypeOption {
  id: string;
  name: string;
}

interface RecordListRow {
  id: string;
  label: string;
  meta: string;
  raw: Record<string, unknown>;
}

interface CabinetFolderRow {
  id: number;
  name: string;
}

interface CabinetFileRow {
  id: number;
  name: string;
  filetype: string;
  filesize: number;
  folder?: number;
  url?: string;
}

type CabinetContextRow =
  | (CabinetFolderRow & { key: string; kind: "folder"; filetype: ""; filesize: 0; folder?: number; url?: undefined })
  | (CabinetFileRow & { key: string; kind: "file" });

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
const route = useRoute();
const router = useRouter();

const prompt = ref("");
const streamRef = ref<HTMLDivElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const pendingAttachments = ref<HarnessAttachment[]>([]);
const isProcessingFiles = ref(false);
const isDragOver = ref(false);
const shouldStickToBottom = ref(true);
let lastStreamScrollHeight = 0;
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
const agentManagerSearch = ref("");

const contextPickerVisible = ref(false);
const contextPickerTab = ref<ContextPickerTab>("records");
const recordTypes = ref<RecordTypeOption[]>([]);
const recordTypesLoading = ref(false);
const selectedRecordTypeId = ref<string | null>(null);
const selectedRecordType = computed(() =>
  recordTypes.value.find((type) => type.id === selectedRecordTypeId.value) ?? null
);
const recordSearch = ref("");
const recordRows = ref<RecordListRow[]>([]);
const recordPageSize = 10;
const recordFetchLimit = 500;
const recordsLoading = ref(false);
const recordListError = ref("");
const bookmarkedIds = ref<Set<number>>(new Set());
const cabinetAttachedFileIds = computed<Set<number>>(() =>
  new Set(
    pendingAttachments.value
      .filter((a) => a.source === "filecabinet")
      .map((a) => Number(a.sourceId))
      .filter((id) => !Number.isNaN(id))
  )
);

const cabinetFolderId = ref<number | null>(null);
const cabinetBreadcrumbs = ref<CabinetFolderRow[]>([]);
const cabinetFolders = ref<CabinetFolderRow[]>([]);
const cabinetFiles = ref<CabinetFileRow[]>([]);
const cabinetSearch = ref("");
const cabinetLoading = ref(false);
const cabinetError = ref("");

const skills = ref<Skill[]>([]);
const skillSearch = ref("");
const skillDialogVisible = ref(false);
const skillEditorMode = ref<"manual" | "generate">("manual");
const skillGeneratePrompt = ref("");
const skillGenerateProgress = ref("");
const skillGenerateError = ref("");
const skillGenerating = ref(false);
const skillDeleteDialogVisible = ref(false);
const skillEditingId = ref<number | null>(null);
const skillDeleteTarget = ref<Skill | null>(null);
const skillFileInputRef = ref<HTMLInputElement | null>(null);
const skillForm = ref<{
  name: string;
  description: string;
  tags: string;
  content: string;
  domain: "global" | "sql";
}>({
  name: "",
  description: "",
  tags: "",
  content: "",
  domain: "global",
});

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

const SUPPORTED_CABINET_FILE_TYPES = new Set([
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
  "CONFIG",
  "PDF",
]);

const TRANSACTION_RECORD_TYPES: Record<string, string> = {
  cashsale: "CashSale",
  creditmemo: "CustCred",
  customerdeposit: "CustDep",
  customerpayment: "CustPymt",
  estimate: "Estimate",
  invoice: "CustInvc",
  itemfulfillment: "ItemShip",
  journalentry: "Journal",
  opportunity: "Opprtnty",
  purchaseorder: "PurchOrd",
  returnauthorization: "RtnAuth",
  salesorder: "SalesOrd",
  vendorbill: "VendBill",
  vendorcredit: "VendCred",
};

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

const harnessNavItems: Array<{
  id: HarnessSection;
  label: string;
  icon: string;
  route: string;
}> = [
  { id: "chat", label: "Harness", icon: "pi pi-comments", route: "/netsuite-agent-harness" },
  { id: "agents", label: "Agents", icon: "pi pi-users", route: "/netsuite-agent-harness/agents" },
  { id: "skills", label: "Skills", icon: "pi pi-book", route: "/netsuite-agent-harness/skills" },
];

const shellStyle = computed(() => ({
  height: "100%",
  overflow: "hidden",
}));

const canSubmit = computed(
  () => prompt.value.trim().length > 0 || pendingAttachments.value.length > 0
);

const activeHarnessSection = computed<HarnessSection>(() => {
  if (route.path.endsWith("/agents")) return "agents";
  if (route.path.endsWith("/skills")) return "skills";
  return "chat";
});

const filteredHarnessAgents = computed(() => {
  const q = agentManagerSearch.value.trim().toLowerCase();
  const list = [...harness.agents.value];
  if (!q) return list;
  return list.filter((agent) =>
    `${agent.name} ${agent.shortName} ${agent.description} ${agent.systemFocus}`
      .toLowerCase()
      .includes(q)
  );
});

const filteredHarnessSkills = computed(() => {
  const q = skillSearch.value.trim().toLowerCase();
  if (!q) return skills.value;
  const terms = q.split(/\s+/);
  return skills.value.filter((skill) => {
    const haystack = `${skill.name} ${skill.description} ${skill.tags} ${skill.content}`
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
});

const filteredRecordRows = computed(() => {
  const q = recordSearch.value.trim().toLowerCase();
  if (!q) return recordRows.value;
  return recordRows.value.filter((row) =>
    `${row.id} ${row.label} ${row.meta} ${JSON.stringify(row.raw)}`
      .toLowerCase()
      .includes(q)
  );
});

const selectedCabinetFiles = computed(() =>
  cabinetFiles.value.filter((file) => isSupportedCabinetFile(file))
);

const cabinetRows = computed<CabinetContextRow[]>(() => [
  ...cabinetFolders.value.map((folder) => ({
    ...folder,
    key: `folder:${folder.id}`,
    kind: "folder" as const,
    filetype: "" as const,
    filesize: 0 as const,
  })),
  ...selectedCabinetFiles.value.map((file) => ({
    ...file,
    key: `file:${file.id}`,
    kind: "file" as const,
  })),
]);

const filteredCabinetRows = computed(() => {
  const q = cabinetSearch.value.trim().toLowerCase();
  if (!q) return cabinetRows.value;
  return cabinetRows.value.filter((row) =>
    `${row.id} ${row.name} ${row.kind} ${row.filetype} ${row.folder ?? ""}`
      .toLowerCase()
      .includes(q)
  );
});

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

const setHarnessSection = (section: HarnessSection) => {
  const target = harnessNavItems.find((item) => item.id === section);
  if (target && route.path !== target.route) {
    void router.push(target.route);
  }
};

const toggleHarnessAgentEnabled = async (agent: Readonly<HarnessAgent>) => {
  await harness.saveAgent({
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
    enabled: agent.enabled === false,
    builtIn: agent.builtIn,
  });
};

const refreshSkills = async () => {
  skills.value = await getAllSkills();
};

const openCreateSkillDialog = () => {
  skillEditingId.value = null;
  skillEditorMode.value = "manual";
  skillGeneratePrompt.value = "";
  skillGenerateProgress.value = "";
  skillGenerateError.value = "";
  skillForm.value = {
    name: "",
    description: "",
    tags: "",
    content: "",
    domain: "global",
  };
  skillDialogVisible.value = true;
};

const openEditSkillDialog = (skill: Skill) => {
  skillEditingId.value = skill.id ?? null;
  skillEditorMode.value = "manual";
  skillGeneratePrompt.value = "";
  skillGenerateProgress.value = "";
  skillGenerateError.value = "";
  skillForm.value = {
    name: skill.name,
    description: skill.description,
    tags: skill.tags,
    content: skill.content,
    domain: skill.domain ?? "global",
  };
  skillDialogVisible.value = true;
};

const saveSkillForm = async () => {
  const payload = {
    name: skillForm.value.name.trim(),
    description: skillForm.value.description.trim(),
    tags: skillForm.value.tags.trim(),
    content: skillForm.value.content.trim(),
    domain: skillForm.value.domain,
  };
  if (!payload.name || !payload.content) return;

  if (skillEditingId.value !== null) {
    await updateSkill(skillEditingId.value, payload);
  } else {
    await addSkill({ ...payload, enabled: true });
  }
  skillDialogVisible.value = false;
  await refreshSkills();
};

const toggleSkillEnabled = async (skill: Skill) => {
  if (skill.id === undefined) return;
  await updateSkill(skill.id, { enabled: skill.enabled === false });
  await refreshSkills();
};

const confirmDeleteSkill = (skill: Skill) => {
  skillDeleteTarget.value = skill;
  skillDeleteDialogVisible.value = true;
};

const executeDeleteSkill = async () => {
  if (skillDeleteTarget.value?.id === undefined) return;
  await deleteSkill(skillDeleteTarget.value.id);
  skillDeleteDialogVisible.value = false;
  skillDeleteTarget.value = null;
  await refreshSkills();
};

const triggerSkillImport = () => {
  skillFileInputRef.value?.click();
};

const importSkillFiles = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  if (!files?.length) return;

  for (const file of Array.from(files)) {
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(text);
        const items: SkillExport[] = Array.isArray(parsed) ? parsed : [parsed];
        await importSkills(
          items
            .filter((item) => typeof item.name === "string" && typeof item.content === "string")
            .map((item) => ({
              name: item.name,
              description: item.description || "",
              tags: item.tags || "",
              content: item.content,
              domain: item.domain ?? "global",
            }))
        );
      } else {
        await addSkill({
          name: file.name.replace(/\.(md|txt)$/i, ""),
          description: `Imported from ${file.name}`,
          tags: "",
          content: text,
          enabled: true,
        });
      }
    } catch (err) {
      console.error("[Harness] Skill import failed", err);
    }
  }

  input.value = "";
  await refreshSkills();
};

const exportSkills = async () => {
  const data = await exportAllSkills();
  if (data.length === 0) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `skills-export-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const parseSkillTags = (tags: string): string[] =>
  tags.split(/[,\s]+/).map((tag) => tag.trim()).filter(Boolean);

const formatSkillDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const formatSkillSize = (chars: number): string =>
  chars < 1000 ? `${chars} chars` : `${(chars / 1000).toFixed(1)}K chars`;

const clearContextPicker = () => {
  recordRows.value = [];
  recordListError.value = "";
  selectedRecordTypeId.value = null;
  recordSearch.value = "";
};

const closeContextPicker = () => {
  contextPickerVisible.value = false;
  clearContextPicker();
};

const isContextSelectOpen = (): boolean =>
  Boolean(
    document.querySelector(
      ".context-select.p-select-open, .context-select [aria-expanded='true']"
    )
  );

const onContextPickerKeydown = (event: KeyboardEvent) => {
  if (event.key !== "Escape") return;
  if (isContextSelectOpen()) return;
  event.preventDefault();
  closeContextPicker();
};

const openContextPicker = (tab: ContextPickerTab = "records") => {
  contextPickerTab.value = tab;
  contextPickerVisible.value = true;
  if (tab === "records") void loadRecordTypes();
};

const escapeSuiteQLString = (value: string): string =>
  value.replace(/'/g, "''");

const normalizeApiRows = (response: ApiResponse): Record<string, unknown>[] => {
  const message = response?.message;
  if (Array.isArray(message)) return message as Record<string, unknown>[];
  if (Array.isArray(message?.results)) return message.results as Record<string, unknown>[];
  return normalizeRows(message);
};

const normalizeRows = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["results", "items", "files", "folders", "subfolders", "records", "rows"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested as Record<string, unknown>[];
    if (nested && typeof nested === "object") {
      const nestedRows = normalizeRows(nested);
      if (nestedRows.length) return nestedRows;
    }
  }
  return [];
};

const runSuiteQLRows = async (
  sql: string,
  limit = 100
): Promise<Record<string, unknown>[]> => {
  const response = await callApi(
    RequestRoutes.RUN_SUITEQL_QUERY,
    { sql, limit },
    ApiRequestType.NORMAL
  );
  return normalizeApiRows(response);
};

const SCRIPT_RECORD_TYPE: RecordTypeOption = { id: "script", name: "Script" };

const normalizeRecordTypeRow = (row: Record<string, unknown>): RecordTypeOption | null => {
  const rawId = String(row.id ?? row.ID ?? row.scriptId ?? "").trim();
  const rawName = String(row.name ?? row.Name ?? rawId).trim();
  if (!rawId || !rawName) return null;
  return {
    id: rawId.toLowerCase(),
    name: rawName,
  };
};

const mergeRecordTypes = (rows: RecordTypeOption[]): RecordTypeOption[] => {
  const byId = new Map<string, RecordTypeOption>();
  for (const row of rows) {
    if (row.id && row.name) byId.set(row.id, row);
  }
  if (!byId.has(SCRIPT_RECORD_TYPE.id)) {
    byId.set(SCRIPT_RECORD_TYPE.id, SCRIPT_RECORD_TYPE);
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
};

const loadRecordTypes = async () => {
  recordTypesLoading.value = true;
  recordListError.value = "";
  try {
    const response = await callApi(RequestRoutes.GET_ALL_RECORD_TYPES);
    const rows = Array.isArray(response.message) ? response.message : [];
    const normalized = rows
      .map((row) => normalizeRecordTypeRow(row as Record<string, unknown>))
      .filter((row): row is RecordTypeOption => row !== null);
    recordTypes.value = mergeRecordTypes(normalized);
  } catch (err) {
    recordListError.value = err instanceof Error ? err.message : String(err);
    recordTypes.value = mergeRecordTypes([]);
  } finally {
    recordTypesLoading.value = false;
  }
};

const isNumericSearch = (value: string): boolean => /^\d+$/.test(value.trim());

const recordSearchClause = (fields: string[]): string => {
  const search = recordSearch.value.trim();
  if (!search) return "";
  const pieces: string[] = [];
  if (isNumericSearch(search)) pieces.push(`id = ${Number(search)}`);
  for (const field of fields) {
    pieces.push(`LOWER(${field}) LIKE LOWER('%${escapeSuiteQLString(search)}%')`);
  }
  return pieces.length ? ` AND (${pieces.join(" OR ")})` : "";
};

const mapRecordRows = (rows: Record<string, unknown>[]): RecordListRow[] =>
  rows.map((row) => {
    const id = String(row.id ?? row.ID ?? "");
    const label =
      String(row.name ?? row.entityid ?? row.altname ?? row.tranid ?? row.scriptid ?? row.displayname ?? "")
        .trim() || `#${id}`;
    const meta = Object.entries(row)
      .filter(([key, value]) => key.toLowerCase() !== "id" && value !== null && value !== undefined && value !== "")
      .slice(0, 3)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(" | ");
    return { id, label, meta, raw: row };
  }).filter((row) => row.id);

const buildRecordQueries = (recordType: string): string[] => {
  const transactionCode = TRANSACTION_RECORD_TYPES[recordType];
  if (transactionCode) {
    return [
      `SELECT id, tranid, BUILTIN.DF(entity) AS entity, trandate FROM transaction WHERE type = '${transactionCode}'${recordSearchClause(["tranid"])} ORDER BY id DESC`,
    ];
  }

  const table = recordType.replace(/[^a-z0-9_]/gi, "");
  return [
    `SELECT id, name FROM ${table} WHERE 1 = 1${recordSearchClause(["name"])} ORDER BY id DESC`,
    `SELECT id, entityid, altname FROM ${table} WHERE 1 = 1${recordSearchClause(["entityid", "altname"])} ORDER BY id DESC`,
    `SELECT id, scriptid, name FROM ${table} WHERE 1 = 1${recordSearchClause(["scriptid", "name"])} ORDER BY id DESC`,
    `SELECT id FROM ${table} ORDER BY id DESC`,
  ].map((query) => query.replace(/\s+/g, " ").trim());
};

const loadRecordPage = async (_page = 1) => {
  if (!selectedRecordType.value) return;
  recordsLoading.value = true;
  recordListError.value = "";

  try {
    let rows: Record<string, unknown>[] = [];
    let lastError = "";
    for (const sql of buildRecordQueries(selectedRecordType.value.id)) {
      try {
        rows = await runSuiteQLRows(sql, recordFetchLimit);
        if (rows.length > 0 || sql.includes("SELECT id FROM")) break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    if (rows.length === 0 && lastError) recordListError.value = lastError;
    recordRows.value = mapRecordRows(rows);
  } catch (err) {
    recordListError.value = err instanceof Error ? err.message : String(err);
    recordRows.value = [];
  } finally {
    recordsLoading.value = false;
  }
};

const selectRecordType = async () => {
  recordRows.value = [];
  if (selectedRecordType.value) await loadRecordPage(1);
};

const isRecordAttached = (row: RecordListRow): boolean => {
  const typeId = selectedRecordType.value?.id;
  if (!typeId) return false;
  return pendingAttachments.value.some(
    (attachment) =>
      attachment.source === "record" &&
      attachment.sourceId === row.id &&
      attachment.sourceType === typeId
  );
};

const recordActionIcon = (row: RecordListRow): string =>
  isRecordAttached(row) ? "pi pi-check" : "pi pi-plus";

const attachRecordContext = (row: RecordListRow) => {
  if (!selectedRecordType.value || isRecordAttached(row)) return;
  const recordType = selectedRecordType.value;
  pendingAttachments.value.push({
    name: `${recordType.name}: ${row.label} (#${row.id})`,
    type: "text",
    content: "",
    size: 0,
    deferred: true,
    source: "record",
    sourceId: row.id,
    sourceType: recordType.id,
  });
};

const isSupportedCabinetFile = (file: CabinetFileRow): boolean =>
  SUPPORTED_CABINET_FILE_TYPES.has(String(file.filetype ?? "").toUpperCase());

const cabinetSupportedTypeSql = (): string =>
  [...SUPPORTED_CABINET_FILE_TYPES]
    .map((type) => `'${escapeSuiteQLString(type)}'`)
    .join(", ");

const mapCabinetFolders = (rows: Record<string, unknown>[]): CabinetFolderRow[] =>
  rows
    .map((row) => ({
      id: Number(row.id ?? row.ID),
      name: String(row.name ?? row.Name ?? row.id ?? ""),
    }))
    .filter((row) => Number.isFinite(row.id) && row.name);

const mapCabinetFiles = (
  rows: Record<string, unknown>[],
  fallbackFolder?: number
): CabinetFileRow[] =>
  rows
    .map((row) => ({
      id: Number(row.id ?? row.ID),
      name: String(row.name ?? row.Name ?? row.id ?? ""),
      filetype: String(row.filetype ?? row.fileType ?? row.FILETYPE ?? "").toUpperCase(),
      filesize: Number(row.filesize ?? row.fileSize ?? row.FILESIZE ?? 0),
      folder: row.folder !== undefined && row.folder !== null
        ? Number(row.folder)
        : fallbackFolder,
      url: row.url ? String(row.url) : undefined,
    }))
    .filter((row) => Number.isFinite(row.id) && row.name);

const loadCabinetBreadcrumbs = async (folderId: number | null) => {
  if (folderId === null) {
    cabinetBreadcrumbs.value = [];
    return;
  }
  const crumbs: CabinetFolderRow[] = [];
  let current: number | null = folderId;
  for (let i = 0; i < 20 && current !== null; i++) {
    const rows = await runSuiteQLRows(
      `SELECT id, name, parent FROM MediaItemFolder WHERE id = ${current} AND ROWNUM <= 1`,
      1
    );
    const row = rows[0];
    if (!row) break;
    crumbs.unshift({ id: Number(row.id), name: String(row.name ?? row.id) });
    current = row.parent === null || row.parent === undefined ? null : Number(row.parent);
  }
  cabinetBreadcrumbs.value = crumbs;
};

const loadCabinetFolder = async (folderId: number | null) => {
  cabinetLoading.value = true;
  cabinetError.value = "";
  cabinetSearch.value = "";
  cabinetFolderId.value = folderId;
  try {
    if (folderId === null) {
      const rows = await runSuiteQLRows(
        "SELECT id, name FROM MediaItemFolder WHERE parent IS NULL ORDER BY name",
        200
      );
      cabinetFolders.value = mapCabinetFolders(rows);
      cabinetFiles.value = [];
      cabinetBreadcrumbs.value = [];
    } else {
      const [folderRows, fileRows] = await Promise.all([
        runSuiteQLRows(
          `SELECT id, name FROM MediaItemFolder WHERE parent = ${folderId} ORDER BY name`,
          500
        ),
        runSuiteQLRows(
          `SELECT id, name, folder, filesize, filetype, url FROM File WHERE folder = ${folderId} AND filetype IN (${cabinetSupportedTypeSql()}) ORDER BY name`,
          500
        ),
      ]);
      cabinetFolders.value = mapCabinetFolders(folderRows);
      cabinetFiles.value = mapCabinetFiles(fileRows, folderId);
      await loadCabinetBreadcrumbs(folderId);
    }
  } catch (err) {
    cabinetError.value = err instanceof Error ? err.message : String(err);
  } finally {
    cabinetLoading.value = false;
  }
};

const searchCabinetFiles = async () => {
  const query = cabinetSearch.value.trim();
  if (!query) {
    await loadCabinetFolder(cabinetFolderId.value);
    return;
  }
  cabinetLoading.value = true;
  cabinetError.value = "";
  try {
    const searchClause = isNumericSearch(query)
      ? `(id = ${Number(query)} OR LOWER(name) LIKE LOWER('%${escapeSuiteQLString(query)}%'))`
      : `LOWER(name) LIKE LOWER('%${escapeSuiteQLString(query)}%')`;
    const [folderRows, fileRows] = await Promise.all([
      runSuiteQLRows(
        `SELECT id, name, parent FROM MediaItemFolder WHERE ${searchClause} ORDER BY name`,
        100
      ),
      runSuiteQLRows(
        `SELECT id, name, folder, filesize, filetype, url FROM File WHERE ${searchClause} AND filetype IN (${cabinetSupportedTypeSql()}) ORDER BY name`,
        250
      ),
    ]);
    cabinetFolders.value = mapCabinetFolders(folderRows);
    cabinetFiles.value = mapCabinetFiles(fileRows);
    cabinetBreadcrumbs.value = [];
    cabinetFolderId.value = null;
  } catch (err) {
    cabinetError.value = err instanceof Error ? err.message : String(err);
  } finally {
    cabinetLoading.value = false;
  }
};

const dataUrlToFile = (dataUrl: string, name: string): File => {
  const [header = "", body = ""] = dataUrl.split(",", 2);
  const contentType = /^data:([^;]+);/i.exec(header)?.[1] || "application/octet-stream";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: contentType });
};

const isCabinetFileAttached = (file: CabinetFileRow): boolean =>
  pendingAttachments.value.some(
    (attachment) =>
      attachment.source === "filecabinet" &&
      attachment.sourceId === String(file.id)
  );

const handleCabinetPaneAdd = (item: { id: number; name: string; filetype: string }) => {
  if (isCabinetFileAttached({ id: item.id } as CabinetFileRow)) return;
  pendingAttachments.value.push({
    name: `${item.name} (#${item.id})`,
    type: "text",
    content: "",
    size: 0,
    deferred: true,
    source: "filecabinet",
    sourceId: String(item.id),
    sourceType: item.filetype,
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

const generateSkillWithAi = async () => {
  const request = skillGeneratePrompt.value.trim();
  if (!request || skillGenerating.value) return;

  skillGenerating.value = true;
  skillGenerateError.value = "";
  skillGenerateProgress.value = "";

  try {
    const existingSkills = skills.value
      .slice(0, 20)
      .map((skill) => `- ${skill.name}: ${skill.description} [${skill.tags}]`)
      .join("\n");
    const toolsetList = harness.toolsets
      .map((toolset) => `${toolset.id}: ${toolset.name} - ${toolset.description}`)
      .join("\n");

    const systemPrompt = `You generate reusable NetSuite skills for the Magic NetSuite Agent Harness.
Return one raw JSON object only. Do not wrap it in markdown.

Before generating, search and read NetSuite documentation for the requested domain whenever it involves SuiteScript, SuiteQL, records, scripts, File Cabinet, deployments, bundles, PDFs, permissions, governance, or NetSuite behavior. Use the documentation to make the skill specific and operational, not generic.

Available harness toolsets for context:
${toolsetList}

Existing skills, to avoid duplicates:
${existingSkills || "- None"}

JSON schema:
{
  "name": "2-6 word skill name",
  "description": "One practical sentence explaining when to use it",
  "tags": "comma-separated tags",
  "domain": "global" | "sql",
  "content": "A comprehensive markdown skill with triggers, rules, workflow, evidence requirements, examples, pitfalls, and NetSuite-specific guidance"
}

Rules:
- The content must be directly useful to an AI agent during work.
- Include sections for When to use, Workflow, NetSuite checks, Common pitfalls, and Output expectations.
- Include concrete SuiteScript/SuiteQL/API names when documentation supports them.
- Prefer domain "sql" only for SuiteQL-heavy skills; otherwise use "global".
- Do not invent unsupported API behavior. If docs are unclear, say what to verify.`;

    const generator = useAgent({
      chatCompletion,
      systemPrompt,
      tools: netsuiteDocsTools,
      keepHistory: false,
      onToolStart: (name, input) => {
        const inputRecord = input as Record<string, unknown>;
        if (name === "search_netsuite_docs") {
          skillGenerateProgress.value = `Searching docs: ${String(inputRecord.query ?? "")}`;
        } else if (name === "read_netsuite_doc_page") {
          skillGenerateProgress.value = "Reading NetSuite docs";
        } else {
          skillGenerateProgress.value = `Using ${name}`;
        }
      },
      onToolResult: () => {
        skillGenerateProgress.value = "Writing skill";
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
    const parsed = JSON.parse(raw) as Partial<{
      name: string;
      description: string;
      tags: string;
      domain: "global" | "sql";
      content: string;
    }>;

    skillForm.value = {
      name: String(parsed.name || skillForm.value.name || "Generated NetSuite Skill"),
      description: String(parsed.description || skillForm.value.description || "Generated NetSuite operating guidance."),
      tags: String(parsed.tags || skillForm.value.tags || "netsuite"),
      domain: parsed.domain === "sql" ? "sql" : "global",
      content: String(parsed.content || skillForm.value.content || ""),
    };
    skillEditorMode.value = "manual";
  } catch (err) {
    skillGenerateError.value = `Generation failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    skillGenerating.value = false;
    skillGenerateProgress.value = "";
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
  shouldStickToBottom.value = true;
  await scrollToBottomAndSettle();
  await harness.runTurn(text, { attachments });
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
  shouldStickToBottom.value = true;
  await scrollToBottomAndSettle();
  await harness.rerunFromItem(item.id, text, { attachments });
};

const isStreamNearBottom = (threshold = 120): boolean => {
  const el = streamRef.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
};

const onStreamScroll = () => {
  shouldStickToBottom.value = isStreamNearBottom();
  lastStreamScrollHeight = streamRef.value?.scrollHeight ?? 0;
};

const scrollToBottom = async () => {
  await nextTick();
  if (streamRef.value) {
    streamRef.value.scrollTop = streamRef.value.scrollHeight;
    shouldStickToBottom.value = true;
    lastStreamScrollHeight = streamRef.value.scrollHeight;
  }
};

/** Scroll to bottom and wait until the browser has applied it (before heavy work). */
const scrollToBottomAndSettle = (): Promise<void> =>
  new Promise((resolve) => {
    shouldStickToBottom.value = true;
    void nextTick().then(() => {
      const el = streamRef.value;
      if (!el) {
        resolve();
        return;
      }

      const applyScroll = () => {
        el.scrollTop = el.scrollHeight;
        lastStreamScrollHeight = el.scrollHeight;
      };

      applyScroll();
      requestAnimationFrame(() => {
        applyScroll();
        requestAnimationFrame(() => {
          applyScroll();
          let frames = 0;
          const waitForSettle = () => {
            applyScroll();
            const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
            const atBottom = Math.abs(el.scrollTop - maxScroll) <= 3;
            frames += 1;
            if (atBottom || frames >= 10) {
              resolve();
              return;
            }
            requestAnimationFrame(waitForSettle);
          };
          requestAnimationFrame(waitForSettle);
        });
      });
    });
  });

const syncStreamScrollAfterRender = async (
  options: { target?: EventTarget | null } = {}
) => {
  const el = streamRef.value;
  if (!el) return;
  if (!shouldStickToBottom.value && !options.target) return;

  const previousHeight = lastStreamScrollHeight || el.scrollHeight;
  const previousTop = el.scrollTop;
  await nextTick();
  if (!streamRef.value) return;

  if (shouldStickToBottom.value) {
    if (isStreamNearBottom(200)) {
      streamRef.value.scrollTop = streamRef.value.scrollHeight;
    }
    lastStreamScrollHeight = streamRef.value.scrollHeight;
    return;
  }

  if (!(options.target instanceof Element)) {
    lastStreamScrollHeight = streamRef.value.scrollHeight;
    return;
  }

  const streamRect = streamRef.value.getBoundingClientRect();
  const targetRect = options.target.getBoundingClientRect();
  const heightDelta = streamRef.value.scrollHeight - previousHeight;
  if (heightDelta > 0 && targetRect.bottom < streamRect.top) {
    streamRef.value.scrollTop = previousTop + heightDelta;
  }
  lastStreamScrollHeight = streamRef.value.scrollHeight;
};

const handleDynamicContentLoad = (event: Event) => {
  if (!shouldStickToBottom.value) {
    void syncStreamScrollAfterRender({ target: event.target });
    return;
  }
  void syncStreamScrollAfterRender();
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

const attachmentIcon = (attachment: HarnessAttachment): string => {
  if (attachment.source === "record") return "pi pi-table";
  if (attachment.source === "filecabinet") return "pi pi-folder";
  if (attachment.type === "pdf") return "pi pi-file-pdf";
  return "pi pi-file";
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
    if (harness.contextResolving.value) return;
    void syncStreamScrollAfterRender();
  }
);

watch(contextPickerVisible, (visible) => {
  if (visible) {
    document.addEventListener("keydown", onContextPickerKeydown);
    document.body.style.overflow = "hidden";
    if (contextPickerTab.value === "records") void loadRecordTypes();
  } else {
    document.removeEventListener("keydown", onContextPickerKeydown);
    document.body.style.overflow = "";
  }
});

watch(
  () => harness.activeThread.value?.threadId,
  () => {
    for (const url of artifactPreviewUrls.values()) {
      URL.revokeObjectURL(url);
    }
    artifactPreviewUrls.clear();
  }
);

onMounted(async () => {
  await harness.initialize();
  await refreshSkills();
  await scrollToBottom();
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onContextPickerKeydown);
  document.body.style.overflow = "";
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
  background: var(--p-slate-100);
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

.harness-section-nav {
  display: grid;
  gap: 5px;
  margin-top: 7px;
}

.harness-section-btn {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 0 10px 0 12px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--p-slate-600);
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  text-align: left;
}

.harness-section-btn i {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
}

.harness-section-btn:hover,
.harness-section-btn.active {
  border-color: var(--harness-accent-border);
  background: white;
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--p-slate-200);
  border-radius: 7px;
  background: var(--p-slate-100);
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

.harness-dashboard-main {
  overflow: hidden;
}

.dashboard-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--p-slate-200);
  background: #ffffff;
}

.dashboard-toolbar p {
  margin: 3px 0 0;
  color: var(--p-slate-500);
  font-size: 0.78rem;
}

.dashboard-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  min-width: 0;
  flex-wrap: wrap;
}

.dashboard-search {
  width: min(260px, 34vw);
}

.dashboard-grid,
.dashboard-list {
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}

.dashboard-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.manager-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  background: #ffffff;
  padding: 11px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.manager-card.muted {
  opacity: 0.58;
}

.manager-card-header {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
}

.manager-agent-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  color: white;
  font-size: 0.85rem;
}

.manager-agent-mark--skill {
  background: var(--p-slate-700);
}

.manager-card-title {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.manager-card-title strong,
.manager-card-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manager-card-title strong {
  color: var(--p-slate-800);
  font-size: 0.85rem;
}

.manager-card-title span {
  color: var(--p-slate-500);
  font-size: 0.72rem;
}

.manager-card-meta,
.manager-chip-row,
.manager-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.manager-card-meta {
  color: var(--p-slate-500);
  font-size: 0.7rem;
  font-weight: 650;
}

.manager-card-meta span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.manager-chip {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--p-slate-200);
  border-radius: 999px;
  background: #f8fafc;
  color: var(--p-slate-600);
  padding: 2px 7px;
  font-size: 0.65rem;
  font-weight: 700;
}

.manager-chip--strong {
  border-color: var(--harness-accent-border);
  background: var(--harness-accent-soft);
  color: var(--harness-accent-strong);
}

.skill-manager-card {
  gap: 8px;
}

.dashboard-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 160px;
  color: var(--p-slate-400);
  font-size: 0.82rem;
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
  background: var(--p-slate-100);
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
  background: var(--p-slate-100);
  flex-shrink: 0;
}

.attachment-pending {
  color: var(--harness-accent-strong);
  font-style: italic;
}

.composer-row {
  display: grid;
  grid-template-columns: 36px 36px minmax(0, 1fr) 36px;
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
  background: var(--p-slate-50);
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
  background: var(--p-slate-100);
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

.context-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(15, 23, 42, 0.45);
}

.context-modal {
  display: flex;
  flex-direction: column;
  width: min(920px, 96vw);
  height: 75vh;
  max-height: 75vh;
  overflow: hidden;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.22);
}

.context-modal-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--p-slate-200);
  background: #f8fafc;
}

.context-modal-header h2 {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 800;
  color: var(--p-slate-800);
}

.context-modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  background: #fff;
  color: var(--p-slate-500);
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}

.context-modal-close:hover {
  border-color: #c4b5fd;
  background: var(--harness-accent-soft);
  color: var(--harness-accent-strong);
}

.context-modal-body {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px 16px;
  overflow: hidden;
}

.context-panel,
.skill-editor,
.skill-editor-form {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.skill-editor {
  gap: 10px;
}

.context-tabs {
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-self: flex-start;
  flex-shrink: 0;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  background: #f8fafc;
}

.context-tabs button,
.skill-domain-toggle button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--p-slate-500);
  cursor: pointer;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 750;
}

.context-tabs button {
  min-width: 150px;
  min-height: 32px;
}

.context-tabs button.active,
.skill-domain-toggle button.active {
  background: white;
  color: var(--harness-accent-strong);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
}

.context-panel {
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.context-panel--fc {
  min-height: 0;
}

.context-panel--records {
  min-height: 0;
}

.context-fc-host {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.context-table-host {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.context-table-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(248, 250, 252, 0.75);
  z-index: 5;
  pointer-events: none;
}

.context-fc-host :deep(.fc-pane-wrapper) {
  flex: 1;
  min-height: 0;
  height: 100%;
}

.context-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.context-select {
  min-width: 260px;
}

.context-select :deep(.p-select-label) {
  pointer-events: auto;
}

.context-search {
  flex: 1;
  min-width: 180px;
}

.context-error {
  flex-shrink: 0;
  border: 1px solid var(--p-red-200);
  border-radius: 7px;
  background: var(--p-red-50);
  color: var(--p-red-700);
  padding: 8px 10px;
  font-size: 0.78rem;
}

.context-error--hint {
  border-color: var(--p-amber-200);
  background: var(--p-amber-50);
  color: var(--p-amber-800);
}

.context-data-table {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 0;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  background: var(--p-slate-50);
}

.context-data-table :deep(.p-datatable) {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

.context-data-table :deep(.p-datatable-table-container) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.context-data-table :deep(.p-datatable-empty-message) {
  height: 100%;
}

.context-data-table :deep(.p-datatable-empty-message td) {
  height: 100%;
  padding: 0;
  border: none;
  vertical-align: middle;
}

.context-data-table :deep(.p-datatable-thead > tr > th),
.context-data-table :deep(.p-paginator) {
  background: #f8fafc;
}

.context-data-table :deep(.p-datatable-thead > tr > th) {
  padding: 8px 10px;
  color: var(--p-slate-500);
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
}

.context-data-table :deep(.p-datatable-tbody > tr > td) {
  padding: 7px 10px;
  color: var(--p-slate-700);
  font-size: 0.78rem;
  vertical-align: middle;
}

.context-data-table :deep(.p-datatable-tbody > tr:hover) {
  background: var(--harness-accent-softer);
}

.context-data-table :deep(.p-paginator) {
  border-top: 1px solid var(--p-slate-200);
  padding: 4px 8px;
}

.context-primary-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.context-primary-cell > span {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.context-primary-cell strong,
.context-primary-cell span,
.context-primary-cell small,
.context-muted-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-primary-cell small,
.context-file-cell small,
.context-muted-cell {
  color: var(--p-slate-400);
  font-size: 0.68rem;
}



.context-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--p-slate-200);
  border-radius: 6px;
  background: var(--p-slate-100);
  color: var(--harness-accent-strong);
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}

.context-add-btn:hover:not(:disabled) {
  background: var(--harness-accent-soft);
  border-color: #c4b5fd;
  color: var(--harness-accent-strong);
}

.context-add-btn.attached,
.context-add-btn:disabled {
  border-color: var(--p-emerald-200);
  background: var(--p-emerald-50);
  color: var(--p-emerald-700);
  cursor: default;
}

.context-add-btn i {
  font-size: 0.72rem;
}

.context-loading,
.context-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 120px;
  color: var(--p-slate-400);
  font-size: 0.8rem;
}

.context-empty--table {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 160px;
}

.skill-editor-form {
  gap: 10px;
}

.skill-editor-form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.skill-editor-form label span {
  color: var(--p-slate-500);
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
}

.skill-domain-toggle {
  display: inline-flex;
  align-self: flex-start;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--p-slate-200);
  border-radius: 8px;
  background: #f8fafc;
}

.skill-domain-toggle button {
  min-height: 30px;
  min-width: 76px;
  padding: 0 9px;
}

.skill-content-textarea {
  min-height: 260px;
  font-family: "JetBrains Mono", monospace;
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
  background: var(--p-slate-100);
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
  background: var(--p-slate-100);
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
  background: var(--p-slate-100);
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

<style>
/* PrimeVue Select overlay must sit above the context modal (z-index 10000). */
.p-select-overlay,
.p-select-list-container,
.p-connected-overlay {
  z-index: 10001 !important;
}
</style>
