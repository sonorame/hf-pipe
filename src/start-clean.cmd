@echo off
chcp 65001 >nul
setlocal
set "PACK=%USERPROFILE%\Desktop\hf-matrix-pack"
if exist "%~dp0node.exe" set "PACK=%~dp0"
if exist "%~dp0dist\matrix\client.js" set "PACK=%~dp0"
set "HOME=%USERPROFILE%\.cursor\matrix-mcp-e2ee"
if exist "%PACK%\index.mjs" set "HOME=%PACK%"
if exist "C:\Program Files\nodejs\node.exe" (
  set "NODE=C:\Program Files\nodejs\node.exe"
) else if exist "%~dp0node.exe" (
  set "NODE=%~dp0node.exe"
) else if exist "%PACK%\node.exe" (
  set "NODE=%PACK%\node.exe"
) else (
  set "NODE=node.exe"
)
if not exist "%HOME%\index.mjs" set "HOME=%PACK%"
if not exist "%HOME%\dist" if exist "%PACK%\dist" mklink /J "%HOME%\dist" "%PACK%\dist" >nul 2>&1
if not exist "%HOME%\node_modules" if exist "%PACK%\node_modules" mklink /J "%HOME%\node_modules" "%PACK%\node_modules" >nul 2>&1
cd /d "%HOME%"
echo.
echo Leave this window open.
echo If Element asks to confirm device hf-matrix - confirm it.
echo.
if not exist "%USERPROFILE%\.cursor\secrets\matrix-session.json" (
  echo No daemon session yet. Confirm the device, then this window continues by itself.
  "%NODE%" "%HOME%\login.mjs"
  if errorlevel 1 (
    echo Login failed. If Element still cannot connect, wait for mtx-1 and run start-clean.cmd again.
    pause
    exit /b 1
  )
)
set HF_SIDE=clean
:loop
"%NODE%" "%HOME%\index.mjs" clean
echo node exited %ERRORLEVEL% - restart in 4s
timeout /t 4 /nobreak >nul
goto loop
