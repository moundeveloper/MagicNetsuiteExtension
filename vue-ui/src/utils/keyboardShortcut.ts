export const parseKeyboardShortcut = (shortcut: string) => {
  const parts = shortcut
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    modifiers: parts.slice(0, -1),
    key: parts[parts.length - 1] || ""
  };
};

export const keyboardShortcutMatches = (
  event: KeyboardEvent,
  shortcut: string
) => {
  const { modifiers, key } = parseKeyboardShortcut(shortcut);
  if (!key || event.key.toLowerCase() !== key) return false;
  const ctrl = event.ctrlKey || event.metaKey;
  return (
    modifiers.includes("ctrl") === ctrl &&
    modifiers.includes("alt") === event.altKey &&
    modifiers.includes("shift") === event.shiftKey
  );
};

export const formatKeyboardShortcut = (shortcut: string) =>
  shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("+");
