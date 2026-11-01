import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureReleaseKeyPair, loadPrivateKey, validateReleaseKeyPair } from "../src/release-key.mjs";

test("device identity can be created and reused without rotating its trusted public key", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-peer-identity-"));
  t.after(() => {
    assert.ok(dir.startsWith(join(tmpdir(), "hf-peer-identity-")));
    rmSync(dir, { recursive: true, force: true });
  });
  const first = ensureReleaseKeyPair(dir);
  validateReleaseKeyPair(loadPrivateKey(first.privatePath), first.publicKey);
  const restored = ensureReleaseKeyPair(dir);
  assert.equal(restored.created, false);
  assert.equal(restored.publicKey, first.publicKey);
  if (process.platform !== "win32") {
    assert.equal(statSync(first.privatePath).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
  }
});
