import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildReleaseManifest, promoteRelease } from "../src/release-runtime.mjs";

const bootstrap = new URL("../src/bootstrap.mjs", import.meta.url);

test("bootstrap marks a crashing current release bad and rolls back before retry", () => {
  const runtime = mkdtempSync(join(tmpdir(), "hf-bootstrap-"));
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" });
  const publicPath = join(runtime, "release-public.pem");
  writeFileSync(publicPath, publicKey);

  for (const [id, source] of [
    ["good", 'process.send?.({kind:"supervisor-health",phase:"booted"});\n'],
    ["bad", 'throw new Error("broken release");\n'],
  ]) {
    const dir = join(runtime, "releases", id);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
    writeFileSync(join(dir, "src", "index.mjs"), source);
    buildReleaseManifest(dir, { buildId: id, protocolVersion: 2, privateKey });
  }
  promoteRelease(runtime, "good");
  promoteRelease(runtime, "bad");

  const result = spawnSync(process.execPath, [bootstrap.pathname.slice(1), "dirty"], {
    env: {
      ...process.env,
      HF_RUNTIME_ROOT: runtime,
      HF_RELEASE_PUBLIC_KEY: publicPath,
      HF_BOOTSTRAP_ONCE: "1",
      HF_STARTUP_FAILURE_THRESHOLD: "1",
      HF_PROTOCOL_VERSION: "2",
    },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.notEqual(result.status, 0, result.stdout);
  const state = JSON.parse(readFileSync(join(runtime, "state.json"), "utf8"));
  assert.equal(state.current, "good");
  assert.deepEqual(state.bad, ["bad"]);
  assert.match(state.lastFailure.reason, /before booted|broken release/i);
});
