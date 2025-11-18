import { ref, onMounted, nextTick, onUnmounted, type Ref, watch } from "vue";

export function useVhOffset(containerRef: Ref<HTMLElement | null>) {
  const vhOffset = ref(0);

  const calculateVhOffset = () => {
    const element = containerRef.value;
    if (!element) return;

    const children = Array.from(element.children).filter((child) => {
      return (
        !child.classList.contains("ignore") &&
        !child.hasAttribute("data-ignore")
      );
    });

    const containerHeight = element.getBoundingClientRect().height;
    const viewportHeight = window.innerHeight;

    if (!containerHeight || !viewportHeight) return;

    const totalContentHeight = children.reduce((sum, child) => {
      const childHeight = child.getBoundingClientRect().height;
      return sum + (childHeight || 0);
    }, 0);

    const gap = parseFloat(getComputedStyle(element).rowGap || "0"); // works with CSS gaps
    const totalGapHeight = (children.length - 1) * gap;

    const usedHeight = totalContentHeight + totalGapHeight;
    const diff = containerHeight - usedHeight;

    const vhValue = (diff / viewportHeight) * 100;

    vhOffset.value = Math.max(0, Math.round(vhValue));
  };

  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;

  const startObserving = () => {
    const el = containerRef.value;
    if (!el) return;

    resizeObserver = new ResizeObserver(() => calculateVhOffset());
    resizeObserver.observe(el);

    mutationObserver = new MutationObserver(() => {
      nextTick(() => calculateVhOffset());
    });
    mutationObserver.observe(el, { childList: true, subtree: true });

    calculateVhOffset();
  };

  const stopObserving = () => {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
  };

  onMounted(async () => {
    await nextTick();
    startObserving();
  });

  onUnmounted(() => {
    stopObserving();
  });

  watch(containerRef, (newVal, oldVal) => {
    if (newVal !== oldVal) {
      stopObserving();
      nextTick(startObserving);
    }
  });

  return { vhOffset };
}
