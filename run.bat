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
echo Step 1.5: Building MCP Server
echo ====================================

echo Writing host.config.json (shouldLog=true, nativeBridgePipeName=magic_netsuite_mcp_bridge)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "@{shouldLog=$true; nativeBridgePipeName='magic_netsuite_mcp_bridge'} | ConvertTo-Json | Set-Content '%~dp0mcp_server\host.config.json' -Encoding UTF8"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to write host.config.json!
    exit /b 1
)

if not exist "%~dp0mcp_server\build.bat" (
    echo ERROR: MCP Server build script not found at "%~dp0mcp_server\build.bat"
    exit /b 1
)

pushd "%~dp0mcp_server"
call "%~dp0mcp_server\build.bat"
set "MCP_BUILD_ERROR=%ERRORLEVEL%"
popd
if %MCP_BUILD_ERROR% NEQ 0 (
    echo ERROR: MCP Server build failed!
    exit /b 1
)
cd /d "%~dp0"

echo.
echo ====================================
echo Step 1.6: Building MCP Apps
echo ====================================
cd /d "%~dp0mcp_app"
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: MCP Apps build failed!
    exit /b 1
)
cd /d "%~dp0"

echo.
echo ====================================
echo Step 2: Cleaning destination folder
echo ====================================

set "DEST_FOLDER=C:\Projects\MagicNetsuiteExtensionM"

if exist "%DEST_FOLDER%" (
    echo Deleting all files and folders in %DEST_FOLDER% except .git ...
    for /f "delims=" %%F in ('dir /b /a-d "%DEST_FOLDER%"') do (
        del /f /q "%DEST_FOLDER%\%%F"
    )
    for /d %%D in ("%DEST_FOLDER%\*") do (
        if /i not "%%~nxD"==".git" (
            rmdir /s /q "%%D"
        )
    )
) else (
    mkdir "%DEST_FOLDER%"
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to create destination folder!
        exit /b 1
    )
)

echo.
echo ====================================
echo Step 2.5: Creating mcpServer folder and copying exe
echo ====================================

set "MCP_DEST=%DEST_FOLDER%\mcpServer"
if not exist "%MCP_DEST%" (
    mkdir "%MCP_DEST%"
)

copy /y "%~dp0mcp_server\magiNetsuiteMCPServer.exe" "%MCP_DEST%\"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to copy MCP Server exe!
    exit /b 1
)

copy /y "%~dp0mcp_server\magicNetsuiteNativeHost.exe" "%MCP_DEST%\"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to copy MCP Native Host exe!
    exit /b 1
)

copy /y "%~dp0mcp_server\host.config.json" "%MCP_DEST%\"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to copy host.config.json!
    exit /b 1
)

copy /y "%~dp0mcp_server\installNativeHost.ps1" "%MCP_DEST%\"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to copy installNativeHost.ps1!
    exit /b 1
)

echo.
echo ====================================
echo Step 2.6: Packaging MCP Apps for Claude
echo ====================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0packageMcpApps.ps1" -DestinationFolder "%DEST_FOLDER%"
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to package MCP Apps!
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
echo Step 5: Installing native messaging host
echo ====================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%DEST_FOLDER%\mcpServer\installNativeHost.ps1" -ExtensionId nnkjegioomnaelmeiemdfmhipcpgomlp

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install native messaging host
    exit /b 1
)

echo.
echo ====================================
echo All operations completed successfully!
echo ====================================
