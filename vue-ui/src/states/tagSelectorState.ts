// useTags.ts
import { ref, computed, type ComputedRef, type Ref } from "vue";

export const MAX_TAGS = 6;

export function useTags() {
  const tags = ref<string[]>(["bruh", "bruh2", "bruh3"]);

  const isTagSelected = (tag: string) => tags.value.includes(tag);

  const addTag = (tag: string) => {
    if (!isTagSelected(tag)) {
      tags.value.push(tag);
    } else {
      console.warn("Cannot add duplicate tags.");
    }
  };

  const addTags = (newTags: string[]) => {
    newTags.forEach(addTag);
  };

  const removeTag = (tagToRemove: string) => {
    tags.value = tags.value.filter((tag) => tag !== tagToRemove);
  };

  const clearTags = () => {
    tags.value = [];
  };

  const isValidTag = (tag: string) => tags.value.includes(tag);

  return {
    tags,
    addTag,
    addTags,
    removeTag,
    clearTags,
    isTagSelected,
    isValidTag,
  };
}

export type TagSelectorType = ReturnType<typeof useTags>;
