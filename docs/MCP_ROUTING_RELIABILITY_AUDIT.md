# MCP Routing & Tooling — Intermittent Failure Audit

_Date: 2026-09-24 · Scope: `mcp_server/` (stdio MCP server + native host), `mcp_app/` (magic-netsuite-apps), `extension-src/background.ts` routing, content-script messaging, Vue settings state · Mode: analysis only, no code changed._

---

## 1. Evidence used

| Source | Location | What it contains |
|---|---|---|
| MCP server log | `C:\Projects\MagicNetsuiteExtensionM\mcpServer\magiNetsuiteMCPServer.log` (70 MB, 2026-08-06 → 2026-09-24) | Every JSON-RPC message and every bridge request/response, per process (`pid`) |
| Native host log | `...\mcpServer\magicNetsuiteNativeHost.log` | Host start/stop, IPC client connects, relayed messages |
| Jobs Center history | Brave profile `Local Extension Settings/nnkjegioomnaelmeiemdfmhipcpgomlp` (key `magic_netsuite_jobs_v1`, read from a copy) | 461 `mcp-tool-execution` jobs with status, account and error |
| Synced settings history | Brave profile `Sync Extension Settings/nnkjegioomnaelmeiemdfmhipcpgomlp` | 249 historical writes of `magic_netsuite_settings.mcpPreferredAccount` |
| Runtime topology | Process tree | The extension runs in **Brave**, not Chrome. Two MCP servers are configured in Claude Desktop (`magic-netsuite` exe + `magic-netsuite-apps` node), and both share pipe `magic_netsuite_mcp_bridge` |

### Headline numbers

| Metric | Value |
|---|---|
| MCP server processes seen | 506 (340 `local-agent-mode-magic-netsuite`, 89 `codex-mcp-client`, 41 `claude-ai`, 10 `opencode`) |
| Bridged tool calls | 2,496, of which 352 failed |
| `netsuite_switch_environment` calls | 149, **36 failed (24%)** |
| Of those 36 | 34 × `selected tab belongs to unknown`, 1 × `Tab … did not finish loading in 15000ms`, 1 × `No active NetSuite tab` (empty `accountId`) |
| Jobs Center failed MCP jobs | 29 of 461. **25 of the 29 (86%) are Switch Environment** |
| Account preference changed by a *different* process than the previous switch | 64 times |
| Claude Desktop agent-mode processes that **died right after returning a JSON-RPC error** | **300 of 301** processes that had an error (261 respawned within 30 s). Other clients: 0 |

---

## 2. Architecture as it actually runs

```
Claude Desktop (agent mode) ─┬─ magiNetsuiteMCPServer.exe (1 process per session, often short-lived)
Claude Code / Codex / OpenCode┤                    │
                              └─ mcp_app node (magic-netsuite-apps, Playwright)
                                                   │  \\.\pipe\magic_netsuite_mcp_bridge  (shared by ALL processes)
                                   magicNetsuiteNativeHost.exe (1, spawned by Brave)
                                                   │  Native Messaging
                                   Extension service worker (ONE global routing state)
                                    ├─ chrome.storage.sync  magic_netsuite_settings.mcpPreferredAccount   ← global
                                    ├─ mcpDedicatedTabId / mcpDedicatedTabAccountId (module vars)       ← global
                                    ├─ getPreferredNetsuiteTab() → tab → content script → page bridge
                                    └─ MCP Suitelet (server-side tools) via fetch(credentials: include)
```

The key structural fact is that **every MCP session, every client and both MCP servers share one routing target**. That target is stored in synced extension storage and resolved again, independently, on every tool call.

---

## 3. Findings: `netsuite_switch_environment`

### F1 — CRITICAL · A "failed" switch actually succeeded (false negative on the first switch to a non-open account)

