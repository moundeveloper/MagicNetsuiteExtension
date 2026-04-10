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
          <div v-if="messages.length === 0" class="empty-state">
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
              <circle cx="18" cy="18" r="18" fill="var(--p-slate-100)" />
              <path
                d="M11 18c0-3.866 3.134-7 7-7s7 3.134 7 7"
                stroke="var(--p-slate-400)"
                stroke-width="1.5"
                stroke-linecap="round"
              />
              <circle cx="18" cy="18" r="2.5" fill="var(--p-slate-400)" />
            </svg>
            <p class="empty-title">How can I help you?</p>
            <p class="empty-sub">Type a message below to start.</p>
          </div>

          <div v-else class="message-list" ref="messageListRef">
            <template v-for="msg in messages" :key="msg.id">
              <div v-if="msg.role === 'user'" class="row row-user">
                <div class="bubble bubble-user">{{ msg.content }}</div>
              </div>

              <div
                v-else-if="msg.role === 'assistant'"
                class="row row-assistant"
              >
                <div class="avatar">
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <circle cx="9" cy="9" r="9" fill="var(--p-blue-100)" />
                    <circle cx="9" cy="9" r="3.5" fill="var(--p-blue-500)" />
                  </svg>
                </div>
                <div class="bubble bubble-assistant">
                  <span v-if="msg.isStreaming && !msg.content" class="dots">
                    <span /><span /><span />
                  </span>
                  <MessageContentRenderer v-else :content="msg.content" />

                  <!-- Grouped tool executions -->
                  <template
                    v-if="
                      getToolMessagesForAssistant(msg.id).length > 0 ||
                      (msg.isStreaming &&
                        msg.id === currentAssistantMsgId &&
                        inProgressTools.filter((t) => t.status === 'running')
                          .length > 0)
                    "
                  >
                    <details
                      class="tool-execution"
                      :open="
                        activeTools.length > 0 ||
                        inProgressTools.filter((t) => t.status === 'running')
                          .length > 0
                      "
                    >
                      <summary class="tool-execution-summary">
                        <i
                          :class="
                            activeTools.length > 0 ||
                            inProgressTools.filter(
                              (t) => t.status === 'running'
                            ).length > 0
                              ? 'pi pi-spin pi-spinner'
                              : 'pi pi-check-circle'
                          "
                        />
                        <span>
                          <template
                            v-if="
                              msg.isStreaming &&
                              msg.id === currentAssistantMsgId &&
                              inProgressTools.filter(
                                (t) => t.status === 'running'
                              ).length > 0
                            "
                            >Running
                            {{
                              inProgressTools.filter(
                                (t) => t.status === "running"
                              ).length
                            }}
                            tool{{
                              inProgressTools.filter(
                                (t) => t.status === "running"
                              ).length > 1
                                ? "s"
                                : ""
                            }}...</template
                          >
                          <template v-else
                            >Tool{{
                              getToolMessagesForAssistant(msg.id).length > 1
                                ? "s"
                                : ""
                            }}:
                            {{
                              getToolMessagesForAssistant(msg.id)
                                .map((m) => m.toolName)
                                .join(", ")
                            }}</template
                          >
                        </span>
                      </summary>
                      <div class="tool-results">
                        <!-- While streaming: show only running tools -->
                        <template
                          v-if="
                            msg.isStreaming &&
                            msg.id === currentAssistantMsgId &&
                            inProgressTools.filter(
                              (t) => t.status === 'running'
                            ).length > 0
                          "
                        >
                          <div
                            v-for="tm in inProgressTools.filter(
                              (t) => t.status === 'running'
                            )"
                            :key="'running-' + tm.name"
                            class="tool-result-item"
                          >
                            <span class="tool-name">{{ tm.name }}</span>
                            <span class="tool-sep">›</span>
                            <span class="tool-result tool-running">
                              <i
                                class="pi pi-spin pi-spinner"
                                style="font-size: 10px"
                              />
                              Running...
                            </span>
                          </div>
                        </template>
                        <!-- After streaming: show completed tools -->
                        <template v-else>
                          <div
                            v-for="tm in getToolMessagesForAssistant(msg.id)"
                            :key="tm.id"
                            class="tool-result-item"
                          >
                            <span class="tool-name">{{ tm.toolName }}</span>
                            <span class="tool-sep">›</span>
                            <span class="tool-result">{{ tm.content }}</span>
                          </div>
                        </template>
                      </div>
                    </details>
                  </template>
                </div>
              </div>
            </template>

            <div
              v-if="loading && messages[messages.length - 1]?.role === 'user'"
              class="row row-assistant"
            >
              <div class="avatar">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <circle cx="9" cy="9" r="9" fill="var(--p-blue-100)" />
                  <circle cx="9" cy="9" r="3.5" fill="var(--p-blue-500)" />
                </svg>
              </div>
              <div class="bubble bubble-assistant">
                <span class="dots"><span /><span /><span /></span>
              </div>
            </div>
          </div>

          <!-- Error banner -->
          <div v-if="agent.error.value" class="error-banner">
            <i class="pi pi-exclamation-circle" />
            {{ String(agent.error.value) }}
          </div>

          <!-- Input row -->
          <div class="input-row">
            <textarea
              ref="textareaRef"
              v-model="prompt"
              placeholder="Message…"
              rows="1"
              class="chat-input"
              :disabled="loading"
              @keydown.enter.exact.prevent="sendMessage"
              @input="autoResize"
            />
            <Button
              icon="pi pi-send"
              :loading="loading"
              :disabled="!prompt.trim() || loading"
              @click="sendMessage"
              label=""
              class="send-btn"
            />
          </div>
        </div>
      </template>
    </MCard>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from "vue";
