@echo off
chcp 65001 >nul
setlocal
if exist "%~dp0bootstrap.mjs" (
  cd /d "%~dp0"
) else (
  cd /d "%~dp0.."
)
set HF_SIDE=clean
if not defined HF_TEMP_KEEP_MS set HF_TEMP_KEEP_MS=0
if not defined HF_TEMP_SWEEP_MS set HF_TEMP_SWEEP_MS=30000
if exist "C:\Program Files\nodejs\node.exe" (
  set "NODE=C:\Program Files\nodejs\node.exe"
) else (
  set "NODE=node"
)
if not exist "%USERPROFILE%\.hf-pipe\secrets\matrix-session.json" (
  echo No daemon session yet. Confirm the device, then this window closes.
  "%NODE%" src\login.mjs
  if errorlevel 1 (
    echo Login failed. Fix MATRIX_HOMESERVER_URL and run again.
    pause
    exit /b 1
  )
)
echo Session ok. Live hop is scheduled task HFPipe-clean, not this window.
exit /b 0
