# Magic NetSuite Extension — Improvement and Feature Audit

Audit date: 2026-07-28

## Executive summary

Magic NetSuite is already much more than a browser extension: it is a NetSuite developer/admin workbench spanning SuiteScript, SuiteQL, records, logs, File Cabinet, Advanced PDF templates, SDF, an MCP bridge, and several agent workflows. The biggest opportunity is not adding isolated tools; it is making the existing platform safer, faster, easier to navigate, and more coherent.

Recommended order:

1. Close the release-blocking security and privacy gaps.
2. Establish CI, high-risk tests, and a reproducible toolchain.
3. Lazy-load the dashboard and split the largest modules.
4. Fix shared accessibility/navigation primitives and narrow-panel behavior.
5. Add a production-aware Change Center, durable Jobs Center, and record-change inbox.
6. Connect existing features into cross-account promotion and unified troubleshooting workflows.

## Implementation status

The first two improvement tranches are implemented in the current working tree.
They deliberately prioritize trust boundaries, startup performance, shared
controls, and one durable workflow before expanding into more product surface.

### Completed

- MCP HTTP now binds to loopback by default, refuses unauthenticated
  non-loopback exposure, supports bearer authentication, and uses an explicit
  browser-origin allowlist. Nine policy tests cover the boundary.
- The page bridge now uses a random per-injection capability, same-origin/source
  checks, payload validation, and regression tests against forged messages.
- AI/Markdown HTML is sanitized with a strict current DOMPurify allowlist and
  malicious-content tests.
- The embedded admin passkey is gone. The feature is now honestly described as
  temporary “Advanced Tools” visibility, not authorization.
- GitHub/OpenRouter credentials were migrated out of Chrome Sync into local
  storage, settings persistence is a single debounced module, and the privacy
  policy now discloses recipients, stores, retention, and optional automation.
- External AI calls are blocked until a versioned, locally stored first-use
  disclosure is accepted. Consent is visible and revocable in Settings;
  loopback Ollama/OpenCode endpoints remain local and exempt.
- The vulnerable expression evaluator was replaced by a constrained numeric
  parser. Vue UI and MCP app production audits currently report no known
  vulnerabilities.
- All feature routes are lazy-loaded. The startup bundle fell from roughly
  8.4 MB / 2.0 MB gzip to about 292 KiB / 82 KiB gzip; CI enforces a
  400 KiB / 100 KiB budget. Bundle visualization is now opt-in.
- Shared `MSelect`, `MPanel`, and `MTabs` controls implement their corresponding
  ARIA and keyboard patterns, focus restoration, restrained selected states,
  and reduced-motion behavior. Settings single-choice controls now use
  `MSelect`.
- App-level listeners/ports are torn down correctly, and a safe accessible error
  boundary offers retry, home, copy-safe-details, and reload recovery.
- The released Jobs Center persists durable operations in IndexedDB with
  filters, deep links, progress, results/errors, and honest retry/cancel request
  states. Bundle-to-SDF conversion is the first connected producer.
- The full element screenshot picker is injected on demand instead of executing
  persistently on every website and frame. A small NetSuite-only shortcut
  bootstrap preserves the configured shortcut.
- CI now performs frozen installs, type checks, tests, production builds,
  dependency audits, extension syntax checks, the bundle budget, and the
  repository `MSelect` rule. Vue UI and MCP app use pinned pnpm; generated bundle
  reports are no longer tracked.
- Root setup, validation, security configuration, jobs integration, and
  packaging behavior are documented in `README.md`.

### Still open

- Replace the anonymous Supabase update policy with deployed authenticated
  user/admin operations. This needs backend configuration and cannot be secured
  by another browser-side flag.
- Replace the public same-window bridge with a stronger isolated-world/RPC
  boundary. The capability blocks blind and cross-origin forgery but can be
  observed by a script already executing in the same NetSuite page.
- Move credentials from local extension storage to an OS-backed native-host
  credential store, and make Playwright session persistence opt-in, minimized,
  encrypted, and visibly clearable.
- Continue structured log redaction, broader Chrome permission reduction,
  workspace/home keyboard semantics, compact side-panel navigation, and
  production-aware write confirmation.
