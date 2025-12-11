# moveToProd.ps1
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceFolder,

    [Parameter(Mandatory = $true)]
    [string]$DestinationFolder,

    [Parameter(Mandatory = $false)]
    [string[]]$Ignore = @()
)

# Make sure destination exists
if (!(Test-Path $DestinationFolder)) {
    New-Item -ItemType Directory -Path $DestinationFolder | Out-Null
}

# Convert Ignore to a proper array and trim whitespace
$IgnoreList = $Ignore | ForEach-Object { $_.Trim() }

Write-Host "Excluding files: $($IgnoreList -join ', ')"

# Function to copy directory structure while filtering files
function Copy-FilteredDirectory {
    param(
        [string]$Source,
        [string]$Destination,
        [string[]]$ExcludeFiles
    )
    
    # Create destination directory if it doesn't exist
    if (!(Test-Path $Destination)) {
        New-Item -ItemType Directory -Path $Destination | Out-Null
    }
    
    # Copy files (excluding ignored ones)
    Get-ChildItem -Path $Source -File | ForEach-Object {
        $shouldCopy = $true
        foreach ($excludeFile in $ExcludeFiles) {
            if ($_.Name -eq $excludeFile) {
                Write-Host "Skipping: $($_.FullName)" -ForegroundColor Yellow
                $shouldCopy = $false
                break
            }
        }
        if ($shouldCopy) {
            Copy-Item -Path $_.FullName -Destination $Destination -Force
        }
    }
    
    # Recursively copy subdirectories
    Get-ChildItem -Path $Source -Directory | ForEach-Object {
        $destPath = Join-Path $Destination $_.Name
        Copy-FilteredDirectory -Source $_.FullName -Destination $destPath -ExcludeFiles $ExcludeFiles
    }
}

# Start the recursive copy
Copy-FilteredDirectory -Source $SourceFolder -Destination $DestinationFolder -ExcludeFiles $IgnoreList

Write-Host "Copy complete from '$SourceFolder' to '$DestinationFolder'" -ForegroundColor Green