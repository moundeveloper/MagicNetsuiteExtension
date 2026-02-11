import { computed, ref } from "vue";

export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

export interface CodeViewerAPI {
  search: (query: string, options?: SearchOptions) => void;
  getMatches: () => { from: number; to: number }[];
  externalSelection: (from: number, to: number, scroll?: boolean) => void;
  clearSelection: () => void;
  id: string;
  rootEl?: HTMLElement | null;
  matchLineMap?: Map<{ from: number; to: number }, HTMLElement>;
}

export const useCodeViewerSearch = () => {
  const viewers = ref<CodeViewerAPI[]>([]);
  const activeViewer = ref<CodeViewerAPI | null>(null); // ← Make this reactive!

  const allMatches = ref<{ viewer: CodeViewerAPI; from: number; to: number }[]>(
    []
  );

  const currentIndex = ref(0);

  const registerViewer = (viewer: CodeViewerAPI | null | undefined) => {
    if (!viewer) return;

    const exists = viewers.value.some((v) => v.id === viewer.id);
    if (exists) return;

    viewers.value.push(viewer);
  };

  const unregisterViewer = (id: string) => {
    viewers.value = viewers.value.filter((v) => v.id !== id);

    // clean active viewer if it was removed
    if (activeViewer.value?.id === id) {
      activeViewer.value = null;
    }

    // also remove its matches
    allMatches.value = allMatches.value.filter((m) => m.viewer.id !== id);

    currentIndex.value = 0;
  };

  const clearAllSelections = () => {
    viewers.value.forEach((v) => v.clearSelection());
    activeViewer.value = null; // ← Use .value
  };

  const search = (query: string, options?: SearchOptions) => {
    allMatches.value = [];
    currentIndex.value = 0;

    clearAllSelections();

    viewers.value.forEach((viewer) => {
      viewer.search(query, options);
      viewer.getMatches().forEach((m) => {
        allMatches.value.push({ viewer, ...m });
      });
    });

    if (allMatches.value.length) {
      select(0);
    }
  };

  const select = (index: number) => {
    const match = allMatches.value[index];
    if (!match) return;

    // clear previous
    if (activeViewer.value && activeViewer.value !== match.viewer) {
      activeViewer.value.clearSelection();
    }

    activeViewer.value = match.viewer; // ← Use .value
    currentIndex.value = index;

    // select in CodeMirror
    match.viewer.externalSelection(match.from, match.to, false);

    // --- smooth scroll using DOM, optimized ---
    requestAnimationFrame(() => {
      let lineEl: HTMLElement | undefined;

      // Use precomputed line map if available
      if (match.viewer.matchLineMap) {
        for (const [key, el] of match.viewer.matchLineMap) {
          if (key.from === match.from && key.to === match.to) {
            lineEl = el;
            break;
          }
        }
      }

      // Fallback to root element if line not found
      (lineEl || match.viewer.rootEl)?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    });
  };

  const next = () => {
    if (!allMatches.value.length) return;
    select((currentIndex.value + 1) % allMatches.value.length);
  };

  const previous = () => {
    if (!allMatches.value.length) return;
    select(
      (currentIndex.value - 1 + allMatches.value.length) %
        allMatches.value.length
    );
  };

  return {
    registerViewer,
    unregisterViewer,
    search,
    next,
    previous,
    hasMatches: () => allMatches.value.length > 0,
    matchesCount: computed(() => allMatches.value.length),
    currentIndex: computed(
      () => allMatches.value.length && currentIndex.value + 1
    ),
    getCurrentViewer: () => activeViewer.value, // ← Use .value
    activeViewerId: computed(() => activeViewer.value?.id || "") // ← Add this for easier tracking
  };
};
