import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const ps1 = join(here, "../src/repair-hop-dist.ps1");

function runRepair(pack) {
  return spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Pack", pack],
    { encoding: "utf8", windowsHide: true, timeout: 30000 },
  );
}

test("repair-hop-dist.ps1 is valid PowerShell and writes hop-board.js", async () => {
  const root = mkdtempSync(join(tmpdir(), "hf-repair-"));
  const pack = join(root, "hf-matrix-pack");
  mkdirSync(pack);
  writeFileSync(join(pack, "index.mjs"), 'import "./dist/hop-board.js";\n');
  const r = runRepair(pack);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(String(r.stdout || ""), /ok /);
  assert.equal(existsSync(join(pack, "dist", "hop-board.js")), true);
  assert.equal(existsSync(join(pack, "dist", "hop-log.js")), true);
  const board = await import(pathToFileURL(join(pack, "dist", "hop-board.js")).href);
  assert.equal(typeof board.shapeHopStatus, "function");
  assert.equal(typeof board.hopRestartDelayMs, "function");
  const log = await import(pathToFileURL(join(pack, "dist", "hop-log.js")).href);
  assert.equal(typeof log.pushHopLog, "function");
});

test("321.ps1 on Desktop uses USERPROFILE pack path like the clean host", async () => {
  const home = mkdtempSync(join(tmpdir(), "hf-home-"));
  const desktop = join(home, "Desktop");
  const pack = join(desktop, "hf-matrix-pack");
  mkdirSync(pack, { recursive: true });
  const script = join(desktop, "321.ps1");
  copyFileSync(ps1, script);
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      env: { ...process.env, USERPROFILE: home },
      cwd: desktop,
    },
  );
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.equal(existsSync(join(pack, "dist", "hop-board.js")), true);
  const src = readFileSync(script, "utf8");
  assert.doesNotMatch(src, /if not exist/i);
  assert.doesNotMatch(src, /cd \/d /);
});

test("writes stubs when tsc exists but node is not on PATH", async () => {
  const home = mkdtempSync(join(tmpdir(), "hf-nonode-"));
  const desktop = join(home, "Desktop");
  const pack = join(desktop, "hf-matrix-pack");
  mkdirSync(join(pack, "node_modules", "typescript", "bin"), { recursive: true });
  writeFileSync(join(pack, "node_modules", "typescript", "bin", "tsc"), "placeholder\n");
  const emptyPf = join(home, "Program Files");
  mkdirSync(emptyPf, { recursive: true });
  const script = join(desktop, "321.ps1");
  copyFileSync(ps1, script);
  const r = spawnSync(
    join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      env: {
        ...process.env,
        USERPROFILE: home,
        ProgramFiles: emptyPf,
        PATH: [join(home, "empty-bin"), join(process.env.SystemRoot || "C:\\Windows", "System32")].join(";"),
      },
      cwd: desktop,
    },
  );
  assert.equal(r.status, 0, `status=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  assert.doesNotMatch(String(r.stderr || "") + String(r.stdout || ""), /CommandNotFoundException/);
  assert.equal(existsSync(join(pack, "dist", "hop-board.js")), true);
  assert.equal(existsSync(join(pack, "dist", "hop-log.js")), true);
  const src = readFileSync(ps1, "utf8");
  assert.doesNotMatch(src, /\$node\s*=\s*"node"/);
  assert.match(src, /Find-HopNode/);
  assert.match(src, /Join-Path \$Root "node\.exe"/);
});

test("overwrites stale watchdog-clock.js that lacks shouldExitOnSyncDead", async () => {
  const root = mkdtempSync(join(tmpdir(), "hf-clock-"));
  const pack = join(root, "hf-matrix-pack");
  mkdirSync(join(pack, "dist"), { recursive: true });
  writeFileSync(
    join(pack, "dist", "watchdog-clock.js"),
    "export function shouldRecycleAfterClockJump(a,b){return b-a>60000}\n",
  );
  const r = runRepair(pack);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const clock = await import(pathToFileURL(join(pack, "dist", "watchdog-clock.js")).href + "?t=" + Date.now());
  assert.equal(typeof clock.shouldExitOnSyncDead, "function");
  assert.equal(typeof clock.shouldRecycleAfterClockJump, "function");
  assert.equal(clock.shouldExitOnSyncDead({ rtcUp: true, lastOkMs: 0, nowMs: 9e15, deadMs: 1 }), false);
});
