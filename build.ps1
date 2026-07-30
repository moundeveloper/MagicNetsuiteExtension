# build-and-zip.ps1

# Clear console
Clear-Host

# === CONFIGURATION ===
$vueFolder = "vue-ui"         # Folder containing the Vue project

# === 1. Build Vue UI and extension TypeScript ===
$vuePath = Resolve-Path $vueFolder -ErrorAction SilentlyContinue
if (-not $vuePath) {
    Write-Host "❌ Folder not found: $vueFolder"
    exit 1
}

Write-Host "=== Building Vue UI and extension scripts from $vueFolder ===`n"

# Save current location
$rootPath = Get-Location

# Navigate to vue-ui folder
Set-Location $vuePath

# Run the package manager pinned by vue-ui/package.json.
pnpm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ pnpm build failed!"
    exit $LASTEXITCODE
}

# Back to root folder
Set-Location $rootPath






