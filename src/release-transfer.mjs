import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { verifyRelease } from "./release-runtime.mjs";

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function powershellArchive(script, env) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...process.env, ...env },
    windowsHide: true,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error(result.stderr || `archive command exited ${result.status}`);
}

export function packRelease(releaseDir, archivePath) {
  mkdirSync(dirname(archivePath), { recursive: true });
  if (existsSync(archivePath)) rmSync(archivePath, { force: true });
  powershellArchive(
    "Compress-Archive -Path (Join-Path $env:HF_RELEASE_DIR '*') -DestinationPath $env:HF_ARCHIVE -CompressionLevel Optimal -Force",
    { HF_RELEASE_DIR: releaseDir, HF_ARCHIVE: archivePath },
  );
  return { archivePath, size: readFileSync(archivePath).length, sha256: fileSha256(archivePath) };
}

export function stageReleaseArchive(options) {
  if (options.expectedSha256 && fileSha256(options.archivePath) !== options.expectedSha256) {
    throw new Error("archive hash mismatch");
  }
  mkdirSync(join(options.runtimeRoot, "releases"), { recursive: true });
  const staging = join(options.runtimeRoot, "releases", `.incoming-${process.pid}-${Date.now()}`);
  mkdirSync(staging, { recursive: true });
  try {
    powershellArchive(
      "Expand-Archive -LiteralPath $env:HF_ARCHIVE -DestinationPath $env:HF_RELEASE_DIR -Force",
      { HF_ARCHIVE: options.archivePath, HF_RELEASE_DIR: staging },
    );
    const manifest = verifyRelease(staging, {
      publicKey: options.publicKey,
      expectedProtocolVersion: options.expectedProtocolVersion,
    });
    const releaseDir = join(options.runtimeRoot, "releases", manifest.buildId);
    if (existsSync(releaseDir)) rmSync(staging, { recursive: true, force: true });
    else renameSync(staging, releaseDir);
    return { buildId: manifest.buildId, releaseDir, activated: false };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function uploadReleaseMedia(options) {
  const body = readFileSync(options.archivePath);
  const base = String(options.homeserver).replace(/\/$/, "");
  const url = `${base}/_matrix/media/v3/upload?filename=${encodeURIComponent(basename(options.archivePath))}`;
  const response = await options.fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/zip",
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`media upload ${response.status} ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text);
  if (!String(parsed.content_uri || "").startsWith("mxc://")) throw new Error("media upload returned no mxc");
  return { mxc: parsed.content_uri, size: body.length, sha256: fileSha256(options.archivePath) };
}

export async function downloadReleaseMedia(options) {
  const match = String(options.mxc || "").match(/^mxc:\/\/([^/]+)\/(.+)$/);
  if (!match) throw new Error("invalid mxc uri");
  const base = String(options.homeserver).replace(/\/$/, "");
  const url = `${base}/_matrix/client/v1/media/download/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}`;
  const response = await options.fetchFn(url, {
    headers: { Authorization: `Bearer ${options.accessToken}` },
  });
  if (!response.ok) throw new Error(`media download ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(options.archivePath), { recursive: true });
  writeFileSync(options.archivePath, body);
  const sha256 = fileSha256(options.archivePath);
  if (options.expectedSha256 && sha256 !== options.expectedSha256) throw new Error("archive hash mismatch");
  return { archivePath: options.archivePath, size: body.length, sha256 };
}
