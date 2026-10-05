import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const PROTECT = [
  "Add-Type -AssemblyName System.Security;",
  "$raw=[Convert]::FromBase64String([Console]::In.ReadToEnd());",
  "$enc=[Security.Cryptography.ProtectedData]::Protect($raw,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);",
  "[IO.File]::WriteAllBytes($env:HF_DPAPI_PATH,$enc)",
].join("");

const UNPROTECT = [
  "Add-Type -AssemblyName System.Security;",
  "$enc=[IO.File]::ReadAllBytes($env:HF_DPAPI_PATH);",
  "$raw=[Security.Cryptography.ProtectedData]::Unprotect($enc,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);",
  "[Console]::Out.Write([Convert]::ToBase64String($raw))",
].join("");

function powershell(script, path, input = "") {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      input,
      env: { ...process.env, HF_DPAPI_PATH: path },
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    },
  );
  if (result.status !== 0) throw new Error(result.stderr || `PowerShell exited ${result.status}`);
  return result.stdout;
}

function restrictToCurrentUser(path) {
  try {
    chmodSync(path, 0o600);
    const account = process.env.USERDOMAIN
      ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
      : process.env.USERNAME;
    if (account) {
      spawnSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `${account}:(R,W)`], {
        windowsHide: true,
        encoding: "utf8",
      });
    }
  } catch {
    // DPAPI still binds the ciphertext to the current Windows user.
  }
}

export function protectDpapiText(text, path) {
  if (process.platform !== "win32") throw new Error("DPAPI is only available on Windows");
  mkdirSync(dirname(path), { recursive: true });
  powershell(PROTECT, path, Buffer.from(String(text)).toString("base64"));
  restrictToCurrentUser(path);
}

export function unprotectDpapiText(path) {
  if (process.platform !== "win32") throw new Error("DPAPI is only available on Windows");
  const base64 = powershell(UNPROTECT, path).trim();
  return Buffer.from(base64, "base64").toString("utf8");
}

export const protectPrivateKey = protectDpapiText;
export const loadPrivateKey = unprotectDpapiText;

export function validateReleaseKeyPair(privateKey, publicKey) {
  const secret = createPrivateKey(privateKey);
  const published = createPublicKey(publicKey);
  if (secret.asymmetricKeyType !== "ed25519" || published.asymmetricKeyType !== "ed25519") {
    throw new Error("Release signing keys must use Ed25519");
  }
  const derived = createPublicKey(secret).export({ type: "spki", format: "der" });
  const actual = published.export({ type: "spki", format: "der" });
  if (!derived.equals(actual)) throw new Error("Release signing key pair mismatch; trust was not changed");
}

export function ensureReleaseKeyPair(dir) {
  mkdirSync(dir, { recursive: true });
  const privatePath = join(dir, "release-private.dpapi");
  const publicPath = join(dir, "release-public.pem");
  const hasPrivate = existsSync(privatePath);
  const hasPublic = existsSync(publicPath);
  if (hasPrivate !== hasPublic) {
    throw new Error("Incomplete release signing key pair; restore the missing key instead of rotating trust");
  }
  if (hasPrivate && hasPublic) {
    const publicKey = readFileSync(publicPath, "utf8");
    validateReleaseKeyPair(loadPrivateKey(privatePath), publicKey);
    return {
      created: false,
      privatePath,
      publicPath,
      publicKey,
    };
  }
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" });
  protectPrivateKey(privateKey, privatePath);
  writeFileSync(publicPath, publicKey, { mode: 0o644 });
  return { created: true, privatePath, publicPath, publicKey };
}
