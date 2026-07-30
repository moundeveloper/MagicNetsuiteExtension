<template>
  <div ref="rootRef" class="m-select" :class="[{ 'is-open': isOpen, 'size-small': size === 'small' }]">
    <button
      ref="triggerRef"
      type="button"
      class="m-select-trigger"
      role="combobox"
      :disabled="disabled"
      :title="displayValue"
      :aria-expanded="isOpen"
      aria-haspopup="listbox"
      :aria-controls="listboxId"
      :aria-activedescendant="isOpen ? activeOptionId : undefined"
      @click="toggle"
      @keydown.enter.prevent.stop="onTriggerConfirm"
      @keydown.space.prevent.stop="onTriggerConfirm"
      @keydown.escape.prevent.stop="close(true)"
      @keydown.arrow-down.prevent.stop="isOpen ? moveHighlight(1) : open()"
      @keydown.arrow-up.prevent.stop="isOpen ? moveHighlight(-1) : open()"
      @keydown.home.prevent.stop="isOpen ? moveToBoundary('start') : undefined"
      @keydown.end.prevent.stop="isOpen ? moveToBoundary('end') : undefined"
      @keydown.tab="close()"
    >
      <span class="m-select-value" :class="{ 'is-placeholder': !hasValue }">
        {{ displayValue }}
      </span>
      <i class="pi pi-chevron-down m-select-chevron"></i>
    </button>

    <Teleport to="body">
      <div
        v-if="isOpen"
        ref="overlayRef"
        class="m-select-overlay"
        :style="overlayStyle"
      >
        <label v-if="searchable" class="m-select-search">
          <i class="pi pi-search"></i>
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="search"
            :placeholder="searchPlaceholder"
            aria-label="Filter options"
            role="searchbox"
            :aria-controls="listboxId"
            :aria-activedescendant="activeOptionId"
            autocomplete="off"
            @keydown.arrow-down.prevent.stop="moveHighlight(1)"
            @keydown.arrow-up.prevent.stop="moveHighlight(-1)"
            @keydown.home.prevent.stop="moveToBoundary('start')"
            @keydown.end.prevent.stop="moveToBoundary('end')"
            @keydown.enter.prevent.stop="selectHighlighted"
            @keydown.escape.prevent.stop="close(true)"
            @keydown.tab="close()"
          />
        </label>
        <div
          :id="listboxId"
          class="m-select-options"
          role="listbox"
          :aria-busy="loading || undefined"
          :aria-activedescendant="activeOptionId"
        >
          <div v-if="loading" class="m-select-empty" role="status">
            <i class="pi pi-spin pi-spinner"></i>
            Loading options…
          </div>
          <template v-else>
            <div
              v-for="(opt, i) in visibleOptions"
              :key="String(opt.value)"
              :id="optionId(i)"
              class="m-select-option"
              role="option"
              :aria-selected="opt.value === modelValue"
              :class="{
                'is-selected': opt.value === modelValue,
                'is-highlighted': i === highlightedIndex
              }"
              @mousedown.prevent
              @click="select(opt.value)"
              @mouseenter="highlightedIndex = i"
            >
              <i
                class="pi pi-check m-select-option-check"
                :style="{ visibility: opt.value === modelValue ? 'visible' : 'hidden' }"
              ></i>
              <span :title="opt.label">{{ opt.label }}</span>
            </div>
            <div v-if="visibleOptions.length === 0" class="m-select-empty">
              {{ emptyLabel }}
            </div>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts" setup>
import {
  ref,
  computed,
  nextTick,
  onMounted,
  onBeforeUnmount,
  useId,
  watch
} from "vue";

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  modelValue?: string | number | null;
  options?: Array<string | Record<string, any>>;
  optionLabel?: string;
  optionValue?: string;
  placeholder?: string;
  size?: "small" | "default";
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  filterOptions?: boolean;
  loading?: boolean;
  emptyLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  options: () => [],
  optionLabel: "label",
  optionValue: "value",
  placeholder: "Select...",
  size: "default",
  disabled: false,
  searchable: false,
  searchPlaceholder: "Search options…",
  filterOptions: true,
  loading: false,
  emptyLabel: "No options"
});

const emit = defineEmits<{
  "update:modelValue": [value: string | number | null];
  search: [query: string];
}>();

// ── State ─────────────────────────────────────────────────────────────────────
const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const overlayRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const isOpen = ref(false);
const highlightedIndex = ref(0);
const searchQuery = ref("");
const overlayRect = ref<{
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
} | null>(null);
const componentId = useId();
const listboxId = `m-select-listbox-${componentId}`;

