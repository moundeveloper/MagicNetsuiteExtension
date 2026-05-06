<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from "vue";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { MergeView } from "@codemirror/merge";
import { javascript } from "@codemirror/lang-javascript";
import { sql } from "@codemirror/lang-sql";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

interface Props {
  original: string;
  modified: string;
  language?: "javascript" | "sql" | "text";
}

const props = defineProps<Props>();
const containerRef = ref<HTMLDivElement | null>(null);
let mergeView: MergeView | null = null;

const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword,                     color: "#6366f1", fontWeight: "600" },
  { tag: tags.operator,                    color: "#6366f1" },
  { tag: tags.operatorKeyword,             color: "#6366f1" },
  { tag: tags.string,                      color: "#16a34a" },
  { tag: tags.number,                      color: "#9333ea" },
  { tag: tags.bool,                        color: "#6366f1" },
  { tag: tags.null,                        color: "#6366f1" },
  { tag: tags.comment,                     color: "#94a3b8", fontStyle: "italic" },
  { tag: tags.name,                        color: "#1e293b" },
  { tag: tags.variableName,               color: "#1e293b" },
  { tag: tags.function(tags.variableName), color: "#0284c7" },
  { tag: tags.function(tags.name),         color: "#0284c7" },
  { tag: tags.typeName,                    color: "#0891b2" },
  { tag: tags.className,                   color: "#0891b2" },
  { tag: tags.propertyName,               color: "#0284c7" },
  { tag: tags.punctuation,                color: "#64748b" },
  { tag: tags.bracket,                    color: "#334155" },
]);

const getLangExtension = () => {
  if (props.language === "sql") return sql();
  if (props.language === "javascript") return javascript();
  return [];
};

const baseTheme = EditorView.theme({
  "&": {
    fontSize: "0.8rem",
    fontFamily: '"JetBrains Mono", monospace',
    backgroundColor: "#f8fafc",
    color: "#1e293b",
    height: "100%"
  },
  ".cm-content": { padding: "0.5rem 0", caretColor: "#1e293b" },
  ".cm-line": { padding: "0 0.75rem" },
  ".cm-gutters": {
    background: "#f1f5f9",
    borderRight: "1px solid #e2e8f0",
    color: "#94a3b8",
    fontSize: "0.72rem"
  },
  ".cm-deletedChunk": { background: "rgba(239,68,68,0.10)" },
  ".cm-insertedChunk": { background: "rgba(34,197,94,0.10)" },
  ".cm-deletedLine": { background: "rgba(239,68,68,0.16)" },
  ".cm-insertedLine": { background: "rgba(34,197,94,0.16)" },
  ".cm-changedLine": { background: "rgba(59,130,246,0.08)" }
});

const buildMergeView = () => {
  const el = containerRef.value;
  if (!el) return;

  mergeView?.destroy();
  mergeView = new MergeView({
    a: {
      doc: props.original,
      extensions: [
        EditorState.readOnly.of(true),
        lineNumbers(),
        getLangExtension(),
        syntaxHighlighting(lightHighlightStyle),
        baseTheme,
        EditorView.lineWrapping
      ]
    },
    b: {
      doc: props.modified,
      extensions: [
        EditorState.readOnly.of(true),
        lineNumbers(),
        getLangExtension(),
        syntaxHighlighting(lightHighlightStyle),
        baseTheme,
        EditorView.lineWrapping
      ]
    },
    parent: el,
    revertControls: undefined,
    highlightChanges: true,
    collapseUnchanged: { margin: 3, minSize: 4 }
  });
};

onMounted(() => {
  buildMergeView();
});

onUnmounted(() => {
  mergeView?.destroy();
  mergeView = null;
});

watch(() => [props.original, props.modified, props.language], () => {
  buildMergeView();
});
</script>

<template>
  <div ref="containerRef" class="diff-viewer" />
</template>

<style scoped>
.diff-viewer {
  border: 1px solid var(--p-slate-200);
  border-radius: 0 0 0.5rem 0.5rem;
  overflow: hidden;
  max-height: 480px;
  overflow-y: auto;
  font-size: 0.8rem;
  background: #f8fafc;
}

.diff-viewer :deep(.cm-editor) {
  height: auto;
}

.diff-viewer :deep(.cm-mergeView) {
  display: flex;
  width: 100%;
}

.diff-viewer :deep(.cm-mergeViewEditor) {
  flex: 1;
  min-width: 0;
}
</style>
