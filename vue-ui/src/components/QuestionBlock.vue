<script setup lang="ts">
import { ref } from "vue";

interface Props {
  question: string;
  options: string[];
}

const props = defineProps<Props>();
const emit = defineEmits<{
  answer: [value: string];
}>();

const answered = ref(false);
const selectedAnswer = ref("");
const customText = ref("");
const showCustomInput = ref(false);

const selectOption = (option: string) => {
  if (answered.value) return;
  selectedAnswer.value = option;
  answered.value = true;
  showCustomInput.value = false;
  emit("answer", option);
};

const toggleCustomInput = () => {
  if (answered.value) return;
  showCustomInput.value = !showCustomInput.value;
};

const submitCustom = () => {
  if (answered.value) return;
  const text = customText.value.trim();
  if (!text) return;
  selectedAnswer.value = text;
  answered.value = true;
  showCustomInput.value = false;
  emit("answer", text);
};

const onCustomKeydown = (e: KeyboardEvent) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitCustom();
  }
};
</script>

<template>
  <div class="question-block" :class="{ 'question-block--answered': answered }">
    <div class="question-header">
      <i class="pi pi-question-circle question-icon" />
      <span class="question-text">{{ props.question }}</span>
    </div>

    <div class="question-options">
      <button
        v-for="option in props.options"
        :key="option"
        class="question-option"
        :class="{
          'question-option--selected': answered && selectedAnswer === option,
          'question-option--disabled': answered && selectedAnswer !== option
        }"
        :disabled="answered"
        @click="selectOption(option)"
      >
        <span class="option-check" v-if="answered && selectedAnswer === option">
          <i class="pi pi-check" />
        </span>
        {{ option }}
      </button>

      <!-- Custom answer toggle -->
      <button
        v-if="!answered"
        class="question-option question-option--custom"
        :class="{ 'question-option--custom-active': showCustomInput }"
        @click="toggleCustomInput"
      >
        <i class="pi pi-pencil" style="font-size: 0.65rem; margin-right: 0.3rem" />
        Type your own answer
      </button>
    </div>

    <!-- Custom text input -->
    <div v-if="showCustomInput && !answered" class="question-custom-input">
      <input
        v-model="customText"
        class="custom-input"
        type="text"
        placeholder="Type your answer…"
        autofocus
        @keydown="onCustomKeydown"
      />
      <button
        class="custom-submit"
        :disabled="!customText.trim()"
        @click="submitCustom"
      >
        <i class="pi pi-arrow-right" />
      </button>
    </div>

    <!-- Answered state footer -->
    <div v-if="answered" class="question-answered-footer">
      <i class="pi pi-check-circle answered-icon" />
      <span>Answered: <strong>{{ selectedAnswer }}</strong></span>
    </div>
  </div>
</template>

<style scoped>
.question-block {
  border: 1px solid var(--p-slate-200);
  border-radius: 0.625rem;
  overflow: hidden;
  margin: 0.5rem 0;
  background: var(--p-slate-50);
  transition: opacity 0.2s ease;
}

.question-block--answered {
  opacity: 0.6;
}

.question-header {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.65rem 0.85rem 0.55rem;
  border-bottom: 1px solid var(--p-slate-200);
  background: var(--p-slate-100);
}

.question-icon {
  color: var(--p-blue-500);
  font-size: 0.875rem;
  flex-shrink: 0;
  margin-top: 0.05rem;
}

.question-text {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--p-slate-800);
  line-height: 1.4;
}

.question-options {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.6rem 0.75rem;
}

.question-option {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.75rem;
  border: 1px solid var(--p-slate-200);
  border-radius: 0.375rem;
  background: white;
  font-family: inherit;
  font-size: 0.8125rem;
  color: var(--p-slate-700);
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.question-option:hover:not(:disabled) {
  background: var(--p-blue-50);
  border-color: var(--p-blue-300);
  color: var(--p-blue-700);
}

.question-option:disabled {
  cursor: default;
}

.question-option--selected {
  background: var(--p-blue-50) !important;
  border-color: var(--p-blue-400) !important;
  color: var(--p-blue-700) !important;
  font-weight: 500;
}

.question-option--disabled {
  opacity: 0.45;
}

.question-option--custom {
  border-style: dashed;
  color: var(--p-slate-500);
}

.question-option--custom:hover {
  border-style: dashed;
}

.question-option--custom-active {
  border-color: var(--p-blue-300);
  background: var(--p-blue-50);
  color: var(--p-blue-600);
}

.option-check {
  color: var(--p-blue-500);
  font-size: 0.625rem;
  display: flex;
  align-items: center;
}

.question-custom-input {
  display: flex;
  gap: 0.4rem;
  padding: 0 0.75rem 0.65rem;
}

.custom-input {
  flex: 1;
  padding: 0.4rem 0.65rem;
  border: 1px solid var(--p-slate-300);
  border-radius: 0.375rem;
  font-family: inherit;
  font-size: 0.8125rem;
  color: var(--p-slate-800);
  background: white;
  outline: none;
  transition: border-color 0.15s ease;
}

.custom-input:focus {
  border-color: var(--p-blue-400);
}

.custom-submit {
  padding: 0.4rem 0.65rem;
  background: var(--p-blue-500);
  border: none;
  border-radius: 0.375rem;
  color: white;
  cursor: pointer;
  font-size: 0.75rem;
  display: flex;
  align-items: center;
  transition: background 0.15s ease;
}

.custom-submit:hover:not(:disabled) {
  background: var(--p-blue-600);
}

.custom-submit:disabled {
  opacity: 0.45;
  cursor: default;
}

.question-answered-footer {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem 0.55rem;
  border-top: 1px solid var(--p-slate-200);
  background: var(--p-slate-100);
  font-size: 0.75rem;
  color: var(--p-slate-500);
}

.answered-icon {
  color: var(--p-green-500);
  font-size: 0.75rem;
}
</style>
