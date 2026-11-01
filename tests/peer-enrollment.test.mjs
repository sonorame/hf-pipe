import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { createEnrollmentRequest, acceptEnrollmentRequest, createEnrollmentAck, verifyEnrollmentAck } from "../src/peer-enrollment.mjs";

const now = 1_000_000;
const descriptor = (deviceId) => ({ userId: "@fixture:example.org", deviceId, publicKey: generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }) });
const dirty = descriptor("VPS");
const clean = descriptor("WORK-CLEAN");
const capability = { token: "fixture-enrollment-secret", expiresAt: now + 86400_000 };

test("a clean install can enroll its public identity through Matrix and verify the reply", () => {
  const request = createEnrollmentRequest(clean, { dirty, ...capability, now });
  const accepted = acceptEnrollmentRequest(request, { sender: clean.userId, capability, dirty, now });
  assert.deepEqual(accepted.trust, { version: 1, dirty, clean });
  const ack = createEnrollmentAck(accepted, capability.token);
  assert.deepEqual(verifyEnrollmentAck(ack, { request, clean, dirty, token: capability.token }), accepted.trust);
});

test("an enrollment capability is idempotent for its clean and cannot enroll a second identity", () => {
  const request = createEnrollmentRequest(clean, { dirty, ...capability, now });
  const accepted = acceptEnrollmentRequest(request, { sender: clean.userId, capability, dirty, now });
  const used = { ...capability, enrolled: clean };
  assert.deepEqual(acceptEnrollmentRequest(request, { sender: clean.userId, capability: used, dirty, now }).trust, accepted.trust);
  const other = createEnrollmentRequest(descriptor("OTHER-CLEAN"), { dirty, ...capability, now });
  assert.throws(() => acceptEnrollmentRequest(other, { sender: clean.userId, capability: used, dirty, now }), /already used/);
});

test("a modified enrollment request or an expired capability cannot change peer trust", () => {
  const request = createEnrollmentRequest(clean, { dirty, ...capability, now });
  assert.throws(() => acceptEnrollmentRequest({ ...request, mac: "00".repeat(32) }, { sender: clean.userId, capability, dirty, now }), /authentication/);
  assert.throws(() => acceptEnrollmentRequest(request, { sender: clean.userId, capability, dirty, now: capability.expiresAt + 1 }), /expired/);
});
