<template>
  <div ref="rootRef" class="m-select" :class="[{ 'is-open': isOpen, 'size-small': size === 'small' }]">
    <button
      ref="triggerRef"
      type="button"
      class="m-select-trigger"
      :disabled="disabled"
      :title="displayValue"
      :aria-expanded="isOpen"
      :aria-haspopup="true"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
      @keydown.escape.prevent="close"
      @keydown.arrow-down.prevent="isOpen ? moveHighlight(1) : open()"
      @keydown.arrow-up.prevent="isOpen ? moveHighlight(-1) : open()"
      @keydown.tab="close"
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
        @mousedown.prevent
      >
        <div
          v-for="(opt, i) in normalizedOptions"
          :key="String(opt.value)"
          class="m-select-option"
          :class="{
            'is-selected': opt.value === modelValue,
            'is-highlighted': i === highlightedIndex
          }"
          @click="select(opt.value)"
          @mouseenter="highlightedIndex = i"
        >
          <i
            class="pi pi-check m-select-option-check"
            :style="{ visibility: opt.value === modelValue ? 'visible' : 'hidden' }"
          ></i>
          <span :title="opt.label">{{ opt.label }}</span>
        </div>
        <div v-if="normalizedOptions.length === 0" class="m-select-empty">
          No options
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  modelValue?: string | number | null;
  options?: Array<string | Record<string, any>>;
  optionLabel?: string;
  optionValue?: string;
  placeholder?: string;
  size?: "small" | "default";
  disabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  options: () => [],
  optionLabel: "label",
  optionValue: "value",
  placeholder: "Select...",
  size: "default",
  disabled: false
});

const emit = defineEmits<{
  "update:modelValue": [value: string | number | null];
}>();

// ── State ─────────────────────────────────────────────────────────────────────
const rootRef = ref<HTMLElement | null>(null);
const triggerRef = ref<HTMLButtonElement | null>(null);
const overlayRef = ref<HTMLElement | null>(null);
const isOpen = ref(false);
const highlightedIndex = ref(0);
const overlayRect = ref<{
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
} | null>(null);

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

const hasValue = computed(
  () => props.modelValue !== null && props.modelValue !== undefined && props.modelValue !== ""
);

const displayValue = computed(() => {
  if (!hasValue.value) return props.placeholder;
  const match = normalizedOptions.value.find((o) => o.value === props.modelValue);
  return match ? match.label : String(props.modelValue);
});

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
  const preferredHeight = Math.min(220, normalizedOptions.value.length * 34 + 8);
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
  computeOverlayRect();
  isOpen.value = true;
  const idx = normalizedOptions.value.findIndex((o) => o.value === props.modelValue);
  highlightedIndex.value = idx >= 0 ? idx : 0;
};

const close = () => {
  isOpen.value = false;
};

const toggle = () => {
  if (isOpen.value) close();
  else open();
};

const select = (value: string | number | null) => {
  emit("update:modelValue", value);
  close();
};

const moveHighlight = (delta: number) => {
  const len = normalizedOptions.value.length;
  if (!len) return;
  highlightedIndex.value = (highlightedIndex.value + delta + len) % len;
};

// Keyboard: Enter while highlight active selects the highlighted option
const handleKeydown = (e: KeyboardEvent) => {
  if (!isOpen.value) return;
  if (e.key === "Enter") {
    const opt = normalizedOptions.value[highlightedIndex.value];
    if (opt) select(opt.value);
  }
};

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
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", handleViewportChange);
  window.addEventListener("scroll", handleViewportChange, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleOutsidePointerDown);
  document.removeEventListener("keydown", handleKeydown);
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
  border-color: #c6a7ff;
  box-shadow: 0 0 0 2px #faf7ff;
}

.is-open .m-select-trigger {
  border-color: #c6a7ff;
  box-shadow: 0 0 0 2px #faf7ff;
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

.m-select-option:hover,
.m-select-option.is-highlighted {
  background: #faf7ff;
  color: #7b2ff7;
}

.m-select-option.is-selected {
  background: #faf7ff;
  color: #7b2ff7;
  font-weight: 500;
}

.m-select-option.is-selected.is-highlighted {
  background: #f1eaff;
}

.m-select-option-check {
  font-size: 0.65rem;
  color: #7b2ff7;
  flex-shrink: 0;
  width: 0.75rem;
}

.m-select-empty {
  padding: 0.5rem 0.75rem;
  font-size: 0.8rem;
  color: var(--p-slate-400, #94a3b8);
  text-align: center;
}
</style>
