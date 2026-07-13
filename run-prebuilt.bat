@echo off
setlocal
cd /d "%~dp0"

if not exist "%~dp0dist\index.html" (
  echo The included production build is missing.
  echo Run npm run build, then try again.
  pause
  exit /b 1
)

where node >nul 2>&1
if not errorlevel 1 (
  node "%~dp0scripts\serve-dist.mjs"
  exit /b %errorlevel%
)

set "PYTHON_COMMAND="
where py >nul 2>&1
if not errorlevel 1 set "PYTHON_COMMAND=py"
if not defined PYTHON_COMMAND (
  where python >nul 2>&1
  if not errorlevel 1 set "PYTHON_COMMAND=python"
)

if not defined PYTHON_COMMAND (
  echo Node.js or Python is required to start the local HTTP server.
  echo Install Node.js 22 LTS, then double-click start-local.bat again.
  pause
  exit /b 1
)

start "Chess Studio Local Server" /min %PYTHON_COMMAND% -m http.server 8080 --bind 127.0.0.1 --directory "%~dp0dist"
timeout /t 2 /nobreak >nul
set "APP_URL=http://127.0.0.1:8080/"

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%APP_URL%"
  exit /b 0
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%APP_URL%"
  exit /b 0
)
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%APP_URL%"
  exit /b 0
)

start "" "%APP_URL%"
exit /b 0
