param([Parameter(Mandatory=$true)][string]$StateRoot)
$ErrorActionPreference = 'Stop'
$app = Split-Path -Parent $PSScriptRoot
$env:HF_ENV_FILE = Join-Path $StateRoot 'clean.env'
. (Join-Path $app 'src\process-job.ps1')
$job = New-HfKillOnCloseJob
Set-Content -LiteralPath (Join-Path $StateRoot 'launcher.pid') -Value $PID -Encoding ASCII
for (;;) {
  $node = Start-Process -FilePath (Join-Path $app 'node.exe') -ArgumentList @('scripts/run.mjs','clean') -WorkingDirectory $app -WindowStyle Hidden -RedirectStandardOutput (Join-Path $StateRoot 'stdout.log') -RedirectStandardError (Join-Path $StateRoot 'stderr.log') -PassThru
  Add-HfProcessToJob -Job $job -Process $node
  $trayArguments = @('-NoProfile','-STA','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $app 'src\tray-viewer.ps1')+'"'),'-StateFile',('"'+(Join-Path $StateRoot 'tray-state.json')+'"'))
  $tray = Start-Process -FilePath 'powershell.exe' -ArgumentList $trayArguments -WindowStyle Hidden -PassThru
  Add-HfProcessToJob -Job $job -Process $tray
  $node.WaitForExit()
  if (-not $tray.HasExited) { $tray.Kill() }
  if ($node.ExitCode -eq 2) { exit 2 }
  Start-Sleep -Seconds 4
}
