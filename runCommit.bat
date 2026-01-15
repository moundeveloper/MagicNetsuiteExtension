@echo off
setlocal ENABLEDELAYEDEXPANSION

set ENV_FILE=C:\Projects\MagicNetsuiteExtension\vue-ui\.env.production

echo ====================================
echo Switching VITE_PRIVILEGE_LEVEL to USER
echo ====================================

:: Store original value
for /f "tokens=2 delims==" %%A in ('findstr /R "^VITE_PRIVILEGE_LEVEL=" "%ENV_FILE%"') do (
    set ORIGINAL_PRIVILEGE=%%A
)

powershell -NoProfile -ExecutionPolicy Bypass ^
    -Command "(Get-Content '%ENV_FILE%') -replace 'VITE_PRIVILEGE_LEVEL=.*', 'VITE_PRIVILEGE_LEVEL=USER' | Set-Content '%ENV_FILE%'"

:: =========================
:: STEP 1
:: =========================
echo ====================================
echo Step 1: Building project
echo ====================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1"
if %ERRORLEVEL% NEQ 0 goto :error

:: =========================
:: STEP 2
:: =========================
echo.
echo ====================================
echo Step 2: Copying files to production
echo ====================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0moveToProd.ps1" ^
    -SourceFolder "C:\Projects\MagicNetsuiteExtension\src" ^
    -DestinationFolder "C:\Projects\MagicNetsuiteExtensionM" ^
    -Ignore "scripts_testing.js","query.sql","sandboxCodeCopy.js"
if %ERRORLEVEL% NEQ 0 goto :error

:: =========================
:: STEP 3
:: =========================
echo.
echo ====================================
echo Step 3: Committing and pushing to GitHub
echo ====================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0commitAndPush.ps1" ^
    -RepoPath "C:\Projects\MagicNetsuiteExtensionM" ^
    -CommitMessage "Production sync"
if %ERRORLEVEL% NEQ 0 goto :error

goto :cleanup

:error
echo.
echo ERROR: Script failed!

:cleanup
echo.
echo ====================================
echo Restoring VITE_PRIVILEGE_LEVEL=%ORIGINAL_PRIVILEGE%
echo ====================================

powershell -NoProfile -ExecutionPolicy Bypass ^
    -Command "(Get-Content '%ENV_FILE%') -replace 'VITE_PRIVILEGE_LEVEL=.*', 'VITE_PRIVILEGE_LEVEL=%ORIGINAL_PRIVILEGE%' | Set-Content '%ENV_FILE%'"

if "%ERRORLEVEL%"=="0" (
    echo All operations completed successfully!
)

endlocal
exit /b
