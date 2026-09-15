import assert from "node:assert/strict";
import test from "node:test";
import { shouldRecycleAfterClockJump } from "../src/watchdog-clock.js";

test("clock jump after hibernate recycle is required", () => {
  const prev = Date.parse("2026-09-14T15:36:00Z");
  const now = Date.parse("2026-09-15T04:53:31Z");
  assert.equal(shouldRecycleAfterClockJump(prev, now), true);
});

test("normal 5s tick does not recycle", () => {
  assert.equal(shouldRecycleAfterClockJump(1_000, 6_000), false);
});
