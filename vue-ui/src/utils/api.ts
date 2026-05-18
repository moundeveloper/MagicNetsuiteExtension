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

      const connectAndStream = (tabId: number, isTemp = false): void => {
        const port = chrome.tabs.connect(tabId, {
          name: "stream-api"
        });

        port.onMessage.addListener(async (message: any) => {
          // 🚨 STREAM-SPECIFIC FALLBACK
          if (message.status === "API_NOT_AVAILABLE" && !isTemp) {
            console.log("[callApi] Stream API not available — trying existing NetSuite tab");

            port.disconnect();

            // Try existing NetSuite tabs from the same account first
            try {
              const existingTab = await findExistingNetsuiteTab(activeTab.url);
              connectAndStream(existingTab.id!, false);
            } catch {
              try {
                const tempTab = await createTemporaryTab(activeTab.url!);
                connectAndStream(tempTab.id!, true);
              } catch (err) {
                reject(err);
              }
            }

            return;
          }

          if (streamHandler) {
            streamHandler(message);
          }

          if (message.isComplete) {
            port.disconnect();

            if (isTemp) {
              chrome.tabs.remove(tabId);
            }

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
    // Before creating a temp tab, try existing NetSuite tabs from the same account
    try {
      const existingTab = await findExistingNetsuiteTab(activeTab.url);
      if (existingTab.id !== activeTab.id) {
        return await sendMessageToTab(existingTab.id!, messagePayload);
      }
    } catch {
      // No existing tab works, fall back to temp tab
    }
    return await handleFallbackWithTempTab(activeTab, messagePayload);
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

      if (isTemporaryTab(currentTab)) {
        return reject(new Error("Temp tab"));
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
    (tab) => tab.url?.includes("app.netsuite.com") && tab.id && !tab.url.includes("tempTab=true")
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

const isTemporaryTab = (tab: chrome.tabs.Tab): boolean => {
  try {
    return !!tab.url?.includes("tempTab=true");
  } catch {
    return false;
  }
};

const createTemporaryTab = (currentUrl: string): Promise<chrome.tabs.Tab> => {
  return new Promise((resolve, reject) => {
    const url = buildTempTabUrl(currentUrl);

    chrome.tabs.create({ url, active: false }, (tab) => {
      if (!tab.id) {
        return reject(new Error("Failed to create temp tab"));
      }

      waitForTabLoad(tab.id, () => {
        resolve(tab);
      });
    });
  });
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
      if (
        chrome.runtime.lastError ||
        response?.status === "API_NOT_AVAILABLE"
      ) {
        reject(new Error("Content script not available"));
      } else {
        resolve(response);
      }
    });
  });
};

// ============================================================================
// Temporary Tab Fallback
// ============================================================================

const handleFallbackWithTempTab = async (
  currentTab: chrome.tabs.Tab,
  payload: MessagePayload
): Promise<ApiResponse> => {
  // Try existing NetSuite tabs from the same account first
  try {
    const existingTab = await findExistingNetsuiteTab(currentTab.url);
    if (existingTab.id !== currentTab.id) {
      return await sendMessageToTab(existingTab.id!, payload);
    }
  } catch {
    // No existing tab works, fall back to temp tab
  }

  console.log("API not available, creating temp tab");

  const netsuiteUrl = buildTempTabUrl(currentTab.url!);
  return await fetchFromTemporaryTab(netsuiteUrl, payload);
};

const buildTempTabUrl = (currentUrl: string): string => {
  const urlInstance = new URL(currentUrl);
  const baseUrl = `${urlInstance.protocol}//${urlInstance.host}`;
  return `${baseUrl}/app/setup/mainsetup.nl?sc=-90&tempTab=true`;
};

const fetchFromTemporaryTab = (
  url: string,
  payload: MessagePayload
): Promise<ApiResponse> => {
  return new Promise((resolve, reject) => {
    console.log("Creating temp tab", { payload });

    chrome.tabs.create({ url, active: false }, (tab) => {
      if (!tab.id) {
        return reject(new Error("Failed to create temp tab"));
      }

      const cleanup = () => chrome.tabs.remove(tab.id!);

      waitForTabLoad(tab.id, async () => {
        try {
          const response = await sendMessageToTab(tab.id!, payload);
          cleanup();
          resolve(response);
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    });
  });
};

const waitForTabLoad = (tabId: number, callback: () => void): void => {
  const listener = (
    id: number,
    changeInfo: { status?: string; [key: string]: any }
  ) => {
    if (id === tabId && changeInfo.status === "complete") {
      chrome.tabs.onUpdated.removeListener(listener);
      callback();
    }
  };

  chrome.tabs.onUpdated.addListener(listener);
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
