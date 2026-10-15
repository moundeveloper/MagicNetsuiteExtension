# Custom tool browser bridge

Choose `domain: "client"` for browser workflows. Custom tools execute inside the authenticated NetSuite page; `context.browser` sends fixed operations through the content script to the extension worker. Tool code is never evaluated in the extension worker. Server execution has no browser helper.

The same contract is included in the AI create/update tool schemas (in both the built-in agent and MCP server) and the Custom Tools implementation guide. The shared source is `mcp_server/customToolBrowserGuide.json`.

```js
const tab = await context.browser.openTab({ url: input.url });
await context.browser.waitForSelector(tab.id, ".results", { timeoutMs: 15000 });
return await context.browser.extract(tab.id, { selector: ".results", format: "text" });
```

| Method | Behavior |
| --- | --- |
| `openTab({url, active?, keepOpen?})` | Opens an HTTP(S) page. Defaults to a background, temporary tab. Returns `{id,url,title}`. |
| `openView({route, active?, keepOpen?})` | Opens a registered static extension route such as `/scripts`, `/custom-tools`, or `/dashboards`. Use `active: true, keepOpen: true` to show it to the user. |
| `getTab(tabId)` | Returns `{id,url,title}`. |
| `navigate(tabId, url)` | Navigates an owned tab to an HTTP(S) URL. |
| `waitForSelector(tabId, selector, {timeoutMs?})` | Waits for page load, then for the selector. Returns `{found:true}`. |
| `extract(tabId, {selector?, format?, maxChars?, timeoutMs?})` | Returns `{url,title,content}`. Formats: `text` (default), `html`, or `links` (array of `{text,url}`). Defaults: body, 50,000 characters, 10 seconds. |
| `click(tabId, selector)` | Clicks an element. Requires `risk: "write"`. |
| `fill(tabId, selector, value)` | Sets an input/textarea value and dispatches input/change events. Requires `risk: "write"`. |
| `closeTab(tabId)` | Closes an owned tab, including one marked keepOpen. |

Await calls sequentially. Only tabs created by the current execution are accessible. There is no raw Chrome API object or arbitrary JavaScript evaluator. Extraction and interactions use the top frame of HTTP(S) pages, subject to the extension's actual site access; extension views and Chrome protected pages cannot be processed with these methods. Closed shadow roots and cross-origin frames are outside this API. Click uses DOM click, not a trusted physical input event.

Temporary tabs are closed when the tool finishes or fails. `keepOpen: true` preserves a tab for the user. Session ownership is stored in `chrome.storage.session` to survive worker suspension; an alarm expires abandoned sessions after ten minutes. Closing the originating NetSuite tab also disposes its sessions. Limit: ten owned tabs per execution, 30 seconds for page load, 30 seconds for selector waits, 200,000 characters or 500 links per extraction.

Browser-only tools can use `modules: []`. Supply a concrete `testInput`, test in the client domain after creating or updating the tool, report the output or error, and leave activation to the user. Tools which use NetSuite modules can combine them with the browser helper in the same client function body.

Reload the extension after building. Restart the MCP server to refresh create/update tool schemas.
