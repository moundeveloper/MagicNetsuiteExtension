import { ref, computed } from "vue";
import type { SearchOptions } from "./useCodeViewerSearch";

export interface CodeViewerAPI {
  search: (query: string, options?: SearchOptions) => void;
  getMatches: () => { from: number; to: number }[];
  externalSelection: (from: number, to: number, scroll?: boolean) => void;
  clearSelection: () => void;
  id: string;
}

export const useSingleCodeViewerSearch = () => {
  const viewer = ref<CodeViewerAPI | null>(null);
  const currentMatchIndex = ref(0);
  const matches = ref<{ from: number; to: number }[]>([]);

  const registerViewer = (el: CodeViewerAPI | null | undefined) => {
    if (!el) return;

    // prevent duplicate registration
    if (viewer.value?.id === el.id) return;

    viewer.value = el;
  };

  const search = (query: string, options?: SearchOptions) => {
    if (!viewer.value) return;

    viewer.value.clearSelection();
    viewer.value.search(query, options);

    matches.value = viewer.value.getMatches();
    currentMatchIndex.value = 0;

    if (matches.value.length) {
      const m = matches.value[0]!;
      viewer.value.externalSelection(m.from, m.to, true);
    }
  };

  const select = (index: number) => {
    if (!viewer.value) return;
    if (!matches.value.length) return;

    currentMatchIndex.value = index;

    const m = matches.value[index]!;
    viewer.value.externalSelection(m.from, m.to, true);
  };

  const next = () => {
    if (!matches.value.length) return;
    select((currentMatchIndex.value + 1) % matches.value.length);
  };

  const previous = () => {
    if (!matches.value.length) return;
    select(
      (currentMatchIndex.value - 1 + matches.value.length) %
        matches.value.length
    );
  };

  return {
    registerViewer,
    search,
    next,
    previous,
    hasMatches: computed(() => matches.value.length > 0),
    matchesCount: computed(() => matches.value.length),
    currentIndex: computed(() =>
      matches.value.length ? currentMatchIndex.value + 1 : 0
    )
  };
};
