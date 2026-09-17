import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runCleanJob } from "../src/clean-jobs.mjs";
import {
  DROPPED_INPUT_JOBS,
  HOP_JOBS,
  httpPageKind,
  isDroppedInputJob,
  isHopJob,
} from "../src/hop-surface.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../src");
const root = join(here, "..");

test("CLI and screenshot stay; remote input is gone", () => {
  assert.equal(isHopJob("shell"), true);
  assert.equal(isHopJob("screenshot"), true);
  assert.equal(isHopJob("mouse"), false);
  assert.equal(isDroppedInputJob("mouse"), true);
  assert.equal(isDroppedInputJob("key"), true);
  assert.equal(isDroppedInputJob("type"), true);
  assert.equal(HOP_JOBS.includes("screenshot"), true);
  assert.equal(DROPPED_INPUT_JOBS.includes("shell"), false);
});

test("localhost HTTP is RPC plus operator board, no desktop viewer", () => {
  assert.equal(httpPageKind("GET", "/status"), "status");
  assert.equal(httpPageKind("POST", "/ask"), "ask");
  assert.equal(httpPageKind("GET", "/"), "board");
  assert.equal(httpPageKind("GET", "/index.html"), "board");
  assert.equal(httpPageKind("GET", "/log"), "log");
  assert.equal(httpPageKind("POST", "/control"), "control");
  assert.equal(httpPageKind("GET", "/view"), "not_found");
  assert.equal(httpPageKind("GET", "/shot"), "not_found");
});

test("clean jobs reject mouse/key/type without touching input.ps1", async () => {
  for (const type of ["mouse", "key", "type", "click", "input"]) {
    const one = await runCleanJob({ type, body: { op: "move", x: 1, y: 1, text: "a", keys: ["enter"] } });
    assert.equal(one.ok, false);
    assert.match(String(one.error), /no handler/);
  }
});

test("ping still answers", async () => {
  const one = await runCleanJob({ type: "ping", body: {} });
  assert.equal(one.ok, true);
  assert.ok(one.host);
});

test("viewer page and SendInput helper are deleted", () => {
  assert.equal(existsSync(join(src, "hf-view.html")), false);
  assert.equal(existsSync(join(src, "input.ps1")), false);
});

test("daemon HTTP source has no live viewer routes", () => {
  const text = readFileSync(join(src, "index.mjs"), "utf8");
  assert.equal(text.includes("hf-view.html"), false);
  assert.equal(text.includes('pathname === "/shot"'), false);
  assert.equal(text.includes('pathname === "/view"'), false);
  assert.match(text, /httpPageKind/);
  const alias = readFileSync(join(src, "hf-matrix.mjs"), "utf8");
  assert.equal(alias.includes("hf-view.html"), false);
  assert.equal(alias.includes("/shot"), false);
});

test("MCP and dirty.py no longer expose remote input", () => {
  const mcp = readFileSync(join(src, "hf-clean-mcp.mjs"), "utf8");
  assert.equal(mcp.includes("clean_mouse"), false);
  assert.equal(mcp.includes("clean_key"), false);
  assert.equal(mcp.includes("clean_type"), false);
  assert.match(mcp, /clean_screenshot/);
  assert.match(mcp, /clean_shell/);

  const py = readFileSync(join(src, "dirty.py"), "utf8");
  assert.equal(/"mouse"/.test(py), false);
  assert.equal(/"key"/.test(py), false);
  assert.match(py, /screenshot/);
});

test("manifest and readme do not advertise a live desktop", () => {
  const manifest = JSON.parse(readFileSync(join(root, "MANIFEST.json"), "utf8"));
  assert.equal(manifest.rpc.viewer, undefined);
  assert.equal(manifest.jobs.includes("mouse"), false);
  assert.equal(manifest.jobs.includes("key"), false);
  assert.equal(manifest.jobs.includes("type"), false);
  assert.equal(manifest.jobs.includes("screenshot"), true);
  assert.equal(manifest.mcp.tools.includes("clean_mouse"), false);
  assert.equal(manifest.mcp.tools.includes("clean_screenshot"), true);

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.equal(readme.includes("hf-view"), false);
  assert.doesNotMatch(readme, /ask mouse/);
  assert.doesNotMatch(readme, /локальный просмотр/);
  assert.match(readme, /screenshot/i);
});
