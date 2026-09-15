import { createServer } from "http";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { platform } from "os";
import { spawn } from "child_process";
import {
  loadEnvFile,
  sessionFile,
  oauthClientFile,
  homeserverUrl,
  oidcIssuer,
  deviceDisplayName,
} from "./config.mjs";
import { applyNodeNetworkPolicy } from "../dist/network-policy.js";

loadEnvFile();
applyNodeNetworkPolicy();

const HOMESERVER = homeserverUrl();
const ISSUER = oidcIssuer();
const SESSION_PATH = sessionFile();
const CLIENT_PATH = oauthClientFile();
const PORT = Number(process.env.HF_LOGIN_PORT || 18767);
const DEVICE_NAME = deviceDisplayName(process.env.HF_SIDE || "clean");

function saveJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2), "utf8");
}

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function openBrowser(url) {
  if (!url) return;
  if (String(process.env.HF_OPEN_BROWSER || "1") === "0") return;
  const p = platform();
  try {
    if (p === "win32") spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true, windowsHide: true });
    else if (p === "darwin") spawn("open", [url], { stdio: "ignore", detached: true });
    else spawn("xdg-open", [url], { stdio: "ignore", detached: true });
  } catch {
    // print URL below
  }
}

async function formPost(url, params) {
  const body = new URLSearchParams(params).toString();
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

function newDeviceId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "HFM";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function registerClient() {
  let client = loadJson(CLIENT_PATH);
  if (client?.client_id) return client;
  const res = await fetch(`${ISSUER}oauth2/registration`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: DEVICE_NAME,
      application_type: "native",
      token_endpoint_auth_method: "none",
      grant_types: [
        "urn:ietf:params:oauth:grant-type:device_code",
        "refresh_token",
        "authorization_code",
      ],
      response_types: ["code"],
      redirect_uris: [`http://127.0.0.1:${PORT}/callback`],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error("OAuth registration failed:", res.status, text);
    return null;
  }
  client = JSON.parse(text);
  saveJson(CLIENT_PATH, { client_id: client.client_id });
  return { client_id: client.client_id };
}

async function deviceCodeLogin(clientId) {
  const deviceId = newDeviceId();
  const scope = [
    "openid",
    "urn:matrix:client:api:*",
    `urn:matrix:client:device:${deviceId}`,
  ].join(" ");
  const start = await formPost(`${ISSUER}oauth2/device`, {
    client_id: clientId,
    scope,
  });
  const startText = await start.text();
  if (!start.ok) {
    console.error("Device code failed:", start.status, startText);
    return null;
  }
  const data = JSON.parse(startText);
  const url = data.verification_uri_complete || data.verification_uri;
  console.error("Open in browser and confirm the device:");
  console.error(url);
  if (url) openBrowser(url);
  const intervalMs = Math.max(2, data.interval || 5) * 1000;
  const deadline = Date.now() + (data.expires_in || 900) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const tok = await formPost(`${ISSUER}oauth2/token`, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: data.device_code,
      client_id: clientId,
    });
    const tokText = await tok.text();
    if (tok.ok) {
      const body = JSON.parse(tokText);
      return { ...body, device_id: deviceId, client_id: clientId };
    }
    let err = {};
    try {
      err = JSON.parse(tokText);
    } catch {
      err = { error: tokText };
    }
    if (err.error === "authorization_pending" || err.error === "slow_down") {
      continue;
    }
    console.error("Token poll failed:", tok.status, tokText);
    return null;
  }
  console.error("Device login timed out");
  return null;
}

function waitSsoLoginToken() {
  return new Promise((resolve, reject) => {
    const redirect = `http://127.0.0.1:${PORT}/callback`;
    const sso = `${HOMESERVER}/_matrix/client/v3/login/sso/redirect?redirectUrl=${encodeURIComponent(redirect)}`;
    const server = createServer((req, res) => {
      const u = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      const token = u.searchParams.get("loginToken") || u.searchParams.get("login_token");
      if (!token) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("No loginToken");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<p>Login ok. Window can be closed.</p>");
      server.close();
      resolve(token);
    });
    server.listen(PORT, process.env.HF_RPC_BIND || "127.0.0.1", () => {
      console.error("Open in browser:");
      console.error(sso);
      openBrowser(sso);
    });
    server.on("error", reject);
  });
}

async function tokenLogin(loginToken) {
  const res = await fetch(`${HOMESERVER}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.token",
      token: loginToken,
      initial_device_display_name: DEVICE_NAME,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`m.login.token failed (${res.status}): ${text}`);
  return JSON.parse(text);
}

async function fillUserId(session) {
  if (session.user_id) return session;
  const res = await fetch(`${session.homeserver}/_matrix/client/v3/account/whoami`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const body = await res.json();
  if (body.user_id) session.user_id = body.user_id;
  if (body.device_id && !session.device_id) session.device_id = body.device_id;
  return session;
}

async function main() {
  if (!HOMESERVER) {
    console.error("Set MATRIX_HOMESERVER_URL in .env");
    process.exit(1);
  }
  console.error("Homeserver:", HOMESERVER);
  console.error("Device name:", DEVICE_NAME);
  const client = await registerClient();
  let tokens = null;
  if (client?.client_id) {
    tokens = await deviceCodeLogin(client.client_id);
  }
  if (!tokens?.access_token) {
    console.error("Fallback: SSO redirect + m.login.token");
    const loginToken = await waitSsoLoginToken();
    const logged = await tokenLogin(loginToken);
    tokens = {
      access_token: logged.access_token,
      refresh_token: logged.refresh_token,
      device_id: logged.device_id,
      user_id: logged.user_id,
      client_id: client?.client_id,
    };
  }
  let session = {
    homeserver: HOMESERVER,
    issuer: ISSUER,
    token_endpoint: `${ISSUER}oauth2/token`,
    client_id: tokens.client_id || client?.client_id,
    user_id: tokens.user_id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    device_id: tokens.device_id,
  };
  session = await fillUserId(session);
  saveJson(SESSION_PATH, session);
  console.error("Session saved:", SESSION_PATH);
  console.error("Next: npm start --", process.env.HF_SIDE || "clean");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
