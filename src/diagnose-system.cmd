@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" (
  echo No system node: %NODE%
  pause
  exit /b 1
)
echo NODE=%NODE%
"%NODE%" "%~dp0diagnose.mjs"
echo.
pause
