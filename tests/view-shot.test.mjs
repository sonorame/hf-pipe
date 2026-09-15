import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  LIVE_MAX_MS,
  liveShotQuery,
  mapPointer,
  normalizeScreens,
  parseShotQuery,
  selectDisplay,
} from "../src/view-shot.mjs";

const here = dirname(fileURLToPath(import.meta.url));

const screens = [
  { i: 0, x: 0, y: 0, width: 1920, height: 1080, primary: true },
  { i: 1, x: 1920, y: 0, width: 2560, height: 1440, primary: false },
];

test("live view shows one display at a time", () => {
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

test("live shot query keeps JPEG small enough for 1s hop", () => {
  assert.ok(LIVE_MAX_MS <= 1000);
  const q = liveShotQuery(1);
  assert.equal(q.display, 1);
  assert.ok(q.maxw <= 1920);
  assert.ok(q.quality <= 28);
  assert.match(q.path, /display=1/);
  assert.match(q.path, /maxw=/);
});

test("shot query parses display from /shot URL", () => {
  const parsed = parseShotQuery("http://127.0.0.1:18765/shot?display=1&maxw=960&q=22");
  assert.equal(parsed.display, 1);
  assert.equal(parsed.maxw, 960);
  assert.equal(parsed.quality, 22);
});

test("view page can switch screens and does not stitch virtual desktop", () => {
  const html = readFileSync(join(here, "../src/hf-view.html"), "utf8");
  assert.match(html, /display/);
  assert.match(html, /Экран/);
  assert.match(html, /mousemove/);
  assert.match(html, /клик по картинке/i);
  assert.match(html, /flex-direction:\s*column/);
  assert.equal(html.includes("calc(100%"), false);
  assert.equal(html.includes("maxw=1280"), false);
});

test("pointer maps through letterboxed contain image onto one display", () => {
  const geom = { left: 1920, top: 0, width: 1920, height: 1080 };
  const filled = { left: 10, top: 20, width: 960, height: 540 };
  const natural = { width: 960, height: 540 };
  const tl = mapPointer({ clientX: 10, clientY: 20 }, filled, geom, natural);
  assert.equal(Math.round(tl.x), 1920);
  assert.equal(Math.round(tl.y), 0);
  const br = mapPointer({ clientX: 970, clientY: 560 }, filled, geom, natural);
  assert.equal(Math.round(br.x), 3840);
  assert.equal(Math.round(br.y), 1080);
  const box = { left: 0, top: 0, width: 800, height: 600 };
  const mid = mapPointer({ clientX: 400, clientY: 75 + 225 }, box, geom, natural);
  assert.equal(Math.round(mid.x), 1920 + 960);
  assert.equal(Math.round(mid.y), 540);
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
});
