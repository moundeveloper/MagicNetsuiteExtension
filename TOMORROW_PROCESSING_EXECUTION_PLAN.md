# Processing and Reserved Execution Tab — Tomorrow's Fix Plan

## What went wrong

The reserved dashboard worker tab is not an unused browser tab. Its NetSuite page injects the extension with:

```text
initialRoute=/processing
```

Historically, `/processing` rendered `GridPattern`, `MLoader`, and the text “Nothing to see here.” The recent Jobs Center work replaced that same route and file instead of creating a separate Jobs Center route. That mixed two responsibilities:

- the private, always-open execution/connection surface used by the reserved dashboard tab;
- the user-facing durable job history and inspection view.

The attempted “Nothing to do here” DOM cover was also incorrect. It has been removed. The NetSuite worker page must keep running normally underneath the injected extension UI.

## Intended result

The two surfaces must share execution state but serve different purposes:

| Surface | Route | Purpose |
| --- | --- | --- |
| Reserved execution tab | `/processing` | Focused live status for the work currently using the authenticated NetSuite worker |
| Jobs Center | `/jobs` | Searchable durable history, details, results, errors, retry/cancel requests, and links back to the originating feature |

`/processing` remains internal and hidden from normal navigation. `/jobs` becomes the normal user-facing feature.

## Implementation plan

### 1. Split the current view without losing either design

1. Move the current Jobs Center implementation out of `ProcessingView.vue` into:

   ```text
   vue-ui/src/views/JobsCenterView.vue
   ```

2. Restore `ProcessingView.vue` as the reserved execution surface.
3. Preserve the useful old visual as a reusable component:

   ```text
   vue-ui/src/components/execution/ExecutionStandby.vue
   ```

   It will retain:

   - `GridPattern`;
   - `MLoader`;
   - centered, quiet processing presentation;
   - the original compact visual character.

4. Replace “Nothing to see here” with state-aware copy:

   - idle: **Execution worker ready**
   - subtext: **Waiting for a Magic NetSuite task**
   - active: show the real operation name and progress
   - failed: show the error summary and a link to Jobs Center
   - completed: briefly show completion, then return to idle

The old view therefore returns as the idle state of the real execution monitor instead of becoming another misleading public page.

### 2. Give the reserved tab an explicit standalone surface

The worker iframe must identify itself explicitly instead of relying only on `initialRoute`.

Update the injected iframe URL to carry a surface flag, for example:

```text
?initialRoute=/processing&magicExecutionSurface=1
```

In `App.vue`:

- detect `magicExecutionSurface`;
- render `/processing` directly through `RouterView`;
- do not render `AppHeader` or `ViewTabsWorkspace` in the reserved execution tab;
- keep normal dashboard and side-panel behavior unchanged.

This prevents the worker tab from looking like a second general-purpose dashboard with nested tabs.

### 3. Create a shared execution/job source of truth

The current `jobsDb.ts` is a Vue-side IndexedDB store. That is insufficient for the reserved tab because many important operations start in `background.js` or through MCP.

Use the extension background worker as the single writer for execution state:

```text
Vue feature / MCP / background operation
                 ↓
       background execution store
                 ↓
      chrome.storage.local history
                 ↓
   /processing and /jobs subscribers
```

Required behavior:

- serialize writes to avoid lost updates from concurrent tools;
- persist active and completed jobs across route changes and extension reloads;
- broadcast changes to every open extension surface;
- keep stable job IDs so the execution tab and Jobs Center display the same object;
- clamp progress to `0–100`;
- retain timestamps, account, environment, attempt, result, error, and source route;
- keep retry/cancel as requests until the originating producer acknowledges them.

Preserve the public API currently used by `BundleDetailView.vue` where practical:

```ts
createJob(...)
updateJob(...)
listJobs(...)
requestJobAction(...)
clearCompletedJobs(...)
```

The implementation behind those functions can become a background-message client so existing feature code does not need a broad rewrite.

### 4. Instrument real execution producers

The reserved tab only makes sense if it reflects real work. Register lifecycle updates for:

- MCP tool execution in `background.js`;
- Template Studio render/update/screenshot workflows;
- SDF and bundle conversion jobs;
- account switching and server-component deployment when they perform meaningful work;
- other long-running operations as they are identified.

Avoid filling history with internal noise. Do not persist trivial pings, UI-only reads, or rapid skill metadata searches as user jobs.

Each meaningful operation should follow:

```text
queued → running → succeeded
                   ↘ failed
                   ↘ cancel-requested → cancelled
failed/cancelled → retry-requested → running
```

For tool executions that do not expose real progress, use an indeterminate loader and meaningful phase text rather than inventing percentages.

### 5. Design the reserved execution surface around live work

`ProcessingView.vue` should be compact and operational:

