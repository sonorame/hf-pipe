export const RTC_HEARTBEAT_MISS_MS = 20_000;

export function heartbeatShouldRecycle(s: {
  rtcLooksUp: boolean;
  lastPongAt: number;
  openedAt: number;
  now: number;
  missMs?: number;
}): boolean {
  if (!s.rtcLooksUp) return false;
  const miss = s.missMs ?? RTC_HEARTBEAT_MISS_MS;
  const t = Number(s.lastPongAt || 0) || Number(s.openedAt || 0);
  if (!t) return false;
  return s.now - t > miss;
}
