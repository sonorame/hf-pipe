@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
if "%~1"=="" (
  echo Usage: scripts\start.cmd dirty^|clean
  exit /b 2
)
node scripts\run.mjs %1
