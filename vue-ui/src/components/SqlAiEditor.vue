<template>
  <div class="sql-ai-editor">
    <!-- Header bar -->
    <div class="sql-ai-header">
      <div class="sql-ai-header-left">
        <i class="pi pi-sparkles sql-ai-icon"></i>
        <span class="sql-ai-title">AI SQL Editor</span>
      </div>
      <div class="sql-ai-header-right">
        <span v-if="tokenCounterLabel" :class="tokenCounterClass">
          <i class="pi pi-database" style="font-size: 0.55rem" />
          {{ tokenCounterLabel }}
        </span>
        <button
          class="sql-ai-header-btn"
          @click="clearChat"
          title="Clear conversation"
        >
          <i class="pi pi-trash"></i>
        </button>
      </div>
    </div>

    <!-- Messages area -->
    <div class="sql-ai-messages" ref="messagesRef">
      <!-- Empty state -->
      <div v-if="messages.length === 0" class="sql-ai-empty">
        <i class="pi pi-sparkles sql-ai-empty-icon"></i>
        <p class="sql-ai-empty-title">SQL AI Assistant</p>
        <p class="sql-ai-empty-sub">
          Ask me to build a query, explain your SQL, or explore the schema.
        </p>
        <div class="sql-ai-suggestions">
          <button
            v-for="suggestion in suggestions"
            :key="suggestion"
            class="sql-ai-suggestion"
            @click="sendMessage(suggestion)"
          >
            {{ suggestion }}
          </button>
        </div>
      </div>

      <!-- Message thread -->
      <template v-for="msg in messages" :key="msg.id">
        <!-- User message -->
        <div v-if="msg.role === 'user'" class="sql-ai-msg sql-ai-msg-user">
          <div class="sql-ai-msg-user-content">{{ msg.content }}</div>
        </div>

        <!-- Assistant message -->
        <div
          v-else-if="msg.role === 'assistant'"
          class="sql-ai-msg sql-ai-msg-assistant"
        >
          <!-- Dynamic skills used -->
          <div
            v-if="getToolMessagesForAssistant(msg.id).length > 0"
            class="sql-ai-tools-group"
          >
            <details class="sql-ai-tools-details">
              <summary class="sql-ai-tools-summary">
                <i class="pi pi-bolt sql-ai-tools-icon" />
                <span>
                  Used
                  {{ getToolMessagesForAssistant(msg.id).length }}
                  dynamic skill{{
                    getToolMessagesForAssistant(msg.id).length > 1 ? "s" : ""
                  }}
                </span>
                <i class="pi pi-chevron-down sql-ai-tools-chevron" />
              </summary>
              <div class="sql-ai-tools-list">
                <div
                  v-for="tm in getToolMessagesForAssistant(msg.id)"
                  :key="tm.id"
                  class="sql-ai-tool-row"
                >
                  <span class="sql-ai-tool-name">{{ formatToolName(tm.toolName ?? "") }}</span>
                  <span class="sql-ai-tool-content">{{
                    truncate(tm.content, 150)
                  }}</span>
                </div>
              </div>
            </details>
          </div>

          <!-- Running tools indicator -->
          <div
            v-if="
              msg.isStreaming &&
              msg.id === currentAssistantMsgId &&
              runningTools.length > 0
            "
            class="sql-ai-tools-running"
          >
            <div
              v-for="tool in runningTools"
              :key="'running-' + tool.name"
              class="sql-ai-tool-running-item"
            >
              <span class="sql-ai-tool-spinner" />
              <span class="sql-ai-tool-running-label">{{ formatToolName(tool.name) }}</span>
            </div>
          </div>

          <!-- Query result preview -->
          <div
            v-if="msg.queryResult"
            class="sql-ai-query-result"
          >
            <div class="sql-ai-query-result-header">
              <i class="pi pi-table"></i>
              <span>Query Result Preview</span>
              <span class="sql-ai-query-result-count">
                {{ msg.queryResult.rowCount }} rows
                <template v-if="msg.queryResult.totalCount > msg.queryResult.rowCount">
                  of {{ msg.queryResult.totalCount }}
                </template>
              </span>
            </div>
            <div class="sql-ai-query-result-table-wrap">
              <table class="sql-ai-query-result-table">
                <thead>
                  <tr>
                    <th v-for="col in msg.queryResult.columns" :key="col">{{ col }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, idx) in msg.queryResult.results" :key="idx">
                    <td v-for="col in msg.queryResult.columns" :key="col">
                      {{ row[col] ?? "" }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Response content -->
          <div class="sql-ai-msg-assistant-content">
            <div
              v-if="msg.isStreaming && !msg.content"
              class="sql-ai-thinking"
            >
              <span class="sql-ai-thinking-dot" />
              <span class="sql-ai-thinking-dot" />
              <span class="sql-ai-thinking-dot" />
            </div>
            <MessageContentRenderer v-else :content="msg.content" />
          </div>
        </div>
      </template>

      <!-- Standalone loading -->
      <div
        v-if="loading && messages[messages.length - 1]?.role === 'user'"
        class="sql-ai-msg sql-ai-msg-assistant"
      >
        <div class="sql-ai-msg-assistant-content">
          <div class="sql-ai-thinking">
            <span class="sql-ai-thinking-dot" />
            <span class="sql-ai-thinking-dot" />
            <span class="sql-ai-thinking-dot" />
          </div>
        </div>
      </div>
    </div>

    <!-- Error banner -->
    <div v-if="agent.error.value" class="sql-ai-error">
      <i class="pi pi-exclamation-triangle" />
      <span>{{ String(agent.error.value) }}</span>
    </div>

    <!-- Input area -->
    <div class="sql-ai-input-wrapper">
      <div class="sql-ai-input-row">
        <textarea
          ref="textareaRef"
          v-model="prompt"
          placeholder="Ask about SQL, build a query..."
          rows="1"
          class="sql-ai-input"
          :disabled="loading"
          @keydown.enter.exact.prevent="handleSend"
          @input="autoResize"
        />
        <button
          v-if="loading"
          class="sql-ai-stop-btn"
          @click="stopAgent"
          title="Stop generation"
        >
          <i class="pi pi-stop-circle" />
        </button>
        <button
          v-else
          class="sql-ai-send-btn"
          :disabled="!prompt.trim()"
          @click="handleSend"
        >
          <i class="pi pi-arrow-up" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted } from "vue";
