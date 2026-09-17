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
  formatHopCaption,
  formatHopField,
  icePathIsLive,
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
  assert.equal(s.dcText, "открыта");
  assert.equal(s.connectionText, "есть");
  assert.equal(s.iceText, "найден");
  assert.match(s.caption, /Канал жив/);
});

test("caption tells age and peer host in plain russian", () => {
  assert.equal(formatHopCaption({ rtc: false }), "Трубы нет. Демон сам собирает.");
  assert.equal(formatHopCaption({ rtc: true, pongAgeMs: 3200, peerHost: "box" }), "Канал жив. Пульс 3 с назад. Отвечает box.");
  assert.equal(formatHopField("dc", "open"), "открыта");
  assert.equal(formatHopField("ice", "failed"), "не найден");
  assert.equal(formatHopField("connection", "new"), "старт");
});

test("local ICE completed before an answer is not a live path", () => {
  assert.equal(
    icePathIsLive({ ice: "completed", signaling: "have-local-offer", connection: "new" }),
    false,
  );
  const s = shapeHopStatus({
    rtc: false,
    ice: "completed",
    signaling: "have-local-offer",
    connection: "new",
    dc: "connecting",
  });
  assert.notEqual(s.iceText, "найден");
  assert.equal(s.signalingText, "жду ответ");
  assert.equal(s.connectionText, "старт");
});

test("ICE connected after a stable session is a live path", () => {
  assert.equal(
    icePathIsLive({ ice: "connected", signaling: "stable", connection: "connecting" }),
    true,
  );
  const s = shapeHopStatus({
    ice: "connected",
    signaling: "stable",
    connection: "connecting",
  });
  assert.equal(s.iceText, "найден");
  assert.equal(s.signalingText, "есть");
});

test("board HTML is a live operator panel, not a desktop viewer", () => {
  const html = renderHopBoardHtml();
  assert.match(html, /<title>Hop<\/title>/);
  assert.match(html, /fetch\("\/status"\)/);
  assert.match(html, /fetch\("\/log\?after="/);
  assert.match(html, /id="log"/);
  assert.match(html, /id="caption"/);
  assert.match(html, /Труба/);
  assert.match(html, /id="fSig"/);
  assert.match(html, /Сигнал/);
  assert.doesNotMatch(html, /data-act/);
  assert.doesNotMatch(html, /Пинг/);
  assert.doesNotMatch(html, /Доктор/);
  assert.doesNotMatch(html, /Новый канал/);
  assert.doesNotMatch(html, /Перезапуск/);
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
  assert.match(text, /kind === "log"/);
  assert.match(text, /parseHopControl/);
  assert.equal(text.includes("hf-view.html"), false);
});

test("rtc-pipe exposes snapshot and a manual recycle for the board", () => {
  const src = readFileSync(join(root, "src", "rtc-pipe.mjs"), "utf8");
  assert.match(src, /export function rtcSnapshot/);
  assert.match(src, /export async function recycleRtcNow/);
});
