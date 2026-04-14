<template>
  <div class="ai-assistant-view">
    <ViewHeader />

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
            <template v-for="msg in messages" :key="msg.id">
              <!-- Compaction indicator -->
              <div v-if="msg.role === 'compaction'" class="msg msg-compaction">
                <details class="compaction-details">
                  <summary class="compaction-summary">
                    <i class="pi pi-bolt compaction-icon" />
                    <span>
                      Context compacted — {{ msg.compactedCount }} earlier messages summarized
                    </span>
                    <i class="pi pi-chevron-down compaction-chevron" />
                  </summary>
                  <div class="compaction-content">
                    <MessageContentRenderer :content="msg.content" />
                  </div>
                </details>
              </div>

              <!-- User message -->
              <div v-else-if="msg.role === 'user'" class="msg msg-user">
                <div class="msg-user-content">{{ msg.content }}</div>
              </div>

              <!-- Assistant message -->
              <div v-else-if="msg.role === 'assistant'" class="msg msg-assistant">
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
                          {{ getSkillMessagesForAssistant(msg.id).filter(m => m.toolName === 'load_skill').length }}
                          skill{{
                            getSkillMessagesForAssistant(msg.id).filter(m => m.toolName === 'load_skill').length > 1
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
                    <div
                      v-for="tm in inProgressTools.filter(
                        (t) => t.status === 'running' && !isSkillTool(t.name)
                      )"
                      :key="'running-' + tm.name"
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

            <!-- Standalone loading indicator when waiting for first response -->
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
          <div v-if="agent.error.value" class="error-banner">
            <i class="pi pi-exclamation-triangle" />
            <span>{{ String(agent.error.value) }}</span>
          </div>

          <!-- Input wrapper (bg + border) -->
          <div class="input-wrapper">
            <div class="chat-toolbar">
              <span v-if="tokenCounterLabel" :class="tokenCounterClass">
                <i class="pi pi-database" style="font-size:0.6rem" />
                {{ tokenCounterLabel }} tokens
              </span>
            </div>
            <div class="input-row">
              <textarea
              ref="textareaRef"
              v-model="prompt"
              placeholder="Message..."
              rows="1"
              class="chat-input"
              :disabled="loading"
              @keydown.enter.exact.prevent="sendMessage"
              @input="autoResize"
            />
            <button
              class="send-btn"
              :disabled="!prompt.trim() || loading"
              @click="sendMessage"
            >
              <i v-if="loading" class="pi pi-spin pi-spinner" />
              <i v-else class="pi pi-arrow-up" />
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
          The conversation context is getting large
          (<strong>~{{ (compactionApprovalTokens / 1000).toFixed(1) }}k</strong> /
          {{ (compactionApprovalThreshold / 1000).toFixed(0) }}k tokens).
        </p>
        <p>
          Compact earlier messages into a summary to free up context space?
          The summary will be kept in the conversation.
        </p>
      </div>
      <div class="compaction-dialog-actions">
        <button class="compaction-btn compaction-btn--skip" @click="handleCompactionReject">
          Skip
        </button>
        <button class="compaction-btn compaction-btn--compact" @click="handleCompactionApprove">
          <i class="pi pi-bolt" />
          Compact
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, onMounted, computed } from "vue";
import ViewHeader from "../components/ViewHeader.vue";
import MCard from "../components/universal/card/MCard.vue";
import Button from "primevue/button";
import { useAgent, ToolRejectedError } from "../composables/useAgent";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MessageContentRenderer from "../components/MessageContentRenderer.vue";
import ToolApprovalDialog from "../components/ToolApprovalDialog.vue";
import { tools } from "../utils/toolManager";
import { skillTools } from "../utils/skillSearchTools";
import { useSettings } from "../states/settingsState";

const STORAGE_KEY = "aiAssistantChatHistory";

const { settings } = useSettings();

interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "tool" | "compaction";
  content: string;
  toolName?: string;
  isStreaming?: boolean;
  isRunning?: boolean;
  compactedCount?: number;
}

interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

const props = defineProps<{ vhOffset: number }>();

// ── Tool approval state ──
const approvalVisible = ref(false);
const approvalToolName = ref("");
const approvalToolInput = ref<unknown>(null);
let approvalResolve: ((approved: boolean) => void) | null = null;

