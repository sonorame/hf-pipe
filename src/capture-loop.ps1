$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dll = Join-Path $here "HfCap.dll"
$code = @"
using System;
using System.Runtime.InteropServices;
public static class HfCap {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
  [DllImport("gdi32.dll")] public static extern bool StretchBlt(IntPtr hdcDest, int xDest, int yDest, int wDest, int hDest, IntPtr hdcSrc, int xSrc, int ySrc, int wSrc, int hSrc, int rop);
  [DllImport("gdi32.dll")] public static extern int SetStretchBltMode(IntPtr hdc, int mode);
}
"@
if (Test-Path $dll) {
  Add-Type -Path $dll
} else {
  Add-Type -TypeDefinition $code -OutputAssembly $dll -OutputType Library
  Add-Type -Path $dll
}
[void][HfCap]::SetProcessDPIAware()
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
    $nw = [int]$b.Width
    $nh = [int]$b.Height
    if ($maxw -gt 0 -and $b.Width -gt $maxw) {
      $nw = [int]$maxw
      $nh = [Math]::Max(1, [int]($b.Height * $maxw / $b.Width))
    }
    $bmp = New-Object System.Drawing.Bitmap $nw, $nh
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $hdcDest = $g.GetHdc()
    $hdcSrc = [HfCap]::GetDC([IntPtr]::Zero)
    [void][HfCap]::SetStretchBltMode($hdcDest, 3)
    $okBlit = [HfCap]::StretchBlt($hdcDest, 0, 0, $nw, $nh, $hdcSrc, [int]$b.X, [int]$b.Y, [int]$b.Width, [int]$b.Height, 13369376)
    [void][HfCap]::ReleaseDC([IntPtr]::Zero, $hdcSrc)
    $g.ReleaseHdc($hdcDest)
    $g.Dispose()
    if (-not $okBlit) { throw "StretchBlt failed" }
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
    $dir = Split-Path -Parent $out
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $bmp.Save($out, $codec, $ep)
    $bmp.Dispose()
    $arr = @()
    for ($i = 0; $i -lt $screens.Count; $i++) {
      $sb = $screens[$i].Bounds
      $arr += @{
        i = $i
        x = [int]$sb.X
        y = [int]$sb.Y
        width = [int]$sb.Width
        height = [int]$sb.Height
        primary = [bool]$screens[$i].Primary
      }
    }
    $meta = @{
      ok = $true
      left = [int]$b.X
      top = [int]$b.Y
      width = [int]$b.Width
      height = [int]$b.Height
      screens = @($arr)
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
