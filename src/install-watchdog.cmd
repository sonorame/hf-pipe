@echo off
setlocal
set "SIDE=%~1"
if /I not "%SIDE%"=="clean" if /I not "%SIDE%"=="dirty" set "SIDE=dirty"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-watchdog.ps1" -Side "%SIDE%"
exit /b %ERRORLEVEL%
