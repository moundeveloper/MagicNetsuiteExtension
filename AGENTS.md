# Repository UI Rules

- Never use native HTML `<select>` or `<option>` elements for user-facing controls.
- Use the project's custom `MSelect` component for single-choice dropdowns so styling, keyboard behavior, and overlays remain consistent.
- Before completing UI work, search the changed feature for `<select` and `<option` and replace any user-facing occurrences.
