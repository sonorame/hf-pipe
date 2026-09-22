import assert from "node:assert/strict";
import { Duplex } from "node:stream";
import test from "node:test";
import { createEgressMux } from "../src/egress-mux.mjs";
import { createQosQueue } from "../src/egress-qos.mjs";

function echoDuplex() {
  const stream = new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      if (!this._echoed) {
        this._echoed = true;
        this.push(Buffer.from(chunk));
      }
      cb();
    },
  });
  stream.on("error", () => {});
  return stream;
}

function waitBytes(stream, n) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const finish = (err) => {
      if (size >= n) resolve(Buffer.concat(chunks).subarray(0, n));
      else reject(err || new Error("stream hang"));
    };
    const onData = (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= n) {
        stream.off("data", onData);
        resolve(Buffer.concat(chunks).subarray(0, n));
      }
    };
    stream.on("data", onData);
    stream.once("error", (err) => finish(err));
    setTimeout(() => finish(), 3000);
  });
}

test("mux copies CONNECT bytes both ways then dies when the dc closes", { timeout: 8000 }, async () => {
  let cleanMux;
  let dirtyMux;
  const hosts = ["127.0.0.1"];
  cleanMux = createEgressMux({
    hosts,
    suffixes: [],
    send: (type, id, payload) => dirtyMux.onFrame(type, id, payload),
  });
  dirtyMux = createEgressMux({
    hosts,
    suffixes: [],
    send: (type, id, payload) => cleanMux.onFrame(type, id, payload),
    connectTcp: async () => echoDuplex(),
  });
  const opened = await cleanMux.openLocal("127.0.0.1", 443);
  assert.equal(opened.ok, true);
  const got = waitBytes(opened.stream, 5);
  opened.stream.write("hello");
  assert.equal((await got).toString(), "hello");
  const closed = new Promise((resolve) => {
    if (opened.stream.destroyed) {
      resolve();
      return;
    }
    opened.stream.once("close", resolve);
  });
  cleanMux.closeAll("dc closed");
  dirtyMux.closeAll("dc closed");
  await closed;
});

test("rpc jobs stay ahead of stream frames on the same channel", async () => {
  const qos = createQosQueue();
  const order = [];
  for (let i = 0; i < 8; i += 1) {
    qos.pushStream(async () => {
      order.push("stream");
    });
  }
  qos.pushRpc(async () => {
    order.push("rpc");
  });
  await qos.flush();
  assert.equal(order[0], "rpc");
  assert.equal(order.filter((item) => item === "stream").length, 8);
});
