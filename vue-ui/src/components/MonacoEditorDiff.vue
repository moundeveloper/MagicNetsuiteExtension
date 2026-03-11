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

const containerRef = ref<HTMLDivElement | null>(null);
let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null;

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
      model.original.setValue(formatValue(val));
    }
  }
);

watch(
  () => props.modified,
  (val) => {
    const model = diffEditor?.getModel();
    if (model && model.modified.getValue() !== val) {
      model.modified.setValue(formatValue(val));
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

defineExpose({ swap });
</script>

<template>
  <div ref="containerRef" style="width: 100%; height: 100%" />
</template>