- account/environment indicator;
- connection status;
- active operation title;
- indeterminate loader or real progress when available;
- elapsed time;
- current phase/message;
- compact queued-operation list when more than one job exists;
- most recent completion or failure;
- **Open Jobs Center** action for full history/details.

State rules:

- no active job: render `ExecutionStandby`;
- one active job: focus on it;
- multiple active jobs: focus on the oldest running job and show the remaining queue;
- terminal job: show its result briefly, then return to idle while keeping it in `/jobs`;
- storage/connection error: show a real recoverable error state, never a blank screen.

### 6. Make Jobs Center a normal route

Add a route:

```text
/jobs → JobsCenterView.vue
```

Route metadata:

- name: `Jobs Center`
- icon: `pi pi-list-check`
- breadcrumb: `Jobs Center`
- status: release

Keep `/processing`:

- name: `Execution Monitor`
- internal-only;
- excluded from App Header, sidebar navigation, recent views, and Command Palette;
- available only to the reserved execution surface and direct diagnostics.

Remove the current inconsistent filtering where `/processing` is hidden by path in one place but filtered by the old name in another.

### 7. Extract reusable job UI instead of duplicating 1,000 lines

Extract shared pieces where they materially reduce duplication:

```text
components/execution/ExecutionStandby.vue
components/jobs/JobStatusBadge.vue
components/jobs/JobProgress.vue
composables/useJobs.ts
```

Keep full history filters, destructive clear action, and detailed result/error panels inside `JobsCenterView.vue`. The reserved execution surface should consume only the small live-status components it needs.

Follow the existing UI rules:

- compact professional layout;
- restrained violet/periwinkle active states;
- project tokens before new hard-coded colors;
- no native `<select>` or `<option>`;
- use `MSelect` for Jobs Center filters;
- keyboard focus and screen-reader status announcements;
- no gradients, marketing cards, oversized empty states, or decorative clutter.

## Files expected to change

```text
src/content/ui/frame/iframe.js
src/content/ui/dock/dock.js
src/background.js
vue-ui/src/App.vue
vue-ui/src/router/routesMap.ts
vue-ui/src/router/index.ts
vue-ui/src/components/AppHeader.vue
vue-ui/src/components/CommandPalette.vue
vue-ui/src/components/ItemListNavigation.vue
vue-ui/src/views/ProcessingView.vue
vue-ui/src/views/JobsCenterView.vue
vue-ui/src/components/execution/ExecutionStandby.vue
vue-ui/src/components/jobs/JobStatusBadge.vue
vue-ui/src/components/jobs/JobProgress.vue
vue-ui/src/composables/useJobs.ts
vue-ui/src/utils/jobsDb.ts
```

The exact extraction list may shrink if a component would only be used once.

## Verification and acceptance criteria

### Reserved tab

- Opening the Magic NetSuite dashboard creates/reuses the expected dashboard group.
- The reserved NetSuite worker tab shows the standalone Execution Monitor.
- Idle state visibly uses the restored `GridPattern` + `MLoader` presentation.
- The page says what the tab is for; it never says “Nothing to see here.”
- Starting a meaningful job changes the reserved tab from idle to the real running operation without refresh.
- Reloading the worker tab restores the current execution state.
- Switching accounts updates the environment/account label and does not create duplicate dashboard groups.
- The injected UI does not interfere with authenticated NetSuite API execution.

### Shared state

- A job started by Bundle-to-SDF appears with the same ID and status in both `/processing` and `/jobs`.
- A Template Studio generation/render operation appears in the execution monitor.
- A meaningful MCP mutation appears while running and moves to success/failure correctly.
- Retry and cancel remain requests until acknowledged by the producer.
- Concurrent operations do not overwrite one another.

### Jobs Center

- `/jobs` is discoverable in normal dashboard navigation and the Command Palette.
- `/processing` remains hidden from normal navigation.
- Search, `MSelect` filters, details, results, errors, clear-completed, retry, cancel, and source links still work.
- Empty history and no-filter-results are distinct states.

### Regression checks

- No `[object Promise]` in any workspace tab.
- No native user-facing `<select>` or `<option>` in changed UI.
- Vue tests, type checking, and production build pass.
- MCP app tests/build and extension JavaScript syntax checks pass.
- `run.bat` completes its lockfile policy check and packaging.
- Final packaged extension is copied to `C:\Projects\MagicNetsuiteExtensionM` only after all checks pass.

## Work order for tomorrow

1. Split `/processing` and `/jobs`.
2. Restore the old processing visual as `ExecutionStandby`.
3. Make the reserved execution iframe an explicit standalone surface.
4. Centralize execution state in the background worker.
5. Connect the current Bundle job producer.
6. Connect Template Studio and meaningful MCP execution producers.
7. Add unit tests for state transitions and route visibility.
8. Build and test the extension and MCP packages.
9. Run the packaged extension and manually verify both Chrome tabs before handoff.

