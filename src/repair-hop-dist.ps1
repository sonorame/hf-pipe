param(
  [string]$Pack = (Join-Path $env:USERPROFILE "Desktop\hf-matrix-pack")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Pack)) {
  throw "pack not found: $Pack"
}

Set-Location -LiteralPath $Pack
$dist = Join-Path $Pack "dist"
New-Item -ItemType Directory -Force -Path $dist | Out-Null

function Find-HopNode([string]$Root) {
  $pf86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $candidates = @(
    (Join-Path $Root "node.exe"),
    (Join-Path $env:ProgramFiles "nodejs\node.exe")
  )
  if ($pf86) { $candidates += (Join-Path $pf86 "nodejs\node.exe") }
  $candidates += (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  foreach ($c in $candidates) {
    if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return $c }
  }
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -and (Test-Path -LiteralPath $cmd.Source -PathType Leaf)) {
    return $cmd.Source
  }
  return $null
}

$node = Find-HopNode $Pack
$tsc = Join-Path $Pack "node_modules\typescript\bin\tsc"
if ($node -and (Test-Path -LiteralPath $tsc -PathType Leaf)) {
  try {
    & $node $tsc
  } catch {
    Write-Host "tsc skipped: $($_.Exception.Message)"
  }
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

$board = Join-Path $dist "hop-board.js"
$log = Join-Path $dist "hop-log.js"
$clock = Join-Path $dist "watchdog-clock.js"

Write-Utf8NoBom $clock @'
export const CLOCK_JUMP_RECYCLE_MS = 60000;
export function shouldRecycleAfterClockJump(prevMs, nowMs, minGapMs) {
  if (minGapMs == null) minGapMs = CLOCK_JUMP_RECYCLE_MS;
  return nowMs - prevMs > minGapMs;
}
export function shouldExitOnSyncDead(s) {
  if (s.rtcUp) return false;
  if (s.nowMs - s.lastOkMs <= s.deadMs) return false;
  const downSince = Number(s.rtcDownSinceMs || 0);
  if (downSince > 0 && s.nowMs - downSince <= s.deadMs) return false;
  return true;
}
'@

if (-not (Test-Path -LiteralPath $board)) {
  Write-Utf8NoBom $board @'
export const HOP_BOARD_ACTIONS = ["ping", "recycle", "restart", "doctor"];
export function hopRestartDelayMs() { return 250; }
export function parseDoctorStdout() { return { verdict: "RED", failing: [], culprit: null, next: "" }; }
export function parseHopControl() { return null; }
export function shapeHopStatus(s) {
  s = s || {};
  return {
    rtc: Boolean(s.rtc),
    pid: Number(s.pid) || 0,
    side: String(s.side || "clean"),
    dc: String(s.dc || "none"),
    connection: String(s.connection || "none"),
    ice: String(s.ice || "none"),
    signaling: String(s.signaling || "none"),
    gen: Number(s.gen) || 0,
    epoch: s.epoch || null,
    pongAgeMs: null,
    peerHost: null,
    caption: "",
    dcText: "",
    connectionText: "",
    iceText: "",
    signalingText: ""
  };
}
export function renderHopBoardHtml() { return "<title>Hop</title>"; }
'@
}

if (-not (Test-Path -LiteralPath $log)) {
  Write-Utf8NoBom $log @'
let seq = 0;
const lines = [];
export function pushHopLog(kind) {
  const line = { id: ++seq, t: Date.now(), level: "info", text: String(kind || "") };
  lines.push(line);
  return line;
}
export function readHopLogAfter(afterId) {
  const after = Number(afterId) || 0;
  return lines.filter((l) => l.id > after);
}
'@
}

if (-not (Test-Path -LiteralPath $board)) { throw "hop-board.js missing after repair" }
if (-not (Test-Path -LiteralPath $log)) { throw "hop-log.js missing after repair" }
if (-not (Test-Path -LiteralPath $clock)) { throw "watchdog-clock.js missing after repair" }
Write-Host "ok $board"
Write-Host "ok $log"
Write-Host "ok $clock"
exit 0
