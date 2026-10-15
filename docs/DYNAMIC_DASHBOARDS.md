# Dynamic SuiteScript dashboards

Open **Dashboards** in the feature browser to manage definitions, actions, imports,
history, Home pins and keyboard shortcuts. **Open dashboard** opens a dedicated
full-page workspace tab with a compact toolbar, independent form state and results.
The manager's optional preview never executes actions. Definitions live in Chrome
local storage; editing through MCP updates open views. User input survives idle
revision changes; an edit during execution requires reloading runtime state.

Dashboards are reactive documents interpreted by the existing Vue app: layout
nodes, reusable component templates, state, results and SuiteScript actions.
They reuse MCard, MInput, MSelect, MTableStatic and PrimeVue Button. A shared
`/dashboard/:dashboardId` route interprets every definition; dashboards do not need
individual application code or generated JavaScript bundles.

## Home pins and shortcuts

Select a dashboard in the manager, then use the star to pin/unpin it on Home.
Home's **Pinned dashboards** section opens each dashboard directly in a workspace
tab. The key button assigns a shortcut such as `Ctrl+Alt+1`; leave the field empty
to remove it. Duplicate dashboard shortcuts and existing extension shortcuts are
rejected. Preferences are personal Chrome-local data, separate from definitions,
exports and revision history. Deleted dashboards disappear from Home and NetSuite
shortcuts, and renaming updates their displayed titles.

Shortcuts work inside the extension workspace and on NetSuite pages. They use
an already-visible page workspace or open side panel when available. Otherwise,
they open a dashboard widget on the right of the NetSuite page, without opening
or focusing a grouped browser window. Drag its left-edge handle to resize, use
the expand button for more room, or close it with the header’s close button.
Different dashboards and preferred views open tabs inside the same widget,
using the main dashboard’s tab controls. Selecting the same dashboard reuses
its tab and preserves its inputs. The widget starts at 50% of the screen width
(or 560 pixels on narrower screens), and remains resizable. Its workspace is
separate from the full dashboard and side panel. Each widget executes against its host
NetSuite page. Account-bound dashboards refuse launch from another account.

**Quick selector** in the manager configures the circular navigator (default
`Ctrl+Alt+D`). Hold the shortcut to show it in the center of the screen, point to
a destination, then release the key or mouse button to open its tab. Releasing
in the center or outside the wheel cancels; Escape and losing window focus also
cancel. Arrow keys can select items. Home’s preferred views appear first,
followed by pinned dashboards and other saved dashboards. Each opens its own
workspace tab in an existing workspace, or its own NetSuite side widget;
preferred views reuse existing workspace tabs, preserving their filters and state. Scroll through pages of eight items. The wheel uses the app’s slate
theme, muted line icons and a thin selection arc, with the same renderer in the
Vue workspace and on NetSuite pages. NetSuite wheels show global dashboards and
dashboards bound to that page’s account. Clear the shortcut in the manager to
disable it; Settings also shows the current shortcut.

UI actions use the dashboard window's account: client steps run on its source
NetSuite page (updated when launching from another page in the same account),
and server steps use its worker. They refuse execution if the source
page has changed account or disappeared. MCP execution keeps its configured MCP
account. Automatic loads/refresh pause while the dashboard tab is inactive or the
browser document is hidden; opening the manager or its preview does not start them.

## MCP tools

All 15 tools use the `magic_netsuite_dashboard_` prefix and are exposed by the
native Claude companion, MCP app HTTP/stdio transports, extension and built-in
agent. Reload the extension and restart the MCP connection after updating.

| Suffix | Purpose |
| --- | --- |
| `catalog` | Props schemas, events, slots, enums, definition/action/custom-component schemas and module limits |
| `list` | Search compact metadata without downloading layout or source |
| `get` | Read definition and current revision, excluding history |
| `create` | Validate and save a new definition |
| `update` | Patch definition fields; omitted fields preserved, arrays replaced |
| `delete` | Delete a dashboard |
| `action` | Upsert a complete action or delete by id |
| `node` | Atomic batch upsert/remove by node id, including nested children and slots |
| `validate` | Dry-run a definition, or stored dashboard plus patch, returning errors/warnings |
| `render` | Return actual rendered Vue text from a live view or an initial-state preview |
| `run` | Explicit action execution with concrete object, array, scalar or null input |
| `code` | Upsert/delete a source file; local MCP accepts UTF-8 `filePath` |
| `export` | Portable JSON; local MCP optionally writes a `directory` with JSON/code files |
| `import` | Import exported payload or local JSON `filePath`, optionally with `newName` |
| `history` | List/read versions, or restore a previous definition as a new revision |

