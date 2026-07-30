(() => {
  if (window.__magicNetsuiteElementScreenshotShortcutInstalled) return;
  window.__magicNetsuiteElementScreenshotShortcutInstalled = true;

  const DEFAULT_SHORTCUT = "ctrl+shift+s";
  const SETTINGS_KEY = "magic_netsuite_settings";
  let shortcut = DEFAULT_SHORTCUT;

  const matchesShortcut = (event, value) => {
    const parts = String(value || DEFAULT_SHORTCUT)
      .toLowerCase()
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
    const key = parts[parts.length - 1] || "s";
    const modifiers = parts.slice(0, -1);
    const wantsCtrl =
      modifiers.includes("ctrl") ||
      modifiers.includes("cmd") ||
      modifiers.includes("meta");
    const ctrlMatch = wantsCtrl
      ? event.ctrlKey || event.metaKey
      : !event.ctrlKey && !event.metaKey;
    const altMatch = modifiers.includes("alt")
      ? event.altKey
      : !event.altKey;
    const shiftMatch = modifiers.includes("shift")
      ? event.shiftKey
      : !event.shiftKey;

    return (
      ctrlMatch &&
      altMatch &&
      shiftMatch &&
      event.key.toLowerCase() === key
    );
  };

  chrome.storage.sync
    .get([SETTINGS_KEY])
    .then((result) => {
      shortcut =
        result[SETTINGS_KEY]?.elementScreenshotShortcut || DEFAULT_SHORTCUT;
    })
    .catch(() => {
      shortcut = DEFAULT_SHORTCUT;
    });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" || !changes[SETTINGS_KEY]) return;
    shortcut =
      changes[SETTINGS_KEY].newValue?.elementScreenshotShortcut ||
      DEFAULT_SHORTCUT;
  });

  document.addEventListener(
    "keydown",
    (event) => {
      // The full picker owns the shortcut after its first on-demand injection.
      if (window.__magicNetsuiteElementScreenshotPickerInstalled) return;
      if (!matchesShortcut(event, shortcut)) return;

      event.preventDefault();
      event.stopPropagation();
      chrome.runtime
        .sendMessage({ type: "START_ELEMENT_SCREENSHOT_SELECTION" })
        .catch((error) => {
          console.error(
            "[Magic Netsuite] Failed to start element screenshot picker:",
            error
          );
        });
    },
    true
  );
})();
