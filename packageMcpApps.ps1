param(
    [Parameter(Mandatory = $true)]
    [string]$DestinationFolder
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$McpAppRoot = Join-Path $Root "mcp_app"
$McpAppsDest = Join-Path $DestinationFolder "mcpApps"
$RuntimeDest = Join-Path $McpAppsDest "runtime"
$NodeSource = (Get-Command node -ErrorAction Stop).Source
$PnpmSource = (Get-Command pnpm -ErrorAction Stop).Source

function Copy-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Source,
        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    & robocopy $Source $Destination /E /R:2 /W:1 /NFL /NDL /NP | Out-Host
    if ($LASTEXITCODE -gt 7) {
        throw "robocopy failed copying $Source to $Destination with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path (Join-Path $McpAppRoot "dist\main.js"))) {
    throw "mcp_app has not been built. Expected dist\main.js."
}

if (Test-Path $McpAppsDest) {
    Remove-Item -LiteralPath $McpAppsDest -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $McpAppsDest | Out-Null
New-Item -ItemType Directory -Force -Path $RuntimeDest | Out-Null

Copy-Directory -Source (Join-Path $McpAppRoot "dist") -Destination (Join-Path $McpAppsDest "dist")
Copy-Item -LiteralPath (Join-Path $McpAppRoot "package.json") -Destination (Join-Path $McpAppsDest "package.json") -Force
Copy-Item -LiteralPath (Join-Path $McpAppRoot "pnpm-lock.yaml") -Destination (Join-Path $McpAppsDest "pnpm-lock.yaml") -Force
Copy-Item -LiteralPath (Join-Path $McpAppRoot "installClaudeMcpApps.ps1") -Destination (Join-Path $McpAppsDest "installClaudeMcpApps.ps1") -Force
Copy-Item -LiteralPath $NodeSource -Destination (Join-Path $RuntimeDest "node.exe") -Force

Push-Location $McpAppsDest
try {
    & $PnpmSource install --prod --frozen-lockfile --config.node-linker=hoisted --ignore-scripts
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm install failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

@" 
# Magic NetSuite MCP Apps

This folder contains the Magic NetSuite MCP Apps host for Claude Desktop.

It exposes:
- Magic NetSuite Context Picker
- Magic NetSuite Suitelet Viewer

## Install for Claude Desktop

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\installClaudeMcpApps.ps1
```

Then restart Claude Desktop.

The installer writes this server to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
"magic-netsuite-apps": {
  "command": "<this-folder>\\runtime\\node.exe",
  "args": ["<this-folder>\\dist\\main.js", "--stdio"],
  "env": {
    "MAGIC_NETSUITE_MCP_PIPE": "magic_netsuite_mcp_bridge",
    "MAGIC_NS_PLAYWRIGHT": "1"
  }
}
```

The bundled Node runtime is used, so the user does not need Node installed.
Playwright mode is enabled by default. Pass `-DisablePlaywright` only if you
need to force the legacy external-browser fallback.

The Magic NetSuite Chrome extension MCP bridge must also be installed and enabled.
"@ | Set-Content -LiteralPath (Join-Path $McpAppsDest "README.md") -Encoding UTF8

@"
param(
    [switch]`$UsePlaywright,
    [switch]`$DisablePlaywright
)

`$ScriptRoot = Split-Path -Parent `$MyInvocation.MyCommand.Path
`$Installer = Join-Path `$ScriptRoot "mcpApps\installClaudeMcpApps.ps1"

if (-not (Test-Path `$Installer)) {
    throw "Could not find MCP Apps installer at `$Installer"
}

& powershell -NoProfile -ExecutionPolicy Bypass -File `$Installer @PSBoundParameters
exit `$LASTEXITCODE
"@ | Set-Content -LiteralPath (Join-Path $DestinationFolder "installClaudeMcpApps.ps1") -Encoding UTF8

Write-Host "MCP Apps packaged to $McpAppsDest"
