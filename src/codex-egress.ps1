param([switch]$InstallExtension, [switch]$Launch)
$ErrorActionPreference = 'Stop'
$proxy = 'http://127.0.0.1:18766'
$code = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\Code.exe'
if (-not (Test-Path -LiteralPath $code)) { throw 'VS Code is not installed' }
$data = Join-Path $env:USERPROFILE '.hf-pipe\vscode-codex'
New-Item -ItemType Directory -Force -Path (Join-Path $data 'User') | Out-Null
$settingsPath = Join-Path $data 'User\settings.json'
if (-not (Test-Path -LiteralPath $settingsPath)) {
  $original = Join-Path $env:APPDATA 'Code\User\settings.json'
  if (Test-Path -LiteralPath $original) { Copy-Item -LiteralPath $original -Destination $settingsPath }
  else { '{}' | Set-Content -LiteralPath $settingsPath -Encoding UTF8 }
}
$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
$values = @{'http.proxy'=$proxy; 'http.proxySupport'='override'; 'http.proxyStrictSSL'=$true; 'chatgpt.runCodexInWindowsSubsystemForLinux'=$false}
foreach ($key in $values.Keys) { $settings | Add-Member -NotePropertyName $key -NotePropertyValue $values[$key] -Force }
$settings | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $settingsPath -Encoding UTF8
# Scope proxy variables to this VS Code instance and its Codex child process.
$env:HTTP_PROXY = $proxy
$env:HTTPS_PROXY = $proxy
$env:ALL_PROXY = $proxy
$env:NO_PROXY = 'localhost,127.0.0.1,::1'
$args = @('--user-data-dir', $data, '--proxy-server='+$proxy)
if ($InstallExtension) {
  $cli = Join-Path (Split-Path $code) 'bin\code.cmd'
  & $cli --user-data-dir $data --install-extension openai.chatgpt
  if ($LASTEXITCODE -ne 0) { throw 'Codex extension install failed' }
}
$scriptPath = $PSCommandPath
$shortcutPath = Join-Path $env:USERPROFILE 'Desktop\Codex (hf-pipe).lnk'
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "'+$scriptPath+'" -Launch'
$shortcut.WorkingDirectory = $env:USERPROFILE
$shortcut.WindowStyle = 7
$shortcut.IconLocation = $code+',0'
$shortcut.Save()
if ($Launch) { Start-Process -FilePath $code -ArgumentList @('--user-data-dir', ('"'+$data+'"'), ('--proxy-server='+$proxy), '--new-window') -WindowStyle Hidden }
Write-Output ('Codex profile: '+$data+'; proxy: '+$proxy)
