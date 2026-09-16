import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryRtcOffer, shouldReplaceRtcPeer } from "../src/rtc-retry.js";

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
