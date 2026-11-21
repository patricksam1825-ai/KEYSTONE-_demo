@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
title KEYSTONE - First-time setup
 echo.
echo  ======================================================
echo   KEYSTONE 2.3.11 - FIRST-TIME SETUP (CHIPNET)
echo  ======================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js 22.13 or newer (64-bit), then run setup again.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo Your Node.js version is too old. KEYSTONE requires Node.js 22.13+.
  node -v
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)
echo Node.js version:
node -v
if not exist .env copy /y windows\.env.windows .env >nul
 echo.
echo Installing the pinned project dependencies. Internet is required.
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo Dependency installation failed. Check your internet connection and try again.
  pause
  exit /b 1
)
echo.
echo Setup completed. Double-click START-KEYSTONE.bat in this folder.
pause
