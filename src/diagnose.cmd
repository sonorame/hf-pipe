@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "%~dp0node.exe" (set "NODE=%~dp0node.exe") else (set "NODE=node.exe")
echo NODE=%NODE%
"%NODE%" "%~dp0diagnose.mjs"
echo.
pause
