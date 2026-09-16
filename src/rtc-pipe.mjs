import { RTCPeerConnection } from "werift";
import { pinHost, pinnedFetch } from "../dist/network-policy.js";
import {
  shouldRetryRtcOffer,
  shouldAcceptRemoteOffer,
  localSdpReadyToSignal,
} from "../dist/rtc-retry.js";
import { formatErrorChain } from "../dist/error-chain.js";

const MAGIC = Buffer.from("HFP1");
const TYPE_PING = 1;
const TYPE_PONG = 2;
const TYPE_REQ = 10;
const TYPE_RES = 11;
const CHUNK = 16 * 1024;

let log = (...a) => console.error(new Date().toISOString(), ...a);
let sendSignal = async () => {};
let side = "dirty";
let pc = null;
let dc = null;
let remoteDescSet = false;
let pendingIce = [];
let dcOpen = false;
let lastOfferAt = 0;
let sessionGen = 0;
let offerCreateInFlight = false;
let outstandingOffer = false;
let making = Promise.resolve();
let onRpc = null;
const waiters = new Map();
const parts = new Map();

function uid() {
  return Math.random().toString(16).slice(2, 10);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTurnConfig() {
  const hs = String(process.env.MATRIX_HOMESERVER_URL || "").replace(/\/$/, "");
  const token = process.env.MATRIX_ACCESS_TOKEN || "";
  const res = await pinnedFetch(`${hs}/_matrix/client/v3/voip/turnServer`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`turnServer ${res.status} ${text.slice(0, 120)}`);
  const j = JSON.parse(text);
  const urls = [];
  for (const u of j.uris || []) {
    const raw = String(u);
    const m = raw.match(/^(turns?):([^:?]+)(?::(\d+))?/i);
    if (!m) continue;
    const scheme = m[1].toLowerCase();
    const tcp = /transport=tcp/i.test(raw) || scheme === "turns";
    if (!tcp) continue;
    const host = m[2];
    const port = Number(m[3] || (scheme === "turns" ? 5349 : 3478));
    pinHost(host);
    if (scheme === "turns") urls.push(`turns:${host}:${port}?transport=tcp`);
    else urls.push(`turn:${host}:${port}?transport=tcp`);
  }
  urls.sort((a, b) => Number(a.startsWith("turns")) - Number(b.startsWith("turns")));
  if (!urls.length) throw new Error("turnServer has no tcp/tls uris");
  log("rtc turn", urls.length, urls.join(","));
  return {
    iceServers: [
      {
        urls,
        username: j.username,
        credential: j.password,
      },
    ],
    iceTransportPolicy: "relay",
    iceUseTcp: true,
    turnTransport: urls[0].startsWith("turns") ? "tls" : "tcp",
    maxMessageSize: 262144,
  };
}

async function closePc() {
  try {
    dc?.close();
  } catch {
    // ignore
  }
  try {
    await pc?.close();
  } catch {
    // ignore
  }
  pc = null;
  dc = null;
  remoteDescSet = false;
  dcOpen = false;
}

async function flushIce() {
  if (!pc || !remoteDescSet) return;
  const queued = pendingIce.splice(0, pendingIce.length);
  for (const c of queued) {
    try {
      await pc.addIceCandidate({
        candidate: c.candidate,
        sdpMid: c.mid,
        sdpMLineIndex: c.sdpMLineIndex ?? 0,
      });
    } catch (e) {
      log("rtc ice add", e.message || e);
    }
  }
}

function toBuf(msg) {
  if (!msg) return null;
  if (Buffer.isBuffer(msg)) return msg;
  if (msg instanceof ArrayBuffer) return Buffer.from(msg);
  if (ArrayBuffer.isView(msg)) return Buffer.from(msg.buffer, msg.byteOffset, msg.byteLength);
  return null;
}

function descType(t) {
  const s = String(t || "").toLowerCase();
  if (s === "offer") return "offer";
  if (s === "answer") return "answer";
  return s;
}

function emit(frame) {
  return sendSignal({ ...frame, gen: frame.gen ?? sessionGen });
}

async function signalCreatedDescription(desc, sdpType) {
  const sld = pc.setLocalDescription(desc);
  sld.catch((e) => log("rtc sld", formatErrorChain(e)));
  const sdp = desc?.sdp || pc.localDescription?.sdp;
  if (!localSdpReadyToSignal({ alreadySignaled: false, sdp })) {
    throw new Error("local sdp empty");
  }
  await emit({
    id: uid(),
    type: "sdp",
    sdpType,
    sdp,
  });
}

function attachDc(channel, role) {
  dc = channel;
  const onOpen = () => {
    if (dcOpen) return;
    dcOpen = true;
    outstandingOffer = false;
    log("rtc up", role, "state", dc.readyState);
  };
  dc.onopen = onOpen;
  if (dc.readyState === "open") onOpen();
  dc.onclose = () => {
    dcOpen = false;
    log("rtc closed");
  };
  dc.onerror = (err) => log("rtc dc err", err?.error || err);
  dc.onmessage = (ev) => {
    const buf = toBuf(ev?.data ?? ev);
    if (buf) onBinary(buf);
  };
}

function packChunk(type, id, total, offset, payload) {
  const buf = Buffer.alloc(20 + payload.length);
  MAGIC.copy(buf, 0);
  buf.writeUInt8(type, 4);
  buf.writeUInt32LE(id, 8);
  buf.writeUInt32LE(total, 12);
  buf.writeUInt32LE(offset, 16);
  payload.copy(buf, 20);
  return buf;
}

function unpack(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 20) return null;
  if (buf.subarray(0, 4).toString() !== "HFP1") return null;
  return {
    type: buf.readUInt8(4),
    id: buf.readUInt32LE(8),
    total: buf.readUInt32LE(12),
    offset: buf.readUInt32LE(16),
    payload: buf.subarray(20),
  };
}