- Connect more producers to Jobs Center, then build Change Center,
  record-change inbox, cross-account promotion, federated search, and unified
  triage in the roadmap order below.

## Audit scope and baseline health

Three parallel reviews covered engineering/security, UX/accessibility, and product opportunities. A final pass verified the highest-impact findings against the source.

The following checks passed at the start of the audit:

- `vue-ui`: 5 test files, 79/79 tests.
- `vue-ui`: TypeScript and production build.
- `mcp_app`: client and server TypeScript checks.
- `mcp_server`: JavaScript syntax checks.
- `sdf_tool`: JavaScript syntax checks.
- No native user-facing `<select>` or `<option>` elements were found under `vue-ui/src`.

Important context:

- The UI exposes 31 top-level routes: 26 released, 2 development, and 3 draft (`vue-ui/src/router/routesMap.ts`).
- The production build emits an approximately 8.4 MB minified main bundle (about 2.0 MB gzip), plus large editor/PDF workers.
- Only five test files exist, all in `vue-ui`; most tests cover the SuiteQL linter rather than browser, UI, MCP, or security boundaries.
- `pnpm audit --prod` reported 3 high / 15 moderate / 4 low advisories in `vue-ui` and 4 high / 8 moderate / 1 low in `mcp_app`.

## Priority key

| Priority | Meaning |
| --- | --- |
| P0 | Release/security blocker; address before distributing or exposing the affected feature |
| P1 | High user or engineering impact; next delivery cycle |
| P2 | Valuable enhancement or foundation work |
| P3 | Polish or cleanup |

Effort is a rough relative estimate: S (days), M (roughly 1–2 weeks), L (multi-week/cross-cutting).

## P0 — Security and privacy blockers

### 1. Lock down the MCP HTTP server

**Evidence**

- `mcp_app/main.ts:12-20` binds to `0.0.0.0`, enables unrestricted `cors()`, and accepts all HTTP methods at `/mcp`.
- `mcp_app/server.ts:1913-1924` exposes a Suitelet evaluation tool.
- `mcp_app/playwright-controller.ts:1056-1066` evaluates JavaScript in the controlled, authenticated browser page.

**Risk**

The HTTP mode can expose control of an authenticated NetSuite session to other machines on the local network or to an untrusted web origin. There is no authentication boundary in front of the MCP endpoint.

**Recommendation — P0 / M**

- Bind to `127.0.0.1` by default.
- Require a generated bearer token or use local IPC only.
- Allowlist origins and reject missing/unexpected origins.
- Disable arbitrary page evaluation in HTTP mode or place it behind a separate explicit capability.
- Warn loudly if a user intentionally binds to a non-loopback address.
- Add regression tests for bind address, CORS, authentication, and dangerous-tool gating.

### 2. Authenticate the page-context command bridge

**Evidence**

- `src/netsuiteApi/netsuiteApi.js:130-165` accepts any same-window `FROM_EXTENSION` message and dispatches its `action`; it checks `event.source` but no extension-only nonce/capability.
- `src/content/core/messaging/messageListener.js:177-189` posts the same predictable message shape with target `"*"`.
- The action surface contains write/execute operations such as script execution, record creation/update, file deletion, and template save (`vue-ui/src/types/request.ts:1-76`).

**Risk**

Any script executing in the NetSuite page context can impersonate the extension bridge and request privileged actions under the current user’s session. Exploitation still requires page-context code execution, but custom content and third-party page code make that an important trust boundary.

**Recommendation — P0 / M**

Establish an unpredictable, per-tab capability during injection and require it on every request/response. Validate action schemas before dispatch. Prefer a `MessageChannel` or isolated-world relay with strict source/capability checks, and add tests proving forged page messages are rejected.

### 3. Sanitize AI and Markdown output before using `v-html`

**Evidence**

- `vue-ui/src/components/MessageContentRenderer.vue:177-190` transforms raw content and `:280-284` renders it using `v-html`.
- `vue-ui/src/utils/markdownRenderer.ts:158-173`, `:220-264`, and `:277-312` interpolate headings, list content, labels, and links without consistently escaping content or validating URL schemes.

