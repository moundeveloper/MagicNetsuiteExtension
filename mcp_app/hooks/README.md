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

When the review status is `open`, the hook returns:

```json
{
  "decision": "block",
  "reason": "The NetSuite template review is still pending in Playwright. Call magic_netsuite_template_review_wait and continue after the user clicks Approve or Send Fixes."
}
```

It allows stopping when no review is open, when the review has been approved, when fixes were requested, or when Claude Code reports `stop_hook_active`.
