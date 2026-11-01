param([switch]$TestOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$state = Join-Path $env:USERPROFILE '.hf-pipe\vps-clean'
$app = Join-Path $state 'app'
$node = Join-Path $root 'node.exe'
if (-not (Test-Path -LiteralPath $node)) { throw 'node.exe is missing: extract the complete package first' }
if (-not (Test-Path -LiteralPath (Join-Path $root 'enrollment.json'))) { throw 'enrollment.json is missing' }
$bundle = Get-Content -LiteralPath (Join-Path $root 'enrollment.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Path $state -Force | Out-Null
$configScript = "import {loadEnvFile,secretsDir,sessionFile} from './src/config.mjs';loadEnvFile();console.log(JSON.stringify({secrets:secretsDir(),session:sessionFile()}));"
Push-Location $root
try { $existing = (& $node --input-type=module -e $configScript) | ConvertFrom-Json } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'Cannot locate the existing Matrix session' }
$oldTask = Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -eq 'HFPipe-clean' }
$oldEnabled = $oldTask -and $oldTask.State -ne 'Disabled'
$oldRunning = $oldTask -and $oldTask.State -eq 'Running'
$launcher = $null
try {
  if ($oldTask) {
    Export-ScheduledTask -TaskName 'HFPipe-clean' | Set-Content -LiteralPath (Join-Path $state 'previous-task.xml') -Encoding UTF8
    Stop-ScheduledTask -TaskName 'HFPipe-clean'
  }
  $pidFile = Join-Path $state 'launcher.pid'
  if (Test-Path -LiteralPath $pidFile) {
    $previousId = [int](Get-Content -LiteralPath $pidFile)
    $previous = Get-CimInstance Win32_Process -Filter "ProcessId=$previousId"
    if ($previous) {
      if ($previous.CommandLine -notlike ('*'+$app+'*start-clean-vps.ps1*')) { throw 'Unexpected process in launcher.pid; no process was stopped' }
      & taskkill.exe /PID $previousId /T /F | Out-Null
    }
  }
  New-Item -ItemType Directory -Path $app -Force | Out-Null
  foreach ($name in @('node.exe','package.json','package-lock.json','src','scripts','dist','node_modules')) {
    Copy-Item -LiteralPath (Join-Path $root $name) -Destination $app -Recurse -Force
  }
  $envPath = Join-Path $state 'clean.env'
  @(
    'HF_SIDE=clean', 'HF_DEVICE_NAME=hf-matrix-work', ('MATRIX_HOMESERVER_URL='+$bundle.homeserver),
    'HF_RPC_BIND=127.0.0.1', 'HF_RPC_PORT=18765', 'HF_EGRESS_PORT=18766', 'HF_PROTOCOL_VERSION=3',
    'HF_BUILD_ID=e23f15d-vps-current', 'HF_OPEN_BROWSER=0',
    ('HF_RUNTIME_ROOT='+$state), ('HF_SECRETS_DIR='+$existing.secrets), ('MATRIX_SESSION_FILE='+$existing.session),
    ('MATRIX_DATA_DIR='+(Join-Path $state 'matrix')), ('HF_LOCAL_DIR='+(Join-Path $state 'local')),
    ('HF_PEER_TRUST_FILE='+(Join-Path $state 'peer-trust.json'))
  ) | Set-Content -LiteralPath $envPath -Encoding UTF8
  $env:HF_ENV_FILE = $envPath
  Push-Location $app
  try {
    if (-not (Test-Path -LiteralPath $existing.session)) { & $node src/login.mjs; if ($LASTEXITCODE -ne 0) { throw 'Matrix login failed' } }
    & $node scripts/enroll-clean-vps.mjs (Join-Path $root 'enrollment.json')
    if ($LASTEXITCODE -ne 0) { throw 'VPS enrollment failed; the previous installation is preserved' }
  } finally { Pop-Location }
  $startArguments = @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $app 'scripts\start-clean-vps.ps1')+'"'),'-StateRoot',('"'+$state+'"'))
  $launcher = Start-Process -FilePath 'powershell.exe' -ArgumentList $startArguments -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddMinutes(6)
  $ready = $false
  Write-Host 'Waiting for the clean-to-VPS datachannel...'
  do {
    Start-Sleep -Seconds 2
    try { $status = Invoke-RestMethod 'http://127.0.0.1:18764/status' -TimeoutSec 2; $ready = $status.report.local.rtc -eq $true } catch {}
    if ($launcher.HasExited) { throw 'Clean launcher exited; inspect .hf-pipe\vps-clean\stderr.log' }
  } until ($ready -or (Get-Date) -gt $deadline)
  if (-not $ready) { throw 'Datachannel did not become ready; retry the same package' }
  if (-not $TestOnly) {
    $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($startArguments -join ' ') -WorkingDirectory $app
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
    $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName 'HFPipe-clean-vps' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    if ($oldEnabled) { Disable-ScheduledTask -TaskName 'HFPipe-clean' | Out-Null }
  }
  Write-Host 'READY: hf-pipe clean is connected to the VPS. Existing VS Code proxy settings remain usable.'
  Write-Host ('Status: http://127.0.0.1:18764/; logs: '+$state)
} catch {
  if ($launcher -and -not $launcher.HasExited) { & taskkill.exe /PID $launcher.Id /T /F | Out-Null }
  if ($oldEnabled) { Enable-ScheduledTask -TaskName 'HFPipe-clean' | Out-Null }
  if ($oldRunning) { Start-ScheduledTask -TaskName 'HFPipe-clean' }
  throw
}
