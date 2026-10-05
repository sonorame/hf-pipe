import { createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPrivateKey, validateReleaseKeyPair } from "./release-key.mjs";

const DOMAIN = Buffer.from("hf-pipe peer envelope v1\0");
const MAX_PAYLOAD = 40_000;
const MAX_CLOCK_SKEW = 300_000;
const REPLAY_TTL = 2 * MAX_CLOCK_SKEW + 1000;

function identity(value) {
  if (!value?.userId || !value?.deviceId || !value?.publicKey) throw new Error("Incomplete pinned peer identity");
  if (createPublicKey(value.publicKey).asymmetricKeyType !== "ed25519") throw new Error("Peer key must use Ed25519");
  return value;
}

/** A Matrix account sender and a claimed device name alone do not authenticate a device. */
export function createPeerSession({ side, trust, privateKey, now = Date.now, replay = [], saveReplay = () => {} }) {
  if (trust?.version !== 1 || !["dirty", "clean"].includes(side)) throw new Error("Pinned peer trust v1 is required");
  const own = identity(trust[side]);
  const peer = identity(trust[side === "dirty" ? "clean" : "dirty"]);
  if (own.deviceId === peer.deviceId && own.userId === peer.userId) throw new Error("Peer identities must be distinct");
  validateReleaseKeyPair(privateKey, own.publicKey);
  const secret = createPrivateKey(privateKey);
  const publicKey = createPublicKey(peer.publicKey);
  const seen = new Map(replay.filter(([nonce, expires]) => typeof nonce === "string" && Number.isFinite(expires) && expires > now()));
  if (seen.size > 4096) throw new Error("Peer replay cache exceeds its bound");
  return {
    own, peer,
    seal(lane, frame) {
      const raw = Buffer.from(JSON.stringify({ lane, frame, from: own.deviceId, user: own.userId,
        to: peer.deviceId, recipient: peer.userId, issuedAt: now(), nonce: randomUUID() }));
      if (raw.length > MAX_PAYLOAD) throw new Error("Signed peer payload exceeds limit");
      return { hf: 2, payload: raw.toString("base64"), signature: sign(null, Buffer.concat([DOMAIN, raw]), secret).toString("base64") };
    },
    open(envelope, matrixSender) {
      if (matrixSender !== peer.userId || envelope?.hf !== 2 || typeof envelope.payload !== "string" ||
          envelope.payload.length > Math.ceil(MAX_PAYLOAD / 3) * 4 || typeof envelope.signature !== "string" ||
          envelope.signature.length !== 88) return null;
      try {
        const raw = Buffer.from(envelope.payload, "base64");
        const signature = Buffer.from(envelope.signature, "base64");
        if (raw.length > MAX_PAYLOAD || signature.length !== 64 ||
            !verify(null, Buffer.concat([DOMAIN, raw]), publicKey, signature)) return null;
        const payload = JSON.parse(raw.toString("utf8"));
        const timestamp = now();
        if (payload.from !== peer.deviceId || payload.user !== peer.userId || payload.to !== own.deviceId ||
            payload.recipient !== own.userId || !Number.isFinite(payload.issuedAt) ||
            Math.abs(timestamp - payload.issuedAt) > MAX_CLOCK_SKEW ||
            typeof payload.nonce !== "string" || payload.nonce.length > 64 || !payload.nonce ||
            !["rtc", "control", "d2c", "c2d"].includes(payload.lane) || !payload.frame ||
            typeof payload.frame !== "object" || Array.isArray(payload.frame)) return null;
        for (const [nonce, expires] of seen) if (expires <= timestamp) seen.delete(nonce);
        if (seen.has(payload.nonce) || seen.size >= 4096) return null;
        seen.set(payload.nonce, timestamp + REPLAY_TTL);
        // Persist before dispatch: restart cannot make a release control replayable.
        saveReplay([...seen]);
        return payload;
      } catch {
        return null;
      }
    },
  };
}

export function loadPeerSession({ side, session, releaseRoot, secretsRoot, replay, saveReplay }) {
  const trust = JSON.parse(readFileSync(join(releaseRoot, "peer-trust.json"), "utf8"));
  const own = trust[side];
  if (own?.userId !== session.user_id || own?.deviceId !== session.device_id) {
    throw new Error("Matrix session differs from signed peer enrollment; enroll the device before activation");
  }
  return createPeerSession({ side, trust, privateKey: loadPrivateKey(join(secretsRoot, "peer-identity", "release-private.dpapi")), replay, saveReplay });
}
