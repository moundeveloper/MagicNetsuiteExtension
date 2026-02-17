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
    goto :error
)

:: =========================
:: STEP 2.5 - Git Init
:: =========================
echo.
echo ====================================
echo Step 2.5: Initialising git repo
echo ====================================
cd /d "%DEST_FOLDER%"

git init -b main
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: git init failed!
    goto :error
)

git remote add origin git@github-account-personal:moundeveloper/MagicNetsuiteExtensionM.git
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: git remote add origin failed!
    goto :error
)

echo Git repo initialised and remote set.

:: =========================
:: STEP 3
:: =========================
echo.
echo ====================================
echo Step 3: Copying files to production
echo ====================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0moveToProd.ps1" ^
    -SourceFolder "C:\Projects\MagicNetsuiteExtension\src" ^
    -DestinationFolder "C:\Projects\MagicNetsuiteExtensionM" ^
    -Ignore "scripts_testing.js","query.sql","sandboxCodeCopy.js"
if %ERRORLEVEL% NEQ 0 goto :error

:: =========================
:: STEP 4
:: =========================
echo.
echo ====================================
echo Step 4: Committing and pushing to GitHub
echo ====================================
cd /d "%DEST_FOLDER%"

git add .
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: git add failed!
    goto :error
)

git commit -m "Production sync"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: git commit failed!
    goto :error
)

git push -u origin main --force
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: git push failed!
    goto :error
)

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