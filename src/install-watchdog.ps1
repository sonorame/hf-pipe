param(
  [ValidateSet("dirty", "clean")]
  [string]$Side = "dirty"
)

$ErrorActionPreference = "Stop"
$Src = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $Src
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw "node is not on PATH" }
$Node = $nodeCmd.Source
$entry = Join-Path $Src "index.mjs"
if (-not (Test-Path -LiteralPath $entry)) { throw "missing $entry" }

$taskName = "CursorMCP"
foreach ($old in @("hf-dirty-health", "hf-clean-health", "hf-dirty-logon", "hf-clean-logon")) {
  Unregister-ScheduledTask -TaskName $old -Confirm:$false -ErrorAction SilentlyContinue
}

$action = New-ScheduledTaskAction -Execute $Node -Argument "src/index.mjs $Side" -WorkingDirectory $Root
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

Write-Output "ok $taskName $Side $Node src/index.mjs"
