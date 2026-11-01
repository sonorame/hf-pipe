import { createHmac, createPublicKey, randomUUID, timingSafeEqual } from "node:crypto";

export const ENROLLMENT_EVENT_TYPE = "org.hf.pipe.enrollment";

function seal(value, token) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64");
  return { version: 1, payload, mac: createHmac("sha256", token).update(payload).digest("hex") };
}

function open(envelope, token) {
  if (envelope?.version !== 1 || typeof envelope.payload !== "string" || envelope.payload.length > 12000 ||
      typeof envelope.mac !== "string" || !/^[0-9a-f]{64}$/.test(envelope.mac)) throw new Error("Enrollment authentication failed");
  const expected = createHmac("sha256", token).update(envelope.payload).digest();
  if (!timingSafeEqual(expected, Buffer.from(envelope.mac, "hex"))) throw new Error("Enrollment authentication failed");
  return JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
}

function validateDescriptor(value) {
  if (!value?.userId || !value?.deviceId || typeof value.publicKey !== "string" ||
      createPublicKey(value.publicKey).asymmetricKeyType !== "ed25519") throw new Error("Invalid enrollment identity");
}

export function createEnrollmentRequest(clean, { dirty, token, expiresAt, now = Date.now() }) {
  validateDescriptor(clean);
  validateDescriptor(dirty);
  if (now >= expiresAt) throw new Error("Enrollment capability expired");
  return seal({ operation: "enroll-clean", clean, dirtyDeviceId: dirty.deviceId, issuedAt: now, nonce: randomUUID() }, token);
}

export function acceptEnrollmentRequest(envelope, { sender, capability, dirty, now = Date.now() }) {
  if (!capability?.token || !Number.isFinite(capability.expiresAt) || now >= capability.expiresAt) throw new Error("Enrollment capability expired");
  const request = open(envelope, capability.token);
  validateDescriptor(request.clean);
  if (request.operation !== "enroll-clean" || request.dirtyDeviceId !== dirty.deviceId ||
      sender !== dirty.userId || request.clean.userId !== sender || request.clean.deviceId === dirty.deviceId ||
      !Number.isFinite(request.issuedAt) || Math.abs(now - request.issuedAt) > 300_000 ||
      typeof request.nonce !== "string" || !request.nonce || request.nonce.length > 64) throw new Error("Invalid enrollment request");
  if (capability.enrolled && JSON.stringify(capability.enrolled) !== JSON.stringify(request.clean)) throw new Error("Enrollment capability already used");
  return { trust: { version: 1, dirty, clean: request.clean }, requestNonce: request.nonce };
}

export function createEnrollmentAck(accepted, token) {
  return seal({ operation: "enrolled-clean", ...accepted }, token);
}

export function verifyEnrollmentAck(envelope, { request, clean, dirty, token }) {
  try {
    const ack = open(envelope, token);
    const sent = open(request, token);
    if (ack.operation !== "enrolled-clean" || ack.requestNonce !== sent.nonce ||
        JSON.stringify(ack.trust) !== JSON.stringify({ version: 1, dirty, clean })) return null;
    return ack.trust;
  } catch {
    return null;
  }
}
