import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryRtcOffer, shouldReplaceRtcPeer, shouldAcceptRemoteOffer, localSdpReadyToSignal, rtcRecycleAction } from "../src/rtc-retry.js";

test("open datachannel does not retry", () => {
  assert.equal(
    shouldRetryRtcOffer({
      dcOpen: true,
      dcReadyState: "open",
      connectionState: "connected",
      iceConnectionState: "connected",
      lastOfferAt: 0,
      now: 60_000,
    }),
    false,
  );
});

test("connecting offer is not retried for 8s", () => {
  assert.equal(
    shouldRetryRtcOffer({
      dcOpen: false,
      dcReadyState: "connecting",
      connectionState: "connecting",
      iceConnectionState: "checking",
      lastOfferAt: 1_000,
      now: 5_000,
    }),
    false,
  );
});

test("connecting offer still waits 30s for TURN", () => {
  assert.equal(
    shouldRetryRtcOffer({
      dcOpen: false,
      dcReadyState: "connecting",
      connectionState: "connecting",
      iceConnectionState: "checking",
      lastOfferAt: 1_000,
      now: 20_000,
    }),
    false,
  );
});

test("connecting offer older than 90s is retried", () => {
  assert.equal(
    shouldRetryRtcOffer({
      dcOpen: false,
      dcReadyState: "connecting",
      connectionState: "connecting",
      iceConnectionState: "checking",
      lastOfferAt: 1_000,
      now: 92_000,
    }),
    true,
  );
});

test("failed ICE does not reoffer while the answer may still be in flight", () => {
  assert.equal(
    shouldRetryRtcOffer({
      dcOpen: false,
      dcReadyState: "closed",
      connectionState: "failed",
      iceConnectionState: "failed",
      lastOfferAt: 1_000,
      now: 20_000,
    }),
    false,
  );
});

test("failed ICE still waits out a slow Matrix answer after a 21s TURN hole", () => {
  assert.equal(
    shouldRetryRtcOffer({
      dcOpen: false,
      dcReadyState: "closed",
      connectionState: "failed",
      iceConnectionState: "failed",
      lastOfferAt: 1_000,
      now: 61_000,
    }),
    false,
  );
});

test("offerer waiting for answer in state new does not retry", () => {
  assert.equal(
    shouldRetryRtcOffer({
      dcOpen: false,
      dcReadyState: "connecting",
      connectionState: "new",
      iceConnectionState: "new",
      signalingState: "have-local-offer",
      outstandingOffer: true,
      lastOfferAt: 1_000,
      now: 20_000,
    }),
    false,
  );
});

test("startOfferer still running does not start another", () => {
  assert.equal(
    shouldRetryRtcOffer({
      dcOpen: false,
      offerCreateInFlight: true,
      lastOfferAt: 1_000,
      now: 15_000,
    }),
    false,
  );
});

test("a connecting peer is not replaced by a newer offer", () => {
  assert.equal(
    shouldReplaceRtcPeer({
      dcOpen: false,
      connectionState: "connecting",
      iceConnectionState: "checking",
    }),
    false,
  );
});

test("a failed peer can be replaced by a newer offer", () => {
  assert.equal(
    shouldReplaceRtcPeer({
      dcOpen: false,
      connectionState: "failed",
      iceConnectionState: "failed",
    }),
    true,
  );
});

test("answerer accepts a newer offer while the old peer is still connecting", () => {
  assert.equal(
    shouldAcceptRemoteOffer({
      dcOpen: false,
      localGen: 15,
      remoteGen: 16,
    }),
    true,
  );
});

test("answerer drops a duplicate offer of the same gen", () => {
  assert.equal(
    shouldAcceptRemoteOffer({
      dcOpen: false,
      localGen: 15,
      remoteGen: 15,
    }),
    false,
  );
});

test("answerer accepts the first offer when local gen is zero", () => {
  assert.equal(
    shouldAcceptRemoteOffer({
      dcOpen: false,
      localGen: 0,
      remoteGen: 15,
    }),
    true,
  );
});

test("open datachannel does not accept a replacement offer", () => {
  assert.equal(
    shouldAcceptRemoteOffer({
      dcOpen: true,
      localGen: 15,
      remoteGen: 20,
    }),
    false,
  );
});

test("answerer accepts a lower gen after ICE failed", () => {
  assert.equal(
    shouldAcceptRemoteOffer({
      dcOpen: false,
      localGen: 5,
      remoteGen: 1,
      connectionState: "failed",
      iceConnectionState: "failed",
    }),
    true,
  );
});

test("answerer drops a lower gen while the current peer is still connecting", () => {
  assert.equal(
    shouldAcceptRemoteOffer({
      dcOpen: false,
      localGen: 5,
      remoteGen: 1,
      connectionState: "connecting",
      iceConnectionState: "checking",
    }),
    false,
  );
});