const pongGot = new Map();

function takeComplete(m) {
  let st = parts.get(m.id);
  if (!st) {
    st = { type: m.type, total: m.total, chunks: new Map(), bytes: 0 };
    parts.set(m.id, st);
  }
  if (!st.chunks.has(m.offset)) {
    st.chunks.set(m.offset, m.payload);
    st.bytes += m.payload.length;
  }
  if (st.bytes < st.total) return null;
  const buf = Buffer.alloc(st.total);
  for (const [off, p] of st.chunks) p.copy(buf, off);
  parts.delete(m.id);
  return buf;
}

function onBinary(buf) {
  const m = unpack(buf);
  if (!m) return;
  if (m.type === TYPE_PING && dc?.readyState === "open") {
    try {
      dc.send(packChunk(TYPE_PONG, m.id, m.total, m.offset, m.payload));
    } catch (e) {
      log("rtc pong send", e.message || e);
    }
    return;
  }
  if (m.type === TYPE_PONG && side === "dirty") {
    const st = pongGot.get(m.id);
    if (!st) return;
    st.got.add(m.offset);
    st.bytes += m.payload.length;
    if (st.got.size >= st.need && !st.done) {
      st.done = true;
      const ms = Date.now() - st.t0;
      log("rtc proof", st.bytes, "bytes", ms, "ms");
    }
    return;
  }
  if (m.type === TYPE_REQ || m.type === TYPE_RES) {
    const full = takeComplete(m);
    if (!full) return;
    if (m.type === TYPE_REQ) {
      handleReq(m.id, full).catch((e) => log("rtc req", e.message || e));
      return;
    }
    const w = waiters.get(m.id);
    if (!w) return;
    clearTimeout(w.timer);
    waiters.delete(m.id);
    try {
      w.resolve(JSON.parse(full.toString("utf8")));
    } catch (e) {
      w.reject(e);
    }
  }
}

