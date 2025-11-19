<template>
  <div
    ref="editorContainer"
    class="monaco-editor-container"
    :class="config.autoSizing ? 'full-height' : ''"
  ></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, type Ref } from "vue";
import * as monaco from "monaco-editor";
import * as prettier from "prettier/standalone";
import parserBabel from "prettier/plugins/babel";
import prettierPluginEstree from "prettier/plugins/estree";
import { editor, type IDisposable } from "monaco-editor";
import themeJson from "../assets/themes/theme.json";

// Configure Monaco workers
self.MonacoEnvironment = {
  getWorker(_, label) {
    switch (label) {
      case "json":
        return new Worker(
          new URL(
            "monaco-editor/esm/vs/language/json/json.worker.js",
            import.meta.url
          ),
          { type: "module" }
        );
      case "css":
      case "scss":
      case "less":
        return new Worker(
          new URL(
            "monaco-editor/esm/vs/language/css/css.worker.js",
            import.meta.url
          ),
          { type: "module" }
        );
      case "html":
      case "handlebars":
      case "razor":
        return new Worker(
          new URL(
            "monaco-editor/esm/vs/language/html/html.worker.js",
            import.meta.url
          ),
          { type: "module" }
        );
      case "typescript":
      case "javascript":
        return new Worker(
          new URL(
            "monaco-editor/esm/vs/language/typescript/ts.worker.js",
            import.meta.url
          ),
          { type: "module" }
        );
      default:
        return new Worker(
          new URL(
            "monaco-editor/esm/vs/editor/editor.worker.js",
            import.meta.url
          ),
          { type: "module" }
        );
    }
  },
};

interface CompletionItem {
  label: string;
  kind?: string;
  insertText?: string;
  snippet?: boolean;
  documentation?: string;
  detail?: string;
}

interface EditorConfig {
  suppressNativeFind?: boolean;
  autoSizing?: boolean;
  defocusScroll?: boolean;
  minimap?: boolean;
  disableAutoScrollOnFocus?: boolean;
}

interface MonacoEditorProps {
  modelValue?: string;
  language?: string;
  theme?: string;
  readonly?: boolean;
  options?: editor.IStandaloneEditorConstructionOptions;
  completionItems?: CompletionItem[];
  config?: EditorConfig;
}

const props = withDefaults(defineProps<MonacoEditorProps>(), {
  modelValue: "",
  language: "javascript",
  theme: "vs-dark",
  readonly: false,
  options: () => ({}),
  completionItems: () => [],
  config: () => ({
    suppressNativeFind: false,
    autoSizing: true,
    defocusScroll: false,
    minimap: true,
    disableAutoScrollOnFocus: false,
  }),
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [value: string];
  blur: [];
  focus: [];
}>();

const editorContainer: Ref<HTMLElement | null> = ref(null);
let editorInstance: editor.IStandaloneCodeEditor | null = null;
let completionProvider: IDisposable | null = null;

onMounted(async () => {
  if (!editorContainer.value) return;

  monaco.editor.defineTheme("monokai", themeJson as any);
  monaco.editor.setTheme("monokai");

  const formatted = await prettier.format(props.modelValue, {
    parser: "babel",
    plugins: [parserBabel, prettierPluginEstree],
    semi: true,
    singleQuote: true,
    tabWidth: 2,
  });

  const editorOptions: editor.IStandaloneEditorConstructionOptions = {
    find: { addExtraSpaceOnTop: false },
    value: formatted,
    language: props.language,
    readOnly: props.readonly,
    automaticLayout: true,
    minimap: { enabled: props.config.minimap },
    scrollBeyondLastLine: false,
    fontSize: 14,
    lineNumbers: "on",
    renderWhitespace: "selection",
    tabSize: 2,
    cursorSmoothCaretAnimation: "off",
  };

  if (props.config?.defocusScroll) {
    editorOptions.scrollbar = {
      vertical: "hidden",
      alwaysConsumeMouseWheel: false,
      handleMouseWheel: false,
    };
  }

  // Create editor
  editorInstance = monaco.editor.create(editorContainer.value, editorOptions);

  editorInstance?.getDomNode()!.addEventListener("focusin", (e) => {
    // Temporarily prevent scrolling
    const x = window.scrollX;
    const y = window.scrollY;
    requestAnimationFrame(() => window.scrollTo(x, y));
  });

  if (props.config?.suppressNativeFind) {
    editorInstance.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF,
      () => {}
    );
  }

  const disableAutoScrollOnFocus = () => {
    // Add listener to the scroll container itself, not individual editors
    const scrollContainer = document.getElementById("scrollContainerEditors")!;
    let lastScrollTop = scrollContainer.scrollTop;
    let blockScroll = false;

    // Monitor all mousedown events on the container
    scrollContainer.addEventListener(
      "mousedown",
      (e) => {
        // Save current scroll position
        lastScrollTop = scrollContainer.scrollTop;
        blockScroll = true;

        console.log("mousedown - saved scroll:", lastScrollTop);

        // Keep blocking and restoring for multiple frames
        let frameCount = 0;
        const maxFrames = 10; // Check for up to 10 frames

        const preventAutoScroll = () => {
          if (blockScroll && frameCount < maxFrames) {
            if (scrollContainer.scrollTop !== lastScrollTop) {
              console.log(
                "Blocking scroll change:",
                scrollContainer.scrollTop,
                "->",
                lastScrollTop
              );
              scrollContainer.scrollTop = lastScrollTop;
            }
            frameCount++;
            requestAnimationFrame(preventAutoScroll);
          }
        };

        requestAnimationFrame(preventAutoScroll);

        // Stop blocking after delay
        setTimeout(() => {
          blockScroll = false;
        }, 200);
      },
      true
    );
  };

  if (props.config?.disableAutoScrollOnFocus) {
    disableAutoScrollOnFocus();
  }

  // Register custom completions
  registerCompletions();

  // Listen to content changes
  editorInstance.onDidChangeModelContent(() => {
    if (!editorInstance) return;
    const value = editorInstance.getValue();
    emit("update:modelValue", value);
    emit("change", value);
    if (props.config?.autoSizing) return;

    updateEditorHeight();
  });

  const updateEditorHeight = () => {
    if (!editorInstance) return;
    const lineHeight = editorInstance.getOption(
      monaco.editor.EditorOption.lineHeight
    );
    const lineCount = editorInstance.getModel()?.getLineCount() || 1;
    const newHeight = lineHeight * lineCount + 20; // optional padding
    editorInstance.getContainerDomNode().style.height = `${newHeight}px`;
    console.log("newHeight", newHeight);
    editorInstance.layout();
  };

  if (!props.config?.autoSizing) {
    updateEditorHeight();
  }

  editorInstance.getDomNode()!.addEventListener("focus", (e) => {
    e.preventDefault();
  });

  // Listen to focus/blur
  editorInstance.onDidFocusEditorText((e) => {
    console.log("focus");
    emit("focus");
  });

  editorInstance.onDidBlurEditorText(() => {
    console.log("blur");
    /* 
    editorInstance?.focus(); */

    emit("blur");
  });
});

