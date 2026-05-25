import { RequestRoutes } from "../types/request";

export type ApiResponse = {
  status: "ok" | "error";
  message: any;
};

export const isChromeExtension = Boolean(
  typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id
);

export enum ApiRequestType {
  NORMAL = "normal",
  STREAM = "stream"
}

type MessagePayload = {
  action: RequestRoutes;
  mode: ApiRequestType;
  data: any;
};

// ============================================================================
// Main API Function
// ============================================================================

const callApi = async (
  route: RequestRoutes,
  payload: any = {},
  mode: ApiRequestType = ApiRequestType.NORMAL,
  streamHandler?: Function
): Promise<ApiResponse> => {
  let activeTab: chrome.tabs.Tab;

  try {
    activeTab = await getActiveNetsuiteTab();
  } catch {
    try {
      activeTab = await findExistingNetsuiteTab();
    } catch {
      throw new Error("No NetSuite tab found. Open a NetSuite page first.");
    }
  }

  const messagePayload: MessagePayload = {
    action: route,
    data: payload,
    mode
  };

  // =========================
  // STREAM MODE (PORTS)
  // =========================
  if (mode === ApiRequestType.STREAM) {
    return new Promise(async (resolve, reject) => {
      let activeTab: chrome.tabs.Tab;

      try {
        activeTab = await getActiveNetsuiteTab();
      } catch {
        try {
          activeTab = await findExistingNetsuiteTab();
        } catch {
          reject(new Error("No NetSuite tab found. Open a NetSuite page first."));
          return;
        }
      }

      const connectAndStream = (tabId: number): void => {
        const port = chrome.tabs.connect(tabId, {
          name: "stream-api"
        });

        port.onMessage.addListener(async (message: any) => {
          if (message.status === "API_NOT_AVAILABLE") {
            console.log("[callApi] Stream API not available — trying existing NetSuite tab");

            port.disconnect();

            try {
              const existingTab = await findExistingNetsuiteTab(activeTab.url);
              if (existingTab.id && existingTab.id !== tabId) {
                connectAndStream(existingTab.id);
              } else {
                reject(new Error("NetSuite SuiteScript API is not available on this page."));
              }
            } catch (err) {
              reject(err);
            }

            return;
          }

          if (streamHandler) {
            streamHandler(message);
          }

          if (message.isComplete) {
            port.disconnect();

            resolve(message);
          }
        });

        port.onDisconnect.addListener(() => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          }
        });

        port.postMessage(messagePayload);
      };

      // Initial attempt (active tab)
      connectAndStream(activeTab.id!);
    });
  }

  // =========================
  // NORMAL MODE
  // =========================
  try {
    return await sendMessageToTab(activeTab.id!, messagePayload);
  } catch (error) {
    try {
      const existingTab = await findExistingNetsuiteTab(activeTab.url);
      if (existingTab.id !== activeTab.id) {
        return await sendMessageToTab(existingTab.id!, messagePayload);
      }
    } catch {
      // No existing connected tab works; surface the original failure.
    }
    throw error;
  }
};

// ============================================================================
// Tab Helpers
// ============================================================================

const getActiveNetsuiteTab = (): Promise<chrome.tabs.Tab> => {
  return new Promise((resolve, reject) => {
    if (typeof chrome === "undefined" || !chrome.tabs) {
      return reject(new Error("Chrome tabs API not available"));
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const currentTab = tabs[0];

      if (!currentTab?.id) {
        return reject(new Error("No active tab found"));
      }

      if (!isNetsuiteTab(currentTab)) {
        return reject(new Error("Not a netsuite tab"));
      }

      resolve(currentTab);
    });
  });
};

const isNetsuiteTab = (tab: chrome.tabs.Tab): boolean => {
  try {
    return !!tab.url?.includes("app.netsuite.com");
  } catch {
    return false;
  }
};

const extractAccountIdFromUrl = (url: string): string | null => {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split(".");
    if (parts.length < 3) return null;
    return parts[0]!.toUpperCase().replace(/-/g, "_");
  } catch {
    return null;
  }
};

const findExistingNetsuiteTab = async (
  currentUrl?: string
): Promise<chrome.tabs.Tab> => {
  const allTabs = await chrome.tabs.query({});
  const netsuiteTabs = allTabs.filter(
    (tab) => tab.url?.includes("app.netsuite.com") && tab.id
  );

  if (netsuiteTabs.length === 0) {
    throw new Error("No NetSuite tabs found in any window");
  }

  // Check connection status for each NS tab in parallel (same pattern as getPreferredNetsuiteTab)
  const connectionChecks = netsuiteTabs.map(async (tab) => {
    try {
      const response = await sendMessageToTab(tab.id!, {
        action: RequestRoutes.CHECK_CONNECTION,
        data: {},
        mode: ApiRequestType.NORMAL
      });
      return {
        tab,
        connected: response?.message === "connected",
        accountId: extractAccountIdFromUrl(tab.url!)
      };
    } catch {
      return { tab, connected: false, accountId: null };
    }
  });

  const results = await Promise.all(connectionChecks);
  const connectedTabs = results.filter((r) => r.connected);

  if (connectedTabs.length === 0) {
    throw new Error("No connected NetSuite tabs found");
  }

  // If we know the target account (same environment as sidepanel's tab), match by account ID
  if (currentUrl) {
    const targetAccountId = extractAccountIdFromUrl(currentUrl);
    if (targetAccountId) {
      const matchingTab = connectedTabs.find((r) => r.accountId === targetAccountId);
      if (matchingTab) {
        return matchingTab.tab;
      }
    }
  }

  // Fall back to the first connected tab from any account
  return connectedTabs[0]!.tab;
};

// ============================================================================
// Messaging
// ============================================================================

const sendMessageToTab = (
  tabId: number,
  payload: MessagePayload
): Promise<ApiResponse> => {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response: any) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (response?.status === "API_NOT_AVAILABLE") {
        reject(new Error("NetSuite SuiteScript API is not available on this page."));
        return;
      }

      resolve(response);
    });
  });
};

// ============================================================================
// Other Exports
// ============================================================================

const closePanel = (): void => {
  chrome.runtime.sendMessage({ type: "CLOSE_PANEL" });
};

/**
 * Get the current NetSuite environment domain (e.g. "1234567.app.netsuite.com").
 * Returns "unknown" if not available.
 */
const getNetsuiteEnvironment = async (): Promise<string> => {
  try {
    const tab = await getActiveNetsuiteTab();
    if (tab.url) {
      const url = new URL(tab.url);
      return url.hostname;
    }
  } catch {
    try {
      const tab = await findExistingNetsuiteTab();
      if (tab.url) {
        const url = new URL(tab.url);
        return url.hostname;
      }
    } catch {
      // Fall through
    }
  }
  return "unknown";
};

export { callApi, closePanel, getNetsuiteEnvironment };
