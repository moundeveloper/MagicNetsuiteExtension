# Magic NetSuite Extension

Magic NetSuite is a Chrome side-panel workbench for NetSuite development and
administration. It combines SuiteScript, SuiteQL, records, logs, File Cabinet,
Advanced PDF templates, SDF workflows, local/native tooling, and optional AI
providers.

## Repository map

| Path | Purpose |
| --- | --- |
| `extension-src/` | TypeScript sources for the extension background, content, and page-world scripts |
| `src/` | Built Chrome extension, static assets, manifest, and built UI |
| `vue-ui/` | Vue side-panel application |
| `mcp_app/` | MCP HTTP/stdio server and interactive MCP apps |
| `mcp_server/` | Native messaging/MCP companion |
| `sdf_tool/` | SDF deployment companion |
| `docs/` | Supporting schemas and operational documentation |

The prioritized engineering and product review is in
[`PROJECT_AUDIT.md`](PROJECT_AUDIT.md).

## Prerequisites

- Node.js 22
- pnpm 11.8
- npm for `mcp_server`, whose package currently uses `package-lock.json`
- Chrome or Chromium for extension testing

## Validate the project

### Vue UI

```powershell
Set-Location vue-ui
pnpm install --frozen-lockfile
pnpm run check
pnpm test
pnpm run build
pnpm run check:bundle
pnpm audit --prod
```

The production build is written to `src/dist/vue-ui`. Feature views are loaded
on demand. The startup bundle gate currently allows at most 400 KiB raw and
100 KiB gzip.

The same commands type-check, test, bundle, and minify the scripts in
`extension-src`. Their stable production filenames are written into `src`
without source maps so the manifest and runtime injection paths do not change.

To generate an interactive bundle report:

```powershell
pnpm run report
```

This creates `vue-ui/stats.html`, which is intentionally ignored by Git.

### MCP app

```powershell
Set-Location mcp_app
pnpm install --frozen-lockfile
pnpm test
pnpm run check
pnpm run build
pnpm audit --prod
```

### Native companion syntax

```powershell
Set-Location mcp_server
npm ci
npm run check
```

CI repeats these checks and rejects native user-facing `<select>`/`<option>`
controls; use `MSelect` for single-choice dropdowns.

## MCP HTTP security

The MCP HTTP server binds to `127.0.0.1` by default. Relevant environment
variables:

| Variable | Meaning |
| --- | --- |
| `PORT` | HTTP port; defaults to `3001` |
| `MAGIC_NS_MCP_HOST` | Bind host; non-loopback hosts require a token |
| `MAGIC_NS_MCP_TOKEN` | Bearer token required by `/mcp` |
| `MAGIC_NS_MCP_ALLOWED_ORIGINS` | Comma-separated browser Origin allowlist |

Example:

```powershell
$env:MAGIC_NS_MCP_TOKEN = "<generate-a-long-random-token>"
$env:MAGIC_NS_MCP_ALLOWED_ORIGINS = "http://127.0.0.1:5173"
pnpm run serve
```

Do not expose a browser session or MCP endpoint to an untrusted network.

## Durable jobs

Long-running features can register work through `vue-ui/src/utils/jobsDb.ts`.
Create one job when work begins and update the same ID as the producer observes
progress:

```ts
const job = await createJob({
  title: "Convert bundle to SDF",
  kind: "bundle-sdf-conversion",
  environment: accountDomain,
  account: accountId,
  sourcePath: route.fullPath
});

await updateJob(job.id, {
  status: "running",
  progress: 25,
  startedAt: Date.now()
});
```

The Jobs Center persists history in IndexedDB. Retry and cancel states are
requests only; the originating producer must acknowledge them before claiming
that work restarted or stopped.

NetSuite documentation research has a separate MCP-facing batch queue. Agents
can submit multiple topics, continue other work, and retrieve results later by
job ID without holding the authenticated browser worker. See
[`docs/netsuite-docs-batch-search.md`](docs/netsuite-docs-batch-search.md).

## Packaging

`build.ps1` performs the safe UI build. `run.bat` goes further: it builds native
tools, writes configuration, replaces the configured production folder,
packages artifacts, and installs native integrations. Review its paths and
extension ID before running it.

## Data and privacy

Remote AI providers and feedback are optional. AI credentials are stored in
`chrome.storage.local`, not Chrome Sync. See
[`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) for data recipients, storage,
retention, permissions, and deletion guidance.
