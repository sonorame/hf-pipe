import assert from "node:assert/strict";
import test from "node:test";
import { createSoakTracker, shouldContinueSoak } from "../src/soak-policy.mjs";

test("soak tracker measures real outages and fails only past recovery budget", () => {
  const tracker = createSoakTracker({ maxOutageMs: 180_000, startedAt: 0 });
  tracker.observe({ rtc: true, buildId: "a", peerBuildId: "a" }, 1_000);
  tracker.observe({ rtc: false, buildId: "a", peerBuildId: "a" }, 10_000);
  tracker.observe({ rtc: true, buildId: "a", peerBuildId: "a" }, 80_000);
  assert.equal(tracker.summary(80_000).maxOutageMs, 70_000);
  tracker.observe({ rtc: false, buildId: "a", peerBuildId: "a" }, 100_000);
  assert.throws(() => tracker.observe({ rtc: false }, 281_000), /outage exceeded/i);
});

test("soak tracker rejects version skew while the channel claims to be up", () => {
  const tracker = createSoakTracker({ maxOutageMs: 180_000, startedAt: 0 });
  assert.throws(
    () => tracker.observe({ rtc: true, buildId: "dirty", peerBuildId: "clean" }, 1_000),
    /build mismatch/i,
  );
});

test("soak cannot finish while an outage is still open", () => {
  assert.equal(shouldContinueSoak(900, 1000, { outageSince: null }), true);
  assert.equal(shouldContinueSoak(1001, 1000, { outageSince: 950 }), true);
  assert.equal(shouldContinueSoak(1001, 1000, { outageSince: null }), false);
});
