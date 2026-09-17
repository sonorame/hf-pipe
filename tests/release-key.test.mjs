import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureReleaseKeyPair, loadPrivateKey } from "../src/release-key.mjs";

test("release private key round-trips through Windows DPAPI", { skip: process.platform !== "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-dpapi-"));
  const pair = ensureReleaseKeyPair(dir);
  assert.match(pair.publicKey, /BEGIN PUBLIC KEY/);
  assert.match(loadPrivateKey(pair.privatePath), /BEGIN PRIVATE KEY/);
  assert.equal(pair.created, true);
  assert.equal(ensureReleaseKeyPair(dir).created, false);
});