**Risk**

Model responses and tool output are untrusted. Crafted content can inject DOM or unsafe links. The extension CSP reduces some script paths but is not a substitute for sanitization.

**Recommendation — P0 / S**

Use a maintained Markdown parser with raw HTML disabled, sanitize the output with a current allowlist sanitizer, restrict link schemes to `http`, `https`, and explicitly supported protocols, and add malicious-content tests.

### 4. Remove the embedded “admin” passkey as a security boundary

**Evidence**

- `vue-ui/src/utils/adminAccess.ts:4-7` contains a hard-coded passkey.
- `vue-ui/src/utils/adminAccess.ts:92-106` performs a client-side string comparison and stores the grant in `chrome.storage.session`.
- `vue-ui/src/router/index.ts:28-35` only guards navigation.

**Risk**

Anyone can read the bundled secret or invoke underlying operations directly. Route visibility is not authorization.

**Recommendation — P0 / S–M**

If this is only intended to hide advanced tools, rename it “Advanced mode” and explicitly treat it as non-security UI state. If real authorization is required, use an actual entitlement/authentication mechanism and enforce it at every privileged operation.

### 5. Replace the public Supabase update model

**Evidence**

- `docs/supabase_feature_feedback.sql:42-58` allows anonymous users to select and update every feature-request row.
- `vue-ui/src/utils/featureFeedbackApi.ts:117-151` performs status/admin-response updates using the public anonymous key.
- Admin presentation is controlled only by a build variable in `vue-ui/src/views/FeatureFeedbackView.vue:25`.

**Risk**

Possession of the public endpoint/key is sufficient to read and modify other users’ feedback, including admin status/response fields. A generated browser `user_id` is not authentication.

**Recommendation — P0 / M**

Move privileged updates behind an authenticated service or Supabase authenticated role. Restrict user policies to their own rows, separate user-editable from admin-only columns/operations, and rate-limit anonymous creation.

### 6. Correct privacy disclosures and secret/session storage

**Evidence**

- `PRIVACY_POLICY.md:30-38` says no data is shared with third parties and no data is sent to external servers.
- OpenRouter calls transmit content externally (`vue-ui/src/composables/useAiProvider.ts:642-653`, `:852-856`).
- Feedback sends a persistent user ID, title, and description to Supabase (`vue-ui/src/utils/featureFeedbackApi.ts:40-74`, `:106-127`).
- The policy describes only sync/session storage, while the app uses `chrome.storage.local`, localStorage, and many IndexedDB databases.
- GitHub/OpenRouter credentials are part of the settings object (`vue-ui/src/states/settingsState.ts:25-29`) and the full object is persisted through `chrome.storage.sync` (`:152-168`).
- Playwright writes reusable browser storage state under the user profile (`mcp_app/playwright-controller.ts:9-20`, `:125-150`).

**Recommendation — P0 / M**

- Update the policy before release: identify recipient categories, transmitted data, local stores, retention, deletion, and optional external AI behavior.
- Show first-use disclosure before external AI or feedback transmission.
- Move secrets out of sync storage; prefer an OS-backed credential store through the native host, with local storage as a documented fallback.
- Make Playwright session persistence opt-in, encrypt it with the OS credential system, minimize stored cookies/origins, and add a visible “Clear saved session” action.

### 7. Patch and continuously audit production dependencies

**Evidence**

- `vue-ui/package.json:41` includes `expr-eval ^2.0.2`; the audit reports two high advisories fixed in `>=2.0.3`.
- Agent-controlled expressions reach `Parser.evaluate` at `vue-ui/src/utils/toolManager.ts:288-317`.
- The MCP app also has current high transitive findings in `hono`, `fast-uri`, and `postcss`.

**Recommendation — P0 / S–M**

Update direct and transitive dependencies, consider replacing general expression evaluation with a deliberately limited numeric evaluator, regenerate the chosen lockfile, and make production dependency auditing a CI gate with documented exceptions.

## P1 — Engineering and performance improvements

### 8. Reduce extension permissions and all-site injection

