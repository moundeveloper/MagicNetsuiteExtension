<template>
  <div ref="container" class="suiteql-editor"></div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import { EditorState, Compartment } from "@codemirror/state";
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
import { sql, StandardSQL } from "@codemirror/lang-sql";
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
  schema?: Record<string, string[]>;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [value: string];
  "ctrl-enter": [];
}>();

// ── Refs ───────────────────────────────────────────────────────────────────

const container = ref<HTMLElement | null>(null);
let view: EditorView | null = null;

const sqlCompartment = new Compartment();
const editableCompartment = new Compartment();

// ── Nord Theme (matches Monaco monokai/Nord setup in theme.json) ───────────
// Colors from theme.json:
//   bg: #2E3440  lineBg: #3B4252  selection: #434C5E
//   fg: #D8DEE9  keyword: #81A1C1  string: #A3BE8C
//   number: #B48EAD  fn: #88C0D0  type: #8FBCBB  comment: #616E88

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
    // Gutters
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
    // Active line
    ".cm-activeLine": {
      backgroundColor: "#3B4252",
    },
    // Selection — fully opaque so syntax colors don't bleed through
    ".cm-selectionBackground": {
      backgroundColor: "#4C566A !important",
    },
    "&.cm-focused .cm-selectionBackground": {
      backgroundColor: "#4C566A !important",
    },
    ".cm-selectionMatch": {
      backgroundColor: "#3B4252",
      outline: "1px solid #4C566A",
    },
    // Bracket matching
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "#434C5E",
      outline: "1px solid #616E88",
    },
    // Fold gutter
    ".cm-foldGutter .cm-gutterElement": {
      cursor: "pointer",
      color: "#4C566A",
    },
    ".cm-foldGutter .cm-gutterElement:hover": {
      color: "#81A1C1",
    },
    // Search match
    ".cm-searchMatch": {
      backgroundColor: "#B48EAD44",
      outline: "1px solid #B48EAD88",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "#B48EAD88",
    },
    // ── Autocomplete dropdown ──────────────────────────────────────────────
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
    // Scrollbar (webkit)
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

// ── SQL Extension Builder ──────────────────────────────────────────────────

const buildSqlExtension = (schema: Record<string, string[]> = {}) => {
  const tableCount = Object.keys(schema).length;
  const colCount = Object.values(schema).reduce((s, cols) => s + cols.length, 0);
  console.log(
    `[SuiteQLEditor] Building SQL extension — ${tableCount} tables, ${colCount} columns in schema`
  );
  return sql({ dialect: StandardSQL, schema, upperCaseKeywords: true });
};

// ── Lifecycle ──────────────────────────────────────────────────────────────

onMounted(() => {
  if (!container.value) {
    console.warn("[SuiteQLEditor] Container ref is null on mount");
    return;
  }

  console.log("[SuiteQLEditor] Mounting editor");

  const ctrlEnterKeymap = keymap.of([
    {
      key: "Ctrl-Enter",
      mac: "Cmd-Enter",
      run: () => {
        console.log("[SuiteQLEditor] Ctrl+Enter fired → emit ctrl-enter");
        emit("ctrl-enter");
        return true;
      },
    },
  ]);

  const initialSchema = props.schema ?? {};
  console.log(
    `[SuiteQLEditor] Initial schema: ${Object.keys(initialSchema).length} tables`
  );

  const state = EditorState.create({
    doc: props.modelValue ?? "",
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      foldGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      syntaxHighlighting(nordHighlightStyle, { fallback: true }),
      sqlCompartment.of(buildSqlExtension(initialSchema)),
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
      ctrlEnterKeymap,
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
  console.log("[SuiteQLEditor] Editor created successfully");
});

onBeforeUnmount(() => {
  console.log("[SuiteQLEditor] Destroying editor");
  view?.destroy();
  view = null;
});

// ── Watchers ───────────────────────────────────────────────────────────────

watch(
  () => props.schema,
  (newSchema) => {
    if (!view) {
      console.warn("[SuiteQLEditor] schema watch fired but view is null");
      return;
    }
    const tableCount = Object.keys(newSchema ?? {}).length;
    const colCount = Object.values(newSchema ?? {}).reduce(
      (s, cols) => s + cols.length,
      0
    );
    console.log(
      `[SuiteQLEditor] Schema updated → ${tableCount} tables, ${colCount} columns — reconfiguring`
    );
    view.dispatch({
      effects: sqlCompartment.reconfigure(buildSqlExtension(newSchema ?? {})),
    });
  },
  { deep: true }
);

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
    console.log(`[SuiteQLEditor] readonly → ${val}`);
    view.dispatch({
      effects: editableCompartment.reconfigure(
        EditorState.readOnly.of(val ?? false)
      ),
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

const insertText = (text: string): void => {
  if (!view) {
    console.warn("[SuiteQLEditor] insertText called but view is null");
    return;
  }
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, to: pos, insert: text },
    selection: { anchor: pos + text.length },
  });
  view.focus();
  console.log(`[SuiteQLEditor] Inserted text at pos ${pos}: "${text.slice(0, 40)}"`);
};

const focus = (): void => view?.focus();
const getEditor = (): EditorView | null => view;

defineExpose({ getValue, setValue, insertText, focus, getEditor });
</script>

<style scoped>
.suiteql-editor {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.suiteql-editor :deep(.cm-editor) {
  height: 100%;
  outline: none;
}

.suiteql-editor :deep(.cm-scroller) {
  height: 100%;
  overflow: auto;
}
</style>