Edits/deletes/runs require `expectedRevision`. A revision conflict refuses stale
code or changes. Mutations serialize in the extension worker and validate before
saving. Default edit responses contain `id`, `name`, `revision`, `changedNodeIds`,
`changedActionIds`, and warnings. Use `verbose:true` for the full definition.
Run responses include final `result`, `setState` and completion metadata;
`verbose:true` also includes intermediate `steps`, avoiding duplicated large results
by default. Action result data itself remains complete for live rendering.

Call catalog/list before creation, get before editing, and validate for a dry run.
Creation, import, editing, history restoration and rendering never execute code.
Automatic execution starts only when opening an explicitly configured dashboard.

## Live data, selection and state

Required definition fields are `name`, `title`, `description`, `mode`, `tags`,
`initialState`, `layout`, `components`, `actions`. Optional fields include `account`,
`stateSchema`, `onLoad`, `refresh`, `libraries`, and `sourceFiles`.

```json
{
  "id": "bodies",
  "type": "table",
  "bind": "state.selected",
  "props": {
    "rows": {"$bind": "results.load.result.rows", "fallback": []},
    "selection": "multiple",
    "rowKey": "id",
    "pageSize": 25,
    "columns": [
      {"field": "id", "label": "ID", "recordType": "customer"},
      {"field": "name", "label": "Name"},
      {"field": "amount", "format": "number", "digits": 2},
      {"field": "status", "format": "badge"}
    ]
  },
  "slots": {
    "rowActions": [{"id": "inspectRow", "type": "button", "actionId": "inspect", "input": {"$bind": "item"}, "props": {"label": "Inspect"}}]
  }
}
```

Declare `initialState.selected: []`. Selection stores complete rows, using a unique
`rowKey` to reconcile against fresh data and remove vanished rows. `single` stores
one object or null; `multiple` stores an array. Select all selects filtered rows
across every page. Sorting/global search/column filters run before pagination.
`searchable`, `sortable`, `filterable`, and `pagination` can individually be false.
Columns support text/number/date/datetime/badge formatting, `recordType` plus
`recordIdField` links through NetSuite `url.resolveRecord`, and `actionId`/`input`
for a cell action. The `rowActions` slot supplies buttons for each row.

An action can use `input: {"$bind":"state.selected"}` or `{"$bind":"state"}`;
its `inputSchema` may describe arrays as well as objects/scalars. MCP `run` takes
concrete input; the UI resolves the saved input mapping. Exact bindings preserve
arrays, objects, numbers and null. Fallback applies to missing values.

SuiteScript may return:

```javascript
return {count: input.length, setState: {selected: [], 'filters.status': 'ready'}};
```

Successful steps aggregate `setState` patches; the runtime applies the patch
atomically after the action succeeds, validating optional `stateSchema` first.
Prefixes such as `state.selected` also work. State/results remain local to the
open runtime and are not persisted as user input. Prototype paths are refused.

Scope roots: `state`, `results`, `busy`, `errors`, `props`, `item`, `index`, `slot`,
`event`. Bindings can appear inside props, input mappings, visibility and event
handlers. Dynamic node `bind`/`actionId` can themselves bind to a path/id from
props or item data. Declarative `$op` supports `length`, `not`, `and`, `or`,
`equals`, `add`, `subtract`, `includes`, and `coalesce`, with an `args` array.

## Repeated templates and customizable components

```json
{
  "id": "liveCards", "type": "repeat",
  "props": {"items": {"$bind": "results.load.result.rows", "fallback": []}, "keyField": "id"},
  "children": [{"id": "name", "type": "text", "props": {"text": {"$bind": "item.name"}}}]
}
```

Repeats render live rows with `item` and `index`; they support default/empty slots,
`direction`, `emptyText` and `maxItems` (up to 1000). Tables expose `toolbar`,
`empty`, `cell:<field>` and `rowActions` slots with `item` and `slot.row/value`.
Cards expose header/default/footer; metrics and buttons accept custom content.
Nodes support safe inline `style`, visibility, component props and declared events.

Reusable custom components declare `description`, `template`, optional
`propsSchema`, `defaults`, `slots` and `events`. For example:

```json
{
  "Panel": {
    "description": "Reusable scoped panel",
    "propsSchema": {"type":"object", "required":["title"], "properties":{"title":{"type":"string"}}},
    "slots": ["body"],
    "template": [{"id":"card", "type":"card", "props":{"title":{"$bind":"props.title"}}, "children":[
      {"id":"body", "type":"slot", "props":{"name":"body", "scope":{"heading":{"$bind":"props.title"}}}}
    ]}]
  }
}
```