`src/manifest.json:25`, `:94-99`, and `:114-130` combine `<all_urls>`, an all-frame screenshot-picker content script, cookies, debugger, webRequest, downloads, native messaging, unlimited storage, scripting, and other broad permissions.

Inject the screenshot picker on demand using `activeTab`/`scripting`, move rare capabilities to optional permissions, narrow host access, and explain sensitive permissions at the moment they are enabled. This reduces unrelated-page overhead, store-review friction, and compromise blast radius. **Effort: M.**

### 9. Stop logging sensitive production payloads

There are hundreds of console calls across source. Examples include user prompts and complete tool inputs (`vue-ui/src/composables/useAgent.ts:1976`, `:2312`) and template payloads (`src/netsuiteApi/netsuiteApi.js:3044-3045`).

Introduce a structured logger with production output disabled by default, redact credentials/record contents, and provide a time-limited diagnostic mode that explains what will be captured. **Effort: M.**

### 10. Lazy-load features and set startup budgets

All major views are eagerly imported at `vue-ui/src/router/routesMap.ts:1-36`. The resulting build has an approximately 8.4 MB minified main chunk plus large Monaco/TypeScript, PDF, and screenshot assets.

Use route-level dynamic imports and load Monaco, PDF.js, Vue Flow, SQL parsing, and workers only when a relevant feature opens. Make bundle analysis opt-in and enforce compressed startup/chunk budgets in CI. **Effort: M.**

### 11. Split monoliths behind typed capability boundaries

Largest examples:

| File | Approximate lines |
| --- | ---: |
| `src/background.js` | 10,012 |
| `vue-ui/src/views/NetsuiteAgentHarnessView.vue` | 5,587 |
| `vue-ui/src/components/FileCabinetPane.vue` | 4,837 |
| `src/netsuiteApi/netsuiteApi.js` | 3,911 |
| `vue-ui/src/views/ApiTesterView.vue` | 3,692 |
| `vue-ui/src/views/MultiAgentView.vue` | 3,083 |
| `vue-ui/src/composables/useAgent.ts` | 2,662 |
| `mcp_server/magiNetsuiteMCPServer.js` | 2,618 |

Split by bounded capability: tab/session lifecycle, NetSuite transport, downloads, files, records, templates, SDF, and agent orchestration. Define one versioned, runtime-validated request/response contract shared by UI, content scripts, background, native host, and MCP apps. **Effort: L.**

### 12. Make settings persistence a singleton

Each `useSettings()` call installs its own deep watcher and mounted loader at `vue-ui/src/states/settingsState.ts:94-173`; it is used by several views/components. One mutation can therefore trigger repeated full-object serialization and sync writes.

Initialize and watch once at store/module level, debounce persistence, store only changed keys, separate secrets, and expose a single readiness promise. **Effort: S–M.**

### 13. Add CI and risk-focused tests

No CI configuration is present. Existing tests do not cover the background worker, page bridge, native host, MCP HTTP server, secret/session storage, route/UI permissions, or HTML rendering.

Add a root CI workflow for frozen install, type checks, lint/format, unit tests, production audit, and builds for every package. Prioritize tests for MCP auth/CORS, forged bridge messages, sanitization, secret migration, production write confirmation, native messages, and Chrome API integration. Add a small Playwright/Vitest component suite for primary user journeys. **Effort: M.**

### 14. Standardize the toolchain and release flow

- Both `vue-ui/package-lock.json` and `vue-ui/pnpm-lock.yaml` are tracked.
- Build scripts mix npm and pnpm.
- `run.bat:68-86` and later steps hard-code local project/reloader paths and an extension ID.
- `vue-ui/README.md` remains the stock Vite starter text; there is no root architecture/setup/release guide.
- `vue-ui/package.json:6-12` has no lint/format/check script despite Prettier being installed.

Choose one package manager/lockfile, pin Node and the package manager, create root `check`, `test`, `build`, and `package` commands, parameterize deployment paths/IDs, separate safe builds from destructive packaging, add ESLint/Vue rules, and document setup/recovery. **Effort: M.**

### 15. Fix app-level lifecycle and error handling

