param([Parameter(Mandatory=$true)][string]$StateRoot, [switch]$TestTransport)
. (Join-Path $PSScriptRoot 'matrix-vpn-common.ps1')
$app = Split-Path -Parent $PSScriptRoot
$mutex = New-Object Threading.Mutex($false, ('Local\HFPipeMatrixVPNFrontend-' + $(if ($TestTransport) {'test'} else {'tun'})))
if (-not $mutex.WaitOne(0)) { throw 'This VPN frontend is already running' }
$binary = Join-Path $app 'vpn\sing-box.exe'
$config = Join-Path $StateRoot $(if ($TestTransport) {'frontend-test.json'} else {'tun.json'})
$frontend = $null
try {
  if (-not $TestTransport) {
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) { throw 'The TUN frontend requires administrator rights' }
    if (Get-NetAdapter -Name 'HFPipeVPN' -ErrorAction SilentlyContinue) { throw 'HFPipeVPN already exists; stop the previous VPN before reconnecting' }
  }
  & $binary check -c $config
  if ($LASTEXITCODE -ne 0) { throw 'Invalid sing-box configuration; no adapter was started' }
  $frontend = Start-Process -FilePath $binary -ArgumentList @('run','-c',('"'+$config+'"')) -WorkingDirectory (Split-Path -Parent $binary) -WindowStyle Hidden -PassThru
  Set-Content -LiteralPath (Join-Path $StateRoot 'frontend.pid') -Value $PID -Encoding ASCII
  Start-Sleep -Seconds 2
  if ($frontend.HasExited) { throw ('sing-box exited at startup: inspect '+$StateRoot+'\tun.log') }
  if (-not $TestTransport -and -not (Get-NetAdapter -Name HFPipeVPN -ErrorAction SilentlyContinue)) { throw 'HFPipeVPN adapter was not created' }
  Set-Content -LiteralPath (Join-Path $StateRoot 'frontend.ready') -Value 'ready' -Encoding ASCII
  while (-not $frontend.WaitForExit(1000)) {
    if (Test-Path -LiteralPath (Join-Path $StateRoot 'stop')) { break }
    $transportId = [int](Get-Content -LiteralPath (Join-Path $StateRoot 'transport.pid'))
    $transport = Get-CimInstance Win32_Process -Filter "ProcessId=$transportId"
    if (-not $transport -or $transport.CommandLine -notlike ('*'+$app+'*run-matrix-vpn-transport.ps1*')) { break }
  }
  if ($frontend.HasExited -and $frontend.ExitCode -ne 0) { throw ('sing-box exited: inspect '+$config.Replace('.json','.log')) }
} catch {
  $_.Exception.Message | Set-Content -LiteralPath (Join-Path $StateRoot 'frontend.error') -Encoding UTF8
  throw
} finally {
  if ($frontend -and -not $frontend.HasExited) { Stop-HfConsoleProcess $frontend }
  Remove-Item -LiteralPath (Join-Path $StateRoot 'frontend.pid') -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $StateRoot 'frontend.ready') -ErrorAction SilentlyContinue
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
