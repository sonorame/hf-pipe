import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildReleaseManifest,
  promoteRelease,
  recordReleaseFailure,
  verifyRelease,
} from "../src/release-runtime.mjs";

function keys() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }),
  };
}

function release(root, id = "r1") {
  const dir = join(root, "releases", id);
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(dir, "src", "index.mjs"), 'import { ok } from "../dist/runtime.js";\nconsole.log(ok);\n');
  writeFileSync(join(dir, "dist", "runtime.js"), "export const ok = true;\n");
  return dir;
}

test("signed release verifies all files and static imports", () => {
  const root = mkdtempSync(join(tmpdir(), "hf-release-"));
  const dir = release(root);
  const { privateKey, publicKey } = keys();
  buildReleaseManifest(dir, { buildId: "r1", protocolVersion: 1, privateKey });
  const verified = verifyRelease(dir, { publicKey, expectedProtocolVersion: 1 });
  assert.equal(verified.buildId, "r1");
  assert.equal(verified.files.length, 3);
});

test("tampered and structurally incomplete releases are rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "hf-release-bad-"));
  const dir = release(root);
  const { privateKey, publicKey } = keys();
  buildReleaseManifest(dir, { buildId: "r1", protocolVersion: 1, privateKey });
  writeFileSync(join(dir, "dist", "runtime.js"), "export const ok = false;\n");
  assert.throws(() => verifyRelease(dir, { publicKey }), /hash mismatch/i);

  const dir2 = release(root, "r2");
  writeFileSync(join(dir2, "src", "index.mjs"), 'import "../dist/missing.js";\n');
  buildReleaseManifest(dir2, { buildId: "r2", protocolVersion: 1, privateKey });
  assert.throws(() => verifyRelease(dir2, { publicKey }), /missing import/i);
});

test("activation keeps previous and failure budget rolls back atomically", () => {
  const root = mkdtempSync(join(tmpdir(), "hf-runtime-"));
  release(root, "r1");
  release(root, "r2");
  promoteRelease(root, "r1");
  promoteRelease(root, "r2");
  let state = JSON.parse(readFileSync(join(root, "state.json"), "utf8"));
  assert.equal(state.current, "r2");
  assert.equal(state.previous, "r1");

  recordReleaseFailure(root, "r2", { threshold: 2, reason: "exit 1" });
  state = recordReleaseFailure(root, "r2", { threshold: 2, reason: "exit 1" });
  assert.equal(state.current, "r1");
  assert.equal(state.previous, null);
  assert.deepEqual(state.bad, ["r2"]);
  assert.equal(state.lastFailure.reason, "exit 1");
});
