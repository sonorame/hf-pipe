param(
  [Parameter(Mandatory=$true)][string]$RuntimeDirectory,
  [Parameter(Mandatory=$true)][string]$EnrollmentFile,
  [Parameter(Mandatory=$true)][string]$SingBoxDirectory,
  [Parameter(Mandatory=$true)][string]$WintunDirectory,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Choose a new empty output directory; existing packages are never overwritten' }
$bundle = Get-Content -LiteralPath $EnrollmentFile -Raw | ConvertFrom-Json
if (-not $bundle.token -or $bundle.expiresAt -le [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -or -not $bundle.expectedEgressIpv4) { throw 'A fresh VPN enrollment capability with expectedEgressIpv4 is required' }
$version = & (Join-Path $SingBoxDirectory 'sing-box.exe') version
if ($version[0] -ne 'sing-box version 1.14.4') { throw 'Use the verified sing-box 1.14.4 Windows amd64 distribution' }
$wintun = Join-Path $WintunDirectory 'bin\amd64\wintun.dll'
$signature = Get-AuthenticodeSignature -FilePath $wintun
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*WireGuard LLC*') { throw 'Use the original signed Wintun DLL' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
foreach ($name in @('src','scripts','dist')) {
  & robocopy.exe (Join-Path $root $name) (Join-Path $OutputDirectory $name) /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -gt 7) { throw ('Cannot copy '+$name) }
}
& robocopy.exe (Join-Path $RuntimeDirectory 'node_modules') (Join-Path $OutputDirectory 'node_modules') /E /MT:16 /R:1 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -gt 7) { throw 'Cannot copy production dependencies' }
Copy-Item -LiteralPath (Join-Path $RuntimeDirectory 'node.exe') -Destination $OutputDirectory
foreach ($name in @('package.json','package-lock.json')) { Copy-Item -LiteralPath (Join-Path $root $name) -Destination $OutputDirectory }
Copy-Item -LiteralPath $EnrollmentFile -Destination (Join-Path $OutputDirectory 'enrollment.json')
Copy-Item -Path (Join-Path $root 'matrix-vpn\*.cmd') -Destination $OutputDirectory
Copy-Item -LiteralPath (Join-Path $root 'matrix-vpn\START-HERE.txt') -Destination $OutputDirectory
Copy-Item -LiteralPath (Join-Path $root 'docs\matrix-vpn.md') -Destination (Join-Path $OutputDirectory 'README.md')
$vpn = Join-Path $OutputDirectory 'vpn'
New-Item -ItemType Directory -Path $vpn -Force | Out-Null
foreach ($name in @('sing-box.exe','libcronet.dll','LICENSE')) { Copy-Item -LiteralPath (Join-Path $SingBoxDirectory $name) -Destination $vpn }
Copy-Item -LiteralPath $wintun -Destination $vpn
Copy-Item -LiteralPath (Join-Path $WintunDirectory 'LICENSE.txt') -Destination (Join-Path $vpn 'WINTUN-LICENSE.txt')
Write-Host ('Offline package staged: '+$OutputDirectory)
