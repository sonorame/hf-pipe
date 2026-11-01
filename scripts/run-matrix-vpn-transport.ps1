param([Parameter(Mandatory=$true)][string]$StateRoot)
. (Join-Path $PSScriptRoot 'matrix-vpn-common.ps1')
Import-HfVpnEnvironment $StateRoot
$app = Split-Path -Parent $PSScriptRoot
. (Join-Path $app 'src\process-job.ps1')
$job = New-HfKillOnCloseJob
Set-Content -LiteralPath (Join-Path $StateRoot 'transport.pid') -Value $PID -Encoding ASCII
$trayArgs = @('-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $app 'src\tray-viewer.ps1')+'"'),'-StatusUrl','http://127.0.0.1:18864/status','-DetailsUrl','http://127.0.0.1:18864/','-StateFile',('"'+(Join-Path $StateRoot 'tray-state.json')+'"'))
$tray = Start-Process powershell.exe -ArgumentList $trayArgs -WindowStyle Hidden -PassThru
Add-HfProcessToJob -Job $job -Process $tray
for (;;) {
  if (Test-Path -LiteralPath (Join-Path $StateRoot 'stop')) { break }
  $node = Start-Process -FilePath (Join-Path $app 'node.exe') -ArgumentList @('scripts/run.mjs','clean') -WorkingDirectory $app -WindowStyle Hidden -RedirectStandardOutput (Join-Path $StateRoot 'stdout.log') -RedirectStandardError (Join-Path $StateRoot 'stderr.log') -PassThru
  Add-HfProcessToJob -Job $job -Process $node
  while (-not $node.WaitForExit(1000)) {
    if (Test-Path -LiteralPath (Join-Path $StateRoot 'stop')) { $node.Kill(); exit }
  }
  if ($node.ExitCode -eq 2) { exit 2 }
  Start-Sleep -Seconds 4
}
