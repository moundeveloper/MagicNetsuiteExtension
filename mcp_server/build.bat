call pkg magiNetsuiteMCPServer.js -t node18-win-x64
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%

call pkg magicNetsuiteNativeHost.js -t node18-win-x64
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
