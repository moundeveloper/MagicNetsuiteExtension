<template>
  <div class="multi-agent-view">
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
              @click="createNewSession"
              title="New Session"
            >
              <i class="pi pi-plus"></i>
            </Button>
          </template>
          <template #default>
            <div class="sidebar-header">
              <h3>Sessions</h3>
              <Button class="p-2!" size="small" @click="createNewSession">
                <i class="pi pi-plus"></i>
                New Session
              </Button>
            </div>
            <div class="session-list">
              <div
                v-for="session in sessionHistory"
                :key="session.id"
                class="session-item"
                :class="{ active: activeSessionId === session.id }"
                @click="loadSession(session.id)"
              >
                <div class="session-item-content">
                  <span class="session-title">{{ session.title }}</span>
                  <span class="session-date">{{
                    formatDate(session.updatedAt)
                  }}</span>
                </div>
                <button
                  class="session-delete-btn"
                  @click.stop="deleteSession(session.id)"
                  title="Delete session"
                >
                  <i class="pi pi-trash"></i>
                </button>
              </div>
              <div v-if="sessionHistory.length === 0" class="no-sessions">
                No sessions yet
              </div>
            </div>

            <!-- Config panel -->
            <div class="config-panel">
              <div
                class="config-header"
                @click="configExpanded = !configExpanded"
              >
                <span class="config-title">Configuration</span>
                <i
                  class="pi pi-chevron-down config-chevron"
                  :class="{ 'config-chevron--open': configExpanded }"
                />
              </div>
              <div v-if="configExpanded" class="config-body">
                <div class="config-row">
                  <label class="config-label">Max Agents</label>
                  <input
                    v-model.number="config.maxAgents"
                    type="number"
                    min="1"
                    max="10"
                    class="config-input"
                    @change="saveConfig"
                  />
                </div>
                <div class="config-row">
                  <label class="config-label">Allow Temp Agents</label>
                  <input
                    v-model="config.allowTempAgents"
                    type="checkbox"
                    class="config-toggle"
                    @change="saveConfig"
                  />
                </div>
                <div class="config-row">
                  <label class="config-label">Require Tool Approval</label>
                  <input
                    v-model="config.requireToolApproval"
                    type="checkbox"
                    class="config-toggle"
                    @change="saveConfig"
                  />
                </div>
              </div>
            </div>
          </template>
        </ExpandableSidebar>

        <div class="chat-area">
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
                  d="M12 16h5v5h-5zM23 16h5v5h-5zM17.5 24h5v5h-5z"
                  fill="var(--p-slate-400)"
                  rx="1"
                />
                <path
                  d="M14.5 21v3h5.5M25.5 21v3h-5.5"
                  stroke="var(--p-slate-300)"
                  stroke-width="1.2"
                  stroke-linecap="round"
                />
              </svg>
            </div>
            <p class="empty-title">Multi-Agent Orchestrator</p>
            <p class="empty-sub">
              Describe a complex task and I'll coordinate specialized agents to
              handle it.
            </p>
          </div>

          <!-- Message thread -->
          <div v-else class="message-list" ref="messageListRef">
            <template v-for="msg in messages" :key="msg.id">
              <!-- System message -->
              <div v-if="msg.role === 'system'" class="msg msg-system">
                <div class="msg-system-content">
                  <i class="pi pi-info-circle" />
                  <span>{{ msg.content }}</span>
                </div>
              </div>

              <!-- User message -->
              <div v-else-if="msg.role === 'user'" class="msg msg-user">
                <div class="msg-user-content">{{ msg.content }}</div>
              </div>

              <!-- Assistant message -->
              <div
                v-else-if="msg.role === 'assistant'"
                class="msg msg-assistant"
              >
                <!-- Agent context chip -->
                <div
                  v-if="msg.agentContext"
                  class="msg-agent-chip msg-agent-chip--assistant"
                  :style="chipStyle(msg.agentContext.color)"
                >
                  <span
                    class="chip-dot"
                    :style="{ background: msg.agentContext.color }"
                  />
                  {{ msg.agentContext.name }}
                </div>

                <!-- Tool executions -->
                <div
                  v-if="
                    getToolMessagesForAssistant(msg.id).length > 0 ||
                    (msg.isStreaming &&
                      msg.id === currentAssistantMsgId &&
                      inProgressTools.length > 0)
                  "
                  class="tool-group"
                >
                  <!-- While streaming: show running tools -->
                  <template
                    v-if="
                      msg.isStreaming &&
                      msg.id === currentAssistantMsgId &&
                      inProgressTools.filter((t) => t.status === 'running')
                        .length > 0
                    "
                  >
                    <div
                      v-for="tm in inProgressTools.filter(
                        (t) => t.status === 'running'
                      )"
                      :key="'running-' + tm.name + '-' + tm.timestamp"
                      class="tool-item tool-item-running"
                    >
                      <div class="tool-indicator">
                        <span class="tool-spinner" />
                      </div>
                      <span class="tool-label">{{ tm.name }}</span>
                    </div>
                  </template>
                  <!-- Completed tools -->
                  <template v-else>
                    <details class="tool-details">
                      <summary class="tool-summary">
                        <i class="pi pi-check-circle tool-check-icon" />
                        <span>
                          Used
                          {{ getToolMessagesForAssistant(msg.id).length }}
                          tool{{
                            getToolMessagesForAssistant(msg.id).length > 1
                              ? "s"
                              : ""
                          }}
                        </span>
                        <i class="pi pi-chevron-down tool-chevron" />
                      </summary>
                      <div class="tool-results-list">
                        <div
                          v-for="tm in getToolMessagesForAssistant(msg.id)"
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

                <!-- Sub-agent cards for this message -->
                <template
                  v-for="sa in getSubAgentsForMessage(msg.id)"
                  :key="sa.id"
                >
                  <div
                    class="sub-agent-card"
                    :class="{ expanded: sa.expanded }"
                  >
                    <div
                      class="sub-agent-header"
                      @click="sa.expanded = !sa.expanded"
                    >
                      <span
                        class="sub-agent-dot"
                        :style="{ background: sa.color }"
                      />
                      <span class="sub-agent-name">{{ sa.name }}</span>
                      <span class="sub-agent-task">{{
                        truncate(sa.task, 60)
                      }}</span>
                      <span
                        class="sub-agent-status"
                        :class="'status-' + sa.status"
                        >{{ sa.status }}</span
                      >
                      <i class="pi pi-chevron-down sub-agent-chevron" />
                    </div>
                    <div v-if="sa.expanded" class="sub-agent-body">
                      <div
                        v-for="saMsg in sa.messages"
                        :key="saMsg.id"
                        class="sub-agent-msg"
                      >
                        <div
                          v-if="saMsg.role === 'tool'"
                          class="sub-agent-tool-msg"
                        >
                          <span class="sub-agent-tool-name">{{
                            saMsg.toolName
                          }}</span>
                          <span class="sub-agent-tool-content">{{
                            truncate(saMsg.content, 300)
                          }}</span>
                        </div>
                        <div
                          v-else-if="saMsg.role === 'assistant'"
                          class="sub-agent-assistant-msg"
                        >
                          <MessageContentRenderer :content="saMsg.content" />
                        </div>
                      </div>
                      <div
                        v-if="sa.status === 'running'"
                        class="sub-agent-running-indicator"
                      >
                        <span class="thinking-dot" />
                        <span class="thinking-dot" />
                        <span class="thinking-dot" />
                      </div>
                    </div>
                  </div>
                </template>

                <!-- Response content -->
                <div class="msg-assistant-content">
                  <div
                    v-if="msg.isStreaming && !msg.content"
                    class="thinking-indicator"
                  >
                    <span class="thinking-dot" />
                    <span class="thinking-dot" />
                    <span class="thinking-dot" />
                  </div>
                  <MessageContentRenderer v-else :content="msg.content" />
                </div>
              </div>
            </template>

            <!-- Standalone loading indicator -->
            <div
              v-if="loading && messages[messages.length - 1]?.role === 'user'"
              class="msg msg-assistant"
            >
              <div class="msg-assistant-content">
                <div class="thinking-indicator">
                  <span class="thinking-dot" />
                  <span class="thinking-dot" />
                  <span class="thinking-dot" />
                </div>
              </div>
            </div>
          </div>

          <!-- Error banner -->
          <div v-if="orchestrator.error.value" class="error-banner">
            <i class="pi pi-exclamation-triangle" />
            <span>{{ String(orchestrator.error.value) }}</span>
          </div>

          <!-- Input wrapper -->
          <div class="input-wrapper">
            <div class="chat-toolbar">
              <!-- Active sub-agents indicator -->
              <span v-if="runningAgentCount > 0" class="agent-indicator">
                <span class="agent-indicator-dot running-pulse" />
                {{ runningAgentCount }} agent{{
                  runningAgentCount > 1 ? "s" : ""
                }}
                running
              </span>
            </div>

            <div class="input-row">
              <div
                ref="inputRef"
                class="chat-input"
                :contenteditable="!loading"
                data-placeholder="Describe a task to orchestrate..."
                @keydown="onInputKeydown"
                @input="onPromptInput"
                @paste.prevent="onInputPaste"
              />
              <button
                v-if="loading"
                class="stop-btn"
                @click="stopOrchestrator"
                title="Stop generation"
              >
                <i class="pi pi-stop-circle" />
              </button>
              <button
                v-else
                class="send-btn"
                :disabled="!inputHasContent"
                @click="sendMessage()"
              >
                <i class="pi pi-arrow-up" />
              </button>
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
    :requester-name="approvalRequesterName"
    :requester-color="approvalRequesterColor"
    @approve="handleApprove"
    @reject="handleReject"
  />
