import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { kiloPythonSpawn, makePythonKiloQueryFn, probeKilo } from "../src/clean-facets.mjs";

const now = Date.parse("2026-09-21T10:00:00+04:00");
const updated = Date.parse("2026-09-21T09:22:00+04:00");

test("python kilo-query reads a real sqlite fixture", () => {
  const dir = mkdtempSync(join(tmpdir(), "kilo-fix-"));
  const db = join(dir, "kilo.db");
  const setup = join(dir, "setup.py");
  writeFileSync(
    setup,
    `
import sqlite3
con = sqlite3.connect(${JSON.stringify(db)})
cur = con.cursor()
cur.execute("CREATE TABLE session (id TEXT, title TEXT, directory TEXT, agent TEXT, model TEXT, time_created INTEGER, time_updated INTEGER)")
cur.execute("CREATE TABLE part (session_id TEXT, time_created INTEGER, data TEXT)")
cur.execute("INSERT INTO session VALUES (?,?,?,?,?,?,?)", ("sess-today", "ASSET-AUTH: mTLS", "", "kimi", "Kimi-CLUSTER", ${updated}, ${updated}))
cur.execute("INSERT INTO part VALUES (?,?,?)", ("sess-today", ${updated - 2}, '{"type":"step-start"}'))
cur.execute("INSERT INTO part VALUES (?,?,?)", ("sess-today", ${updated - 1}, '{"type":"text","text":"old"}'))
cur.execute("INSERT INTO part VALUES (?,?,?)", ("sess-today", ${updated}, '{"type":"text","text":"prodolzhi"}'))
con.commit()
con.close()
`,
    "utf8",
  );
  execFileSync("python", [setup], { timeout: 5000, windowsHide: true });
  const queryFn = makePythonKiloQueryFn(db);
  const rows = queryFn("sessions");
  assert.equal(rows[0].last_text, "prodolzhi");
  const got = probeKilo({ queryFn, now });
  assert.equal(got.sessions[0].id, "sess-today");
  assert.equal(got.sessions[0].title, "ASSET-AUTH: mTLS");
  assert.equal(got.sessions[0].lastText, "prodolzhi");
});

test("kilo-query opens sqlite immutable so a writer lock cannot eat the 2s budget", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "kilo-query.py"), "utf8");
  assert.match(src, /immutable=1/);
  assert.match(src, /replace\("\\\\", "\/"\)/);
});

test("win32 kilo query uses py -3 so WindowsApps python is not spawned", () => {
  const spawn = kiloPythonSpawn({ HF_PYTHON: "" }, "win32");
  assert.equal(spawn.cmd, "py");
  assert.deepEqual(spawn.prefix, ["-3"]);

  const dir = mkdtempSync(join(tmpdir(), "kilo-py-"));
  const db = join(dir, "kilo.db");
  writeFileSync(db, "");
  let seen = null;
  const queryFn = makePythonKiloQueryFn(db, (cmd, args, opts) => {
    seen = { cmd, args, opts };
    return "[]";
  }, { platform: "win32", env: {} });
  queryFn("sessions");
  assert.equal(seen.cmd, "py");
  assert.equal(seen.args[0], "-3");
  assert.match(String(seen.args[1]), /kilo-query\.py$/);
  assert.equal(seen.args[2], db);
  assert.equal(seen.args[3], "sessions");
  assert.ok(seen.opts.timeout > 2000);
});

test("probeKilo uses last_text from sessions and unwraps JSON model", () => {
  const kinds = [];
  const got = probeKilo({
    now,
    queryFn: (kind) => {
      kinds.push(kind);
      if (kind === "sessions") {
        return [
          {
            id: "sess-today",
            title: "t",
            model: '{"id":"Kimi-CLUSTER","providerID":"provider"}',
            time_updated: updated,
            last_text: "hi",
          },
        ];
      }
      throw new Error("parts should not run");
    },
  });
  assert.deepEqual(kinds, ["sessions"]);
  assert.equal(got.sessions[0].lastText, "hi");
  assert.equal(got.sessions[0].model, "Kimi-CLUSTER");
});
