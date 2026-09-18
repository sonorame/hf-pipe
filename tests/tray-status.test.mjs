import assert from "node:assert/strict";
import test from "node:test";
import { renderCasualBoardHtml, trayViewFromStatus } from "../src/tray-status.mjs";

test("missing status is gray", () => {
  const v = trayViewFromStatus(null);
  assert.equal(v.color, "gray");
  assert.equal(v.headline, "Нет supervisor");
  assert.match(v.tooltip, /Supervisor недоступен/);
});

test("rtc true is green", () => {
  const v = trayViewFromStatus({
    bootstrap: { side: "dirty" },
    report: { local: { rtc: true, dc: "open", signaling: "stable", pongAgeMs: 3200 } },
  });
  assert.equal(v.color, "green");
  assert.equal(v.headline, "Жива");
  assert.match(v.tooltip, /Труба жива/);
  assert.match(v.tooltip, /Пульс 3 с/);
});

test("assembling states are yellow", () => {
  for (const local of [
    { rtc: false, dc: "connecting" },
    { rtc: false, signaling: "have-local-offer" },
    { rtc: false, connection: "connecting" },
    { rtc: false, ice: "checking" },
  ]) {
    const v = trayViewFromStatus({ bootstrap: { side: "dirty" }, report: { local } });
    assert.equal(v.color, "yellow", JSON.stringify(local));
    assert.equal(v.headline, "Собирается");
    assert.match(v.tooltip, /Труба собирается/);
  }
});

test("bootstrap without health report is yellow assembling", () => {
  const v = trayViewFromStatus({ bootstrap: { side: "clean" }, report: null });
  assert.equal(v.color, "yellow");
  assert.equal(v.headline, "Собирается");
});

test("rtc false and not assembling is red", () => {
  const v = trayViewFromStatus({
    bootstrap: { side: "dirty" },
    report: { local: { rtc: false, dc: "closed", signaling: "stable", ice: "failed" } },
  });
  assert.equal(v.color, "red");
  assert.equal(v.headline, "Нет трубы");
  assert.match(v.tooltip, /Трубы нет/);
});

test("dirty menu shows local, peer when present, and details only", () => {
  const v = trayViewFromStatus({
    bootstrap: { side: "dirty" },
    report: {
      local: { rtc: true, host: "box-d", side: "dirty" },
      peer: { rtc: true, host: "box-c", side: "clean" },
    },
  });
  assert.deepEqual(
    v.menu.map((item) => item.label),
    ["Грязная  ок", "Чистая  ок", "Подробности"],
  );
  assert.equal(v.menu.every((item) => item.action !== "exit"), true);
  assert.equal(v.menu.at(-1).action, "details");
});

test("clean menu shows only this machine and details", () => {
  const v = trayViewFromStatus({
    bootstrap: { side: "clean" },
    report: {
      local: { rtc: false, host: "box-c", side: "clean" },
      peer: { rtc: true, host: "box-d", side: "dirty" },
    },
  });
  assert.deepEqual(
    v.menu.map((item) => item.label),
    ["Чистая  нет", "Подробности"],
  );
});

test("casual board shows headlines and debug link, not JSON dump", () => {
  const html = renderCasualBoardHtml();
  assert.match(html, /Жива/);
  assert.match(html, /Собирается/);
  assert.match(html, /Нет трубы/);
  assert.match(html, /127\.0\.0\.1:18765/);
  assert.match(html, /отладка/);
  assert.match(html, /fetch\("\/status"\)/);
  assert.doesNotMatch(html, /JSON\.stringify/);
  assert.doesNotMatch(html, /id="fPid"/);
  assert.doesNotMatch(html, /id="fEpoch"/);
});
