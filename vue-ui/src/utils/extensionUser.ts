// extensionUser.ts — Manage unique extension user ID

const EXTENSION_USER_ID_KEY = "magic_netsuite_extension_user_id";

export const getExtensionUserId = async (): Promise<string> => {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      // Fallback for non-extension context (dev mode)
      const stored = localStorage.getItem(EXTENSION_USER_ID_KEY);
      if (stored) return resolve(stored);

      const newId = generateUserId();
      localStorage.setItem(EXTENSION_USER_ID_KEY, newId);
      return resolve(newId);
    }

    chrome.storage.local.get([EXTENSION_USER_ID_KEY], (result) => {
      if (result[EXTENSION_USER_ID_KEY]) {
        return resolve(result[EXTENSION_USER_ID_KEY]);
      }

      const newId = generateUserId();
      chrome.storage.local.set({ [EXTENSION_USER_ID_KEY]: newId }, () => {
        resolve(newId);
      });
    });
  });
};

export const regenerateExtensionUserId = async (): Promise<string> => {
  const newId = generateUserId();

  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    localStorage.setItem(EXTENSION_USER_ID_KEY, newId);
    return newId;
  }

  await new Promise<void>((resolve) => {
    chrome.storage.local.set({ [EXTENSION_USER_ID_KEY]: newId }, () => resolve());
  });

  return newId;
};

const generateUserId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}_${random}`;
};
