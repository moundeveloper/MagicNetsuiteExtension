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

type HarnessWorkerSession = {
  sessionId: string;
  tabId: number;
};

let harnessWorkerSession: HarnessWorkerSession | null = null;

const HARNESS_WORKER_TAB_TITLE = "Agent Harness Processing";
const DASHBOARD_PREVIEW_SESSIONS_KEY =
  "magic_netsuite_dashboard_preview_sessions";
const DASHBOARD_GOVERNANCE_THRESHOLD = 20;
const dashboardGovernanceRefreshes = new Map<number, Promise<void>>();

const chromeTabsCallback = <T>(
  invoke: (done: (result: T) => void) => void
): Promise<T> =>
  new Promise((resolve, reject) => {
    invoke((result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });

const queryChromeTabs = (
  queryInfo: chrome.tabs.QueryInfo
): Promise<chrome.tabs.Tab[]> =>
  chromeTabsCallback((done) => chrome.tabs.query(queryInfo, done));

const getChromeTab = (tabId: number): Promise<chrome.tabs.Tab> =>
  chromeTabsCallback((done) => chrome.tabs.get(tabId, done));

const updateChromeTab = (
  tabId: number,
  updateProperties: chrome.tabs.UpdateProperties
): Promise<chrome.tabs.Tab | undefined> =>
  new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab);
    });
  });

const removeChromeTab = (tabIds: number | number[]): Promise<void> =>
  chromeTabsCallback((done) => {
    const callback = () => done();
    if (Array.isArray(tabIds)) chrome.tabs.remove(tabIds, callback);
    else chrome.tabs.remove(tabIds, callback);
  });

const reloadChromeTab = (tabId: number): Promise<void> =>
  chromeTabsCallback((done) => chrome.tabs.reload(tabId, {}, () => done()));

type TabUpdatedListener = Parameters<
  typeof chrome.tabs.onUpdated.addListener
>[0];

let workerTabDecorationListener: TabUpdatedListener | null = null;

/** Routes that are heavy on the main NetSuite UI thread when run in-page. */
const HEAVY_ROUTES = new Set<RequestRoutes>([
  RequestRoutes.LOAD_RECORD,
  RequestRoutes.LOAD_RECORD_JSON,
  RequestRoutes.LOAD_RECORD_SUBLISTS,
  RequestRoutes.FETCH_FILE_CONTENT,
]);

// ============================================================================
// Harness worker tab (persists for an entire agent turn)
// ============================================================================

/**
 * Open (or reuse) a background NetSuite tab for harness / heavy API work.
 * Stays open until {@link endHarnessWorkerTab} is called.
 */
const beginHarnessWorkerTab = async (
  sessionId: string,
  referenceUrl?: string
): Promise<number> => {
  if (harnessWorkerSession?.sessionId === sessionId) {
    return harnessWorkerSession.tabId;
  }

  await endHarnessWorkerTab();

  let url: string;
  if (referenceUrl) {
    url = buildTempTabUrl(referenceUrl);
  } else {
    const tab = await findExistingNetsuiteTab();
    url = buildTempTabUrl(tab.url!);
  }

  const tab = await createWorkerTab(url, { harnessWorker: true });
  harnessWorkerSession = { sessionId, tabId: tab.id! };
  attachWorkerTabDecorationWatcher(tab.id!);
  console.log(`[callApi] Harness worker tab ${tab.id} opened for session ${sessionId}`);
  return tab.id!;
};

/** Close the harness worker tab for this session (or any session if id omitted). */
const endHarnessWorkerTab = async (sessionId?: string): Promise<void> => {
  const session = harnessWorkerSession;
  if (!session) return;
  if (sessionId && session.sessionId !== sessionId) return;

  harnessWorkerSession = null;
  detachWorkerTabDecorationWatcher();
  try {
    await removeChromeTab(session.tabId);
    console.log(`[callApi] Harness worker tab ${session.tabId} closed`);
  } catch {
    // Tab may already be closed by the user.
  }
};