- `vue-ui/src/App.vue:65-78` registers an anonymous runtime listener that cannot be removed.
- `App.vue:105` removes a `beforeunload` listener that is never registered.
- There is no app-level Vue error boundary or visible unhandled-error surface.
- `vue-ui/src/utils/api.ts:446-489` records API activity, but view-level async errors are handled inconsistently.

Use stable listener references, complete teardown, add an app error boundary, and route user-action failures to a shared activity/error center with retry and support-bundle actions. **Effort: S–M.**

## P1 — UX and accessibility improvements

### 16. Repair shared controls once, then inherit the fix everywhere

- `MSelect` has a popup but no complete combobox/listbox model, option roles, `aria-selected`, `aria-controls`, or accessible search label (`vue-ui/src/components/universal/input/MSelect.vue:3-73`).
- `MPanel` uses a clickable `div` for its toggle, without keyboard operation or `aria-expanded` (`vue-ui/src/components/universal/panels/MPanel.vue:9-18`, `:120-132`).
- `MTabs` lacks tab roles and arrow/Home/End navigation and nests a close button inside a tab button (`vue-ui/src/components/universal/tabs/MTabs.vue:5-65`).

Implement the standard ARIA combobox/listbox, disclosure, and tabs patterns, including roving focus and focus restoration. These shared changes have the highest accessibility return. **Effort: M.**

### 17. Make workspace tabs and navigation keyboard-first

- Workspace tabs are draggable clickable `div` elements without tab semantics or keyboard reordering (`vue-ui/src/components/ViewTabsWorkspace.vue:1124-1153`, `:1188-1213`, `:1243-1268`).
- Home and drawer destinations are clickable tile `div`s instead of normal tabbable links (`vue-ui/src/views/HomeView.vue:215-309`, `vue-ui/src/components/AppHeader.vue:501-597`).
- The recent-item remove control is nested inside a button (`vue-ui/src/views/HomeView.vue:175-201`).

Use real link/tab/button elements. Keep drag as an enhancement and add commands for move left/right, move to pane, split, close, and restore. **Effort: M.**

### 18. Unify feature discovery and route visibility

Home allows some prerelease routes for admins while the drawer uses development build mode (`vue-ui/src/views/HomeView.vue:41-50`, `vue-ui/src/components/AppHeader.vue:46-54`). Route metadata contains no category, description, keywords, or prerequisites (`vue-ui/src/router/routesMap.ts:53-62`), and name-only search is duplicated.

Create one feature registry and one `visibleFeatures/canAccess` composable. Add category, keywords, one-line description, account/capability prerequisites, and lifecycle status. Power Home, drawer, and command palette from it with fuzzy search and compact grouped results. **Effort: M.**

### 19. Build a compact responsive shell for the side panel

The header simultaneously shows logo, full menu label, breadcrumb, environment badge, command palette, account selector, and settings (`vue-ui/src/components/AppHeader.vue:327-443`). Most controls do not shrink; the responsive rule only slightly trims the environment badge.

At narrow widths, use labelled icon buttons, collapse breadcrumb/environment details, and move secondary actions into an overflow menu. Test at 320, 360, and 480 px. The current large square feature grids (`vue-ui/src/views/HomeView.vue:212-214`, `:266-268`) should gain a compact list/group mode consistent with the project’s professional tool aesthetic. **Effort: M.**

### 20. Standardize loading, empty, error, and destructive states

- Home/drawer settings gates can render blank with no loading/error fallback (`vue-ui/src/views/HomeView.vue:150-157`, `vue-ui/src/components/AppHeader.vue:472-600`).
- A zero-result feature search has no explicit empty state.
- Command Palette closes before async record resolution and has no inline failure/retry (`vue-ui/src/components/CommandPalette.vue:238-263`).
- Workspace snapshot deletion is immediate and its library dialog lacks modal/focus semantics (`vue-ui/src/components/ViewTabsWorkspace.vue:738-748`, `:1401-1494`).

Create reusable async-state and accessible-dialog primitives. Prefer undo to a blocking confirmation for reversible local deletion; show environment-aware confirmation for irreversible NetSuite writes. **Effort: M.**

