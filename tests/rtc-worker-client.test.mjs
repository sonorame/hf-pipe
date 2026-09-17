import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createRtcWorkerClient } from "../src/rtc-worker-client.mjs";
import { decorateControlFrame, validateControlFrame } from "../src/protocol-version.mjs";

class FakeChild extends EventEmitter {
  sent = [];
  send(message) {
    this.sent.push(message);
  }
  kill() {}
}

test("supervisor proxies RTC calls and status through local IPC", async () => {
  const child = new FakeChild();
  const client = createRtcWorkerClient({ child, timeoutMs: 1000 });
  child.emit("message", {
    kind: "status",
    snapshot: { dc: "open", connection: "connected", ice: "connected", signaling: "stable" },
  });
  assert.equal(client.isRtcUp(), true);

  const pending = client.rtcCall({ id: "q1", type: "ping", body: {} }, 1000);
  assert.deepEqual(child.sent.at(-1), {
    kind: "call",
    requestId: "q1",
    frame: { id: "q1", type: "ping", body: {} },
    timeoutMs: 1000,
  });
  child.emit("message", { kind: "call-result", requestId: "q1", result: { ok: true } });
  assert.deepEqual(await pending, { ok: true });
});

test("protocol handshake rejects mixed worker builds before SDP is applied", () => {
  const frame = decorateControlFrame(
    { id: "s1", type: "sdp", sdpType: "offer", buildId: "target-release" },
    { buildId: "build-a", protocolVersion: 2 },
  );
  assert.equal(frame.buildId, "target-release");
  assert.equal(frame.senderBuildId, "build-a");
  assert.equal(validateControlFrame(frame, { protocolVersion: 2 }).ok, true);
  assert.deepEqual(validateControlFrame(frame, { protocolVersion: 3 }), {
    ok: false,
    reason: "protocol mismatch local=3 remote=2",
    remoteBuildId: "build-a",
  });
});
