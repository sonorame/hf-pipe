import { randomUUID } from "node:crypto";
import net from "node:net";
import { RTCPeerConnection } from "werift";
import { pinHost, pinnedFetch } from "../dist/network-policy.js";
import {
  shouldRetryRtcOffer,
  shouldAcceptRemoteOffer,
  localSdpReadyToSignal,
  rtcRecycleAction,
  rtcRecycleMayStart,
} from "../dist/rtc-retry.js";
import { heartbeatShouldRecycle, heartbeatShouldLogPulse } from "../dist/hop-heartbeat.js";
import { pushHopLog } from "../dist/hop-log.js";
import { formatErrorChain } from "../dist/error-chain.js";
import { rpcPort } from "./config.mjs";
import { egressPort } from "./cursor-proxy-config.mjs";
import { createConnectProxy } from "./egress-proxy.mjs";
import { createEgressMux } from "./egress-mux.mjs";
import { createQosQueue } from "./egress-qos.mjs";
import { isHopStreamType } from "./egress-stream.mjs";

const MAGIC = Buffer.from("HFP1");
const TYPE_PING = 1;
const TYPE_PONG = 2;
const TYPE_REQ = 10;
const TYPE_RES = 11;
const CHUNK = 16 * 1024;
const qos = createQosQueue();
let egressMux = null;
let egressProxy = null;

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
let sessionEpoch = randomUUID();
let offerCreateInFlight = false;
let outstandingOffer = false;
let making = Promise.resolve();
let onRpc = null;
let rtcStuckSince = 0;
let lastRecreateAt = 0;
let lastProofAt = 0;
let dcOpenedAt = 0;
let lastPeerHost = "";
let lastPulseLogAt = 0;
let pulseInFlight = false;
let lastNoAnswerLogAt = 0;
let localDescOp = Promise.resolve();
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
  egressMux?.closeAll("pc closed");
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
  return sendSignal({ ...frame, gen: frame.gen ?? sessionGen, epoch: frame.epoch ?? sessionEpoch });
}

async function signalCreatedDescription(desc, sdpType) {
  const sld = pc.setLocalDescription(desc);
  localDescOp = sld.catch((e) => {
    log("rtc sld", formatErrorChain(e));
    throw e;
  });
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
  lastOfferAt = Date.now();
}

