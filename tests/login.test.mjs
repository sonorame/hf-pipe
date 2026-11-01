import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadSessionRefreshToken } from "../src/session-auth.mjs";

test("login CLI registers with Matrix metadata and saves a reusable device-code session", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-login-cli-"));
  let registrationError = "";
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/auth/oauth2/registration") {
      const metadata = JSON.parse(raw);
      if (metadata.client_uri !== "https://github.com/sonorame/hf-pipe") {
        registrationError = "missing or invalid client_uri";
        res.writeHead(400).end(JSON.stringify({ error: "invalid_client_metadata", error_description: registrationError }));
        return;
      }
      res.end(JSON.stringify({ client_id: "fixture-client" }));
    } else if (req.url === "/auth/oauth2/device") {
      res.end(JSON.stringify({ verification_uri: "https://example.org/verify", device_code: "fixture-code", user_code: "TEST-CODE", interval: 1, expires_in: 30 }));
    } else if (req.url === "/auth/oauth2/token") {
      res.end(JSON.stringify({ access_token: "fixture-access", refresh_token: "fixture-refresh", expires_in: 3600 }));
    } else if (req.url === "/_matrix/client/v3/account/whoami") {
      assert.equal(req.headers.authorization, "Bearer fixture-access");
      res.end(JSON.stringify({ user_id: "@fixture:example.org" }));
    } else {
      res.writeHead(404).end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sessionPath = join(dir, "matrix-session.json");
  const child = spawn(process.execPath, [fileURLToPath(new URL("../src/login.mjs", import.meta.url))], {
    env: { ...process.env, HF_ENV_FILE: "", HF_SIDE: "dirty", HF_DEVICE_NAME: "hf-dirty-test", HF_OPEN_BROWSER: "0", HF_LOGIN_PORT: "0", HF_SECRETS_DIR: dir, MATRIX_SESSION_FILE: sessionPath, HF_OAUTH_CLIENT_FILE: join(dir, "client.json"), MATRIX_HOMESERVER_URL: base, MATRIX_OIDC_ISSUER: `${base}/auth/` },
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => output += chunk);
  child.stderr.on("data", (chunk) => output += chunk);
  const timer = setTimeout(() => child.kill(), 30000);
  t.after(async () => {
    clearTimeout(timer);
    child.kill();
    await new Promise((resolve) => server.close(resolve));
    assert.ok(dir.startsWith(join(tmpdir(), "hf-login-cli-")));
    rmSync(dir, { recursive: true, force: true });
  });
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  assert.equal(code, 0, registrationError || output);
  assert.match(output, /TEST-CODE/);
  const session = JSON.parse(readFileSync(sessionPath, "utf8"));
  assert.equal(session.user_id, "@fixture:example.org");
  assert.equal(session.access_token, "fixture-access");
  assert.equal(loadSessionRefreshToken(session, dir), "fixture-refresh");
  assert.ok(session.expires_at > Date.now() + 3500_000, "saved session must include its access-token expiry");
  if (process.platform !== "win32") assert.equal(statSync(sessionPath).mode & 0o777, 0o600);
});
