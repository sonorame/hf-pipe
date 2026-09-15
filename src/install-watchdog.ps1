param(
  [ValidateSet("dirty", "clean")]
  [string]$Side = ""
)

$ErrorActionPreference = "Stop"
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$packNode = Join-Path $env:USERPROFILE "Desktop\hf-matrix-pack\node.exe"
$pfNode = Join-Path $env:ProgramFiles "nodejs\node.exe"
$localNode = Join-Path $Dir "node.exe"

if (-not $Side) {
  if (Test-Path -LiteralPath $localNode) { $Side = "clean" }
  elseif (Test-Path -LiteralPath $pfNode) { $Side = "dirty" }
  else { $Side = "clean" }
}

if ($Side -eq "dirty") {
  if (-not (Test-Path -LiteralPath $pfNode)) { throw "missing $pfNode" }
  $Node = $pfNode
} else {
  if (Test-Path -LiteralPath $localNode) { $Node = $localNode }
  elseif (Test-Path -LiteralPath $packNode) { $Node = $packNode }
  else { throw "missing portable node.exe" }
}

$entry = Join-Path $Dir "index.mjs"
if (-not (Test-Path -LiteralPath $entry)) { throw "missing $entry" }

if ($Side -eq "clean") {
  $mods = Join-Path (Split-Path $packNode) "node_modules"
  $link = Join-Path $Dir "node_modules"
  if ((Test-Path -LiteralPath $mods) -and -not (Test-Path -LiteralPath $link)) {
    cmd.exe /c "mklink /J `"$link`" `"$mods`"" | Out-Null
  }
}

$taskName = "CursorMCP"
foreach ($old in @("hf-dirty-health", "hf-clean-health", "hf-dirty-logon", "hf-clean-logon")) {
  Unregister-ScheduledTask -TaskName $old -Confirm:$false -ErrorAction SilentlyContinue
}

$action = New-ScheduledTaskAction -Execute $Node -Argument "index.mjs $Side" -WorkingDirectory $Dir
$repeat = New-TimeSpan -Minutes 2
$duration = New-TimeSpan -Days 9999
$tRepeat = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval $repeat -RepetitionDuration $duration
$tLogon = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -Hidden
$settings.ExecutionTimeLimit = "PT0S"
$settings.DisallowStartIfOnBatteries = $false
$settings.StopIfGoingOnBatteries = $false
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($tRepeat, $tLogon) -Settings $settings -Principal $principal -Force | Out-Null

$startup = [Environment]::GetFolderPath("Startup")
foreach ($old in @("hf-dirty.lnk", "hf-clean.lnk")) {
  $p = Join-Path $startup $old
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
}

Write-Output "ok $taskName $Side $Node index.mjs"
