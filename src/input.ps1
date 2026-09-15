param([Parameter(Mandatory = $true)][string]$SpecPath)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class HFInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT {
    public int dx; public int dy; public int mouseData; public int dwFlags; public int time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT {
    public ushort wVk; public ushort wScan; public int dwFlags; public int time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public HARDWAREINPUT hi;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public int type; public INPUTUNION u; }
  public const int INPUT_MOUSE = 0;
  public const int INPUT_KEYBOARD = 1;
  public const int MOUSEEVENTF_MOVE = 0x0001;
  public const int MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const int MOUSEEVENTF_LEFTUP = 0x0004;
  public const int MOUSEEVENTF_RIGHTDOWN = 0x0008;
  public const int MOUSEEVENTF_RIGHTUP = 0x0010;
  public const int MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  public const int MOUSEEVENTF_MIDDLEUP = 0x0040;
  public const int MOUSEEVENTF_WHEEL = 0x0800;
  public const int MOUSEEVENTF_HWHEEL = 0x1000;
  public const int MOUSEEVENTF_VIRTUALDESK = 0x4000;
  public const int MOUSEEVENTF_ABSOLUTE = 0x8000;
  public const int KEYEVENTF_EXTENDEDKEY = 0x0001;
  public const int KEYEVENTF_KEYUP = 0x0002;
  public const int KEYEVENTF_UNICODE = 0x0004;
  [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] p, int cb);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
}
"@
[void][HFInput]::SetProcessDPIAware()

$spec = Get-Content -LiteralPath $SpecPath -Raw -Encoding UTF8 | ConvertFrom-Json
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$cb = [System.Runtime.InteropServices.Marshal]::SizeOf([type][HFInput+INPUT])

function Send-HF([HFInput+INPUT[]]$arr) {
  if (-not $arr -or $arr.Length -eq 0) { return }
  $n = [HFInput]::SendInput([uint32]$arr.Length, $arr, $cb)
  if ($n -eq 0) { throw "SendInput failed $($arr.Length)" }
}

function Mouse-Move([double]$x, [double]$y) {
  $ix = [int][Math]::Round($x)
  $iy = [int][Math]::Round($y)
  if (-not [HFInput]::SetCursorPos($ix, $iy)) { throw "SetCursorPos failed" }
}

function Mouse-Btn([string]$button, [string]$edge) {
  $flag = 0
  $b = $button.ToLower()
  if ($b -eq "right") {
    if ($edge -eq "down") { $flag = [HFInput]::MOUSEEVENTF_RIGHTDOWN } else { $flag = [HFInput]::MOUSEEVENTF_RIGHTUP }
  } elseif ($b -eq "middle") {
    if ($edge -eq "down") { $flag = [HFInput]::MOUSEEVENTF_MIDDLEDOWN } else { $flag = [HFInput]::MOUSEEVENTF_MIDDLEUP }
  } else {
    if ($edge -eq "down") { $flag = [HFInput]::MOUSEEVENTF_LEFTDOWN } else { $flag = [HFInput]::MOUSEEVENTF_LEFTUP }
  }
  $i = New-Object HFInput+INPUT
  $i.type = [HFInput]::INPUT_MOUSE
  $i.u.mi.dwFlags = $flag
  Send-HF @($i)
}

function Mouse-Wheel([int]$dy, [int]$dx) {
  if ($dy -ne 0) {
    $i = New-Object HFInput+INPUT
    $i.type = [HFInput]::INPUT_MOUSE
    $i.u.mi.dwFlags = [HFInput]::MOUSEEVENTF_WHEEL
    $i.u.mi.mouseData = $dy
    Send-HF @($i)
  }
  if ($dx -ne 0) {
    $i = New-Object HFInput+INPUT
    $i.type = [HFInput]::INPUT_MOUSE
    $i.u.mi.dwFlags = [HFInput]::MOUSEEVENTF_HWHEEL
    $i.u.mi.mouseData = $dx
    Send-HF @($i)
  }
}

function Vk-Of([string]$name) {
  $k = $name.ToLower()
  switch ($k) {
    "ctrl" { return @{ vk = 0x11; ext = $false } }
    "control" { return @{ vk = 0x11; ext = $false } }
    "alt" { return @{ vk = 0x12; ext = $false } }
    "shift" { return @{ vk = 0x10; ext = $false } }
    "win" { return @{ vk = 0x5B; ext = $false } }
    "lwin" { return @{ vk = 0x5B; ext = $false } }
    "rwin" { return @{ vk = 0x5C; ext = $false } }
    "enter" { return @{ vk = 0x0D; ext = $false } }
    "return" { return @{ vk = 0x0D; ext = $false } }
    "tab" { return @{ vk = 0x09; ext = $false } }
    "esc" { return @{ vk = 0x1B; ext = $false } }
    "escape" { return @{ vk = 0x1B; ext = $false } }
    "space" { return @{ vk = 0x20; ext = $false } }
    "backspace" { return @{ vk = 0x08; ext = $false } }
    "bksp" { return @{ vk = 0x08; ext = $false } }
    "delete" { return @{ vk = 0x2E; ext = $true } }
    "del" { return @{ vk = 0x2E; ext = $true } }
    "insert" { return @{ vk = 0x2D; ext = $true } }
    "home" { return @{ vk = 0x24; ext = $true } }
    "end" { return @{ vk = 0x23; ext = $true } }
    "pageup" { return @{ vk = 0x21; ext = $true } }
    "pagedown" { return @{ vk = 0x22; ext = $true } }
    "left" { return @{ vk = 0x25; ext = $true } }
    "up" { return @{ vk = 0x26; ext = $true } }
    "right" { return @{ vk = 0x27; ext = $true } }
    "down" { return @{ vk = 0x28; ext = $true } }
    "capslock" { return @{ vk = 0x14; ext = $false } }
    default {
      if ($k -match '^f([1-9]|1[0-2])$') { return @{ vk = (0x70 + [int]$Matches[1] - 1); ext = $false } }
      if ($k.Length -eq 1) {
        $ch = $k.ToUpper()[0]
        return @{ vk = [int][char]$ch; ext = $false }
      }
      throw "unknown key $name"
    }
  }
}

