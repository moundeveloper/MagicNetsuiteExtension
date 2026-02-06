<template>
  <div class="code-viewer">
    <div class="search-bar">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="Search in code..."
        class="search-input"
        @input="handleSearch"
      />
      <div v-if="searchQuery" class="search-results">
        {{ currentMatch }}/{{ totalMatches }} matches
      </div>
      <div class="search-controls">
        <button @click="previousMatch" :disabled="totalMatches === 0">↑</button>
        <button @click="nextMatch" :disabled="totalMatches === 0">↓</button>
        <button @click="clearSearch">✕</button>
      </div>
    </div>

    <pre class="code-block"><code v-html="displayCode"></code></pre>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";

interface Props {
  code: string;
  language?: "javascript" | "json";
  autoFormat?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  language: "javascript",
  autoFormat: true
});

const searchQuery = ref("");
const currentMatch = ref(0);
const totalMatches = ref(0);

// Format the code
const formattedCode = computed(() => {
  if (!props.autoFormat) return props.code;

  try {
    if (props.language === "json") {
      const parsed = JSON.parse(props.code);
      return JSON.stringify(parsed, null, 2);
    } else {
      return formatJavaScript(props.code);
    }
  } catch (error) {
    return props.code;
  }
});

// Basic JavaScript formatter
function formatJavaScript(code: string): string {
  let indent = 0;
  const lines: string[] = [];

  code.split("\n").forEach((line) => {
    const trimmed = line.trim();

    if (trimmed.endsWith("{")) {
      lines.push("  ".repeat(indent) + trimmed);
      indent++;
    } else if (trimmed.startsWith("}")) {
      indent = Math.max(0, indent - 1);
      lines.push("  ".repeat(indent) + trimmed);
    } else {
      lines.push("  ".repeat(indent) + trimmed);
    }
  });

  return lines.join("\n");
}

// Calculate search matches on the plain text
const searchMatches = computed(() => {
  if (!searchQuery.value) {
    totalMatches.value = 0;
    return [];
  }

  const code = formattedCode.value;
  const query = searchQuery.value;
  const matches: { start: number; end: number; index: number }[] = [];

  let searchIndex = 0;
  let matchIndex = 0;

  while (searchIndex < code.length) {
    const foundIndex = code.indexOf(query, searchIndex);
    if (foundIndex === -1) break;

    matchIndex++;
    matches.push({
      start: foundIndex,
      end: foundIndex + query.length,
      index: matchIndex
    });

    searchIndex = foundIndex + 1;
  }

  totalMatches.value = matches.length;
  return matches;
});

// Main display code with syntax highlighting and search
const displayCode = computed(() => {
  const code = formattedCode.value;
  const matches = searchMatches.value;

  if (props.language === "json") {
    return tokenizeJSON(code, matches);
  } else {
    return tokenizeJavaScript(code, matches);
  }
});

