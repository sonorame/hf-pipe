@echo off
setlocal
cd /d "%~dp0"
set TR=%~dp0watchdog.cmd
schtasks /Create /TN "hf-clean-logon" /TR "%TR%" /SC ONLOGON /RL LIMITED /IT /F >nul 2>&1
schtasks /Create /TN "hf-clean-health" /TR "%TR%" /SC MINUTE /MO 2 /RL LIMITED /IT /F
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-startup.ps1" -Name hf-clean -Dir "%~dp0"
echo watchdog: hf-clean-health + Startup shortcut
exit /b 0
