import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const diagnoseCmd = readFileSync(new URL("../src/diagnose.cmd", import.meta.url), "utf8");
const diagnoseJs = readFileSync(new URL("../src/diagnose.mjs", import.meta.url), "utf8");
const startClean = readFileSync(new URL("../src/start-clean.cmd", import.meta.url), "utf8");

test("diagnose.cmd prefers Program Files node like start-clean", () => {
  const pf = 'set "NODE=C:\\Program Files\\nodejs\\node.exe"';
  assert.ok(diagnoseCmd.includes(pf), "diagnose.cmd must set Program Files node");
  assert.ok(startClean.includes(pf), "start-clean.cmd must set Program Files node");
  const diagPf = diagnoseCmd.indexOf(pf);
  const diagPack = diagnoseCmd.indexOf('set "NODE=%~dp0node.exe"');
  assert.ok(diagPack < 0 || diagPf < diagPack, "Program Files before pack node.exe");
});

test("diagnose.mjs measures pinnedFetch not only global fetch", () => {
  assert.match(diagnoseJs, /pinnedFetch/);
  assert.match(diagnoseJs, /fetch pinned/);
});
