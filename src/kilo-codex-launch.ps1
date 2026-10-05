param([switch]$Launch)
$ErrorActionPreference = 'Stop'
$proxy = 'http://127.0.0.1:18766'
$code = Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\Code.exe'
$data = Join-Path $env:USERPROFILE '.hf-pipe\vscode-kilo-codex'
New-Item -ItemType Directory -Force -Path (Join-Path $data 'User') | Out-Null
$settingsPath = Join-Path $data 'User\settings.json'
if (-not (Test-Path -LiteralPath $settingsPath)) {
  $original = Join-Path $env:APPDATA 'Code\User\settings.json'
  if (Test-Path -LiteralPath $original) { Copy-Item -LiteralPath $original -Destination $settingsPath }
  else { '{}' | Set-Content -LiteralPath $settingsPath -Encoding UTF8 }
}
$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
$values = @{'http.proxy'=$proxy; 'http.proxySupport'='override'; 'http.proxyStrictSSL'=$true; 'http.noProxy'=@('localhost','127.0.0.1','::1'); 'kilo-code.new.model.providerID'='openai'; 'kilo-code.new.model.modelID'='gpt-6-astra'; 'extensions.autoUpdate'=$false; 'extensions.autoCheckUpdates'=$false; 'update.mode'='none'}
$caBundle = Join-Path $env:USERPROFILE '.hf-pipe\kilo-codex-ca.pem'
if (Test-Path -LiteralPath $caBundle) { $values['kilo-code.new.extraCaCerts'] = $caBundle; $env:NODE_EXTRA_CA_CERTS = $caBundle }
foreach ($key in $values.Keys) { $settings | Add-Member -NotePropertyName $key -NotePropertyValue $values[$key] -Force }
$settings | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $settingsPath -Encoding UTF8
$env:HTTP_PROXY = $proxy
$env:HTTPS_PROXY = $proxy
$env:ALL_PROXY = $proxy
$env:NO_PROXY = 'localhost,127.0.0.1,::1'
$env:KILO_CONFIG_CONTENT = '{"model":"openai/gpt-6-astra","default_agent":"build","provider":{"openai":{"models":{"gpt-6-astra":{"name":"GPT-6 Astra","tool_call":true,"reasoning":true,"temperature":false,"attachment":true,"modalities":{"input":["text","image"],"output":["text"]},"limit":{"context":1050000,"output":128000},"options":{"reasoningEffort":"medium"}},"gpt-6.1-sol":{"name":"GPT-6.1 Sol","tool_call":true,"reasoning":true,"temperature":false,"attachment":true,"modalities":{"input":["text","image"],"output":["text"]},"limit":{"context":1050000,"output":128000},"options":{"reasoningEffort":"medium"}},"gpt-6-luna":{"name":"GPT-6 Luna","tool_call":true,"reasoning":true,"temperature":false,"attachment":true,"modalities":{"input":["text","image"],"output":["text"]},"limit":{"context":1050000,"output":128000},"options":{"reasoningEffort":"medium"}}}}}}'
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $env:USERPROFILE 'Desktop\Kilo Codex (hf-pipe).lnk'))
$shortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Launch'
$shortcut.WorkingDirectory = $env:USERPROFILE
$shortcut.WindowStyle = 7
$shortcut.IconLocation = $code+',0'
$shortcut.Save()
if ($Launch) { Start-Process -FilePath $code -ArgumentList @('--user-data-dir', ('"'+$data+'"'), ('--proxy-server='+$proxy), '--new-window') -WindowStyle Hidden }
Write-Output ('Kilo Codex profile: '+$data+'; proxy: '+$proxy)

