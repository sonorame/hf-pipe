import assert from "node:assert/strict";
import test from "node:test";
import { claimHopInstance, hopListenBusyExitCode } from "../src/hop-instance.js";

test("live pid in hf.pid is busy", () => {
  const wrote: string[] = [];
  const result = claimHopInstance({
    pidPath: "hf.pid",
    pid: 20,
    isAlive: (pid) => pid === 10,
    readFile: () => "10",
    writeFile: (_path, body) => {
      wrote.push(body);
    },
  });
  assert.equal(result.status, "busy");
  assert.equal(result.holderPid, 10);
  assert.deepEqual(wrote, []);
});

test("dead pid in hf.pid is occupied", () => {
  const wrote: string[] = [];
  const result = claimHopInstance({
    pidPath: "hf.pid",
    pid: 20,
    isAlive: () => false,
    readFile: () => "10",
    writeFile: (_path, body) => {
      wrote.push(body);
    },
  });
  assert.equal(result.status, "occupy");
  assert.deepEqual(wrote, ["20"]);
});

test("missing pid file is occupied", () => {
  const result = claimHopInstance({
    pidPath: "hf.pid",
    pid: 7,
    isAlive: () => true,
    readFile: () => null,
    writeFile: () => {},
  });
  assert.equal(result.status, "occupy");
});

test("EADDRINUSE means hop listen is busy", () => {
  assert.equal(hopListenBusyExitCode({ code: "EADDRINUSE" }), 2);
});

test("other listen errors are not a busy hop", () => {
  assert.equal(hopListenBusyExitCode({ code: "EACCES" }), null);
});
