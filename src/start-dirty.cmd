@echo off
chcp 65001 >nul
setlocal
if exist "%~dp0bootstrap.mjs" (
  cd /d "%~dp0"
) else (
  cd /d "%~dp0.."
)
set HF_SIDE=dirty
if not defined HF_TEMP_KEEP_MS set HF_TEMP_KEEP_MS=0
if not defined HF_TEMP_SWEEP_MS set HF_TEMP_SWEEP_MS=30000
echo Live hop is scheduled task HFPipe-dirty, not this window.
exit /b 0