- **Code:** `extension-src/background.ts:6072-6106` (`createMcpDedicatedTab`), `:6098` `resolve(tab)`, `:9076-9083`.
- **Mechanism:** `createMcpDedicatedTab` resolves with the `tab` object from the `chrome.tabs.create` callback. That is a snapshot taken **before navigation commits**, so `tab.url` is `""` (only `pendingUrl` is set). `waitForTabComplete` waits for the load but never re-reads the tab. `handleNetsuiteSwitchEnvironment` then runs `extractAccountIdFromUrl(tab.url)`, gets `null`, and throws `Could not route MCP calls to account X; selected tab belongs to unknown.` Meanwhile the dedicated tab exists, `mcpDedicatedTabId/AccountId` are set correctly (via `tab.url || url` at `:6095`), and the preference is already persisted.
- **Evidence:** every one of the 34 "unknown" failures took about 2.5–5 s, which matches a page load. The retry in the next process ~7 s later succeeds with `"routing": "dedicated-tab"`. Examples: 09-11 12:27:07 fail → 12:27:14 OK (dedicated-tab), 09-14 06:36:05 → 06:36:15, 09-14 10:52:51 → 10:52:58, 09-15 08:09:15 → 08:09:22. On 09-10 13:29:47 the switch to `1964539` "failed", yet the very next process's `ping` reported `configuredTargetAccount: 1964539` and its quick scripts ran on `1964539`.
- **Same bug, other entry point:** `MCP_ACCOUNT_ROUTE_UNKNOWN` (11 occurrences) comes from `callMcpSuiteletServerTool` (`:10446-10458`) when a server-side tool is the first call to trigger dedicated-tab creation.
- **Effect:** the agent is told the switch failed. It then retries, gives up, or falls back to another account (see F7). In Claude Desktop the error also kills the MCP process (F2).

### F2 — CRITICAL · In Claude Desktop agent mode, every tool error restarts the MCP server

- **Code:** `mcp_server/magiNetsuiteMCPServer.js:3292-3300`. Any thrown tool error becomes a JSON-RPC `error` (`code: -32000`) instead of an MCP tool result with `isError: true`.
- **Evidence:** for client `local-agent-mode-magic-netsuite`, 300 of 301 processes that returned an error never logged another line. 261 were replaced by a fresh `host started` within 30 s. Processes without errors did not show this pattern (4 of 39). Codex, Claude Code and OpenCode never died after errors. Median agent-mode process life is about 60 s and most make ≤ 3 calls.
- **Effect:**
  - All per-process state is lost: `currentAccount` (used by SDF deploy, F9), skill-preflight receipts, `lastLocalSkillSearchAt`, the bridge socket, pending SDF login promises.
  - A 1–7 s window follows in which the tool is unavailable, and the full `tools/list` is re-sent.
  - A harmless validation error, such as `netsuite_inspect_custom_record_field` called with `{}`, has the same impact as a crash.
- `mcp_app` is **not** affected by this, because the MCP SDK wraps errors as `isError`. However, `mcp_app` has its own crash path (F14).

### F3 — CRITICAL · Routing target is global across all sessions, so a switch in one chat moves every other chat

- **Code:** `:9059-9064` writes `chrome.storage.sync → magic_netsuite_settings.mcpPreferredAccount`. Every tool re-reads it (`getPreferredNetsuiteTab` at `:13364-13367`, `callMcpSuiteletServerTool`, job creation, `ping`). The MCP server keeps a private `currentAccount` (`magiNetsuiteMCPServer.js:3227`) that the extension ignores.
- **Evidence:**
  - 64 preference changes were made by a different process than the previous switch.
  - Clear case, 09-17: process `10036` switched to `4027610_SB1` at 10:27. Another session switched to `1964539` at 11:01. At 12:10 process `10036`'s `ping` returned `configuredTargetAccount: 1964539`, so that session was silently talking to the wrong environment.
  - On 09-10 the agent began prefixing every quick script with `if (runtime.accountId !== '4027610_SB1') throw …`, which shows it no longer trusted routing.
- **Effect:** "it switched to the wrong one." Client-side tools (SuiteQL via tab, file cabinet, docs, logs) do **not** verify the account per call. Only server-side Suitelet tools verify it (`verifyMcpSuiteletRuntimeAccount`, 60 s cache).

### F4 — HIGH · Preference is persisted before the switch is verified

- **Code:** `:9059-9064` writes first. Verification comes at `:9076-9083`.
- **Evidence:** the synced-settings history contains `3974297` and `3974297_SB1`. Both switches failed (09-23 15:03:58, 15:04:30), yet each value stayed as the global target until the next write. On 09-17 the switch to `4027610` timed out and its tab was removed (`:6102`), but `4027610` remained the preference, so every subsequent call from any session tried to route there.
- **Effect:** a failed switch leaves all sessions pointing at an account that is unreachable or not logged in. The next calls then spend time creating dedicated tabs (F10).

### F5 — HIGH · A switch reports success on a login page