### 21. Finish the custom-control migration and reduce design drift

There are no native selects, which satisfies the explicit repository rule. However, 19 PrimeVue single-choice `<Select>` instances remain across seven files, including Settings, Feature Feedback, Flight Recorder, MCP Server, Agent Harness, Deployed Scripts, and Template Detail. Migrate these to the project’s `MSelect`.

Home and AppHeader duplicate feature-tile styles, and components contain many hard-coded colors. Extract shared feature navigation components and palette/state tokens, following the restrained violet/periwinkle selected-state system. Add `prefers-reduced-motion` handling for route/tab animations. **Effort: M.**

## Feature roadmap

These proposals deliberately reuse code that already exists.

### A. Production-aware Change Center — P1 / L

**Why:** Writes currently occur independently across script, template, file, record, and SDF tools. Users need one predictable safety model, especially in production.

**Existing foundations**

- Write/execute routes are already classified in `vue-ui/src/utils/activityRecorderDb.ts:31`.
- The header already detects Sandbox versus Production (`vue-ui/src/components/AppHeader.vue:70-83`).
- Dependency Explorer detects operations, external targets, unresolved references, and cycles (`vue-ui/src/utils/scriptDependencyDb.ts:22`, `vue-ui/src/views/DependencyExplorerView.vue:121`).
- File/template version history and SDF validation/deployment already exist.

**MVP**

- Central preflight for write-classified operations.
- Production account badge, target summary, compact diff, dependency impact, and explicit confirmation.
- Durable change receipt with account, target, redacted payload summary, result, timestamp, and previous content where recoverable.
- Assisted rollback for safely reversible file/template changes.

Call this rollback assistance, not transactional rollback; NetSuite operations are not atomic.

### B. Durable Operations / Jobs Center — P1 / L

`/processing` is a hidden draft placeholder (`vue-ui/src/router/routesMap.ts:280`, `vue-ui/src/views/ProcessingView.vue:6`), while bundle conversion, dependency scans, SDF work, agent runs, and exports have view-local progress.

Persist jobs in IndexedDB with status, progress, target account, start/end time, result, retry/cancel capability, and a deep link to the source feature. Add a compact active-jobs indicator. Design for Manifest V3 worker suspension: durable state cannot depend on in-memory timers.

### C. Record-change inbox — P1 / M

The snapshot engine already stores fingerprints, snapshots, field-level diffs, counts, and timestamps (`vue-ui/src/utils/recordWatchDb.ts:17`, `:99`, `:177`, `:223`), but views do not consume its capture/diff APIs.

Capture `LOAD_RECORD_JSON` when a record is watched, add manual “Check for changes” and batch refresh, show unread field/sublist changes, and combine the deterministic before/after view with the existing System Notes “who changed it” timeline. Start manually; automatic background checks would require additional scheduling and authenticated-tab behavior.

### D. Cross-account compare and promotion — P1 / L

The app already discovers open account tabs (`vue-ui/src/utils/api.ts:541`), switches dashboard context (`vue-ui/src/components/AppHeader.vue:99-155`), accepts SDF account overrides (`mcp_server/magiNetsuiteMCPServer.js:2306`), and can list/import SDF objects.

Compare scripts, files, templates, and custom record types between sandbox and production; normalize volatile IDs; select changes; validate dependencies/features; then hand the approved set to Change Center. Always support a downloadable SDF project when direct promotion is unavailable.

### E. Federated “find anything, do anything” palette — P1 / M

The current palette covers routes, recents, and a few exact patterns (`vue-ui/src/components/CommandPalette.vue:16`, `:72-109`). Expand it with debounced, cancellable search across scripts, records, File Cabinet, templates, and bundles. Group by type/account and offer actions such as open dashboard, open NetSuite, view history, edit source, copy ID, and ask the agent. Cache strictly per environment.

### F. Unified error and performance triage — P1 / L

Connect existing script logs/source/deployments, Flight Recorder latency/errors, dependency evidence, and local versions into one incident view. Group errors by signature, link to likely source lines and dependencies with a visible confidence level, compare against the last version, and export a redacted support bundle. Agent explanation should be optional and layered over deterministic evidence.

