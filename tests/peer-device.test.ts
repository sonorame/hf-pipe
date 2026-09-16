import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { pickPeerFromDevices, resolvePeerId, isFreshPeer } from "../src/peer-device.js";

test("failed device list still uses last remembered peer", () => {
  const got = resolvePeerId({
    remembered: { id: "DIRTYPEER", at: 1_000 },
    listFailed: true,
    now: 120_000,
  });
  assert.equal(got.id, "DIRTYPEER");
  assert.equal(got.source, "remembered");
});

test("incoming sender wins when device list fetch failed", () => {
  const got = resolvePeerId({
    remembered: { id: "OLDPEER", at: 1_000 },
    incoming: "FROMDEVICE",
    listFailed: true,
    now: 120_000,
  });
  assert.equal(got.id, "FROMDEVICE");
  assert.equal(got.source, "incoming");
});

test("HF_PEER_DEVICE wins over list and incoming", () => {
  const got = resolvePeerId({
    envPeer: "PINNED",
    listed: "LISTED",
    incoming: "FROMDEVICE",
    remembered: { id: "OLDPEER", at: 1_000 },
    now: 5_000,
  });
  assert.equal(got.id, "PINNED");
  assert.equal(got.source, "env");
});

test("live device list wins over incoming sender", () => {
  const got = resolvePeerId({
    listed: "LISTED",
    incoming: "FROMDEVICE",
    remembered: { id: "OLDPEER", at: 1_000 },
    now: 5_000,
  });
  assert.equal(got.id, "LISTED");
  assert.equal(got.source, "listed");
});

test("pickPeerFromDevices takes newest matching name except self", () => {
  const id = pickPeerFromDevices(
    [
      { device_id: "ME", display_name: "hf-dirty", last_seen_ts: 9 },
      { device_id: "OLD", display_name: "hf-dirty", last_seen_ts: 1 },
      { device_id: "NEW", display_name: "HF-Dirty extra", last_seen_ts: 5 },
    ],
    "ME",
    ["hf-dirty"],
  );
  assert.equal(id, "NEW");
});

test("remembered peer is fresh within 15s", () => {
  assert.equal(isFreshPeer({ id: "X", at: 1_000 }, 14_000), true);
  assert.equal(isFreshPeer({ id: "X", at: 1_000 }, 20_000), false);
  assert.equal(isFreshPeer(null, 5_000), false);
});

test("index.mjs wires peer fallback and error cause", () => {
  const src = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.match(src, /resolvePeerId/);
  assert.match(src, /formatErrorChain/);
  assert.match(src, /from: myDevice/);
});
