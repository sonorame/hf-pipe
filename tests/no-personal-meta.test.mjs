import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const skip = new Set(["node_modules", "dist", "compiled", ".git", ".data", ".cursor", "handoff"]);
const ext = new Set([".md", ".mjs", ".js", ".ts", ".py", ".json", ".cmd", ".ps1", ".yml", ".yaml", ".html", ".example"]);
const banned = [
  /Malykh/i,
  /malykh_kirill/i,
  /EDSIZHW/i,
  /edsizhfs/i,
  /Users\\Kirill/i,
  /Users\/Kirill/i,
  /@kirill:mtx/i,
  /hf-matrix-pack/i,
  /4z1x\.dev/i,
  /tarantino/i,
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (ext.has(extname(name)) || name === ".env.example" || name === "Dockerfile") {
      if (name !== "no-personal-meta.test.mjs" && name !== "AGENTS.md") out.push(p);
    }
  }
  return out;
}

test("repo text has no private lab names or account paths", () => {
  const files = walk(root);
  const hits = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const re of banned) {
      if (re.test(text)) hits.push(`${file} ${re}`);
    }
  }
  assert.deepEqual(hits, []);
});
