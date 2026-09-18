import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bootstrap = readFileSync(new URL("../src/bootstrap.mjs", import.meta.url), "utf8");
const index = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");
const installer = readFileSync(new URL("../src/install-watchdog.ps1", import.meta.url), "utf8");

test("stable supervisor board survives worker restarts and emits transition notifications", () => {
  assert.match(bootstrap, /HF_SUPERVISOR_PORT\s*\|\|\s*18764/);
  assert.match(bootstrap, /createServer/);
  assert.match(bootstrap, /supervisor-health/);
  assert.match(bootstrap, /ShowBalloonTip/);
  assert.match(bootstrap, /15_000/);
  assert.match(bootstrap, /renderCasualBoardHtml/);
  assert.match(bootstrap, /if \(!once\)/);
  assert.doesNotMatch(bootstrap, /side === "dirty" && !once/);
  assert.match(installer, /hf-pipe status\.url/);
  assert.match(installer, /127\.0\.0\.1:18764/);
});

test("telemetry exposes operation metadata without command or file contents", () => {
  assert.match(index, /matrixTxMessages/);
  assert.match(index, /rtcOperations/);
  assert.match(index, /durationMs/);
  assert.match(index, /txBytes/);
  assert.match(index, /rxBytes/);
  assert.match(index, /operationPath/);
  const recent = index.slice(index.indexOf("traffic.recent.push"), index.indexOf("if (traffic.recent"));
  assert.doesNotMatch(recent, /body:/);
});

test("arbitrary jobs never fall back to Matrix when WebRTC is down", () => {
  assert.match(index, /matrix rpc rejected/);
  assert.doesNotMatch(index, /await sendFrame\(client,\s*"d2c"/);
  assert.match(index, /CONTROL_TYPES/);
  assert.match(index, /release-stage/);
});

test("worker PID file never mutates the signed release directory", () => {
  assert.match(index, /HF_RUNTIME_ROOT/);
  assert.match(index, /runDir/);
  assert.match(index, /hf-\$\{sideNow\(\)\}\.pid/);
  assert.doesNotMatch(index, /join\(HERE,\s*"hf\.pid"\)/);
});
