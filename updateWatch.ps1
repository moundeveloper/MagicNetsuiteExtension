param(
    [string]$ReloaderFolder
)

$timestamp = [int][double]::Parse((Get-Date -UFormat %s))
$json = @{ timestamp = $timestamp } | ConvertTo-Json

# Ensure directory exists
New-Item -Path $ReloaderFolder -ItemType Directory -Force | Out-Null

# Write watch.json
Set-Content -Path "$ReloaderFolder\watch.json" -Value $json -Encoding UTF8

Write-Host "watch.json updated with timestamp: $timestamp"