- **Code:** `:9077` compares only the URL subdomain. Nothing checks for an authenticated session.
- **Evidence:** 09-17 12:22:49 returned `"switched": true, "accountId": "4027610"`, `"url": "https://4027610.app.netsuite.com/app/login/secure/enterpriselogin.nl?..."`. The next call, `netsuite_get_logs`, failed with `You must log in before accessing this page`. There were 11 `must log in` errors and 4 `Your connection has timed out. Please log in again.` errors in total.
- **Effect:** the switch looks successful, and then every tool fails with auth errors that the agent attributes to the tool.

### F6 — HIGH · Dashboard UI silently reverts the switch (stale settings write-back)

- **Code:** `vue-ui/src/states/settingsState.ts:150-229` loads settings once (a cached `loadPromise`) and never listens to `storage.onChanged`. `:234` `watch(settings, scheduleSave, { deep: true })` writes the **whole** object, including the stale `mcpPreferredAccount`, 150 ms after any settings mutation. Mutators include `preferredFeatures` (AppHeader, HomeView, ItemListNavigation), `mcpDisabledTools`, `mcpEnabled`, and model pickers.
- **Mechanism:** a dashboard tab is open with the target at A. The agent switches to B. You toggle anything in the dashboard, and the UI writes back A. From then on, all sessions route to A with no log line, because the change came from the UI.
- **Status:** proven from code. The logs can't show it directly, because UI writes don't pass through MCP. This is the most plausible cause of a "wrong environment" that has no matching switch call.

### F7 — HIGH · Fallback to "active tab" routing = whatever tab you are looking at

- **Code:** `:9066-9073` (empty `accountId`) and `:13370-13372` (no preference) call `getActiveNetsuiteTab()` (`:13464`), which returns the active tab of the *current window*.
- **Evidence:** 09-03 15:56:08 switch to `4027610` failed ("unknown"). At 15:56:19 the agent retried with `accountId: ""`, got `routing: "active-tab"`, and `response.account=null`. 09-10 12:43:57 also shows `accountId: ""` → `No active NetSuite tab`.
- **Effect:** after a false failure (F1), the model tends to "reset" routing. From then on the environment depends on which Brave tab has focus, and it changes as you click around.

### F8 — MEDIUM · Dedicated-tab slot is single and global, so concurrent sessions get the wrong-account tab

- **Code:** `:6074-6077` + `:6113-6126` (`waitForExistingDedicatedTab`). If a creation is in progress, a second caller waits for **any** `mcpDedicatedTabId` and returns it, without checking that it belongs to the account that caller wanted.
- **Also:** `validateDedicatedTab` (`:6143-6178`) only checks that `url.includes("app.netsuite.com")`. It doesn't check that the account still matches, for example after NetSuite redirects or a role switch.
- **Effect:** two sessions switching to different accounts at the same time: one of them runs on the other's account. Only `switch_environment` itself re-checks.

### F9 — MEDIUM · SDF account can diverge from browser routing

- **Code:** `magiNetsuiteMCPServer.js:673-675` overwrites `currentAccount` from **every** bridge response. The extension's response `account` is `mcpDedicatedTabAccountId || mcpPreferredAccount` (`background.ts:9015-9018`), so the dedicated-tab account wins over the preference. `resolveSdfAccountId` (`:966`) uses `explicit || currentAccount`.
- **Effect:**
  - After F2 restarts, `currentAccount` starts at `null` and is re-learned from whatever the global preference is now, which another session may have changed. `netsuite_sdf_deploy` without an explicit `accountId` therefore follows the global target, not the account this chat switched to.
  - If a dedicated tab for A exists while the preference is B, the reported account is A. This is currently masked by the `storage.onChanged` handler clearing the dedicated tab on change (`:6274-6282`), but only after that event is dispatched.
- Logs show one instance of a response account differing from the session's own target (09-17 12:10:54, the F3 case).

### F10 — MEDIUM · Each account flip leaks a background tab and re-creates it

- **Code:** `:6274-6282` "forgets" the dedicated tab on any preference change but doesn't close it. On switching back, Step 2 scans all NetSuite tabs, sending `CHECK_CONNECTION` to each (`:13399-13415`).
- **Evidence:** alternating SB1 ↔ 1964539 created a new SB1 dedicated tab every cycle (tab IDs 479958278 → 479958282 within 12 minutes on 09-14). The old tab was no longer "connected". The likely cause is NetSuite's session/role switch in the same browser logging out the other account's tab (see F5 errors). This part is inferred.
- **Effect:** tabs accumulate. Each routing pass fans out to more tabs, and one unresponsive tab slows every call (F11). Every flip to an account that isn't already open goes through F1.

