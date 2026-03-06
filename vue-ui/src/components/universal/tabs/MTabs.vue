<!-- MTabs.vue -->
<template>
  <div class="flex flex-col gap-2 h-full min-w-0">
    <!-- Tab headers row: scroll area + fixed add button -->
    <div class="tabs-header-row">
      <!-- Scroll container (tabs only) -->
      <div
        ref="scrollRef"
        class="tabs-scroll-container"
        @wheel.prevent="onWheel"
      >
        <TransitionGroup name="tab-transition" tag="div" class="tabs-inner">
          <button
            v-for="tab in tabs"
            :key="tab.name"
            class="tab-header group"
            :class="{ 'tab-header--active': tab.name === activeTab }"
            @click="switchTab(tab.name)"
            @mousedown.middle.prevent="isDynamic && emitDeleteEvent(tab.name)"
          >
            <div
              class="tab-indicator"
              :class="{ 'tab-indicator--active': tab.name === activeTab }"
            ></div>
            <span class="tab-label">{{ tab.label }}</span>
            <button
              v-if="isDynamic"
              class="tab-close"
              @click.stop="emitDeleteEvent(tab.name)"
            >
              <i class="pi pi-times" style="font-size: 0.7rem"></i>
            </button>
          </button>
        </TransitionGroup>
      </div>

      <!-- Add button: pinned right after scroll area, never scrolls -->
      <button v-if="isDynamic" class="tab-add" @click="emitAddEvent">
        <i
          class="pi pi-plus"
          style="font-size: 0.8rem; color: var(--p-slate-600)"
        ></i>
      </button>
    </div>

    <!-- Toolbar slot -->
    <div v-if="$slots[`${activeTab}-toolbar`]" class="tab-toolbar">
      <slot :name="`${activeTab}-toolbar`"></slot>
    </div>

    <!-- Always render tab content below -->
    <div ref="tabContentRef" class="tab-content">
      <div v-if="$slots['tab-content']">
        <slot
          name="tab-content"
          :activeTab="activeTab"
          :contentHeight="contentHeight"
        />
      </div>
      <Transition v-else name="tab-fade" mode="out-in">
        <div :key="activeTab!" class="h-full">
          <slot :name="activeTab" :contentHeight="contentHeight" />
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from "vue";

interface Tab {
  name: string;
  label: string;
}

const props = defineProps<{
  tabs: Tab[];
  dynamic?: boolean;
  modelValue?: string;
}>();

const isDynamic = computed(() => props.dynamic ?? false);

const emit = defineEmits<{
  (e: "delete-tab", payload: { tabId: string; nextTabId: string | null }): void;
  (e: "add-tab"): void;
  (e: "update:modelValue", value: string): void;
}>();

const activeTab = ref(props.modelValue ?? props.tabs[0]?.name ?? null);
const isTransitioning = ref(false);
const tabContentRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
const contentHeight = ref(0);

// Scroll wheel → horizontal scroll, just like VS Code
const onWheel = (e: WheelEvent) => {
  if (scrollRef.value) {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    scrollRef.value.scrollLeft += delta;
  }
};

const updateContentHeight = () => {
  if (tabContentRef.value) {
    contentHeight.value = tabContentRef.value.clientHeight;
  }
};

onMounted(() => {
  updateContentHeight();
  window.addEventListener("resize", updateContentHeight);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateContentHeight);
});

const switchTab = (name: string) => {
  if (name !== activeTab.value && !isTransitioning.value) {
    isTransitioning.value = true;
    activeTab.value = name;
    emit("update:modelValue", name);
    nextTick(() => {
      setTimeout(() => {
        isTransitioning.value = false;
        updateContentHeight();
      }, 200);
    });
  }
};

const emitDeleteEvent = (tabId: string) => {
  let nextTabId: string | null = null;

  if (activeTab.value === tabId) {
    const tabIndex = props.tabs.findIndex((t) => t.name === tabId);
    if (tabIndex > 0) {
      nextTabId = props.tabs[tabIndex - 1]!.name;
    } else if (tabIndex < props.tabs.length - 1) {
      nextTabId = props.tabs[tabIndex + 1]!.name;
    }
    activeTab.value = nextTabId;
    if (nextTabId) emit("update:modelValue", nextTabId);
  }

  emit("delete-tab", { tabId, nextTabId });
};

const emitAddEvent = () => {
  emit("add-tab");
};

watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal && newVal !== activeTab.value) {
      activeTab.value = newVal;
    }
  }
);

watch(
  () => props.tabs,
  (newTabs) => {
    if (
      newTabs.length > 0 &&
      (!activeTab.value || !newTabs.find((t) => t.name === activeTab.value))
    ) {
      activeTab.value = props.modelValue ?? newTabs[0]?.name ?? null;
      if (activeTab.value) emit("update:modelValue", activeTab.value);
    }
  }
);
</script>

<style scoped>
/* ── Header row: scroll area fills available space, add button is fixed ── */
.tabs-header-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

/* ── Scroll container: shrinks to tabs, but can't exceed remaining space ── */
.tabs-scroll-container {
  flex: 0 1 max-content;
  min-width: 0;
  overflow-x: auto;
  overflow-y: visible;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding: 0.25rem;
}

.tabs-scroll-container::-webkit-scrollbar {
  display: none;
}

/* ── Inner flex row: sizes to content so scroll works ── */
.tabs-inner {
  display: inline-flex;
  flex-wrap: nowrap;
  gap: 0.5rem;
  padding-bottom: 2px;
  position: relative;
  min-width: max-content;
}

/* ── Tab button ── */
.tab-header {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.25rem;
  outline: 1px solid var(--p-slate-300);
  background-color: var(--m-slate-150);
  color: var(--p-slate-600);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background-color 0.15s,
    color 0.15s;
}

.tab-header--active {
  background-color: var(--m-slate-250);
  color: var(--p-slate-900);
  outline-color: var(--p-slate-400);
}

/* ── Active indicator bar ── */
.tab-indicator {
  width: 0.25rem;
  height: 1rem;
  border-radius: 9999px;
  background-color: var(--p-slate-300);
  opacity: 0.4;
  transform: translateX(-4px) scaleX(0.5);
  transition: all 0.3s ease-out;
  transform-origin: left;
}

.tab-indicator--active {
  background-color: var(--p-slate-500);
  opacity: 1;
  transform: translateX(0) scaleX(1);
  animation: bounce-in 0.4s cubic-bezier(0.34, 1.2, 0.64, 1);
}

.tab-label {
  font-weight: 500;
  font-size: 0.875rem;
  user-select: none;
}

/* ── Close button ── */
.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem;
  border-radius: 0.25rem;
  margin-left: 0.5rem;
  opacity: 0;
  color: var(--p-slate-500);
  transition:
    opacity 0.15s,
    background-color 0.15s;
}

.tab-header:hover .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background-color: rgb(226 232 240);
}

/* ── Add button: never scrolls, always visible ── */
.tab-add {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem 0.75rem;
  border-radius: 0.25rem;
  outline: 1px solid var(--p-slate-300);
  background-color: var(--m-slate-150);
  transition: background-color 0.2s;
}

.tab-add:hover {
  background-color: rgb(226 232 240);
}

/* ── Content areas ── */
.tab-content {
  height: 100%;
  position: relative;
  overflow: hidden;
  outline: 1px solid var(--p-slate-300);
  border-radius: 0.25rem;
}

.tab-toolbar {
  outline: 1px solid var(--p-slate-300);
  border-radius: 0.25rem;
}

/* ── Tab content fade ── */
.tab-fade-enter-active,
.tab-fade-leave-active {
  transition: all 0.2s ease-in-out;
}

.tab-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.tab-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.tab-fade-enter-to,
.tab-fade-leave-from {
  opacity: 1;
  transform: translateY(0);
}

/* ── Tab enter/leave ── */
.tab-transition-enter-active {
  transition: all 0.4s cubic-bezier(0.34, 1.2, 0.64, 1);
}

.tab-transition-leave-active {
  position: absolute;
  transition: all 0.3s ease-out;
}

.tab-transition-enter-from {
  opacity: 0;
  transform: scale(0.7) translateX(-20px);
}

.tab-transition-leave-to {
  opacity: 0;
  transform: scale(0.7) translateY(-10px);
  width: 0;
  min-width: 0;
  padding-left: 0;
  padding-right: 0;
  margin-right: 0;
  border: none;
  outline: none;
}

.tab-transition-move {
  transition: transform 0.3s ease;
}

@keyframes bounce-in {
  0% {
    transform: translateX(-6px) scaleX(0.5);
  }
  60% {
    transform: translateX(1px) scaleX(1.1);
  }
  100% {
    transform: translateX(0) scaleX(1);
  }
}
</style>
