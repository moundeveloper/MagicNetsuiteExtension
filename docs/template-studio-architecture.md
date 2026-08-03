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
- each session's optional name/prompt, reference images, optional imported
  template filename, reusable template image assets, and AI asset-tool state;
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
2. The user chooses at least one starting artifact: reference images, an
   existing complete FreeMarker template, or both. Name and prompt are optional.
3. **Create session** makes the durable session current. An imported template
   is immediately rendered and its first PDF page is rasterized for inspection.
4. Claude loads the current session and the appropriate FreeMarker/BFO skill.
   For imported templates it inspects the rendered pages before editing source.
5. Claude builds native BFO/FreeMarker layout first. If the session's **AI asset
   tools** switch is enabled, it may reuse or create SVG assets for irreducible
   artwork, then uses opaque `mns-asset://asset_...` image URLs.
6. The extension renders that source through NetSuite and writes the PDF or
   render error back into the same session.
7. Claude requests a one-based page number. Template Studio rasterizes that
   complete page directly from the generated PDF bytes, reports the real page
   count, and Claude saves compact source patches.
8. The user can add fix requests at any time. Claude sees their IDs on the next
   session read and marks them addressed with the revision that resolves them.

## Fix-request lifecycle

Fix requests are durable todos with independent AI and user review state:

- **Open**: Claude still needs to address the request.
- **Addressed, unchecked**: Claude saved a response and revision, but the todo
  remains active until the user checks it.
- **Checked**: retained as history and excluded from normal MCP session
  responses. `includeFeedbackHistory:true` is required to load it.

Unchecked todos can be removed. Checked history cannot be deleted from the
Template Studio queue, but can be unchecked to restore it. Addressed responses
remain expandable in both the active queue and history.

There is no intermediate browser-HTML artifact, approval state machine, wait
tool, or stop hook in this lifecycle.

## MCP tool contract

| Tool                                          | Responsibility                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `magic_netsuite_template_session_list`        | List sessions and current selection.                                                                                             |
| `magic_netsuite_template_session_get_current` | Load the optional brief, starting-point metadata, references, context, versions, revisions, and feedback. Full source is opt-in. |
| `magic_netsuite_template_session_set_current` | Change the shared current session.                                                                                               |
| `magic_netsuite_template_asset_list`          | List image asset metadata and placeholders without returning raster bytes.                                                       |
| `magic_netsuite_template_asset_get_svg`       | Read editable SVG source; raster assets remain opaque.                                                                           |
| `magic_netsuite_template_asset_save_svg`      | Create or update a sanitized SVG and return its placeholder.                                                                     |
| `magic_netsuite_template_asset_delete`        | Delete an unused asset, or explicitly force deletion.                                                                            |
| `magic_netsuite_template_session_read`        | Read a bounded source slice or search context with its `sourceVersion`.                                                          |
| `magic_netsuite_template_session_patch`       | Apply exact, version-checked replacements and optionally render/capture.                                                         |
| `magic_netsuite_template_session_update`      | Create the initial complete source or perform an explicit full replacement.                                                      |
| `magic_netsuite_template_session_render`      | Render saved FreeMarker through NetSuite and persist the result.                                                                 |
| `magic_netsuite_template_session_screenshot`  | Rasterize one complete selected PDF page and return its image plus the document page count.                                      |

The normal agent loop is:

```text
get current → measure reference → read source → patch → render → compare normalized geometry → research uncertain platform behavior → repeat
```

Technical research is an escalation step, not a replacement for rendering. Before
an agent reports that BFO or FreeMarker cannot reproduce a required result, it
must use the documentation/web capability available in its host to open a
primary Oracle, Big Faceless, or FreeMarker source, form a testable hypothesis,
and verify that hypothesis with a minimal NetSuite render. If browsing is not
available, the agent must state that explicitly and continue with controlled
render experiments rather than fabricate research or default to an asset.

## Data-boundary rules

- PDFs are produced and stored inside the extension. They are not sent from the
  native host back into Chrome, avoiding Chrome's constrained native-message
  direction.
- Reference images are returned as MCP image content only when Claude asks for
  the current session.
- Template image assets are separate from visual references. MCP session and
  asset-list responses expose metadata and placeholders only. Raster `dataUrl`
  values never cross the model-facing tool boundary.
- The Images tab has a per-session **AI asset tools** switch. When disabled,
  model-facing list/read/create/update/delete operations expose no asset data or
  reject the call. Manual asset management remains available, stored assets are
  preserved, and existing placeholders still resolve during rendering. The AI
  cannot re-enable this UI-owned setting through a session update tool.
- Manual SVG uploads remain sanitized, editable SVG text and are rasterized at
  print density during render. PNG and JPEG uploads retain their original bytes
  and pixel dimensions; WebP is converted to a high-resolution internal PNG for
  BFO compatibility.
- `mns-asset://asset_...` is an XML/formatter-safe opaque URL, not FreeMarker
  syntax. Immediately before a NetSuite render, the extension resolves used
  placeholders in an in-memory copy of the source. Used SVGs are rasterized by
  Template Studio through canvas at that moment, and the transient PNG response
  is removed from browser storage after injection.
- Rendered image data is never written into the saved FreeMarker source,
  revisions, session summaries, or MCP responses. Embedded `data:image/...`
  source is rejected.
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
- The bundled editable **Bind FreeMarker to NetSuite Record** skill is seeded
  into the Skills database once. It discovers body fields, targeted sublists,
  and linked records before replacing sample content. Unmatched values remain
  visible as `FIELD_MATCH_NOT_FOUND:semantic_name`.
- NetSuite deployment remains a separate, explicit user-authorized operation.

## Compatibility

The previous template-review implementation remains archived in the repository,
but its MCP prompt, HTML app, wait tools, and approval tools are not registered
by default. A developer can temporarily expose them for migration testing with
`MAGIC_NS_ENABLE_LEGACY_TEMPLATE_REVIEW=1`.

The old stop hook is archived in
`mcp_app/hooks/template-review-stop-hook.js`; see the hook README for its
historical contract.