import { useAgent, type ToolDefinition } from "../composables/useAgent";
import MessageContentRenderer from "./MessageContentRenderer.vue";
import { createSqlAiTools } from "../utils/sqlAiTools";
import { useSettings } from "../states/settingsState";

const props = defineProps<{
  /** Returns the current SQL from the main editor */
  getEditorQuery: () => string;
}>();

const { settings } = useSettings();

// ── Types ──
interface SqlChatMessage {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  isStreaming?: boolean;
  queryResult?: {
    columns: string[];
    results: Record<string, unknown>[];
    rowCount: number;
    totalCount: number;
  };
}

interface RunningTool {
  name: string;
  input: unknown;
}

// ── Suggestions ──
const suggestions = [
  "What tables are related to customers?",
  "Build a query to get recent sales orders",
  "Show me the fields in the transaction table",
  "Help me join customer and transaction tables"
];

// ── State ──
const messages = ref<SqlChatMessage[]>([]);
const prompt = ref("");
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const messagesRef = ref<HTMLElement | null>(null);
const currentAssistantMsgId = ref(0);
const runningTools = ref<RunningTool[]>([]);
const toolMessageToAssistant = ref(new Map<number, number>());
let abortController: AbortController | null = null;

// ── SQL AI Tools with dynamic editor context ──
const sqlTools = createSqlAiTools();

// Override the sql_get_editor_query tool with live context
const editorQueryTool = sqlTools.find(
  (t) => t.name === "sql_get_editor_query"
);
if (editorQueryTool) {
  editorQueryTool.execute = async () => {
    const query = props.getEditorQuery();
    return query
      ? { query, note: "This is the current query in the main SQL editor (read-only)." }
      : { query: "", note: "The main editor is empty." };
  };
}

