import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const keepJs = readFileSync(join(here, "../src/keep.js"), "utf8");
const cmd = readFileSync(join(here, "../src/install-watchdog.cmd"), "utf8");
const ps1 = readFileSync(join(here, "../src/install-watchdog.ps1"), "utf8");
const host = readFileSync(join(here, "../src/supervisor-host.ps1"), "utf8");

test("keep.js starts keep-loop.mjs, not a one-shot index.mjs", () => {
  assert.match(keepJs, /keep-loop\.mjs/);
  assert.match(keepJs, /'" "' \+ loop \+ '" ' \+ side/);
  assert.doesNotMatch(keepJs, /'" "' \+ entry \+ '" ' \+ side/);
});

test("keep.js treats keep-loop.mjs and run.mjs as the live supervisor", () => {
  assert.match(keepJs, /keep-loop\.mjs/);
  assert.match(keepJs, /run\.mjs/);
  assert.match(keepJs, /if \(cmd\.indexOf\("keep-loop\.mjs"\) >= 0 \|\| cmd\.indexOf\("run\.mjs"\) >= 0\)/);
});

test("keep-loop delegates to signed bootstrap without generating dist", () => {
  const loopSrc = readFileSync(join(here, "../src/keep-loop.mjs"), "utf8");
  assert.match(loopSrc, /runBootstrap/);
  assert.match(loopSrc, /HF_RUNTIME_ROOT/);
  assert.doesNotMatch(loopSrc, /ensure-hop-dist|ensureHopDist|writeFile/);
});

test("install-watchdog creates one tracked interactive supervisor task", () => {
  assert.match(cmd, /install-watchdog\.ps1/);
  assert.match(ps1, /New-ScheduledTaskTrigger\s+-AtLogOn/);
  assert.match(ps1, /supervisor-host\.ps1/);
  assert.match(ps1, /-STA/);
  assert.match(ps1, /Hidden\s*=\s*\$true/);
  assert.match(ps1, /RestartCount/);
  assert.match(ps1, /RestartInterval/);
  assert.match(ps1, /StartWhenAvailable/);
  assert.match(ps1, /AllowStartIfOnBatteries/);
  assert.match(ps1, /DontStopIfGoingOnBatteries/);
  assert.match(ps1, /ExecutionTimeLimit/);
  assert.match(ps1, /MultipleInstances\s+IgnoreNew/);
  assert.doesNotMatch(ps1, /\/SC MINUTE|Register-ScheduledTask[\s\S]*-TaskName\s+["']?CursorMCP|keep\.js/);
  assert.match(ps1, /Remove-Item[\s\S]*-Force/);
  assert.match(host, /bootstrap\.mjs/);
  assert.match(host, /Start-Process[\s\S]*-Wait/);
  assert.match(host, /Start-Sleep -Seconds 4/);
  assert.match(host, /tray-viewer\.ps1/);
  assert.match(host, /BeginInvoke/);
  assert.match(host, /WindowStyle Hidden/);
  assert.match(host, /HF_TEMP_KEEP_MS/);
});

test("hop-up starts the scheduled task, not a console window", () => {
  const hopUp = readFileSync(join(here, "../scripts/hop-up.mjs"), "utf8");
  assert.match(hopUp, /Start-ScheduledTask/);
  assert.match(hopUp, /HFPipe-dirty/);
  assert.doesNotMatch(hopUp, /hf-dirty/);
});
