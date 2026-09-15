$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  try {
    $req = $line | ConvertFrom-Json
    $display = [int]($req.display)
    $maxw = [int]($req.maxw)
    $quality = [int]($req.quality)
    if ($quality -lt 10) { $quality = 18 }
    if ($quality -gt 90) { $quality = 90 }
    $out = [string]$req.out
    $screens = @([System.Windows.Forms.Screen]::AllScreens | Sort-Object { $_.Bounds.X }, { $_.Bounds.Y })
    if ($screens.Count -lt 1) { throw "no screens" }
    if ($display -lt 0 -or $display -ge $screens.Count) {
      $scr = $screens | Where-Object { $_.Primary } | Select-Object -First 1
      if (-not $scr) { $scr = $screens[0] }
    } else {
      $scr = $screens[$display]
    }
    $b = $scr.Bounds
    $bmp = New-Object System.Drawing.Bitmap ([int]$b.Width), ([int]$b.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen([int]$b.X, [int]$b.Y, 0, 0, $bmp.Size)
    $g.Dispose()
    if ($maxw -gt 0 -and $b.Width -gt $maxw) {
      $nw = [int]$maxw
      $nh = [Math]::Max(1, [int]($b.Height * $maxw / $b.Width))
      $small = New-Object System.Drawing.Bitmap $nw, $nh
      $gs = [System.Drawing.Graphics]::FromImage($small)
      $gs.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Low
      $gs.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighSpeed
      $gs.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighSpeed
      $gs.DrawImage($bmp, 0, 0, $nw, $nh)
      $gs.Dispose()
      $bmp.Dispose()
      $bmp = $small
    }
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
    $dir = Split-Path -Parent $out
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $bmp.Save($out, $codec, $ep)
    $bmp.Dispose()
    $list = New-Object System.Collections.Generic.List[object]
    for ($i = 0; $i -lt $screens.Count; $i++) {
      $sb = $screens[$i].Bounds
      $list.Add(@{
        i = $i
        x = [int]$sb.X
        y = [int]$sb.Y
        width = [int]$sb.Width
        height = [int]$sb.Height
        primary = [bool]$screens[$i].Primary
      }) | Out-Null
    }
    $meta = @{
      ok = $true
      left = [int]$b.X
      top = [int]$b.Y
      width = [int]$b.Width
      height = [int]$b.Height
      screens = $list
    } | ConvertTo-Json -Compress -Depth 6
    [Console]::Out.WriteLine($meta)
    [Console]::Out.Flush()
  } catch {
    $msg = [string]$_.Exception.Message
    $payload = @{ ok = $false; error = $msg } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($payload)
    [Console]::Out.Flush()
  }
}
