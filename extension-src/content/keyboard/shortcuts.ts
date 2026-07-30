let keysPressed: Record<string, boolean> = {};

export const setupKeyboardShortcuts = () => {
  document.addEventListener("keydown", (e) => {
    keysPressed[e.key.toLowerCase()] = true;

    const isNetSuiteByUrl = location.hostname.includes("netsuite.com");
    if (!isNetSuiteByUrl) return;
  });

  document.addEventListener("keyup", (e) => {
    keysPressed[e.key.toLowerCase()] = false;
  });
};