// Wrap sql_execute_query to capture results for inline display
const origExecuteQuery = sqlTools.find(
  (t) => t.name === "sql_execute_query"
)!.execute;
const executeQueryTool = sqlTools.find((t) => t.name === "sql_execute_query")!;
executeQueryTool.execute = async (input) => {
  const result = await origExecuteQuery(input);
  // Attach query result to the current assistant message for inline rendering
  const typedResult = result as {
    success?: boolean;
    columns?: string[];
    results?: Record<string, unknown>[];
    rowCount?: number;
    totalCount?: number;
  };
  if (typedResult.success && typedResult.results) {
    const lastAssistant = messages.value
      .slice()
      .reverse()
      .find((m) => m.role === "assistant");
    if (lastAssistant) {
      lastAssistant.queryResult = {
        columns: typedResult.columns ?? [],
        results: typedResult.results ?? [],
        rowCount: typedResult.rowCount ?? 0,
        totalCount: typedResult.totalCount ?? 0
      };
    }
  }
  return result;
};

// ── Agent setup ──
const agent = useAgent({
  systemPrompt: `You are a SuiteQL query builder assistant embedded in a SQL editor. Your job is to help users build, debug, and understand SuiteQL queries.

## Your Capabilities
You have access to dynamic skills that fetch live schema data from NetSuite:
- **sql_search_tables**: Search for available tables by keyword
- **sql_get_table_fields**: Get all columns for a specific table  
- **sql_get_table_joins**: Get available joins/relationships for a table
- **sql_execute_query**: Execute a query with LIMIT 5 to preview results
- **sql_get_editor_query**: Read the current query in the main editor (read-only)
- **sql_discover_field_values**: Sample DISTINCT real values for a column — use this before filtering on any text/string field to get the exact casing (e.g. 'COMPLETED' vs 'Completed')

## Dynamic Skills Workflow
When building a query, ALWAYS use this workflow:
1. Use \`sql_search_tables\` to find relevant tables
2. Use \`sql_get_table_fields\` to discover available columns
3. Use \`sql_get_table_joins\` if you need to join tables
4. For any WHERE clause on a text/string/status field, use \`sql_discover_field_values\` FIRST to discover real values before filtering
5. Build the query based on actual schema data and verified field values
6. Use \`sql_execute_query\` to test the query and verify results
7. If the query fails or returns unexpected data, analyze the error, adjust, and retry

## Important Rules
- You CANNOT modify the main editor query. You are read-only for the editor.
- All queries you build are executed in this AI panel with LIMIT 5 for preview.
- Always verify your queries work before presenting the final version.
- Use proper SuiteQL syntax (NetSuite's SQL dialect).
- When the user asks about the current query, use \`sql_get_editor_query\` first.
- ALWAYS use \`sql_discover_field_values\` before writing WHERE conditions on string fields — never guess the casing.
- Show the final query in a SQL code block so the user can copy it.
- Be concise — this is a side panel with limited space.

## Response Format
- Use markdown for formatting
- Put SQL in \`\`\`sql code blocks
- Keep responses short and focused`,
  tools: sqlTools,
  ephemeralTools: [],
  compactionThreshold: () => settings.compactionThreshold,
  onToolStart(name, input) {
    runningTools.value.push({ name, input });
    scrollToBottom();
  },
  onToolResult(name) {
    runningTools.value = runningTools.value.filter((t) => t.name !== name);
  }
});

const { loading } = agent;

// ── Token counter ──
const effectiveTokens = computed(() => agent.contextTokens.value);

const tokenCounterLabel = computed(() => {
  const t = effectiveTokens.value;
  if (t === 0) return null;
  return `~${(t / 1000).toFixed(1)}k`;
});

const tokenCounterClass = computed(() => {
  const ratio = effectiveTokens.value / settings.compactionThreshold;
  if (ratio >= 0.85) return "sql-ai-token-counter sql-ai-token-danger";
  if (ratio >= 0.6) return "sql-ai-token-counter sql-ai-token-warn";
  return "sql-ai-token-counter sql-ai-token-ok";
});

// ── Helpers ──
const scrollToBottom = async () => {
  await nextTick();
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
  }
};

