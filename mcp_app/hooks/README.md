# Archived Magic NetSuite Claude Code Hooks

## Template review stop hook (retired)

`template-review-stop-hook.js` belongs to the retired blocking template-review
workflow. Template Studio sessions are asynchronous and collaborative, so the
current workflow does not install or require this hook.

Keep this file as a reference if a future workflow needs to hold an agent turn
open while waiting for an external UI action.

### Historical setup

Example hook command:

```bash
node C:/Projects/MagicNetsuiteExtension/mcp_app/hooks/template-review-stop-hook.js
```

The hook reads:

```text
%USERPROFILE%/.magic-netsuite/template-review-state.json
```

or the path in `MAGIC_NS_TEMPLATE_REVIEW_STATE`.

While the workflow is pending—including HTML review, approval/conversion, requested fixes, FreeMarker/PDF review, and render errors—the hook blocks stopping.

```json
{
  "decision": "block",
  "reason": "The NetSuite template workflow is still active. Call magic_netsuite_template_review_wait; apply HTML fixes in the HTML stage, FreeMarker fixes with NetSuite rerendering in the FreeMarker/PDF stage, or finish after final approval."
}
```

It allows stopping when no review is open, after final FreeMarker/PDF approval, when the user ends the workflow, or when Claude Code reports `stop_hook_active`.
