import net from "node:net";

function parseConnect(head) {
  const text = head.toString("utf8");
  const line = text.split(/\r?\n/)[0] || "";
  const m = line.match(/^CONNECT\s+([^:\s]+):(\d+)\s+HTTP\/1\.[01]/i);
  if (!m) return null;
  return { host: m[1], port: Number(m[2]) };
}

function splitHead(buf) {
  const idx = buf.indexOf("\r\n\r\n");
  if (idx < 0) return null;
  return { head: buf.subarray(0, idx), rest: buf.subarray(idx + 4) };
}

export function createConnectProxy(options) {
  const bind = options.bind || "127.0.0.1";
  const port = Number(options.port);
  if (!Number.isFinite(port) || port < 0) throw new Error("port required");
  const onConnect = options.onConnect;
  if (typeof onConnect !== "function") throw new Error("onConnect required");

  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let handed = false;
    const onData = (chunk) => {
      if (handed) return;
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 8192) {
        socket.destroy();
        return;
      }
      const split = splitHead(buf);
      if (!split) return;
      handed = true;
      socket.removeListener("data", onData);
      const req = parseConnect(split.head);
      if (!req) {
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        return;
      }
      Promise.resolve(onConnect(req))
        .then((result) => {
          if (!result || result.ok === false) {
            const reason = String(result?.error || "forbidden");
            const code = /rtc down|not up/i.test(reason) ? 502 : 403;
            const phrase = code === 502 ? "Bad Gateway" : "Forbidden";
            socket.end(`HTTP/1.1 ${code} ${phrase}\r\nConnection: close\r\n\r\n`);
            return;
          }
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (split.rest.length) result.stream.write(split.rest);
          socket.pipe(result.stream);
          result.stream.pipe(socket);
          socket.on("close", () => result.stream.destroy());
          result.stream.on("close", () => socket.destroy());
          result.stream.on("error", () => socket.destroy());
        })
        .catch((error) => {
          socket.end(`HTTP/1.1 502 ${String(error.message || error)}\r\nConnection: close\r\n\r\n`);
        });
    };
    socket.on("data", onData);
    socket.on("error", () => {});
  });

  return {
    bind,
    port,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, bind, () => {
          server.removeListener("error", reject);
          resolve(server.address());
        });
      });
    },
    address() {
      return server.address();
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
