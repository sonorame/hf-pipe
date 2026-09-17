import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  HOP_BOARD_ACTIONS,
  hopRestartDelayMs,
  parseDoctorStdout,
  parseHopControl,
  renderHopBoardHtml,
  shapeHopStatus,
} from "../src/hop-board.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("known board actions are ping recycle restart doctor", () => {
  assert.deepEqual(HOP_BOARD_ACTIONS, ["ping", "recycle", "restart", "doctor"]);
});

test("parseHopControl reads action and rejects junk", () => {
  assert.equal(parseHopControl({ action: "ping" }), "ping");
  assert.equal(parseHopControl({ action: "RECYCLE" }), "recycle");
  assert.equal(parseHopControl({ action: "restart" }), "restart");
  assert.equal(parseHopControl({ action: "doctor" }), "doctor");
  assert.equal(parseHopControl({ action: "mouse" }), null);
  assert.equal(parseHopControl({}), null);
  assert.equal(parseHopControl(null), null);
});

test("restart delay lets HTTP answer before exit(7)", () => {
  assert.equal(hopRestartDelayMs(), 250);
});

test("shapeHopStatus exposes channel fields for the board", () => {
  const s = shapeHopStatus({
    rtc: true,
    pid: 42,
    side: "dirty",
    dc: "open",
    connection: "connected",
    ice: "connected",
    signaling: "stable",
    gen: 3,
    epoch: "abc",
  });
  assert.equal(s.rtc, true);
  assert.equal(s.pid, 42);
  assert.equal(s.side, "dirty");
  assert.equal(s.dc, "open");
  assert.equal(s.connection, "connected");
  assert.equal(s.ice, "connected");
  assert.equal(s.signaling, "stable");
  assert.equal(s.gen, 3);
  assert.equal(s.epoch, "abc");
});

test("board HTML is a live operator panel, not a desktop viewer", () => {
  const html = renderHopBoardHtml();
  assert.match(html, /<title>Hop<\/title>/);
  assert.match(html, /fetch\("\/status"\)/);
  assert.match(html, /fetch\("\/control"/);
  assert.match(html, /Пинг/);
  assert.match(html, /Доктор/);
  assert.match(html, /Новый канал/);
  assert.match(html, /Перезапуск/);
  assert.doesNotMatch(html, /\/view/);
  assert.doesNotMatch(html, /\/shot/);
  assert.doesNotMatch(html, /mouse/);
});

test("parseDoctorStdout takes the JSON summary and NEXT line", () => {
  const out = [
    "GREEN node v24",
    "RED   e2e ping timeout",
    "",
    '{"side":"dirty","verdict":"RED","failing":["e2e"],"culprit":"e2e"}',
    "NEXT Локальный /status есть, ping до чистой не прошел.",
  ].join("\n");
  const p = parseDoctorStdout(out);
  assert.equal(p.verdict, "RED");
  assert.equal(p.culprit, "e2e");
  assert.deepEqual(p.failing, ["e2e"]);
  assert.match(p.next, /ping до чистой/);
});

test("daemon HTTP serves the board and control", () => {
  const text = readFileSync(join(root, "src", "index.mjs"), "utf8");
  assert.match(text, /kind === "board"/);
  assert.match(text, /renderHopBoardHtml/);
  assert.match(text, /kind === "control"/);
  assert.match(text, /parseHopControl/);
  assert.equal(text.includes("hf-view.html"), false);
});

test("rtc-pipe exposes snapshot and a manual recycle for the board", () => {
  const src = readFileSync(join(root, "src", "rtc-pipe.mjs"), "utf8");
  assert.match(src, /export function rtcSnapshot/);
  assert.match(src, /export async function recycleRtcNow/);
});
