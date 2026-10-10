@echo off
rem Runs the Pharmacy POS server and restarts it if it ever stops. Normally started hidden by start-hidden.vbs.
setlocal
rem Listen on the network so other computers can connect (see allow-network.cmd for the firewall rule).
set "HOST=0.0.0.0"
cd /d "%~dp0.."
if exist "C:\laragon\bin\nodejs\node-v22\node.exe" set "PATH=C:\laragon\bin\nodejs\node-v22;%PATH%"
if not exist data mkdir data

if not exist dist\index.html (
  echo [%date% %time%] building... >> data\server.log
  call npm.cmd run build >> data\server.log 2>&1
)

:loop
echo [%date% %time%] starting server >> data\server.log
call npm.cmd start >> data\server.log 2>&1
echo [%date% %time%] server stopped, restarting in 5s >> data\server.log
timeout /t 5 /nobreak >nul
goto loop
