# commitAndPush.ps1
param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [Parameter(Mandatory = $false)]
    [string]$CommitMessage = "Update from production sync"
)

# Change to repo directory
Set-Location $RepoPath

# Check if git repo exists
if (!(Test-Path ".git")) {
    Write-Host "ERROR: Not a git repository. Initialize with 'git init' first." -ForegroundColor Red
    exit 1
}

# Stage all changes
Write-Host "Staging all changes..." -ForegroundColor Cyan
git add -A

# Check if there are changes to commit
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Host "No changes to commit." -ForegroundColor Yellow
    exit 0
}

# Commit changes
Write-Host "Committing changes..." -ForegroundColor Cyan
git commit -m $CommitMessage

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Commit failed." -ForegroundColor Red
    exit 1
}

# Push to remote
Write-Host "Pushing to remote..." -ForegroundColor Cyan
git push

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Push failed. You may need to set upstream branch with 'git push -u origin main'" -ForegroundColor Red
    exit 1
}

Write-Host "Successfully committed and pushed changes!" -ForegroundColor Green