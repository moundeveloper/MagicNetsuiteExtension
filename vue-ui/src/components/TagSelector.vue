<script setup lang="ts">
import MultiSelect from "primevue/multiselect";
import Accordion from "primevue/accordion";
import AccordionPanel from "primevue/accordionpanel";
import AccordionHeader from "primevue/accordionheader";
import AccordionContent from "primevue/accordioncontent";
import { ref, watch, computed } from "vue";

const props = defineProps<{
  modelValue: { id: string | number; label: string }[];
  availableTags: { id: number | string; label: string }[];
  tagName: string;
}>();

const emit = defineEmits(["update:modelValue"]);

const localValue = ref(props.modelValue ?? []);

// Emit changes whenever localValue changes
watch(
  localValue,
  (val) => {
    emit("update:modelValue", val);
  },
  { deep: true }
);

// Check if a tag is selected
const isSelected = (tag: { id: string | number; label: string }) =>
  localValue.value.some((t) => t.id === tag.id);

// Toggle tag selection
const toggleTag = (tag: { id: string | number; label: string }) => {
  if (isSelected(tag)) {
    localValue.value = localValue.value.filter((t) => t.id !== tag.id);
  } else {
    localValue.value.push(tag);
  }
};
</script>

<template>
  <div class="flex flex-col gap-2">
    <MultiSelect
      v-model="localValue"
      :options="availableTags"
      optionLabel="label"
      filter
      placeholder="Select Tags"
      :maxSelectedLabels="3"
      class="w-full md:w-80"
    />

    <!-- Scrollable custom tag container -->
    <Accordion value="0">
      <AccordionPanel value="0">
        <AccordionHeader>{{ tagName }}</AccordionHeader>
        <AccordionContent>
          <div class="tag-container mt-2">
            <div
              v-for="tag in availableTags"
              :key="tag.id"
              :class="['tag-item', isSelected(tag) ? 'selected' : '']"
              @click="toggleTag(tag)"
            >
              {{ tag.label }}
            </div>
          </div>
        </AccordionContent>
      </AccordionPanel>
    </Accordion>
  </div>
</template>

<style scoped>
.tag-container {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem; /* spacing between tags */
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 0.1rem;
}

/* Tag styling */
.tag-item {
  padding: 0.25rem 0.75rem;
  border-radius: 0.25rem;
  background-color: #e0e0e0; /* default unselected */
  cursor: pointer;
  user-select: none;
  transition: all 0.2s;
}

.tag-item:hover {
  opacity: 0.8;
}

.tag-item.selected {
  background-color: var(--p-slate-500);
  color: white;
}
</style>
