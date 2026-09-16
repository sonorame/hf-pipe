@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
if exist "C:\Program Files\nodejs\node.exe" (
  set "NODE=C:\Program Files\nodejs\node.exe"
) else (
  set "NODE=node"
)
echo NODE=%NODE%
"%NODE%" src\diagnose.mjs
echo.
pause
