import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureReleaseKeyPair, validateReleaseKeyPair } from "../src/release-key.mjs";

for (const survivor of ["release-private.dpapi", "release-public.pem"]) {
  test(`incomplete signing identity preserves ${survivor}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-key-integrity-"));
    try {
      const path = join(dir, survivor);
      writeFileSync(path, "existing identity");
      assert.throws(() => ensureReleaseKeyPair(dir), /Incomplete release signing key pair/);
      assert.equal(readFileSync(path, "utf8"), "existing identity");
      assert.deepEqual(readdirSync(dir), [survivor]);
    } finally { rmSync(dir, {recursive:true, force:true}); }
  });
}

test("signing trust must match its private Ed25519 key", () => {
  const a = generateKeyPairSync("ed25519");
  const b = generateKeyPairSync("ed25519");
  const privateKey = a.privateKey.export({type:"pkcs8", format:"pem"});
  const publicKey = a.publicKey.export({type:"spki", format:"pem"});
  assert.doesNotThrow(() => validateReleaseKeyPair(privateKey, publicKey));
  assert.throws(() => validateReleaseKeyPair(privateKey, b.publicKey.export({type:"spki",format:"pem"})), /key pair mismatch/);
});
