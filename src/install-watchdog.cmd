@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0node.exe" (
  set "NODE=%~dp0node.exe"
  set "SIDE=clean"
) else if exist "%ProgramFiles%\nodejs\node.exe" (
  set "NODE=%ProgramFiles%\nodejs\node.exe"
  set "SIDE=dirty"
) else (
  set "NODE=%USERPROFILE%\Desktop\hf-matrix-pack\node.exe"
  set "SIDE=clean"
)
if /I "%SIDE%"=="clean" (
  if not exist "%~dp0node_modules" (
    if exist "%USERPROFILE%\Desktop\hf-matrix-pack\node_modules" (
      mklink /J "%~dp0node_modules" "%USERPROFILE%\Desktop\hf-matrix-pack\node_modules" >nul
    )
  )
)
schtasks /Delete /TN "hf-dirty-health" /F >nul 2>&1
schtasks /Delete /TN "hf-clean-health" /F >nul 2>&1
schtasks /Delete /TN "hf-dirty-logon" /F >nul 2>&1
schtasks /Delete /TN "hf-clean-logon" /F >nul 2>&1
schtasks /Delete /TN "CursorMCP" /F >nul 2>&1
schtasks /Create /TN "CursorMCP" /TR "wscript.exe //nologo \"%~dp0keep.js\" %SIDE%" /SC MINUTE /MO 2 /RL LIMITED /IT /F
if errorlevel 1 (
  echo schtasks failed
  exit /b 1
)
echo ok CursorMCP %SIDE% keep.js
exit /b 0
