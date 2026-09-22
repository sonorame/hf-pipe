export const TYPE_STREAM_OPEN = 20;
export const TYPE_STREAM_DATA = 21;
export const TYPE_STREAM_ACK = 22;
export const TYPE_STREAM_CLOSE = 23;

export function isHopStreamType(type) {
  return (
    type === TYPE_STREAM_OPEN ||
    type === TYPE_STREAM_DATA ||
    type === TYPE_STREAM_ACK ||
    type === TYPE_STREAM_CLOSE
  );
}

export function openPayload(host, port) {
  return Buffer.from(JSON.stringify({ host: String(host), port: Number(port) }));
}

export function parseOpen(buf) {
  const j = JSON.parse(Buffer.from(buf).toString("utf8"));
  const host = String(j.host || "");
  const port = Number(j.port);
  if (!host || !Number.isFinite(port) || port < 1 || port > 65535) throw new Error("bad open");
  return { host, port };
}

export function dataPayload(seq, bytes) {
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const buf = Buffer.alloc(4 + payload.length);
  buf.writeUInt32LE(Number(seq) >>> 0, 0);
  payload.copy(buf, 4);
  return buf;
}

export function parseData(buf) {
  const raw = Buffer.from(buf);
  if (raw.length < 4) throw new Error("short data");
  return { seq: raw.readUInt32LE(0), bytes: raw.subarray(4) };
}

export function ackPayload(seq) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(Number(seq) >>> 0, 0);
  return buf;
}

export function parseAck(buf) {
  const raw = Buffer.from(buf);
  if (raw.length < 4) throw new Error("short ack");
  return { seq: raw.readUInt32LE(0) };
}

export function closePayload(reason) {
  return Buffer.from(JSON.stringify({ reason: String(reason || "") }));
}

export function parseClose(buf) {
  try {
    const j = JSON.parse(Buffer.from(buf).toString("utf8"));
    return { reason: String(j.reason || "") };
  } catch {
    return { reason: "" };
  }
}

export function createAckWindow(maxUnacked = 8) {
  let nextSeq = 0;
  const unacked = new Set();
  return {
    takeSend() {
      if (unacked.size >= maxUnacked) return null;
      const seq = nextSeq++;
      unacked.add(seq);
      return seq;
    },
    ack(seq) {
      unacked.delete(Number(seq) >>> 0);
    },
    get blocked() {
      return unacked.size >= maxUnacked;
    },
    get pending() {
      return unacked.size;
    },
  };
}
