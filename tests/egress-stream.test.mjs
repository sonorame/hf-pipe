import assert from "node:assert/strict";
import test from "node:test";
import {
  ackPayload,
  createAckWindow,
  dataPayload,
  openPayload,
  parseAck,
  parseData,
  parseOpen,
  TYPE_STREAM_ACK,
  TYPE_STREAM_CLOSE,
  TYPE_STREAM_DATA,
  TYPE_STREAM_OPEN,
} from "../src/egress-stream.mjs";

test("open payload roundtrip", () => {
  const parsed = parseOpen(openPayload("api2.cursor.sh", 443));
  assert.deepEqual(parsed, { host: "api2.cursor.sh", port: 443 });
});

test("data seq and bytes roundtrip", () => {
  const parsed = parseData(dataPayload(7, Buffer.from("hi")));
  assert.equal(parsed.seq, 7);
  assert.equal(parsed.bytes.toString(), "hi");
});

test("ack roundtrip", () => {
  assert.equal(parseAck(ackPayload(3)).seq, 3);
});

test("ack window blocks at max then unblocks", () => {
  const w = createAckWindow(2);
  assert.equal(w.takeSend(), 0);
  assert.equal(w.takeSend(), 1);
  assert.equal(w.takeSend(), null);
  assert.equal(w.blocked, true);
  w.ack(0);
  assert.equal(w.takeSend(), 2);
  assert.equal(w.pending, 2);
});

test("stream type numbers stay out of ping/rpc range", () => {
  assert.equal(TYPE_STREAM_OPEN, 20);
  assert.equal(TYPE_STREAM_DATA, 21);
  assert.equal(TYPE_STREAM_ACK, 22);
  assert.equal(TYPE_STREAM_CLOSE, 23);
});
