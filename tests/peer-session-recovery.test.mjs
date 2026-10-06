import test from "node:test";
import assert from "node:assert/strict";
import { createPeerSessionRecovery } from "../src/peer-session-recovery.mjs";

test("new answerer receives one fresh offer without waiting for stale-offer timeout", () => {
  const observe = createPeerSessionRecovery();
  const health = {side: "clean", sessionId: "first", pid: 1, rtc: false};
  assert.equal(observe(health, true), true);
  assert.equal(observe(health, true), false);
  assert.equal(observe({...health, sessionId: "second"}, true), true);
  assert.equal(observe(health, true), false);
});
test("peer already connected and non-clean health do not interrupt RTC", () => {
  const observe = createPeerSessionRecovery();
  assert.equal(observe({side: "clean", sessionId: "up", rtc: true}, true), false);
  assert.equal(observe({side: "dirty", sessionId: "other", rtc: false}, true), false);
  assert.equal(observe({side: "clean", rtc: false}, true), false);
});
test("health before RTC initialization remains eligible and legacy peer PID is supported", () => {
  const observe = createPeerSessionRecovery();
  const health = {side: "clean", pid: 17, rtc: false};
  assert.equal(observe(health, false), false);
  assert.equal(observe(health, true), true);
  assert.equal(observe(health, true), false);
});