</template>

<script setup lang="ts">
import {
  ref,
  nextTick,
  watch,
  onMounted,
  onBeforeUnmount,
  computed,
  reactive
} from "vue";
import MCard from "../components/universal/card/MCard.vue";
import Button from "primevue/button";
import { useAgent, ToolRejectedError } from "../composables/useAgent";
import type { ToolDefinition } from "../composables/useAgent";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MessageContentRenderer from "../components/MessageContentRenderer.vue";
import ToolApprovalDialog from "../components/ToolApprovalDialog.vue";
import { tools } from "../utils/toolManager";
import { createSqlAiTools } from "../utils/sqlAiTools";
import {
  getEnabledAgents,
  getAgentBySlug,
  type Agent,
  generateAgentColor
} from "../utils/agentsDb";
import { getSkillContent } from "../utils/skillsDb";
import {
  getAllMultiAgentSessions,
  upsertMultiAgentSession,
  deleteMultiAgentSession,
  getMultiAgentUiState,
  setMultiAgentUiState,
  DEFAULT_MULTI_AGENT_CONFIG,
  type MultiAgentSessionRecord,
  type MultiAgentConfig
} from "../utils/multiAgentDb";

// ── Props ──
const props = defineProps<{ vhOffset: number }>();

// ── Types ──
interface OrchestratorMessage {
  id: number;
  role: "user" | "assistant" | "tool" | "system" | "compaction";
  content: string;
  toolName?: string;
  isStreaming?: boolean;
  /** Sub-agent spawn card */
  subAgentId?: string;
  /** Agent context for coloring */
  agentContext?: { name: string; slug: string; color: string };
}

