@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 20.19 or 22.12 LTS is required for development.
  echo Use start-local.bat to run the included production build without npm.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing exact dependencies from package-lock.json...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo npm could not install the development dependencies.
    echo Use Node.js 22 LTS, move this folder outside OneDrive, then try again.
    echo You can still run the app now with start-local.bat.
    pause
    exit /b 1
  )
)

call npm run dev -- --open
exit /b %errorlevel%
