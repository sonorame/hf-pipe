export const CLOCK_JUMP_RECYCLE_MS = 60_000;
export function shouldRecycleAfterClockJump(prevMs, nowMs, minGapMs = CLOCK_JUMP_RECYCLE_MS) {
    return nowMs - prevMs > minGapMs;
}
//# sourceMappingURL=watchdog-clock.js.map