import ViewHeader from "../components/ViewHeader.vue";
import MCard from "../components/universal/card/MCard.vue";
import Button from "primevue/button";
import { useAgent } from "../composables/useAgent";
import ExpandableSidebar from "../components/universal/sidebar/MExpandableSidebar.vue";
import MessageContentRenderer from "../components/MessageContentRenderer.vue";
import { tools } from "../utils/toolManager";

const STORAGE_KEY = "aiAssistantChatHistory";

interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  isStreaming?: boolean;
  isRunning?: boolean;
}

interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

const props = defineProps<{ vhOffset: number }>();

const agent = useAgent({
  systemPrompt: `You are a helpful assistant that provides well-structured, expressive responses.
If the task is complex or requires multiple steps, break it down into smaller, more manageable tasks.
Before commiting to answer and using tools, make a plan of the tools you need to use and only use the tools you need to answer the question.
Use the following markdown features to make your responses more expressive:

1. **Callout Boxes**: Use for warnings, tips, notes, errors:
\`\`\`
:::tip
ful tip here
:::

:::warning Warning message
:::

:::error
Error details
:::

:::info Info message
:::

:::note Custom Title
Note content
:::

2. **Collapsible Sections**: Use ??? for expandable content
\`\`\`
??? Details Title
Hidden content here
???
\`\`\`

3. **Tables**: Use proper markdown tables
\`\`\`
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
\`\`\`

4. **Checkboxes**: Use for lists with checkboxes
\`\`\`
- [x] Completed item
- [ ] Pending item
\`\`\`

5. **Code Blocks**: Use fenced code blocks with language
\`\`\`javascript
const example = "code";
\`\`\`

Keep responses concise but well-structured. Use these elements to organize complex information.`,
  tools,
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

const saveChatHistory = () => {
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
    saveActiveChatId();
    scrollToBottom();
  }
};

const deleteChat = (chatId: string) => {
  chatHistory.value = chatHistory.value.filter((c) => c.id !== chatId);

  if (activeChatId.value === chatId) {
    messages.value = [];
    activeChatId.value = "";
  }

  saveChatHistory();
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
  return str.length > n ? str.slice(0, n) + "…" : str;
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
    assistantMsg.content = "An error occurred. Check the console for details.";
    assistantMsg.isStreaming = false;
    console.error(e);
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

/* ── Message area ── */
.message-area {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  color: var(--p-slate-400);
}
.empty-title {
  font-size: 1rem;
  font-weight: 500;
  color: var(--p-slate-600);
  margin: 0.5rem 0 0;
}
.empty-sub {
  font-size: 0.8125rem;
  margin: 0;
}

.message-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  scroll-behavior: smooth;
}

/* ── Rows ── */
.row {
  display: flex;
  width: 100%;
  gap: 0.625rem;
  align-items: flex-start;
}
.row-user {
  justify-content: flex-end;
}
.row-assistant {
  justify-content: flex-start;
}
.row-tool {
  justify-content: flex-start;
  padding-left: 1.75rem;
}

/* ── Avatar ── */
.avatar {
  flex-shrink: 0;
  margin-top: 3px;
}

/* ── Bubbles ── */
.bubble {
  width: 100%;
  padding: 0.5rem 0.875rem;
  font-size: 0.9rem;
  line-height: 1.65;
  border-radius: 1rem;
  word-break: break-word;
}
.bubble-user {
  background: var(--p-blue-50);
  border: 1px solid var(--p-blue-100);
  color: var(--p-slate-800);
  border-bottom-right-radius: 4px;
  text-align: right;
}
.bubble-assistant {
  background: var(--p-slate-50);
  border: 1px solid var(--p-slate-200);
  color: var(--p-slate-800);
  border-bottom-left-radius: 4px;
}
.bubble-assistant :deep(code) {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.8rem;
  background: var(--p-slate-100);
  padding: 1px 5px;
  border-radius: 4px;
}

/* ── Tool pill ── */
.tool-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  color: var(--p-slate-500);
  background: var(--p-slate-50);
  border: 1px solid var(--p-slate-200);
  border-radius: 100px;
  padding: 3px 10px;
  max-width: 100%;
  overflow: hidden;
}
.tool-name {
  font-weight: 600;
  color: var(--p-slate-700);
}
.tool-sep {
  opacity: 0.4;
}
.tool-result {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Typing dots ── */
.dots {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}
.dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--p-slate-400);
  animation: bounce 1.2s infinite ease-in-out;
}
.dots span:nth-child(2) {
  animation-delay: 0.2s;
}
.dots span:nth-child(3) {
  animation-delay: 0.4s;
}
@keyframes bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  40% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

