@echo off
rem Registers a per-user task that starts the Pharmacy POS server (hidden) every time you sign in to Windows, and starts it now.
rem Remove later with uninstall-autostart.cmd. No administrator rights needed.
setlocal
set "TASK=PharmacyPOS"
schtasks /Create /F /SC ONLOGON /TN "%TASK%" /TR "wscript.exe \"%~dp0start-hidden.vbs\"" /RL LIMITED
if errorlevel 1 ( echo Could not create the startup task. & exit /b 1 )
schtasks /Run /TN "%TASK%"
echo.
echo Done. The server runs in the background (log: data\server.log).
echo Open http://127.0.0.1:3000 in your browser. It may take about 10 seconds the first time while the app builds.
