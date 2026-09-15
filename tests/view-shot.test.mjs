import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  LIVE_MAX_MS,
  liveShotQuery,
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
  assert.ok(q.maxw <= 1024);
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
  assert.equal(html.includes("maxw=1280"), false);
});