onBeforeUnmount(() => {
  if (completionProvider) {
    completionProvider.dispose();
  }
  if (editorInstance) {
    editorInstance.dispose();
  }
});

// Watch for prop changes
watch(
  () => props.modelValue,
  (newValue) => {
    if (editorInstance && editorInstance.getValue() !== newValue) {
      editorInstance.setValue(newValue);
    }
  }
);

watch(
  () => props.language,
  (newLanguage) => {
    if (editorInstance) {
      const model = editorInstance.getModel();
      if (model) {
        monaco.editor.setModelLanguage(model, newLanguage);
        registerCompletions();
      }
    }
  }
);

watch(
  () => props.theme,
  (newTheme) => {
    if (editorInstance) {
      monaco.editor.setTheme(newTheme);
    }
  }
);

watch(
  () => props.readonly,
  (newReadonly) => {
    if (editorInstance) {
      editorInstance.updateOptions({ readOnly: newReadonly });
    }
  }
);

watch(
  () => props.completionItems,
  () => {
    registerCompletions();
  },
  { deep: true }
);

// Register custom completion items
function registerCompletions() {
  if (!editorInstance || !props.completionItems.length) return;

  // Dispose previous provider
  if (completionProvider) {
    completionProvider.dispose();
  }

  completionProvider = monaco.languages.registerCompletionItemProvider(
    props.language,
    {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions = props.completionItems.map((item) => ({
          label: item.label,
          kind: (monaco.languages.CompletionItemKind as any)[
            item.kind || "Function"
          ],
          insertText: item.insertText || item.label,
          insertTextRules: item.snippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          documentation: item.documentation || "",
          detail: item.detail || "",
          range: range,
        }));

        return { suggestions };
      },
    }
  );
}

// Expose editor instance and helper methods
defineExpose({
  getEditor: (): editor.IStandaloneCodeEditor | null => editorInstance,
  getValue: (): string => editorInstance?.getValue() ?? "",
  setValue: (value: string): void => editorInstance?.setValue(value),
  focus: (): void => editorInstance?.focus(),
  getPosition: (): monaco.Position | null =>
    editorInstance?.getPosition() ?? null,
  setPosition: (position: monaco.IPosition): void =>
    editorInstance?.setPosition(position),
  revealLine: (line: number): void => editorInstance?.revealLine(line),
  triggerSuggest: (payload: any): void =>
    editorInstance?.trigger("", "editor.action.triggerSuggest", payload),
});
</script>

<style scoped>
.monaco-editor-container {
  width: 100%;
}

.full-height {
  height: 100%;
}
</style>
