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
import { editor } from "monaco-editor";
import themeJson from "../assets/themes/theme.json";
import { formatFtl } from "../utils/ftlFormatter";

interface EditorConfig {
  autoSizing?: boolean;
  minimap?: boolean;
}

interface MonacoDiffEditorProps {
  originalValue?: string;
  modifiedValue?: string;
  language?: string;
  theme?: string;
  readonly?: boolean;
  options?: editor.IDiffEditorConstructionOptions;
  config?: EditorConfig;
}

const props = withDefaults(defineProps<MonacoDiffEditorProps>(), {
  originalValue: "",
  modifiedValue: "",
  language: "javascript",
  theme: "vs-dark",
  readonly: false,
  options: () => ({}),
  config: () => ({
    autoSizing: true,
    minimap: true
  })
});

const emit = defineEmits<{
  "update:modifiedValue": [value: string];
  change: [value: string];
  focus: [];
  blur: [];
}>();

const editorContainer: Ref<HTMLElement | null> = ref(null);

let diffEditor: editor.IStandaloneDiffEditor | null = null;
let originalModel: editor.ITextModel | null = null;
let modifiedModel: editor.ITextModel | null = null;
let resizeObserver: ResizeObserver | null = null;

const formatValue = (value: string): string => {
  if (props.language === "xml") {
    return formatFtl(value);
  }
  return value;
};

const setupResizeObserver = () => {
  if (!editorContainer.value || !diffEditor) return;

  resizeObserver = new ResizeObserver(() => {
    diffEditor?.layout();
  });

  resizeObserver.observe(editorContainer.value, { box: "content-box" });
};

onMounted(() => {
  if (!editorContainer.value) return;

  diffEditor = monaco.editor.createDiffEditor(editorContainer.value, {
    automaticLayout: true,
    readOnly: props.readonly,
    minimap: { enabled: props.config.minimap },
    scrollBeyondLastLine: false,
    fontSize: 14,
    ...props.options
  });

  originalModel = monaco.editor.createModel(
    formatValue(props.originalValue),
    props.language
  );

  modifiedModel = monaco.editor.createModel(
    formatValue(props.modifiedValue),
    props.language
  );

  diffEditor.setModel({
    original: originalModel,
    modified: modifiedModel
  });

  monaco.editor.defineTheme("monokai", themeJson as any);
  monaco.editor.setTheme("monokai");

  setupResizeObserver();

  // Listen only to modified side changes
  diffEditor.getModifiedEditor().onDidChangeModelContent(() => {
    if (!modifiedModel) return;
    const value = modifiedModel.getValue();
    emit("update:modifiedValue", value);
    emit("change", value);
  });

  // Focus / blur
  diffEditor.getModifiedEditor().onDidFocusEditorText(() => {
    emit("focus");
  });

  diffEditor.getModifiedEditor().onDidBlurEditorText(() => {
    emit("blur");
  });
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();

  // Must clear the diff editor's model BEFORE disposing the text models,
  // otherwise Monaco fires "TextModel got disposed before DiffEditorWidget
  // model got reset" during its own internal teardown.
  if (diffEditor) {
    diffEditor.setModel(null);
    diffEditor.dispose();
  }

  originalModel?.dispose();
  modifiedModel?.dispose();
});

// Watchers
watch(
  () => props.originalValue,
  (newValue) => {
    if (originalModel && originalModel.getValue() !== newValue) {
      originalModel.setValue(formatValue(newValue));
    }
  }
);

watch(
  () => props.modifiedValue,
  (newValue) => {
    if (modifiedModel && modifiedModel.getValue() !== newValue) {
      modifiedModel.setValue(formatValue(newValue));
    }
  }
);

watch(
  () => props.language,
  (newLanguage) => {
    if (originalModel) {
      monaco.editor.setModelLanguage(originalModel, newLanguage);
    }
    if (modifiedModel) {
      monaco.editor.setModelLanguage(modifiedModel, newLanguage);
    }
  }
);

watch(
  () => props.theme,
  (newTheme) => {
    monaco.editor.setTheme(newTheme);
  }
);

watch(
  () => props.readonly,
  (newReadonly) => {
    diffEditor?.updateOptions({ readOnly: newReadonly });
  }
);

// Expose API
defineExpose({
  getEditor: (): editor.IStandaloneDiffEditor | null => diffEditor,
  getModifiedEditor: () => diffEditor?.getModifiedEditor() ?? null,
  getOriginalEditor: () => diffEditor?.getOriginalEditor() ?? null,
  getModifiedValue: (): string => modifiedModel?.getValue() ?? "",
  focus: (): void => diffEditor?.getModifiedEditor().focus()
});
</script>

<style scoped>
.monaco-editor-container {
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.full-height {
  height: 100%;
}
</style>