### F11 — HIGH · One unresponsive NetSuite tab can wedge all MCP calls (60 s timeouts)

- **Code:**
  - `sendMessageToTab` (`:13477`) has no timeout.
  - The content script answers `CHECK_CONNECTION` only through the page bridge (`content/core/messaging/messageListener.ts:434-449`). Its timeout is 30 s (`constants.ts:14`).
  - `getPreferredNetsuiteTab` runs `Promise.all(CHECK_CONNECTION on every NS tab)`, then possibly `createMcpDedicatedTab` (up to 15 s), then `checkTabGovernance` (up to 30 s). Server-side tools add Suitelet URL discovery and runtime verification on top.
  - The native host gives up at 60 s (`magicNetsuiteNativeHost.js:80-83`). Claude's SDK also times out at 60 s.
- **Evidence:** 09-23 15:12–15:22. After the three failed switches, 8 consecutive calls in 8 fresh processes all hit exactly 60 s, **including `ping`**, each followed by `notifications/cancelled … "SdkError: Request timed out"`. Routing was unusable for about 10 minutes, with no extension error.
- **Likely triggers:** a tab stuck on login/SSO/2FA, a page with a blocking `alert/confirm`, a discarded or frozen background tab (Brave memory saver), or a page where the page-world bridge never injected.
- **Timeout ladder is inverted:** client 60 s ≤ native host 60 s < MCP server 70 s < mcp_app 75 s. The detailed server-side timeout messages never reach the model, because the client times out first.

### F12 — MEDIUM · `switch_environment` gives no verified server identity, and some accounts silently fall back to client-side execution

- **Code:** `:10470` `if (!suiteletUrl) return null;` and `:10488` `if (payload?.unsupported) return null;` fall through to the client/tab path.
- **Evidence:** 09-23 15:05:43 `Unknown tool: netsuite_server_info` (also once earlier). In an account without the MCP Suitelet deployed, server tools quietly run client-side, and `netsuite_server_info` (the documented way to verify `runtime.accountId`) doesn't exist there.
- **Effect:** behaviour and verification guarantees differ per account without telling the agent. The switch result says `executionVerified: false` but gives no hint that server verification is impossible for that account.

### F13 — LOW · Jobs Center records the wrong environment for switches

- **Code:** `:8672-8676` captures `account` **before** the switch runs.
- **Evidence:** every Switch Environment job shows the *previous* account (for example "switch to 4027610_SB1" is recorded as `acct=1964539`). The Jobs Center therefore makes the history of switches look like the wrong environment was targeted.

---

## 4. Other intermittent issues (not switch-specific)

### F14 — HIGH · `mcp_app` process crashes whenever the pipe is unavailable
`mcp_app/server.ts:217-220`: `connecting.finally(...)` creates a second promise that nobody handles. When the connection fails (Brave closed or restarting, native host not up yet, 2.5 s timeout), Node exits with an unhandled rejection. The subagent reproduced this on Node v24. Any call made in that window kills `magic-netsuite-apps`, and the client shows the server as disconnected. There is no `unhandledRejection` guard in `mcp_app`.

### F15 — HIGH · Native bridge never auto-reconnects
`background.ts:5930-5967`: `port.onDisconnect` only nulls the port. Reconnects happen only at service-worker startup or from the MCP Server page. If the native host exits for any reason, including a Chrome-side 1 MB message limit breach (large FreeMarker/HTML/screenshot payloads via `mcp_app`, per the subagent) or `IPC server error` → `shutdown(1)` (`magicNetsuiteNativeHost.js:304-306`), every MCP process gets `Chrome native bridge is not connected` until you reload the extension or open the MCP page. The log shows 5 `native bridge disconnected` events at about 16:00 on different days. These are probably end-of-day browser closes, but nothing recovers from a mid-day drop.

### F16 — MEDIUM · Only one browser/profile can own the pipe
The pipe name is fixed. A second Brave profile, or Chrome with the same extension, launches a second native host that fails `listen` and exits (`:304-306`). MCP then talks to whichever browser started first, which may be logged into a different NetSuite account.

### F17 — MEDIUM · Content-script 30 s timeout returns `{status:"retry"}`, which is treated as success
`content/core/messaging/handlers.ts:114-145`: `NormalRequestHandler` is always created with `retryAttempts = 0`, so after 30 s it always sends `{status:"retry"}` and never an error. The background never handles `"retry"`:
- `getRouteResult` (`background.ts:10113-10123`) returns the retry object as the tool result.
- The SuiteQL handler treats it as success with `message` undefined → **`rowCount: 0`, empty results**.

