#Requires -Version 5.1
<#
.SYNOPSIS
  Read-only KES capture for remission fixtures. HELP STOP and STATUS only.
  Does not send STOP, START, EXIT, or IMPORT.
#>
param(
  [string]$AvpPath = "C:\Program Files (x86)\Kaspersky Lab\KES.12.9.0\avp.com",
  [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AvpPath)) {
  throw "avp.com not found: $AvpPath"
}

$avp = (Resolve-Path -LiteralPath $AvpPath).Path
$dir = Split-Path -Parent $avp
if (-not $OutDir) {
  $OutDir = Join-Path $PSScriptRoot "..\tests\fixtures\kes"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Save-Avp {
  param([string]$Name, [string[]]$AvpArgs)
  Push-Location $dir
  try {
    $out = & $avp @AvpArgs 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  $text = (($out -join "`n") + "`nEXIT=" + $code + "`n")
  $path = Join-Path $OutDir $Name
  Set-Content -LiteralPath $path -Value $text -Encoding utf8
  Write-Output ("wrote " + $path + " EXIT=" + $code)
}

Save-Avp -Name "help-stop.txt" -AvpArgs @("HELP", "STOP")
Save-Avp -Name "status.txt" -AvpArgs @("STATUS")