function attachDc(channel, role) {
  dc = channel;
  const onOpen = () => {
    if (dcOpen) return;
    dcOpen = true;
    outstandingOffer = false;
    dcOpenedAt = Date.now();
    lastProofAt = 0;
    log("rtc up", role, "state", dc.readyState);
    pushHopLog("up", {}, "ok");
  };
  dc.onopen = onOpen;
  if (dc.readyState === "open") onOpen();
  dc.onclose = () => {
    const was = dcOpen;
    dcOpen = false;
    log("rtc closed");
    egressMux?.closeAll("dc closed");
    if (was) pushHopLog("down", {}, "warn");
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
    lastProofAt = Date.now();
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
  if (isHopStreamType(m.type)) {
    const full = takeComplete(m);
    if (!full) return;
    egressMux?.onFrame(m.type, m.id, full).catch((e) => log("egress frame", e.message || e));
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
    await sendQos("rpc", TYPE_RES, rpcId, Buffer.from(JSON.stringify({ ok: false, error: "bad json" })));
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
  await sendQos("rpc", TYPE_RES, rpcId, Buffer.from(JSON.stringify(res)));
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

export function rtcSnapshot() {
  return {
    dc: dc?.readyState || "none",
    connection: pc?.connectionState || "none",
    ice: pc?.iceConnectionState || "none",
    signaling: pc?.signalingState || "none",
    gen: sessionGen,
    epoch: sessionEpoch || null,
    lastPongAt: lastProofAt || null,
    pongAgeMs: lastProofAt ? Date.now() - lastProofAt : null,
    peerHost: lastPeerHost || null,
  };
}

export async function recycleRtcNow() {
  if (side !== "dirty") return { ok: false, error: "only dirty recycles" };
  if (offerCreateInFlight) return { ok: false, error: "offer in flight" };
  lastRecreateAt = Date.now();
  lastProofAt = 0;
  dcOpenedAt = 0;
  sessionEpoch = randomUUID();
  rtcStuckSince = Date.now();
  log("rtc board recycle epoch", sessionEpoch);
  pushHopLog("recycle", { gen: sessionGen + 1 }, "warn");
  await startOfferer();
  return { ok: true, epoch: sessionEpoch, gen: sessionGen };
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
    sendQos("rpc", TYPE_REQ, rpcId, payload).catch((e) => {
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

async function sendQos(kind, type, id, payload) {
  const job = () => sendChunked(type, id, payload);
  if (kind === "rpc") qos.pushRpc(job);
  else qos.pushStream(job);
  await qos.flush();
}

function connectTcp(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const onErr = (err) => reject(err);
    socket.once("error", onErr);
    socket.once("connect", () => {
      socket.removeListener("error", onErr);
      resolve(socket);
    });
  });
}

async function startCursorEgress() {
  if (!egressMux) {
    egressMux = createEgressMux({
      send: (type, id, payload) => sendQos("stream", type, id, payload),
      connectTcp: side === "dirty" ? connectTcp : undefined,
      log,
    });
  }
  if (side !== "clean") return;
  const port = egressPort();
  if (port === rpcPort()) throw new Error("egress port must not be rpc port");
  if (egressProxy) return;
  egressProxy = createConnectProxy({
    bind: "127.0.0.1",
    port,
    async onConnect(req) {
      if (!isRtcUp()) return { ok: false, error: "rtc down" };
      return egressMux.openLocal(req.host, req.port);
    },
  });
  await egressProxy.listen();
  log("egress connect", "127.0.0.1", port);
}

function wirePc() {
  const boundPc = pc;
  const boundGen = sessionGen;
  const boundEpoch = sessionEpoch;
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
      epoch: boundEpoch,
    }).catch((e) => log("rtc sig ice", formatErrorChain(e)));
  };
  pc.onicegatheringstatechange = () => {
    if (pc !== boundPc) return;
    log("rtc gather", boundPc.iceGatheringState);
  };
  pc.onconnectionstatechange = () => {
    if (pc !== boundPc) return;
    log("rtc state", boundPc.connectionState);
    if (["failed", "closed", "disconnected"].includes(boundPc.connectionState)) {
      dcOpen = false;
      egressMux?.closeAll(`pc ${boundPc.connectionState}`);
      if (boundPc.connectionState === "failed") pushHopLog("failed", {}, "warn");
    }
  };
  pc.oniceconnectionstatechange = () => {
    if (pc !== boundPc) return;
    log("rtc ice", boundPc.iceConnectionState);
    if (["failed", "closed", "disconnected"].includes(boundPc.iceConnectionState)) {
      dcOpen = false;
      if (boundPc.iceConnectionState === "failed") pushHopLog("failed", {}, "warn");
    }
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
    await localDescOp;
    log("rtc offerer", "gen", sessionGen, "epoch", sessionEpoch, "sdp", Buffer.byteLength(offer.sdp || pc.localDescription.sdp));
    pushHopLog("offer", { gen: sessionGen });
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
  await startCursorEgress();
  if (side === "dirty") {
    await startOfferer();
    setInterval(() => {
      const now = Date.now();
      if (
        heartbeatShouldRecycle({
          rtcLooksUp: isRtcUp(),
          lastPongAt: lastProofAt,
          openedAt: dcOpenedAt,
          now,
        })
      ) {
        lastRecreateAt = now;
        lastProofAt = 0;
        dcOpenedAt = 0;
        sessionEpoch = randomUUID();
        rtcStuckSince = now;
        log("rtc heartbeat miss - recreate peer epoch", sessionEpoch);
        pushHopLog("pong-miss", {}, "warn");
        startOfferer().catch((e) => log("rtc recreate", formatErrorChain(e)));
        return;
      }
      if (isRtcUp()) {
        rtcStuckSince = 0;
        sendKeepalive();
        if (
          heartbeatShouldLogPulse({
            rtcLooksUp: true,
            lastLogAt: lastPulseLogAt,
            now,
          }) &&
          !pulseInFlight
        ) {
          lastPulseLogAt = now;
          pulseInFlight = true;
          const t0 = now;
          rtcCall({ id: `pulse${now.toString(16)}`, type: "ping", body: {} }, 8000)
            .then((r) => {
              const host = r?.body?.host ? String(r.body.host) : "";
              if (host) lastPeerHost = host;
              pushHopLog("pulse", { host: lastPeerHost, ms: Date.now() - t0 }, "ok");
            })
            .catch(() => {
              pushHopLog("pulse-fail", {}, "warn");
            })
            .finally(() => {
              pulseInFlight = false;
            });
        }
        return;
      }
      if (!rtcStuckSince) rtcStuckSince = now;
      if (
        outstandingOffer &&
        pc?.signalingState === "have-local-offer" &&
        (!lastNoAnswerLogAt || now - lastNoAnswerLogAt >= 15_000)
      ) {
        lastNoAnswerLogAt = now;
        const sec = Math.max(0, Math.round((now - lastOfferAt) / 1000));
        pushHopLog("no-answer", { sec }, "warn");
      }
      const action = rtcRecycleAction({
        dcOpen,
        stuckSinceMs: rtcStuckSince,
        now,
        lastRecreateAt,
        connectionState: pc?.connectionState,
        iceConnectionState: pc?.iceConnectionState,
        signalingState: pc?.signalingState,
        outstandingOffer,
        lastOfferAt,
      });
      if (action === "exit") {
        if (!rtcRecycleMayStart({ offerCreateInFlight })) return;
        log("rtc stuck", now - rtcStuckSince, "ms - exit(7) for watchdog");
        pushHopLog("restart", {}, "warn");
        process.exit(7);
      }
      if (action === "recreate") {
        if (!rtcRecycleMayStart({ offerCreateInFlight })) return;
        lastRecreateAt = now;
        lastProofAt = 0;
        dcOpenedAt = 0;
        sessionEpoch = randomUUID();
        log("rtc stuck", now - rtcStuckSince, "ms - recreate peer epoch", sessionEpoch);
        pushHopLog("recycle", { gen: sessionGen + 1 }, "warn");
        startOfferer().catch((e) => log("rtc recreate", formatErrorChain(e)));
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
          now,
        })
      ) {
        return;
      }
      log("rtc retry offer");
      startOfferer().catch((e) => log("rtc retry", formatErrorChain(e)));
    }, 4000);
  } else {
    log("rtc wait offer");
    pushHopLog("wait");
  }
}