This is latent: no occurrence in the logs, because most heavy tools go server-side. It will surface on any slow client-side query or mutation over 30 s, as an empty result or a meaningless "success". A mutation may still complete afterwards, and an agent retry could double-apply it.

### F18 — MEDIUM · Playwright suitelet control is account-blind and profile-locked (from subagent, spot-checked)
- The Playwright page keeps the last account's page after a switch (`playwright-controller.ts:155-177`). `BridgeResponse.account` is never read by `mcp_app` (`server.ts:47`).
- One persistent profile `~/.magic-netsuite/pw-profile` is shared by all processes (`:111-115`). A second launch hands off to the existing browser and throws. An orphaned node process (no stdin-close handling, `mcp_app/main.ts:105`) keeps the lock.
- `magic-ns-storage-state.json` is shared across accounts and written non-atomically. `addCookies` is all-or-nothing with errors swallowed (`:126-135`), so a single invalid cookie leads to a login page.
- There is no `crash` handler on the page (`:137-141`), so a crashed page is reused until you close it by hand.

### F19 — LOW · Other latent protocol gaps
- `handleMcp` doesn't respond to unknown request methods (`magiNetsuiteMCPServer.js:3286-3287` `else return;`), such as a protocol-level `ping` or `logging/setLevel`. A client that sends keepalive pings would eventually time out the server.
- The `mcp_app` tool results put data only in `structuredContent` with a generic text line (`server.ts:598-603`). Clients that forward only `content` hide the data from the model.
- `chrome.storage.sync` is the store for routing. Brave Sync or Chrome Sync may propagate `mcpPreferredAccount` between machines. Write quota (120/min) and the 8 KB per-item limit are fine today (the item is 882 B), but `mcpDisabledTools` grows it.

---

## 5. Reconstructed failure scenarios

**A — "Switch fails, then works" (most common, F1 + F2 + F4)**
1. Agent: `switch_environment(4027610_SB1)`. No SB1 tab is connected, so the extension opens a dedicated tab, and the preference is already written.
2. The stale `tab.url` is `""`, so the switch throws "belongs to unknown". The MCP server returns a JSON-RPC error.
3. Claude Desktop kills the MCP process. `currentAccount` and receipts are lost.
4. The new process retries and gets `dedicated-tab` routing: success. Net cost: one false failure, one restart, and sometimes a model detour (F7).

**B — "It switched to the wrong one" (F3 / F6 / F8)**
1. Session 1 works on SB1. Session 2 (another chat, a job, Codex) switches to 1964539, or the dashboard writes back a stale value.
2. Session 1's next SuiteQL or file call silently runs on 1964539. Nothing warns, because client-side tools don't re-verify the account.

**C — "Everything hangs" (F4 + F10 + F11)**
1. A switch to an account that isn't logged in fails but is persisted.
2. Every call from every session tries that account: tab scan → dedicated tab → login page / unresponsive tab → 30 s content timeouts stacked → 60 s client timeout, even for `ping`.
3. This continues until someone switches to a reachable account or closes the offending tab.

---

## 6. Fix directions (for later — nothing changed)

Ordered by impact vs effort:

1. **F1:** after `waitForTabComplete`, re-read the tab with `chrome.tabs.get(tab.id)` and resolve that (or compare against `pendingUrl`). This single line removes ~24% switch failures.
2. **F2:** return tool failures as `{ content:[{type:"text",text}], isError:true }` in `handleMcp`, and keep JSON-RPC errors for protocol faults only.
3. **F3 / F9:** make routing per-session. Send the session's `targetAccount` with every bridge request (the MCP server already tracks `currentAccount`), and have the extension route by the request's account instead of the global preference. Keep the global value only as a UI default.
4. **F4 / F5:** verify before persisting. Require a connected, logged-in tab (content script `CHECK_CONNECTION` + not `/login/`), then write the preference. Roll back on failure.
5. **F6:** in `settingsState.ts`, subscribe to `storage.onChanged` and patch only changed keys on save, or move `mcpPreferredAccount` out of the UI-saved object.
6. **F11:** add a per-message timeout (for example 5 s for `CHECK_CONNECTION`/`CHECK_GOVERNANCE`) to `sendMessageToTab`, skip discarded tabs, and make the timeout ladder client > server > host > extension-internal.
7. **F14 / F15:** add `.catch(()=>{})` on the `finally` chain in `mcp_app`, auto-reconnect `connectNative` with backoff, and guard native-message size.
8. **F17:** implement the `retry` status in the background, or send `status:"error"` on timeout.
9. **F8 / F10:** key dedicated tabs per account (a `Map<account, tabId>`), validate the account in `validateDedicatedTab`, and close or reuse old tabs.
10. **F13:** record the requested account for switch jobs.

