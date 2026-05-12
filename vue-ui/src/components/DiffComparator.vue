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
  /** Left pane content — read-only (the "file" side) */
  original: string;
  /** Right pane content — editable (the "compare to" side) */
  modified: string;
  language?: "javascript" | "sql" | "text";
}

const props = defineProps<Props>();
const emit = defineEmits<{
  /** Emitted whenever the user edits the right pane */
  "update:modified": [value: string];
}>();

const containerRef = ref<HTMLDivElement | null>(null);
let mergeView: MergeView | null = null;

const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword,                     color: "#81A1C1", fontWeight: "600" },
  { tag: tags.operator,                    color: "#81A1C1" },
  { tag: tags.operatorKeyword,             color: "#81A1C1" },
  { tag: tags.string,                      color: "#A3BE8C" },
  { tag: tags.number,                      color: "#B48EAD" },
  { tag: tags.bool,                        color: "#81A1C1" },
  { tag: tags.null,                        color: "#81A1C1" },
  { tag: tags.comment,                     color: "#616E88", fontStyle: "italic" },
  { tag: tags.name,                        color: "#D8DEE9" },
  { tag: tags.variableName,               color: "#D8DEE9" },
  { tag: tags.function(tags.variableName), color: "#88C0D0" },
  { tag: tags.function(tags.name),         color: "#88C0D0" },
  { tag: tags.typeName,                    color: "#8FBCBB" },
  { tag: tags.className,                   color: "#8FBCBB" },
  { tag: tags.propertyName,               color: "#88C0D0" },
  { tag: tags.punctuation,                color: "#81A1C1" },
  { tag: tags.bracket,                    color: "#ECEFF4" },
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
    backgroundColor: "#2E3440",
    color: "#D8DEE9",
    height: "100%"
  },
  ".cm-content": { padding: "0.5rem 0", caretColor: "#D8DEE9" },
  ".cm-line": { padding: "0 0.75rem" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#D8DEE9" },
  ".cm-gutters": {
    background: "#3B4252",
    borderRight: "1px solid #434C5E",
    color: "#4C566A",
    fontSize: "0.72rem"
  },
  ".cm-activeLineGutter": { backgroundColor: "#434C5E" },
  ".cm-activeLine": { backgroundColor: "#3B4252" },
  ".cm-selectionBackground": { backgroundColor: "#4C566A !important" },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: "#4C566A !important" },
  ".cm-deletedChunk": { background: "rgba(191,97,106,0.15)" },
  ".cm-insertedChunk": { background: "rgba(163,190,140,0.12)" },
  ".cm-deletedLine": { background: "rgba(191,97,106,0.28)" },
  ".cm-insertedLine": { background: "rgba(163,190,140,0.22)" },
  ".cm-changedLine": { background: "rgba(129,161,193,0.10)" }
}, { dark: true });

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
        lineNumbers(),
        getLangExtension(),
        syntaxHighlighting(lightHighlightStyle),
        baseTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            emit("update:modified", update.state.doc.toString());
          }
        })
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

// Rebuild only when original or language changes (not modified — that would destroy user input)
watch(() => [props.original, props.language], () => {
  buildMergeView();
});

// Dispatch modified prop changes directly to mergeView.b (avoids re-mount; guards against
// the user-typing round-trip: user types → emit → parent updates compareB → this watch →
// current doc already matches → skip)
watch(() => props.modified, (newVal) => {
  if (!mergeView) return;
  const current = mergeView.b.state.doc.toString();
  if (current === newVal) return;
  mergeView.b.dispatch({
    changes: { from: 0, to: mergeView.b.state.doc.length, insert: newVal }
  });
});
</script>

<template>
  <div ref="containerRef" class="diff-comparator" />
</template>

<style scoped>
.diff-comparator {
  border: 1px solid #434C5E;
  border-top: none;
  border-radius: 0 0 0.25rem 0.25rem;
  overflow: hidden;
  flex: 1;
  overflow-y: auto;
  font-size: 0.8rem;
  background: #2E3440;
  width: 100%;
  min-height: 0;
}

.diff-comparator :deep(.cm-editor) {
  height: auto;
}

.diff-comparator :deep(.cm-mergeView) {
  display: flex;
  width: 100%;
}

.diff-comparator :deep(.cm-mergeViewEditors) {
  display: flex;
  width: 100%;
  min-width: 0;
}

.diff-comparator :deep(.cm-mergeViewEditor) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.diff-comparator :deep(.cm-mergeViewEditor .cm-editor) {
  width: 100%;
}
</style>
