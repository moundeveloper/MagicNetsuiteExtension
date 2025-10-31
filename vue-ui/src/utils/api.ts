import type { RequestRoutes } from "../types/request";

export type ApiResponse = {
  status: "ok" | "error";
  message: any;
};

const callApi = async (
  route: RequestRoutes,
  payload: any = {}
): Promise<ApiResponse> => {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || !tabs[0].id)
        return reject(new Error("No active tab found"));

      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: route, data: payload },
        (response: any) => {
          if (chrome.runtime.lastError) {
            return reject(chrome.runtime.lastError);
          }
          resolve(response);
        }
      );
    });
  });
};

export { callApi };
