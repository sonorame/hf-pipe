import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SRC_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = join(SRC_DIR, "..");

function stripQuotes(value) {
  const v = String(value ?? "").trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

export function loadEnvFile() {
  const extra = process.env.HF_ENV_FILE;
  const files = [extra, join(ROOT_DIR, ".env"), join(SRC_DIR, ".env")].filter(Boolean);
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const text = line.trim();
      if (!text || text.startsWith("#")) continue;
      const i = text.indexOf("=");
      if (i < 1) continue;
      const key = text.slice(0, i).trim();
      const value = stripQuotes(text.slice(i + 1));
      if (!key) continue;
      if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
    }
  }
}

export function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function firstExisting(paths) {
  return paths.find((p) => p && existsSync(p));
}

export function secretsDir() {
  if (process.env.HF_SECRETS_DIR) return process.env.HF_SECRETS_DIR;
  const next = join(homeDir(), ".hf-pipe", "secrets");
  const legacy = join(homeDir(), ".cursor", "secrets");
  return firstExisting([next, legacy]) || next;
}

export function sessionFile() {
  return process.env.MATRIX_SESSION_FILE || join(secretsDir(), "matrix-session.json");
}

export function oauthClientFile() {
  return process.env.HF_OAUTH_CLIENT_FILE || join(secretsDir(), "matrix-oauth-client.json");
}

export function dataDir(side = process.env.HF_SIDE || "dirty") {
  if (process.env.MATRIX_DATA_DIR) return process.env.MATRIX_DATA_DIR;
  const name = String(side).toLowerCase() === "clean" ? "clean" : "dirty";
  return join(homeDir(), ".hf-pipe", "data", name);
}

export function localDir() {
  if (process.env.HF_LOCAL_DIR) return process.env.HF_LOCAL_DIR;
  const next = join(homeDir(), ".hf-pipe", "local");
  const legacy = join(homeDir(), "bin", "hotfolder", "local");
  return firstExisting([next, legacy]) || next;
}

export function cleanRoots() {
  const raw = process.env.HF_CLEAN_ROOT || process.env.HOT_ROOT || "";
  return raw
    .split(/[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function rpcBind() {
  return process.env.HF_RPC_BIND || "127.0.0.1";
}

export function rpcPort() {
  return Number(process.env.HF_RPC_PORT || 18765);
}

export function eventType() {
  return process.env.HF_EVENT_TYPE || "org.hf.pipe";
}

export function deviceDisplayName(side = process.env.HF_SIDE || "dirty") {
  if (process.env.HF_DEVICE_NAME) return process.env.HF_DEVICE_NAME;
  return String(side).toLowerCase() === "clean" ? "hf-matrix" : "hf-dirty";
}

export function peerNameNeedles(side = process.env.HF_SIDE || "dirty") {
  const extra = String(process.env.HF_PEER_NAME || "").toLowerCase();
  if (String(side).toLowerCase() === "dirty") {
    return [extra, String(process.env.HF_PEER_CLEAN_NAME || "hf-matrix").toLowerCase()].filter(Boolean);
  }
  return [
    extra,
    String(process.env.HF_PEER_DIRTY_NAME || "hf-dirty").toLowerCase(),
    "cursor mcp",
  ].filter(Boolean);
}

export function homeserverUrl() {
  return String(process.env.MATRIX_HOMESERVER_URL || "").replace(/\/$/, "");
}

export function oidcIssuer() {
  const hs = homeserverUrl();
  const fallback = hs ? `${hs}/auth/` : "";
  const raw = process.env.MATRIX_OIDC_ISSUER || fallback;
  return String(raw).replace(/\/?$/, "/");
}

export function findMatrixClientModule() {
  const cands = [
    process.env.HF_MATRIX_CLIENT,
    join(ROOT_DIR, "dist", "matrix", "client.js"),
    join(SRC_DIR, "dist", "matrix", "client.js"),
  ].filter(Boolean);
  return cands.find((p) => existsSync(p));
}

export function sessionUserId(session) {
  return String(session?.user_id || process.env.MATRIX_USER_ID || "");
}

export { readHotfolderTempConfig } from "./hotfolder-temp.mjs";
