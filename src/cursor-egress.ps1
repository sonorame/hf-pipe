param(
  [ValidateSet("install", "uninstall")]
  [string]$Mode = "install",
  [Parameter(Mandatory = $true)]
  [string]$CursorExe
)

$ErrorActionPreference = "Stop"
$names = @(
  "HFPipe-Cursor-allow-loopback",
  "HFPipe-Cursor-block-out-v4",
  "HFPipe-Cursor-block-out-v6"
)

function Remove-HfCursorRules {
  foreach ($name in $names) {
    Remove-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
  }
}

if ($Mode -eq "uninstall") {
  Remove-HfCursorRules
  Write-Output "ok firewall removed"
  exit 0
}

if (-not (Test-Path -LiteralPath $CursorExe)) {
  throw "Cursor.exe not found: $CursorExe"
}

Remove-HfCursorRules
try {
  New-NetFirewallRule -Name "HFPipe-Cursor-allow-loopback" -DisplayName "HFPipe Cursor loopback" -Direction Outbound -Action Allow -Program $CursorExe -RemoteAddress "127.0.0.0/8" -Protocol TCP | Out-Null
  New-NetFirewallRule -Name "HFPipe-Cursor-block-out-v4" -DisplayName "HFPipe Cursor block v4" -Direction Outbound -Action Block -Program $CursorExe -RemoteAddress @("0.0.0.0-126.255.255.255", "128.0.0.0-255.255.255.255") | Out-Null
  New-NetFirewallRule -Name "HFPipe-Cursor-block-out-v6" -DisplayName "HFPipe Cursor block v6" -Direction Outbound -Action Block -Program $CursorExe -RemoteAddress "::/0" | Out-Null
} catch {
  throw "Cursor firewall needs administrator: $($_.Exception.Message)"
}
Write-Output "ok firewall Cursor.exe"
