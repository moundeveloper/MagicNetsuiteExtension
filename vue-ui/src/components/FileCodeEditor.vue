<template>
  <div ref="container" class="file-code-editor" :class="{ 'file-code-editor--readonly': props.readonly }"></div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { sql } from "@codemirror/lang-sql";
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import {
  syntaxHighlighting,
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
  HighlightStyle,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { lintKeymap } from "@codemirror/lint";

// ── Props & Emits ──────────────────────────────────────────────────────────

const props = defineProps<{
  modelValue?: string;
  language?: "javascript" | "sql";
  readonly?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [value: string];
  "ctrl-s": [];
}>();

// ── Refs ───────────────────────────────────────────────────────────────────

const container = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

const editableCompartment = new Compartment();
const langCompartment = new Compartment();
const activeLineCompartment = new Compartment();

// ── Active-line helpers ────────────────────────────────────────────────────

const buildActiveLineExts = (isReadOnly: boolean) =>
  isReadOnly ? [] : [highlightActiveLine(), highlightActiveLineGutter()];

// ── Nord Theme ─────────────────────────────────────────────────────────────

const nordTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "13.5px",
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      backgroundColor: "#2E3440",
      color: "#D8DEE9",
    },
    ".cm-content": {
      caretColor: "#D8DEE9",
      padding: "8px 0",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#D8DEE9",
    },
    ".cm-focused": {
      outline: "none",
    },
    ".cm-gutters": {
      backgroundColor: "#2E3440",
      color: "#4C566A",
      border: "none",
      borderRight: "1px solid #3B4252",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 10px",
      minWidth: "40px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#3B4252",
      color: "#7B8BA0",
    },
    ".cm-activeLine": {
      backgroundColor: "#3B4252",
    },
    ".cm-selectionBackground": {
      backgroundColor: "#4C566A !important",
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "#4C566A !important",
    },
    ".cm-content ::selection": {
      backgroundColor: "#4C566A !important",
    },
    ".cm-selectionMatch": {
      backgroundColor: "#3B4252",
      outline: "1px solid #4C566A",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "#434C5E",
      outline: "1px solid #616E88",
    },
    ".cm-foldGutter .cm-gutterElement": {
      cursor: "pointer",
      color: "#4C566A",
    },
    ".cm-foldGutter .cm-gutterElement:hover": {
      color: "#81A1C1",
    },
    ".cm-searchMatch": {
      backgroundColor: "#B48EAD44",
      outline: "1px solid #B48EAD88",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "#B48EAD88",
    },
    ".cm-tooltip": {
      border: "1px solid #3B4252",
      borderRadius: "6px",
      backgroundColor: "#2E3440",
      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete": {
      border: "1px solid #3B4252",
      borderRadius: "6px",
      overflow: "hidden",
    },
    ".cm-tooltip-autocomplete > ul": {
      fontFamily: "'JetBrains Mono', 'Consolas', monospace",
      fontSize: "12.5px",
      maxHeight: "260px",
      backgroundColor: "#2E3440",
    },
    ".cm-tooltip-autocomplete > ul > li": {
      padding: "5px 14px",
      color: "#D8DEE9",
      borderBottom: "1px solid #3B425240",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "#3B4252",
      color: "#88C0D0",
    },
    ".cm-completionIcon": {
      opacity: "0.6",
      marginRight: "6px",
      color: "#81A1C1",
    },
    ".cm-completionLabel": {
      fontWeight: "500",
      color: "#D8DEE9",
    },
    ".cm-completionDetail": {
      color: "#616E88",
      fontSize: "11px",
      marginLeft: "8px",
      fontStyle: "normal",
    },
    ".cm-completionMatchedText": {
      textDecoration: "none",
      fontWeight: "700",
      color: "#88C0D0",
    },
    ".cm-scroller::-webkit-scrollbar": {
      width: "8px",
      height: "8px",
    },
    ".cm-scroller::-webkit-scrollbar-track": {
      background: "#2E3440",
    },
    ".cm-scroller::-webkit-scrollbar-thumb": {
      background: "#434C5E",
      borderRadius: "4px",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": {
      background: "#4C566A",
    },
  },
  { dark: true }
);

// ── Nord Syntax Highlighting ───────────────────────────────────────────────

const nordHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword,              color: "#81A1C1", fontWeight: "600" },
  { tag: tags.operator,             color: "#81A1C1" },
  { tag: tags.operatorKeyword,      color: "#81A1C1" },
  { tag: tags.string,               color: "#A3BE8C" },
  { tag: tags.number,               color: "#B48EAD" },
  { tag: tags.bool,                 color: "#81A1C1" },
  { tag: tags.null,                 color: "#81A1C1" },
  { tag: tags.comment,              color: "#616E88", fontStyle: "italic" },
  { tag: tags.name,                 color: "#D8DEE9" },
  { tag: tags.variableName,         color: "#D8DEE9" },
  { tag: tags.function(tags.variableName), color: "#88C0D0" },
  { tag: tags.function(tags.name),  color: "#88C0D0" },
  { tag: tags.definition(tags.variableName), color: "#8FBCBB" },
  { tag: tags.typeName,             color: "#8FBCBB" },
  { tag: tags.className,            color: "#8FBCBB" },
  { tag: tags.namespace,            color: "#8FBCBB" },
  { tag: tags.propertyName,         color: "#88C0D0" },
  { tag: tags.punctuation,          color: "#81A1C1" },
  { tag: tags.separator,            color: "#4C566A" },
  { tag: tags.bracket,              color: "#ECEFF4" },
  { tag: tags.special(tags.string), color: "#EBCB8B" },
  { tag: tags.escape,               color: "#EBCB8B" },
  { tag: tags.regexp,               color: "#EBCB8B" },
  { tag: tags.meta,                 color: "#616E88" },
  { tag: tags.invalid,              color: "#BF616A" },
]);

// ── Language ───────────────────────────────────────────────────────────────

const buildLangExtension = (lang?: string) => {
  if (lang === "sql") return sql();
  return javascript();
};

// ── Lifecycle ──────────────────────────────────────────────────────────────

onMounted(() => {
  if (!container.value) return;

  const ctrlSKeymap = Prec.highest(
    keymap.of([
      {
        key: "Ctrl-s",
        mac: "Cmd-s",
        run: () => {
          emit("ctrl-s");
          return true;
        },
      },
    ])
  );

  const state = EditorState.create({
    doc: props.modelValue ?? "",
    extensions: [
      lineNumbers(),
      activeLineCompartment.of(buildActiveLineExts(props.readonly ?? false)),
      foldGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      highlightSelectionMatches(),
      syntaxHighlighting(nordHighlightStyle, { fallback: true }),
      langCompartment.of(buildLangExtension(props.language)),
      autocompletion({ activateOnTyping: true, closeOnBlur: false }),
      editableCompartment.of(EditorState.readOnly.of(props.readonly ?? false)),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...searchKeymap,
        ...lintKeymap,
        indentWithTab,
      ]),
      ctrlSKeymap,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const value = update.state.doc.toString();
          emit("update:modelValue", value);
          emit("change", value);
        }
      }),
      nordTheme,
    ],
  });

  view = new EditorView({ state, parent: container.value });
});

onBeforeUnmount(() => {
  view?.destroy();
  view = null;
});

// ── Watchers ───────────────────────────────────────────────────────────────

watch(
  () => props.modelValue,
  (newVal) => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== newVal) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: newVal ?? "" },
      });
    }
  }
);

watch(
  () => props.readonly,
  (val) => {
    if (!view) return;
    view.dispatch({
      effects: [
        editableCompartment.reconfigure(EditorState.readOnly.of(val ?? false)),
        activeLineCompartment.reconfigure(buildActiveLineExts(val ?? false)),
      ],
    });
  }
);

watch(
  () => props.language,
  (lang) => {
    if (!view) return;
    view.dispatch({
      effects: langCompartment.reconfigure(buildLangExtension(lang)),
    });
  }
);

// ── Exposed API ────────────────────────────────────────────────────────────

const getValue = (): string => view?.state.doc.toString() ?? "";
const setValue = (val: string): void => {
  if (!view) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: val },
  });
};
const focus = (): void => view?.focus();

defineExpose({ getValue, setValue, focus });
</script>

<style scoped>
.file-code-editor {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.file-code-editor :deep(.cm-editor) {
  height: 100%;
  outline: none;
}

.file-code-editor :deep(.cm-scroller) {
  height: 100%;
  overflow: auto;
}

.file-code-editor :deep(.cm-selectionBackground) {
  background-color: #4C566A !important;
}

.file-code-editor :deep(.cm-focused .cm-selectionBackground) {
  background-color: #4C566A !important;
}

.file-code-editor :deep(.cm-content ::selection) {
  background-color: #4C566A !important;
}

/* ── Read-only view mode: no cursor, no active-line stripe ─────────────── */
.file-code-editor--readonly :deep(.cm-cursor),
.file-code-editor--readonly :deep(.cm-dropCursor) {
  display: none !important;
}
</style>
