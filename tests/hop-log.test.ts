import assert from "node:assert/strict";
import test from "node:test";
import { formatHopLogLine, pushHopLog, readHopLogAfter, resetHopLog } from "../src/hop-log.js";

test("human lines do not talk about buttons", () => {
  assert.equal(formatHopLogLine("up"), "Канал жив.");
  assert.equal(formatHopLogLine("down"), "Канал пропал.");
  assert.equal(formatHopLogLine("failed"), "Труба оборвалась. Собираю заново.");
  assert.equal(formatHopLogLine("recycle", { gen: 2 }), "Собираю новую трубу. Попытка 2.");
  assert.equal(formatHopLogLine("pong-miss"), "Пульса нет. Собираю трубу заново.");
  assert.equal(formatHopLogLine("pulse", { host: "box", ms: 12 }), "Пульс ок, 12 мс. Ответила box.");
  assert.equal(formatHopLogLine("pulse-fail"), "Пульс не дошел.");
  assert.doesNotMatch(formatHopLogLine("up"), /Пинг|Доктор|Новый канал|Перезапуск/);
});

test("offer and missing answer are plain lines", () => {
  assert.equal(formatHopLogLine("offer", { gen: 2 }), "Оффер ушел. Попытка 2.");
  assert.equal(formatHopLogLine("no-answer", { sec: 20 }), "Ответа нет 20 с.");
  assert.equal(formatHopLogLine("answer", { gen: 2 }), "Пришел ответ. Попытка 2.");
  assert.equal(formatHopLogLine("drop-gen", { remote: 1, have: 4 }), "Ответ на чужую попытку 1. У меня 4.");
  assert.equal(formatHopLogLine("peer", { peer: "DEV1" }), "Пир DEV1.");
});

test("rtc-pipe writes offer answer and drop to the board log", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/rtc-pipe.mjs", import.meta.url), "utf8");
  assert.match(src, /pushHopLog\("offer"/);
  assert.match(src, /pushHopLog\("no-answer"/);
  assert.match(src, /pushHopLog\("answer"/);
  assert.match(src, /pushHopLog\("drop-gen"/);
  assert.match(src, /if \(was\) pushHopLog\("down"/);
});

test("ring returns only lines after the cursor", () => {
  resetHopLog();
  const a = pushHopLog("up");
  const b = pushHopLog("down");
  assert.deepEqual(
    readHopLogAfter(a.id).map((x) => x.id),
    [b.id],
  );
  assert.equal(readHopLogAfter(0).length, 2);
});
