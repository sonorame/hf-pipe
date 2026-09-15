param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string]$Dir
)
$Dir = $Dir.Trim().Trim('"').TrimEnd("\", "/")
$vbs = Join-Path $Dir "watchdog.vbs"
if (-not (Test-Path -LiteralPath $vbs)) { throw "missing $vbs" }
$startup = [Environment]::GetFolderPath("Startup")
$lnkPath = Join-Path $startup "$Name.lnk"
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$lnk.Arguments = "//nologo `"$vbs`""
$lnk.WorkingDirectory = $Dir
$lnk.WindowStyle = 7
$lnk.Save()
Write-Output $lnkPath
