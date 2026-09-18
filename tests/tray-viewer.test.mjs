import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const viewer = readFileSync(join(here, "../src/tray-viewer.ps1"), "utf8");

test("tray viewer polls 18764, has no Exit, opens details on left click", () => {
  assert.match(viewer, /127\.0\.0\.1:18764/);
  assert.match(viewer, /NotifyIcon/);
  assert.match(viewer, /Application\]::Run/);
  assert.match(viewer, /MouseButtons\]::Left/);
  assert.match(viewer, /Подробности/);
  assert.doesNotMatch(viewer, /Выход/);
  assert.doesNotMatch(viewer, /18765/);
});

test("tray viewer maps assembling and missing status like the view-model", () => {
  assert.match(viewer, /have-local-offer/);
  assert.match(viewer, /connecting/);
  assert.match(viewer, /checking/);
  assert.match(viewer, /Supervisor недоступен/);
  assert.match(viewer, /Труба собирается/);
  assert.match(viewer, /ShowBalloonTip/);
});

test("tray-viewer.ps1 has UTF-8 BOM so Windows PowerShell keeps Russian text", () => {
  const buf = readFileSync(join(here, "../src/tray-viewer.ps1"));
  assert.equal(buf[0], 0xef);
  assert.equal(buf[1], 0xbb);
  assert.equal(buf[2], 0xbf);
});