// ── Computed ──────────────────────────────────────────────────────────────────
const normalizedOptions = computed(() =>
  props.options.map((opt) => {
    if (typeof opt === "string" || typeof opt === "number") {
      return { label: String(opt), value: opt };
    }
    return {
      label: String((opt as Record<string, any>)[props.optionLabel]),
      value: (opt as Record<string, any>)[props.optionValue]
    };
  })
);

const visibleOptions = computed(() => {
  const needle = searchQuery.value.trim().toLowerCase();
  if (!props.searchable || !props.filterOptions || !needle) {
    return normalizedOptions.value;
  }
  return normalizedOptions.value.filter((option) =>
    option.label.toLowerCase().includes(needle)
  );
});

const hasValue = computed(
  () => props.modelValue !== null && props.modelValue !== undefined && props.modelValue !== ""
);

const displayValue = computed(() => {
  if (!hasValue.value) return props.placeholder;
  const match = normalizedOptions.value.find((o) => o.value === props.modelValue);
  return match ? match.label : String(props.modelValue);
});

const optionId = (index: number) => `${listboxId}-option-${index}`;
const activeOptionId = computed(() =>
  isOpen.value && visibleOptions.value[highlightedIndex.value]
    ? optionId(highlightedIndex.value)
    : undefined
);

