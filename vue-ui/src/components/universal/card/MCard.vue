<template>
  <component
    :is="tag"
    ref="cardRef"
    class="m-card"
    :class="cardClasses"
    :style="cardStyles"
  >
    <slot :contentHeight="contentHeight"></slot>
  </component>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue";

type MCardProps = {
  tag?: string;
  flex?: boolean;
  direction?: "row" | "column" | "row-reverse" | "column-reverse";
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
  align?: "start" | "center" | "end" | "stretch" | "baseline";
  wrap?: boolean | "wrap" | "nowrap" | "wrap-reverse";
  gap?: string;
  padding?: string;
  outlined?: boolean;
  elevated?: boolean;
  radius?: string;
  autoHeight?: boolean;
};

const props = withDefaults(defineProps<MCardProps>(), {
  tag: "div",
  flex: false,
  direction: "row",
  justify: "start",
  align: "stretch",
  wrap: false,
  gap: "1rem",
  padding: "1rem",
  outlined: false,
  elevated: false,
  radius: "0.5rem",
  autoHeight: false
});

const cardRef = ref<HTMLElement | null>(null);
const contentHeight = ref(0);

const updateContentHeight = () => {
  if (cardRef.value && props.autoHeight) {
    contentHeight.value = cardRef.value.clientHeight;
  }
};

const resizeObserver = ref<ResizeObserver | null>(null);

onMounted(() => {
  if (props.autoHeight) {
    updateContentHeight();
    window.addEventListener("resize", updateContentHeight);

    // Observe the card element itself for size changes
    resizeObserver.value = new ResizeObserver(() => {
      updateContentHeight();
    });
    if (cardRef.value) {
      resizeObserver.value.observe(cardRef.value);
    }
  }
});

onUnmounted(() => {
  if (props.autoHeight) {
    window.removeEventListener("resize", updateContentHeight);
    resizeObserver.value?.disconnect();
  }
});

const justifyMap = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
  around: "space-around",
  evenly: "space-evenly"
};

const alignMap = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  stretch: "stretch",
  baseline: "baseline"
};

const cardClasses = computed(() => ({
  "is-flex": props.flex,
  "is-outlined": props.outlined,
  "is-elevated": props.elevated
}));

const cardStyles = computed(() => {
  const styles: Record<string, string> = {
    padding: props.padding,
    borderRadius: props.radius
  };

  if (props.autoHeight) {
    styles.flex = "1";
    styles.minHeight = "0";
  }

  if (props.flex) {
    styles.display = "flex";
    styles.flexDirection = props.direction;
    styles.justifyContent = justifyMap[props.justify];
    styles.alignItems = alignMap[props.align];
    styles.gap = props.gap;

    if (props.wrap === true) {
      styles.flexWrap = "wrap";
    } else if (typeof props.wrap === "string") {
      styles.flexWrap = props.wrap;
    }
  }

  return styles;
});
</script>

<style scoped>
.m-card {
  background: var(--p-slate-100);
  transition:
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.m-card.is-outlined {
  outline: 1px solid var(--p-slate-300);
}

.m-card.is-elevated {
  box-shadow: 0 4px 12px rgba(41, 41, 41, 0.1);
}
</style>
