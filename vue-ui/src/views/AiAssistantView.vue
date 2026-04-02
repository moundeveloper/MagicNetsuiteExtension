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
                  <span v-else v-html="renderMarkdown(msg.content)" />
                </div>
              </div>

              <div v-else-if="msg.role === 'tool'" class="row row-tool">
                <div class="tool-pill">
                  <i class="pi pi-cog" style="font-size: 11px" />
                  <span class="tool-name">{{ msg.toolName }}</span>
                  <span class="tool-sep">›</span>
                  <span class="tool-result">{{
                    truncate(msg.content, 80)
                  }}</span>
                </div>
              </div>
            </template>

            <div
              v-if="
                loading && messages[messages.length - 1]?.role !== 'assistant'
              "
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

          <!-- Active tool status -->
          <div v-if="activeTools.length" class="tool-status">
            <i class="pi pi-spin pi-spinner" style="font-size: 12px" />
            Running tool: <strong>{{ activeTools.join(", ") }}</strong>
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

const STORAGE_KEY = "aiAssistantChatHistory";

interface ChatMessage {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  isStreaming?: boolean;
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
  systemPrompt:
    "You are a helpful, concise assistant. Use markdown for code and lists where appropriate.",
  tools: [
    {
      name: "calculate",
      description:
        "Evaluates a safe mathematical expression and returns the result.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "JS-safe math expression" }
        },
        required: ["expression"]
      },
      execute: (input: Record<string, unknown>) => {
        try {
          const expr = String(input.expression)
            .replace(/×/g, "*")
            .replace(/÷/g, "/")
            .replace(/−/g, "-") // Unicode minus sign U+2212
            .replace(/\^/g, "**"); // optional: support ^ as power operator
          const result = Function(`"use strict"; return (${expr})`)();
          return { result };
        } catch {
          return { error: "Invalid expression" };
        }
      }
    }
  ],
  onToolCall(name) {
    activeTools.value.push(name);
  },
  onToolResult(name) {
    activeTools.value = activeTools.value.filter((t) => t !== name);
  }
});

const { loading } = agent;

const messages = ref<ChatMessage[]>([]);
const prompt = ref("");
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const messageListRef = ref<HTMLElement | null>(null);
const activeTools = ref<string[]>([]);

const chatHistory = ref<Chat[]>([]);
const activeChatId = ref<string>("");
const isRestoring = ref(true);

function generateChatId() {
  return "chat_" + Date.now();
}

function getFirstUserMessage(msgs: ChatMessage[]) {
  const firstUser = msgs.find((m) => m.role === "user");
  return firstUser ? firstUser.content.slice(0, 50) : "New Chat";
}

function saveChatHistory() {
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
}

function saveActiveChatId() {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;

  chrome.storage.local.set({
    aiAssistantActiveChatId: activeChatId.value
  });
}

function loadChatHistory() {
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
          }
        }
      } catch (error) {
        console.error("Failed to load chat history:", error);
        chatHistory.value = [];
      }

      isRestoring.value = false;
    }
  );
}

function createNewChat() {
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
}

const normalizeMessages = (msgs: unknown): ChatMessage[] => {
  if (Array.isArray(msgs)) return msgs;
  if (msgs && typeof msgs === "object") return Object.values(msgs);
  return [];
};

function loadChat(chatId: string) {
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
}

function deleteChat(chatId: string) {
  chatHistory.value = chatHistory.value.filter((c) => c.id !== chatId);

  if (activeChatId.value === chatId) {
    messages.value = [];
    activeChatId.value = "";
  }

  saveChatHistory();
  saveActiveChatId();
}

function autoSaveCurrentChat() {
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
}

function formatDate(dateStr: string) {
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
}

onMounted(() => {
  loadChatHistory();
});

function truncate(str: string, n: number) {
  return str.length > n ? str.slice(0, n) + "…" : str;
}
function renderMarkdown(text: string) {
  return text
    .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
}
function autoResize() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}
async function scrollToBottom() {
  await nextTick();
  requestAnimationFrame(() => {
    const el = messageListRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

// Watch for new tool messages and append them after the last assistant message
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
        messages.value.push({
          id: Date.now() + Math.random(),
          role: "tool",
          content: tm.content,
          toolName: tm.toolName
        });
        scrollToBottom();
      }
    }
  },
  { deep: true }
);

async function sendMessage() {
  const text = prompt.value.trim();
  if (!text || loading.value) return;

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
  await scrollToBottom();

  try {
    const finalText = await agent.run(text, { maxIterations: 6 });
    assistantMsg.content = finalText;
    assistantMsg.isStreaming = false;
    messages.value = [...messages.value];

    autoSaveCurrentChat();
  } catch (e) {
    assistantMsg.content = "An error occurred. Check the console for details.";
    assistantMsg.isStreaming = false;
    console.error(e);
  } finally {
    await scrollToBottom();
  }
}
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
  max-width: 72%;
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
}
.bubble-assistant {
  background: var(--p-slate-50);
  border: 1px solid var(--p-slate-200);
  color: var(--p-slate-800);
  border-bottom-left-radius: 4px;
}
.bubble-assistant :deep(pre) {
  background: var(--p-slate-100);
  border: 1px solid var(--p-slate-200);
  border-radius: 0.4rem;
  padding: 0.5rem 0.75rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.8rem;
  overflow-x: auto;
  margin: 0.4rem 0;
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
</style>