const requestToolApproval = (name: string, input: unknown): Promise<boolean> => {
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

const requestCompactionApproval = (tokenEstimate: number, threshold: number): Promise<boolean> => {
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

const agent = useAgent({
  systemPrompt: `You are a helpful assistant that provides well-structured, expressive responses.

## Tool Usage Rules
- **Plan first**: Before calling any tool, decide the minimal set of tools needed. State your plan briefly.
- **Never repeat a tool call** if you already have its result in the conversation. Re-read previous tool results instead of calling the same tool again with the same or similar parameters.
- **Chain tools efficiently**: When one tool's output provides IDs needed by another tool, extract the IDs from the result you already have and pass them directly. For example, use netsuite_get_scripts once to find scripts, then pass the numeric \`id\` values from those results straight into netsuite_get_script_files — do NOT call netsuite_get_scripts again.
- **One call per data need**: If a single tool call can answer your question, do not make additional calls. If you need to filter results, do it yourself from the data you already received.
- **Stop when you have enough data**: Once you have the information needed to answer the user, stop calling tools and respond immediately.

## Skills Library
You have access to a local skill library containing specialized knowledge, instructions, code patterns, coding standards, and documentation. Skill rules **override your default knowledge** when applicable.

**MANDATORY RULE: Before writing ANY code, you MUST call \`search_skills\` first — no exceptions.**
This includes: writing scripts, creating suitelets, generating examples, modifying existing code, debugging, scaffolding, or producing any code snippet of any length.

**When NOT to use skills (do NOT call \`search_skills\`):**
- Retrieving or displaying existing scripts, files, or records from the environment
- Answering questions that require no code output
- Navigating the codebase or listing resources

**Workflow for any code-writing task:**
1. **Always call \`search_skills\` first** with keywords describing the code you are about to write (e.g. "suitelet", "search", "record", "deployment"). Do this before planning, before drafting, before anything else.
2. Inspect returned skill names and descriptions. Call \`load_skill\` for every skill whose description is relevant to the task.
3. Apply all rules from loaded skills. Skills take priority over your built-in defaults.
4. Only generate code AFTER loading applicable skills.
5. Do NOT load all skills at once — only load what is relevant.

## Context Compaction
When the conversation gets long, older context may be automatically compacted into a summary. If you see a "[Context Summary]" system message, treat it as authoritative prior context — it contains the key facts, decisions, and data from earlier in the conversation. Do NOT ask the user to repeat information that was compacted.

## Response Formatting
Format your responses using standard markdown:

- Use **bold** and *italic* for emphasis
- Use headings (##, ###) to organize sections
- Use bullet lists and numbered lists for sequential or grouped items
- Use \`inline code\` for identifiers, field names, script IDs
- Use fenced code blocks with language tags for code snippets
- Use tables when presenting structured data
- Use blockquotes for important notes or callouts

Keep responses concise and well-structured. Prefer flat, scannable layouts over deeply nested content.`,
  tools: [...tools, ...skillTools],
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
      timestamp: Date.now()
    });
    scrollToBottom();
  },
  onToolResult(name, result) {
    activeTools.value = activeTools.value.filter((t) => t !== name);
    const toolIndex = inProgressTools.value.findIndex((t) => t.name === name);
    if (toolIndex !== -1) {
      inProgressTools.value.splice(toolIndex, 1);
    }
  }
});

const { loading } = agent;
const contextTokens = agent.contextTokens;

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
  const threshK = (settings.compactionThreshold / 1000).toFixed(settings.compactionThreshold >= 10000 ? 0 : 1);
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
const messageListRef = ref<HTMLElement | null>(null);
const activeTools = ref<string[]>([]);

interface InProgressTool {
  name: string;
  input: unknown;
  status: "running" | "done";
  result?: string;
  timestamp: number;
}

const inProgressTools = ref<InProgressTool[]>([]);
const currentAssistantMsgId = ref<number>(0);

const chatHistory = ref<Chat[]>([]);
const activeChatId = ref<string>("");
const isRestoring = ref(true);

const generateChatId = () => "chat_" + Date.now();

const getFirstUserMessage = (msgs: ChatMessage[]) => {
  const firstUser = msgs.find((m) => m.role === "user");
  return firstUser ? firstUser.content.slice(0, 50) : "New Chat";
};

let saveChatDebounceTimer: ReturnType<typeof setTimeout> | null = null;

const saveChatHistoryImmediate = () => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;

  const historyToSave = chatHistory.value;

  chrome.storage.local.set(
    {
      [STORAGE_KEY]: historyToSave
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error("Failed to save chat history:", chrome.runtime.lastError);
      }
    }
  );
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
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;

  chrome.storage.local.set({
    aiAssistantActiveChatId: activeChatId.value
  });
};

