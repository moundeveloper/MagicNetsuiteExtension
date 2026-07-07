param(
    [Parameter(Mandatory = $true)]
    [string]$DestinationFolder
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$SdfToolRoot = Join-Path $Root "sdf_tool"
$SdfDest = Join-Path $DestinationFolder "sdfDeploy"
$RuntimeDest = Join-Path $SdfDest "runtime"
$NodeSource = (Get-Command node -ErrorAction Stop).Source
$PnpmSource = (Get-Command pnpm -ErrorAction Stop).Source

if (-not (Test-Path (Join-Path $SdfToolRoot "sdfDeploy.exe"))) {
    throw "sdf_tool has not been built. Expected sdf_tool\sdfDeploy.exe (run pkg build first)."
}

if (Test-Path $SdfDest) {
    Remove-Item -LiteralPath $SdfDest -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $SdfDest | Out-Null
New-Item -ItemType Directory -Force -Path $RuntimeDest | Out-Null

# The exe runs standalone (pkg), but spawns runtime\node.exe to execute the
# bundled SuiteCloud CLI, which in turn needs a JDK on the target machine.
Copy-Item -LiteralPath (Join-Path $SdfToolRoot "sdfDeploy.exe") -Destination (Join-Path $SdfDest "sdfDeploy.exe") -Force
Copy-Item -LiteralPath (Join-Path $SdfToolRoot "package.json") -Destination (Join-Path $SdfDest "package.json") -Force
Copy-Item -LiteralPath (Join-Path $SdfToolRoot "pnpm-lock.yaml") -Destination (Join-Path $SdfDest "pnpm-lock.yaml") -Force
Copy-Item -LiteralPath $NodeSource -Destination (Join-Path $RuntimeDest "node.exe") -Force

Push-Location $SdfDest
try {
    & $PnpmSource install --prod --frozen-lockfile --config.node-linker=hoisted --ignore-scripts
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm install failed with exit code $LASTEXITCODE"
    }
} finally {
    Pop-Location
}

@"
# Magic NetSuite SDF Deploy Tool

Companion exe that creates NetSuite script records + deployments from a JSON
spec through the SuiteCloud CLI (SDF). Invoked automatically by the Magic
NetSuite MCP server for the ``netsuite_create_script_record`` tool.

- The reusable SDF project self-scaffolds in ``sdf-project/`` beside this exe.
- Account -> SuiteCloud authid mapping is cached in ``accounts.json``. Unknown
  accounts trigger an interactive ``suitecloud account:setup`` browser login.
- Requires a JDK (17+) on PATH — the SuiteCloud CLI SDK is a Java jar.
- The SuiteCloud SDK jar is downloaded to ``%USERPROFILE%\.suitecloud-sdk`` on
  first use if missing.

Manual usage:
``sdfDeploy.exe deploy <spec.json|->`` | ``cleanup <scriptId> [--inactivate]`` | ``list`` | ``resolve-account <accountId>``
"@ | Set-Content -LiteralPath (Join-Path $SdfDest "README.md") -Encoding UTF8

Write-Host "SDF deploy tool packaged to $SdfDest"
