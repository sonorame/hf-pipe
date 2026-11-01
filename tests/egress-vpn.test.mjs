import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { connectTcp } from "../src/egress-dialer.mjs";

test("VPN TCP connects to the validated public DNS result, never resolving again in the socket", async () => {
  let target;
  const socket = new EventEmitter();
  const result = await connectTcp("telegram.org", 443, {
    publicInternet: true,
    lookup: async () => [{ address: "127.0.0.1", family: 4 }, { address: "149.154.167.99", family: 4 }],
    connect: (options) => { target = options; queueMicrotask(() => socket.emit("connect")); return socket; },
  });
  assert.equal(result, socket);
  assert.equal(target.host, "149.154.167.99");
  assert.equal(target.port, 443);
});
