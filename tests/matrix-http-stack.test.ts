import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(join(here, "../src/matrix/client.ts"), "utf8");
const indexSrc = readFileSync(join(here, "../index.mjs"), "utf8");

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
