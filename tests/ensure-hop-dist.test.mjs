import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const keepLoop = readFileSync(join(here, "../src/keep-loop.mjs"), "utf8");
const startClean = readFileSync(join(here, "../src/start-clean.cmd"), "utf8");
const startDirty = readFileSync(join(here, "../src/start-dirty.cmd"), "utf8");
const syncLive = readFileSync(join(here, "../scripts/sync-live-dirty.mjs"), "utf8");
const doctorHintSrc = readFileSync(join(here, "../src/doctor.ts"), "utf8");
const hopDoctor = readFileSync(join(here, "../src/hop-doctor.mjs"), "utf8");

const ensurePath = join(here, "../src/ensure-hop-dist.mjs");

test("keep-loop ensures dist before spawning index", () => {
  assert.match(keepLoop, /ensureHopDist/);
  assert.match(keepLoop, /ensure-hop-dist\.mjs/);
});

test("start-clean and start-dirty run ensure-hop-dist before index", () => {
  assert.match(startClean, /ensure-hop-dist\.mjs/);
  const ensureAt = startClean.indexOf("ensure-hop-dist.mjs");
  const indexAt = startClean.indexOf("src\\index.mjs clean");
  assert.ok(ensureAt >= 0 && indexAt > ensureAt, "ensure before index in start-clean");
  assert.match(startDirty, /ensure-hop-dist\.mjs/);
});

test("sync-live-dirty copies ensure-hop-dist.mjs", () => {
  assert.match(syncLive, /ensure-hop-dist\.mjs/);
});

test("doctor treats missing dist as its own seam", () => {
  assert.match(doctorHintSrc, /culprit === "dist"/);
  assert.match(hopDoctor, /missingDistModules/);
  assert.match(hopDoctor, /push\("dist"/);
});

test("ensureHopDist writes hop-board.js when index imports it and dist is empty", async () => {
  assert.equal(existsSync(ensurePath), true, "src/ensure-hop-dist.mjs must exist");
  const { ensureHopDist, missingDistModules } = await import(pathToFileURL(ensurePath).href);
  const root = mkdtempSync(join(tmpdir(), "hf-ensure-"));
  writeFileSync(
    join(root, "index.mjs"),
    'import { shapeHopStatus } from "./dist/hop-board.js";\nimport { pushHopLog } from "./dist/hop-log.js";\n',
  );
  assert.deepEqual(missingDistModules(root).sort(), ["hop-board.js", "hop-log.js"]);
  const result = ensureHopDist(root);
  assert.equal(existsSync(join(root, "dist", "hop-board.js")), true);
  assert.equal(existsSync(join(root, "dist", "hop-log.js")), true);
  assert.ok(result.wrote.includes("hop-board.js"));
  assert.deepEqual(missingDistModules(root), []);
  const board = await import(pathToFileURL(join(root, "dist", "hop-board.js")).href);
  assert.equal(typeof board.shapeHopStatus, "function");
  assert.equal(typeof board.hopRestartDelayMs, "function");
  assert.equal(typeof board.parseDoctorStdout, "function");
  assert.equal(typeof board.parseHopControl, "function");
  assert.equal(typeof board.renderHopBoardHtml, "function");
  const log = await import(pathToFileURL(join(root, "dist", "hop-log.js")).href);
  assert.equal(typeof log.pushHopLog, "function");
  assert.equal(typeof log.readHopLogAfter, "function");
});
