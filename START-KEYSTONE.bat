@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
title KEYSTONE - Chipnet demo
if not exist node_modules (
  echo Please run SETUP-KEYSTONE.bat first.
  pause
  exit /b 1
)
if not exist .env copy /y windows\.env.windows .env >nul
for /f "tokens=2 delims==" %%i in ('findstr /b "PORT=" .env') do set PORT=%%i
if "%PORT%"=="" set PORT=4173
for /f "tokens=2 delims==" %%i in ('findstr /b "HOST=" .env') do set HOST=%%i
if "%HOST%"=="" set HOST=0.0.0.0
 echo.
echo  ======================================================
echo   KEYSTONE - CHIPNET DEMO SERVER
echo  ======================================================
echo.
echo This demo is configured for CHIPNET. Do not switch to Mainnet.
echo.
echo Laptop address: http://localhost:%PORT%
echo Phone address (same Wi-Fi):
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ip=Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue ^| Where-Object {$_.IPAddress -notlike '127.*' -and $_.AddressState -eq 'Preferred'} ^| Select-Object -First 1 -ExpandProperty IPAddress; if($ip){Write-Host ('  http://'+$ip+':%PORT%')}else{Write-Host '  Could not detect Wi-Fi IP. Run ipconfig and use your Wi-Fi IPv4 address.'}"
echo.
echo Keep this window open. Press Ctrl+C to stop KEYSTONE.
echo.
start "KEYSTONE" "http://localhost:%PORT%"
call npm start
pause
