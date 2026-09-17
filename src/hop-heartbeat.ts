export const RTC_HEARTBEAT_MISS_MS = 20_000;
export const RTC_PULSE_LOG_MS = 15_000;

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

export function heartbeatShouldLogPulse(s: {
  rtcLooksUp: boolean;
  lastLogAt: number;
  now: number;
  everyMs?: number;
}): boolean {
  if (!s.rtcLooksUp) return false;
  const every = s.everyMs ?? RTC_PULSE_LOG_MS;
  if (!s.lastLogAt) return true;
  return s.now - s.lastLogAt >= every;
}
