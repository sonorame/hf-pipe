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

export function shouldAcceptRemoteOffer(s: {
  dcOpen: boolean;
  localGen: number;
  remoteGen?: number | null;
}): boolean {
  if (s.dcOpen) return false;
  if (s.remoteGen == null) return true;
  return Number(s.remoteGen) > Number(s.localGen);
}

export function localSdpReadyToSignal(s: {
  alreadySignaled: boolean;
  sdp?: string | null;
  iceGatheringState?: string;
}): boolean {
  if (s.alreadySignaled) return false;
  return Boolean(s.sdp && String(s.sdp).length > 0);
}
