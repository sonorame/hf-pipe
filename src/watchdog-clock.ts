export const CLOCK_JUMP_RECYCLE_MS = 60_000;

export function shouldRecycleAfterClockJump(
  prevMs: number,
  nowMs: number,
  minGapMs = CLOCK_JUMP_RECYCLE_MS,
): boolean {
  return nowMs - prevMs > minGapMs;
}

export function shouldExitOnSyncDead(s: {
  rtcUp: boolean;
  lastOkMs: number;
  nowMs: number;
  deadMs: number;
}): boolean {
  if (s.rtcUp) return false;
  return s.nowMs - s.lastOkMs > s.deadMs;
}
