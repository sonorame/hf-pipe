import { readFileSync, writeFileSync, mkdirSync, renameSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnvFile, secretsDir, sessionFile } from "../src/config.mjs";
import { pinnedFetch, applyNodeNetworkPolicy } from "../dist/network-policy.js";
import { ensureReleaseKeyPair } from "../src/release-key.mjs";
import { refreshSession, sessionNeedsRefresh } from "../src/session-auth.mjs";
import { ENROLLMENT_EVENT_TYPE, createEnrollmentRequest, verifyEnrollmentAck } from "../src/peer-enrollment.mjs";

loadEnvFile();
applyNodeNetworkPolicy();
const bundle = JSON.parse(readFileSync(process.argv[2], "utf8"));
let session = JSON.parse(readFileSync(sessionFile(), "utf8"));
function save(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + ".tmp";
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  if (process.platform !== "win32") chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}
async function renew() {
  try {
    session = await refreshSession(session, { secretsDir: secretsDir(), fetchFn: pinnedFetch });
    save(sessionFile(), session);
  } catch (error) {
    if (!/refresh token unavailable|refresh configuration missing|token refresh 4\d\d/i.test(error.message)) throw error;
    console.error("Confirm a fresh Matrix sign-in in the browser.");
    const login = spawnSync(process.execPath, [fileURLToPath(new URL("../src/login.mjs", import.meta.url))], { env: process.env, stdio: "inherit", windowsHide: true });
    if (login.status !== 0) throw new Error("Matrix sign-in was not completed");
    session = JSON.parse(readFileSync(sessionFile(), "utf8"));
  }
}
async function matrix(path, options = {}) {
  if (sessionNeedsRefresh(session)) await renew();
  const request = () => pinnedFetch(`${session.homeserver}${path}`, {
    ...options, headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
  });
  let response = await request();
  if (response.status === 401) { await renew(); response = await request(); }
  if (!response.ok) throw new Error(`Matrix enrollment HTTP ${response.status}`);
  return response.json();
}
await matrix("/_matrix/client/v3/account/whoami");
if (session.homeserver !== bundle.homeserver || session.user_id !== bundle.dirty.userId) throw new Error("Use the same Matrix account as the VPS");
const keys = ensureReleaseKeyPair(join(secretsDir(), "peer-identity"));
const clean = { userId: session.user_id, deviceId: session.device_id, publicKey: keys.publicKey };
const request = createEnrollmentRequest(clean, bundle);
const filter = encodeURIComponent(JSON.stringify({ room: { rooms: [] }, presence: { not_types: ["*"] }, account_data: { not_types: ["*"] } }));
let sync = await matrix(`/_matrix/client/v3/sync?timeout=0&filter=${filter}`);
const deadline = Date.now() + 300_000;
let lastSent = 0;
console.error("Connecting this clean device to the VPS through Matrix...");
while (Date.now() < deadline) {
  if (Date.now() - lastSent > 15000) {
    await matrix(`/_matrix/client/v3/sendToDevice/${ENROLLMENT_EVENT_TYPE}/${randomUUID()}`, {
      method: "PUT", body: JSON.stringify({ messages: { [bundle.dirty.userId]: { [bundle.dirty.deviceId]: request } } }),
    });
    lastSent = Date.now();
  }
  sync = await matrix(`/_matrix/client/v3/sync?timeout=10000&since=${encodeURIComponent(sync.next_batch)}&filter=${filter}`);
  for (const event of sync.to_device?.events || []) {
    if (event.type !== ENROLLMENT_EVENT_TYPE || event.sender !== bundle.dirty.userId) continue;
    const trust = verifyEnrollmentAck(event.content, { request, clean, dirty: bundle.dirty, token: bundle.token });
    if (!trust) continue;
    if (!process.env.HF_PEER_TRUST_FILE) throw new Error("HF_PEER_TRUST_FILE is required for initial enrollment");
    save(process.env.HF_PEER_TRUST_FILE, trust);
    console.error("VPS enrollment confirmed. Private device key stays on this computer.");
    process.exit(0);
  }
}
throw new Error("VPS enrollment timed out; keep this package and retry");