/* ── Error banner ── */
.error-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--p-red-50);
  border-top: 1px solid var(--p-red-200);
  color: var(--p-red-700);
  font-size: 0.8125rem;
}

/* ── Tool status ── */
.tool-status {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 1rem;
  font-size: 0.75rem;
  color: var(--p-slate-500);
  border-top: 1px solid var(--p-slate-100);
}
.tool-status strong {
  color: var(--p-slate-700);
}

/* ── In-progress tools ── */
.in-progress-tools {
  border-top: 1px solid var(--p-slate-100);
}

/* ── Grouped tool execution ── */
.bubble-assistant :deep(.tool-execution) {
  margin-top: 0.75rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.5rem;
  overflow: hidden;
}

.bubble-assistant :deep(.tool-execution-summary) {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: var(--p-slate-100);
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--p-slate-700);
}

.bubble-assistant :deep(.tool-execution-summary:hover) {
  background: var(--p-slate-200);
}

.bubble-assistant :deep(.tool-execution-summary i) {
  font-size: 0.75rem;
  opacity: 0.7;
}

.bubble-assistant :deep(.tool-results) {
  padding: 0.5rem 0.75rem;
  background: var(--p-slate-50);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.bubble-assistant :deep(.tool-result-item) {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.75rem;
  line-height: 1.4;
}

.bubble-assistant :deep(.tool-result-item .tool-name) {
  font-weight: 600;
  color: var(--p-slate-700);
  white-space: nowrap;
}

.bubble-assistant :deep(.tool-result-item .tool-sep) {
  opacity: 0.4;
}

.bubble-assistant :deep(.tool-result-item .tool-result) {
  color: var(--p-slate-600);
  word-break: break-word;
}

.bubble-assistant :deep(.tool-result-item .tool-result.tool-running) {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--p-blue-600);
  font-style: italic;
}

