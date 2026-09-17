export function createSoakTracker(options = {}) {
  const maxOutageBudget = Number(options.maxOutageMs || 180_000);
  const startedAt = Number(options.startedAt ?? Date.now());
  let observations = 0;
  let outageSince = null;
  let maxOutageMs = 0;
  let recoveries = 0;
  let last = null;

  return {
    observe(status, now = Date.now()) {
      observations += 1;
      if (
        status.rtc &&
        status.buildId &&
        status.peerBuildId &&
        status.buildId !== status.peerBuildId
      ) {
        throw new Error(`build mismatch dirty=${status.buildId} clean=${status.peerBuildId}`);
      }
      if (!status.rtc) {
        if (outageSince == null) outageSince = now;
        if (now - outageSince > maxOutageBudget) {
          throw new Error(`outage exceeded ${maxOutageBudget}ms`);
        }
      } else if (outageSince != null) {
        maxOutageMs = Math.max(maxOutageMs, now - outageSince);
        outageSince = null;
        recoveries += 1;
      }
      last = { ...status, at: now };
      return this.summary(now);
    },
    summary(now = Date.now()) {
      return {
        startedAt,
        durationMs: now - startedAt,
        observations,
        recoveries,
        maxOutageMs: Math.max(maxOutageMs, outageSince == null ? 0 : now - outageSince),
        outageSince,
        last,
      };
    },
  };
}

export function shouldContinueSoak(now, endAt, summary) {
  return now < endAt || summary?.outageSince != null;
}
