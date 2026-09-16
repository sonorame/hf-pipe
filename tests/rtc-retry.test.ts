import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryRtcOffer, shouldReplaceRtcPeer, shouldAcceptRemoteOffer, localSdpReadyToSignal } from "../src/rtc-retry.js";

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