const loadChatHistory = () => {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    isRestoring.value = false;
    return;
  }

  chrome.storage.local.get(
    [STORAGE_KEY, "aiAssistantActiveChatId"],
    (result) => {
      try {
        let history: Chat[] = [];

        const rawHistory = result[STORAGE_KEY];

        if (Array.isArray(rawHistory)) {
          history = rawHistory;
        } else if (rawHistory && typeof rawHistory === "object") {
          history = Object.values(rawHistory);
        }

        chatHistory.value = history.map((chat) => ({
          ...chat,
          messages: Array.isArray(chat.messages)
            ? chat.messages
            : Object.values(chat.messages || {})
        }));

        const activeId = result.aiAssistantActiveChatId;
        if (typeof activeId === "string" && activeId) {
          const chat = chatHistory.value.find((c) => c.id === activeId);
          if (chat) {
            activeChatId.value = activeId;
            messages.value = chat.messages;
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
    }
  );
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
  scrollToBottom();
};

const normalizeMessages = (msgs: unknown): ChatMessage[] => {
  if (Array.isArray(msgs)) return msgs;
  if (msgs && typeof msgs === "object") return Object.values(msgs);
  return [];
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
    messages.value = Array.isArray(chat.messages)
      ? [...chat.messages]
      : Object.values(chat.messages || {});
    agent.clearHistory();
    rebuildToolMessageMap();
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
  }

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
});

const truncate = (str: string, n: number) => {
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
    (m) => !isSkillTool(m.toolName)
  );
};

const getSkillDisplayName = (toolName: string): string => {
  if (toolName === "search_skills") return "Searching skills";
  if (toolName === "load_skill") return "Loading skill";
  return toolName;
};

const autoResize = () => {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
};

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

// Watch for new tool messages and link them to the last assistant message
watch(
  agent.history,
  () => {
    const toolMsgs = agent.history.value.filter((m) => m.role === "tool");
    for (const tm of toolMsgs) {
      const exists = messages.value.some(
        (m) =>
          m.role === "tool" &&
          m.toolName === tm.toolName &&
          m.content === tm.content
      );
      if (!exists) {
        // Find the last assistant message to link this tool to
        const lastAssistant = messages.value
          .slice()
          .reverse()
          .find((m) => m.role === "assistant");

        const newToolMsg: ChatMessage = {
          id: Date.now() + Math.random(),
          role: "tool",
          content: tm.content,
          toolName: tm.toolName
        };

        messages.value.push(newToolMsg);

        if (lastAssistant) {
          toolMessageToAssistant.value.set(newToolMsg.id, lastAssistant.id);
        }

        scrollToBottom();
      }
    }
  },
  { deep: true }
);

const sendMessage = async () => {
  const text = prompt.value.trim();
  if (!text || loading.value) return;

  inProgressTools.value = [];
  prompt.value = "";
  if (textareaRef.value) textareaRef.value.style.height = "auto";

  const userMsg: ChatMessage = {
    id: Date.now() + Math.random(),
    role: "user",
    content: text
  };
  messages.value.push(userMsg);
  await scrollToBottom();

  const assistantMsg: ChatMessage = {
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
    const finalText = await agent.run(text, { maxIterations: 6 });
    assistantMsg.content =
      typeof finalText === "string"
        ? finalText
        : JSON.stringify(finalText, null, 2);
    assistantMsg.isStreaming = false;
    messages.value = [...messages.value];

    inProgressTools.value = [];
    activeTools.value = [];
    currentAssistantMsgId.value = 0;

    autoSaveCurrentChat();
  } catch (e) {
    if (e instanceof ToolRejectedError) {
      assistantMsg.content = `⛔ Stopped — tool **\`${e.toolName}\`** was rejected.`;
    } else {
      assistantMsg.content = "An error occurred. Check the console for details.";
      console.error(e);
    }
    assistantMsg.isStreaming = false;
    messages.value = [...messages.value];

    inProgressTools.value = [];
    activeTools.value = [];
    currentAssistantMsgId.value = 0;

    autoSaveCurrentChat();
  } finally {
    await scrollToBottom();
  }
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
  resize: none;
  outline: none;
  max-height: 160px;
  overflow-y: auto;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  line-height: 1.5;
  scrollbar-width: none;
}

.chat-input::-webkit-scrollbar {
  display: none;
}

.chat-input:focus {
  border-color: var(--p-blue-400);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-blue-400) 15%, transparent);
}

.chat-input::placeholder {
  color: var(--p-slate-400);
}

.chat-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease;
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
</style>
