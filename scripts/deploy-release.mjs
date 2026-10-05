import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { loadEnvFile, localDir, sessionFile } from "../src/config.mjs";
import { applyNodeNetworkPolicy, pinnedFetch } from "../dist/network-policy.js";
import { decorateControlFrame } from "../src/protocol-version.mjs";
import { promoteRelease } from "../src/release-runtime.mjs";
import { packRelease, uploadReleaseMedia } from "../src/release-transfer.mjs";

loadEnvFile();
applyNodeNetworkPolicy();

const runtimeRoot = process.argv[2];
const requestedBuild = process.argv[3] || "";
if (!runtimeRoot) {
  console.error("usage: node scripts/deploy-release.mjs <dirty-runtime-root> [build-id]");
  process.exit(1);
}

const state = JSON.parse(readFileSync(join(runtimeRoot, "state.json"), "utf8"));
const buildId = requestedBuild || state.current;
const releaseDir = join(runtimeRoot, "releases", buildId);
if (!existsSync(releaseDir)) throw new Error(`release not found ${buildId}`);
const manifest = JSON.parse(readFileSync(join(releaseDir, "release-manifest.json"), "utf8"));
const session = JSON.parse(readFileSync(sessionFile(), "utf8"));
const homeserver = String(session.homeserver || process.env.MATRIX_HOMESERVER_URL || "").replace(/\/$/, "");
const token = session.access_token;
const ownDevice = session.device_id;
if (!homeserver || !token || !ownDevice) throw new Error("dirty Matrix session is incomplete");

const devicesResponse = await pinnedFetch(`${homeserver}/_matrix/client/v3/devices`, {
  headers: { Authorization: `Bearer ${token}` },
});
const devicesText = await devicesResponse.text();
if (!devicesResponse.ok) throw new Error(`devices ${devicesResponse.status} ${devicesText.slice(0, 200)}`);
const devices = JSON.parse(devicesText).devices || [];
const peer = devices
  .filter((device) => device.device_id && device.device_id !== ownDevice)
  .filter((device) => /hf-matrix/i.test(String(device.display_name || "")))
  .sort((a, b) => Number(b.last_seen_ts || 0) - Number(a.last_seen_ts || 0))[0]?.device_id;
if (!peer) throw new Error("clean hf-matrix device not found");

const outgoingDir = join(runtimeRoot, "outgoing");
mkdirSync(outgoingDir, { recursive: true });
const archiveFlag = process.argv.indexOf("--archive");
const archivePath = archiveFlag >= 0 ? process.argv[archiveFlag + 1] : join(outgoingDir, `${buildId}.zip`);
if (!archivePath) throw new Error("--archive requires a path");
const packed = archiveFlag >= 0
  ? { size: readFileSync(archivePath).length, sha256: createHash("sha256").update(readFileSync(archivePath)).digest("hex") }
  : packRelease(releaseDir, archivePath);
const media = await uploadReleaseMedia({
  homeserver,
  accessToken: token,
  archivePath,
  fetchFn: pinnedFetch,
});

async function sendControl(frame) {
  const txn = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const url = `${homeserver}/_matrix/client/v3/sendToDevice/${encodeURIComponent(
    process.env.HF_EVENT_TYPE || "org.hf.pipe",
  )}/${txn}`;
  const response = await pinnedFetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: {
        [session.user_id]: {
          [peer]: {
            hf: 1,
            lane: "control",
            from: ownDevice,
            frame: decorateControlFrame(frame, {
              buildId: manifest.buildId,
              protocolVersion: manifest.protocolVersion,
            }),
          },
        },
      },
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`send control ${response.status} ${text.slice(0, 200)}`);
}

async function waitAck(id, type, timeoutMs = 180_000) {
  const path = join(localDir(), "control", `${id}.json`);
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!existsSync(path)) continue;
    const frame = JSON.parse(readFileSync(path, "utf8"));
    if (frame.type === type && frame.ok && frame.id === id) return frame;
  }
  throw new Error(`clean did not acknowledge ${type}`);
}

const stageId = `release-stage-${Date.now()}`;
rmSync(join(localDir(), "control", `${stageId}.json`), { force: true });
await sendControl({
  id: stageId,
  type: "release-stage",
  buildId,
  mxc: media.mxc,
  sha256: packed.sha256,
  size: packed.size,
});
await waitAck(stageId, "release-staged");

const activateId = `release-activate-${Date.now()}`;
const activateAt = Date.now() + 8000;
rmSync(join(localDir(), "control", `${activateId}.json`), { force: true });
await sendControl({ id: activateId, type: "release-activate", buildId, activateAt });
promoteRelease(runtimeRoot, buildId);
await waitAck(activateId, "release-activated", 30_000);

const wait = Math.max(0, activateAt - Date.now());
if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
try {
  await pinnedFetch("http://127.0.0.1:18765/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"action":"restart"}',
  });
} catch {
  // The request succeeds by terminating the current dirty supervisor.
}
console.log(JSON.stringify({ ok: true, buildId, peer, mxc: media.mxc }));
