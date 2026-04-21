// useModuleScraper.ts
// Composable that connects to the content script via a Chrome port and streams
// scraping progress for SuiteScript module documentation.
import { ref } from "vue";
import type { RawModule } from "../utils/modulesDb";

export type ScrapeStatus =
  | "idle"
  | "connecting"
  | "scraping"
  | "complete"
  | "error";

export interface ScrapeState {
  status: ScrapeStatus;
  current: number;
  total: number;
  currentModule: string;
  error: string | null;
}

export const useModuleScraper = () => {
  const state = ref<ScrapeState>({
    status: "idle",
    current: 0,
    total: 0,
    currentModule: "",
    error: null,
  });

  let activePort: chrome.runtime.Port | null = null;

  const reset = () => {
    state.value = { status: "idle", current: 0, total: 0, currentModule: "", error: null };
  };

  const cancel = () => {
    activePort?.disconnect();
    activePort = null;
    reset();
  };

  /**
   * Opens the stream port to the active netsuite.com tab and starts scraping.
   * Resolves with the scraped RawModule[] on success, or rejects with an Error.
   */
  const scrape = (): Promise<RawModule[]> => {
    return new Promise(async (resolve, reject) => {
      // Find active netsuite.com tab
      state.value.status = "connecting";

      let tabs: chrome.tabs.Tab[];
      try {
        tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      } catch (e) {
        state.value.status = "error";
        state.value.error = "Could not query browser tabs.";
        return reject(new Error(state.value.error));
      }

      const netsuiteTab = tabs.find((t) => t.url?.includes("netsuite.com"));
      if (!netsuiteTab?.id) {
        state.value.status = "error";
        state.value.error =
          "No active NetSuite tab found. Open a NetSuite page first.";
        return reject(new Error(state.value.error));
      }

      const tabId = netsuiteTab.id;
      const tabUrl = new URL(netsuiteTab.url!);
      const baseUrl = `${tabUrl.protocol}//${tabUrl.hostname}`;

      // Connect to the content script via stream-api port
      let port: chrome.runtime.Port;
      try {
        port = chrome.tabs.connect(tabId, { name: "stream-api" });
        activePort = port;
      } catch (e) {
        state.value.status = "error";
        state.value.error = "Could not connect to content script. Reload the NetSuite page and try again.";
        return reject(new Error(state.value.error));
      }

      port.onMessage.addListener((chunk: Record<string, unknown>) => {
        const type = chunk.type as string;

        if (type === "progress") {
          state.value.status = "scraping";
          state.value.current = chunk.current as number;
          state.value.total = chunk.total as number;
          state.value.currentModule = chunk.moduleName as string;
          return;
        }

        if (type === "complete") {
          state.value.status = "complete";
          state.value.current = state.value.total;
          port.disconnect();
          activePort = null;
          resolve(chunk.data as RawModule[]);
          return;
        }

        if (type === "error") {
          state.value.status = "error";
          state.value.error = (chunk.error as string) || "Unknown scraping error.";
          port.disconnect();
          activePort = null;
          reject(new Error(state.value.error));
        }
      });

      port.onDisconnect.addListener(() => {
        activePort = null;
        if (state.value.status === "scraping" || state.value.status === "connecting") {
          state.value.status = "error";
          state.value.error = "Connection to content script was lost.";
          reject(new Error(state.value.error));
        }
      });

      // Start the scrape
      state.value.status = "scraping";
      port.postMessage({ action: "SCRAPE_SUITESCRIPT_MODULES", mode: "stream", data: { baseUrl } });
    });
  };

  return { state, scrape, cancel, reset };
};