const autoResize = () => {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
};

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}...` : text;

const formatToolName = (name: string) =>
  name
    .replace(/^sql_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const getToolMessagesForAssistant = (assistantId: number) =>
  messages.value.filter(
    (m) =>
      m.role === "tool" && toolMessageToAssistant.value.get(m.id) === assistantId
  );

// ── Send message ──
const handleSend = () => {
  const text = prompt.value.trim();
  if (!text || loading.value) return;
  sendMessage(text);
};

const sendMessage = async (text: string) => {
  prompt.value = "";
  nextTick(autoResize);

  // Add user message
  messages.value.push({
    id: Date.now(),
    role: "user",
    content: text
  });

  // Add streaming assistant placeholder
  const assistantId = Date.now() + 1;
  currentAssistantMsgId.value = assistantId;
  messages.value.push({
    id: assistantId,
    role: "assistant",
    content: "",
    isStreaming: true
  });

  scrollToBottom();

  try {
    abortController = new AbortController();
    const result = await agent.run(text, { maxIterations: 10 });

    // Update assistant message
    const assistantMsg = messages.value.find((m) => m.id === assistantId);
    if (assistantMsg) {
      assistantMsg.content = result;
      assistantMsg.isStreaming = false;
    }

    // Sync tool messages from agent history
    syncToolMessages(assistantId);
  } catch (error) {
    const assistantMsg = messages.value.find((m) => m.id === assistantId);
    if (assistantMsg) {
      assistantMsg.content =
        error instanceof Error
          ? `Error: ${error.message}`
          : "An error occurred.";
      assistantMsg.isStreaming = false;
    }
  }

  runningTools.value = [];
  scrollToBottom();
};

/** Sync tool messages from agent history into our message list */
const syncToolMessages = (assistantId: number) => {
  const history = agent.history.value;
  const existingToolIds = new Set(
    messages.value.filter((m) => m.role === "tool").map((m) => m.id)
  );

  for (const msg of history) {
    if (msg.role === "tool" && msg.toolName) {
      // Check if we already have this tool message
      const key = `${msg.toolName}::${msg.content?.slice(0, 50)}`;
      const alreadyExists = messages.value.some(
        (m) =>
          m.role === "tool" &&
          m.toolName === msg.toolName &&
          m.content?.slice(0, 50) === msg.content?.slice(0, 50)
      );

      if (!alreadyExists) {
        const toolMsgId = Date.now() + Math.random();
        messages.value.push({
          id: toolMsgId,
          role: "tool",
          content: msg.content,
          toolName: msg.toolName
        });
        toolMessageToAssistant.value.set(toolMsgId, assistantId);
      }
    }
  }
};

const stopAgent = () => {
  abortController?.abort();
  abortController = null;
  // Mark any streaming message as done
  const streaming = messages.value.find((m) => m.isStreaming);
  if (streaming) {
    streaming.isStreaming = false;
    if (!streaming.content) {
      streaming.content = "Generation stopped.";
    }
  }
  runningTools.value = [];
};

const clearChat = () => {
  messages.value = [];
  agent.clearHistory();
  runningTools.value = [];
  currentAssistantMsgId.value = 0;
  toolMessageToAssistant.value.clear();
};

// Auto-scroll on new messages
watch(
  () => messages.value.length,
  () => scrollToBottom()
);

onMounted(() => {
  textareaRef.value?.focus();
});
</script>

<style scoped>
.sql-ai-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--p-slate-50);
  border-left: 1px solid var(--p-slate-200);
}

/* ── Header ── */
.sql-ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 0.65rem;
  background: white;
  border-bottom: 1px solid var(--p-slate-200);
  min-height: 32px;
}

.sql-ai-header-left {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.sql-ai-icon {
  font-size: 0.75rem;
  color: var(--p-blue-500, #3b82f6);
}

.sql-ai-title {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--p-slate-700);
}

.sql-ai-header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.sql-ai-header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--p-slate-400);
  cursor: pointer;
  transition: all 0.12s;
}

.sql-ai-header-btn:hover {
  background: var(--p-slate-100);
  color: var(--p-slate-600);
}

/* ── Token counter ── */
.sql-ai-token-counter {
  font-size: 0.6rem;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 1px 5px;
  border-radius: 3px;
}

.sql-ai-token-ok {
  color: var(--p-slate-400);
}

.sql-ai-token-warn {
  color: #d97706;
  background: #fef3c7;
}

.sql-ai-token-danger {
  color: #dc2626;
  background: #fee2e2;
}

/* ── Messages area ── */
.sql-ai-messages {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* ── Empty state ── */
.sql-ai-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 0.5rem;
  text-align: center;
  padding: 1rem;
}

.sql-ai-empty-icon {
  font-size: 1.5rem;
  color: var(--p-slate-300);
}

.sql-ai-empty-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--p-slate-600);
  margin: 0;
}

.sql-ai-empty-sub {
  font-size: 0.72rem;
  color: var(--p-slate-400);
  margin: 0;
}

.sql-ai-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.5rem;
  justify-content: center;
}

.sql-ai-suggestion {
  font-size: 0.65rem;
  padding: 0.3rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--p-slate-200);
  background: white;
  color: var(--p-slate-600);
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
}

.sql-ai-suggestion:hover {
  border-color: var(--p-blue-300, #93c5fd);
  color: var(--p-blue-600, #2563eb);
  background: #eff6ff;
}

/* ── Messages ── */
.sql-ai-msg {
  max-width: 100%;
}

.sql-ai-msg-user {
  align-self: flex-end;
}

.sql-ai-msg-user-content {
  background: var(--p-slate-700);
  color: white;
  padding: 0.4rem 0.65rem;
  border-radius: 0.65rem 0.65rem 0.15rem 0.65rem;
  font-size: 0.78rem;
  line-height: 1.5;
  max-width: 90%;
  margin-left: auto;
  word-wrap: break-word;
}

.sql-ai-msg-assistant {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.sql-ai-msg-assistant-content {
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--p-slate-700);
}

/* ── Thinking dots ── */
.sql-ai-thinking {
  display: flex;
  gap: 4px;
  padding: 0.3rem 0;
}

.sql-ai-thinking-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--p-slate-400);
  animation: sql-ai-bounce 1.4s ease-in-out infinite both;
}

.sql-ai-thinking-dot:nth-child(1) {
  animation-delay: -0.32s;
}

.sql-ai-thinking-dot:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes sql-ai-bounce {
  0%,
  80%,
  100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}

/* ── Tool groups ── */
.sql-ai-tools-group {
  margin-bottom: 0.25rem;
}

.sql-ai-tools-details {
  border: 1px solid var(--p-slate-200);
  border-radius: 0.4rem;
  overflow: hidden;
  background: white;
}

.sql-ai-tools-summary {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.55rem;
  font-size: 0.68rem;
  font-weight: 500;
  color: var(--p-blue-600, #2563eb);
  cursor: pointer;
  list-style: none;
  user-select: none;
  transition: background 0.12s;
}

.sql-ai-tools-summary:hover {
  background: var(--p-slate-50);
}

.sql-ai-tools-summary::-webkit-details-marker {
  display: none;
}

.sql-ai-tools-icon {
  font-size: 0.65rem;
  color: var(--p-blue-500, #3b82f6);
}

.sql-ai-tools-chevron {
  font-size: 0.5rem;
  margin-left: auto;
  transition: transform 0.2s;
  color: var(--p-slate-400);
}

.sql-ai-tools-details[open] .sql-ai-tools-chevron {
  transform: rotate(180deg);
}

.sql-ai-tools-list {
  border-top: 1px solid var(--p-slate-100);
  padding: 0.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.sql-ai-tool-row {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.25rem 0.4rem;
  border-radius: 0.25rem;
  background: var(--p-slate-50);
}

.sql-ai-tool-name {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--p-blue-600, #2563eb);
}

.sql-ai-tool-content {
  font-size: 0.62rem;
  color: var(--p-slate-500);
  font-family: "Consolas", monospace;
  word-break: break-all;
}

/* ── Running tools ── */
.sql-ai-tools-running {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-bottom: 0.25rem;
}

.sql-ai-tool-running-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.55rem;
  border-radius: 0.4rem;
  background: white;
  border: 1px solid var(--p-blue-200, #bfdbfe);
  font-size: 0.68rem;
  color: var(--p-blue-600, #2563eb);
}

.sql-ai-tool-spinner {
  width: 10px;
  height: 10px;
  border: 2px solid var(--p-blue-200, #bfdbfe);
  border-top-color: var(--p-blue-500, #3b82f6);
  border-radius: 50%;
  animation: sql-ai-spin 0.8s linear infinite;
}

@keyframes sql-ai-spin {
  to {
    transform: rotate(360deg);
  }
}

.sql-ai-tool-running-label {
  font-weight: 500;
}

/* ── Query result preview ── */
.sql-ai-query-result {
  border: 1px solid var(--p-slate-200);
  border-radius: 0.4rem;
  overflow: hidden;
  background: white;
  margin-bottom: 0.25rem;
}

.sql-ai-query-result-header {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.55rem;
  background: var(--p-slate-100);
  border-bottom: 1px solid var(--p-slate-200);
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--p-slate-600);
}

.sql-ai-query-result-header i {
  font-size: 0.65rem;
  color: var(--p-emerald-600, #059669);
}

.sql-ai-query-result-count {
  margin-left: auto;
  font-weight: 500;
  color: var(--p-emerald-600, #059669);
  font-size: 0.62rem;
}

.sql-ai-query-result-table-wrap {
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
}

.sql-ai-query-result-table {
  width: 100%;
  border-collapse: collapse;
  font-family: "Consolas", monospace;
  font-size: 0.68rem;
}

.sql-ai-query-result-table th {
  background: var(--p-slate-50);
  color: var(--p-slate-600);
  padding: 4px 8px;
  text-align: left;
  font-weight: 600;
  border-bottom: 1px solid var(--p-slate-200);
  white-space: nowrap;
  position: sticky;
  top: 0;
}

.sql-ai-query-result-table td {
  padding: 3px 8px;
  border-bottom: 1px solid var(--p-slate-100);
  white-space: nowrap;
  color: var(--p-slate-700);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sql-ai-query-result-table tr:hover td {
  background: #eff6ff;
}

/* ── Error ── */
.sql-ai-error {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.65rem;
  background: #fef2f2;
  border-top: 1px solid #fecaca;
  color: #dc2626;
  font-size: 0.72rem;
}

/* ── Input area ── */
.sql-ai-input-wrapper {
  padding: 0.4rem;
  background: white;
  border-top: 1px solid var(--p-slate-200);
}

.sql-ai-input-row {
  display: flex;
  align-items: flex-end;
  gap: 0.3rem;
  background: var(--p-slate-50);
  border: 1px solid var(--p-slate-200);
  border-radius: 0.5rem;
  padding: 0.25rem 0.35rem;
  transition: border-color 0.15s;
}

.sql-ai-input-row:focus-within {
  border-color: var(--p-blue-300, #93c5fd);
}

.sql-ai-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 0.78rem;
  font-family: inherit;
  color: var(--p-slate-700);
  resize: none;
  padding: 0.2rem 0.3rem;
  line-height: 1.5;
  max-height: 120px;
}

.sql-ai-input::placeholder {
  color: var(--p-slate-400);
}

.sql-ai-send-btn,
.sql-ai-stop-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 0.35rem;
  border: none;
  cursor: pointer;
  transition: all 0.12s;
  flex-shrink: 0;
}

.sql-ai-send-btn {
  background: var(--p-slate-700);
  color: white;
}

.sql-ai-send-btn:hover:not(:disabled) {
  background: var(--p-slate-800);
}

.sql-ai-send-btn:disabled {
  background: var(--p-slate-300);
  cursor: not-allowed;
}

.sql-ai-send-btn i,
.sql-ai-stop-btn i {
  font-size: 0.7rem;
}

.sql-ai-stop-btn {
  background: #dc2626;
  color: white;
}

.sql-ai-stop-btn:hover {
  background: #b91c1c;
}
</style>
