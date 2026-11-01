param([switch]$TestTransport)
$ErrorActionPreference = 'Stop'
$state = Join-Path $env:USERPROFILE $(if ($TestTransport) {'.hf-pipe\matrix-vpn-test'} else {'.hf-pipe\matrix-vpn'})
$status = Invoke-RestMethod 'http://127.0.0.1:18864/status' -TimeoutSec 5
if ($status.report.local.rtc -ne $true) { throw 'Matrix datachannel is not connected yet: http://127.0.0.1:18864/' }
if (-not $TestTransport) {
  $adapter = Get-NetAdapter -Name HFPipeVPN -ErrorAction Stop
  if ($adapter.Status -ne 'Up') { throw 'HFPipeVPN adapter is not up' }
}
$proxyArgs = @('--noproxy','*')
if ($TestTransport) { $proxyArgs = @('--proxy','http://127.0.0.1:18880') }
$address = & curl.exe @proxyArgs --silent --show-error --fail --connect-timeout 30 --max-time 90 https://api.ipify.org
if ($LASTEXITCODE -ne 0) { throw 'Internet test failed through Matrix VPN' }
$bundle = Get-Content -LiteralPath (Join-Path $state 'app\enrollment.json') -Raw | ConvertFrom-Json
if ($address.Trim() -ne $bundle.expectedEgressIpv4) { throw ('Unexpected Internet exit: '+$address+'; expected '+$bundle.expectedEgressIpv4) }
Write-Host ('OK: Internet exits through VPS '+$address)
& curl.exe @proxyArgs --silent --show-error --fail --connect-timeout 30 --max-time 90 --output NUL https://telegram.org/
if ($LASTEXITCODE -ne 0) { throw 'Telegram website test failed' }
Write-Host 'OK: Telegram HTTPS is reachable. Open Codex and request HF_PIPE_OK to check your account.'