const isHarnessWorkerTabActive = (): boolean => harnessWorkerSession !== null;

const getHarnessWorkerTabId = (): number | null => harnessWorkerSession?.tabId ?? null;

const shouldUseHarnessWorkerTab = (route: RequestRoutes): boolean => {
  if (!harnessWorkerSession) return false;
  return HEAVY_ROUTES.has(route);
};

const getDashboardPreviewSessionId = (): string | null => {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(
    "magicDashboardPreview"
  );
};

const getDashboardEnablerTab = async (): Promise<chrome.tabs.Tab | null> => {
  const sessionId = getDashboardPreviewSessionId();
  if (!sessionId || typeof chrome === "undefined" || !chrome.storage?.session) {
    return null;
  }

  const result = await chrome.storage.session.get(
    DASHBOARD_PREVIEW_SESSIONS_KEY
  );
  const session = result?.[DASHBOARD_PREVIEW_SESSIONS_KEY]?.[sessionId];
  if (!session?.enablerTabId) {
    throw new Error(
      "This dashboard preview is no longer connected to its NetSuite account tab."
    );
  }

  try {
    const tab = await getChromeTab(session.enablerTabId);
    if (!tab?.id || !tab.url?.includes("magicDashboardEnabler=")) {
      throw new Error("The dashboard enabler tab is unavailable.");
    }
    return tab;
  } catch {
    throw new Error(
      "The NetSuite enabler tab was closed. Open a new dashboard preview from NetSuite."
    );
  }
};

const waitForDashboardTabLoad = async (tabId: number): Promise<void> => {
  const current = await getChromeTab(tabId);
  if (current.status === "complete") {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("The dashboard enabler tab did not finish refreshing."));
    }, 15000);

    const listener: TabUpdatedListener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      window.clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      window.setTimeout(resolve, 400);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
};

const refreshDashboardEnablerIfNeeded = async (
  tabId: number
): Promise<void> => {
  const activeRefresh = dashboardGovernanceRefreshes.get(tabId);
  if (activeRefresh) {
    await activeRefresh;
    return;
  }

  const refresh = (async () => {
    try {
      const response = await sendMessageToTab(tabId, {
        action: RequestRoutes.CHECK_GOVERNANCE,
        data: {},
        mode: ApiRequestType.NORMAL
      });
      const remaining = Number(response?.message?.remaining);
      if (
        Number.isFinite(remaining) &&
        remaining <= DASHBOARD_GOVERNANCE_THRESHOLD
      ) {
        console.log(
          `[callApi] Dashboard enabler governance is ${remaining}; refreshing tab ${tabId}`
        );
        await reloadChromeTab(tabId);
        await waitForDashboardTabLoad(tabId);
      }
    } catch (error) {
      console.warn(
        "[callApi] Could not check dashboard enabler governance",
        error
      );
    }
  })();
  dashboardGovernanceRefreshes.set(tabId, refresh);

  try {
    await refresh;
  } finally {
    dashboardGovernanceRefreshes.delete(tabId);
  }
};

