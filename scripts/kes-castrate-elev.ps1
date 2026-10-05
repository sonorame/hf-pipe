# One-shot elevated runner. Password only via env HF_LOCAL_ADMIN_PASS (never commit).
# Usage: set env, then powershell -File scripts/kes-castrate-elev.ps1 -Action stop-bd
param(
  [Parameter(Mandatory = $true)]
  [string]$Action,
  [string]$User = ".\Administrator",
  [string]$SinceLocal = ""
)

$ErrorActionPreference = "Stop"
$passPlain = $env:HF_LOCAL_ADMIN_PASS
if ([string]::IsNullOrEmpty($passPlain)) {
  throw "Set HF_LOCAL_ADMIN_PASS for elevated run (not stored in repo)."
}

$repo = Split-Path -Parent $PSScriptRoot
if (-not $repo) { $repo = (Get-Location).Path }
$inner = Join-Path $PSScriptRoot "kes-castrate-trusted.ps1"
$outLog = Join-Path $env:TEMP ("kes-castrate-" + $Action + "-" + [guid]::NewGuid().ToString("n") + ".txt")

$argList = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", $inner,
  "-Action", $Action
)
if ($SinceLocal) {
  $argList += @("-SinceLocal", $SinceLocal)
}

$wrapper = @"
`$ErrorActionPreference = 'Continue'
`$log = '$outLog'
try {
  & '$inner' -Action '$Action'$(if ($SinceLocal) { " -SinceLocal '$SinceLocal'" } else { "" }) *>&1 |
    ForEach-Object { `$_ } |
    Out-File -FilePath `$log -Encoding utf8
  'WRAPPER_EXIT=' + `$LASTEXITCODE | Out-File -FilePath `$log -Append -Encoding utf8
} catch {
  \$_ | Out-File -FilePath `$log -Encoding utf8
  'WRAPPER_FAIL' | Out-File -FilePath `$log -Append -Encoding utf8
}
"@

$wrapPath = Join-Path $env:TEMP ("kes-wrap-" + [guid]::NewGuid().ToString("n") + ".ps1")
Set-Content -LiteralPath $wrapPath -Value $wrapper -Encoding UTF8

$secure = ConvertTo-SecureString $passPlain -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential ($User, $secure)

$p = Start-Process -FilePath "powershell.exe" `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $wrapPath) `
  -Credential $cred `
  -Wait -PassThru -WindowStyle Hidden

Start-Sleep -Milliseconds 400
Write-Output ("proc_exit=" + $p.ExitCode)
Write-Output ("log=" + $outLog)
if (Test-Path -LiteralPath $outLog) {
  Get-Content -LiteralPath $outLog -Raw
} else {
  Write-Output "LOG_MISSING"
}

Remove-Item -LiteralPath $wrapPath -Force -ErrorAction SilentlyContinue
