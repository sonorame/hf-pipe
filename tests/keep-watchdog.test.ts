import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const keepJs = readFileSync(join(here, "../src/keep.js"), "utf8");
const cmd = readFileSync(join(here, "../src/install-watchdog.cmd"), "utf8");
const ps1 = readFileSync(join(here, "../src/install-watchdog.ps1"), "utf8");

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

test("keep-loop.mjs restarts hop after any exit, including already-running", () => {
  const loopSrc = readFileSync(join(here, "../src/keep-loop.mjs"), "utf8");
  assert.match(loopSrc, /setTimeout\(start,\s*4000\)/);
  assert.doesNotMatch(loopSrc, /process\.exit\(2\)/);
  assert.match(loopSrc, /spawn\(process\.execPath,\s*\[ENTRY,\s*side\]/);
  assert.match(loopSrc, /\.hf-pipe/);
  assert.match(loopSrc, /logs/);
  assert.match(loopSrc, /windowsHide:\s*true/);
  assert.match(loopSrc, /openSync\(/);
  assert.doesNotMatch(loopSrc, /stdio:\s*"inherit"/);
  assert.doesNotMatch(loopSrc, /createWriteStream\([^)]*flags:\s*["']a["']/);
});

test("install-watchdog launches keep.js every minute and at logon", () => {
  assert.match(cmd, /keep\.js/);
  assert.match(cmd, /\/MO 1/);
  assert.match(cmd, /ONLOGON/);
  assert.match(cmd, /CursorMCPLogon/);
  assert.match(cmd, /schtasks CursorMCPLogon failed/);
  assert.match(cmd, /CursorMCP\.lnk/);
  assert.doesNotMatch(cmd, /Create \/TN "CursorMCPLogon"[^\n]*2>&1/);
  assert.match(ps1, /keep\.js/);
  assert.match(ps1, /schtasks/);
  assert.match(ps1, /DontStopIfGoingOnBatteries|AllowStartIfOnBatteries/);
  assert.doesNotMatch(ps1, /src\/index\.mjs/);
});
