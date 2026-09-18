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

test("RTC session follows one outstanding offer and gen owner", () => {
  const rtcSrc = readFileSync(join(here, "../src/rtc-pipe.mjs"), "utf8");
  assert.equal(rtcSrc.includes("shouldRetryRtcOffer"), true);
  assert.equal(rtcSrc.includes("shouldAcceptRemoteOffer"), true);
  assert.equal(rtcSrc.includes("localSdpReadyToSignal"), true);
  assert.equal(rtcSrc.includes("offerCreateInFlight"), true);
  assert.equal(rtcSrc.includes("outstandingOffer"), true);
  assert.equal(rtcSrc.includes("rtc drop gen"), true);
  assert.equal(rtcSrc.includes("connectionState: pc?.connectionState"), true);
  assert.equal(rtcSrc.includes("iceConnectionState: pc?.iceConnectionState"), true);
  assert.equal(/await pc\.setLocalDescription/.test(rtcSrc), false);
  assert.equal(rtcSrc.includes("pc.setLocalDescription"), true);
});

test("RTC frames carry a process epoch next to gen", () => {
  const rtcSrc = readFileSync(join(here, "../src/rtc-pipe.mjs"), "utf8");
  assert.equal(rtcSrc.includes("sessionEpoch"), true);
  assert.equal(rtcSrc.includes("epoch: frame.epoch ?? sessionEpoch"), true);
  assert.equal(rtcSrc.includes("localEpoch: sessionEpoch"), true);
  assert.equal(rtcSrc.includes("remoteEpoch: frame.epoch"), true);
});

test("offerer 90s clock restarts after the offer is sent and after the answer arrives", () => {
  const rtcSrc = readFileSync(join(here, "../src/rtc-pipe.mjs"), "utf8");
  const sent = rtcSrc.slice(
    rtcSrc.indexOf("async function signalCreatedDescription"),
    rtcSrc.indexOf("function attachDc"),
  );
  const answered = rtcSrc.slice(
    rtcSrc.indexOf("async function applyAnswer"),
    rtcSrc.indexOf("async function applyIce"),
  );
  assert.equal(sent.includes("lastOfferAt = Date.now()"), true);
  assert.equal(answered.includes("lastOfferAt = Date.now()"), true);
});

test("dirty start script is not a live restart window", () => {
  const cmd = readFileSync(join(here, "../src/start-dirty.cmd"), "utf8");
  assert.equal(/timeout\s+\/t/i.test(cmd), false);
  assert.equal(/ping 127\.0\.0\.1/i.test(cmd), false);
  assert.equal(cmd.includes("goto loop"), false);
  assert.equal(cmd.includes("Leave this window open"), false);
  assert.equal(cmd.includes("HFPipe-dirty"), true);
});

test("start scripts are not the live restart loop", () => {
  for (const name of ["start-dirty.cmd", "start-clean.cmd"]) {
    const cmd = readFileSync(join(here, `../src/${name}`), "utf8");
    assert.equal(cmd.includes("goto loop"), false, name);
    assert.equal(cmd.includes("Leave this window open"), false, name);
    assert.equal(cmd.includes("HFPipe-"), true, name);
  }
});

test("daemon claims a single hop instance and exits 2 on a busy RPC port", () => {
  assert.equal(indexSrc.includes("claimHopInstance"), true);
  assert.equal(indexSrc.includes("hop already running pid"), true);
  assert.equal(indexSrc.includes("hopListenBusyExitCode"), true);
  assert.equal(indexSrc.includes("process.exit(2)"), true);
  assert.equal(indexSrc.includes("pidHeld"), true);
});

test("run.mjs does not restart when hop is already running", () => {
  const runSrc = readFileSync(join(here, "../scripts/run.mjs"), "utf8");
  assert.equal(runSrc.includes("code === 2"), true);
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
