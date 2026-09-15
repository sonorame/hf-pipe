@echo off
chcp 65001 >nul
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
  echo node is not on PATH
  pause
  exit /b 1
)
node src\diagnose.mjs
echo.
pause
