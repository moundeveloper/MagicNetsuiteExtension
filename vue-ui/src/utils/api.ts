import type { RequestRoutes } from "../types/request";

export type ApiResponse = {
  status: "ok" | "error";
  message: any;
};

export const isChromeExtension = Boolean(
  typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id,
);

const callApi = async (
  route: RequestRoutes,
  payload: any = {},
): Promise<ApiResponse> => {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const currentTab = tabs[0];
      if (!currentTab || !currentTab.id)
        return reject(new Error("No active tab found"));

      if (!isNetsuiteTab(currentTab))
        return reject(new Error("Not a netsuite tab"));

      if (isTemporaryTab(currentTab)) return reject(new Error("Temp tab"));

      // First try current tab
      chrome.tabs.sendMessage(
        currentTab.id,
        { action: route, data: payload },
        async (response: any) => {
          if (
            chrome.runtime.lastError ||
            response?.status === "API_NOT_AVAILABLE"
          ) {
            // Fallback: create temporary tab
            console.log("API not available, creating temp tab");
            try {
              const urlInstance = new URL(currentTab.url!);
              const baseUrl = `${urlInstance.protocol}//${urlInstance.host}`;
              const netsuiteUrl = `${baseUrl}/app/setup/mainsetup.nl?sc=-90&tempTab=true`;
              const data = await fetchFromTemporaryTab(
                netsuiteUrl,
                route,
                payload,
              );
              resolve(data);
            } catch (err) {
              reject(err);
            }
          } else {
            resolve(response);
          }
        },
      );
    });
  });
};

const isTemporaryTab = (tab: chrome.tabs.Tab) => {
  try {
    return !!tab.url?.includes("tempTab=true");
  } catch {
    return false;
  }
};

const isNetsuiteTab = (tab: chrome.tabs.Tab) => {
  try {
    console.log("Tab URL:", tab);
    return !!tab.url?.includes("app.netsuite.com");
  } catch {
    return false;
  }
};

const fetchFromTemporaryTab = (
  url: string,
  route: RequestRoutes,
  payload: any,
) => {
  return new Promise<ApiResponse>((resolve, reject) => {
    console.log("Creating temp tab", { route, payload });
    chrome.tabs.create(
      {
        url: url,
        active: false,
      },
      (tab) => {
        if (!tab.id) return reject(new Error("Failed to create temp tab"));
        const newTabId = tab.id;

        const listener = (
          tabId: number,
          changeInfo: { status?: string; [key: string]: any },
        ) => {
          if (tabId === newTabId && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);

            chrome.tabs.sendMessage(
              newTabId,
              { action: route, data: payload },
              (response) => {
                if (!response || chrome.runtime.lastError) {
                  chrome.tabs.remove(newTabId);
                  return reject(
                    chrome.runtime.lastError ||
                      new Error("No response from temp tab"),
                  );
                }

                chrome.tabs.remove(newTabId);
                resolve(response);
              },
            );
          }
        };

        chrome.tabs.onUpdated.addListener(listener);
      },
    );
  });
};

const closePanel = (): void => {
  chrome.runtime.sendMessage({
    type: "CLOSE_PANEL",
  });
};

export { callApi, closePanel };
