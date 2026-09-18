param(
  [ValidateSet("dirty", "clean")]
  [string]$Side = "dirty",
  [string]$Root = $PSScriptRoot,
  [string]$TaskName = "",
  [string]$StatusUrl = "http://127.0.0.1:18764/status",
  [string]$DetailsUrl = "http://127.0.0.1:18764/",
  [string]$TrayStateFile = ""
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath (Join-Path $Root "bootstrap.mjs"))) {
  $Root = Split-Path -Parent $PSScriptRoot
}
$launcherRoot = $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $launcherRoot "task-host.ps1"))) {
  $launcherRoot = $Root
}
$hostScript = Join-Path $launcherRoot "task-host.ps1"
$supervisorScript = Join-Path $launcherRoot "supervisor-host.ps1"
if (-not (Test-Path -LiteralPath $hostScript)) { throw "missing $hostScript" }
if (-not (Test-Path -LiteralPath $supervisorScript)) { throw "missing $supervisorScript" }
$isProductionTask = [string]::IsNullOrWhiteSpace($TaskName)
$resolvedTaskName = if ($isProductionTask) { "HFPipe-$Side" } else { $TaskName }

function Stop-HfSideProcesses {
  param([string]$SideName, [string]$RootPath)
  $rootNeedle = [regex]::Escape($RootPath)
  $sideNeedle = [regex]::Escape($SideName)
  Get-CimInstance Win32_Process | ForEach-Object {
    $cl = [string]$_.CommandLine
    if ($_.ProcessId -eq $PID) { return }
    if ($cl -match "install-watchdog") { return }
    if ($cl -notmatch $rootNeedle) { return }
    if ($cl -notmatch $sideNeedle) { return }
    $isHop = ($cl -match "task-host\.ps1") -or
      ($cl -match "supervisor-host\.ps1") -or
      ($cl -match "supervisor-launch\.vbs") -or
      ($cl -match "bootstrap\.mjs") -or
      ($cl -match "rtc-worker\.mjs") -or
      ($cl -match "tray-viewer\.ps1") -or
      ($cl -match "index\.mjs") -or
      ($cl -match "conhost\.exe" -and $cl -match "supervisor-host")
    if (-not $isHop) { return }
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

Stop-ScheduledTask -TaskName $resolvedTaskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Stop-HfSideProcesses -SideName $Side -RootPath $Root
Start-Sleep -Seconds 1

$oldTasks = @($resolvedTaskName)
if ($isProductionTask) {
  $oldTasks += @("hf-$Side-health", "hf-$Side-logon")
  if ($Side -eq "dirty") { $oldTasks += @("CursorMCP", "CursorMCPLogon") }
}
foreach ($old in @($oldTasks | Select-Object -Unique)) {
  Unregister-ScheduledTask -TaskName $old -Confirm:$false -ErrorAction SilentlyContinue
}

$userId = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$actionArguments = @(
  "-NoProfile",
  "-STA",
  "-WindowStyle",
  "Hidden",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  "`"$hostScript`"",
  "-Side",
  $Side,
  "-Root",
  "`"$Root`"",
  "-StatusUrl",
  "`"$StatusUrl`"",
  "-DetailsUrl",
  "`"$DetailsUrl`""
)
if (-not [string]::IsNullOrWhiteSpace($TrayStateFile)) {
  $actionArguments += @("-TrayStateFile", "`"$TrayStateFile`"")
}
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument ($actionArguments -join " ") `
  -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$settings.Hidden = $true

Register-ScheduledTask `
  -TaskName $resolvedTaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Autonomous hf-pipe $Side supervisor" `
  -Force | Out-Null

if ($isProductionTask) {
  $startup = [Environment]::GetFolderPath("Startup")
  foreach ($old in @("hf-$Side.lnk", $(if ($Side -eq "dirty") { "CursorMCP.lnk" }))) {
    if ([string]::IsNullOrWhiteSpace($old)) { continue }
    $p = Join-Path $startup $old
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force }
  }

  if ($Side -eq "dirty") {
    $boardShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "hf-pipe status.url"
    Set-Content -LiteralPath $boardShortcut -Encoding ASCII -Value @(
      "[InternetShortcut]",
      "URL=http://127.0.0.1:18764/"
    )
  }
}

Start-ScheduledTask -TaskName $resolvedTaskName
Write-Output "ok $resolvedTaskName supervisor"
