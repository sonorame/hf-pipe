import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createPeerSession } from "../src/peer-session.mjs";

function fixture() {
  const keys = Object.fromEntries(["dirty", "clean"].map(side => [side, generateKeyPairSync("ed25519")]));
  const trust = { version: 1 };
  for (const side of ["dirty", "clean"]) trust[side] = { userId: "@operator:example.test", deviceId: side,
    publicKey: keys[side].publicKey.export({ type: "spki", format: "pem" }) };
  let clock = 1000000;
  let persisted = [];
  const make = (side, replay = [], saveReplay) => createPeerSession({ side, trust,
    privateKey: keys[side].privateKey.export({ type: "pkcs8", format: "pem" }),
    now: () => clock, replay, saveReplay: saveReplay || (value => { persisted = value; }) });
  return { make, trust, setClock: value => { clock = value; }, persisted: () => persisted };
}

test("only the enrolled peer can authenticate Matrix control and RTC, with durable replay rejection", () => {
  const f = fixture();
  const dirty = f.make("dirty");
  const clean = f.make("clean");
  const env = dirty.seal("control", { id: "activate", type: "release-activate" });
  assert.equal(clean.open(env, "@foreign:example.test"), null);
  assert.equal(clean.open({ hf: 1, from: "dirty", lane: "control", frame: {} }, f.trust.dirty.userId), null);
  assert.equal(clean.open(env, f.trust.dirty.userId).frame.id, "activate");
  assert.equal(clean.open(env, f.trust.dirty.userId), null);
  assert.equal(f.make("clean", f.persisted()).open(env, f.trust.dirty.userId), null);
});

test("tampering, a different key on the same Matrix account, a wrong recipient and expired envelopes fail", () => {
  const f = fixture();
  const dirty = f.make("dirty");
  const clean = f.make("clean");
  const env = dirty.seal("rtc", { id: "offer", type: "offer" });
  const raw = JSON.parse(Buffer.from(env.payload, "base64"));
  raw.frame.type = "answer";
  assert.equal(clean.open({ ...env, payload: Buffer.from(JSON.stringify(raw)).toString("base64") }, f.trust.dirty.userId), null);
  const stranger = fixture().make("dirty");
  assert.equal(clean.open(stranger.seal("rtc", {}), f.trust.dirty.userId), null);
  assert.equal(dirty.open(env, f.trust.dirty.userId), null);
  f.setClock(1300001);
  assert.equal(clean.open(env, f.trust.dirty.userId), null);
});

test("replay storage failure refuses dispatch and oversized payloads are bounded", () => {
  const f = fixture();
  const dirty = f.make("dirty");
  assert.throws(() => dirty.seal("rtc", { data: "x".repeat(40000) }), /limit/);
  const env = dirty.seal("rtc", {});
  assert.equal(f.make("clean", [], () => { throw Error("disk unavailable"); }).open(env, f.trust.dirty.userId), null);
  const replay = f.make("clean", [["old", 1600001]]);
  assert.ok(replay.open(env, f.trust.dirty.userId));
  assert.equal(replay.open({ ...env, payload: "x".repeat(60000) }, f.trust.dirty.userId), null);
});
