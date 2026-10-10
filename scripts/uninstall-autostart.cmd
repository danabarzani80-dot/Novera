@echo off
rem Removes the startup task and stops the running server (anything listening on port 3000).
schtasks /Delete /F /TN "PharmacyPOS"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq run-server*" /F >nul 2>&1
echo Pharmacy POS will no longer start automatically.
