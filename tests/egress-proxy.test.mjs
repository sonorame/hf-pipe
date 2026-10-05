import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { rpcPort } from "../src/config.mjs";
import { egressPort } from "../src/cursor-proxy-config.mjs";
import { createConnectProxy } from "../src/egress-proxy.mjs";
import { httpPageKind } from "../src/hop-surface.mjs";

function readHttp(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(payload));
    let buf = "";
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(buf || "timeout");
    }, 800);
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      if (buf.includes("\r\n\r\n") && (buf.includes("ping") || /HTTP\/1.1 [45]/.test(buf))) {
        clearTimeout(timer);
        socket.destroy();
        resolve(buf);
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

test("CONNECT echo, deny, rtc-down and SOCKS are distinct", async () => {
  const proxy = createConnectProxy({
    bind: "127.0.0.1",
    port: 0,
    async onConnect(req) {
      if (req.host === "example.com") return { ok: false, error: "host not allowed" };
      if (req.host === "down.cursor.sh") return { ok: false, error: "rtc down" };
      const stream = new Duplex({
        read() {},
        write(chunk, _enc, cb) {
          this.push(chunk);
          cb();
        },
      });
      return { ok: true, stream };
    },
  });
  try {
    const addr = await proxy.listen();
    assert.ok(String(addr.address).includes("127.0.0.1"));
    const port = addr.port;
    const denied = await readHttp(port, "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n");
    assert.match(denied, /^HTTP\/1.1 403/);
    const down = await readHttp(port, "CONNECT down.cursor.sh:443 HTTP/1.1\r\n\r\n");
    assert.match(down, /^HTTP\/1.1 502/);
    const ok = await readHttp(
      port,
      "CONNECT api2.cursor.sh:443 HTTP/1.1\r\nHost: api2.cursor.sh:443\r\n\r\nping",
    );
    assert.match(ok, /HTTP\/1.1 200 Connection Established/);
    assert.match(ok, /ping/);
    const socks = await readHttp(port, Buffer.from([0x05, 0x01, 0x00]));
    assert.match(String(socks), /400|timeout/);
  } finally {
    await proxy.close();
  }
});

test("egress CONNECT is not the dirty RPC port and not a viewer", () => {
  assert.equal(egressPort({}), 18766);
  assert.notEqual(egressPort({}), rpcPort());
  assert.equal(httpPageKind("GET", "/view"), "not_found");
  const src = dirname(fileURLToPath(import.meta.url));
  const text = readFileSync(join(src, "../src/egress-proxy.mjs"), "utf8");
  assert.match(text, /CONNECT/);
  assert.doesNotMatch(text, /SOCKS/i);
  assert.match(text, /127\.0\.0\.1/);
});
