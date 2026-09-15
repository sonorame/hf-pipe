@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
echo Leave this window open.
echo If Element asks to confirm device hf-matrix - confirm it.
echo.
set HF_SIDE=clean
if not defined HF_TEMP_KEEP_MS set HF_TEMP_KEEP_MS=0
if not defined HF_TEMP_SWEEP_MS set HF_TEMP_SWEEP_MS=30000
if not exist "%USERPROFILE%\.hf-pipe\secrets\matrix-session.json" if not exist "%USERPROFILE%\.cursor\secrets\matrix-session.json" (
  echo No daemon session yet. Confirm the device, then this window continues by itself.
  node src\login.mjs
  if errorlevel 1 (
    echo Login failed. Fix MATRIX_HOMESERVER_URL and run again.
    pause
    exit /b 1
  )
)
:loop
node src\index.mjs clean
echo node exited %ERRORLEVEL% - restart in 4s
ping 127.0.0.1 -n 5 >nul
goto loop