interface SubAgent {
  id: string;
  agentId: string;
  name: string;
  slug: string;
  color: string;
  description: string;
  status: "idle" | "running" | "done" | "error";
  task: string;
  messages: OrchestratorMessage[];
  isTemporary: boolean;
  expanded: boolean;
  createdAt: string;
  /** useAgent instance result text */
  result?: string;
}

interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: OrchestratorMessage[];
  subAgents: SubAgent[];
  config: MultiAgentConfig;
}

// ── UI state ──
const messages = ref<OrchestratorMessage[]>([]);
const subAgents = ref<SubAgent[]>([]);
const prompt = ref("");
const inputRef = ref<HTMLDivElement | null>(null);
const messageListRef = ref<HTMLDivElement | null>(null);

// Session state
const sessionHistory = ref<Session[]>([]);
const activeSessionId = ref("");

// Config
const config = reactive<MultiAgentConfig>({ ...DEFAULT_MULTI_AGENT_CONFIG });
const configExpanded = ref(false);

// Tool approval
const approvalVisible = ref(false);
const approvalToolName = ref("");
const approvalToolInput = ref<unknown>(null);
const approvalRequesterName = ref("");
const approvalRequesterColor = ref("");
let approvalResolve: ((approved: boolean) => void) | null = null;

// Agent tracking
const activeTools = ref<string[]>([]);
const inProgressTools = ref<
  Array<{ name: string; input: unknown; status: string; timestamp: number }>
>([]);
const currentAssistantMsgId = ref(0);

// Sub-agent to message mapping (which assistant message spawned which sub-agent)
const subAgentToMessage = ref<Map<string, number>>(new Map());

// Tool message to assistant message mapping
const toolMessageToAssistant = ref<Map<number, number>>(new Map());

// Track synced tool call IDs
const syncedToolCallIds = ref<Set<string>>(new Set());

// ── Save debounce ──
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// ── Helpers ──
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

const truncate = (str: string | null | undefined, n: number) => {
  if (!str) return "";
  return str.length > n ? str.slice(0, n) + "..." : str;
};

const hexAlpha = (hex: string, alpha: number): string => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const chipStyle = (color: string) => ({
  background: hexAlpha(color, 0.12),
  border: `1px solid ${hexAlpha(color, 0.4)}`
});

const generateSessionId = () => "masession_" + Date.now();

const getFirstUserMessage = (msgs: OrchestratorMessage[]) => {
  const firstUser = msgs.find((m) => m.role === "user");
  return firstUser ? firstUser.content.slice(0, 50) : "New Session";
};

const runningAgentCount = computed(
  () => subAgents.value.filter((sa) => sa.status === "running").length
);

const getSubAgentsForMessage = (assistantMsgId: number) => {
  return subAgents.value.filter(
    (sa) => subAgentToMessage.value.get(sa.id) === assistantMsgId
  );
};

const getToolMessagesForAssistant = (assistantId: number) => {
  const toolIds = Array.from(toolMessageToAssistant.value.entries())
    .filter(([, assocId]) => assocId === assistantId)
    .map(([toolMsgId]) => toolMsgId);

  return messages.value.filter(
    (m) => m.role === "tool" && toolIds.includes(m.id)
  );
};