/* ── Input row ── */
.input-row {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
  padding: 0.875rem 1rem 0.875rem;
  border-top: 1px solid var(--p-slate-200);
}

.chat-input {
  flex: 1;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-family: inherit;
  font-size: 0.9rem;
  color: var(--p-slate-800);
  background: var(--p-slate-50);
  resize: none;
  outline: none;
  max-height: 160px;
  overflow-y: auto;
  transition: border-color 0.15s;
  line-height: 1.5;
}

.chat-input {
  overflow: auto;
  scrollbar-width: none;
}

.chat-input::-webkit-scrollbar {
  display: none;
}
.chat-input:focus {
  border-color: var(--p-blue-400);
  background: #fff;
}
.chat-input::placeholder {
  color: var(--p-slate-400);
}
.chat-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.send-btn {
  flex-shrink: 0;
  height: 2.25rem !important;
  width: 2.25rem !important;
  padding: 0 !important;
}

/* ── Chat Area ── */
.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
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
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-slate-700);
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.chat-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background 0.15s ease;
}

.chat-item:hover {
  background: var(--p-slate-200);
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
  gap: 2px;
}

.chat-title {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--p-slate-700);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-date {
  font-size: 0.6875rem;
  color: var(--p-slate-500);
}

.chat-delete-btn {
  opacity: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  background: transparent;
  border: none;
  border-radius: 0.25rem;
  color: var(--p-slate-500);
  cursor: pointer;
  transition: all 0.15s ease;
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
  color: var(--p-slate-500);
  font-size: 0.8125rem;
  text-align: center;
}

/* ── Markdown typography ── */
.bubble-assistant :deep(p) {
  margin: 0 0 0.6rem;
  line-height: 1.7;
}
.bubble-assistant :deep(p:last-child) {
  margin-bottom: 0;
}
.bubble-assistant :deep(h1),
.bubble-assistant :deep(h2),
.bubble-assistant :deep(h3) {
  font-weight: 600;
  color: var(--p-slate-900);
  margin: 0.75rem 0 0.35rem;
  line-height: 1.3;
}
.bubble-assistant :deep(h1) {
  font-size: 1.1rem;
}
.bubble-assistant :deep(h2) {
  font-size: 1rem;
}
.bubble-assistant :deep(h3) {
  font-size: 0.9375rem;
}

