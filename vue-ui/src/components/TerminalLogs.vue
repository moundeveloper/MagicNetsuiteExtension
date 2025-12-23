<template>
  <div
    class="terminal"
    tabindex="0"
    @keydown="handleKeyDown"
    ref="terminalContainer"
  >
    <div class="logs" ref="logContainer">
      <div v-for="(log, index) in logs" :key="index" class="log-block">
        <button class="copy-btn" @click="copyLog(log)">
          <i class="pi pi-clipboard"></i>
        </button>
        <div :class="['log-entry', log.type]">
          <span v-for="(value, i) in log.values" :key="i">{{ value }}</span>
        </div>
      </div>
    </div>

    <div class="input-area">
      <span class="prompt">$</span>
      <input
        v-model="commandInput"
        @keyup.enter="runCommand"
        @keydown.up="navigateHistory(-1)"
        @keydown.down="navigateHistory(1)"
        ref="commandInputRef"
        class="command-input"
        placeholder="Type a command..."
      />
    </div>

    <!-- Search Overlay -->
    <div v-if="showSearch" class="search-overlay">
      <input
        v-model="searchQuery"
        @input="debouncedSearch"
        @keydown.enter.exact="nextMatch"
        @keydown.enter.shift.exact="prevMatch"
        @keydown.esc="closeSearch"
        placeholder="Search logs..."
        ref="searchInputRef"
        class="search-input"
      />
      <span v-if="searchResults.length > 0" class="search-counter">
        {{ currentMatchIndex + 1 }} of {{ searchResults.length }}
      </span>
      <button @click="closeSearch">✕</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import Mark from "mark.js";
import { useToast } from "primevue";

type Log = {
  type: "log" | "warn" | "error";
  values: string[];
};

const props = defineProps<{
  logs: Log[];
}>();

const emit = defineEmits<{
  (e: "command", command: string): void;
}>();

const logContainer = ref<HTMLElement | null>(null);
const commandInput = ref("");
const commandHistory = ref<string[]>([]);
const historyIndex = ref(-1);
const terminalContainer = ref<HTMLElement | null>(null);
const commandInputRef = ref<HTMLInputElement | null>(null);
const showSearch = ref(false);
const searchQuery = ref("");
const searchInputRef = ref<HTMLInputElement | null>(null);

// Mark.js instance
let markInstance: Mark | null = null;
const searchResults = ref<HTMLElement[]>([]);
const currentMatchIndex = ref(0);

const toast = useToast();

// Debounce search to prevent lag
let searchTimeout: number | null = null;
const debounceDelay = 300; // ms

// Auto-scroll logs to bottom
watch(
  () => props.logs.length,
  () => {
    nextTick(() => {
      if (logContainer.value) {
        logContainer.value.scrollTop = logContainer.value.scrollHeight;
      }
    });
  }
);

onMounted(() => {
  if (logContainer.value) {
    markInstance = new Mark(logContainer.value);
  }
  terminalContainer.value?.focus();
});

onUnmounted(() => {
  markInstance = null;
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
});

function runCommand() {
  const cmd = commandInput.value.trim();
  if (!cmd) return;

  commandHistory.value.push(cmd);
  historyIndex.value = commandHistory.value.length;

  emit("command", cmd);
  commandInput.value = "";
}

function navigateHistory(direction: number) {
  const len = commandHistory.value.length;
  if (len === 0) return;

  // Prevent default to stop cursor movement in input
  event?.preventDefault();

  historyIndex.value += direction;

  if (historyIndex.value < 0) historyIndex.value = 0;
  if (historyIndex.value >= len) historyIndex.value = len - 1;

  commandInput.value = commandHistory.value[historyIndex.value] || "";
}

function handleKeyDown(event: KeyboardEvent) {
  // Handle Ctrl + F for search
  if (event.ctrlKey && event.key === "f") {
    event.preventDefault();
    openSearch();
  }
}

function openSearch() {
  showSearch.value = true;
  nextTick(() => {
    searchInputRef.value?.focus();
  });
}

function closeSearch() {
  showSearch.value = false;
  searchQuery.value = "";
  clearSearch();
  terminalContainer.value?.focus();
}

function debouncedSearch() {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  searchTimeout = window.setTimeout(() => {
    performSearch();
  }, debounceDelay);
}