---

## 6b. Fix status (2026-09-24)

| Finding | Status | Change |
|---|---|---|
| F1 | Fixed | `createMcpDedicatedTab` re-reads the tab after load (`getTabNavigationUrl` falls back to `pendingUrl`) and rejects a tab that landed on another host with `MCP_ACCOUNT_LOGIN_REQUIRED` |
| F2 | Fixed | `handleMcp` returns tool failures as `{ content, isError: true }`; JSON-RPC errors only for non-tool methods |
| F3 | Fixed | MCP server keeps `sessionTargetAccount` (set by its own switch) and sends `expectedAccount` with every call; the native host forwards it; the extension routes each call by it under an account lock (same account concurrent, different account waits ≤ 20 s, then `MCP_ROUTING_BUSY` without executing) |
| F4 | Fixed | Preference persisted only after tab account + login are verified |
| F5 | Fixed | Switch requires a connected (logged-in) content script and a non-login URL |
| F6 | Fixed | `settingsState.ts` listens to `storage.onChanged` and saves only locally changed keys merged onto current storage |
| F7 | Mitigated | Empty-account switch result now warns that active-tab routing follows focus |
| F8 / F10 | Fixed | Dedicated tabs tracked per account (`Map`); creation de-duplicated per account; validation checks account + connection; discarded tabs reloaded; tabs no longer forgotten/leaked on switch |
| F9 | Fixed | Response `account` = the account the call was routed to; SDF uses `sessionTargetAccount` first |
| F11 | Fixed | 5 s probe timeout on `CHECK_CONNECTION`/`CHECK_GOVERNANCE`; only tabs of the target account are probed; discarded tabs skipped; timeout ladder host 55 s < server 57 s < client 60 s |
| F12 | Fixed | `netsuite_server_info` without a Suitelet returns `MCP_SUITELET_UNAVAILABLE` instead of `Unknown tool` |
| F13 | Fixed | Job account = the account the call targets (requested account for switches) |
| F14 | Fixed | `mcp_app` connect uses `then(clear, clear)`; `unhandledRejection` logged instead of exiting; per-socket pending/buffer |
| F15 | Fixed | Native port auto-reconnects with backoff (1 s → 60 s) unless manually disconnected |
| F16 | Open | Single pipe owner per machine is a design choice; needs per-profile pipe names |
| F17 | Fixed | Content-script timeout sends `status:"error"` with a clear message |
| F18 | Partly fixed | Crashed pages are dropped and replaced; launch retries on profile lock with actionable error; `mcp_app` exits when stdin closes. Still open: Playwright page is not account-aware; shared storage-state file |
| F19 | Partly fixed | `ping` answered, unknown requests get `-32601`. `structuredContent`-only results left as is |

Deployment note: the running copies in `C:\Projects\MagicNetsuiteExtensionM` (exe + mcpApps) must be rebuilt/redeployed, and the extension reloaded in Brave, for these fixes to take effect.

---

## 7. Confidence & gaps

| Finding | Confidence | Basis |
|---|---|---|
| F1, F4, F5, F13 | Confirmed | Code + logs + Jobs Center + sync history |
| F2 | Very high (correlation 300/301; causation inferred) | Logs. Claude Desktop MCP logs stop at 2026-08-24, so the client-side restart reason couldn't be read directly |
| F3 | Confirmed | Code + 09-17 cross-session trace |
| F6, F8, F9, F17 | Confirmed in code, not observed in logs | UI writes and in-extension races are not logged |
| F10, F11 root trigger | Probable | Timings are consistent. The exact unresponsive tab on 09-23 can't be identified from the logs |
| F14–F16, F18 | Code-level (F14 reproduced by subagent) | No `mcp_app` log file exists |

**Logging gap worth closing:** the extension doesn't log routing decisions (selected tab, account, why a dedicated tab was created, UI-originated preference writes). Adding one structured line per routing decision to the Jobs Center would make every scenario above diagnosable without log archaeology.
