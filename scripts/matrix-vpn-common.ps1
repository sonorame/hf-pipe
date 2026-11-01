$ErrorActionPreference = 'Stop'
function Import-HfVpnEnvironment([string]$StateRoot) {
  $env:HF_ENV_FILE = Join-Path $StateRoot 'vpn.env'
  foreach ($line in (Get-Content -LiteralPath $env:HF_ENV_FILE)) {
    if ($line -match '^([A-Z_][A-Z_0-9]*)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
  }
}
function Stop-HfConsoleProcess([System.Diagnostics.Process]$Process) {
  if ($Process.HasExited) { return }
  if (-not ('HfVpnConsole' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HfVpnConsole {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint signal, uint group);
}
'@
  }
  # sing-box is deliberately started in its own console: Ctrl+C runs its TUN cleanup.
  [void][HfVpnConsole]::FreeConsole()
  if (-not [HfVpnConsole]::AttachConsole([uint32]$Process.Id)) { throw 'Cannot attach to the VPN console; adapter was not forcefully removed' }
  try {
    [void][HfVpnConsole]::SetConsoleCtrlHandler([IntPtr]::Zero, $true)
    if (-not [HfVpnConsole]::GenerateConsoleCtrlEvent(0, 0)) { throw 'Cannot send the VPN shutdown signal' }
    if (-not $Process.WaitForExit(15000)) { throw 'VPN did not exit gracefully; inspect tun.log before reconnecting' }
  } finally { [void][HfVpnConsole]::FreeConsole() }
}
