import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildReleaseManifest } from "../src/release-runtime.mjs";
import { packRelease, stageReleaseArchive } from "../src/release-transfer.mjs";

test("signed release archive stages without activating", { skip: process.platform !== "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "hf-transfer-"));
  const source = join(root, "source");
  mkdirSync(join(source, "src"), { recursive: true });
  writeFileSync(join(source, "src", "index.mjs"), "console.log('ok');\n");
  writeFileSync(join(source, "package.json"), '{"type":"module"}\n');
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" });
  buildReleaseManifest(source, { buildId: "signed-r1", protocolVersion: 2, privateKey });

  const archive = join(root, "signed-r1.zip");
  const packed = packRelease(source, archive);
  assert.match(packed.sha256, /^[a-f0-9]{64}$/);
  const runtime = join(root, "runtime");
  const staged = stageReleaseArchive({
    archivePath: archive,
    runtimeRoot: runtime,
    publicKey,
    expectedProtocolVersion: 2,
    expectedSha256: packed.sha256,
  });
  assert.equal(staged.buildId, "signed-r1");
  assert.equal(staged.activated, false);
});
