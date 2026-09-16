import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(join(here, "../src/matrix/client.ts"), "utf8");
const indexSrc = readFileSync(join(here, "../src/index.mjs"), "utf8");

test("Matrix client does not wrap SDK HTTP with node-fetch, Agent, or extra abort", () => {
  assert.equal(clientSrc.includes('from "node-fetch"'), false);
  assert.equal(clientSrc.includes("https.Agent"), false);
  assert.equal(clientSrc.includes("timedFetch"), false);
  assert.equal(clientSrc.includes("boundedRequestSignal"), false);
  assert.equal(clientSrc.includes("family: 4"), false);
  assert.equal(clientSrc.includes("createMatrixSdkClientOptions"), true);
  assert.equal(clientSrc.includes("applyNodeNetworkPolicy"), true);
  assert.equal(clientSrc.includes("pinnedFetch"), true);
});

test("daemon entry applies Node network policy before Matrix boot", () => {
  const applyAt = indexSrc.indexOf("applyNodeNetworkPolicy()");
  const bootAt = indexSrc.indexOf("bootClient(");
  assert.ok(applyAt >= 0);
  assert.ok(bootAt > applyAt);
});

test("compiled network-policy exports pinnedFetch for index.mjs", () => {
  const dist = readFileSync(join(here, "../dist/network-policy.js"), "utf8");
  assert.equal(indexSrc.includes("pinnedFetch"), true);
  assert.match(dist, /export (async )?function pinnedFetch/);
  assert.equal(dist.includes("https.Agent"), false);
});

test("daemon recycles after hibernate clock jump", () => {
  assert.equal(indexSrc.includes("shouldRecycleAfterClockJump"), true);
});

test("RTC retry does not wait connecting forever", () => {
  const rtcSrc = readFileSync(join(here, "../src/rtc-pipe.mjs"), "utf8");
  assert.equal(rtcSrc.includes("shouldRetryRtcOffer"), true);
});

test("dirty start loop does not use timeout /t", () => {
  const cmd = readFileSync(join(here, "../src/start-dirty.cmd"), "utf8");
  assert.equal(/timeout\s+\/t/i.test(cmd), false);
  assert.equal(cmd.includes("index.mjs"), true);
  assert.equal(/ping 127\.0\.0\.1/i.test(cmd), true);
});

test("network policy loads npm undici, not the missing node:undici builtin", () => {
  const src = readFileSync(join(here, "../src/network-policy.ts"), "utf8");
  assert.equal(src.includes('require("node:undici")'), false);
  assert.equal(src.includes('require("undici")'), true);
  assert.equal(src.includes("connectTimeout"), true);
  assert.equal(src.includes("dispatcher on"), true);
  assert.equal(src.includes("retry on"), true);
  assert.equal(src.includes("RetryAgent"), true);
});
