<template>
  <div
    class="m-panel p-4"
    :style="{
      outline: outline ? '1px solid var(--p-slate-300)' : 'none',
      boxShadow: boxShadow ? ' 0 4px 12px rgba(41, 41, 41, 0.1)' : 'none'
    }"
  >
    <div class="m-panel-header">
      <div
        v-if="toggleable"
        class="m-panel-header-toggle"
        @click="expanded = !expanded"
      >
        <i
          class="pi pi-angle-down"
          :style="{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }"
        ></i>
      </div>
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
      <div v-if="expanded" class="m-panel-content-wrapper">
        <div class="m-panel-content px-4">
          <slot name="content">
            <slot />
          </slot>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

type MPanelProps = {
  header?: string;
  outline?: boolean;
  boxShadow?: boolean;
  toggleable?: boolean;
};

const props = withDefaults(defineProps<MPanelProps>(), {
  header: "",
  outline: false,
  toggleable: false
});

const expanded = ref(props.toggleable ? false : true);

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
  cursor: pointer;
  transition:
    color 0.2s ease,
    transform 0.3s ease;
  padding: 0.5rem;
  transform-origin: center;
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
</style>
