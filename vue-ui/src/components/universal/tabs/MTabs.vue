<!-- MTabs.vue -->
<template>
  <div class="flex flex-col gap-4 h-full">
    <!-- Tab headers -->
    <div class="flex gap-2">
      <TransitionGroup name="tab-transition" tag="div" class="flex gap-2">
        <button
          class="tab-header px-3 py-2 flex gap-2.5 items-center rounded group relative overflow-hidden"
          :style="{
            backgroundColor:
              tab.name === activeTab
                ? 'var(--m-slate-250)'
                : 'var(--m-slate-150)',
            color:
              tab.name === activeTab
                ? 'var(--p-slate-900)'
                : 'var(--p-slate-600)',
            outlineColor:
              tab.name === activeTab
                ? 'var(--p-slate-400)'
                : 'var(--p-slate-300)'
          }"
          v-for="tab in tabs"
          :key="tab.name"
          @click="switchTab(tab.name)"
        >
          <!-- Active indicator -->
          <div
            class="w-1 h-full rounded-full origin-left"
            :class="{ 'animate-bounce-in': tab.name === activeTab }"
            :style="{
              backgroundColor:
                tab.name === activeTab
                  ? 'var(--p-slate-500)'
                  : 'var(--p-slate-300)',
              opacity: tab.name === activeTab ? '1' : '0.4',
              transform:
                tab.name === activeTab
                  ? 'translateX(0) scaleX(1)'
                  : 'translateX(-4px) scaleX(0.5)',
              transition: tab.name === activeTab ? 'none' : 'all 0.3s ease-out'
            }"
          ></div>

          <!-- Tab label -->
          <span class="font-medium text-sm select-none">{{ tab.label }}</span>

          <!-- Close button -->
          <button
            class="p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity duration-150 ml-2 hover:bg-slate-200"
            @click.stop="emitDeleteEvent(tab.name)"
          >
            <i
              class="pi pi-times"
              style="font-size: 0.7rem; color: var(--p-slate-500)"
            ></i>
          </button>
        </button>

        <!-- Add Tab Button -->
        <button
          key="add-tab-button"
          class="tab-header px-3 py-2 flex items-center justify-center rounded transition-all duration-200 ease-in-out hover:bg-slate-200 overflow-hidden"
          style="
            outline: 1px solid var(--p-slate-300);
            background-color: var(--m-slate-150);
          "
          @click="emitAddEvent"
        >
          <i
            class="pi pi-plus"
            style="font-size: 0.8rem; color: var(--p-slate-600)"
          ></i>
        </button>
      </TransitionGroup>
    </div>

    <!-- Active tab content with transition -->
    <div
      ref="tabContentRef"
      class="tab-content h-full relative overflow-hidden"
    >
      <Transition name="tab-fade" mode="out-in">
        <div :key="activeTab!" class="h-full">
          <slot :name="activeTab" :contentHeight="contentHeight"></slot>
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";

interface Tab {
  name: string;
  label: string;
}

const props = defineProps<{
  tabs: Tab[];
}>();

const emit = defineEmits<{
  (
    e: "delete-tab",
    payload: {
      tabId: string;
    }
  ): void;
  (e: "add-tab"): void;
}>();

const activeTab = ref(props.tabs[0]?.name || null);
const isTransitioning = ref(false);
const tabContentRef = ref<HTMLElement | null>(null);
const contentHeight = ref(0);

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
    setTimeout(() => {
      isTransitioning.value = false;
    }, 200);
  }
};

const emitDeleteEvent = (tabId: string) => {
  // If the deleted tab is currently active
  if (activeTab.value === tabId) {
    const tabIndex = props.tabs.findIndex((t) => t.name === tabId);
    // Try to switch to the previous tab, else next tab
    if (tabIndex > 0) {
      activeTab.value = props.tabs[tabIndex - 1]!.name;
    } else if (tabIndex < props.tabs.length - 1) {
      activeTab.value = props.tabs[tabIndex + 1]!.name;
    } else {
      activeTab.value = null; // no tabs left
    }
  }

  emit("delete-tab", { tabId });
};

const emitAddEvent = () => {
  emit("add-tab");
};
</script>

<style scoped>
.tab-content {
  outline: 1px solid var(--p-slate-300);
  border-radius: 0.25rem;
}

.tab-header {
  outline: 1px solid;
}

/* Tab content transition */
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

/* Tab transition animations */
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

/* Bounce in animation - more subtle */
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

.animate-bounce-in {
  animation: bounce-in 0.4s cubic-bezier(0.34, 1.2, 0.64, 1);
}
</style>