const overlayStyle = computed(() => {
  if (!overlayRect.value) return {};
  const { top, left, width, maxHeight } = overlayRect.value;
  return {
    position: "fixed" as const,
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`,
    zIndex: "10000"
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const computeOverlayRect = () => {
  const el = triggerRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const searchHeight = props.searchable ? 46 : 0;
  const preferredHeight = Math.min(
    280,
    visibleOptions.value.length * 34 + searchHeight + 8
  );
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  const spaceAbove = rect.top - 8;
  const placement =
    spaceBelow < preferredHeight && spaceAbove > spaceBelow ? "top" : "bottom";
  const maxHeight = Math.max(
    72,
    Math.min(preferredHeight, placement === "top" ? spaceAbove : spaceBelow)
  );
  overlayRect.value = {
    top:
      placement === "top"
        ? Math.max(4, rect.top - maxHeight - 3)
        : rect.bottom + 3,
    left: rect.left,
    width: rect.width,
    maxHeight,
    placement
  };
};

const open = () => {
  if (props.disabled) return;
  searchQuery.value = "";
  computeOverlayRect();
  isOpen.value = true;
  const idx = visibleOptions.value.findIndex((o) => o.value === props.modelValue);
  highlightedIndex.value = idx >= 0 ? idx : 0;
  void nextTick(() => {
    scrollHighlightedIntoView();
    if (props.searchable) {
      searchInputRef.value?.focus();
      computeOverlayRect();
    }
  });
};

const close = (restoreFocus = false) => {
  isOpen.value = false;
  if (restoreFocus) {
    void nextTick(() => triggerRef.value?.focus());
  }
};

const toggle = () => {
  if (isOpen.value) close();
  else open();
};

const select = (value: string | number | null) => {
  emit("update:modelValue", value);
  close(true);
};

const moveHighlight = (delta: number) => {
  const len = visibleOptions.value.length;
  if (!len) return;
  highlightedIndex.value = (highlightedIndex.value + delta + len) % len;
  void nextTick(scrollHighlightedIntoView);
};

const moveToBoundary = (boundary: "start" | "end") => {
  if (!visibleOptions.value.length) return;
  highlightedIndex.value =
    boundary === "start" ? 0 : visibleOptions.value.length - 1;
  void nextTick(scrollHighlightedIntoView);
};

const selectHighlighted = () => {
  const option = visibleOptions.value[highlightedIndex.value];
  if (option) select(option.value);
};

const onTriggerConfirm = () => {
  if (isOpen.value) selectHighlighted();
  else open();
};

const scrollHighlightedIntoView = () => {
  const id = activeOptionId.value;
  if (!id) return;
  document.getElementById(id)?.scrollIntoView({ block: "nearest" });
};

watch(searchQuery, (query) => {
  highlightedIndex.value = 0;
  emit("search", query);
  if (isOpen.value) void nextTick(computeOverlayRect);
});

watch(visibleOptions, () => {
  const lastIndex = Math.max(0, visibleOptions.value.length - 1);
  highlightedIndex.value = Math.min(highlightedIndex.value, lastIndex);
  if (isOpen.value) {
    void nextTick(() => {
      computeOverlayRect();
      scrollHighlightedIntoView();
    });
  }
});

// ── Outside click ─────────────────────────────────────────────────────────────
const handleOutsidePointerDown = (event: MouseEvent) => {
  if (!isOpen.value) return;
  const root = rootRef.value;
  const overlay = overlayRef.value;
  const target = event.target as Node;
  if ((root && root.contains(target)) || (overlay && overlay.contains(target))) return;
  close();
};

const handleViewportChange = () => {
  if (isOpen.value) computeOverlayRect();
};

onMounted(() => {
  document.addEventListener("pointerdown", handleOutsidePointerDown);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleOutsidePointerDown);
  window.removeEventListener("resize", handleViewportChange);
  window.removeEventListener("scroll", handleViewportChange, true);
});
</script>

<style scoped>
/* ── Root ──────────────────────────────────────────────────────────────────── */
.m-select {
  position: relative;
  display: inline-block;
  width: 100%;
}

/* ── Trigger ───────────────────────────────────────────────────────────────── */
.m-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  width: 100%;
  padding: 0.43rem 0.65rem;
  background: #ffffff;
  border: 1px solid var(--p-slate-300, #cbd5e1);
  border-radius: 6px;
  font-size: 0.875rem;
  color: var(--p-slate-800, #1e293b);
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  transition: border-color 0.15s, box-shadow 0.15s;
  min-height: 2.25rem;
  box-sizing: border-box;
  font-family: inherit;
}

.size-small .m-select-trigger {
  padding: 0.28rem 0.5rem;
  font-size: 0.8rem;
  min-height: 1.9rem;
}

.m-select-trigger:hover {
  border-color: var(--p-slate-400, #94a3b8);
}

.m-select-trigger:focus {
  outline: none;
  border-color: #a5b4fc;
  box-shadow: 0 0 0 2px #f1f4fe;
}

.is-open .m-select-trigger {
  border-color: #a5b4fc;
  box-shadow: 0 0 0 2px #f1f4fe;
}

.m-select-trigger:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

/* ── Value / Placeholder ───────────────────────────────────────────────────── */
.m-select-value {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--p-slate-800, #1e293b);
}

.m-select-value.is-placeholder {
  color: var(--p-slate-400, #94a3b8);
}

/* ── Chevron ───────────────────────────────────────────────────────────────── */
.m-select-chevron {
  font-size: 0.65rem;
  color: var(--p-slate-500, #64748b);
  flex-shrink: 0;
  transition: transform 0.18s ease;
}

.is-open .m-select-chevron {
  transform: rotate(180deg);
}

.size-small .m-select-chevron {
  font-size: 0.6rem;
}

@media (prefers-reduced-motion: reduce) {
  .m-select-trigger,
  .m-select-chevron {
    transition: none;
  }
}

/* ── Overlay (teleported to body) ──────────────────────────────────────────── */
/* NOTE: :deep does not apply to teleported content. These styles are global. */
</style>

<!-- Global overlay styles (not scoped — teleported outside component root) -->
<style>
.m-select-overlay {
  background: #ffffff;
  border: 1px solid var(--p-slate-200, #e2e8f0);
  border-radius: 6px;
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -2px rgba(0, 0, 0, 0.06);
  overflow-y: auto;
  max-height: 220px;
  padding: 0.2rem 0;
}

.m-select-search {
  position: sticky;
  z-index: 1;
  top: -0.2rem;
  display: flex;
  align-items: center;
  margin: -0.2rem 0 0.2rem;
  padding: 0.42rem;
  border-bottom: 1px solid var(--p-slate-200, #e2e8f0);
  background: #ffffff;
}

.m-select-search > i {
  position: absolute;
  left: 0.85rem;
  color: var(--p-slate-400, #94a3b8);
  font-size: 0.72rem;
}

.m-select-search > input {
  width: 100%;
  height: 1.9rem;
  padding: 0 0.55rem 0 1.65rem;
  border: 1px solid var(--p-slate-300, #cbd5e1);
  border-radius: 4px;
  outline: none;
  background: #ffffff;
  color: var(--p-slate-800, #1e293b);
  font: inherit;
  font-size: 0.78rem;
}

.m-select-search > input:focus {
  border-color: #a5b4fc;
  box-shadow: 0 0 0 2px #f1f4fe;
}

.m-select-option {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.35rem 0.6rem;
  font-size: 0.82rem;
  color: var(--p-slate-700, #334155);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.1s;
}

.m-select-options {
  outline: none;
}

.m-select-option:hover,
.m-select-option.is-highlighted {
  background: #f1f4fe;
  color: #4f46e5;
}

.m-select-option.is-selected {
  background: #f1f4fe;
  color: #4f46e5;
  font-weight: 500;
}

.m-select-option.is-selected.is-highlighted {
  background: #e0e7ff;
}

.m-select-option-check {
  font-size: 0.65rem;
  color: #4f46e5;
  flex-shrink: 0;
  width: 0.75rem;
}

.m-select-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  color: var(--p-slate-400, #94a3b8);
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .m-select-option {
    transition: none;
  }
}
</style>
