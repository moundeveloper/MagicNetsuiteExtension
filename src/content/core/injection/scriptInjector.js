export const createBridgeCapability = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const injectScript = (file, bridgeCapability) => {
  const script = document.createElement("script");
  const scriptUrl = new URL(chrome.runtime.getURL(file));
  if (file.endsWith("/netsuiteApi.js")) {
    scriptUrl.searchParams.set("bridgeCapability", bridgeCapability);
  }
  script.src = scriptUrl.toString();

  script.onload = function () {
    this.remove();
  };

  (document.head || document.documentElement).appendChild(script);
};

export const injectScripts = (scripts, bridgeCapability) => {
  scripts.forEach((script) => injectScript(script, bridgeCapability));
};
