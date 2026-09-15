export const RTC_OFFER_STALE_MS = 8_000;
export const RTC_RETRY_MIN_GAP_MS = 8_000;
export function shouldRetryRtcOffer(s) {
    if (s.dcOpen && s.dcReadyState === "open")
        return false;
    const gap = s.minGapMs ?? RTC_RETRY_MIN_GAP_MS;
    if (s.now - s.lastOfferAt < gap)
        return false;
    const stale = s.staleMs ?? RTC_OFFER_STALE_MS;
    const connecting = ["connecting", "checking"].includes(String(s.connectionState || ""));
    const iceChecking = s.iceConnectionState === "checking";
    if ((connecting || iceChecking) && s.now - s.lastOfferAt < stale)
        return false;
    return true;
}
//# sourceMappingURL=rtc-retry.js.map