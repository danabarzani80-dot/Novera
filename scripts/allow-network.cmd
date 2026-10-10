@echo off
rem Lets other computers on your private network (Wi-Fi/LAN) open Pharmacy POS. Run once: right-click -> "Run as administrator".
net session >nul 2>&1
if errorlevel 1 ( echo Please right-click this file and choose "Run as administrator". & pause & exit /b 1 )
netsh advfirewall firewall delete rule name="Pharmacy POS" >nul 2>&1
netsh advfirewall firewall add rule name="Pharmacy POS" dir=in action=allow protocol=TCP localport=3000 profile=private
echo.
echo Done. On the other computers open  http://THIS-PC-IP:3000
echo This PC's addresses:
ipconfig | findstr /R /C:"IPv4"
pause
