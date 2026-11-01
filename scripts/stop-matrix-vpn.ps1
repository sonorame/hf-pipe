param([switch]$TestTransport)
$ErrorActionPreference = 'Stop'
$state = Join-Path $env:USERPROFILE $(if ($TestTransport) {'.hf-pipe\matrix-vpn-test'} else {'.hf-pipe\matrix-vpn'})
if (-not (Test-Path -LiteralPath $state)) { Write-Host 'Matrix VPN is not installed'; exit }
Set-Content -LiteralPath (Join-Path $state 'stop') -Value 'stop' -Encoding ASCII
$deadline = (Get-Date).AddSeconds(25)
while ((Test-Path -LiteralPath (Join-Path $state 'frontend.pid')) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
if ((Test-Path -LiteralPath (Join-Path $state 'frontend.pid')) -or (-not $TestTransport -and (Get-NetAdapter -Name HFPipeVPN -ErrorAction SilentlyContinue))) {
  throw 'VPN cleanup is incomplete: inspect tun.log. No other adapters or VPN services were changed.'
}
if ($TestTransport) { Write-Host 'Test frontend and transport stopped; no system routes were changed.' }
else { Write-Host 'Matrix VPN disconnected; its TUN routes were released.' }
