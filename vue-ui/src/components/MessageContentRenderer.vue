<script setup lang="ts">
import { computed, ref } from "vue";
import CodeViewer from "./CodeViewer.vue";
import {
  processCollapsibleSections,
  processCalloutBoxes,
  processTables,
  processCheckboxes,
  processHeadings,
  processLists,
  processInlineElements,
  cleanExcessNewlines,
  processParagraphs
} from "../utils/markdownRenderer";

interface Props {
  content: string;
}

interface ContentBlock {
  type: "text" | "code";
  content: string;
  language?: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  openInSqlEditor: [code: string];
}>();

const copyStates = ref<Record<number, boolean>>({});

const copyCode = async (code: string, index: number) => {
  try {
    await navigator.clipboard.writeText(code);
    copyStates.value[index] = true;
    setTimeout(() => {
      copyStates.value[index] = false;
    }, 2000);
  } catch {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = code;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    copyStates.value[index] = true;
    setTimeout(() => {
      copyStates.value[index] = false;
    }, 2000);
  }
};

const parseContent = (text: string): ContentBlock[] => {
  const blocks: ContentBlock[] = [];
  const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        type: "text",
        content: text.slice(lastIndex, match.index)
      });
    }

    blocks.push({
      type: "code",
      language: match[1] || "javascript",
      content: (match[2] || "").trimEnd()
    });

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    blocks.push({
      type: "text",
      content: text.slice(lastIndex)
    });
  }

  return blocks;
};

const blocks = computed(() => parseContent(props.content));

const renderText = (text: string): string => {
  let html = text;

  html = processCollapsibleSections(html);
  html = processCalloutBoxes(html);
  html = processTables(html);
  html = processCheckboxes(html);
  html = processHeadings(html);
  html = processLists(html);
  html = processInlineElements(html);
  html = cleanExcessNewlines(html);
  html = processParagraphs(html);

  return html;
};
</script>

<template>
  <div class="content-blocks">
    <template v-for="(block, index) in blocks" :key="index">
      <div v-if="block.type === 'code'" class="code-block-container">
        <div class="code-block-header">
          <span class="code-lang">{{ block.language || "code" }}</span>
          <div class="code-block-actions">
            <button
              v-if="block.language === 'sql'"
              class="code-action-btn"
              @click="emit('openInSqlEditor', block.content)"
              title="Open in SQL Editor"
            >
              <i class="pi pi-external-link" />
              <span>Open in SQL Editor</span>
            </button>
            <button
              class="code-copy-btn"
              @click="copyCode(block.content, index)"
              :title="copyStates[index] ? 'Copied!' : 'Copy code'"
            >
              <i :class="copyStates[index] ? 'pi pi-check' : 'pi pi-copy'" />
              <span>{{ copyStates[index] ? "Copied" : "Copy" }}</span>
            </button>
          </div>
        </div>
        <CodeViewer
          :code="block.content"
          :language="
            block.language === 'typescript'
              ? 'javascript'
              : block.language === 'sql'
              ? 'sql'
              : 'javascript'
          "
          :auto-height="true"
        />
      </div>
      <span
        v-else-if="block.content.trim()"
        class="text-block"
        v-html="renderText(block.content)"
      />
    </template>
  </div>
</template>

<style scoped>
.content-blocks {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

/* ── Code blocks ── */
.code-block-container {
  border-radius: 0.5rem;
  overflow: hidden;
  margin: 0.5rem 0;
  border: 1px solid var(--p-slate-200);
}

.code-block-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.375rem 0.75rem;
  background: var(--p-slate-800);
  border-bottom: 1px solid var(--p-slate-700);
}

.code-block-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.code-lang {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--p-slate-400);
  letter-spacing: 0.5px;
}

.code-copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: inherit;
  font-size: 0.6875rem;
  padding: 0.2rem 0.5rem;
  background: transparent;
  border: 1px solid var(--p-slate-600);
  border-radius: 0.25rem;
  cursor: pointer;
  color: var(--p-slate-400);
  transition: all 0.15s ease;
}

.code-copy-btn i {
  font-size: 0.625rem;
}

.code-copy-btn:hover {
  background: var(--p-slate-700);
  color: var(--p-slate-200);
  border-color: var(--p-slate-500);
}

.code-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: inherit;
  font-size: 0.6875rem;
  padding: 0.2rem 0.5rem;
  background: transparent;
  border: 1px solid var(--p-blue-500);
  border-radius: 0.25rem;
  cursor: pointer;
  color: var(--p-blue-400);
  transition: all 0.15s ease;
}

.code-action-btn i {
  font-size: 0.625rem;
}

.code-action-btn:hover {
  background: var(--p-blue-900);
  color: var(--p-blue-200);
  border-color: var(--p-blue-400);
}

/* ── Text blocks ── */
.text-block {
  display: block;
  line-height: 1.65;
}

.text-block :deep(p) {
  margin: 0 0 0.5rem;
  line-height: 1.7;
}

.text-block :deep(p:last-child) {
  margin-bottom: 0;
}

.text-block :deep(h1),
.text-block :deep(h2),
.text-block :deep(h3),
.text-block :deep(h4) {
  font-weight: 600;
  color: var(--p-slate-900);
  line-height: 1.3;
}

