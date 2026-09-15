import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import test from "node:test";
import {
  QUEUE_LIVE_MS,
  isOsTempJunk,
  listSweepDeletes,
  readHotfolderTempConfig,
} from "../src/hotfolder-temp.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("temp config reads HF_TEMP_* with no-keep default", () => {
  const cfg = readHotfolderTempConfig({
    HF_TEMP_KEEP_MS: "0",
    HF_TEMP_SWEEP_MS: "15000",
    USERPROFILE: "C:\\Users\\x",
  });
  assert.equal(cfg.keepMs, 0);
  assert.equal(cfg.sweepMs, 15000);
  assert.match(cfg.root, /\.hf-pipe[\\/]local$/i);
});

test("from_clean.txt and pid stay, leftover queues go", () => {
  const now = 1_000_000;
  const deletes = listSweepDeletes(
    [
      { rel: "from_clean.txt", mtimeMs: now - 86_400_000 },
      { rel: "dirty.pid", mtimeMs: now - 86_400_000 },
      { rel: "outbox\\old.json", mtimeMs: now - QUEUE_LIVE_MS - 1 },
      { rel: "mxinbox\\sent\\done.json", mtimeMs: now },
      { rel: "shots\\a.jpg", mtimeMs: now },
      { rel: "work\\probe.py", mtimeMs: now },
      { rel: "outbox\\live.json", mtimeMs: now - 1_000 },
    ],
    now,
    { keepMs: 0 }
  );
  assert.deepEqual(deletes.sort(), [
    "mxinbox\\sent\\done.json",
    "outbox\\old.json",
    "shots\\a.jpg",
    "work\\probe.py",
  ]);
});

test("os temp capture leftovers are junk", () => {
  assert.equal(isOsTempJunk("cap-123.jpg"), true);
  assert.equal(isOsTempJunk("hf-in-9.json"), true);
  assert.equal(isOsTempJunk("chrome_debug.log"), false);
});

test("CursorMCP job and start scripts carry HF_TEMP sweep", () => {
  const keep = readFileSync(join(here, "../src/keep.js"), "utf8");
  const dirty = readFileSync(join(here, "../src/start-dirty.cmd"), "utf8");
  const clean = readFileSync(join(here, "../src/start-clean.cmd"), "utf8");
  const index = readFileSync(join(here, "../src/index.mjs"), "utf8");
  assert.match(keep, /temp-sweep\.mjs/);
  assert.match(dirty, /HF_TEMP_KEEP_MS/);
  assert.match(dirty, /HF_TEMP_SWEEP_MS/);
  assert.match(clean, /HF_TEMP_KEEP_MS/);
  assert.match(index, /sweepAllTemp/);
});
