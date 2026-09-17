import assert from "node:assert/strict";
import test from "node:test";
import { formatHopLogLine, pushHopLog, readHopLogAfter, resetHopLog } from "../src/hop-log.js";

test("human lines do not talk about buttons", () => {
  assert.equal(formatHopLogLine("up"), "Канал жив.");
  assert.equal(formatHopLogLine("down"), "Канал пропал.");
  assert.equal(formatHopLogLine("failed"), "Труба оборвалась. Собираю заново.");
  assert.equal(formatHopLogLine("recycle", { gen: 2 }), "Собираю новую трубу. Попытка 2.");
  assert.equal(formatHopLogLine("pong-miss"), "Пульса нет. Собираю трубу заново.");
  assert.doesNotMatch(formatHopLogLine("up"), /Пинг|Доктор|Новый канал|Перезапуск/);
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
