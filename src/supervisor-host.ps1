param(
  [ValidateSet("dirty", "clean")]
  [string]$Side = "dirty",
  [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath (Join-Path $Root "bootstrap.mjs"))) {
  $Root = Split-Path -Parent $PSScriptRoot
}

$node = Join-Path $Root "node.exe"
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
  $node = "C:\Program Files\nodejs\node.exe"
}
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
}

$env:HF_RUNTIME_ROOT = $Root
if (-not $env:HF_TEMP_KEEP_MS) { $env:HF_TEMP_KEEP_MS = "0" }
if (-not $env:HF_TEMP_SWEEP_MS) { $env:HF_TEMP_SWEEP_MS = "30000" }

$loop = [powershell]::Create()
$loop.AddScript({
  param($node, $root, $side)
  $ErrorActionPreference = "Stop"
  $env:HF_RUNTIME_ROOT = $root
  if (-not $env:HF_TEMP_KEEP_MS) { $env:HF_TEMP_KEEP_MS = "0" }
  if (-not $env:HF_TEMP_SWEEP_MS) { $env:HF_TEMP_SWEEP_MS = "30000" }
  for (;;) {
    $process = Start-Process -FilePath $node `
      -ArgumentList @((Join-Path $root "bootstrap.mjs"), $side) `
      -WorkingDirectory $root `
      -WindowStyle Hidden `
      -PassThru `
      -Wait
    Add-Content -LiteralPath (Join-Path $root "supervisor-host.log") `
      -Value "$([DateTime]::UtcNow.ToString('o')) bootstrap exited $($process.ExitCode)"
    Start-Sleep -Seconds 4
  }
}).AddArgument($node).AddArgument($Root).AddArgument($Side) | Out-Null
[void]$loop.BeginInvoke()

$tray = Join-Path $PSScriptRoot "tray-viewer.ps1"
if (-not (Test-Path -LiteralPath $tray)) {
  $tray = Join-Path $Root "tray-viewer.ps1"
}
. $tray
Start-HfTray
