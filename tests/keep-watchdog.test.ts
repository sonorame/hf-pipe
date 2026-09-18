import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const keepJs = readFileSync(join(here, "../src/keep.js"), "utf8");
const cmd = readFileSync(join(here, "../src/install-watchdog.cmd"), "utf8");
const ps1 = readFileSync(join(here, "../src/install-watchdog.ps1"), "utf8");
const taskHost = readFileSync(join(here, "../src/task-host.ps1"), "utf8");
const host = readFileSync(join(here, "../src/supervisor-host.ps1"), "utf8");
const processJob = readFileSync(join(here, "../src/process-job.ps1"), "utf8");
const tray = readFileSync(join(here, "../src/tray-viewer.ps1"), "utf8");
const releaseBuilder = readFileSync(join(here, "../scripts/build-release.mjs"), "utf8");
const bundleBuilder = readFileSync(join(here, "../scripts/build-bootstrap-bundle.mjs"), "utf8");

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
  assert.match(ps1, /task-host\.ps1/);
  assert.match(ps1, /supervisor-host\.ps1/);
  assert.match(ps1, /Execute "powershell\.exe"/);
  assert.match(ps1, /"Hidden"/);
  assert.doesNotMatch(ps1, /conhost\.exe|--headless/);
  assert.doesNotMatch(ps1, /Execute "wscript\.exe"/);
  assert.match(ps1, /Stop-ScheduledTask/);
  assert.match(ps1, /Stop-Process/);
  assert.match(ps1, /install-watchdog/);
  assert.match(ps1, /\[string\]\$TaskName/);
  assert.match(ps1, /\$resolvedTaskName/);
  assert.match(ps1, /\$launcherRoot = \$PSScriptRoot/);
  assert.match(ps1, /\$SideName -eq "dirty"[\s\S]*hf-start-host\\\.ps1/);
  assert.doesNotMatch(ps1, /"HFPipe-dirty",\s*"HFPipe-clean"/);
  assert.doesNotMatch(ps1, /supervisor-launch\.vbs/);
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
  assert.match(host, /CreateNoWindow/);
  assert.match(host, /WaitForExit/);
  assert.match(host, /UseShellExecute\s*=\s*\$false/);
  assert.match(host, /New-HfKillOnCloseJob/);
  assert.match(host, /Start-Sleep -Seconds 4/);
  assert.match(host, /tray-viewer\.ps1/);
  assert.match(host, /BeginInvoke/);
  assert.match(host, /HF_TEMP_KEEP_MS/);
  assert.match(host, /Start-HfTray[\s\S]*-StateFile/);
  assert.match(taskHost, /supervisor-host\.ps1/);
  assert.match(taskHost, /\$launcherRoot = \$PSScriptRoot/);
  assert.match(taskHost, /CreateNoWindow/);
  assert.match(taskHost, /WaitForExit/);
  assert.match(taskHost, /Start-Sleep -Seconds 4/);
  assert.match(processJob, /CreateKillOnClose/);
  assert.match(processJob, /AssignProcessToJobObject/);
  assert.match(processJob, /0x00002000/);
  assert.match(tray, /\[string\]\$StateFile/);
  assert.match(tray, /Move-Item[\s\S]*HfTrayStateFile/);
  assert.equal(existsSync(join(here, "../src/supervisor-launch.vbs")), false);
  assert.doesNotMatch(releaseBuilder, /supervisor-launch\.vbs/);
  assert.doesNotMatch(bundleBuilder, /supervisor-launch\.vbs/);
});

test("hop-up starts the scheduled task, not a console window", () => {
  const hopUp = readFileSync(join(here, "../scripts/hop-up.mjs"), "utf8");
  assert.match(hopUp, /Start-ScheduledTask/);
  assert.match(hopUp, /HFPipe-dirty/);
  assert.doesNotMatch(hopUp, /hf-dirty/);
});
