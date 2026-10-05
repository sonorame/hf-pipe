import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildRelease } from "../scripts/build-release.mjs";
import { verifyRelease } from "../src/release-runtime.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("build-release stages, verifies and activates one immutable package", () => {
  const runtime = mkdtempSync(join(tmpdir(), "hf-built-release-"));
  const keyDir = join(runtime, "keys");
  const pair = generateKeyPairSync("ed25519");
  const signingKeyPair = {
    privateKey: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    publicKey: pair.publicKey.export({ type: "spki", format: "pem" }),
  };
  const result = buildRelease({ sourceRoot: root, runtimeRoot: runtime, keyDir, signingKeyPair, activate: true });
  const state = JSON.parse(readFileSync(join(runtime, "state.json"), "utf8"));
  assert.equal(state.current, result.buildId);
  assert.equal(existsSync(join(runtime, "bootstrap.mjs")), true);
  assert.equal(existsSync(join(runtime, "protocol-version.mjs")), true);
  assert.equal(existsSync(join(runtime, "hf-clean-mcp.mjs")), true);
  assert.equal(existsSync(join(runtime, "process-job.ps1")), true);
  assert.equal(existsSync(join(runtime, "task-host.ps1")), true);
  assert.equal(existsSync(join(runtime, "supervisor-host.ps1")), true);
  assert.equal(existsSync(join(runtime, "tray-status.mjs")), true);
  assert.equal(existsSync(join(runtime, "tray-viewer.ps1")), true);
  assert.equal(existsSync(join(runtime, "cursor-egress.ps1")), true);
  assert.equal(existsSync(join(runtime, "cursor-egress-apply.mjs")), true);
  assert.equal(existsSync(join(result.releaseDir, "src", "index.mjs")), true);
  assert.equal(existsSync(join(result.releaseDir, "src", "egress-stream.mjs")), true);
  assert.equal(existsSync(join(result.releaseDir, "src", "egress-mux.mjs")), true);
  assert.equal(existsSync(join(result.releaseDir, "src", "cursor-proxy-config.mjs")), true);
  assert.equal(existsSync(join(result.releaseDir, "src", "kilo-query.py")), true);
  assert.equal(existsSync(join(result.releaseDir, "src", "clean-facets.mjs")), true);
  assert.equal(existsSync(join(result.releaseDir, "dist", "watchdog-clock.js")), true);
  assert.equal(existsSync(join(result.releaseDir, "src", "ensure-hop-dist.mjs")), false);
  verifyRelease(result.releaseDir, {
    publicKey: readFileSync(join(runtime, "release-public.pem"), "utf8"),
    expectedProtocolVersion: 3,
  });
});
