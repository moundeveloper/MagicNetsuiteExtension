import type { RequestRoutes } from "../types/request";

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
  const activeTab = await getActiveNetsuiteTab();
  const messagePayload: MessagePayload = {
    action: route,
    data: payload,
    mode
  };

  // =========================
  // STREAM MODE (PORTS)
  // =========================
  if (mode === ApiRequestType.STREAM) {
    return new Promise((resolve, reject) => {
      // 🔑 Open a persistent port
      const port = chrome.tabs.connect(activeTab.id!, {
        name: "stream-api"
      });

      // Receive stream chunks
      port.onMessage.addListener((message: any) => {
        if (streamHandler) {
          streamHandler(message);
        }

        // Resolve when stream completes
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

      // Send initial request (same payload as before)
      port.postMessage(messagePayload);
    });
  }

  // =========================
  // NORMAL MODE
  // =========================
  try {
    return await sendMessageToTab(activeTab.id!, messagePayload);
  } catch (error) {
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

const isTemporaryTab = (tab: chrome.tabs.Tab): boolean => {
  try {
    return !!tab.url?.includes("tempTab=true");
  } catch {
    return false;
  }
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

export { callApi, closePanel };
