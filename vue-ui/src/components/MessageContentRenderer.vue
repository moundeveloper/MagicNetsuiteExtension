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
  processInlineElementsNoEscape,
  cleanExcessNewlines,
  processParagraphs,
  escapeHtml
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
  html = processInlineElementsNoEscape(html);
  html = cleanExcessNewlines(html);
  html = processParagraphs(html);

  return html;
};
</script>

<template>
  <div class="content-blocks">
    <template v-for="(block, index) in blocks" :key="index">
      <div
        v-if="block.type === 'code'"
        class="code-block-wrapper"
      >
        <CodeViewer
          :code="block.content"
          :language="block.language === 'typescript' ? 'javascript' : block.language as 'javascript'"
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
  gap: 0.5rem;
}

.code-block-wrapper {
  border-radius: 0.5rem;
  overflow: hidden;
  margin: 0.4rem 0;
}

.text-block {
  display: block;
  line-height: 1.65;
}

.text-block :deep(p) {
  margin: 0 0 0.6rem;
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
  margin: 0.75rem 0 0.35rem;
  line-height: 1.3;
}

.text-block :deep(h1) {
  font-size: 1.1rem;
}

.text-block :deep(h2) {
  font-size: 1rem;
}

.text-block :deep(h3) {
  font-size: 0.9375rem;
}

.text-block :deep(h4) {
  font-size: 0.875rem;
}

.text-block :deep(ul),
.text-block :deep(ol) {
  margin: 0.4rem 0 0.6rem;
  padding-left: 1.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.text-block :deep(li) {
  line-height: 1.65;
  color: var(--p-slate-700);
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
  padding: 1px 5px;
  border-radius: 4px;
}

.text-block :deep(blockquote) {
  border-left: 3px solid var(--p-blue-200);
  margin: 0.5rem 0;
  padding: 0.25rem 0.75rem;
  color: var(--p-slate-500);
  font-style: italic;
}

.text-block :deep(hr) {
  border: none;
  border-top: 1px solid var(--p-slate-200);
  margin: 0.75rem 0;
}

.text-block :deep(.callout) {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  margin: 0.6rem 0;
  border-radius: 0.5rem;
  background: var(--callout-bg);
  border: 1px solid var(--callout-color);
  border-left-width: 4px;
}

.text-block :deep(.callout-icon) {
  flex-shrink: 0;
  font-size: 1rem;
}

.text-block :deep(.callout-content) {
  flex: 1;
}

.text-block :deep(.callout-title) {
  font-weight: 600;
  color: var(--callout-color);
  margin-bottom: 0.25rem;
}

.text-block :deep(details.collapsible) {
  margin: 0.6rem 0;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.5rem;
  overflow: hidden;
}

.text-block :deep(details.collapsible summary) {
  padding: 0.6rem 1rem;
  background: var(--p-slate-100);
  cursor: pointer;
  font-weight: 500;
  color: var(--p-slate-700);
  list-style: none;
}

.text-block :deep(details.collapsible summary::-webkit-details-marker) {
  display: none;
}

.text-block :deep(details.collapsible summary::before) {
  content: "▶";
  display: inline-block;
  margin-right: 0.5rem;
  font-size: 0.7rem;
  transition: transform 0.2s;
}

.text-block :deep(details.collapsible[open] summary::before) {
  transform: rotate(90deg);
}

.text-block :deep(.collapsible-content) {
  padding: 0.75rem 1rem;
  background: #fff;
  border-top: 1px solid var(--p-slate-100);
}

.text-block :deep(.md-table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.6rem 0;
  font-size: 0.85rem;
}

.text-block :deep(.md-table th),
.text-block :deep(.md-table td) {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--p-slate-200);
  text-align: left;
}

.text-block :deep(.md-table th) {
  background: var(--p-slate-100);
  font-weight: 600;
  color: var(--p-slate-700);
}

.text-block :deep(.md-table tr:nth-child(even) td) {
  background: var(--p-slate-50);
}

.text-block :deep(.checkbox-wrapper) {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0.25rem 0;
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
