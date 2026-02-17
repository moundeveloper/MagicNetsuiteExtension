@echo off

echo ====================================
echo Step 1: Building project
echo ====================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build failed!
    exit /b 1
)

echo.
echo ====================================
echo Step 2: Cleaning destination folder
echo ====================================

set "DEST_FOLDER=C:\Projects\MagicNetsuiteExtensionM"

if exist "%DEST_FOLDER%" (
    echo Deleting all files in %DEST_FOLDER% ...
    rmdir /s /q "%DEST_FOLDER%"
)

mkdir "%DEST_FOLDER%"

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to clean destination folder!
    exit /b 1
)

echo.
echo ====================================
echo Step 3: Copying files to production
echo ====================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0moveToProd.ps1" -SourceFolder "C:\Projects\MagicNetsuiteExtension\src" -DestinationFolder "%DEST_FOLDER%" -Ignore "scripts_testing.js","query.sql","sandboxCodeCopy.js"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: File copy failed!
    exit /b 1
)

echo.
echo ====================================
echo Step 4: Updating watch.json for auto-reloader
echo ====================================

set "RELOADER_FOLDER=C:\Projects\AutoReloadExtension"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$timestamp = [int][double]::Parse((Get-Date -UFormat %%s)); $json = @{ timestamp = $timestamp } | ConvertTo-Json; New-Item -Path '%RELOADER_FOLDER%' -ItemType Directory -Force | Out-Null; Set-Content -Path '%RELOADER_FOLDER%\watch.json' -Value $json -Encoding UTF8"

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to update watch.json
    exit /b 1
)

echo.
echo ====================================
echo All operations completed successfully!
echo ====================================
