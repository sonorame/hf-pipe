export const RTC_OFFER_STALE_MS = 90_000;
export const RTC_RETRY_MIN_GAP_MS = 8_000;

export function shouldRetryRtcOffer(s: {
  dcOpen: boolean;
  dcReadyState?: string;
  connectionState?: string;
  iceConnectionState?: string;
  signalingState?: string;
  outstandingOffer?: boolean;
  offerCreateInFlight?: boolean;
  lastOfferAt: number;
  now: number;
  minGapMs?: number;
  staleMs?: number;
}): boolean {
  if (s.dcOpen && s.dcReadyState === "open") return false;
  if (s.offerCreateInFlight) return false;
  const gap = s.minGapMs ?? RTC_RETRY_MIN_GAP_MS;
  if (s.now - s.lastOfferAt < gap) return false;
  const stale = s.staleMs ?? RTC_OFFER_STALE_MS;
  const waitingForAnswer =
    Boolean(s.outstandingOffer) ||
    s.signalingState === "have-local-offer" ||
    s.connectionState === "new";
  const connecting = ["connecting", "checking"].includes(String(s.connectionState || ""));
  const iceChecking = s.iceConnectionState === "checking";
  const iceFailed =
    s.connectionState === "failed" || s.iceConnectionState === "failed";
  if (
    (waitingForAnswer || connecting || iceChecking || iceFailed) &&
    s.now - s.lastOfferAt < stale
  ) {
    return false;
  }
  return true;
}

export function shouldReplaceRtcPeer(s: {
  dcOpen: boolean;
  connectionState?: string;
  iceConnectionState?: string;
}): boolean {
  if (s.dcOpen) return false;
  const conn = String(s.connectionState || "");
  const ice = String(s.iceConnectionState || "");
  if (conn === "connected" || ice === "connected" || ice === "completed") return false;
  if (["connecting", "checking"].includes(conn) || ice === "checking") return false;
  return true;
}

function rtcSessionDead(s: {
  connectionState?: string;
  iceConnectionState?: string;
}): boolean {
  const conn = String(s.connectionState || "");
  const ice = String(s.iceConnectionState || "");
  return (
    ["failed", "closed", "disconnected"].includes(conn) ||
    ["failed", "closed", "disconnected"].includes(ice)
  );
}

export function shouldAcceptRemoteOffer(s: {
  dcOpen: boolean;
  localGen: number;
  remoteGen?: number | null;
  connectionState?: string;
  iceConnectionState?: string;
  localEpoch?: string | null;
  remoteEpoch?: string | null;
}): boolean {
  const localEpoch = s.localEpoch ? String(s.localEpoch) : "";
  const remoteEpoch = s.remoteEpoch ? String(s.remoteEpoch) : "";
  if (localEpoch && remoteEpoch && localEpoch !== remoteEpoch) return true;
  if (s.dcOpen) return false;
  if (s.remoteGen == null) return true;
  const remote = Number(s.remoteGen);
  const local = Number(s.localGen);
  if (remote > local) return true;
  if (remote === local) return false;
  if (localEpoch && remoteEpoch) return false;
  return rtcSessionDead(s);
}

export function localSdpReadyToSignal(s: {
  alreadySignaled: boolean;
  sdp?: string | null;
  iceGatheringState?: string;
}): boolean {
  if (s.alreadySignaled) return false;
  return Boolean(s.sdp && String(s.sdp).length > 0);
}

/** Soft: force a clean re-offer even when shouldRetryRtcOffer is being conservative. */
export const RTC_STUCK_SOFT_MS = 45_000;
/** Hard: give up on this process and exit(7) so start-*.cmd restarts a fresh one. */
export const RTC_STUCK_HARD_MS = 120_000;
/** Do not recreate the peer more often than this. */
export const RTC_RECREATE_GAP_MS = 20_000;

export type RtcRecycleAction = "none" | "recreate" | "exit";

function rtcPeerFailed(s: {
  connectionState?: string;
  iceConnectionState?: string;
}): boolean {
  const conn = String(s.connectionState || "");
  const ice = String(s.iceConnectionState || "");
  return conn === "failed" || ice === "failed";
}

export function rtcRecycleAction(s: {
  dcOpen: boolean;
  stuckSinceMs: number;
  now: number;
  softMs?: number;
  hardMs?: number;
  lastRecreateAt?: number;
  recreateGapMs?: number;
  connectionState?: string;
  iceConnectionState?: string;
}): RtcRecycleAction {
  const failed = rtcPeerFailed(s);
  if (s.dcOpen && !failed) return "none";
  if (!s.stuckSinceMs && !failed) return "none";
  const stuck = s.stuckSinceMs ? s.now - s.stuckSinceMs : 0;
  const hard = s.hardMs ?? RTC_STUCK_HARD_MS;
  if (s.stuckSinceMs && stuck >= hard) return "exit";
  const gap = s.recreateGapMs ?? RTC_RECREATE_GAP_MS;
  const last = s.lastRecreateAt ?? 0;
  if (last && s.now - last < gap) return "none";
  if (failed) return "recreate";
  const soft = s.softMs ?? RTC_STUCK_SOFT_MS;
  if (stuck < soft) return "none";
  return "recreate";
}
