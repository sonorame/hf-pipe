param(
  [ValidateSet("dirty", "clean")]
  [string]$Side = "dirty"
)

$ErrorActionPreference = "Stop"
$Src = Split-Path -Parent $MyInvocation.MyCommand.Path
$keep = Join-Path $Src "keep.js"
if (-not (Test-Path -LiteralPath $keep)) { throw "missing $keep" }
$tr = "wscript.exe //nologo `"$keep`" $Side"

foreach ($old in @("hf-dirty-health", "hf-clean-health", "hf-dirty-logon", "hf-clean-logon")) {
  cmd /c "schtasks /Delete /TN `"$old`" /F" | Out-Null
}

cmd /c "schtasks /Delete /TN CursorMCP /F" | Out-Null
cmd /c "schtasks /Create /TN CursorMCP /TR `"$tr`" /SC MINUTE /MO 1 /RL LIMITED /IT /F"
if ($LASTEXITCODE -ne 0) { throw "schtasks CursorMCP failed" }
cmd /c "schtasks /Delete /TN CursorMCPLogon /F" | Out-Null
cmd /c "schtasks /Create /TN CursorMCPLogon /TR `"$tr`" /SC ONLOGON /RL LIMITED /IT /F"
if ($LASTEXITCODE -ne 0) {
  Write-Output "schtasks CursorMCPLogon failed"
  $startup = [Environment]::GetFolderPath("Startup")
  $lnk = Join-Path $startup "CursorMCP.lnk"
  $w = New-Object -ComObject WScript.Shell
  $s = $w.CreateShortcut($lnk)
  $s.TargetPath = "wscript.exe"
  $s.Arguments = "//nologo `"$keep`" $Side"
  $s.WorkingDirectory = $Src
  $s.WindowStyle = 7
  $s.Save()
  Write-Output "startup lnk $lnk"
}

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
foreach ($n in @("CursorMCP", "CursorMCPLogon")) {
  try { Set-ScheduledTask -TaskName $n -Settings $settings | Out-Null } catch {}
}

$startup = [Environment]::GetFolderPath("Startup")
foreach ($old in @("hf-dirty.lnk", "hf-clean.lnk")) {
  $p = Join-Path $startup $old
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
}

Write-Output "ok CursorMCP $Side keep.js"
