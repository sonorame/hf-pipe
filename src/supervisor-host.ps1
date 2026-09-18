param(
  [ValidateSet("dirty", "clean")]
  [string]$Side = "dirty",
  [string]$Root = $PSScriptRoot,
  [string]$StatusUrl = "http://127.0.0.1:18764/status",
  [string]$DetailsUrl = "http://127.0.0.1:18764/",
  [string]$TrayStateFile = ""
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

$jobHelper = Join-Path $PSScriptRoot "process-job.ps1"
if (-not (Test-Path -LiteralPath $jobHelper)) {
  $jobHelper = Join-Path $Root "process-job.ps1"
}
. $jobHelper

$env:HF_RUNTIME_ROOT = $Root
if (-not $env:HF_TEMP_KEEP_MS) { $env:HF_TEMP_KEEP_MS = "0" }
if (-not $env:HF_TEMP_SWEEP_MS) { $env:HF_TEMP_SWEEP_MS = "30000" }
$jobHandle = New-HfKillOnCloseJob

$loop = [powershell]::Create()
$loop.AddScript({
  param($node, $root, $side, $jobHandle)
  $ErrorActionPreference = "Stop"
  $env:HF_RUNTIME_ROOT = $root
  if (-not $env:HF_TEMP_KEEP_MS) { $env:HF_TEMP_KEEP_MS = "0" }
  if (-not $env:HF_TEMP_SWEEP_MS) { $env:HF_TEMP_SWEEP_MS = "30000" }
  $bootstrap = Join-Path $root "bootstrap.mjs"
  for (;;) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $node
    $psi.Arguments = ('"{0}" {1}' -f $bootstrap, $side)
    $psi.WorkingDirectory = $root
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    [void]$process.Start()
    try {
      [HfProcessJob]::Assign($jobHandle, $process.Handle)
    } catch {
      $process.Kill()
      throw
    }
    $process.WaitForExit()
    Add-Content -LiteralPath (Join-Path $root "supervisor-host.log") `
      -Value "$([DateTime]::UtcNow.ToString('o')) bootstrap exited $($process.ExitCode)"
    Start-Sleep -Seconds 4
  }
}).AddArgument($node).AddArgument($Root).AddArgument($Side).AddArgument($jobHandle) | Out-Null
[void]$loop.BeginInvoke()

$tray = Join-Path $PSScriptRoot "tray-viewer.ps1"
if (-not (Test-Path -LiteralPath $tray)) {
  $tray = Join-Path $Root "tray-viewer.ps1"
}
$trayStatusUrl = $StatusUrl
$trayDetailsUrl = $DetailsUrl
$trayStateFile = $TrayStateFile
. $tray
Start-HfTray -StatusUrl $trayStatusUrl -DetailsUrl $trayDetailsUrl -StateFile $trayStateFile
