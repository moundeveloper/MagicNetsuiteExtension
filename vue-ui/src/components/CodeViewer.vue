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
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import prettier from "prettier/standalone";
import babelParser from "prettier/plugins/babel";
import estreeParser from "prettier/plugins/estree";
import rainbowBrackets from "rainbowbrackets";
import { generateId } from "../utils/utilities";
import type { SearchOptions } from "../composables/useCodeViewerSearch";

interface Props {
  code: string;
  language: "javascript";
  autoHeight?: boolean;
  showId?: boolean;
}

const props = defineProps<Props>();
const id = ref(generateId());
const editorEl = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;

// --- Search state ---
let currentMatches: { from: number; to: number }[] = [];
let currentMatchIndex = 0;
let currentDecorations: DecorationSet = Decoration.none;

// --- Decorations for search ---
const setSearchDecorations = StateEffect.define<DecorationSet>();
const searchDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setSearchDecorations)) return e.value;
    return value.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f)
});

// --- Decoration for ${…} in template literals ---
const templateDollarField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, tr) => {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = tr.state.doc.toString();

    // Scan for template literal substitutions ${…}
    const regex = /\$\{|\}/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(doc)) !== null) {
      builder.add(
        match.index,
        match.index + match[0].length,
        Decoration.mark({ class: "cm-template-dollar" })
      );
    }

    return builder.finish();
  },
  provide: (f) => EditorView.decorations.from(f)
});

// --- Escape regex helper ---
const escapeRegExp = (str: string) =>
  str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// --- Format code ---
const formatCode = async (code: string) => {
  try {
    return await prettier.format(code, {
      parser: "babel",
      plugins: [babelParser, estreeParser],
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
  const formattedCode = await formatCode(props.code);

  const state = EditorState.create({
    doc: formattedCode,
    extensions: [
      lineNumbers(),
      highlightSelectionMatches(),
      keymap.of(searchKeymap),
      oneDark,
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      javascript(),
      searchDecorationsField,
      templateDollarField,
      rainbowBrackets()
    ]
  });

  view = new EditorView({
    state,
    parent: editorEl.value
  });
};

onMounted(createEditor);

// --- Auto height ---
const resizeEditor = () => {
  if (!editorEl.value || !view || !props.autoHeight) return;
  editorEl.value.style.height = `${view.contentDOM.scrollHeight}px`;
};

watch(
  () => props.code,
  () => requestAnimationFrame(resizeEditor)
);

// --- Update decorations ---
const updateDecorations = () => {
  if (!view) return;
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...currentMatches].sort((a, b) => a.from - b.from);

  for (const m of sorted) {
    builder.add(
      m.from,
      m.to,
      Decoration.mark({
        class:
          currentMatches[currentMatchIndex] === m
            ? "cm-search-current"
            : "cm-search-match"
      })
    );
  }

  currentDecorations = builder.finish();
  view.dispatch({ effects: setSearchDecorations.of(currentDecorations) });
};

// --- Search ---
const searchWithoutPanel = (query: string, options: SearchOptions = {}) => {
  if (!view) return;

  if (!query) {
    currentMatches = [];
    currentMatchIndex = -1;
    currentDecorations = Decoration.none;
    view.dispatch({
      selection: EditorSelection.cursor(0),
      effects: setSearchDecorations.of(currentDecorations)
    });
    return;
  }

  const re = buildSearchRegex(query, options);

  currentMatches = [];
  const doc = view.state.doc.toString();
  let match: RegExpExecArray | null;

  while ((match = re.exec(doc)) !== null) {
    currentMatches.push({
      from: match.index,
      to: match.index + match[0].length
    });

    // Prevent infinite loops on zero-width matches
    if (match.index === re.lastIndex) re.lastIndex++;
  }

  currentMatchIndex = -1;
  updateDecorations();
};

const buildSearchRegex = (
  query: string,
  { caseSensitive = false, wholeWord = false }: SearchOptions = {}
) => {
  const escaped = escapeRegExp(query);
  const wordWrapped = wholeWord ? `\\b${escaped}\\b` : escaped;
  const flags = caseSensitive ? "g" : "gi";

  return new RegExp(wordWrapped, flags);
};

// --- Navigation ---

// --- Force true vertical centering ---

const nextMatch = () => {
  if (!view || !currentMatches.length) return;
  currentMatchIndex = (currentMatchIndex + 1) % currentMatches.length;
  const m = currentMatches[currentMatchIndex]!;
  const centerPos = Math.floor((m.from + m.to) / 2);

  view.dispatch({
    selection: EditorSelection.single(m.from, m.to)
  });

  console.log("centerPos", centerPos);

  updateDecorations();
};

const previousMatch = () => {
  if (!view || !currentMatches.length) return;
  currentMatchIndex =
    (currentMatchIndex - 1 + currentMatches.length) % currentMatches.length;
  const m = currentMatches[currentMatchIndex]!;

  view.dispatch({
    selection: EditorSelection.single(m.from, m.to)
  });

  updateDecorations();
};

const externalSelection = (
  from: number,
  to: number,
  scrollIntoView = false
) => {
  if (!view) return;

  const index = currentMatches.findIndex(
    (match) => match.from === from && match.to === to
  );

  if (index !== -1) {
    currentMatchIndex = index;
    updateDecorations();
  }

  view.dispatch({
    selection: EditorSelection.single(from, to),
    effects: EditorView.scrollIntoView(from, {
      y: "center"
    })
  });
};

const clearSelection = () => {
  if (!view) return;

  currentMatchIndex = -1;

  const builder = new RangeSetBuilder<Decoration>();
  for (const m of currentMatches) {
    builder.add(m.from, m.to, Decoration.mark({ class: "cm-search-match" }));
  }

  currentDecorations = builder.finish();

  view.dispatch({
    selection: EditorSelection.cursor(0),
    effects: setSearchDecorations.of(currentDecorations)
  });
};

defineExpose({
  search: searchWithoutPanel,
  nextMatch,
  previousMatch,
  getMatches: () => currentMatches,
  externalSelection,
  clearSelection,
  rootEl: editorEl,
  id
});
</script>

<template>
  <div class="code-viewer-wrapper">
    <div v-if="props.showId" class="code-viewer-id">ID: {{ id }}</div>

    <div class="code-viewer" ref="editorEl" />
  </div>
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

/* Highlight $ and } in template literals */
.cm-template-dollar {
  color: rgb(223, 202, 13) !important; /* bright orange */
  font-weight: bold;
}
</style>
