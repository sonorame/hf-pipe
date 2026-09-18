param(
  [ValidateSet("dirty", "clean")]
  [string]$Side = "dirty",
  [string]$Root = $PSScriptRoot,
  [string]$StatusUrl = "http://127.0.0.1:18764/status",
  [string]$DetailsUrl = "http://127.0.0.1:18764/",
  [string]$TrayStateFile = ""
)

$ErrorActionPreference = "Stop"
$launcherRoot = $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $launcherRoot "supervisor-host.ps1"))) {
  $launcherRoot = $Root
}
$supervisor = Join-Path $launcherRoot "supervisor-host.ps1"
$jobHelper = Join-Path $launcherRoot "process-job.ps1"
if (-not (Test-Path -LiteralPath $supervisor)) { throw "missing $supervisor" }
if (-not (Test-Path -LiteralPath $jobHelper)) { throw "missing $jobHelper" }
. $jobHelper

$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$jobHandle = New-HfKillOnCloseJob

for (;;) {
  $arguments = @(
    "-NoProfile",
    "-STA",
    "-WindowStyle",
    "Hidden",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "`"$supervisor`"",
    "-Side",
    $Side,
    "-Root",
    "`"$Root`"",
    "-StatusUrl",
    "`"$StatusUrl`"",
    "-DetailsUrl",
    "`"$DetailsUrl`""
  )
  if (-not [string]::IsNullOrWhiteSpace($TrayStateFile)) {
    $arguments += @("-TrayStateFile", "`"$TrayStateFile`"")
  }

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $powershell
  $psi.Arguments = $arguments -join " "
  $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi
  [void]$process.Start()
  try {
    Add-HfProcessToJob -Job $jobHandle -Process $process
  } catch {
    $process.Kill()
    throw
  }
  $process.WaitForExit()
  Add-Content -LiteralPath (Join-Path $Root "task-host.log") `
    -Value "$([DateTime]::UtcNow.ToString('o')) supervisor exited $($process.ExitCode)"
  Start-Sleep -Seconds 4
}