function Key-Edge($info, [bool]$up) {
  $i = New-Object HFInput+INPUT
  $i.type = [HFInput]::INPUT_KEYBOARD
  $i.u.ki.wVk = [uint16]$info.vk
  $flags = 0
  if ($info.ext) { $flags = $flags -bor [HFInput]::KEYEVENTF_EXTENDEDKEY }
  if ($up) { $flags = $flags -bor [HFInput]::KEYEVENTF_KEYUP }
  $i.u.ki.dwFlags = $flags
  Send-HF @($i)
}

function Type-Text([string]$text) {
  if ([string]::IsNullOrEmpty($text)) { return }
  if ($text.Length -gt 4000) { $text = $text.Substring(0, 4000) }
  foreach ($ch in $text.ToCharArray()) {
    $code = [int][char]$ch
    $down = New-Object HFInput+INPUT
    $down.type = [HFInput]::INPUT_KEYBOARD
    $down.u.ki.wVk = 0
    $down.u.ki.wScan = [uint16]$code
    $down.u.ki.dwFlags = [HFInput]::KEYEVENTF_UNICODE
    $up = New-Object HFInput+INPUT
    $up.type = [HFInput]::INPUT_KEYBOARD
    $up.u.ki.wVk = 0
    $up.u.ki.wScan = [uint16]$code
    $up.u.ki.dwFlags = [HFInput]::KEYEVENTF_UNICODE -bor [HFInput]::KEYEVENTF_KEYUP
    Send-HF @($down, $up)
  }
}

$op = ([string]$spec.op).ToLower()
$x = 0.0; $y = 0.0
if ($null -ne $spec.x) { $x = [double]$spec.x }
if ($null -ne $spec.y) { $y = [double]$spec.y }
$button = "left"
if ($spec.button) { $button = [string]$spec.button }
$clicks = 1
if ($spec.clicks) { $clicks = [int]$spec.clicks }

if ($op -eq "move") {
  Mouse-Move $x $y
} elseif ($op -eq "down") {
  if ($null -ne $spec.x) { Mouse-Move $x $y }
  Mouse-Btn $button "down"
} elseif ($op -eq "up") {
  if ($null -ne $spec.x) { Mouse-Move $x $y }
  Mouse-Btn $button "up"
} elseif ($op -eq "click" -or $op -eq "leftclick") {
  Mouse-Move $x $y
  1..$clicks | ForEach-Object { Mouse-Btn "left" "down"; Mouse-Btn "left" "up" }
} elseif ($op -eq "dblclick" -or $op -eq "doubleclick") {
  Mouse-Move $x $y
  1..2 | ForEach-Object { Mouse-Btn "left" "down"; Mouse-Btn "left" "up" }
} elseif ($op -eq "rightclick") {
  Mouse-Move $x $y
  Mouse-Btn "right" "down"; Mouse-Btn "right" "up"
} elseif ($op -eq "middleclick") {
  Mouse-Move $x $y
  Mouse-Btn "middle" "down"; Mouse-Btn "middle" "up"
} elseif ($op -eq "scroll") {
  if ($null -ne $spec.x) { Mouse-Move $x $y }
  $dy = 0; $dx = 0
  if ($null -ne $spec.dy) { $dy = [int]$spec.dy } else { $dy = -120 }
  if ($null -ne $spec.dx) { $dx = [int]$spec.dx }
  Mouse-Wheel $dy $dx
} elseif ($op -eq "drag") {
  $toX = $x; $toY = $y
  if ($null -ne $spec.toX) { $toX = [double]$spec.toX }
  if ($null -ne $spec.toY) { $toY = [double]$spec.toY }
  Mouse-Move $x $y
  Mouse-Btn $button "down"
  $steps = 12
  for ($s = 1; $s -le $steps; $s++) {
    $px = $x + (($toX - $x) * $s / $steps)
    $py = $y + (($toY - $y) * $s / $steps)
    Mouse-Move $px $py
    Start-Sleep -Milliseconds 8
  }
  Mouse-Btn $button "up"
} elseif ($op -eq "type") {
  Type-Text ([string]$spec.text)
} elseif ($op -eq "key" -or $op -eq "hotkey") {
  $keys = @()
  if ($spec.keys) { $keys = @($spec.keys) }
  elseif ($spec.key) { $keys = @($spec.key) }
  $infos = @()
  foreach ($name in $keys) { $infos += ,(Vk-Of ([string]$name)) }
  foreach ($info in $infos) { Key-Edge $info $false }
  [array]::Reverse($infos)
  foreach ($info in $infos) { Key-Edge $info $true }
} else {
  throw "unknown op $op"
}

$pt = New-Object HFInput+POINT
[void][HFInput]::GetCursorPos([ref]$pt)
$result = @{
  ok = $true
  op = $op
  x = $x
  y = $y
  cursor_x = $pt.X
  cursor_y = $pt.Y
  screen_left = $vs.Left
  screen_top = $vs.Top
  screen_width = $vs.Width
  screen_height = $vs.Height
}
$result | ConvertTo-Json -Compress