if (typeof chrome !== "undefined" && chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (harnessWorkerSession?.tabId === tabId) {
      console.log(`[callApi] Harness worker tab ${tabId} was closed externally`);
      harnessWorkerSession = null;
    }
  });
}

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
  const dashboardEnablerTab = await getDashboardEnablerTab();

  if (dashboardEnablerTab) {
    activeTab = dashboardEnablerTab;
    await refreshDashboardEnablerIfNeeded(activeTab.id!);
  } else {
    try {
      activeTab = await getActiveNetsuiteTab();
    } catch {
      try {
        activeTab = await findExistingNetsuiteTab();
      } catch {
        throw new Error("No NetSuite tab found. Open a NetSuite page first.");
      }
    }
  }

  const messagePayload: MessagePayload = {
    action: route,
    data: payload,
    mode
  };

  const workerTabId = !dashboardEnablerTab && shouldUseHarnessWorkerTab(route)
    ? getHarnessWorkerTabId()
    : null;

  // =========================
  // STREAM MODE (PORTS)
  // =========================
  if (mode === ApiRequestType.STREAM) {
    return new Promise(async (resolve, reject) => {
      let streamTab: chrome.tabs.Tab;

      if (dashboardEnablerTab) {
        streamTab = dashboardEnablerTab;
      } else {
        try {
          streamTab = await getActiveNetsuiteTab();
        } catch {
          try {
            streamTab = await findExistingNetsuiteTab();
          } catch {
            reject(new Error("No NetSuite tab found. Open a NetSuite page first."));
            return;
          }
        }
      }

      const initialTabId = workerTabId ?? streamTab.id!;

      const connectAndStream = (tabId: number, isEphemeralTemp = false): void => {
        const port = chrome.tabs.connect(tabId, {
          name: "stream-api"
        });

        port.onMessage.addListener(async (message: any) => {
          if (message.status === "API_NOT_AVAILABLE" && !isEphemeralTemp && !workerTabId) {
            console.log("[callApi] Stream API not available — trying fallback tab");

            port.disconnect();

            try {
              const existingTab = await findExistingNetsuiteTab(streamTab.url);
              if (existingTab.id && existingTab.id !== tabId) {
                connectAndStream(existingTab.id, false);
                return;
              }
            } catch {
              // fall through to ephemeral temp tab
            }

            try {
              const tempTab = await createWorkerTab(buildTempTabUrl(streamTab.url!));
              connectAndStream(tempTab.id!, true);
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

            if (isEphemeralTemp) {
              chrome.tabs.remove(tabId);
            }

            if (dashboardEnablerTab) {
              await refreshDashboardEnablerIfNeeded(tabId);
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

      connectAndStream(initialTabId);
    });
  }

  // =========================
  // NORMAL MODE
  // =========================
  if (workerTabId) {
    try {
      return await sendMessageToTab(workerTabId, messagePayload);
    } catch (err) {
      console.warn("[callApi] Harness worker tab request failed, falling back", err);
      harnessWorkerSession = null;
    }
  }

  if (dashboardEnablerTab) {
    const response = await sendMessageToTab(
      dashboardEnablerTab.id!,
      messagePayload
    );
    await refreshDashboardEnablerIfNeeded(dashboardEnablerTab.id!);
    return response;
  }

  try {
    return await sendMessageToTab(activeTab.id!, messagePayload);
  } catch {
    try {
      const existingTab = await findExistingNetsuiteTab(activeTab.url);
      if (existingTab.id !== activeTab.id) {
        return await sendMessageToTab(existingTab.id!, messagePayload);
      }
    } catch {
      // No existing connected tab works; surface the original failure via temp tab.
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
  const allTabs = await queryChromeTabs({});
  const netsuiteTabs = allTabs.filter(
    (tab) =>
      tab.url?.includes("app.netsuite.com") &&
      tab.id &&
      !tab.url.includes("tempTab=true")
  );

  if (netsuiteTabs.length === 0) {
    throw new Error("No NetSuite tabs found in any window");
  }

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

  if (currentUrl) {
    const targetAccountId = extractAccountIdFromUrl(currentUrl);
    if (targetAccountId) {
      const matchingTab = connectedTabs.find((r) => r.accountId === targetAccountId);
      if (matchingTab) {
        return matchingTab.tab;
      }
    }
  }

  return connectedTabs[0]!.tab;
};

const isTemporaryTab = (tab: chrome.tabs.Tab): boolean => {
  try {
    return !!tab.url?.includes("tempTab=true");
  } catch {
    return false;
  }
};

const buildTempTabUrl = (currentUrl: string): string => {
  const urlInstance = new URL(currentUrl);
  const baseUrl = `${urlInstance.protocol}//${urlInstance.host}`;
  return `${baseUrl}/app/setup/mainsetup.nl?sc=-90&tempTab=true`;
};

const getExtensionIconUrl = (): string =>
  chrome.runtime.getURL("icons/icon32.png");

const decorateHarnessWorkerTab = async (tabId: number): Promise<void> => {
  try {
    await updateChromeTab(tabId, { pinned: true });
  } catch (err) {
    console.warn("[callApi] Could not pin harness worker tab", err);
  }

  if (!chrome.scripting?.executeScript) return;

  const iconUrl = getExtensionIconUrl();
  const title = HARNESS_WORKER_TAB_TITLE;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (tabTitle: string, faviconUrl: string) => {
        document.title = tabTitle;

        document
          .querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')
          .forEach((node) => node.remove());

        const link = document.createElement("link");
        link.rel = "icon";
        link.type = "image/png";
        link.href = faviconUrl;
        document.head.appendChild(link);

        const titleEl = document.querySelector("title");
        if (titleEl) {
          new MutationObserver(() => {
            if (document.title !== tabTitle) {
              document.title = tabTitle;
            }
          }).observe(titleEl, {
            childList: true,
            characterData: true,
            subtree: true,
          });
        }
      },
      args: [title, iconUrl],
    });
  } catch (err) {
    console.warn("[callApi] Could not set harness worker tab title/icon", err);
  }
};

const attachWorkerTabDecorationWatcher = (tabId: number): void => {
  detachWorkerTabDecorationWatcher();

  workerTabDecorationListener = (updatedTabId, changeInfo) => {
    if (updatedTabId !== tabId) return;
    if (changeInfo.status === "complete") {
      void decorateHarnessWorkerTab(tabId);
    }
  };

  chrome.tabs.onUpdated.addListener(workerTabDecorationListener);
};

const detachWorkerTabDecorationWatcher = (): void => {
  if (!workerTabDecorationListener) return;
  chrome.tabs.onUpdated.removeListener(workerTabDecorationListener);
  workerTabDecorationListener = null;
};

type CreateWorkerTabOptions = {
  harnessWorker?: boolean;
};

const createWorkerTab = (
  url: string,
  options: CreateWorkerTabOptions = {}
): Promise<chrome.tabs.Tab> => {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (!tab.id) {
        return reject(new Error("Failed to create worker tab"));
      }

      const tabId = tab.id;

      waitForTabLoad(tabId, async () => {
        if (options.harnessWorker) {
          await decorateHarnessWorkerTab(tabId);
        }
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
// Ephemeral temporary tab fallback (per request)
// ============================================================================

const handleFallbackWithTempTab = async (
  currentTab: chrome.tabs.Tab,
  payload: MessagePayload
): Promise<ApiResponse> => {
  try {
    const existingTab = await findExistingNetsuiteTab(currentTab.url);
    if (existingTab.id !== currentTab.id) {
      return await sendMessageToTab(existingTab.id!, payload);
    }
  } catch {
    // No existing tab works, fall back to ephemeral temp tab.
  }

  console.log("[callApi] API not available, creating ephemeral temp tab");
  const netsuiteUrl = buildTempTabUrl(currentTab.url!);
  return await fetchFromEphemeralTempTab(netsuiteUrl, payload);
};

const fetchFromEphemeralTempTab = (
  url: string,
  payload: MessagePayload
): Promise<ApiResponse> => {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (!tab.id) {
        return reject(new Error("Failed to create temp tab"));
      }

      const cleanup = () => {
        chrome.tabs.remove(tab.id!).catch(() => undefined);
      };

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
  const dashboardTab = await getDashboardEnablerTab();
  if (dashboardTab?.url) {
    return new URL(dashboardTab.url).hostname;
  }

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

export {
  beginHarnessWorkerTab,
  callApi,
  closePanel,
  endHarnessWorkerTab,
  getNetsuiteEnvironment,
  isHarnessWorkerTabActive,
};
