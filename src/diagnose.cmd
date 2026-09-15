@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo NODE=%NODE%
node src\diagnose.mjs
echo.
pause
