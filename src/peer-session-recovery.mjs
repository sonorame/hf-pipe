// A restarted answerer cannot answer an offer consumed by its previous session.
// Each authenticated session gets one fresh offer; repeated health messages do
// not interrupt an offer already in flight.
export function createPeerSessionRecovery() {
  const observed = new Set();
  return function observe(frame, rtcAvailable) {
    if (!rtcAvailable || frame?.side !== "clean") return false;
    const identity = frame.sessionId || (Number.isInteger(frame.pid) && frame.pid > 0 ? `pid:${frame.pid}` : null);
    if (!identity || observed.has(identity)) return false;
    observed.add(identity);
    if (observed.size > 32) observed.delete(observed.values().next().value);
    return frame.rtc === false;
  };
}
