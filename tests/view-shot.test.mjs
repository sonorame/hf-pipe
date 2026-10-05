import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { normalizeScreens, selectDisplay } from "../src/view-shot.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const screens = [
  { i: 0, x: 0, y: 0, width: 1920, height: 1080, primary: true },
  { i: 1, x: 1920, y: 0, width: 2560, height: 1440, primary: false },
];

test("screenshot can pick one display at a time", () => {
  const a = selectDisplay(screens, 0);
  const b = selectDisplay(screens, 1);
  assert.equal(a.x, 0);
  assert.equal(a.width, 1920);
  assert.equal(b.x, 1920);
  assert.equal(b.width, 2560);
  assert.notEqual(a.x, b.x);
});

test("missing display index falls back to primary", () => {
  const picked = selectDisplay(screens, 9);
  assert.equal(picked.primary, true);
  assert.equal(picked.x, 0);
});

test("PowerShell screens wrapper still lists both displays", () => {
  const raw = { value: screens, Count: 2 };
  const list = normalizeScreens(raw);
  assert.equal(list.length, 2);
  assert.equal(selectDisplay(list, 1).x, 1920);
});

test("capture loop scales one physical display in one blit", () => {
  const ps1 = readFileSync(join(here, "../src/capture-loop.ps1"), "utf8");
  assert.match(ps1, /SetProcessDPIAware/);
  assert.match(ps1, /StretchBlt/);
});

test("capture daemon does not stall on PowerShell stderr", () => {
  const js = readFileSync(join(here, "../src/clean-jobs.mjs"), "utf8");
  assert.match(js, /input:\s*JSON\.stringify/);
  const ps1 = readFileSync(join(here, "../src/capture-loop.ps1"), "utf8");
  assert.match(ps1, /HfCap\.dll/);
  assert.match(ps1, /\$env:TEMP/);
  assert.doesNotMatch(ps1, /Join-Path \$here "HfCap\.dll"/);
});
