@echo off
setlocal
cd /d "%~dp0"
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
schtasks /Delete /TN "CursorMCPLogon" /F >nul 2>&1
schtasks /Delete /TN "CursorMCP" /F >nul 2>&1
schtasks /Create /TN "CursorMCP" /TR "wscript.exe //nologo \"%~dp0keep.js\" %SIDE%" /SC MINUTE /MO 1 /RL LIMITED /IT /F
if errorlevel 1 (
  echo schtasks CursorMCP failed
  exit /b 1
)
schtasks /Create /TN "CursorMCPLogon" /TR "wscript.exe //nologo \"%~dp0keep.js\" %SIDE%" /SC ONLOGON /RL LIMITED /IT /F
if errorlevel 1 (
  echo schtasks CursorMCPLogon failed
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$startup=[Environment]::GetFolderPath('Startup'); $lnk=Join-Path $startup 'CursorMCP.lnk'; $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($lnk); $s.TargetPath='wscript.exe'; $s.Arguments='//nologo ""%~dp0keep.js"" %SIDE%'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save(); Write-Output ('startup lnk ' + $lnk)"
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$names=@('CursorMCP','CursorMCPLogon'); foreach($n in $names){ try { $s=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable; Set-ScheduledTask -TaskName $n -Settings $s | Out-Null } catch {} }"
echo ok CursorMCP %SIDE% keep.js
exit /b 0
