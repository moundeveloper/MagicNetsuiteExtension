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
echo Step 2: Copying files to production
echo ====================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0moveToProd.ps1" -SourceFolder "C:\Projects\MagicNetsuiteExtension\src" -DestinationFolder "C:\Projects\MagicNetsuiteExtensionM" -Ignore "scripts_testing.js","query.sql","sandboxCodeCopy.js"

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: File copy failed!
    exit /b 1
)

echo.
echo ====================================
echo Step 3: Committing and pushing to GitHub
echo ====================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0commitAndPush.ps1" -RepoPath "C:\Projects\MagicNetsuiteExtensionM" -CommitMessage "Production sync"

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Git operations failed!
    exit /b 1
)

echo.
echo ====================================
echo All operations completed successfully!
echo ====================================