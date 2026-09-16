@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0.."

if exist "C:\Program Files\nodejs\node.exe" (
  set "NODE=C:\Program Files\nodejs\node.exe"
) else if exist "%~dp0..\node.exe" (
  set "NODE=%~dp0..\node.exe"
) else (
  set "NODE=node.exe"
)

set "ALIVE="
set "PID="
if exist "src\hf.pid" set /p PID=<"src\hf.pid"
if defined PID (
  tasklist /FI "PID eq %PID%" 2>nul | findstr /R /C:" %PID% " >nul && set "ALIVE=1"
)
if defined ALIVE (
  echo Dirty hop already running pid %PID%.
) else (
  echo Starting dirty hop...
  start "hf-dirty" /MIN cmd /c "%~dp0..\src\start-dirty.cmd"
)

echo Waiting for RTC channel (up to ~2 min)...
set /a N=0
:wait
"%NODE%" -e "const h=require('http');h.get({host:'127.0.0.1',port:18765,path:'/status',timeout:4000},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{process.exit(JSON.parse(d).rtc?0:1)}catch{process.exit(1)}})}).on('error',()=>process.exit(1)).on('timeout',function(){this.destroy();process.exit(1)});"
if not errorlevel 1 goto ready
set /a N+=1
if !N! geq 30 goto doctor
ping 127.0.0.1 -n 5 >nul
goto wait
:ready
echo RTC channel is up.

:doctor
echo.
set HF_SIDE=dirty
"%NODE%" src\hop-doctor.mjs
set "EC=%ERRORLEVEL%"
echo.
if "%EC%"=="0" (
  echo === GREEN: channel healthy end-to-end ===
) else (
  echo === RED: see the culprit line above ===
  echo If e2e/status is RED but versions/turn are GREEN, check the clean hop daemon.
)
echo.
pause
exit /b %EC%