async function handleReq(rpcId, buf) {
  let task;
  try {
    task = JSON.parse(buf.toString("utf8"));
  } catch {
    await sendChunked(TYPE_RES, rpcId, Buffer.from(JSON.stringify({ ok: false, error: "bad json" })));
    return;
  }
  let one;
  try {
    one = onRpc ? await onRpc(task) : { ok: false, error: "no rpc handler" };
  } catch (e) {
    one = { ok: false, error: String(e.message || e) };
  }
  const res = {
    id: task.id,
    type: "result",
    ok: Boolean(one.ok),
    body: { id: task.id, ...one },
    req: task.type,
  };
  await sendChunked(TYPE_RES, rpcId, Buffer.from(JSON.stringify(res)));
}

export function isRtcUp() {
  return Boolean(
    dcOpen &&
      dc &&
      dc.readyState === "open" &&
      pc &&
      pc.connectionState === "connected"
  );
}

export async function rtcCall(task, timeoutMs = 30000) {
  if (!isRtcUp()) throw new Error("rtc down");
  const rpcId = (Math.floor(Math.random() * 0x7fffffff) ^ Date.now()) >>> 0;
  const payload = Buffer.from(JSON.stringify(task), "utf8");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(rpcId);
      reject(new Error("rtc timeout"));
    }, timeoutMs);
    waiters.set(rpcId, { resolve, reject, timer });
    sendChunked(TYPE_REQ, rpcId, payload).catch((e) => {
      clearTimeout(timer);
      waiters.delete(rpcId);
      reject(e);
    });
  });
}

async function sendChunked(type, id, payload) {
  const total = payload.length;
  for (let offset = 0; offset < total; offset += CHUNK) {
    const slice = payload.subarray(offset, Math.min(offset + CHUNK, total));
    const pkt = packChunk(type, id, total, offset, slice);
    while (dc && dc.bufferedAmount > 512 * 1024) {
      await sleep(20);
    }
    if (dc?.readyState !== "open") throw new Error("dc closed during send");
    dc.send(pkt);
  }
}

function wirePc() {
  const boundPc = pc;
  const boundGen = sessionGen;
  pc.onicecandidate = (ev) => {
    if (pc !== boundPc) return;
    const cand = ev?.candidate;
    if (!cand) return;
    const line = cand.candidate || "";
    if (!line) return;
    const typ = (line.match(/ typ (\S+)/) || [])[1] || "?";
    log("rtc local ice", typ);
    emit({
      id: uid(),
      type: "ice",
      candidate: line,
      mid: cand.sdpMid || "0",
      sdpMLineIndex: cand.sdpMLineIndex ?? 0,
      gen: boundGen,
    }).catch((e) => log("rtc sig ice", formatErrorChain(e)));
  };
  pc.onicegatheringstatechange = () => {
    if (pc !== boundPc) return;
    log("rtc gather", boundPc.iceGatheringState);
  };
  pc.onconnectionstatechange = () => {
    if (pc !== boundPc) return;
    log("rtc state", boundPc.connectionState);
    if (["failed", "closed", "disconnected"].includes(boundPc.connectionState)) dcOpen = false;
  };
  pc.oniceconnectionstatechange = () => {
    if (pc !== boundPc) return;
    log("rtc ice", boundPc.iceConnectionState);
    if (["failed", "closed", "disconnected"].includes(boundPc.iceConnectionState)) dcOpen = false;
  };
  pc.ondatachannel = (ev) => {
    if (pc !== boundPc) return;
    log("rtc incoming dc", ev?.channel?.label);
    if (ev?.channel) attachDc(ev.channel, "answerer");
  };
}

async function makePc() {
  await closePc();
  const cfg = await fetchTurnConfig();
  pc = new RTCPeerConnection(cfg);
  wirePc();
  return pc;
}

