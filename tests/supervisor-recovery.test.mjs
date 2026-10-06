import assert from "node:assert/strict";
import test from "node:test";
import { createSupervisorRecovery } from "../src/supervisor-recovery.mjs";

test("a host pause grants a fresh heartbeat window without killing a healthy child", () => {
  const s = createSupervisorRecovery({ now: 0 });
  s.report(1000, "ready");
  s.report(2000, "running");
  s.check(2000, { rtc: true });
  assert.equal(s.check(3_600_000, { rtc: false, matrixSyncAgeMs: 3_600_000 }).resumed, true);
  s.report(3_601_000, "running");
  for (let t = 3_601_000; t <= 3_614_000; t += 1000) assert.equal(s.check(t, { rtc: false, matrixSyncAgeMs: 3_600_000 }).reason, undefined);
  s.report(3_615_000, "running");
  assert.deepEqual(s.check(3_615_000, { rtc: true, matrixSyncAgeMs: 0 }), {});
});

test("a child-only hang is restarted while the supervisor keeps ticking", () => {
  const s = createSupervisorRecovery({ now: 0 });
  s.report(0, "ready");
  for (let t = 1000; t < 15_000; t += 1000) assert.equal(s.check(t, { rtc: true }).reason, undefined);
  assert.equal(s.check(15_000, { rtc: true }).reason, "supervisor heartbeat stalled");
});

test("a child that stays hung after host resume does not receive unlimited grace", () => {
  const s = createSupervisorRecovery({ now: 0 });
  s.report(0, "ready");
  assert.equal(s.check(3_600_000).resumed, true);
  for (let t = 3_601_000; t < 3_615_000; t += 1000) s.check(t);
  assert.equal(s.check(3_615_000).reason, "supervisor heartbeat stalled");
});

test("ongoing boot messages cannot bypass startup readiness", () => {
  const s = createSupervisorRecovery({ now: 0 });
  for (let t = 1000; t < 30_000; t += 1000) { s.report(t, "booted"); s.check(t); }
  s.report(30_000, "booted");
  assert.equal(s.check(30_000).reason, "startup readiness deadline");
});

test("missing Matrix timestamps do not falsely establish a stale Matrix connection", () => {
  const s = createSupervisorRecovery({ now: 0 });
  s.report(0, "ready");
  for (let t = 1000; t <= 30_000; t += 1000) {
    s.report(t, "running");
    assert.equal(s.check(t, { rtc: false, matrixSyncAgeMs: null }).reason, undefined);
  }
});

test("a real Matrix outage with fresh process heartbeats still recycles automatically", () => {
  const s = createSupervisorRecovery({ now: 0 });
  s.report(0, "ready");
  for (let t = 1000; t < 11_000; t += 1000) { s.report(t, "running"); s.check(t, { rtc: false, matrixSyncAgeMs: 25_000 }); }
  s.report(11_000, "running");
  assert.match(s.check(11_000, { rtc: false, matrixSyncAgeMs: 25_000 }).reason, /Matrix sync stale/);
});
