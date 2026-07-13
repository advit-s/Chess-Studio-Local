@echo off
setlocal
cd /d "%~dp0"
call "%~dp0run-prebuilt.bat"
exit /b %errorlevel%
