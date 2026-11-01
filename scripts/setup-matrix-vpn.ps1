param([switch]$TestTransport)
. (Join-Path $PSScriptRoot 'matrix-vpn-common.ps1')
$root = Split-Path -Parent $PSScriptRoot
$state = Join-Path $env:USERPROFILE $(if ($TestTransport) {'.hf-pipe\matrix-vpn-test'} else {'.hf-pipe\matrix-vpn'})
$app = Join-Path $state 'app'
$mutex = New-Object Threading.Mutex($false, ('Local\HFPipeMatrixVPNSetup-' + $(if ($TestTransport) {'test'} else {'tun'})))
if (-not $mutex.WaitOne(0)) { throw 'Matrix VPN setup is already running' }
try {
  foreach ($pidName in @('transport.pid','frontend.pid')) {
    $pidFile = Join-Path $state $pidName
    if (Test-Path -LiteralPath $pidFile) {
      $previousId = [int](Get-Content -LiteralPath $pidFile)
      $previous = Get-CimInstance Win32_Process -Filter "ProcessId=$previousId"
      if ($previous -and $previous.CommandLine -like ('*'+$app+'*matrix-vpn*')) { throw 'Matrix VPN is already running. Use Stop-VPN.cmd first.' }
    }
  }
  New-Item -ItemType Directory -Path $app -Force | Out-Null
  & robocopy.exe $root $app /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw 'Cannot copy the complete offline package' }
  $bundle = Get-Content -LiteralPath (Join-Path $app 'enrollment.json') -Raw | ConvertFrom-Json
  $envPath = Join-Path $state 'vpn.env'
  @(
    'HF_SIDE=clean','HF_DEVICE_NAME=hf-matrix-vpn','HF_EGRESS_PROFILE=vpn','HF_PROTOCOL_VERSION=3','HF_BUILD_ID=matrix-vpn-v1',
    ('MATRIX_HOMESERVER_URL='+$bundle.homeserver),'HF_RPC_BIND=127.0.0.1','HF_RPC_PORT=18865','HF_SUPERVISOR_PORT=18864','HF_EGRESS_PORT=18866','HF_LOGIN_PORT=18867',
    ('HF_RUNTIME_ROOT='+$state),('HF_SECRETS_DIR='+(Join-Path $state 'secrets')),('MATRIX_SESSION_FILE='+(Join-Path $state 'secrets\matrix-session.json')),
    ('HF_OAUTH_CLIENT_FILE='+(Join-Path $state 'secrets\matrix-oauth-client.json')),('MATRIX_DATA_DIR='+(Join-Path $state 'matrix')),
    ('HF_LOCAL_DIR='+(Join-Path $state 'local')),('HF_PEER_TRUST_FILE='+(Join-Path $state 'peer-trust.json'))
  ) | Set-Content -LiteralPath $envPath -Encoding UTF8
  $node = Join-Path $app 'node.exe'
  Push-Location $app
  try {
    & $node scripts/configure-matrix-vpn.mjs $state
    if ($LASTEXITCODE -ne 0) { throw 'Matrix DNS bootstrap failed; no routes were changed' }
    Import-HfVpnEnvironment $state
    if (-not (Test-Path -LiteralPath $env:MATRIX_SESSION_FILE)) {
      & $node src/login.mjs
      if ($LASTEXITCODE -ne 0) { throw 'Matrix login failed' }
    }
    if (-not (Test-Path -LiteralPath $env:HF_PEER_TRUST_FILE)) {
      & $node scripts/enroll-clean-vps.mjs (Join-Path $app 'enrollment.json')
      if ($LASTEXITCODE -ne 0) { throw 'VPN enrollment failed; retry the same package' }
    }
  } finally { Pop-Location }
  Remove-Item -LiteralPath (Join-Path $state 'stop') -ErrorAction SilentlyContinue
  foreach ($name in @('frontend.ready','frontend.error')) { Remove-Item -LiteralPath (Join-Path $state $name) -ErrorAction SilentlyContinue }
  $transportArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $app 'scripts\run-matrix-vpn-transport.ps1')+'"'),'-StateRoot',('"'+$state+'"'))
  $transport = Start-Process powershell.exe -ArgumentList $transportArgs -WindowStyle Hidden -PassThru
  Write-Host 'Connecting Matrix VPN. Status: http://127.0.0.1:18864/'
  $deadline = (Get-Date).AddMinutes(6)
  $ready = $false
  do {
    Start-Sleep -Seconds 2
    if ($transport.HasExited) { throw ('Transport exited: inspect '+$state+'\stderr.log') }
    try { $status = Invoke-RestMethod 'http://127.0.0.1:18864/status' -TimeoutSec 2; $ready = $status.report.local.rtc -eq $true } catch {}
  } until ($ready -or (Get-Date) -gt $deadline)
  if (-not $ready) { throw 'Matrix transport did not connect; no TUN was started. Stop-VPN.cmd stops retries.' }
  $frontendArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $app 'scripts\run-matrix-vpn-frontend.ps1')+'"'),'-StateRoot',('"'+$state+'"'))
  if ($TestTransport) { $frontendArgs += '-TestTransport'; $frontend = Start-Process powershell.exe -ArgumentList $frontendArgs -WindowStyle Hidden -PassThru }
  else { $frontend = Start-Process powershell.exe -Verb RunAs -ArgumentList $frontendArgs -WindowStyle Hidden -PassThru }
  $deadline = (Get-Date).AddSeconds(30)
  while (-not (Test-Path -LiteralPath (Join-Path $state 'frontend.ready'))) {
    if (Test-Path -LiteralPath (Join-Path $state 'frontend.error')) { throw (Get-Content -LiteralPath (Join-Path $state 'frontend.error') -Raw) }
    if ($frontend.HasExited -or (Get-Date) -gt $deadline) { throw 'VPN frontend did not start. Inspect frontend.error and tun.log.' }
    Start-Sleep -Seconds 1
  }
  Write-Host ('READY. Logs: '+$state)
  if ($TestTransport) { Write-Host 'TEST ONLY: proxy 127.0.0.1:18880; no TUN or system route changes.' }
  else { Write-Host 'HFPipeVPN is up. Run Check-VPN.cmd. Stop-VPN.cmd disconnects.' }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