### G. Complete record-bound Advanced PDF rendering — P1 / M

Template Detail exposes a Render Template tab but its handler is empty and the UI says “coming soon” (`vue-ui/src/views/TemplateDetailView.vue:207`, `:274`, `:652`). The surrounding preview, FreeMarker Renderer, Template Studio, Review, and record-binding skill already exist.

Add record type/record selection, render unsaved source, map parse errors to editor lines, retain/compare the last successful artifact, and provide explicit Save, Approve, and Send to Review actions.

### H. Visual SDF metadata builder — P2 / L

Structured creation of custom record types, fields, PDF templates, scripts, deployments, schedules, roles, and execution contexts already exists behind MCP (`mcp_server/magiNetsuiteMCPServer.js:2205-2306`), and the bundle SDF UI already previews ZIPs, manifests, and dependencies.

Expose a wizard for common metadata, generated XML/manifest preview, validate-only, download, and Change Center deployment. Preserve raw XML as an expert escape hatch and use `MSelect` for all single-choice controls.

### I. Contextual agent and object-linked runbooks — P2 / M

Add “Ask about this” and “Add note” actions to script, record, log, bundle, template, and file detail headers. Attach a visible, minimal context envelope—account, object type/ID, selection, and deep link—rather than silently attaching full records or source. Store conversations/notes by account + object key and show backlinks.

Before expanding this, graduate one primary agent experience; Agent Harness and Multi-Agent are both substantial but still draft, while Claude CLI remains development-only (`vue-ui/src/router/routesMap.ts:347-401`).

## Partially built capabilities worth finishing or removing

| Capability | Evidence | Decision |
| --- | --- | --- |
| Record snapshot/diff engine | `vue-ui/src/utils/recordWatchDb.ts` | Connect it to Record History |
| Processing screen | `vue-ui/src/views/ProcessingView.vue:6` | Replace with Jobs Center |
| Template “Render Template” tab | `vue-ui/src/views/TemplateDetailView.vue:652` | Complete it |
| Bundle conversion polling | `vue-ui/src/views/BundleDetailView.vue:44-60` | Move ownership to Jobs Center |
| SDF deploy/list/import | `mcp_server/magiNetsuiteMCPServer.js:2193-2410` | Expose safely through Change Center/UI |
| Playground | `vue-ui/src/views/PlaygroundView.vue:1-10` | Turn into an actual component lab or remove from navigation |
| Multi-Agent / Agent Harness / Claude CLI | `vue-ui/src/router/routesMap.ts:347-401` | Choose one primary UX; clearly label experiments |

## Suggested delivery sequence

### Phase 0 — Trust boundary

MCP loopback/authentication, bridge capability token, HTML sanitization, admin-mode correction, Supabase policies, privacy disclosures, secret/session migration, and dependency upgrades.

### Phase 1 — Reliable foundation

CI/security tests, one package manager, root documentation/scripts, structured logging, permission reduction, settings singleton, and app-level error handling.

### Phase 2 — Fast and accessible shell

Route lazy loading, bundle budgets, accessible `MSelect`/panels/tabs/dialogs, keyboard workspace navigation, unified feature registry, compact responsive header, and consistent async states.

### Phase 3 — Workflow coherence

Change Center, Jobs Center, record-change inbox, and completed PDF rendering.

### Phase 4 — High-leverage expansion

Cross-account compare/promotion, federated palette, unified triage, visual SDF builder, and contextual runbooks.

## Definition of success

- No unauthenticated network or page-context path can invoke privileged NetSuite actions.
- External data transmission and local/session storage behavior match the privacy policy and in-product consent.
- Production startup does not eagerly load feature-specific editors, PDF tooling, or graph libraries.
- Primary navigation, tabs, dropdowns, modals, and destructive flows work with keyboard and screen readers at side-panel widths.
- Long operations survive navigation/reopening and report their state centrally.
- Every NetSuite write has a consistent environment-aware safety and receipt model.
- CI verifies all packages, security regression tests, dependency audit, and bundle budgets on every change.
