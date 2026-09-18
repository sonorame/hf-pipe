import assert from "node:assert/strict";
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
  const result = buildRelease({ sourceRoot: root, runtimeRoot: runtime, keyDir, activate: true });
  const state = JSON.parse(readFileSync(join(runtime, "state.json"), "utf8"));
  assert.equal(state.current, result.buildId);
  assert.equal(existsSync(join(runtime, "bootstrap.mjs")), true);
  assert.equal(existsSync(join(runtime, "supervisor-host.ps1")), true);
  assert.equal(existsSync(join(runtime, "tray-status.mjs")), true);
  assert.equal(existsSync(join(runtime, "tray-viewer.ps1")), true);
  assert.equal(existsSync(join(result.releaseDir, "src", "index.mjs")), true);
  assert.equal(existsSync(join(result.releaseDir, "dist", "watchdog-clock.js")), true);
  assert.equal(existsSync(join(result.releaseDir, "src", "ensure-hop-dist.mjs")), false);
  verifyRelease(result.releaseDir, {
    publicKey: readFileSync(join(runtime, "release-public.pem"), "utf8"),
    expectedProtocolVersion: 2,
  });
});
