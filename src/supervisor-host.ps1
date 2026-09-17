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
for (;;) {
  $process = Start-Process -FilePath $node `
    -ArgumentList @((Join-Path $Root "bootstrap.mjs"), $Side) `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -PassThru `
    -Wait
  Add-Content -LiteralPath (Join-Path $Root "supervisor-host.log") `
    -Value "$([DateTime]::UtcNow.ToString('o')) bootstrap exited $($process.ExitCode)"
  Start-Sleep -Seconds 4
}