.text-block :deep(h1) {
  font-size: 1.05rem;
  margin: 1rem 0 0.4rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px solid var(--p-slate-200);
}

.text-block :deep(h2) {
  font-size: 0.95rem;
  margin: 0.85rem 0 0.35rem;
}

.text-block :deep(h3) {
  font-size: 0.875rem;
  margin: 0.65rem 0 0.3rem;
}

.text-block :deep(h4) {
  font-size: 0.8125rem;
  margin: 0.5rem 0 0.25rem;
}

.text-block :deep(ul),
.text-block :deep(ol) {
  margin: 0.35rem 0 0.5rem;
  padding-left: 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.text-block :deep(li) {
  line-height: 1.6;
  color: var(--p-slate-700);
}

.text-block :deep(ul > li) {
  list-style-type: disc;
}

.text-block :deep(ol > li) {
  list-style-type: decimal;
}

.text-block :deep(li > ul),
.text-block :deep(li > ol) {
  margin: 0.15rem 0 0;
  padding-left: 1.1rem;
}

.text-block :deep(li > ul > li) {
  list-style-type: circle;
}

.text-block :deep(strong) {
  font-weight: 600;
  color: var(--p-slate-900);
}

.text-block :deep(em) {
  font-style: italic;
  color: var(--p-slate-600);
}

.text-block :deep(code) {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.8rem;
  background: var(--p-slate-100);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--p-slate-800);
  border: 1px solid var(--p-slate-200);
}

.text-block :deep(a) {
  color: var(--p-blue-600);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.15s ease;
}

.text-block :deep(a:hover) {
  border-bottom-color: var(--p-blue-400);
}

.text-block :deep(blockquote) {
  border-left: 3px solid var(--p-blue-200);
  margin: 0.5rem 0;
  padding: 0.35rem 0.75rem;
  color: var(--p-slate-500);
  font-style: italic;
  background: var(--p-slate-50);
  border-radius: 0 0.25rem 0.25rem 0;
}

.text-block :deep(hr) {
  border: none;
  border-top: 1px solid var(--p-slate-200);
  margin: 0.75rem 0;
}

/* ── Callout boxes ── */
.text-block :deep(.callout) {
  display: flex;
  gap: 0.75rem;
  padding: 0.65rem 0.85rem;
  margin: 0.5rem 0;
  border-radius: 0.5rem;
  background: var(--callout-bg);
  border: 1px solid color-mix(in srgb, var(--callout-color) 25%, transparent);
  border-left: 3px solid var(--callout-color);
}

.text-block :deep(.callout-icon) {
  flex-shrink: 0;
  font-size: 0.9rem;
  line-height: 1.5;
}

.text-block :deep(.callout-content) {
  flex: 1;
  min-width: 0;
}

.text-block :deep(.callout-title) {
  font-weight: 600;
  font-size: 0.8125rem;
  color: var(--callout-color);
  margin-bottom: 0.2rem;
}

.text-block :deep(.callout-content p) {
  margin: 0;
  font-size: 0.8125rem;
}

/* ── Collapsible sections ── */
.text-block :deep(details.collapsible) {
  margin: 0.5rem 0;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.5rem;
  overflow: hidden;
}

.text-block :deep(details.collapsible summary) {
  padding: 0.5rem 0.75rem;
  background: var(--p-slate-50);
  cursor: pointer;
  font-weight: 500;
  font-size: 0.8125rem;
  color: var(--p-slate-700);
  list-style: none;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  transition: background 0.15s ease;
  user-select: none;
}

.text-block :deep(details.collapsible summary:hover) {
  background: var(--p-slate-100);
}

.text-block :deep(details.collapsible summary::-webkit-details-marker) {
  display: none;
}

.text-block :deep(details.collapsible summary::before) {
  content: "▶";
  display: inline-block;
  font-size: 0.6rem;
  transition: transform 0.2s ease;
  color: var(--p-slate-400);
}

.text-block :deep(details.collapsible[open] summary::before) {
  transform: rotate(90deg);
}

.text-block :deep(.collapsible-content) {
  padding: 0.625rem 0.75rem;
  border-top: 1px solid var(--p-slate-100);
  font-size: 0.85rem;
}

/* ── Tables ── */
.text-block :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.5rem 0;
  font-size: 0.8rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.375rem;
  overflow: hidden;
}

.text-block :deep(.md-table th),
.text-block :deep(.md-table td) {
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--p-slate-200);
  text-align: left;
}

.text-block :deep(.md-table th) {
  background: var(--p-slate-100);
  font-weight: 600;
  font-size: 0.75rem;
  color: var(--p-slate-600);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.text-block :deep(.md-table td) {
  color: var(--p-slate-700);
}

.text-block :deep(.md-table tr:nth-child(even) td) {
  background: var(--p-slate-50);
}

.text-block :deep(.md-table tr:hover td) {
  background: var(--p-blue-50);
}

/* ── Checkboxes ── */
.text-block :deep(.checkbox-wrapper) {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0.2rem 0;
  cursor: default;
}

.text-block :deep(.checkbox-wrapper input) {
  margin-top: 0.3rem;
  accent-color: var(--p-blue-500);
}

.text-block :deep(.checkbox-label) {
  line-height: 1.5;
  color: var(--p-slate-700);
}
</style>
