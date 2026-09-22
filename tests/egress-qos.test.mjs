import assert from "node:assert/strict";
import test from "node:test";
import { createQosQueue } from "../src/egress-qos.mjs";

test("rpc jobs flush before stream jobs", async () => {
  const q = createQosQueue();
  const order = [];
  q.pushStream(async () => {
    order.push("stream");
  });
  q.pushRpc(async () => {
    order.push("rpc");
  });
  await q.flush();
  assert.deepEqual(order, ["rpc", "stream"]);
});
