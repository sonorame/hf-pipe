import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDoctor, formatDoctorLines, nextDoctorHint } from "../src/doctor.js";

test("all checks ok is GREEN with no culprit", () => {
  const r = summarizeDoctor([
    { name: "node", ok: true },
    { name: "session", ok: true },
    { name: "versions", ok: true },
  ]);
  assert.equal(r.verdict, "GREEN");
  assert.deepEqual(r.failing, []);
  assert.equal(r.culprit, null);
});

test("first failing check is the culprit seam", () => {
  const r = summarizeDoctor([
    { name: "node", ok: true },
    { name: "tcp443", ok: false, detail: "timeout" },
    { name: "versions", ok: false, detail: "no 200" },
  ]);
  assert.equal(r.verdict, "RED");
  assert.deepEqual(r.failing, ["tcp443", "versions"]);
  assert.equal(r.culprit, "tcp443");
});

test("empty check list is RED (nothing proven)", () => {
  const r = summarizeDoctor([]);
  assert.equal(r.verdict, "RED");
  assert.equal(r.culprit, null);
});

test("skipped checks do not fail the verdict", () => {
  const r = summarizeDoctor([
    { name: "node", ok: true },
    { name: "scheduledTask", ok: true, skipped: true },
  ]);
  assert.equal(r.verdict, "GREEN");
  assert.deepEqual(r.failing, []);
});

test("each line is prefixed GREEN/RED/SKIP with the check name", () => {
  const lines = formatDoctorLines([
    { name: "node", ok: true, detail: "v24" },
    { name: "tcp443", ok: false, detail: "timeout" },
    { name: "scheduledTask", ok: true, skipped: true, detail: "n/a on clean" },
  ]);
  assert.deepEqual(lines, [
    "GREEN node v24",
    "RED   tcp443 timeout",
    "SKIP  scheduledTask n/a on clean",
  ]);
});

test("ECONNREFUSED on status points at the dirty daemon, not clean", () => {
  const h = nextDoctorHint("status", "local /status connect ECONNREFUSED 127.0.0.1:18765");
  assert.match(h, /18765/);
  assert.match(h, /грязн/i);
  assert.doesNotMatch(h, /start-clean/i);
});

test("rtc=false on status waits for the clean daemon, not a person", () => {
  const h = nextDoctorHint("status", "rtc=false pid=1 side=dirty");
  assert.match(h, /сам/);
  assert.doesNotMatch(h, /hop-up/i);
});

test("GREEN has an empty hint", () => {
  assert.equal(nextDoctorHint(null), "");
});

test("missing HFPipe task is a real hole, not a skippable hint", () => {
  const h = nextDoctorHint("scheduledTask", "The system cannot find the file specified.");
  assert.match(h, /HFPipe/);
  assert.doesNotMatch(h, /не влияет/);
});

test("missing logon task is a hole", () => {
  const h = nextDoctorHint("scheduledTaskLogon", "The system cannot find the file specified.");
  assert.match(h, /HFPipe|logon/i);
});

test("doctor queries the one side-specific HFPipe task", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/hop-doctor.mjs", import.meta.url), "utf8");
  assert.match(src, /HFPipe-\$\{SIDE\}/);
  assert.match(src, /scheduledTaskLogon/);
  assert.doesNotMatch(src, /CursorMCP/);
});
