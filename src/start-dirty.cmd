@echo off
chcp 65001 >nul
setlocal
if exist "%~dp0bootstrap.mjs" (
  cd /d "%~dp0"
) else (
  cd /d "%~dp0.."
)
echo Leave this window open.
set HF_SIDE=dirty
if not defined HF_TEMP_KEEP_MS set HF_TEMP_KEEP_MS=0
if not defined HF_TEMP_SWEEP_MS set HF_TEMP_SWEEP_MS=30000
:loop
if exist "bootstrap.mjs" (
  node bootstrap.mjs dirty
) else (
  node src\index.mjs dirty
)
set "EC=%ERRORLEVEL%"
if "%EC%"=="2" (
  echo hop already running
  pause
  exit /b 2
)
echo node exited %EC% - restart in 4s
ping 127.0.0.1 -n 5 >nul
goto loop
