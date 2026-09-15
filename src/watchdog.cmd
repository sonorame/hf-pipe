@echo off
setlocal
cd /d "%~dp0"
set PIDFILE=%~dp0hf.pid
if exist "%PIDFILE%" (
  set /p PID=<%PIDFILE%
)
if defined PID (
  tasklist /FI "PID eq %PID%" 2>nul | findstr /R /C:" %PID% " >nul
  if not errorlevel 1 exit /b 0
)
start "hf-clean" /MIN cmd /c "%~dp0start-clean.cmd"
exit /b 0
