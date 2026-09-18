param(
  [ValidateSet("dirty", "clean")]
  [string]$Side = "dirty",
  [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath (Join-Path $Root "bootstrap.mjs"))) {
  $Root = Split-Path -Parent $PSScriptRoot
}
$hostScript = Join-Path $Root "supervisor-host.ps1"
if (-not (Test-Path -LiteralPath $hostScript)) { throw "missing $hostScript" }

$taskName = "HFPipe-$Side"
foreach ($old in @(
  "hf-dirty-health", "hf-clean-health", "hf-dirty-logon", "hf-clean-logon",
  "CursorMCP", "CursorMCPLogon", "HFPipe-dirty", "HFPipe-clean"
)) {
  Unregister-ScheduledTask -TaskName $old -Confirm:$false -ErrorAction SilentlyContinue
}

$userId = if ($env:USERDOMAIN) { "$env:USERDOMAIN\$env:USERNAME" } else { $env:USERNAME }
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$hostScript`" -Side $Side -Root `"$Root`"" `
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
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Autonomous hf-pipe $Side supervisor" `
  -Force | Out-Null

$startup = [Environment]::GetFolderPath("Startup")
foreach ($old in @("hf-dirty.lnk", "hf-clean.lnk", "CursorMCP.lnk")) {
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

Start-ScheduledTask -TaskName $taskName
Write-Output "ok $taskName supervisor"
