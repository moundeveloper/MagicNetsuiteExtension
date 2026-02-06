<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import {
  EditorState,
  EditorSelection,
  RangeSetBuilder,
  StateEffect,
  StateField
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  Decoration,
  type DecorationSet
} from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";

// Prettier (standalone)
import prettier from "prettier/standalone";
import babelParser from "prettier/plugins/babel";
import estreeParser from "prettier/plugins/estree";

import rainbowBrackets from "rainbowbrackets";

interface Props {
  code: string;
  language: "javascript" | "json";
  autoHeight?: boolean;
}

const props = defineProps<Props>();

const editorEl = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;

// --- Search state ---
let currentMatches: { from: number; to: number }[] = [];
let currentMatchIndex = 0;
let currentDecorations: DecorationSet = Decoration.none;

// --- StateEffect & StateField for decorations ---
const setSearchDecorations = StateEffect.define<DecorationSet>();
const searchDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, tr) => {
    for (const e of tr.effects) {
      if (e.is(setSearchDecorations)) return e.value;
    }
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f)
});

// --- Format code using Prettier ---
const formatCode = async (code: string) => {
  try {
    return await prettier.format(code, {
      parser: props.language === "json" ? "json" : "babel",
      plugins: [babelParser, estreeParser],
      printWidth: 80,
      semi: true,
      singleQuote: true,
      trailingComma: "es5"
    });
  } catch {
    return code;
  }
};

// --- Create editor ---
const createEditor = async () => {
  if (!editorEl.value) return;

  const extensions = [
    lineNumbers(),
    highlightSelectionMatches(),
    keymap.of(searchKeymap),
    oneDark,
    EditorView.editable.of(false),
    EditorView.lineWrapping,
    props.language === "json" ? json() : javascript({ typescript: false }),
    searchDecorationsField,
    rainbowBrackets()
  ];

  const formattedCode = await formatCode(props.code);

  const state = EditorState.create({
    doc: formattedCode,
    extensions
  });

  view = new EditorView({
    state,
    parent: editorEl.value
  });
};

const resizeEditor = () => {
  if (!editorEl.value || !view) return;

  // Only resize if autoHeight is true
  if (!props.autoHeight) return;

  const height = view.contentDOM.scrollHeight;
  editorEl.value.style.height = `${height}px`;
};

watch(
  () => props.code,
  async () => {
    if (!view) return;

    // Wait for the DOM to render the updated code
    requestAnimationFrame(() => resizeEditor());
  }
);

onMounted(createEditor);

watch(
  () => props.code,
  async (newCode) => {
    if (!view) return;

    const formattedCode = await formatCode(newCode);

    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: formattedCode
      }
    });
  }
);

// --- Update decorations ---
const updateDecorations = () => {
  if (!view) return;

  const builder = new RangeSetBuilder<Decoration>();

  // Create a sorted copy of matches
  const sortedMatches = [...currentMatches].sort((a, b) => a.from - b.from);

  for (let i = 0; i < sortedMatches.length; i++) {
    const m = sortedMatches[i]!;
    const isCurrent = currentMatches[currentMatchIndex] === m;
    builder.add(
      m.from,
      m.to,
      Decoration.mark({
        class: isCurrent ? "cm-search-current" : "cm-search-match"
      })
    );
  }

  currentDecorations = builder.finish();

  view.dispatch({
    effects: setSearchDecorations.of(currentDecorations)
  });
};

// --- Search without panel ---
const searchWithoutPanel = (query: string, caseSensitive = false) => {
  if (!view) return;

  // If search string is empty, reset everything
  if (!query) {
    currentMatches = [];
    currentMatchIndex = 0;
    currentDecorations = Decoration.none;

    view.dispatch({
      selection: EditorSelection.cursor(0),
      effects: setSearchDecorations.of(currentDecorations)
    });
    return;
  }

  // Normal search logic for non-empty query
  const doc = view.state.doc.toString();
  const flags = caseSensitive ? "g" : "gi";
  const re = new RegExp(query, flags);

  currentMatches = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(doc)) !== null) {
    currentMatches.push({
      from: match.index,
      to: match.index + match[0].length
    });

    // Prevent infinite loop for zero-length matches
    if (match.index === re.lastIndex) re.lastIndex++;
  }

  currentMatchIndex = 0;

  if (currentMatches.length > 0) {
    const m = currentMatches[currentMatchIndex]!;
    view.dispatch({
      selection: EditorSelection.single(m.from, m.to),
      scrollIntoView: true
    });
  }

  updateDecorations();
};

// --- Navigation ---
const nextMatch = () => {
  if (!view || currentMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex + 1) % currentMatches.length;
  const m = currentMatches[currentMatchIndex]!;
  view.dispatch({
    selection: EditorSelection.single(m.from, m.to),
    scrollIntoView: true
  });
  updateDecorations();
};

const previousMatch = () => {
  if (!view || currentMatches.length === 0) return;
  currentMatchIndex =
    (currentMatchIndex - 1 + currentMatches.length) % currentMatches.length;
  const m = currentMatches[currentMatchIndex]!;
  view.dispatch({
    selection: EditorSelection.single(m.from, m.to),
    scrollIntoView: true
  });
  updateDecorations();
};

// --- Expose API ---
defineExpose({
  search: searchWithoutPanel,
  nextMatch,
  previousMatch
});
</script>

<template>
  <div class="code-viewer" ref="editorEl" />
</template>

<style scoped>
.code-viewer {
  border-radius: 8px;
  font-size: 14px;
}
</style>

<style>
.cm-search-match {
  background-color: rgba(255, 255, 0, 0.3);
}
.cm-search-current {
  background-color: rgba(255, 165, 0, 0.7);
}

/* Depth 0 – outermost */
.cm-rainbowBracket-0 {
  color: #61afef !important; /* blue */
}

/* Depth 1 */
.cm-rainbowBracket-1 {
  color: #98c379 !important; /* green */
}

/* Depth 2 */
.cm-rainbowBracket-2 {
  color: #c678dd !important; /* purple */
}

/* Depth 3 */
.cm-rainbowBracket-3 {
  color: #e5c07b !important; /* yellow */
}

/* Depth 4+ (it cycles) */
.cm-rainbowBracket-4 {
  color: #56b6c2 !important; /* cyan */
}
</style>
