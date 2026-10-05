# Schedule one elevated task as local Administrator, run once, capture log.
param(
  [Parameter(Mandatory = $true)]
  [string]$Action,
  [string]$SinceLocal = "",
  [string]$TaskName = "HFPipe-KES-Castrate-Once"
)

$ErrorActionPreference = "Stop"
$pass = $env:HF_LOCAL_ADMIN_PASS
if ([string]::IsNullOrEmpty($pass)) { throw "HF_LOCAL_ADMIN_PASS required" }

$inner = Join-Path $PSScriptRoot "kes-castrate-trusted.ps1"
$log = Join-Path $env:TEMP ("kes-task-" + $Action + ".txt")
$runner = Join-Path $env:TEMP ("kes-task-runner-" + $Action + ".ps1")

$sinceLine = ""
if ($SinceLocal) {
  $sinceLine = " -SinceLocal '" + $SinceLocal.Replace("'", "''") + "'"
}

$runnerBody = @"
`$ErrorActionPreference = 'Continue'
`$log = '$($log.Replace("'", "''"))'
`$inner = '$($inner.Replace("'", "''"))'
& `$inner -Action '$Action'$sinceLine *>&1 | Out-File -FilePath `$log -Encoding utf8
('EXIT=' + `$LASTEXITCODE) | Out-File -FilePath `$log -Append -Encoding utf8
"@
Set-Content -LiteralPath $runner -Value $runnerBody -Encoding UTF8

cmd.exe /c "schtasks /Delete /TN `"$TaskName`" /F >nul 2>&1"

$tr = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$runner`""
$create = cmd.exe /c "schtasks /Create /TN `"$TaskName`" /TR `"$tr`" /SC ONCE /ST 23:59 /RU Administrator /RP `"$pass`" /RL HIGHEST /F"
Write-Output ("create=" + $create)
if ($create -notmatch "SUCCESS") {
  throw "schtasks create failed: $create"
}

$run = cmd.exe /c "schtasks /Run /TN `"$TaskName`""
Write-Output ("run=" + $run)

$deadline = (Get-Date).AddSeconds(90)
do {
  Start-Sleep -Seconds 2
  if (Test-Path -LiteralPath $log) {
    $content = Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue
    if ($content -match "EXIT=") { break }
  }
} while ((Get-Date) -lt $deadline)

Write-Output ("log=" + $log)
if (Test-Path -LiteralPath $log) {
  Get-Content -LiteralPath $log -Raw
} else {
  Write-Output "LOG_MISSING"
}

cmd.exe /c "schtasks /Delete /TN `"$TaskName`" /F >nul 2>&1"
Remove-Item -LiteralPath $runner -Force -ErrorAction SilentlyContinue
