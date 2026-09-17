import assert from "node:assert/strict";
import test from "node:test";
import { shouldRecycleAfterClockJump, shouldExitOnSyncDead } from "../src/watchdog-clock.js";

test("clock jump after hibernate recycle is required", () => {
  const prev = Date.parse("2026-09-14T15:36:00Z");
  const now = Date.parse("2026-09-15T04:53:31Z");
  assert.equal(shouldRecycleAfterClockJump(prev, now), true);
});

test("normal 5s tick does not recycle", () => {
  assert.equal(shouldRecycleAfterClockJump(1_000, 6_000), false);
});

test("hop does not exit when Matrix sync is stale but RTC is up", () => {
  assert.equal(
    shouldExitOnSyncDead({
      rtcUp: true,
      lastOkMs: 0,
      nowMs: 180_000,
      deadMs: 120_000,
    }),
    false,
  );
});

test("hop exits when Matrix sync is stale and RTC is down", () => {
  assert.equal(
    shouldExitOnSyncDead({
      rtcUp: false,
      lastOkMs: 0,
      nowMs: 180_000,
      deadMs: 120_000,
    }),
    true,
  );
});

test("rtc drop does not exit just because sync was quiet while the pipe was up", () => {
  assert.equal(
    shouldExitOnSyncDead({
      rtcUp: false,
      lastOkMs: 0,
      nowMs: 900_000,
      deadMs: 600_000,
      rtcDownSinceMs: 890_000,
    }),
    false,
  );
});

test("after rtc drop, exit only when sync stays dead for the full window", () => {
  assert.equal(
    shouldExitOnSyncDead({
      rtcUp: false,
      lastOkMs: 0,
      nowMs: 900_000,
      deadMs: 600_000,
      rtcDownSinceMs: 200_000,
    }),
    true,
  );
});

test("sync that recovers after rtc drop does not exit", () => {
  assert.equal(
    shouldExitOnSyncDead({
      rtcUp: false,
      lastOkMs: 895_000,
      nowMs: 900_000,
      deadMs: 600_000,
      rtcDownSinceMs: 100_000,
    }),
    false,
  );
});

test("index.mjs does not kill hop while RTC is up", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.match(src, /shouldExitOnSyncDead/);
  assert.match(src, /isRtcUp/);
  assert.match(src, /rtcDownSinceMs/);
});