function performSearch() {
  if (!markInstance) return;

  // Clear previous search
  clearSearch();

  const query = searchQuery.value.trim();
  if (!query) {
    searchResults.value = [];
    currentMatchIndex.value = 0;
    return;
  }

  // Perform new search with optimization
  markInstance.mark(query, {
    separateWordSearch: false,
    accuracy: "partially", // Faster than exact matching
    done: () => {
      // Get all marked elements
      searchResults.value = Array.from(
        logContainer.value?.querySelectorAll("mark") || []
      ) as HTMLElement[];

      currentMatchIndex.value = 0;

      if (searchResults.value.length > 0) {
        scrollToMatch(0);
      }
    },
  });
}

function nextMatch() {
  if (searchResults.value.length === 0) return;

  currentMatchIndex.value =
    (currentMatchIndex.value + 1) % searchResults.value.length;
  scrollToMatch(currentMatchIndex.value);
}

function prevMatch() {
  if (searchResults.value.length === 0) return;

  currentMatchIndex.value =
    (currentMatchIndex.value - 1 + searchResults.value.length) %
    searchResults.value.length;
  scrollToMatch(currentMatchIndex.value);
}

function scrollToMatch(index: number) {
  const match = searchResults.value[index];
  if (match && logContainer.value) {
    // Update highlight classes
    searchResults.value.forEach((el, i) => {
      if (i === index) {
        el.classList.add("current-match");
        // Scroll to center
        const containerHeight = logContainer.value!.clientHeight;
        const matchOffsetTop = match.offsetTop;
        const scrollTo = matchOffsetTop - containerHeight / 2;

        logContainer.value!.scrollTo({
          top: scrollTo,
          behavior: "smooth",
        });
      } else {
        el.classList.remove("current-match");
      }
    });
  }
}

function clearSearch() {
  if (markInstance) {
    markInstance.unmark({
      done: () => {
        searchResults.value = [];
        currentMatchIndex.value = 0;
      },
    });
  } else {
    searchResults.value = [];
    currentMatchIndex.value = 0;
  }
}

function copyLog(log: Log) {
  const text = log.values.join("");
  navigator.clipboard
    .writeText(text)
    .then(() => {
      // Optional: show feedback
      console.log("Copied to clipboard");
      toast.add({
        severity: "info",
        summary: "Info",
        detail: "Copied to clipboard",
        life: 2000,
      });
    })
    .catch((err) => {
      console.error("Failed to copy: ", err);
    });
}
</script>

<style scoped>
.terminal {
  background-color: #282c34;
  color: #d4d4d4;
  font-family: monospace;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 8px;
  overflow: hidden;
  border: 1px solid #333;
  border-radius: 4px;
  position: relative;
  outline: none;
}

.logs {
  flex: 1;
  overflow-y: auto;
  padding-right: 4px;
  white-space: pre-wrap;
}

.log-entry {
  margin-bottom: 2px;
}

.log-entry.log {
  color: #d4d4d4;
}

.log-entry.warn {
  color: #dcdcaa;
}

.log-entry.error {
  color: #f48771;
}

/* Mark.js highlight styles */
mark {
  background-color: rgba(255, 255, 0, 0.3);
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
}

mark.current-match {
  background-color: #ffcc00;
  color: #000;
  padding: 0 2px;
  border-radius: 2px;
  font-weight: bold;
}

.input-area {
  display: flex;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid #333;
}

.prompt {
  margin-right: 8px;
  color: #4ec9b0;
}

.command-input {
  background: transparent;
  border: none;
  color: #d4d4d4;
  font-family: monospace;
  flex: 1;
  outline: none;
}

.search-overlay {
  position: absolute;
  bottom: 10px;
  right: 10px;
  background: #333;
  padding: 8px;
  border-radius: 4px;
  display: flex;
  gap: 8px;
  align-items: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  z-index: 1000;
}

.search-input {
  background: #2d2d30;
  border: 1px solid #555;
  color: #fff;
  padding: 4px 8px;
  font-family: monospace;
  border-radius: 2px;
  min-width: 200px;
}

.search-input:focus {
  outline: none;
  border-color: #0078d4;
}

.search-counter {
  color: #ccc;
  font-size: 12px;
  white-space: nowrap;
}

.search-overlay button {
  background: #555;
  border: none;
  color: white;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.search-overlay button:hover {
  background: #666;
}

.log-block {
  position: relative;
  background-color: #3a3f4b;
  border-radius: 0.25rem;
  padding: 0.5rem 1rem;
  margin-bottom: 8px;
}

.copy-btn {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
  background: var(--p-slate-500);
  border: none;
  color: white;
  padding: 0.25rem;
  border-radius: 0.25rem;
  cursor: pointer;
  opacity: 0;
}

.copy-btn:hover {
  background: var(--p-slate-600);
}

.log-block:hover .copy-btn {
  opacity: 1;
}
</style>