Instantiate `custom:Panel` with props and `slots.body` nodes. Supplied slot content
runs in caller scope and receives `slot.heading`. Slot nodes can include fallback
children. Events raised inside a template propagate to the custom component's
instance handlers. A handler can call an action, patch state, or both:

```json
{"id":"clear", "type":"button", "props":{"label":"Clear"}, "events":{"click":{"setState":{"selected":[]}}}}
```

Event inputs may use `event.value` or `event.row`; templates also see their props.
Custom templates compose catalog components and other templates; cycles, missing
props/slots/events, duplicate ids and excessive nesting fail validation. Literal
custom props are checked before saving; deferred values bind at render time.
Validation flags missing state fields/actions and incompatible mapped inputs.
Results bindings without fallback generate warnings.

`richText` supports sanitized HTML/SVG. Scripts, forms, native dropdowns, embedded
pages, external sources and styles are stripped; interactive behavior uses the
component/event contract. Custom JavaScript UI bundles are not evaluated.

## Execution and feedback

Client actions run in the routed NetSuite page and can use client modules such as
currentRecord/dialog/message. Server steps use the existing Quick Script Suitelet
and server modules such as file/task/render; their bodies run synchronously.
Hybrid actions declare ordered client/server steps. Each step gets `input`,
`previous`, `steps`, `context.modules` and `lib`. Return JSON data. Earlier writes
remain if a later step fails; the worker holds account routing across the action.

Set `account: "4027610_SB1"` to require that account. The worker checks the routed
account before execution, and every generated step checks `runtime.accountId`
before helper or action code runs. Account names normalize hyphens/underscores.
Module and risk declarations describe intended compatibility; actual permissions
and governance remain NetSuite's responsibility.

Write actions show a confirmation dialog. Optional `confirmation` and
`successMessage` accept `{{input.length}}`, `{{result.count}}`, and state paths.
Buttons show spinners, results show inline completion feedback/toasts, failures
show errors, and previous results remain visible while reloading.

`onLoad: ["load"]` runs configured read actions once on first active opening.
`refresh: {"actionId":"status", "everyMs":5000}` schedules read-only refreshes
between completed runs. Minimum interval is 1000ms. Hidden documents, inactive
workspace tabs, confirmation dialogs and stale revisions pause refresh. Runs
never overlap. Preview/render views do not run onLoad or refresh. Only `read`
actions are eligible; risk is declared by the author, not inferred from code.

## Libraries, files and versions

```json
{
  "libraries": {"Helpers":{"domain":"both", "modules":[], "codeFile":"lib/helpers.js"}},
  "sourceFiles": {
    "lib/helpers.js": "return {isDigits: value => /^\\d+$/.test(value)};",
    "actions/check.js": "return {valid:lib.Helpers.isDigits(input)};"
  }
}
```

Steps reference `codeFile` instead of inline `code` and use `libraries:["Helpers"]`.
A library returns synchronous helper objects accessible as `lib.Helpers` and
has domain client/server/both. Declared library modules join the step's modules.
The action editor edits stored file contents. Local MCP `code` reads a `filePath`
into stored source, preserving backslashes without requiring JSON code escaping.
Subsequent disk edits require another code update; execution uses stored source.

UI Export/Import use a portable JSON envelope containing the definition and all
sources. Local MCP export's `directory` writes `dashboard.json` plus relative
source files; existing files require explicit `overwrite:true`. Import accepts
that JSON file, whose embedded source snapshot is authoritative. Local paths are
handled on the MCP host and never sent to NetSuite. The export can live beside a
change request in Git. History retains up to 20 previous revisions within a 2 MB
history budget; restoring increments the current revision and never runs actions.

`render` returns actual DOM text, up to 60,000 characters, with a truncation flag,
revision and source (`live-view`/`preview-view`). If no active matching view exists,
the worker opens an inactive extension preview tab and closes it after reading.
Preview shows initial state; live-view shows current loaded results. It does not
claim to return a screenshot or execute an action to populate data.

## Verification

Run Vue/extension build and tests, MCP app checks/tests, and native checks.
Mock-worker browser tests use the real Vue renderer without accessing NetSuite:

```powershell
cd vue-ui
pnpm exec vite --host 127.0.0.1 --port 5174
# Another terminal in vue-ui:
node scripts/testDashboardsUI.mjs
node scripts/testDashboardLiveData.mjs
```

The first test covers CRUD, source editing, responsive layout and sanitization.
The second covers 179-row live selection, repeats/scoped slots, row actions,
state patches, confirmations, filtering/sorting, rendered text and paused preview.
Screenshots are saved under `vue-ui/node_modules/.tmp/dashboard-ui`.
