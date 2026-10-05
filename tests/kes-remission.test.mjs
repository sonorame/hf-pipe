import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyJournalLine,
  localStops,
  mayStartChange,
  parseHelpStop,
  parseStatus,
  postRebootOrder,
  rollbackActions,
} from "../src/kes-remission.mjs";

const T0 = "2026-10-02T12:00:00";

test("parseHelpStop returns BehaviorDetection and HipsTask from HELP text", () => {
  const text = "BehaviorDetection\nHipsTask\n";
  assert.deepEqual(parseHelpStop(text), {
    ok: true,
    names: ["BehaviorDetection", "HipsTask"],
  });
});

test("parseHelpStop refuses empty text", () => {
  const parsed = parseHelpStop("");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.names, undefined);
});

test("parseHelpStop refuses a read error", () => {
  const parsed = parseHelpStop("read error\n");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.names, undefined);
});

test("parseStatus returns a running BehaviorDetection task", () => {
  assert.deepEqual(parseStatus("BehaviorDetection running\n"), {
    ok: true,
    running: ["BehaviorDetection"],
  });
});

test("parseStatus refuses garbage", () => {
  const parsed = parseStatus("garbage");
  assert.equal(parsed.ok, false);
  assert.equal(parsed.running, undefined);
});

test("classifyJournalLine breaks on a detection after T0", () => {
  assert.equal(classifyJournalLine("2026-10-02T12:01:00 детекция", T0), "break");
});

test("classifyJournalLine breaks on a block after T0", () => {
  assert.equal(classifyJournalLine("2026-10-02T12:01:00 блокировка файла", T0), "break");
});

test("classifyJournalLine ignores a database update after T0", () => {
  assert.equal(classifyJournalLine("2026-10-02T12:01:00 обновление баз", T0), "ignore-update");
});

test("classifyJournalLine ignores a klnagent pulse after T0", () => {
  assert.equal(classifyJournalLine("2026-10-02T12:01:00 пульс klnagent", T0), "ignore-pulse");
});

test("classifyJournalLine does not break on a line before T0", () => {
  assert.equal(classifyJournalLine("2026-10-02T11:59:59 детекция", T0), "before-t0");
});

test("mayStartChange halts when a running task has no allowed stop", () => {
  assert.deepEqual(
    mayStartChange({
      running: ["BehaviorDetection", "UnknownScan"],
      helpNames: ["BehaviorDetection", "HipsTask"],
    }),
    { halt: true, stops: [] },
  );
});

test("localStops returns only names present in the HELP record", () => {
  assert.deepEqual(
    localStops(["BehaviorDetection", "HipsTask"], ["BehaviorDetection", "Mystery"]),
    ["BehaviorDetection"],
  );
});

test("rollbackActions is empty when nothing changed", () => {
  assert.deepEqual(rollbackActions([]), []);
});

test("rollbackActions starts a profile that this change stopped", () => {
  assert.deepEqual(rollbackActions([{ action: "STOP", name: "BehaviorDetection" }]), [
    { action: "START", name: "BehaviorDetection" },
  ]);
});

test("rollbackActions never restarts AVP, avpsus, or klnagent", () => {
  const actions = rollbackActions([
    { action: "STOP", name: "AVP" },
    { action: "STOP", name: "avpsus.KES.21.21" },
    { action: "STOP", name: "klnagent" },
    { action: "STOP", name: "HipsTask" },
  ]);
  assert.deepEqual(actions, [{ action: "START", name: "HipsTask" }]);
});

test("postRebootOrder is file, hostname, ui, journal, status", () => {
  assert.deepEqual(postRebootOrder(), [
    "file",
    "C:\\Windows\\System32\\hostname.exe",
    "kes-ui",
    "journal",
    "status",
  ]);
});
