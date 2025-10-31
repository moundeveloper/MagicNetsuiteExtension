# build-and-zip.ps1

# Clear console
Clear-Host

# === CONFIGURATION ===
$vueFolder = "vue-ui"         # Folder containing the Vue project

# === 1. Build Vue Project ===
$vuePath = Resolve-Path $vueFolder -ErrorAction SilentlyContinue
if (-not $vuePath) {
    Write-Host "❌ Folder not found: $vueFolder"
    exit 1
}

Write-Host "=== Running npm build in $vueFolder ===`n"

# Save current location
$rootPath = Get-Location

# Navigate to vue-ui folder
Set-Location $vuePath

# Run npm build
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ npm build failed!"
    exit $LASTEXITCODE
}

# Back to root folder
Set-Location $rootPath






