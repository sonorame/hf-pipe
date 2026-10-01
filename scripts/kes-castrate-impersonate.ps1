# Spawn powershell.exe as local Administrator and run kes-castrate-trusted.ps1.
param(
  [Parameter(Mandatory = $true)]
  [string]$Action,
  [string]$SinceLocal = "",
  [string]$User = "Administrator",
  [string]$Domain = "."
)

$ErrorActionPreference = "Stop"
$pass = $env:HF_LOCAL_ADMIN_PASS
if ([string]::IsNullOrEmpty($pass)) { throw "HF_LOCAL_ADMIN_PASS required" }

$inner = [System.IO.Path]::Combine($PSScriptRoot, "kes-castrate-trusted.ps1")
if (-not [System.IO.File]::Exists($inner)) { throw "missing $inner" }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"

# Build args; pass KES password as parameter (child user env is not inherited).
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append("-NoProfile -ExecutionPolicy Bypass -File ")
[void]$sb.Append('"')
[void]$sb.Append($inner)
[void]$sb.Append('" -Action ')
[void]$sb.Append($Action)
if ($SinceLocal) {
  [void]$sb.Append(' -SinceLocal "')
  [void]$sb.Append($SinceLocal)
  [void]$sb.Append('"')
}
if ($env:HF_KES_PASSWORD) {
  # Single-quote PowerShell literal; escape embedded single quotes.
  $lit = $env:HF_KES_PASSWORD.Replace("'", "''")
  [void]$sb.Append(" -KesPassword '")
  [void]$sb.Append($lit)
  [void]$sb.Append("'")
}
$psi.Arguments = $sb.ToString()
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$psi.UserName = $User
$psi.Domain = $Domain
$psi.Password = (ConvertTo-SecureString $pass -AsPlainText -Force)
$psi.LoadUserProfile = $true
$psi.WorkingDirectory = [System.IO.Path]::GetDirectoryName($inner)

$proc = [System.Diagnostics.Process]::Start($psi)
$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit(180000) | Out-Null
Write-Output ("proc_exit=" + $proc.ExitCode)
if ($stdout) { Write-Output $stdout }
if ($stderr) { Write-Output ("STDERR=" + $stderr) }
exit $proc.ExitCode