async function startOfferer() {
  if (offerCreateInFlight) return;
  offerCreateInFlight = true;
  outstandingOffer = true;
  lastOfferAt = Date.now();
  sessionGen += 1;
  pendingIce = pendingIce.filter((c) => c.gen === sessionGen);
  try {
    await makePc();
    attachDc(pc.createDataChannel("hf"), "offerer");
    const offer = await pc.createOffer();
    await signalCreatedDescription(offer, "offer");
    log("rtc offerer", "gen", sessionGen, "sdp", Buffer.byteLength(offer.sdp || pc.localDescription.sdp));
  } finally {
    offerCreateInFlight = false;
  }
}

function sendKeepalive() {
  if (!dc || dc.readyState !== "open") return;
  try {
    const id = (Date.now() & 0x7fffffff) >>> 0;
    dc.send(packChunk(TYPE_PING, id, 1, 0, Buffer.from("k")));
  } catch {
    // ignore
  }
}

export async function startRtc(opts) {
  log = opts.log || log;
  sendSignal = opts.sendSignal;
  side = opts.side;
  onRpc = opts.onRpc || null;
  if (side === "dirty") {
    await startOfferer();
    setInterval(() => {
      if (dcOpen && dc?.readyState === "open") {
        sendKeepalive();
        return;
      }
      if (
        !shouldRetryRtcOffer({
          dcOpen,
          dcReadyState: dc?.readyState,
          connectionState: pc?.connectionState,
          iceConnectionState: pc?.iceConnectionState,
          signalingState: pc?.signalingState,
          outstandingOffer,
          offerCreateInFlight,
          lastOfferAt,
          now: Date.now(),
        })
      ) {
        return;
      }
      log("rtc retry offer");
      startOfferer().catch((e) => log("rtc retry", formatErrorChain(e)));
    }, 4000);
  } else {
    log("rtc wait offer");
  }
}

async function applyOffer(frame) {
  if (
    !shouldAcceptRemoteOffer({
      dcOpen,
      localGen: sessionGen,
      remoteGen: frame.gen,
    })
  ) {
    log("rtc drop gen", "offer", frame.gen, "have", sessionGen);
    return;
  }
  if (frame.gen != null) sessionGen = frame.gen;
  pendingIce = pendingIce.filter((c) => c.gen === sessionGen);
  await makePc();
  await pc.setRemoteDescription({ type: "offer", sdp: frame.sdp });
  remoteDescSet = true;
  await flushIce();
  const answer = await pc.createAnswer();
  await signalCreatedDescription(answer, "answer");
  log("rtc got offer", "gen", sessionGen);
}

async function applyAnswer(frame) {
  if (frame.gen != null && frame.gen !== sessionGen) {
    log("rtc drop gen", "answer", frame.gen, "have", sessionGen);
    return;
  }
  if (!pc) return;
  await pc.setRemoteDescription({ type: "answer", sdp: frame.sdp });
  remoteDescSet = true;
  await flushIce();
  log("rtc got answer", "gen", sessionGen);
}

async function applyIce(frame) {
  const gen = frame.gen;
  if (gen != null && sessionGen && gen !== sessionGen) {
    log("rtc drop gen", "ice", gen, "have", sessionGen);
    return;
  }
  const cand = {
    candidate: frame.candidate,
    mid: frame.mid || "0",
    sdpMLineIndex: frame.sdpMLineIndex ?? 0,
    gen,
  };
  if (!pc || !remoteDescSet) {
    pendingIce.push(cand);
    return;
  }
  await pc.addIceCandidate({
    candidate: cand.candidate,
    sdpMid: cand.mid,
    sdpMLineIndex: cand.sdpMLineIndex,
  });
}

export function handleRtcSignal(frame) {
  making = making
    .then(async () => {
      const t = String(frame.type || "");
      if (t === "sdp") {
        const kind = descType(frame.sdpType);
        if (side === "clean" && kind === "offer") {
          await applyOffer(frame);
          return;
        }
        if (side === "dirty" && kind === "answer") {
          await applyAnswer(frame);
        }
        return;
      }
      if (t === "ice") await applyIce(frame);
    })
    .catch((e) => log("rtc sig", formatErrorChain(e)));
}
