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
cmd /c "schtasks /Create /TN CursorMCPLogon /TR `"$tr`" /SC ONLOGON /RL LIMITED /IT /F" | Out-Null

$startup = [Environment]::GetFolderPath("Startup")
foreach ($old in @("hf-dirty.lnk", "hf-clean.lnk")) {
  $p = Join-Path $startup $old
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
}

Write-Output "ok CursorMCP $Side keep.js"
