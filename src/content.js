const injectScript = (file) => {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL(file);

  script.onload = function () {
    this.remove();
  };

  (document.head || document.documentElement).appendChild(script);
};

(async function () {
  try {
    /* const { logStuff } = await import(chrome.runtime.getURL("./utils.js")); */
    injectScript("scripts.js");
    injectScript("customRecords.js");
    injectScript("sandboxCode.js");
    injectScript("netsuiteApi.js");
  } catch (error) {
    console.log("Error", error);
  }
})();
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("Message from popup:", msg);

  // Create the event for the page
  const event = new CustomEvent("fromExtension", { detail: msg });

  // Listen once for the response from the page
  const handleResponse = (e) => {
    console.log("Got response from page:", e);
    sendResponse(e.detail); // send it back to the popup
    window.removeEventListener("toExtension", handleResponse);
  };

  window.addEventListener("toExtension", handleResponse);

  // Dispatch the request to the page
  window.dispatchEvent(event);

  return true; // keep sendResponse alive for async
});
