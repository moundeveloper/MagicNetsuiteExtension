# Magic NetSuite Claude Code Hooks

## Template Review Stop Hook

Use `template-review-stop-hook.js` as a Claude Code `Stop` hook to keep the current agent turn alive while the Playwright template review is pending.

Example hook command:

```bash
node C:/Projects/MagicNetsuiteExtension/mcp_app/hooks/template-review-stop-hook.js
```

The hook reads:

```text
%USERPROFILE%/.magic-netsuite/template-review-state.json
```

or the path in `MAGIC_NS_TEMPLATE_REVIEW_STATE`.

When the workflow still needs agent work (`html_review`, `html_changes_requested`, `freemarker_review`, `freemarker_changes_requested`, or `render_error`), the hook blocks stopping.

```json
{
  "decision": "block",
  "reason": "The NetSuite template workflow is still active. Call magic_netsuite_template_review_wait; apply HTML fixes in the HTML stage, FreeMarker fixes with NetSuite rerendering in the FreeMarker/PDF stage, or finish after final approval."
}
```

It allows stopping when no review is open, after final FreeMarker/PDF approval, when the user ends the workflow, or when Claude Code reports `stop_hook_active`.
