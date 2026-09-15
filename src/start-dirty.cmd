@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
echo Leave this window open.
set HF_SIDE=dirty
if not defined HF_TEMP_KEEP_MS set HF_TEMP_KEEP_MS=0
if not defined HF_TEMP_SWEEP_MS set HF_TEMP_SWEEP_MS=30000
:loop
node src\index.mjs dirty
echo node exited %ERRORLEVEL% - restart in 4s
ping 127.0.0.1 -n 5 >nul
goto loop