const rebuildToolMessageMap = () => {
  toolMessageToAssistant.value.clear();
  syncedToolCallIds.value.clear();

  for (const am of orchestrator.history.value) {
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

// ── Build agent system prompt ──
const buildAgentSystemPrompt = async (
  agentConfig: Agent
): Promise<string> => {
  const parts: string[] = [agentConfig.systemPrompt];

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

  const limitNotes: string[] = [];
  if (!agentConfig.limits.canExecuteDestructive) {
    limitNotes.push(
      "You are NOT allowed to execute destructive operations (creating, modifying, or deleting data)."
    );
  }
  if (agentConfig.limits.blockedTools.length > 0) {
    limitNotes.push(
      `You must NOT use the following tools: ${agentConfig.limits.blockedTools.join(", ")}.`
    );
  }
  if (limitNotes.length > 0) {
    parts.push("\n\n# Restrictions\n" + limitNotes.join("\n"));
  }

  return parts.join("\n");
};

// ── Tool Approval ──
const requestToolApproval = (
  name: string,
  input: unknown,
  requesterName?: string,
  requesterColor?: string
): Promise<boolean> => {
  if (!config.requireToolApproval) {
    return Promise.resolve(true);
  }
  approvalToolName.value = name;
  approvalToolInput.value = input;
  approvalRequesterName.value = requesterName ?? "Orchestrator";
  approvalRequesterColor.value = requesterColor ?? "";
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

// ── Sub-Agent Execution ──
const executeSubAgent = async (
  subAgent: SubAgent,
  agentConfig?: Agent
) => {
  subAgent.status = "running";

  // Build system prompt
  let systemPrompt = "";
  if (agentConfig) {
    systemPrompt = await buildAgentSystemPrompt(agentConfig);
  } else {
    // Temporary agent — systemPrompt stored in description
    systemPrompt = subAgent.description;
  }

  // Create a temporary useAgent instance for the sub-agent
  const subAgentInstance = useAgent({
    systemPrompt,
    tools: [...tools, ...createSqlAiTools()],
    keepHistory: false,
    onToolApprovalRequest: (name, input) => {
      return requestToolApproval(name, input, subAgent.name, subAgent.color);
    },
    onToolStart(name) {
      subAgent.messages.push({
        id: Date.now() + Math.random(),
        role: "tool",
        content: `Running ${name}...`,
        toolName: name
      });
      scrollToBottom();
    },
    onToolResult(name, result) {
      const lastTool = [...subAgent.messages]
        .reverse()
        .find((m) => m.role === "tool" && m.toolName === name);
      if (lastTool) {
        lastTool.content =
          typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2);
      }
      scrollToBottom();
    }
  });

  try {
    const result = await subAgentInstance.run(subAgent.task, {
      systemPrompt,
      allowedTools: agentConfig?.tools?.length
        ? agentConfig.tools
        : undefined,
      blockedTools: agentConfig?.limits?.blockedTools?.length
        ? agentConfig.limits.blockedTools
        : undefined,
      blockDestructive: agentConfig
        ? !agentConfig.limits.canExecuteDestructive
        : false
    });

    subAgent.status = "done";
    subAgent.result =
      typeof result === "string" ? result : JSON.stringify(result, null, 2);
    subAgent.messages.push({
      id: Date.now() + Math.random(),
      role: "assistant",
      content: subAgent.result
    });
  } catch (err) {
    subAgent.status = "error";
    subAgent.result = `Error: ${String(err)}`;
    subAgent.messages.push({
      id: Date.now() + Math.random(),
      role: "assistant",
      content: subAgent.result
    });
  }

  scrollToBottom();
  autoSaveCurrentSession();
};

// ── Orchestrator Tools ──
const spawnAgentTool: ToolDefinition = {
  name: "spawn_agent",
  description:
    "Spawn a sub-agent to handle a specific task. The agent will execute independently and report results back.",
  parameters: {
    type: "object",
    properties: {
      agent_slug: {
        type: "string",
        description:
          "Slug of the agent to spawn (from the agents list)"
      },
      task: {
        type: "string",
        description: "The task description for the sub-agent"
      }
    },
    required: ["agent_slug", "task"]
  },
  execute: async (input) => {
    const slug = String(input.agent_slug ?? "");
    const task = String(input.task ?? "");

    // Check maxAgents limit
    const runningCount = subAgents.value.filter(
      (sa) => sa.status === "running"
    ).length;
    if (runningCount >= config.maxAgents) {
      return {
        error: `Maximum agent limit (${config.maxAgents}) reached. Wait for running agents to finish.`
      };
    }

    // Check allowedAgentSlugs
    if (
      config.allowedAgentSlugs.length > 0 &&
      !config.allowedAgentSlugs.includes(slug)
    ) {
      return {
        error: `Agent "${slug}" is not in the allowed agents list.`
      };
    }

    // Look up agent config
    const agentConfig = await getAgentBySlug(slug);
    if (!agentConfig) {
      return {
        error: `No agent found with slug "${slug}". Use list_available_agents to see available agents.`
      };
    }
    if (!agentConfig.enabled) {
      return { error: `Agent "${agentConfig.name}" is disabled.` };
    }

    // Create SubAgent entry
    const subAgentId = `sa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const newSubAgent: SubAgent = {
      id: subAgentId,
      agentId: agentConfig.agentId,
      name: agentConfig.name,
      slug: agentConfig.slug,
      color: agentConfig.color,
      description: agentConfig.description,
      status: "idle",
      task,
      messages: [],
      isTemporary: false,
      expanded: true,
      createdAt: new Date().toISOString()
    };

    subAgents.value.push(newSubAgent);

    // Link sub-agent to current assistant message
    if (currentAssistantMsgId.value) {
      subAgentToMessage.value.set(subAgentId, currentAssistantMsgId.value);
    }

    // Add system message
    messages.value.push({
      id: Date.now() + Math.random(),
      role: "system",
      content: `Spawned agent "${agentConfig.name}" for task: ${truncate(task, 100)}`
    });

    // Run sub-agent asynchronously — use the reactive proxy from the array,
    // NOT the raw newSubAgent, so status changes trigger Vue reactivity.
    const reactiveAgent = subAgents.value[subAgents.value.length - 1]!;
    executeSubAgent(reactiveAgent, agentConfig);

    return {
      agentId: subAgentId,
      name: agentConfig.name,
      status: "spawned"
    };
  }
};

const createTempAgentTool: ToolDefinition = {
  name: "create_temp_agent",
  description:
    "Create a temporary agent with a custom system prompt for this session only.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name for the temporary agent"
      },
      system_prompt: {
        type: "string",
        description: "System prompt for the agent"
      },
      task: {
        type: "string",
        description: "Initial task for the agent"
      }
    },
    required: ["name", "system_prompt", "task"]
  },
  execute: async (input) => {
    const agentName = String(input.name ?? "");
    const systemPrompt = String(input.system_prompt ?? "");
    const task = String(input.task ?? "");

    if (!config.allowTempAgents) {
      return {
        error:
          "Temporary agent creation is disabled in the configuration."
      };
    }

    const runningCount = subAgents.value.filter(
      (sa) => sa.status === "running"
    ).length;
    if (runningCount >= config.maxAgents) {
      return {
        error: `Maximum agent limit (${config.maxAgents}) reached. Wait for running agents to finish.`
      };
    }

    const subAgentId = `sa_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const slug = agentName.toLowerCase().replace(/\s+/g, "-");
    const color = generateAgentColor(agentName, systemPrompt);

    const newSubAgent: SubAgent = {
      id: subAgentId,
      agentId: "",
      name: agentName,
      slug,
      color,
      description: systemPrompt, // Store system prompt in description for temp agents
      status: "idle",
      task,
      messages: [],
      isTemporary: true,
      expanded: true,
      createdAt: new Date().toISOString()
    };

    subAgents.value.push(newSubAgent);

    if (currentAssistantMsgId.value) {
      subAgentToMessage.value.set(subAgentId, currentAssistantMsgId.value);
    }

    messages.value.push({
      id: Date.now() + Math.random(),
      role: "system",
      content: `Created temporary agent "${agentName}" for task: ${truncate(task, 100)}`
    });

    // Run without agentConfig (temporary) — use the reactive proxy from the
    // array so status changes trigger Vue reactivity.
    const reactiveAgent = subAgents.value[subAgents.value.length - 1]!;
    executeSubAgent(reactiveAgent);

    return {
      agentId: subAgentId,
      name: agentName,
      status: "spawned"
    };
  }
};

const listAgentsTool: ToolDefinition = {
  name: "list_available_agents",
  description:
    "List all available agents that can be spawned, with their capabilities.",
  parameters: {
    type: "object",
    properties: {},
    required: []
  },
  execute: async () => {
    const allAgents = await getEnabledAgents();
    const allowed =
      config.allowedAgentSlugs.length > 0
        ? allAgents.filter((a) => config.allowedAgentSlugs.includes(a.slug))
        : allAgents;

    return {
      available: allowed.map((a) => ({
        slug: a.slug,
        name: a.name,
        description: a.description
      })),
      active: subAgents.value.map((sa) => ({
        id: sa.id,
        name: sa.name,
        status: sa.status,
        task: sa.task
      })),
      maxAgents: config.maxAgents,
      currentCount: subAgents.value.filter((sa) => sa.status === "running")
        .length
    };
  }
};

// ── get_agent_results — lets the orchestrator poll and collect sub-agent output ──
const getAgentResultsTool: ToolDefinition = {
  name: "get_agent_results",
  description:
    "Check the current status and collect results from previously spawned sub-agents. " +
    "Call this after spawning agents to know when they have finished and to retrieve their output for synthesis. " +
    "If not all agents are done yet, note that you are waiting and call this tool again shortly.",
  parameters: {
    type: "object",
    properties: {
      agent_ids: {
        type: "array",
        items: { type: "string" },
        description:
          "Array of agent IDs as returned by spawn_agent or create_temp_agent."
      }
    },
    required: ["agent_ids"]
  },
  execute: async (input) => {
    const ids: string[] = Array.isArray(input.agent_ids)
      ? (input.agent_ids as string[])
      : [];

    const results = ids.map((id) => {
      const sa = subAgents.value.find((s) => s.id === id);
      if (!sa) return { id, status: "not_found", result: null, task: null };
      return {
        id,
        name: sa.name,
        status: sa.status,
        task: sa.task,
        result:
          sa.status === "done" || sa.status === "error"
            ? (sa.result ?? null)
            : null
      };
    });

    const pending = results.filter(
      (r) => r.status === "running" || r.status === "idle"
    ).length;
    const allDone = pending === 0;

    return {
      results,
      allDone,
      pending,
      instruction: allDone
        ? "All agents have completed. Use their results above to write your final synthesis."
        : `${pending} agent(s) still running. Call get_agent_results again in a moment.`
    };
  }
};

// ── Orchestrator Agent ──
const orchestrator = useAgent({
  systemPrompt: `You are a multi-agent orchestrator. You PLAN, DELEGATE to parallel agents, COLLECT results, and SYNTHESIZE. You NEVER do the actual work yourself.

## Your Tools
- **list_available_agents** — See registered agents and current active agents. Call this first.
- **spawn_agent** — Spawn a registered agent by slug for a single focused task. Returns immediately; agents run in parallel.
- **create_temp_agent** — Create a one-off agent with a custom system prompt when no registered agent fits.
- **get_agent_results** — Check status and retrieve output of spawned agents. Use this to detect completion and gather results.

## MANDATORY Execution Pattern

### Step 1 — PLAN (always do this first, in your text response before any tool calls)
Before spawning a single agent, announce your decomposition plan:
- List every sub-task you will delegate
- Name which agent will handle each one
- State that tasks will run in parallel

### Step 2 — DECOMPOSE into N independent agents
- **For N independent outputs → spawn EXACTLY N agents, one per output.**
  - "Generate 5 scripts" → 5 agents, one script each
  - "Write 3 reports" → 3 agents, one report each
  - "Analyze 4 records" → 4 agents, one record each
- NEVER bundle multiple independent outputs into a single agent's task.
- Give each agent a narrow, specific task description (not "do everything").

### Step 3 — SPAWN all agents back-to-back
- Call spawn_agent (or create_temp_agent) once per sub-task.
- They start running in parallel automatically — do NOT wait between spawns.
- Collect all returned agent IDs.

### Step 4 — COLLECT with get_agent_results
- Call get_agent_results([id1, id2, ...]) with ALL agent IDs.
- If allDone is false, briefly acknowledge "Waiting for agents…" and call again.
- Repeat until allDone is true.

### Step 5 — SYNTHESIZE
- Write a clear, structured final response using the collected agent results.
- Attribute each result to its agent.
- Do NOT ask the user to check the cards — present the full synthesized output here.

## Hard Rules
- You are a COORDINATOR — NEVER perform the task yourself, even if it seems faster.
- N independent items → N separate agents. No exceptions.
- Always call get_agent_results before writing your final synthesis.
- If list_available_agents shows no suitable agents, use create_temp_agent.`,
  tools: [
    spawnAgentTool,
    createTempAgentTool,
    listAgentsTool,
    getAgentResultsTool
  ],
  onToolApprovalRequest: (name, input) => requestToolApproval(name, input),
  onToolStart(name, input) {
    inProgressTools.value.push({
      name,
      input,
      status: "running",
      timestamp: Date.now()
    });
    scrollToBottom();
  },
  onToolResult(name) {
    activeTools.value = activeTools.value.filter((t) => t !== name);
    const idx = [...inProgressTools.value]
      .reverse()
      .findIndex((t) => t.name === name);
    if (idx !== -1) {
      inProgressTools.value.splice(
        inProgressTools.value.length - 1 - idx,
        1
      );
    }
  }
});

const loading = computed(() => orchestrator.loading.value);

let abortController: AbortController | null = null;

// ── Watch for new tool messages ──
watch(
  orchestrator.history,
  () => {
    const toolMsgs = orchestrator.history.value.filter(
      (m) => m.role === "tool"
    );
    for (const tm of toolMsgs) {
      const key = tm.toolCallId ?? `${tm.toolName}::${tm.content}`;
      if (syncedToolCallIds.value.has(key)) continue;

      const lastAssistant = messages.value
        .slice()
        .reverse()
        .find((m) => m.role === "assistant");

      const newToolMsg: OrchestratorMessage = {
        id: Date.now() + Math.random(),
        role: "tool",
        content: tm.content,
        toolName: tm.toolName
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

// ── ScrollToBottom ──
const scrollToBottom = async () => {
  await nextTick();
  requestAnimationFrame(() => {
    const el = messageListRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
};

// ── Input helpers ──
const getInputText = (): string => {
  const el = inputRef.value;
  if (!el) return "";
  let text = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    } else if (node.nodeName === "BR") {
      text += "\n";
    } else {
      text += (node as HTMLElement).textContent ?? "";
    }
  }
  return text.replace(/\u200B/g, "").replace(/\u00A0/g, " ");
};

const clearInput = () => {
  if (inputRef.value) inputRef.value.innerHTML = "";
  prompt.value = "";
};

const inputHasContent = computed(() => !!prompt.value.trim());

const onPromptInput = () => {
  prompt.value = getInputText();
};

const onInputKeydown = (e: KeyboardEvent) => {
  // Alt+Enter = newline
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

  // Send on Enter
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

// ── Send Message ──
const sendMessage = async (overrideText?: string) => {
  const rawText =
    overrideText !== undefined ? overrideText : getInputText().trim();
  if (!rawText) return;
  if (loading.value) return;

  inProgressTools.value = [];
  if (overrideText === undefined) {
    clearInput();
  }

  const userMsg: OrchestratorMessage = {
    id: Date.now() + Math.random(),
    role: "user",
    content: rawText
  };
  messages.value.push(userMsg);
  await scrollToBottom();

  const assistantMsg: OrchestratorMessage = {
    id: Date.now() + Math.random(),
    role: "assistant",
    content: "",
    isStreaming: true
  };
  messages.value.push(assistantMsg);
  currentAssistantMsgId.value = assistantMsg.id;
  inProgressTools.value = [];
  await scrollToBottom();

  try {
    abortController = new AbortController();

    const finalText = await orchestrator.run(rawText, {
      signal: abortController.signal
    });

    assistantMsg.content =
      typeof finalText === "string"
        ? finalText
        : JSON.stringify(finalText, null, 2);
    assistantMsg.isStreaming = false;
    messages.value = [...messages.value];

    inProgressTools.value = [];
    activeTools.value = [];
    currentAssistantMsgId.value = 0;

    autoSaveCurrentSession();
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      if (!assistantMsg.content) {
        assistantMsg.content = "Generation stopped.";
      }
    } else if (e instanceof ToolRejectedError) {
      assistantMsg.content = `Stopped — tool **\`${e.toolName}\`** was rejected.`;
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

    autoSaveCurrentSession();
  } finally {
    abortController = null;
    await scrollToBottom();
  }
};

const stopOrchestrator = () => {
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

// ── Session Persistence ──
const saveSessionImmediate = async () => {
  try {
    await Promise.all(
      sessionHistory.value.map((session) => {
        const plain = JSON.parse(JSON.stringify(session));
        return upsertMultiAgentSession({
          sessionId: plain.id,
          title: plain.title,
          createdAt: plain.createdAt,
          updatedAt: plain.updatedAt,
          messages: plain.messages,
          subAgents: plain.subAgents,
          config: plain.config
        });
      })
    );
  } catch (error) {
    console.error("Failed to save session history:", error);
  }
};

const saveSessionHistory = (immediate = false) => {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }

  if (immediate) {
    saveSessionImmediate();
    return;
  }

  saveDebounceTimer = setTimeout(saveSessionImmediate, 1000);
};

const saveActiveSessionId = () => {
  setMultiAgentUiState("activeSessionId", activeSessionId.value).catch(
    console.error
  );
};

const saveConfig = () => {
  setMultiAgentUiState("config", { ...config }).catch(console.error);
  // Also update current session config
  if (activeSessionId.value) {
    const session = sessionHistory.value.find(
      (s) => s.id === activeSessionId.value
    );
    if (session) {
      session.config = { ...config };
      saveSessionHistory();
    }
  }
};

const autoSaveCurrentSession = () => {
  if (messages.value.length === 0) return;

  if (activeSessionId.value) {
    const session = sessionHistory.value.find(
      (s) => s.id === activeSessionId.value
    );
    if (session) {
      session.messages = [...messages.value];
      session.subAgents = [...subAgents.value];
      session.updatedAt = new Date().toISOString();
      saveSessionHistory();
      return;
    }
  }

  const firstUserMsg = getFirstUserMessage(messages.value);
  const newSession: Session = {
    id: generateSessionId(),
    title: firstUserMsg,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [...messages.value],
    subAgents: [...subAgents.value],
    config: { ...config }
  };
  sessionHistory.value.unshift(newSession);
  activeSessionId.value = newSession.id;
  saveSessionHistory();
  saveActiveSessionId();
};

const createNewSession = () => {
  if (messages.value.length > 0) {
    const firstUserMsg = getFirstUserMessage(messages.value);
    const existingSession = sessionHistory.value.find(
      (s) => s.id === activeSessionId.value
    );

    if (existingSession) {
      existingSession.messages = [...messages.value];
      existingSession.subAgents = [...subAgents.value];
      existingSession.updatedAt = new Date().toISOString();
      if (
        !existingSession.title ||
        existingSession.title === "New Session"
      ) {
        existingSession.title = firstUserMsg;
      }
    } else {
      const newSession: Session = {
        id: generateSessionId(),
        title: firstUserMsg,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [...messages.value],
        subAgents: [...subAgents.value],
        config: { ...config }
      };
      sessionHistory.value.unshift(newSession);
      activeSessionId.value = newSession.id;
    }

    saveSessionHistory();
    saveActiveSessionId();
  }

  messages.value = [];
  subAgents.value = [];
  activeSessionId.value = "";
  orchestrator.clearHistory();
  syncedToolCallIds.value.clear();
  toolMessageToAssistant.value.clear();
  subAgentToMessage.value.clear();
  scrollToBottom();
};

const loadSession = (sessionId: string) => {
  if (messages.value.length > 0 && activeSessionId.value) {
    const existingSession = sessionHistory.value.find(
      (s) => s.id === activeSessionId.value
    );
    if (existingSession) {
      existingSession.messages = [...messages.value];
      existingSession.subAgents = [...subAgents.value];
      existingSession.updatedAt = new Date().toISOString();
    } else if (messages.value.length > 0) {
      const newSession: Session = {
        id: generateSessionId(),
        title: getFirstUserMessage(messages.value),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [...messages.value],
        subAgents: [...subAgents.value],
        config: { ...config }
      };
      sessionHistory.value.unshift(newSession);
    }
    saveSessionHistory();
  }

  const session = sessionHistory.value.find((s) => s.id === sessionId);
  if (session) {
    activeSessionId.value = sessionId;
    messages.value = Array.isArray(session.messages)
      ? [...session.messages]
      : [];
    subAgents.value = Array.isArray(session.subAgents)
      ? [...session.subAgents]
      : [];

    // Restore config from session
    Object.assign(config, session.config ?? DEFAULT_MULTI_AGENT_CONFIG);

    // Restore orchestrator history
    const restoredHistory = sessionMessagesToAgentHistory(messages.value);
    orchestrator.setHistory(restoredHistory);
    rebuildToolMessageMap();
    rebuildSubAgentToMessageMap();
    saveActiveSessionId();
    scrollToBottom();
  }
};

const deleteSession = (sessionId: string) => {
  sessionHistory.value = sessionHistory.value.filter(
    (s) => s.id !== sessionId
  );

  if (activeSessionId.value === sessionId) {
    messages.value = [];
    subAgents.value = [];
    activeSessionId.value = "";
    orchestrator.clearHistory();
    syncedToolCallIds.value.clear();
    toolMessageToAssistant.value.clear();
    subAgentToMessage.value.clear();
  }

  deleteMultiAgentSession(sessionId).catch(console.error);
  saveSessionHistory(true);
  saveActiveSessionId();
};

const rebuildSubAgentToMessageMap = () => {
  subAgentToMessage.value.clear();
  // Best-effort: link sub-agents to the nearest preceding assistant message
  for (const sa of subAgents.value) {
    // Find the system message that mentions this sub-agent
    const systemMsg = messages.value.find(
      (m) =>
        m.role === "system" && m.content.includes(sa.name)
    );
    if (systemMsg) {
      // Find the assistant message just before the system message
      const systemIdx = messages.value.indexOf(systemMsg);
      for (let i = systemIdx - 1; i >= 0; i--) {
        if (messages.value[i]!.role === "assistant") {
          subAgentToMessage.value.set(sa.id, messages.value[i]!.id);
          break;
        }
      }
    }
  }
};

const sessionMessagesToAgentHistory = (
  msgs: OrchestratorMessage[]
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
      const toolMsgs: OrchestratorMessage[] = [];
      let j = i + 1;
      while (j < msgs.length && msgs[j]!.role === "tool") {
        toolMsgs.push(msgs[j]!);
        j++;
      }

      if (toolMsgs.length > 0) {
        const toolCalls = toolMsgs.map((tm) => {
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

        let callIdx = 0;
        for (const tm of toolMsgs) {
          agentMsgs.push({
            role: "tool",
            content: tm.content,
            toolName: tm.toolName,
            toolCallId: toolCalls[callIdx]!.id,
            timestamp: new Date()
          });
          callIdx++;
        }

        i = j;
      } else {
        agentMsgs.push({
          role: "assistant",
          content: m.content,
          timestamp: new Date()
        });
        i = j;
      }
    } else if (m.role === "tool") {
      // Orphan tool message
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
    } else {
      // system messages — skip for agent history
      i++;
    }
  }
  return agentMsgs;
};

const loadSessionHistory = async () => {
  try {
    const [storedSessions, storedActiveId, storedConfig] = await Promise.all([
      getAllMultiAgentSessions(),
      getMultiAgentUiState<string>("activeSessionId", ""),
      getMultiAgentUiState<MultiAgentConfig | null>("config", null)
    ]);

    sessionHistory.value = storedSessions.map((s) => ({
      id: s.sessionId,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messages: Array.isArray(s.messages) ? (s.messages as OrchestratorMessage[]) : [],
      subAgents: Array.isArray(s.subAgents)
        ? s.subAgents.map((sa) => ({
            ...sa,
            messages: (sa.messages ?? []) as OrchestratorMessage[],
            expanded: false,
            result: undefined
          }))
        : [],
      config: s.config ?? { ...DEFAULT_MULTI_AGENT_CONFIG }
    }));

    // Restore config
    if (storedConfig) {
      Object.assign(config, storedConfig);
    }

    if (typeof storedActiveId === "string" && storedActiveId) {
      const session = sessionHistory.value.find(
        (s) => s.id === storedActiveId
      );
      if (session) {
        activeSessionId.value = storedActiveId;
        messages.value = session.messages;
        subAgents.value = session.subAgents;
        Object.assign(config, session.config ?? DEFAULT_MULTI_AGENT_CONFIG);
        const restoredHistory = sessionMessagesToAgentHistory(
          messages.value
        );
        orchestrator.setHistory(restoredHistory);
        rebuildToolMessageMap();
        rebuildSubAgentToMessageMap();
      }
    }

    inProgressTools.value = [];
    activeTools.value = [];
    currentAssistantMsgId.value = 0;
  } catch (error) {
    console.error("Failed to load session history:", error);
    sessionHistory.value = [];
  }
};

// ── Lifecycle ──
onMounted(() => {
  loadSessionHistory();
});

onBeforeUnmount(() => {
  if (saveDebounceTimer) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
  }
  saveSessionImmediate();
  saveActiveSessionId();
});
</script>

<style scoped>
.multi-agent-view {
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

/* ── System Message ── */
.msg-system {
  padding: 0.35rem 0;
}

.msg-system-content {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  color: var(--p-slate-400);
  font-style: italic;
}

.msg-system-content i {
  font-size: 0.65rem;
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
}

.msg-agent-chip.msg-agent-chip--assistant {
  font-family: inherit;
  font-size: 0.72rem;
  letter-spacing: 0;
}

.chip-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ── Tool Group ── */
.tool-group {
  margin-bottom: 0.5rem;
}

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

/* ── Sub-Agent Cards ── */
.sub-agent-card {
  border: 1px solid var(--p-slate-200);
  border-radius: 0.5rem;
  margin: 0.5rem 0;
  overflow: hidden;
}

.sub-agent-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: background 0.15s ease;
  background: var(--p-slate-50);
}

.sub-agent-header:hover {
  background: var(--p-slate-100);
}

.sub-agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.sub-agent-name {
  font-weight: 600;
  font-size: 0.8rem;
  color: var(--p-slate-700);
}

.sub-agent-task {
  flex: 1;
  font-size: 0.75rem;
  color: var(--p-slate-400);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub-agent-status {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
}

.status-running {
  background: var(--p-blue-50);
  color: var(--p-blue-600);
}

.status-done {
  background: var(--p-green-50);
  color: var(--p-green-600);
}

.status-error {
  background: var(--p-red-50);
  color: var(--p-red-600);
}

.status-idle {
  background: var(--p-slate-100);
  color: var(--p-slate-500);
}

.sub-agent-chevron {
  font-size: 0.55rem;
  color: var(--p-slate-400);
  transition: transform 0.2s ease;
}

.sub-agent-card.expanded .sub-agent-chevron {
  transform: rotate(180deg);
}

.sub-agent-body {
  border-top: 1px solid var(--p-slate-200);
  padding: 0.75rem;
  max-height: 300px;
  overflow-y: auto;
}

.sub-agent-msg {
  margin-bottom: 0.5rem;
}

.sub-agent-msg:last-child {
  margin-bottom: 0;
}

.sub-agent-tool-msg {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.3rem 0.5rem;
  background: var(--p-slate-50);
  border-radius: 0.25rem;
  margin-bottom: 0.25rem;
}

.sub-agent-tool-name {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--p-slate-500);
}

.sub-agent-tool-content {
  font-size: 0.65rem;
  color: var(--p-slate-400);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
}

.sub-agent-assistant-msg {
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--p-slate-700);
}

.sub-agent-running-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0.25rem 0;
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
  background: var(--p-blue-500);
}

.running-pulse {
  animation: pulse-dot 1.5s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
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

.chat-input:empty::before {
  content: attr(data-placeholder);
  color: var(--p-slate-400);
  pointer-events: none;
}

.chat-input[contenteditable="false"] {
  opacity: 0.5;
  cursor: not-allowed;
  user-select: none;
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

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.625rem;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background 0.15s ease;
}

.session-item:hover {
  background: var(--p-slate-100);
}

.session-item.active {
  background: var(--p-blue-50);
  border: 1px solid var(--p-blue-200);
}

.session-item-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.session-title {
  font-size: 0.775rem;
  font-weight: 500;
  color: var(--p-slate-700);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-date {
  font-size: 0.65rem;
  color: var(--p-slate-400);
}

.session-delete-btn {
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

.session-item:hover .session-delete-btn {
  opacity: 1;
}

.session-delete-btn:hover {
  background: var(--p-red-100);
  color: var(--p-red-600);
}

.no-sessions {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
  color: var(--p-slate-400);
  font-size: 0.775rem;
  text-align: center;
}

/* ── Config Panel ── */
.config-panel {
  border-top: 1px solid var(--p-slate-200);
}

.config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.75rem;
  cursor: pointer;
  transition: background 0.15s ease;
}

.config-header:hover {
  background: var(--p-slate-50);
}

.config-title {
  font-size: 0.7rem;
  text-transform: uppercase;
  color: var(--p-slate-400);
  font-weight: 600;
  letter-spacing: 0.04em;
}

.config-chevron {
  font-size: 0.55rem;
  color: var(--p-slate-400);
  transition: transform 0.2s ease;
}

.config-chevron--open {
  transform: rotate(180deg);
}

.config-body {
  padding: 0 0.75rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.config-label {
  font-size: 0.775rem;
  color: var(--p-slate-600);
}

.config-input {
  width: 3.5rem;
  text-align: center;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.25rem;
  padding: 0.2rem 0.3rem;
  font-size: 0.775rem;
  color: var(--p-slate-700);
  outline: none;
  background: white;
}

.config-input:focus {
  border-color: var(--p-blue-400);
}

.config-toggle {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
  accent-color: var(--p-blue-500);
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
</style>