.bubble-assistant :deep(ul),
.bubble-assistant :deep(ol) {
  margin: 0.4rem 0 0.6rem;
  padding-left: 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.bubble-assistant :deep(li) {
  line-height: 1.65;
  color: var(--p-slate-700);
}
.bubble-assistant :deep(ul > li) {
  list-style-type: disc;
}
.bubble-assistant :deep(ol > li) {
  list-style-type: decimal;
}

/* Nested list indent */
.bubble-assistant :deep(li > ul),
.bubble-assistant :deep(li > ol) {
  margin: 0.2rem 0 0;
  padding-left: 1.1rem;
}
.bubble-assistant :deep(li > ul > li) {
  list-style-type: circle;
  color: var(--p-slate-500);
}

.bubble-assistant :deep(strong) {
  font-weight: 600;
  color: var(--p-slate-900);
}
.bubble-assistant :deep(em) {
  font-style: italic;
  color: var(--p-slate-600);
}
.bubble-assistant :deep(blockquote) {
  border-left: 3px solid var(--p-blue-200);
  margin: 0.5rem 0;
  padding: 0.25rem 0.75rem;
  color: var(--p-slate-500);
  font-style: italic;
}
.bubble-assistant :deep(hr) {
  border: none;
  border-top: 1px solid var(--p-slate-200);
  margin: 0.75rem 0;
}

/* Callout boxes */
.bubble-assistant :deep(.callout) {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  margin: 0.6rem 0;
  border-radius: 0.5rem;
  background: var(--callout-bg);
  border: 1px solid var(--callout-color);
  border-left-width: 4px;
}

.bubble-assistant :deep(.callout-icon) {
  flex-shrink: 0;
  font-size: 1rem;
}

.bubble-assistant :deep(.callout-content) {
  flex: 1;
}

.bubble-assistant :deep(.callout-title) {
  font-weight: 600;
  color: var(--callout-color);
  margin-bottom: 0.25rem;
}

/* Collapsible sections */
.bubble-assistant :deep(details.collapsible) {
  margin: 0.6rem 0;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.5rem;
  overflow: hidden;
}

.bubble-assistant :deep(details.collapsible summary) {
  padding: 0.6rem 1rem;
  background: var(--p-slate-100);
  cursor: pointer;
  font-weight: 500;
  color: var(--p-slate-700);
  list-style: none;
}

.bubble-assistant :deep(details.collapsible summary::-webkit-details-marker) {
  display: none;
}

.bubble-assistant :deep(details.collapsible summary::before) {
  content: "▶";
  display: inline-block;
  margin-right: 0.5rem;
  font-size: 0.7rem;
  transition: transform 0.2s;
}

.bubble-assistant :deep(details.collapsible[open] summary::before) {
  transform: rotate(90deg);
}

.bubble-assistant :deep(.collapsible-content) {
  padding: 0.75rem 1rem;
  background: #fff;
  border-top: 1px solid var(--p-slate-100);
}

/* Tables */
.bubble-assistant :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.6rem 0;
  font-size: 0.85rem;
}

.bubble-assistant :deep(.md-table th),
.bubble-assistant :deep(.md-table td) {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--p-slate-200);
  text-align: left;
}

.bubble-assistant :deep(.md-table th) {
  background: var(--p-slate-100);
  font-weight: 600;
  color: var(--p-slate-700);
}

.bubble-assistant :deep(.md-table tr:nth-child(even) td) {
  background: var(--p-slate-50);
}

/* Checkboxes */
.bubble-assistant :deep(.checkbox-wrapper) {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0.25rem 0;
  cursor: default;
}

.bubble-assistant :deep(.checkbox-wrapper input) {
  margin-top: 0.3rem;
  accent-color: var(--p-blue-500);
}

.bubble-assistant :deep(.checkbox-label) {
  line-height: 1.5;
  color: var(--p-slate-700);
}

/* Enhanced code blocks */
.bubble-assistant :deep(.code-block) {
  margin: 0.6rem 0;
  border-radius: 0.5rem;
  overflow: hidden;
  border: 1px solid var(--p-slate-200);
}

.bubble-assistant :deep(.code-header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.35rem 0.75rem;
  background: var(--p-slate-100);
  border-bottom: 1px solid var(--p-slate-200);
}

.bubble-assistant :deep(.code-lang) {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--p-slate-500);
  letter-spacing: 0.5px;
}

.bubble-assistant :deep(.code-copy) {
  font-size: 0.7rem;
  padding: 0.2rem 0.5rem;
  background: var(--p-slate-200);
  border: none;
  border-radius: 0.25rem;
  cursor: pointer;
  color: var(--p-slate-600);
  transition: background 0.15s;
}

.bubble-assistant :deep(.code-copy:hover) {
  background: var(--p-slate-300);
}

.bubble-assistant :deep(.code-block pre) {
  margin: 0;
  padding: 0.75rem;
  background: var(--p-slate-900);
  overflow-x: auto;
}

.bubble-assistant :deep(.code-block code) {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.8rem;
  color: #e2e8f0;
  background: transparent !important;
  padding: 0;
}
</style>
