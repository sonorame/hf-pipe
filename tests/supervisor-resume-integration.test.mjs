import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildReleaseManifest } from "../src/release-runtime.mjs";

function runScenario({ healthy, pause }) {
  const root = mkdtempSync(join(tmpdir(), "hf-resume-"));
  try {
    const pair = generateKeyPairSync("ed25519");
    const publicKey = pair.publicKey.export({ type: "spki", format: "pem" });
    const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" });
    const release = join(root, "releases", "fixture");
    mkdirSync(join(release, "src"), { recursive: true });
    writeFileSync(join(root, "release-public.pem"), publicKey);
    writeFileSync(join(root, "state.json"), JSON.stringify({ current: "fixture", failures: {} }));
    writeFileSync(join(release, "src", "index.mjs"), `
      process.send({kind:"supervisor-health",phase:"ready"});
      process.on("disconnect",()=>process.exit(0));
      setInterval(()=>{${healthy ? 'process.send({kind:"supervisor-health",phase:"running",local:{rtc:true,matrixSyncAgeMs:0}});' : ''}},50);
    `);
    buildReleaseManifest(release, { buildId: "fixture", protocolVersion: 3, privateKey });
    const harness = join(root, "harness.mjs");
    writeFileSync(harness, `
      import {runBootstrap} from ${JSON.stringify(new URL("../src/bootstrap.mjs", import.meta.url).href)};
      ${pause ? 'setTimeout(()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1600),500);' : ''}
      setTimeout(()=>process.exit(0),${pause ? 3300 : 1800});
      runBootstrap("dirty",{runtimeRoot:${JSON.stringify(root)}});
    `);
    const result = spawnSync(process.execPath, [harness], {
      env: { ...process.env, HF_SUPERVISOR_PORT: "0", HF_SUPERVISOR_HEARTBEAT_MS: "1000", HF_SUPERVISOR_CHECK_MS: "100", HF_STARTUP_BOOT_MS: "1500", HF_PROTOCOL_VERSION: "3" },
      encoding: "utf8", timeout: 6000,
    });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(join(root, "logs", "bootstrap-dirty.log"), "utf8");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("packaged bootstrap keeps a healthy child across a pause in its own event loop", () => {
  const log = runScenario({ healthy: true, pause: true });
  assert.match(log, /supervisor-resumed/);
  assert.doesNotMatch(log, /watchdog|exit fixture/);
  assert.match(log, /verify-complete fixture durationMs=/);
});

test("packaged bootstrap terminates an unresponsive child without a host pause", () => {
  const log = runScenario({ healthy: false, pause: false });
  assert.match(log, /watchdog fixture supervisor heartbeat stalled/);
  assert.match(log, /exit fixture/);
});