// Proper JavaScript tokenizer
function tokenizeJavaScript(
  code: string,
  matches: Array<{ start: number; end: number; index: number }>
): string {
  const keywords = new Set([
    "abstract",
    "arguments",
    "await",
    "boolean",
    "break",
    "byte",
    "case",
    "catch",
    "char",
    "class",
    "const",
    "continue",
    "debugger",
    "default",
    "delete",
    "do",
    "double",
    "else",
    "enum",
    "eval",
    "export",
    "extends",
    "false",
    "final",
    "finally",
    "float",
    "for",
    "function",
    "goto",
    "if",
    "implements",
    "import",
    "in",
    "instanceof",
    "int",
    "interface",
    "let",
    "long",
    "native",
    "new",
    "null",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "short",
    "static",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "throws",
    "transient",
    "true",
    "try",
    "typeof",
    "var",
    "void",
    "volatile",
    "while",
    "with",
    "yield",
    "async",
    "of"
  ]);

  const constants = new Set([
    "undefined",
    "null",
    "true",
    "false",
    "NaN",
    "Infinity"
  ]);
  const builtins = new Set([
    "console",
    "window",
    "document",
    "Array",
    "Object",
    "String",
    "Number",
    "Boolean",
    "Date",
    "Math",
    "JSON",
    "Promise",
    "Set",
    "Map",
    "Error",
    "RegExp"
  ]);

  let result = "";
  let i = 0;

  while (i < code.length) {
    const char = code[i];

    // Check if we're in a search match
    const match = matches.find((m) => i >= m.start && i < m.end);
    if (match && i === match.start) {
      const isCurrentMatch = match.index === currentMatch.value;
      const matchText = htmlEscape(code.substring(match.start, match.end));
      result += `<mark class="${isCurrentMatch ? "current-match" : "match"}">${matchText}</mark>`;
      i = match.end;
      continue;
    }

    // Skip if already in a match
    if (match) {
      i++;
      continue;
    }

    // Single line comment
    if (char === "/" && code[i + 1] === "/") {
      const lineEnd = code.indexOf("\n", i);
      const commentEnd = lineEnd === -1 ? code.length : lineEnd;
      result += `<span class="comment">${htmlEscape(code.substring(i, commentEnd))}</span>`;
      i = commentEnd;
      continue;
    }

    // Multi-line comment
    if (char === "/" && code[i + 1] === "*") {
      const commentEnd = code.indexOf("*/", i + 2);
      const end = commentEnd === -1 ? code.length : commentEnd + 2;
      result += `<span class="comment">${htmlEscape(code.substring(i, end))}</span>`;
      i = end;
      continue;
    }

    // Template literal
    if (char === "`") {
      let end = i + 1;
      let depth = 0;
      while (end < code.length) {
        if (code[end] === "\\") {
          end += 2;
          continue;
        }
        if (code[end] === "$" && code[end + 1] === "{") {
          depth++;
          end += 2;
          continue;
        }
        if (code[end] === "}" && depth > 0) {
          depth--;
          end++;
          continue;
        }
        if (code[end] === "`" && depth === 0) {
          end++;
          break;
        }
        end++;
      }
      result += `<span class="template-string">${htmlEscape(code.substring(i, end))}</span>`;
      i = end;
      continue;
    }

    // String (double quote)
    if (char === '"') {
      let end = i + 1;
      while (end < code.length && code[end] !== '"') {
        if (code[end] === "\\") end += 2;
        else end++;
      }
      end++;
      result += `<span class="string">${htmlEscape(code.substring(i, end))}</span>`;
      i = end;
      continue;
    }

    // String (single quote)
    if (char === "'") {
      let end = i + 1;
      while (end < code.length && code[end] !== "'") {
        if (code[end] === "\\") end += 2;
        else end++;
      }
      end++;
      result += `<span class="string">${htmlEscape(code.substring(i, end))}</span>`;
      i = end;
      continue;
    }

    // Number
    if (/\d/.test(char!) || (char === "." && /\d/.test(code[i + 1]!))) {
      let end = i;
      let hasDecimal = char === ".";

      while (end < code.length) {
        const c = code[end];
        if (/\d/.test(c!)) {
          end++;
        } else if (c === "." && !hasDecimal && /\d/.test(code[end + 1]!)) {
          hasDecimal = true;
          end++;
        } else if (
          (c === "e" || c === "E") &&
          /[\d\-\+]/.test(code[end + 1]!)
        ) {
          end += 2;
        } else if (c === "x" && end === i + 1 && code[i] === "0") {
          end++;
        } else if (
          /[a-fA-F]/.test(c!) &&
          end > i + 1 &&
          code[i] === "0" &&
          code[i + 1] === "x"
        ) {
          end++;
        } else {
          break;
        }
      }
      result += `<span class="number">${htmlEscape(code.substring(i, end))}</span>`;
      i = end;
      continue;
    }

    // Identifier or keyword
    if (/[a-zA-Z_$]/.test(char!)) {
      let end = i;
      while (end < code.length && /[a-zA-Z0-9_$]/.test(code[end]!)) {
        end++;
      }
      const word = code.substring(i, end);

      // Check what comes after
      let afterSpace = end;
      while (afterSpace < code.length && /\s/.test(code[afterSpace]!)) {
        afterSpace++;
      }

      const nextChar = code[afterSpace];

      if (keywords.has(word)) {
        result += `<span class="keyword">${htmlEscape(word)}</span>`;
      } else if (constants.has(word)) {
        result += `<span class="constant">${htmlEscape(word)}</span>`;
      } else if (builtins.has(word)) {
        result += `<span class="builtin">${htmlEscape(word)}</span>`;
      } else if (nextChar === "(") {
        result += `<span class="function">${htmlEscape(word)}</span>`;
      } else if (nextChar === ":" || code.substring(i - 1, i) === ".") {
        result += `<span class="property">${htmlEscape(word)}</span>`;
      } else if (word[0] === word[0]!.toUpperCase() && /[A-Z]/.test(word[0])) {
        result += `<span class="class-name">${htmlEscape(word)}</span>`;
      } else {
        result += `<span class="variable">${htmlEscape(word)}</span>`;
      }
      i = end;
      continue;
    }

    // Operators and punctuation
    const operators = [
      "===",
      "!==",
      "==",
      "!=",
      "<=",
      ">=",
      "=>",
      "&&",
      "||",
      "++",
      "--",
      "<<",
      ">>",
      "**",
      "...",
      "?."
    ];
    let matched = false;

    for (const op of operators) {
      if (code.substring(i, i + op.length) === op) {
        result += `<span class="operator">${htmlEscape(op)}</span>`;
        i += op.length;
        matched = true;
        break;
      }
    }

    if (matched) continue;

    // Single character operators
    if ("+-*/%<>=!&|^~?:".includes(char!)) {
      result += `<span class="operator">${htmlEscape(char!)}</span>`;
      i++;
      continue;
    }

    // Punctuation
    if ("(){}[].,;".includes(char!)) {
      result += `<span class="punctuation">${htmlEscape(char!)}</span>`;
      i++;
      continue;
    }

    // Default
    result += htmlEscape(char!);
    i++;
  }

  return result;
}

