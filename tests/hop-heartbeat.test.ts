import assert from "node:assert/strict";
import test from "node:test";
import { heartbeatShouldRecycle, RTC_HEARTBEAT_MISS_MS } from "../src/hop-heartbeat.js";

test("no recycle while the pipe looks down", () => {
  assert.equal(
    heartbeatShouldRecycle({ rtcLooksUp: false, lastPongAt: 0, openedAt: 1_000, now: 60_000 }),
    false,
  );
});

test("first seconds after open wait for the first pong", () => {
  assert.equal(
    heartbeatShouldRecycle({ rtcLooksUp: true, lastPongAt: 0, openedAt: 1_000, now: 5_000 }),
    false,
  );
});

test("no pong after the miss window recycles", () => {
  assert.equal(
    heartbeatShouldRecycle({
      rtcLooksUp: true,
      lastPongAt: 0,
      openedAt: 1_000,
      now: 1_000 + RTC_HEARTBEAT_MISS_MS + 1,
    }),
    true,
  );
});

test("stale pong recycles even when rtc still looks up", () => {
  assert.equal(
    heartbeatShouldRecycle({ rtcLooksUp: true, lastPongAt: 1_000, openedAt: 1_000, now: 25_000 }),
    true,
  );
});

test("fresh pong keeps the pipe", () => {
  assert.equal(
    heartbeatShouldRecycle({ rtcLooksUp: true, lastPongAt: 20_000, openedAt: 1_000, now: 25_000 }),
    false,
  );
});
