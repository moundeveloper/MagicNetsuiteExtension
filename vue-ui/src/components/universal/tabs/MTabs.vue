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
        <TransitionGroup
          name="tab-transition"
          tag="div"
          class="tabs-inner"
          role="tablist"
        >
          <div
            v-for="tab in tabs"
            :key="tab.name"
            class="tab-item group"
            :class="{ 'tab-header--active': tab.name === activeTab }"
          >
            <button
              type="button"
              class="tab-header"
              role="tab"
              :id="tabId(tab.name)"
              :aria-controls="panelId(tab.name)"
              :aria-selected="tab.name === activeTab"
              :tabindex="tab.name === activeTab ? 0 : -1"
              :title="tab.label"
              @click="switchTab(tab.name)"
              @keydown="onTabKeydown(tab.name, $event)"
              @mousedown.middle.prevent="isDynamic && emitDeleteEvent(tab.name)"
            >
              <span
                class="tab-indicator"
                :class="{ 'tab-indicator--active': tab.name === activeTab }"
                aria-hidden="true"
              ></span>
              <span class="tab-label">{{ tab.label }}</span>
            </button>
            <button
              v-if="isDynamic"
              type="button"
              class="tab-close"
              :aria-label="`Close ${tab.label}`"
              :title="`Close ${tab.label}`"
              @click="emitDeleteEvent(tab.name, true)"
            >
              <i class="pi pi-times" style="font-size: 0.7rem" aria-hidden="true"></i>
            </button>
          </div>
        </TransitionGroup>
      </div>

      <!-- Add button: pinned right after scroll area, never scrolls -->
      <button
        v-if="isDynamic"
        type="button"
        class="tab-add"
        aria-label="Add tab"
        title="Add tab"
        @click="emitAddEvent"
      >
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
    <div
      ref="tabContentRef"
      class="tab-content"
      role="tabpanel"
      :id="activeTab ? panelId(activeTab) : undefined"
      :aria-labelledby="activeTab ? tabId(activeTab) : undefined"
      tabindex="0"
    >
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
import {
  ref,
  onMounted,
  onUnmounted,
  computed,
  nextTick,
  useId,
  watch
} from "vue";

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
const tabContentRef = ref<HTMLElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);
const contentHeight = ref(0);
const componentId = useId();
const pendingFocusName = ref<string | null>(null);

const tabIndex = (name: string) => props.tabs.findIndex((tab) => tab.name === name);
const tabId = (name: string) => `m-tabs-${componentId}-tab-${tabIndex(name)}`;
const panelId = (name: string) => `m-tabs-${componentId}-panel-${tabIndex(name)}`;

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
  if (name !== activeTab.value) {
    activeTab.value = name;
    emit("update:modelValue", name);
    nextTick(() => {
      updateContentHeight();
    });
  }
};

const focusTab = (name: string) => {
  const id = tabId(name);
  void nextTick(() => document.getElementById(id)?.focus());
};

const onTabKeydown = (name: string, event: KeyboardEvent) => {
  const currentIndex = tabIndex(name);
  if (currentIndex < 0 || !props.tabs.length) return;

  let targetIndex: number | null = null;
  if (event.key === "ArrowRight") {
    targetIndex = (currentIndex + 1) % props.tabs.length;
  } else if (event.key === "ArrowLeft") {
    targetIndex = (currentIndex - 1 + props.tabs.length) % props.tabs.length;
  } else if (event.key === "Home") {
    targetIndex = 0;
  } else if (event.key === "End") {
    targetIndex = props.tabs.length - 1;
  } else if (event.key === "Delete" && isDynamic.value) {
    event.preventDefault();
    emitDeleteEvent(name, true);
    return;
  } else {
    return;
  }

  event.preventDefault();
  const target = props.tabs[targetIndex];
  if (target) {
    switchTab(target.name);
    focusTab(target.name);
  }
};

const emitDeleteEvent = (deletedTabId: string, restoreFocus = false) => {
  let nextTabId: string | null = null;
  const deletedIndex = props.tabs.findIndex((t) => t.name === deletedTabId);

  if (activeTab.value === deletedTabId) {
    if (deletedIndex > 0) {
      nextTabId = props.tabs[deletedIndex - 1]!.name;
    } else if (deletedIndex < props.tabs.length - 1) {
      nextTabId = props.tabs[deletedIndex + 1]!.name;
    }
    activeTab.value = nextTabId;
    if (nextTabId) emit("update:modelValue", nextTabId);
  }

  if (restoreFocus) {
    pendingFocusName.value =
      nextTabId ??
      props.tabs[deletedIndex + 1]?.name ??
      props.tabs[deletedIndex - 1]?.name ??
      null;
  }

  emit("delete-tab", { tabId: deletedTabId, nextTabId });
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

    if (pendingFocusName.value) {
      const focusName = pendingFocusName.value;
      pendingFocusName.value = null;
      if (newTabs.some((tab) => tab.name === focusName)) focusTab(focusName);
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
.tab-item {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  border-radius: 0.25rem;
  outline: 1px solid var(--p-slate-300);
  background-color: var(--m-slate-150);
  color: var(--p-slate-600);
  overflow: hidden;
  transition:
    background-color 0.15s,
    color 0.15s,
    outline-color 0.15s;
}

.tab-header {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.6rem;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.tab-header:focus-visible,
.tab-close:focus-visible,
.tab-add:focus-visible {
  outline: 2px solid #a5b4fc;
  outline-offset: -2px;
}

.tab-header--active {
  background-color: #f1f4fe;
  color: #4f46e5;
  outline-color: #a5b4fc;
}

/* ── Active indicator bar ── */
.tab-indicator {
  width: 0.25rem;
  height: 0.75rem;
  border-radius: 9999px;
  background-color: var(--p-slate-300);
  opacity: 0.4;
  transform: translateX(-4px) scaleX(0.5);
  transition: all 0.3s ease-out;
  transform-origin: left;
}

.tab-indicator--active {
  background-color: #4f46e5;
  opacity: 1;
  transform: translateX(0) scaleX(1);
  animation: bounce-in 0.4s cubic-bezier(0.34, 1.2, 0.64, 1);
}

.tab-label {
  min-width: 0;
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  font-size: 0.8rem;
  user-select: none;
}

/* ── Close button ── */
.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  cursor: pointer;
  padding: 0.2rem;
  border-radius: 0.25rem;
  margin-right: 0.25rem;
  background: transparent;
  opacity: 0;
  color: var(--p-slate-500);
  transition:
    opacity 0.15s,
    background-color 0.15s;
}

.tab-item:hover .tab-close,
.tab-close:focus-visible {
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
  border: 0;
  cursor: pointer;
  padding: 0.3rem;
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
  flex: 1;
  min-height: 0;
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

@media (prefers-reduced-motion: reduce) {
  .tab-item,
  .tab-indicator,
  .tab-close,
  .tab-add,
  .tab-fade-enter-active,
  .tab-fade-leave-active,
  .tab-transition-enter-active,
  .tab-transition-leave-active,
  .tab-transition-move {
    animation: none !important;
    transition: none !important;
  }
}
</style>
