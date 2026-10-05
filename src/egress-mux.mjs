import { Duplex } from "node:stream";
import { hostAllowed } from "./egress-dialer.mjs";
import {
  TYPE_STREAM_ACK,
  TYPE_STREAM_CLOSE,
  TYPE_STREAM_DATA,
  TYPE_STREAM_OPEN,
  ackPayload,
  closePayload,
  createAckWindow,
  dataPayload,
  openPayload,
  parseAck,
  parseClose,
  parseData,
  parseOpen,
} from "./egress-stream.mjs";

function allocId(used) {
  let id = (Math.floor(Math.random() * 0x7fffffff) ^ Date.now()) >>> 0;
  while (id === 0 || used.has(id)) id = (id + 1) >>> 0;
  return id;
}

export function createEgressMux(options) {
  let txBytes = 0;
  let rxBytes = 0;
  const send = async (type, id, payload) => {
    await options.send(type, id, payload);
    if (type === TYPE_STREAM_DATA) txBytes += parseData(payload).bytes.length;
  };
  const connectTcp = options.connectTcp;
  const used = new Set();
  const local = new Map();
  const remote = new Map();
  const log = options.log || (() => {});

  function drop(id, reason) {
    used.delete(id);
    const a = local.get(id);
    const b = remote.get(id);
    local.delete(id);
    remote.delete(id);
    try {
      a?.stream?.destroy();
    } catch {
      // ignore
    }
    try {
      b?.socket?.destroy();
    } catch {
      // ignore
    }
    log("egress close", id, reason || "");
  }

  function hopStream(id, window) {
    const stream = new Duplex({
      allowHalfOpen: false,
      write(chunk, _enc, cb) {
        const bytes = Buffer.from(chunk);
        const trySend = () => {
          const seq = window.takeSend();
          if (seq == null) {
            stream.once("drain-window", trySend);
            return;
          }
          Promise.resolve(send(TYPE_STREAM_DATA, id, dataPayload(seq, bytes)))
            .then(() => cb())
            .catch((error) => {
              drop(id, error.message || error);
              cb(error);
            });
        };
        trySend();
      },
      final(cb) {
        Promise.resolve(send(TYPE_STREAM_CLOSE, id, closePayload("end")))
          .then(() => {
            drop(id, "end");
            cb();
          })
          .catch(() => cb());
      },
      read() {},
    });
    stream.on("error", () => drop(id, "local-error"));
    return stream;
  }

  return {
    snapshot() {
      let queuedBytes = 0;
      for (const item of local.values()) queuedBytes += item.stream.readableLength + item.stream.writableLength;
      for (const item of remote.values()) {
        queuedBytes += item.queued.reduce((sum, bytes) => sum + bytes.length, 0);
        queuedBytes += item.socket?.writableLength || 0;
      }
      return {txBytes, rxBytes, streams: local.size + remote.size, queuedBytes};
    },
    async openLocal(host, port) {
      if (!hostAllowed(host, options)) return { ok: false, error: "host not allowed" };
      const id = allocId(used);
      used.add(id);
      const window = createAckWindow(options.maxUnacked || 8);
      const stream = hopStream(id, window);
      local.set(id, { stream, window, host, port });
      log("egress open", id, host, port);
      await send(TYPE_STREAM_OPEN, id, openPayload(host, port));
      return { ok: true, stream };
    },
    async onFrame(type, id, payload) {
      if (type === TYPE_STREAM_OPEN) {
        let req;
        try {
          req = parseOpen(payload);
        } catch {
          return;
        }
        if (!hostAllowed(req.host, options)) {
          await send(TYPE_STREAM_CLOSE, id, closePayload("host not allowed"));
          return;
        }
        if (typeof connectTcp !== "function") {
          await send(TYPE_STREAM_CLOSE, id, closePayload("no dialer"));
          return;
        }
        used.add(id);
        const window = createAckWindow(options.maxUnacked || 8);
        const queued = [];
        remote.set(id, { socket: null, window, queued });
        log("egress open", id, req.host, req.port);
        let socket;
        try {
          socket = await connectTcp(req.host, req.port);
        } catch (error) {
          await send(TYPE_STREAM_CLOSE, id, closePayload(error.message || error));
          drop(id, error.message || error);
          return;
        }
        const pending = remote.get(id);
        if (!pending) {
          socket.destroy();
          return;
        }
        pending.socket = socket;
        for (const bytes of pending.queued.splice(0)) socket.write(bytes);
        let inFlight = 0;
        let ended = false;
        let closing = false;
        const finishPeer = () => {
          if (!ended || inFlight || closing || !remote.has(id)) return;
          closing = true;
          Promise.resolve(send(TYPE_STREAM_CLOSE, id, closePayload("peer-end")))
            .finally(() => drop(id, "peer-end"))
            .catch(() => {});
        };
        socket.on("data", (chunk) => {
          const bytes = Buffer.from(chunk);
          inFlight += 1;
          const trySend = () => {
            const seq = window.takeSend();
            if (seq == null) {
              socket.pause();
              socket.once("drain-window", trySend);
              return;
            }
            Promise.resolve(send(TYPE_STREAM_DATA, id, dataPayload(seq, bytes)))
              .catch((err) => drop(id, err.message || err))
              .finally(() => {
                inFlight -= 1;
                finishPeer();
              });
          };
          trySend();
        });
        socket.on("end", () => {
          ended = true;
          finishPeer();
        });
        socket.on("error", () => drop(id, "dial-error"));
        return;
      }
      if (type === TYPE_STREAM_DATA) {
        let parsed;
        try {
          parsed = parseData(payload);
        } catch {
          return;
        }
        const loc = local.get(id);
        const rem = remote.get(id);
        if (loc?.stream) loc.stream.push(parsed.bytes);
        else if (rem?.socket) rem.socket.write(parsed.bytes);
        else if (rem?.queued) rem.queued.push(parsed.bytes);
        else return;
        rxBytes += parsed.bytes.length;
        await send(TYPE_STREAM_ACK, id, ackPayload(parsed.seq));
        return;
      }
      if (type === TYPE_STREAM_ACK) {
        let parsed;
        try {
          parsed = parseAck(payload);
        } catch {
          return;
        }
        const loc = local.get(id);
        const rel = remote.get(id);
        const window = loc?.window || rel?.window;
        const stream = loc?.stream || rel?.socket;
        if (!window) return;
        window.ack(parsed.seq);
        stream?.emit("drain-window");
        stream?.resume?.();
        return;
      }
      if (type === TYPE_STREAM_CLOSE) {
        const reason = parseClose(payload).reason;
        const loc = local.get(id);
        if (loc && reason === "peer-end") {
          // Preserve buffered response bytes and let pipe() end the client socket.
          // destroy() here truncates downloads when the consumer is slower.
          local.delete(id);
          used.delete(id);
          loc.stream.push(null);
          log("egress close", id, reason);
          return;
        }
        drop(id, reason);
      }
    },
    closeAll(reason) {
      for (const id of [...local.keys(), ...remote.keys()]) drop(id, reason || "all");
    },
  };
}
