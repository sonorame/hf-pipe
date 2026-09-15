import assert from "node:assert/strict";
import test from "node:test";
import { shouldRetryRtcOffer } from "../src/rtc-retry.js";

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

test("connecting offer older than 8s is retried", () => {
  assert.equal(
    shouldRetryRtcOffer({
      dcOpen: false,
      dcReadyState: "connecting",
      connectionState: "connecting",
      iceConnectionState: "checking",
      lastOfferAt: 1_000,
      now: 10_000,
    }),
    true,
  );
});