test("local SDP is signaled before ICE gather complete", () => {
  assert.equal(
    localSdpReadyToSignal({
      alreadySignaled: false,
      sdp: "v=0",
      iceGatheringState: "gathering",
    }),
    true,
  );
});

test("local SDP is not signaled twice", () => {
  assert.equal(
    localSdpReadyToSignal({
      alreadySignaled: true,
      sdp: "v=0",
      iceGatheringState: "complete",
    }),
    false,
  );
});

test("empty local SDP is not signaled", () => {
  assert.equal(
    localSdpReadyToSignal({
      alreadySignaled: false,
      sdp: "",
      iceGatheringState: "new",
    }),
    false,
  );
});

test("answerer accepts a foreign epoch even when local gen is higher and still connecting", () => {
  assert.equal(
    shouldAcceptRemoteOffer({
      dcOpen: false,
      localGen: 5,
      remoteGen: 1,
      localEpoch: "old-proc",
      remoteEpoch: "new-proc",
      connectionState: "connecting",
      iceConnectionState: "checking",
    }),
    true,
  );
});

test("answerer accepts a foreign epoch even if a zombie datachannel is still open", () => {
  assert.equal(
    shouldAcceptRemoteOffer({
      dcOpen: true,
      localGen: 5,
      remoteGen: 1,
      localEpoch: "old-proc",
      remoteEpoch: "new-proc",
    }),
    true,
  );
});

test("answerer drops a lower gen of the same epoch even after ICE failed", () => {
  assert.equal(
    shouldAcceptRemoteOffer({
      dcOpen: false,
      localGen: 5,
      remoteGen: 1,
      localEpoch: "same-proc",
      remoteEpoch: "same-proc",
      connectionState: "failed",
      iceConnectionState: "failed",
    }),
    false,
  );
});

test("answerer accepts a newer gen of the same epoch while still connecting", () => {
  assert.equal(
    shouldAcceptRemoteOffer({
      dcOpen: false,
      localGen: 5,
      remoteGen: 6,
      localEpoch: "same-proc",
      remoteEpoch: "same-proc",
      connectionState: "connecting",
      iceConnectionState: "checking",
    }),
    true,
  );
});

test("healthy open datachannel is never recycled", () => {
  assert.equal(
    rtcRecycleAction({ dcOpen: true, stuckSinceMs: 0, now: 500_000 }),
    "none",
  );
});

test("ICE failed recycles even if the datachannel flag is still open", () => {
  assert.equal(
    rtcRecycleAction({
      dcOpen: true,
      connectionState: "failed",
      iceConnectionState: "failed",
      stuckSinceMs: 1_000,
      now: 2_000,
      lastRecreateAt: 0,
      recreateGapMs: 20_000,
    }),
    "recreate",
  );
});

test("no stuck timestamp yet does nothing", () => {
  assert.equal(
    rtcRecycleAction({ dcOpen: false, stuckSinceMs: 0, now: 500_000 }),
    "none",
  );
});

test("stuck below the soft threshold leaves reoffer to do its job", () => {
  assert.equal(
    rtcRecycleAction({ dcOpen: false, stuckSinceMs: 1_000, now: 30_000, softMs: 45_000, hardMs: 120_000 }),
    "none",
  );
});

test("stuck past soft with the recreate gap elapsed forces a peer recreate", () => {
  assert.equal(
    rtcRecycleAction({
      dcOpen: false,
      stuckSinceMs: 1_000,
      now: 50_000,
      softMs: 45_000,
      hardMs: 120_000,
      lastRecreateAt: 0,
      recreateGapMs: 20_000,
    }),
    "recreate",
  );
});

test("stuck past soft but recently recreated waits out the gap", () => {
  assert.equal(
    rtcRecycleAction({
      dcOpen: false,
      stuckSinceMs: 1_000,
      now: 60_000,
      softMs: 45_000,
      hardMs: 120_000,
      lastRecreateAt: 50_000,
      recreateGapMs: 20_000,
    }),
    "none",
  );
});

test("stuck past the hard threshold exits for a full process restart", () => {
  assert.equal(
    rtcRecycleAction({
      dcOpen: false,
      stuckSinceMs: 1_000,
      now: 125_000,
      softMs: 45_000,
      hardMs: 120_000,
      lastRecreateAt: 120_000,
      recreateGapMs: 20_000,
    }),
    "exit",
  );
});

test("rtc-pipe wires the recycle escalation on the offerer", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/rtc-pipe.mjs", import.meta.url), "utf8");
  assert.match(src, /rtcRecycleAction/);
  assert.match(src, /heartbeatShouldLogPulse/);
  assert.match(src, /peerHost/);
  assert.match(src, /process\.exit\(7\)/);
  assert.match(src, /recreate peer epoch/);
});
