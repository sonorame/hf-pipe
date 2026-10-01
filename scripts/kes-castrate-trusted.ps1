#Requires -Version 5.1
<#
.SYNOPSIS
  KES castrate helpers: STOP/START BehaviorDetection/HipsTask, STATUS, event smoke check.
  Trusted applications: UI only (avp.com has no TRUSTED CLI). Do not IMPORT settings.dat.

.EXAMPLE
  .\kes-castrate-trusted.ps1 -Action status
  .\kes-castrate-trusted.ps1 -Action stop-bd
  .\kes-castrate-trusted.ps1 -Action stop-hips
  .\kes-castrate-trusted.ps1 -Action smoke-check -SinceLocal '2026-09-30T14:00:00'
  .\kes-castrate-trusted.ps1 -Action undo

Trusted UI checklist (Do not monitor application activity):
  1) C:\Users\Malykh_Kirill\AppData\Local\Programs\cursor\Cursor.exe
  2) C:\Program Files\nodejs\node.exe
  3) C:\Users\Malykh_Kirill\AppData\Local\Programs\cursor\resources\app\resources\helpers\node.exe
  Do NOT add: powershell.exe, cursor-agent\versions\*, *.vbs, Programs\cursor\_\*
#>
param(
  [ValidateSet("status", "stop-bd", "stop-hips", "start-bd", "start-hips", "smoke-check", "undo", "help-stop")]
  [string]$Action = "status",
  [string]$AvpPath = "C:\Program Files (x86)\Kaspersky Lab\KES.12.9.0\avp.com",
  [string]$SinceLocal = "",
  [string]$KesPassword = ""
)

$ErrorActionPreference = "Stop"

function Get-Avp {
  if (-not (Test-Path -LiteralPath $AvpPath)) {
    throw "avp.com not found: $AvpPath"
  }
  return (Resolve-Path -LiteralPath $AvpPath).Path
}

function Invoke-Avp {
  param([Parameter(Mandatory = $true)][string[]]$AvpArgs)
  $avp = Get-Avp
  $dir = Split-Path -Parent $avp
  $pwd = $KesPassword
  if (-not $pwd) { $pwd = $env:HF_KES_PASSWORD }
  $login = $env:HF_KES_LOGIN
  if (-not $login) { $login = "KLAdmin" }
  if ($pwd -and ($AvpArgs[0] -match '^(STOP|START)$')) {
    $AvpArgs = @($AvpArgs) + @("/login=$login", "/password=$pwd")
  }
  Push-Location $dir
  try {
    $out = & $avp @AvpArgs 2>&1
    $code = $LASTEXITCODE
    return [pscustomobject]@{
      ExitCode = $code
      Output   = @($out | ForEach-Object { "$_" })
    }
  } finally {
    Pop-Location
  }
}

function Write-Result {
  param($Result)
  foreach ($line in $Result.Output) { Write-Output $line }
  if ($null -ne $Result.ExitCode) {
    Write-Output ("EXIT=" + $Result.ExitCode)
  }
}

function Get-KesEventsSince {
  param([datetime]$Since)
  $ids = 4662, 501
  try {
    $ev = Get-WinEvent -FilterHashtable @{
      LogName   = "Kaspersky Endpoint Security"
      Id        = $ids
      StartTime = $Since
    } -ErrorAction SilentlyContinue
  } catch {
    $ev = @()
  }
  return @($ev)
}

switch ($Action) {
  "help-stop" {
    Write-Result (Invoke-Avp -AvpArgs @("HELP", "STOP"))
  }
  "status" {
    Write-Result (Invoke-Avp -AvpArgs @("STATUS"))
  }
  "stop-bd" {
    Write-Result (Invoke-Avp -AvpArgs @("STOP", "BehaviorDetection"))
  }
  "stop-hips" {
    Write-Result (Invoke-Avp -AvpArgs @("STOP", "HipsTask"))
  }
  "start-bd" {
    Write-Result (Invoke-Avp -AvpArgs @("START", "BehaviorDetection"))
  }
  "start-hips" {
    Write-Result (Invoke-Avp -AvpArgs @("START", "HipsTask"))
  }
  "undo" {
    Write-Output "=== START BehaviorDetection ==="
    Write-Result (Invoke-Avp -AvpArgs @("START", "BehaviorDetection"))
    Write-Output "=== START HipsTask ==="
    Write-Result (Invoke-Avp -AvpArgs @("START", "HipsTask"))
    Write-Output "=== STATUS ==="
    Write-Result (Invoke-Avp -AvpArgs @("STATUS"))
    Write-Output "NOTE: remove trusted EXE from KES UI manually (script cannot)."
  }
  "smoke-check" {
    if (-not $SinceLocal) {
      throw "smoke-check requires -SinceLocal (local datetime string)"
    }
    $since = [datetime]::Parse($SinceLocal)
    $ev = Get-KesEventsSince -Since $since
    Write-Output ("since=" + $since.ToString("s"))
    Write-Output ("count=" + $ev.Count)
    foreach ($e in $ev) {
      $msg = ($e.Message -replace "\r?\n", " | ")
      if ($msg.Length -gt 400) { $msg = $msg.Substring(0, 400) }
      Write-Output ("---")
      Write-Output ("time=" + $e.TimeCreated.ToString("s") + " id=" + $e.Id)
      Write-Output $msg
    }
    if ($ev.Count -eq 0) {
      Write-Output "ok smoke-check no new 4662/501"
    } else {
      Write-Output "FAIL smoke-check new KES events"
      exit 2
    }
  }
}
