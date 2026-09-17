import assert from "node:assert/strict";
import test from "node:test";
import { hopCommandLineOurs, classifyHopLaunch } from "../src/hop-up-state.js";

test("index.mjs dirty is our hop", () => {
  assert.equal(
    hopCommandLineOurs(`"C:\\Program Files\\nodejs\\node.exe"  "C:\\x\\index.mjs" dirty`, "dirty"),
    true,
  );
});

test("MCP stdio or a recycled pid is not our hop", () => {
  assert.equal(hopCommandLineOurs(`node dist\\stdio-server.js`, "dirty"), false);
  assert.equal(hopCommandLineOurs(`node hf-clean-mcp.mjs`, "dirty"), false);
  assert.equal(hopCommandLineOurs(null, "dirty"), false);
});

test("rpc up with rtc skips wait and goes to doctor", () => {
  const p = classifyHopLaunch({
    rpc: { reachable: true, rtc: true, pid: 9 },
    pidFilePid: 9,
    pidAlive: true,
    commandLine: "node index.mjs dirty",
  });
  assert.equal(p.action, "doctor");
});

test("rpc up without rtc waits for the channel", () => {
  const p = classifyHopLaunch({
    rpc: { reachable: true, rtc: false, pid: 9 },
    pidFilePid: 9,
    pidAlive: true,
    commandLine: "node index.mjs dirty",
  });
  assert.equal(p.action, "wait-rtc");
});

test("alive pid that is not hop is stale and must be cleared before start", () => {
  const p = classifyHopLaunch({
    rpc: { reachable: false, error: "ECONNREFUSED" },
    pidFilePid: 32192,
    pidAlive: true,
    commandLine: "node dist\\stdio-server.js",
  });
  assert.equal(p.action, "clear-and-start");
});

test("dead pid file starts a new daemon", () => {
  const p = classifyHopLaunch({
    rpc: { reachable: false, error: "ECONNREFUSED" },
    pidFilePid: 1,
    pidAlive: false,
    commandLine: null,
  });
  assert.equal(p.action, "start");
});

test("our hop without rpc yet is still starting", () => {
  const p = classifyHopLaunch({
    rpc: { reachable: false, error: "ECONNREFUSED" },
    pidFilePid: 4,
    pidAlive: true,
    commandLine: "node index.mjs dirty",
  });
  assert.equal(p.action, "wait-rpc");
});
