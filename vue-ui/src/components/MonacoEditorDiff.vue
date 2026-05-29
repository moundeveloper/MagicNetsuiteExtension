<script setup lang="ts">
import * as monaco from "monaco-editor";
import { ref, onMounted, onBeforeUnmount, watch } from "vue";
import themeJson from "../assets/themes/theme.json";
import { formatFtl } from "../utils/ftlFormatter";

interface Props {
  original?: string;
  modified?: string;
  language?: string;
  readOnly?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  original: "",
  modified: "",
  language: "plaintext",
  readOnly: false
});

const emit = defineEmits<{
  "update:modified": [value: string];
  "ctrl-s": [];
}>();

const containerRef = ref<HTMLDivElement | null>(null);
let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null;
let isUpdatingFromProps = false;

const formatValue = (value: string): string => {
  if (props.language === "xml") {
    return formatFtl(value);
  }
  return value;
};

onMounted(() => {
  if (!containerRef.value) return;

  diffEditor = monaco.editor.createDiffEditor(containerRef.value, {
    readOnly: props.readOnly,
    automaticLayout: true
  });

  diffEditor.setModel({
    original: monaco.editor.createModel(
      formatValue(props.original),
      props.language
    ),
    modified: monaco.editor.createModel(
      formatValue(props.modified),
      props.language
    )
  });

  diffEditor.getModifiedEditor().onDidChangeModelContent(() => {
    if (isUpdatingFromProps) return;
    emit("update:modified", diffEditor?.getModifiedEditor().getValue() ?? "");
  });

  diffEditor.getModifiedEditor().addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
    () => { emit("ctrl-s"); }
  );

  diffEditor.getOriginalEditor().addCommand(
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
    () => { emit("ctrl-s"); }
  );

  monaco.editor.defineTheme("monokai", themeJson as any);
  monaco.editor.setTheme("monokai");
});

onBeforeUnmount(() => {
  const model = diffEditor?.getModel();
  diffEditor?.setModel(null);
  diffEditor?.dispose();
  model?.original.dispose();
  model?.modified.dispose();
  diffEditor = null;
});

watch(
  () => props.original,
  (val) => {
    const model = diffEditor?.getModel();
    if (model && model.original.getValue() !== val) {
      isUpdatingFromProps = true;
      model.original.setValue(formatValue(val));
      isUpdatingFromProps = false;
    }
  }
);

watch(
  () => props.modified,
  (val) => {
    const model = diffEditor?.getModel();
    if (model && model.modified.getValue() !== val) {
      isUpdatingFromProps = true;
      model.modified.setValue(formatValue(val));
      isUpdatingFromProps = false;
    }
  }
);

watch(
  () => props.language,
  (val) => {
    const model = diffEditor?.getModel();
    if (!model) return;
    monaco.editor.setModelLanguage(model.original, val);
    monaco.editor.setModelLanguage(model.modified, val);
  }
);

function swap(): void {
  const model = diffEditor?.getModel();
  if (!model) return;

  const originalValue = model.original.getValue();
  const modifiedValue = model.modified.getValue();
  const lang = model.original.getLanguageId();

  const oldOriginal = model.original;
  const oldModified = model.modified;

  const newOriginal = monaco.editor.createModel(modifiedValue, lang);
  const newModified = monaco.editor.createModel(originalValue, lang);

  diffEditor!.setModel({ original: newOriginal, modified: newModified });

  oldOriginal.dispose();
  oldModified.dispose();
}

const getModifiedValue = (): string => {
  return diffEditor?.getModifiedEditor().getValue() ?? props.modified;
};

const hasTextFocus = (): boolean => {
  return !!(
    diffEditor?.getModifiedEditor().hasTextFocus() ||
    diffEditor?.getOriginalEditor().hasTextFocus()
  );
};

defineExpose({ swap, getModifiedValue, hasTextFocus });
</script>

<template>
  <div ref="containerRef" style="width: 100%; height: 100%" />
</template>