// JSON tokenizer
function tokenizeJSON(
  code: string,
  matches: Array<{ start: number; end: number; index: number }>
): string {
  let result = "";
  let i = 0;

  while (i < code.length) {
    const char = code[i];

    // Check if we're in a search match
    const match = matches.find((m) => i >= m.start && i < m.end);
    if (match && i === match.start) {
      const isCurrentMatch = match.index === currentMatch.value;
      const matchText = htmlEscape(code.substring(match.start, match.end));
      result += `<mark class="${isCurrentMatch ? "current-match" : "match"}">${matchText}</mark>`;
      i = match.end;
      continue;
    }

    if (match) {
      i++;
      continue;
    }

    // String
    if (char === '"') {
      let end = i + 1;
      while (end < code.length && code[end] !== '"') {
        if (code[end] === "\\") end += 2;
        else end++;
      }
      end++;

      // Check if this is a key (followed by :)
      let afterSpace = end;
      while (afterSpace < code.length && /\s/.test(code[afterSpace]!)) {
        afterSpace++;
      }

      const isKey = code[afterSpace] === ":";
      const className = isKey ? "json-key" : "json-string";

      result += `<span class="${className}">${htmlEscape(code.substring(i, end))}</span>`;
      i = end;
      continue;
    }

    // Number
    if (/[\d\-]/.test(char!)) {
      let end = i;
      if (char === "-") end++;

      while (end < code.length && /[\d.]/.test(code[end]!)) {
        end++;
      }

      if (code[end] === "e" || code[end] === "E") {
        end++;
        if (code[end] === "+" || code[end] === "-") end++;
        while (end < code.length && /\d/.test(code[end]!)) {
          end++;
        }
      }

      result += `<span class="json-number">${htmlEscape(code.substring(i, end))}</span>`;
      i = end;
      continue;
    }

    // Boolean
    if (code.substring(i, i + 4) === "true") {
      result += `<span class="json-boolean">true</span>`;
      i += 4;
      continue;
    }

    if (code.substring(i, i + 5) === "false") {
      result += `<span class="json-boolean">false</span>`;
      i += 5;
      continue;
    }

    // Null
    if (code.substring(i, i + 4) === "null") {
      result += `<span class="json-null">null</span>`;
      i += 4;
      continue;
    }

    // Punctuation
    if ("{}[],:".includes(char!)) {
      result += `<span class="json-punctuation">${htmlEscape(char!)}</span>`;
      i++;
      continue;
    }

    // Default
    result += htmlEscape(char!);
    i++;
  }

  return result;
}

function htmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function handleSearch() {
  currentMatch.value =
    searchQuery.value && searchMatches.value.length > 0 ? 1 : 0;
}

function nextMatch() {
  if (totalMatches.value > 0) {
    currentMatch.value =
      currentMatch.value >= totalMatches.value ? 1 : currentMatch.value + 1;
  }
}

function previousMatch() {
  if (totalMatches.value > 0) {
    currentMatch.value =
      currentMatch.value <= 1 ? totalMatches.value : currentMatch.value - 1;
  }
}

function clearSearch() {
  searchQuery.value = "";
  currentMatch.value = 0;
  totalMatches.value = 0;
}

// Auto-scroll to current match
watch(currentMatch, () => {
  if (currentMatch.value > 0) {
    setTimeout(() => {
      const currentMarkElement = document.querySelector(".current-match");
      currentMarkElement?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }, 50);
  }
});
</script>

<style scoped>
.code-viewer {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  font-family: "Consolas", "Monaco", "Courier New", monospace;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: #2d2d2d;
  border-radius: 4px;
  border: 1px solid #3e3e3e;
}

.search-input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid #3e3e3e;
  border-radius: 4px;
  font-size: 14px;
  background: #1e1e1e;
  color: #f8f8f2;
  font-family: "Consolas", "Monaco", "Courier New", monospace;
}

.search-input::placeholder {
  color: #75715e;
}

.search-results {
  font-size: 14px;
  color: #a6a6a6;
  white-space: nowrap;
}

.search-controls {
  display: flex;
  gap: 0.25rem;
}

.search-controls button {
  padding: 0.25rem 0.5rem;
  border: 1px solid #3e3e3e;
  background: #2d2d2d;
  color: #f8f8f2;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.search-controls button:hover:not(:disabled) {
  background: #3e3e3e;
}

.search-controls button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.code-block {
  background: #272822;
  color: #f8f8f2;
  padding: 1rem;
  border-radius: 4px;
  overflow: auto;
  max-height: 600px;
  line-height: 1.5;
  margin: 0;
}

.code-block code {
  font-family: "Consolas", "Monaco", "Courier New", monospace;
  font-size: 14px;
}

/* Monokai Theme - JSON */
:deep(.json-key) {
  color: #66d9ef; /* Cyan for keys */
}

:deep(.json-string) {
  color: #e6db74; /* Yellow for strings */
}

:deep(.json-number) {
  color: #ae81ff; /* Purple for numbers */
}

:deep(.json-boolean) {
  color: #ae81ff; /* Purple for booleans */
}

:deep(.json-null) {
  color: #ae81ff; /* Purple for null */
}

:deep(.json-punctuation) {
  color: #f8f8f2; /* White for punctuation */
}

/* Monokai Theme - JavaScript */
:deep(.keyword) {
  color: #f92672; /* Magenta/Pink for keywords */
}

:deep(.string) {
  color: #e6db74; /* Yellow for strings */
}

:deep(.template-string) {
  color: #e6db74; /* Yellow for template strings */
}

:deep(.number) {
  color: #ae81ff; /* Purple for numbers */
}

:deep(.comment) {
  color: #75715e; /* Gray for comments */
  font-style: italic;
}

:deep(.function) {
  color: #a6e22e; /* Green for function names */
}

:deep(.variable) {
  color: #f8f8f2; /* White for variables */
}

:deep(.property) {
  color: #f8f8f2; /* White for properties */
}

:deep(.constant) {
  color: #ae81ff; /* Purple for constants */
}

:deep(.builtin) {
  color: #66d9ef; /* Cyan for built-ins like console */
}

:deep(.class-name) {
  color: #a6e22e; /* Green for class names */
}

:deep(.operator) {
  color: #f92672; /* Magenta for operators */
}

:deep(.punctuation) {
  color: #f8f8f2; /* White for punctuation */
}

/* Search Highlighting */
:deep(mark.match) {
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  padding: 0 2px;
  border: 1px solid #75715e;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1);
}

:deep(mark.current-match) {
  background: #f92672;
  color: #272822;
  padding: 0 2px;
  border: 1px solid #f92672;
  border-radius: 2px;
  font-weight: bold;
  box-shadow: 0 0 0 2px rgba(249, 38, 114, 0.3);
}
</style>
