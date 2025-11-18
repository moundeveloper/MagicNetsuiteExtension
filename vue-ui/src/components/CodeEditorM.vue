<template>
  <div class="editor-container h-full w-full" ref="editorContainer"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import {
  autocompletion,
  CompletionContext,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";

import {
  jsGlobals,
  jsMethods,
  jsSnippets,
  jsExtraGlobals,
} from "../utils/codeEditorJSCompletion";

// Props + emits
const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

const editorContainer = ref<HTMLDivElement | null>(null);
let editorView: EditorView | null = null;

// ✅ use your completions logic
function jsCompletion(context: CompletionContext) {
  const word = context.matchBefore(/\w*/);
  if (!word) return null;

  const before = context.state.sliceDoc(Math.max(0, word.from - 6), word.from);

  if (/Array\.$/.test(before)) {
    return {
      from: word.from,
      options: jsMethods.map((m) => ({ label: m, type: "function" })),
    };
  }

  if (/String\.$/.test(before)) {
    const stringMethods = [
      "charAt",
      "concat",
      "includes",
      "indexOf",
      "replace",
      "split",
      "toLowerCase",
      "toUpperCase",
    ];
    return {
      from: word.from,
      options: stringMethods.map((m) => ({ label: m, type: "function" })),
    };
  }

  return {
    from: word.from,
    options: [...jsGlobals, ...jsExtraGlobals, ...jsSnippets],
  };
}

onMounted(() => {
  if (!editorContainer.value) return;

  editorView = new EditorView({
    state: EditorState.create({
      doc: props.modelValue || "",
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...closeBracketsKeymap,
          ...searchKeymap, // enables Ctrl+F
        ]),
        javascript(),
        autocompletion({
          override: [jsCompletion],
          activateOnTyping: true, // 👈 triggers without needing space
        }),
        closeBrackets(), // auto () [] {}
        highlightSelectionMatches(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged)
            emit("update:modelValue", update.state.doc.toString());
        }),
      ],
    }),
    parent: editorContainer.value,
  });
});

watch(
  () => props.modelValue,
  (newVal) => {
    if (!editorView) return;
    const currentVal = editorView.state.doc.toString();
    if (newVal !== currentVal) {
      editorView.dispatch({
        changes: { from: 0, to: currentVal.length, insert: newVal },
      });
    }
  }
);
</script>

<style scoped>
.editor-container {
  border: 1px solid #333;
  border-radius: 4px;
  font-family: monospace;
  background-color: #282c34;
  color: #d4d4d4;
  overflow: auto;
}
</style>