async function applyOffer(frame) {
  if (
    !shouldAcceptRemoteOffer({
      dcOpen,
      localGen: sessionGen,
      remoteGen: frame.gen,
      localEpoch: sessionEpoch,
      remoteEpoch: frame.epoch,
      connectionState: pc?.connectionState,
      iceConnectionState: pc?.iceConnectionState,
    })
  ) {
    log("rtc drop gen", "offer", frame.gen, "have", sessionGen);
    return;
  }
  if (frame.epoch) sessionEpoch = frame.epoch;
  if (frame.gen != null) sessionGen = frame.gen;
  pendingIce = pendingIce.filter((c) => {
    if (c.epoch && sessionEpoch && c.epoch !== sessionEpoch) return false;
    if (c.gen != null && c.gen !== sessionGen) return false;
    return true;
  });
  await makePc();
  await pc.setRemoteDescription({ type: "offer", sdp: frame.sdp });
  remoteDescSet = true;
  await flushIce();
  const answer = await pc.createAnswer();
  await signalCreatedDescription(answer, "answer");
  await localDescOp;
  log("rtc got offer", "gen", sessionGen, "epoch", sessionEpoch);
}

async function applyAnswer(frame) {
  if (frame.epoch && sessionEpoch && frame.epoch !== sessionEpoch) {
    log("rtc drop gen", "answer", frame.gen, "have", sessionGen);
    pushHopLog("drop-gen", { remote: frame.gen, have: sessionGen }, "warn");
    return;
  }
  if (frame.gen != null && frame.gen !== sessionGen) {
    log("rtc drop gen", "answer", frame.gen, "have", sessionGen);
    pushHopLog("drop-gen", { remote: frame.gen, have: sessionGen }, "warn");
    return;
  }
  if (!pc) return;
  if (pc.signalingState !== "have-local-offer") {
    log("rtc skip answer", pc.signalingState);
    return;
  }
  await localDescOp;
  await pc.setRemoteDescription({ type: "answer", sdp: frame.sdp });
  remoteDescSet = true;
  await flushIce();
  lastOfferAt = Date.now();
  outstandingOffer = false;
  log("rtc got answer", "gen", sessionGen, String(frame.sdp || "").match(/a=setup:\S+/)?.[0] || "");
  pushHopLog("answer", { gen: sessionGen }, "ok");
}

async function applyIce(frame) {
  const gen = frame.gen;
  const epoch = frame.epoch;
  const epochMismatch = Boolean(epoch && sessionEpoch && epoch !== sessionEpoch);
  if (!epochMismatch && gen != null && sessionGen && gen !== sessionGen) {
    log("rtc drop gen", "ice", gen, "have", sessionGen);
    return;
  }
  const cand = {
    candidate: frame.candidate,
    mid: frame.mid || "0",
    sdpMLineIndex: frame.sdpMLineIndex ?? 0,
    gen,
    epoch,
  };
  if (epochMismatch || !pc || !remoteDescSet) {
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
