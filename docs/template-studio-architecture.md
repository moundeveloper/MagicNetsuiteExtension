# Template Studio architecture

Template Studio replaces the blocking HTML → approval → FreeMarker review loop
with a durable collaborative workspace shared by the dashboard, Claude, and the
extension background worker.

## Source of truth

The extension owns one versioned store in `chrome.storage.local`:

```text
magic_netsuite_template_design_sessions_v1
```

The store contains:

- a collection of durable design sessions;
- the ID of the current session;
- each session's prompt and reference images;
- NetSuite account and record context;
- the current complete FreeMarker/BFO document;
- the latest NetSuite PDF render or render error;
- open and addressed fix requests;
- bounded FreeMarker revision history.

Neither the MCP app nor Claude keeps a second authoritative copy. This is
important: reconnecting the MCP client, reloading the extension, or reopening
the dashboard must not discard the work.

## Session lifecycle

1. The user opens **Template Studio** from FreeMarker Renderer or `Ctrl+K`.
2. The user adds a name, prompt, reference images, and optional NetSuite record
   context.
3. **Commit as current session** creates the durable session and makes it
   current.
4. Claude loads the current session and the appropriate FreeMarker/BFO skill.
5. Claude writes a complete `<pdf>...</pdf>` FreeMarker document directly into
   the session.
6. The extension renders that source through NetSuite and writes the PDF or
   render error back into the same session.
7. Claude requests a one-based page number. Template Studio rasterizes that
   complete page directly from the generated PDF bytes, reports the real page
   count, and Claude saves compact source patches.
8. The user can add fix requests at any time. Claude sees their IDs on the next
   session read and marks them addressed with the revision that resolves them.

There is no intermediate browser-HTML artifact, approval state machine, wait
tool, or stop hook in this lifecycle.

## MCP tool contract

| Tool | Responsibility |
| --- | --- |
| `magic_netsuite_template_session_list` | List sessions and current selection. |
| `magic_netsuite_template_session_get_current` | Load the brief, references, context, versions, revisions, and feedback. Full source is opt-in. |
| `magic_netsuite_template_session_set_current` | Change the shared current session. |
| `magic_netsuite_template_session_read` | Read a bounded source slice or search context with its `sourceVersion`. |
| `magic_netsuite_template_session_patch` | Apply exact, version-checked replacements and optionally render/capture. |
| `magic_netsuite_template_session_update` | Create the initial complete source or perform an explicit full replacement. |
| `magic_netsuite_template_session_render` | Render saved FreeMarker through NetSuite and persist the result. |
| `magic_netsuite_template_session_screenshot` | Rasterize one complete selected PDF page and return its image plus the document page count. |

The normal agent loop is:

```text
get current → read relevant source → patch → render → select PDF page → repeat
```

## Data-boundary rules

- PDFs are produced and stored inside the extension. They are not sent from the
  native host back into Chrome, avoiding Chrome's constrained native-message
  direction.
- Reference images are returned as MCP image content only when Claude asks for
  the current session.
- PDF captures do not screenshot the browser or Chrome PDF viewer. Template
  Studio uses PDF.js to rasterize the requested page directly from the saved
  PDF bytes at a deterministic width.
- Page numbers are one-based, default to page 1, and are validated against the
  actual page count. Results report the selected page, total pages, width, and
  height.
- The agent captures page 1 first, reads `pdfPageCount`, then requests every
  remaining page individually before judging a multi-page design.
- Viewer toolbar, zoom, scroll position, dashboard, editor, and browser UI
  cannot enter the returned image.
- Template Studio never attaches `chrome.debugger` and never uses Playwright.
- Dashboard discovery supports both the dedicated extension preview tab and
  the visible full-page dashboard iframe embedded in a NetSuite Setup page.
- Revision history stores FreeMarker source but not historical PDF data.
- `sourceVersion` changes only when the FreeMarker changes. Patch operations
  require the version they read and reject stale writes.
- NetSuite deployment remains a separate, explicit user-authorized operation.

## Compatibility

The previous template-review implementation remains archived in the repository,
but its MCP prompt, HTML app, wait tools, and approval tools are not registered
by default. A developer can temporarily expose them for migration testing with
`MAGIC_NS_ENABLE_LEGACY_TEMPLATE_REVIEW=1`.

The old stop hook is archived in
`mcp_app/hooks/template-review-stop-hook.js`; see the hook README for its
historical contract.
