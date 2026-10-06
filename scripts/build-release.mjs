import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildReleaseManifest, promoteRelease, verifyRelease } from "../src/release-runtime.mjs";
import { ensureReleaseKeyPair, loadPrivateKey } from "../src/release-key.mjs";
import { HOP_PROTOCOL_VERSION } from "../src/protocol-version.mjs";
import { buildWindowlessHost } from "./build-windowless-host.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const defaultSourceRoot = join(here, "..");
const OMIT_SOURCE = new Set(["ensure-hop-dist.mjs", "repair-hop-dist.ps1"]);

function copyRuntimeTree(from, to, kind) {
  cpSync(from, to, {
    recursive: true,
    filter(path) {
      if (path === from) return true;
      const name = path.split(/[\\/]/).at(-1);
      if (OMIT_SOURCE.has(name)) return false;
      try {
        if (readdirSync(path)) return true;
      } catch {
        // file
      }
      if (kind === "dist") return /\.js$/.test(name);
      return /\.(?:mjs|js|ps1|cmd|py|vbs|cs)$/.test(name);
    },
  });
}

function treeDigest(root) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        hash.update(relative(root, path).replaceAll("\\", "/"));
        hash.update(readFileSync(path));
      }
    }
  };
  walk(root);
  return hash.digest("hex").slice(0, 16);
}

function copyStable(sourceRoot, runtimeRoot, releaseDir) {
  const stable = [
    ["src/hf-clean-mcp.mjs", "hf-clean-mcp.mjs"],
    ["src/bootstrap.mjs", "bootstrap.mjs"],
    ["src/supervisor-recovery.mjs", "supervisor-recovery.mjs"],
    ["src/operational-board.mjs", "operational-board.mjs"],
    ["src/start-hop.vbs", "start-hop.vbs"],
    ["src/protocol-version.mjs", "protocol-version.mjs"],
    ["src/release-runtime.mjs", "release-runtime.mjs"],
    ["src/tray-status.mjs", "tray-status.mjs"],
    ["src/process-job.ps1", "process-job.ps1"],
    ["src/task-host.ps1", "task-host.ps1"],
    ["src/supervisor-host.ps1", "supervisor-host.ps1"],
    ["src/tray-viewer.ps1", "tray-viewer.ps1"],
    ["src/install-watchdog.ps1", "install-watchdog.ps1"],
    ["src/install-watchdog.cmd", "install-watchdog.cmd"],
    ["src/start-clean.cmd", "start-clean.cmd"],
    ["src/start-dirty.cmd", "start-dirty.cmd"],
    ["src/cursor-egress.ps1", "cursor-egress.ps1"],
    ["src/cursor-egress-apply.mjs", "cursor-egress-apply.mjs"],
    ["src/cursor-proxy-config.mjs", "cursor-proxy-config.mjs"],
  ];
  for (const [from, to] of stable) copyFileSync(join(sourceRoot, from), join(runtimeRoot, to));
  const guiHost = join(releaseDir, "src", "task-host.exe");
  if (existsSync(guiHost)) copyFileSync(guiHost, join(runtimeRoot, "task-host.exe"));
}

export function buildRelease(options = {}) {
  const sourceRoot = options.sourceRoot || defaultSourceRoot;
  const runtimeRoot = options.runtimeRoot;
  if (!runtimeRoot) throw new Error("runtimeRoot is required");
  const keyDir = options.keyDir || join(homedir(), ".hf-pipe", "keys");
  const protocolVersion = Number(options.protocolVersion || HOP_PROTOCOL_VERSION);
  const keys = options.signingKeyPair || ensureReleaseKeyPair(keyDir);
  const existingTrust = join(runtimeRoot, "release-public.pem");
  if (existsSync(existingTrust) && readFileSync(existingTrust, "utf8").trim() !== keys.publicKey.trim()) {
    throw new Error("Candidate signing trust differs from runtime trust; explicit rotation is required");
  }
  mkdirSync(join(runtimeRoot, "releases"), { recursive: true });

  const staging = join(runtimeRoot, "releases", `.staging-${process.pid}-${Date.now()}`);
  mkdirSync(staging, { recursive: true });
  copyRuntimeTree(join(sourceRoot, "src"), join(staging, "src"), "src");
  buildWindowlessHost(sourceRoot, join(staging, "src"));
  copyRuntimeTree(join(sourceRoot, "dist"), join(staging, "dist"), "dist");
  const dependencies = join(sourceRoot, "node_modules");
  if (!existsSync(dependencies)) throw new Error("Install the locked dependencies before building a release");
  cpSync(dependencies, join(staging, "node_modules"), {
    recursive: true,
    filter: (path) => !path.split(/[\\/]/).includes(".bin"),
  });
  for (const name of ["package.json", "package-lock.json", "MANIFEST.json"]) {
    if (existsSync(join(sourceRoot, name))) copyFileSync(join(sourceRoot, name), join(staging, name));
  }
  if (options.peerTrust) writeFileSync(join(staging, "peer-trust.json"), JSON.stringify(options.peerTrust, null, 2));
  else if (existsSync(join(sourceRoot, "peer-trust.json"))) copyFileSync(join(sourceRoot, "peer-trust.json"), join(staging, "peer-trust.json"));

  const buildId = options.buildId || treeDigest(staging);
  const privateKey = keys.privateKey || loadPrivateKey(keys.privatePath);
  buildReleaseManifest(staging, { buildId, protocolVersion, privateKey });
  verifyRelease(staging, { publicKey: keys.publicKey, expectedProtocolVersion: protocolVersion });

  const releaseDir = join(runtimeRoot, "releases", buildId);
  if (existsSync(releaseDir)) {
    rmSync(staging, { recursive: true, force: true });
    verifyRelease(releaseDir, { publicKey: keys.publicKey, expectedProtocolVersion: protocolVersion });
  } else {
    renameSync(staging, releaseDir);
  }
  if (options.activate || !existsSync(join(runtimeRoot, "bootstrap.mjs"))) copyStable(sourceRoot, runtimeRoot, releaseDir);
  writeFileSync(join(runtimeRoot, "release-public.pem"), keys.publicKey, { mode: 0o644 });
  if (options.activate) promoteRelease(runtimeRoot, buildId);
  return { buildId, releaseDir, runtimeRoot, publicKeyPath: join(runtimeRoot, "release-public.pem") };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const runtimeRoot = process.argv[2];
  const activate = process.argv.includes("--activate");
  const result = buildRelease({ runtimeRoot, activate });
  console.log(JSON.stringify(result));
}
