param(
  [string]$ServerExe = (Join-Path $PSScriptRoot "magiNetsuiteMCPServer.exe")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ServerExe)) {
  throw "Magic NetSuite MCP server executable not found: $ServerExe"
}

$resolvedServerExe = (Resolve-Path -LiteralPath $ServerExe).Path
$claudeDir = Join-Path $env:APPDATA "Claude"
$configPath = Join-Path $claudeDir "claude_desktop_config.json"
$serverName = "magic-netsuite"

New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null

if (Test-Path -LiteralPath $configPath) {
  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  Copy-Item -LiteralPath $configPath -Destination "$configPath.bak-$timestamp" -Force
  $raw = Get-Content -LiteralPath $configPath -Raw
  $config = if ([string]::IsNullOrWhiteSpace($raw)) { [pscustomobject]@{} } else { $raw | ConvertFrom-Json }
} else {
  $config = [pscustomobject]@{}
}

if (-not $config.mcpServers -or $config.mcpServers -isnot [pscustomobject]) {
  if ($config.PSObject.Properties["mcpServers"]) {
    $config.PSObject.Properties.Remove("mcpServers")
  }
  $config | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue ([pscustomobject]@{})
}

if ($config.mcpServers.PSObject.Properties[$serverName]) {
  $config.mcpServers.PSObject.Properties.Remove($serverName)
}

$config.mcpServers | Add-Member -NotePropertyName $serverName -NotePropertyValue ([pscustomobject][ordered]@{
  command = $resolvedServerExe
  args = @()
  env = [pscustomobject][ordered]@{
    MAGIC_NETSUITE_MCP_PIPE = "magic_netsuite_mcp_bridge"
  }
})

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$json = $config | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($configPath, $json + "`n", $utf8NoBom)

Write-Host "Magic NetSuite MCP server installed for Claude Desktop."
Write-Host "Config: $configPath"
Write-Host "Command: $resolvedServerExe"
Write-Host "Restart Claude Desktop to load the production MCP server."
