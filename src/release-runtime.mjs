import { createHash, sign as signBytes, verify as verifyBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const MANIFEST = "release-manifest.json";
const IMPORT_RE = /\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g;

function slash(path) {
  return path.split(sep).join("/");
}

function filesUnder(root, dir = root) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(root, path));
    else if (entry.isFile() && (entry.name !== MANIFEST || dir !== root)) out.push(slash(relative(root, path)));
  }
  return out.sort();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function canonical(manifest) {
  const unsigned = { ...manifest };
  delete unsigned.signature;
  return Buffer.from(JSON.stringify(unsigned));
}

function assertInside(root, path) {
  const rel = relative(root, path);
  if (rel.startsWith("..") || resolve(path) === resolve(root) && rel === "..") {
    throw new Error(`import escapes release: ${path}`);
  }
}

function validateImports(root) {
  // Third-party package imports use exports/conditions rather than this relative-file check.
  // Their complete bytes remain covered by the signed manifest and hash verification.
  for (const rel of filesUnder(root).filter((name) => /\.(?:mjs|js)$/.test(name) && !name.split("/").includes("node_modules"))) {
    const sourcePath = join(root, rel);
    const source = readFileSync(sourcePath, "utf8");
    IMPORT_RE.lastIndex = 0;
    let match;
    while ((match = IMPORT_RE.exec(source))) {
      const spec = match[1];
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(sourcePath), spec);
      assertInside(root, target);
      if (!existsSync(target) || !statSync(target).isFile()) {
        throw new Error(`missing import ${spec} from ${rel}`);
      }
    }
  }
}

export function buildReleaseManifest(root, options) {
  const files = filesUnder(root).map((path) => ({
    path,
    size: statSync(join(root, path)).size,
    sha256: sha256(join(root, path)),
  }));
  const manifest = {
    format: 1,
    buildId: String(options.buildId),
    protocolVersion: Number(options.protocolVersion),
    createdAt: options.createdAt || new Date().toISOString(),
    entrypoint: options.entrypoint || "src/index.mjs",
    files,
  };
  const signature = signBytes(null, canonical(manifest), options.privateKey).toString("base64");
  const signed = { ...manifest, signature: { algorithm: "Ed25519", value: signature } };
  writeFileSync(join(root, MANIFEST), `${JSON.stringify(signed, null, 2)}\n`);
  return signed;
}

export function verifyRelease(root, options) {
  const manifest = JSON.parse(readFileSync(join(root, MANIFEST), "utf8"));
  if (manifest.signature?.algorithm !== "Ed25519" || !manifest.signature?.value) {
    throw new Error("release signature missing");
  }
  const valid = verifyBytes(
    null,
    canonical(manifest),
    options.publicKey,
    Buffer.from(manifest.signature.value, "base64"),
  );
  if (!valid) throw new Error("release signature invalid");
  const entrypoint = resolve(root, manifest.entrypoint || "src/index.mjs");
  assertInside(root, entrypoint);
  if (!existsSync(entrypoint) || !statSync(entrypoint).isFile()) throw new Error("release entrypoint missing");
  if (
    options.expectedProtocolVersion != null &&
    manifest.protocolVersion !== Number(options.expectedProtocolVersion)
  ) {
    throw new Error(`protocol mismatch ${manifest.protocolVersion}`);
  }
  for (const file of manifest.files || []) {
    const path = resolve(root, file.path);
    assertInside(root, path);
    if (!existsSync(path) || statSync(path).size !== file.size || sha256(path) !== file.sha256) {
      throw new Error(`hash mismatch ${file.path}`);
    }
  }
  const actual = filesUnder(root);
  const listed = (manifest.files || []).map((file) => file.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(listed)) throw new Error("release file list mismatch");
  validateImports(root);
  return manifest;
}

export function quarantineStrayReleaseFiles(releaseDir, options = {}) {
  const manifestPath = join(releaseDir, MANIFEST);
  if (!existsSync(manifestPath)) return [];
  let listed;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    listed = new Set((manifest.files || []).map((file) => slash(String(file.path || ""))));
  } catch {
    return [];
  }
  const stray = filesUnder(releaseDir).filter((rel) => !listed.has(rel));
  if (!stray.length) return [];
  const destRoot = options.destDir || join(dirname(dirname(releaseDir)), "stray", basename(releaseDir));
  const moved = [];
  for (const rel of stray) {
    const from = join(releaseDir, ...rel.split("/"));
    const to = join(destRoot, ...rel.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    if (existsSync(to)) rmSync(to, { force: true });
    renameSync(from, to);
    moved.push(rel);
  }
  return moved;
}

function readState(runtimeRoot) {
  try {
    return JSON.parse(readFileSync(join(runtimeRoot, "state.json"), "utf8"));
  } catch {
    return { current: null, previous: null, bad: [], failures: {} };
  }
}

function writeState(runtimeRoot, state) {
  mkdirSync(runtimeRoot, { recursive: true });
  const path = join(runtimeRoot, "state.json");
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(temp, path);
  return state;
}

export function promoteRelease(runtimeRoot, releaseId) {
  const id = String(releaseId);
  if (!existsSync(join(runtimeRoot, "releases", id))) throw new Error(`release not found ${id}`);
  const state = readState(runtimeRoot);
  if ((state.bad || []).includes(id)) throw new Error(`release is marked bad ${id}`);
  if (state.current === id) return state;
  return writeState(runtimeRoot, {
    ...state,
    previous: state.current || null,
    current: id,
    failures: { ...(state.failures || {}), [id]: 0 },
  });
}

export function recordReleaseFailure(runtimeRoot, releaseId, options = {}) {
  const id = String(releaseId);
  const threshold = Math.max(1, Number(options.threshold || 3));
  const state = readState(runtimeRoot);
  const failures = { ...(state.failures || {}) };
  failures[id] = Number(failures[id] || 0) + 1;
  let previous = state.previous || null;
  if (previous && (state.bad || []).includes(previous)) previous = null;
  const next = {
    ...state,
    previous,
    failures,
    lastFailure: { releaseId: id, reason: String(options.reason || "failed"), at: new Date().toISOString() },
  };
  if (state.current === id && failures[id] >= threshold && previous) {
    next.current = previous;
    next.previous = null;
    next.bad = [...new Set([...(state.bad || []), id])];
  }
  return writeState(runtimeRoot, next);
}
