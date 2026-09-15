@echo off
setlocal
cd /d "%~dp0.."
where node >nul 2>&1
if errorlevel 1 (
  echo node is not on PATH
  exit /b 1
)
if /I "%~1"=="clean" (
  set "SIDE=clean"
) else if /I "%~1"=="dirty" (
  set "SIDE=dirty"
) else (
  set "SIDE=dirty"
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
