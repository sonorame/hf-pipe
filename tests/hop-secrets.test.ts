import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hopSecretsDir, hopSessionFile } from "../src/secrets-path.js";

test("hop session lives under .hf-pipe, not the MCP cursor secrets", () => {
  const home = "C:\\Users\\op";
  const hop = hopSessionFile(home, {});
  const mcp = join(home, ".cursor", "secrets", "matrix-session.json");
  assert.equal(hop, join(home, ".hf-pipe", "secrets", "matrix-session.json"));
  assert.notEqual(hop, mcp);
  assert.equal(hopSecretsDir(home, {}), join(home, ".hf-pipe", "secrets"));
});

test("MATRIX_SESSION_FILE and HF_SECRETS_DIR still override", () => {
  assert.equal(hopSessionFile("C:\\x", { MATRIX_SESSION_FILE: "D:\\s.json" }), "D:\\s.json");
  assert.equal(
    hopSessionFile("C:\\x", { HF_SECRETS_DIR: "D:\\sec" }),
    join("D:\\sec", "matrix-session.json"),
  );
});

test("config.mjs does not fall back to .cursor/secrets", () => {
  const src = readFileSync(new URL("../src/config.mjs", import.meta.url), "utf8");
  assert.match(src, /hopSecretsDir|hopSessionFile/);
  assert.doesNotMatch(src, /\.cursor[\\/]+secrets/);
});

test("start-clean.cmd does not treat MCP session as hop session", async () => {
  const { readFileSync } = await import("node:fs");
  const cmd = readFileSync(new URL("../src/start-clean.cmd", import.meta.url), "utf8");
  assert.match(cmd, /\.hf-pipe\\secrets\\matrix-session\.json/);
  assert.doesNotMatch(cmd, /\.cursor\\secrets\\matrix-session/);
});
