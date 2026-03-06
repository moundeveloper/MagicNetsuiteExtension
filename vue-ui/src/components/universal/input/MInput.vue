<template>
  <div
    v-if="itemDynamic"
    class="m-input--dynamic"
    :class="{
      'm-input--outlined': outlined && isEditing,
      'm-input--filled': filled && isEditing,
      'm-input--editing': isEditing
    }"
    @dblclick="enterEditMode"
  >
    <span v-if="!isEditing" class="m-input__display-text">
      {{ modelValue || placeholder }}
    </span>
    <input
      v-else
      ref="dynamicInputRef"
      class="m-input m-input__inner"
      :class="{ 'm-input--outlined': outlined, 'm-input--filled': filled }"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      @input="handleInput"
      @blur="exitEditMode($event)"
      @focus="$emit('focus', $event)"
      @keydown="handleKeydown"
    />
  </div>

  <input
    v-else
    class="m-input"
    :class="{ 'm-input--outlined': outlined, 'm-input--filled': filled }"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    @input="handleInput"
    @blur="$emit('blur', $event)"
    @focus="$emit('focus', $event)"
    @keydown="$emit('keydown', $event)"
  />
</template>

<script setup lang="ts">
import { ref, nextTick } from "vue";

defineProps<{
  modelValue?: string;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  readonly?: boolean;
  outlined?: boolean;
  filled?: boolean;
  itemDynamic?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  blur: [event: FocusEvent];
  focus: [event: FocusEvent];
  keydown: [event: KeyboardEvent];
}>();

const isEditing = ref(false);
const dynamicInputRef = ref<HTMLInputElement | null>(null);

const enterEditMode = async () => {
  isEditing.value = true;
  await nextTick();
  dynamicInputRef.value?.focus();
  dynamicInputRef.value?.select();
};

const exitEditMode = (event: FocusEvent) => {
  isEditing.value = false;
  emit("blur", event);
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === "Escape") {
    isEditing.value = false;
  }
  emit("keydown", event);
};

const handleInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  emit("update:modelValue", target.value);
};
</script>

<style scoped>
.m-input {
  padding: 0.5rem 0.75rem;
  border: none;
  border-bottom: 2px solid var(--p-slate-400);
  border-radius: 0;
  font-size: 0.875rem;
  font-family: "JetBrains Mono";
  background: transparent;
  color: var(--p-slate-700);
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
  width: 100%;
  height: 2.25rem;
  box-sizing: border-box;
  display: block;
}

.m-input:focus {
  outline: none;
  border-bottom-color: var(--p-slate-600);
  box-shadow: none;
}

.m-input:disabled {
  background: var(--p-slate-200);
  cursor: not-allowed;
  opacity: 0.7;
}

.m-input::placeholder {
  color: var(--p-slate-400);
}

.m-input--outlined {
  border-width: 2px;
}

.m-input--filled {
  background: var(--p-slate-50);
}

/* Dynamic mode */
.m-input--dynamic {
  width: 100%;
  height: 2.25rem;
  box-sizing: border-box;
  display: flex;
  align-items: center;
}

.m-input__display-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--p-slate-700);
  font-size: 0.875rem;
  user-select: none;
  width: 100%;

  /* Mirror input box model to prevent layout shift */
  padding: 0.5rem 0.75rem;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  box-sizing: border-box;
  line-height: normal;
}

.m-input__inner {
  width: 100%;
}
</style>
