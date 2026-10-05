import assert from "node:assert/strict";
import test from "node:test";
import {
  HOP_PROTOCOL_VERSION,
  decorateControlFrame,
  hopProtocolVersion,
  validateControlFrame,
} from "../src/protocol-version.mjs";

test("default hop protocol is 3", () => {
  assert.equal(HOP_PROTOCOL_VERSION, 3);
  assert.equal(hopProtocolVersion({}, {}), 3);
});

test("protocol 2 vs 3 handshake is a mismatch", () => {
  const prev = process.env.HF_PROTOCOL_VERSION;
  delete process.env.HF_PROTOCOL_VERSION;
  try {
    const frame = decorateControlFrame({ id: "s1", type: "sdp", sdpType: "offer" }, { buildId: "build-a" });
    assert.equal(frame.protocolVersion, 3);
    assert.equal(validateControlFrame(frame).ok, true);
    assert.deepEqual(validateControlFrame({ ...frame, protocolVersion: 2 }), {
      ok: false,
      reason: "protocol mismatch local=3 remote=2",
      remoteBuildId: "build-a",
    });
  } finally {
    if (prev != null) process.env.HF_PROTOCOL_VERSION = prev;
    else delete process.env.HF_PROTOCOL_VERSION;
  }
});
