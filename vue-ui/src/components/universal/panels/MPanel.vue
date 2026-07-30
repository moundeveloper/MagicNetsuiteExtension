<template>
  <div
    class="m-panel p-4"
    :style="{
      outline: outline ? '1px solid var(--p-slate-300)' : 'none',
      boxShadow: boxShadow ? ' 0 4px 12px rgba(41, 41, 41, 0.1)' : 'none'
    }"
  >
    <div class="m-panel-header">
      <button
        v-if="toggleable"
        :id="toggleId"
        type="button"
        class="m-panel-header-toggle"
        :aria-label="header ? `Toggle ${header}` : 'Toggle panel'"
        :aria-expanded="expanded"
        :aria-controls="contentId"
        @click="onToggle"
      >
        <i
          class="pi pi-angle-down"
          aria-hidden="true"
          :style="{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }"
        ></i>
      </button>
      <span v-if="header" class="m-panel-header-label">{{ header }}</span>
      <slot name="header" />
    </div>
    <transition
      name="expand"
      @enter="onEnter"
      @after-enter="onAfterEnter"
      @leave="onLeave"
      @after-leave="onAfterLeave"
    >
      <div
        v-if="expanded"
        :id="contentId"
        class="m-panel-content-wrapper"
        role="region"
        :aria-label="header || undefined"
        :aria-labelledby="toggleable && !header ? toggleId : undefined"
      >
        <div class="m-panel-content px-4 pt-2">
          <slot name="content">
            <slot />
          </slot>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, useId, watch } from "vue";

type MPanelProps = {
  header?: string;
  outline?: boolean;
  boxShadow?: boolean;
  toggleable?: boolean;
  expanded?: boolean;
};

const props = withDefaults(defineProps<MPanelProps>(), {
  header: "",
  outline: false,
  toggleable: false,
  expanded: undefined
});

const emit = defineEmits<{
  (e: "toggle", expanded: boolean): void;
}>();

const expanded = ref<boolean>(false);
const componentId = useId();
const toggleId = `m-panel-toggle-${componentId}`;
const contentId = `m-panel-content-${componentId}`;

if (props.expanded !== undefined) {
  expanded.value = props.expanded;
} else if (!props.toggleable) {
  expanded.value = true;
}

const onToggle = () => {
  expanded.value = !expanded.value;
  emit("toggle", expanded.value);
};

watch(
  () => props.expanded,
  (value) => {
    if (value !== undefined) expanded.value = value;
  }
);

const onEnter = (el: Element) => {
  const element = el as HTMLElement;
  element.style.height = "0";
  element.style.opacity = "0";
  // Force reflow
  requestAnimationFrame(() => {
    element.style.height = element.scrollHeight + "px";
    element.style.opacity = "1";
  });
};

const onAfterEnter = (el: Element) => {
  const element = el as HTMLElement;
  element.style.height = "";
};

const onLeave = (el: Element) => {
  const element = el as HTMLElement;
  element.style.height = element.scrollHeight + "px";
  // Force reflow
  requestAnimationFrame(() => {
    element.style.height = "0";
    element.style.opacity = "0";
  });
};

const onAfterLeave = (el: Element) => {
  const element = el as HTMLElement;
  element.style.height = "";
  element.style.opacity = "";
};
</script>

<style scoped>
.m-panel {
  border-radius: 0.25rem;
  display: flex;
  flex-direction: column;
  background: var(--p-slate-100);
}

.m-panel-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  color: var(--p-slate-600);
}

.m-panel-header-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 0.25rem;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition:
    color 0.2s ease,
    transform 0.3s ease;
  padding: 0.5rem;
  transform-origin: center;
}

.m-panel-header-toggle:focus-visible {
  outline: 2px solid #a5b4fc;
  outline-offset: 1px;
}

.m-panel-header-toggle:hover {
  color: var(--p-slate-600);
  transform: scale(1.2);
}

.m-panel-header-toggle i {
  display: block;
  transition: transform 0.3s ease;
}

.m-panel-header-label {
  font-weight: 700;
}

.m-panel-content-wrapper {
  overflow: hidden;
  transition:
    height 0.3s ease,
    opacity 0.3s ease;
}

@media (prefers-reduced-motion: reduce) {
  .m-panel-header-toggle,
  .m-panel-header-toggle i,
  .m-panel-content-wrapper {
    transition: none !important;
  }

  .m-panel-header-toggle:hover {
    transform: none;
  }
}
</style>
