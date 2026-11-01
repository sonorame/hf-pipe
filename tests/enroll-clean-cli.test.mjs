import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ENROLLMENT_EVENT_TYPE, acceptEnrollmentRequest, createEnrollmentAck } from "../src/peer-enrollment.mjs";

test("clean setup replaces an expired legacy Matrix login and enrolls only its public identity", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-clean-enroll-"));
  const userId = "@fixture:example.org";
  const dirty = { userId, deviceId: "VPS", publicKey: generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }) };
  const capability = { token: "fixture-enrollment-capability", expiresAt: Date.now() + 3600_000 };
  let reply = null;
  let newDevice = "";
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/auth/oauth2/registration") res.end(JSON.stringify({ client_id: "fixture-client" }));
    else if (req.url === "/auth/oauth2/device") {
      newDevice = new URLSearchParams(raw).get("scope").match(/urn:matrix:client:device:(\S+)/)[1];
      res.end(JSON.stringify({ verification_uri: "https://example.org/verify", user_code: "TEST-CODE", device_code: "fixture", interval: 1, expires_in: 60 }));
    } else if (req.url === "/auth/oauth2/token") res.end(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }));
    else if (req.headers.authorization !== "Bearer new-access") res.writeHead(401).end(JSON.stringify({ errcode: "M_UNKNOWN_TOKEN" }));
    else if (req.url === "/_matrix/client/v3/account/whoami") res.end(JSON.stringify({ user_id: userId, device_id: newDevice }));
    else if (req.url.startsWith("/_matrix/client/v3/sync")) {
      res.end(JSON.stringify({ next_batch: "next", to_device: { events: reply ? [reply] : [] } }));
      reply = null;
    } else if (req.url.startsWith(`/_matrix/client/v3/sendToDevice/${ENROLLMENT_EVENT_TYPE}/`)) {
      assert.ok(!raw.includes("PRIVATE KEY"));
      const envelope = JSON.parse(raw).messages[userId].VPS;
      const accepted = acceptEnrollmentRequest(envelope, { sender: userId, capability, dirty });
      reply = { type: ENROLLMENT_EVENT_TYPE, sender: userId, content: createEnrollmentAck(accepted, capability.token) };
      res.end("{}");
    } else res.writeHead(404).end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sessionPath = join(dir, "matrix-session.json");
  const trustPath = join(dir, "peer-trust.json");
  const bundlePath = join(dir, "enrollment.json");
  writeFileSync(sessionPath, JSON.stringify({ homeserver: base, user_id: userId, device_id: "OLD", access_token: "expired" }));
  writeFileSync(bundlePath, JSON.stringify({ homeserver: base, dirty, ...capability }));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/enroll-clean-vps.mjs", import.meta.url)), bundlePath], {
    env: { ...process.env, HF_ENV_FILE: "", HF_SIDE: "clean", HF_OPEN_BROWSER: "0", HF_SECRETS_DIR: dir, MATRIX_SESSION_FILE: sessionPath, HF_OAUTH_CLIENT_FILE: join(dir, "client.json"), MATRIX_HOMESERVER_URL: base, MATRIX_OIDC_ISSUER: `${base}/auth/`, HF_PEER_TRUST_FILE: trustPath },
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => output += chunk);
  child.stderr.on("data", (chunk) => output += chunk);
  const timer = setTimeout(() => child.kill(), 60000);
  t.after(async () => {
    clearTimeout(timer); child.kill();
    await new Promise((resolve) => server.close(resolve));
    assert.ok(dir.startsWith(join(tmpdir(), "hf-clean-enroll-")));
    rmSync(dir, { recursive: true, force: true });
  });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(code, 0, output);
  const trust = JSON.parse(readFileSync(trustPath, "utf8"));
  assert.equal(trust.clean.deviceId, newDevice);
  assert.equal(trust.dirty.deviceId, "VPS");
  assert.ok(newDevice !== "OLD");
});
