@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (echo Run SETUP-KEYSTONE.bat first.& pause & exit /b 1)
echo Running syntax checks, tests and production build...
call npm run check
if errorlevel 1 goto failed
call npm test
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
echo.
echo All local checks passed. This does NOT prove live Paytaca pairing or Chipnet node acceptance.
pause
exit /b 0
:failed
echo.
echo A check failed. Save the full output and share it for diagnosis.
pause
exit /b 1
