param(
  [string]$StatusUrl = "http://127.0.0.1:18764/status",
  [string]$DetailsUrl = "http://127.0.0.1:18764/",
  [string]$StateFile = ""
)

Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null

function Get-HfLocalFromStatus($status) {
  if ($null -eq $status) { return $null }
  if ($status.report -and $status.report.local) { return $status.report.local }
  if ($null -ne $status.rtc -or $null -ne $status.dc -or $null -ne $status.signaling) { return $status }
  if ($status.bootstrap) { return [pscustomobject]@{} }
  return $null
}

function Test-HfAssembling($local) {
  if ($null -eq $local) { return $false }
  if ($local.rtc) { return $false }
  $dc = [string]$local.dc
  $sig = [string]$local.signaling
  $conn = [string]$local.connection
  $ice = [string]$local.ice
  return ($dc -eq "connecting") -or ($sig -eq "have-local-offer") -or ($conn -eq "connecting") -or ($ice -eq "checking")
}

function Get-HfTrayView($status) {
  $local = Get-HfLocalFromStatus $status
  if ($null -eq $status -or ($null -eq $local -and -not $status.bootstrap)) {
    return [pscustomobject]@{
      Color = "gray"
      Headline = "Нет supervisor"
      Tooltip = "Supervisor недоступен."
      Menu = @([pscustomobject]@{ Label = "Подробности"; Action = "details" })
    }
  }
  $rtc = [bool]$local.rtc
  $color = "red"
  $headline = "Нет трубы"
  $tooltip = "Трубы нет."
  $assembling = (Test-HfAssembling $local) -or (($null -eq $status.report) -and $status.bootstrap)
  if ($rtc) {
    $color = "green"
    $headline = "Жива"
    $tooltip = "Труба жива."
    $age = $local.pongAgeMs
    if ($null -ne $age) {
      $sec = [Math]::Max(0, [Math]::Round([double]$age / 1000))
      $tooltip = "Труба жива. Пульс $sec с назад."
    }
  } elseif ($assembling) {
    $color = "yellow"
    $headline = "Собирается"
    $tooltip = "Труба собирается."
  }
  $side = "dirty"
  if ($status.bootstrap -and $status.bootstrap.side) { $side = [string]$status.bootstrap.side }
  elseif ($local.side) { $side = [string]$local.side }
  $menu = @()
  $mark = { param($up) if ($up) { "ок" } else { "нет" } }
  if ($side -eq "clean") {
    $menu += [pscustomobject]@{ Label = "Чистая  $(& $mark $rtc)"; Action = "none" }
  } else {
    $menu += [pscustomobject]@{ Label = "Грязная  $(& $mark $rtc)"; Action = "none" }
    $peer = $null
    if ($status.report) { $peer = $status.report.peer }
    if ($null -ne $peer) {
      $menu += [pscustomobject]@{ Label = "Чистая  $(& $mark ([bool]$peer.rtc))"; Action = "none" }
    }
  }
  $menu += [pscustomobject]@{ Label = "Подробности"; Action = "details" }
  return [pscustomobject]@{
    Color = $color
    Headline = $headline
    Tooltip = $tooltip
    Menu = $menu
  }
}

function New-HfColorIcon([string]$color) {
  $bmp = New-Object System.Drawing.Bitmap 16, 16
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $rgb = switch ($color) {
    "green" { @(143, 217, 154) }
    "yellow" { @(230, 195, 92) }
    "red" { @(224, 122, 95) }
    default { @(154, 145, 127) }
  }
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($rgb[0], $rgb[1], $rgb[2]))
  $g.FillEllipse($brush, 1, 1, 14, 14)
  $brush.Dispose()
  $g.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  return $icon
}

function Start-HfTray {
  param(
    [string]$StatusUrl = "http://127.0.0.1:18764/status",
    [string]$DetailsUrl = "http://127.0.0.1:18764/",
    [string]$StateFile = ""
  )
  $notify = New-Object System.Windows.Forms.NotifyIcon
  $notify.Visible = $true
  $menu = New-Object System.Windows.Forms.ContextMenuStrip
  $notify.ContextMenuStrip = $menu
  $script:HfLastColor = ""
  $script:HfLastRtc = $null
  $script:HfStatusUrl = $StatusUrl
  $script:HfDetailsUrl = $DetailsUrl
  $script:HfTrayStateFile = $StateFile
  $notify.add_MouseClick({
    param($sender, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
      Start-Process $script:HfDetailsUrl
    }
  })
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 2000
  $timer.add_Tick({
    $status = $null
    try {
      $status = Invoke-RestMethod -Uri $script:HfStatusUrl -TimeoutSec 2
    } catch {
      $status = $null
    }
    $view = Get-HfTrayView $status
    if (-not [string]::IsNullOrWhiteSpace($script:HfTrayStateFile)) {
      $state = [ordered]@{
        at = [DateTime]::UtcNow.ToString("o")
        color = [string]$view.Color
        headline = [string]$view.Headline
        tooltip = [string]$view.Tooltip
      }
      $tempState = "$($script:HfTrayStateFile).tmp"
      $state | ConvertTo-Json -Compress | Set-Content -LiteralPath $tempState -Encoding UTF8
      Move-Item -LiteralPath $tempState -Destination $script:HfTrayStateFile -Force
    }
    $tip = [string]$view.Tooltip
    if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 63) }
    $notify.Text = $tip
    $menu.Items.Clear()
    foreach ($item in @($view.Menu)) {
      $mi = New-Object System.Windows.Forms.ToolStripMenuItem ([string]$item.Label)
      if ([string]$item.Action -eq "details") {
        $mi.add_Click({ Start-Process $script:HfDetailsUrl })
      } else {
        $mi.Enabled = $false
      }
      [void]$menu.Items.Add($mi)
    }
    if ([string]$view.Color -ne $script:HfLastColor) {
      $notify.Icon = New-HfColorIcon ([string]$view.Color)
      $script:HfLastColor = [string]$view.Color
    }
    if ([string]$view.Color -eq "green") {
      if ($script:HfLastRtc -eq $false) {
        $notify.ShowBalloonTip(6000, "hf-pipe", [string]$view.Tooltip, [System.Windows.Forms.ToolTipIcon]::Info)
      }
      $script:HfLastRtc = $true
    } elseif ([string]$view.Color -eq "red") {
      if ($script:HfLastRtc -eq $true) {
        $notify.ShowBalloonTip(6000, "hf-pipe", [string]$view.Tooltip, [System.Windows.Forms.ToolTipIcon]::Error)
      }
      $script:HfLastRtc = $false
    }
  })
  $timer.Start()
  $notify.Text = "Supervisor недоступен."
  $notify.Icon = New-HfColorIcon "gray"
  [System.Windows.Forms.Application]::Run()
}

if ($MyInvocation.InvocationName -ne ".") {
  Start-HfTray -StatusUrl $StatusUrl -DetailsUrl $DetailsUrl -StateFile $StateFile
}
