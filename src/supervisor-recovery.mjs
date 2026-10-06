// A late supervisor tick cannot distinguish a suspended host from a stalled child.
// Give the child one fresh heartbeat window; only normal supervisor ticks may
// establish a child failure. A child-only hang does not pause this clock.
export function createSupervisorRecovery({ now = Date.now(), heartbeatMs = 15_000, startupMs = 30_000 } = {}) {
  let lastCheckAt = now;
  let lastReportAt = now;
  let readyDeadline = now + startupMs;
  let ready = false;
  let rtcDownSince = null;
  let resumeUntil = 0;
  return {
    report(time, phase) {
      lastReportAt = time;
      if (phase === "ready") ready = true;
    },
    check(time, local) {
      const gapMs = time - lastCheckAt;
      lastCheckAt = time;
      if (gapMs >= heartbeatMs || gapMs < 0) {
        resumeUntil = time + heartbeatMs;
        lastReportAt = time;
        rtcDownSince = null;
        if (!ready) readyDeadline = time + startupMs;
        return { resumed: true, gapMs };
      }
      if (time < resumeUntil) return {};
      if (!ready && time >= readyDeadline) return { reason: "startup readiness deadline" };
      if (time - lastReportAt >= heartbeatMs) return { reason: "supervisor heartbeat stalled" };
      if (local?.rtc === true) rtcDownSince = null;
      else if (local && rtcDownSince === null) rtcDownSince = time;
      if (local && rtcDownSince !== null && time - rtcDownSince >= 10_000 &&
          local.matrixSyncAgeMs != null && Number(local.matrixSyncAgeMs) >= 20_000) {
        return { reason: "Matrix sync stale while RTC unavailable; reload process trust" };
      }
      return {};
    },
  };
}
