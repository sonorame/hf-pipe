import { mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, existsSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import http from "http";
import { spawn } from "child_process";
import {
  loadEnvFile,
  sessionFile,
  dataDir,
  localDir,
  cleanRoots,
  rpcBind,
  rpcPort,
  eventType,
  findMatrixClientModule,
  sessionUserId,
  peerNameNeedles,
} from "./config.mjs";
import { applyNodeNetworkPolicy, pinnedFetch } from "../dist/network-policy.js";
import { shouldRecycleAfterClockJump, shouldExitOnSyncDead } from "../dist/watchdog-clock.js";
import { claimHopInstance, hopListenBusyExitCode } from "../dist/hop-instance.js";
import { formatErrorChain } from "../dist/error-chain.js";
import { isFreshPeer, pickPeerFromDevices, resolvePeerId } from "../dist/peer-device.js";
import { runCleanJob } from "./clean-jobs.mjs";
import { httpPageKind } from "./hop-surface.mjs";
import { readHotfolderTempConfig, sweepAllTemp } from "./hotfolder-temp.mjs";
import {
  hopRestartDelayMs,
  parseDoctorStdout,
  parseHopControl,
  renderHopBoardHtml,
  shapeHopStatus,
} from "../dist/hop-board.js";

loadEnvFile();
applyNodeNetworkPolicy();

const HERE = dirname(fileURLToPath(import.meta.url));
const EVENT_TYPE = eventType();
const SEQ_WIDTH = 8;
const MAX_EVENT = 55_000;
const POLL_MS = 700;

const sessionPath = sessionFile();
let userId = "";

function sideNow() {
  return (process.env.HF_SIDE || "dirty").toLowerCase();
}

function getDataDir() {
  return dataDir(sideNow());
}

function getSeenPath() {
  return join(getDataDir(), "hf-seen.json");
}

const CLEAN_ROOTS = cleanRoots();
const DIRTY_LOCAL = localDir();

const origErr = console.error.bind(console);
console.error = (...args) => {
  const s = args.map((a) => (typeof a === "string" ? a : a?.message || String(a))).join(" ");
  if (/One time key|signed_curve25519:.*already exists/i.test(s)) return;
  origErr(...args);
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

let pidHeld = false;

function claimThisHop() {
  const pidPath = join(HERE, "hf.pid");
  const result = claimHopInstance({
    pidPath,
    pid: process.pid,
    isAlive: pidAlive,
    readFile: (p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    writeFile: (p, body) => writeFileSync(p, body),
  });
  if (result.status === "busy") {
    log("hop already running pid", result.holderPid);
    process.exit(2);
  }
  pidHeld = true;
}

function clearPid() {
  if (!pidHeld) return;
  try {
    unlinkSync(join(HERE, "hf.pid"));
  } catch {
    // ignore
  }
  pidHeld = false;
}

process.on("exit", clearPid);
process.on("SIGINT", () => {
  clearPid();
  process.exit(0);
});
process.on("SIGTERM", () => {
  clearPid();
  process.exit(0);
});

function log(...args) {
  console.error(new Date().toISOString(), ...args);
}

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, path);
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function detectCleanRoot() {
  for (const raw of CLEAN_ROOTS) {
    try {
      ensureDir(raw);
      for (const sub of ["pipe/d2c", "pipe/c2d", "pipe/d2c.done", "pipe/c2d.done", "pipe/seen/d2c", "pipe/seen/c2d"]) {
        ensureDir(join(raw, sub));
      }
      const probe = join(raw, ".hf-ok");
      writeFileSync(probe, "ok");
      return raw;
    } catch {
      continue;
    }
  }
  return null;
}

function seqFromName(name) {
  const head = name.split("_", 1)[0];
  const n = parseInt(head, 10);
  return Number.isFinite(n) ? n : 0;
}

function nextSeq(folder) {
  let n = 0;
  try {
    for (const name of readdirSync(folder)) {
      if (!name.endsWith(".json") || name.endsWith(".tmp")) continue;
      n = Math.max(n, seqFromName(name));
    }
  } catch {
    return 1;
  }
  return n + 1;
}

function listFrames(folder) {
  let names = [];
  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json") && !name.endsWith(".tmp"))
    .sort((a, b) => seqFromName(a) - seqFromName(b) || a.localeCompare(b))
    .map((name) => join(folder, name));
}

function loadSeen() {
  const s = loadJson(getSeenPath(), { events: [], frames: [] });
  return {
    events: new Set(s.events || []),
    frames: new Set(s.frames || []),
  };
}

function saveSeen(seen) {
  saveJson(getSeenPath(), {
    events: [...seen.events].slice(-4000),
    frames: [...seen.frames].slice(-4000),
  });
}

function parseEnvelope(input) {
  if (!input) return null;
  if (typeof input === "object" && input.hf === 1 && input.lane && input.frame) return input;
  if (typeof input !== "string") return null;
  const raw = input.startsWith("HF|") ? input.slice(3) : input;
  try {
    const obj = JSON.parse(raw);
    if (obj && obj.hf === 1 && obj.lane && obj.frame) return obj;
  } catch {
    return null;
  }
  return null;
}

function hsBase() {
  return String(process.env.MATRIX_HOMESERVER_URL || "").replace(/\/$/, "");
}

function accessToken() {
  return process.env.MATRIX_ACCESS_TOKEN || "";
}

let peerCache = { id: "", at: 0 };
let incomingPeer = "";

async function resolvePeerDevice(myDevice) {
  const envPeer = process.env.HF_PEER_DEVICE || "";
  const now = Date.now();
  if (!envPeer && isFreshPeer(peerCache.id ? peerCache : null, now)) {
    return peerCache.id;
  }
  let listed = null;
  let listFailed = false;
  try {
    const res = await pinnedFetch(`${hsBase()}/_matrix/client/v3/devices`, {
      headers: { Authorization: `Bearer ${accessToken()}` },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`devices ${res.status} ${text.slice(0, 180)}`);
    listed = pickPeerFromDevices(JSON.parse(text).devices || [], myDevice, peerNameNeedles(sideNow()));
  } catch (e) {
    listFailed = true;
    log("peer", formatErrorChain(e));
  }
  const got = resolvePeerId({
    envPeer: envPeer || undefined,
    listed,
    incoming: incomingPeer || undefined,
    remembered: peerCache.id ? peerCache : null,
    listFailed,
    now,
  });
  peerCache = { id: got.id, at: now };
  return got.id;
}

async function bootClient(session) {
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  process.env.MATRIX_DATA_DIR = dataDir;
  process.env.MATRIX_USER_ID = session.user_id;
  process.env.MATRIX_ACCESS_TOKEN = session.access_token;
  process.env.MATRIX_HOMESERVER_URL = session.homeserver;
  if (session.device_id) process.env.MATRIX_DEVICE_ID = session.device_id;
  delete process.env.MATRIX_RECOVERY_KEY_FILE;
  delete process.env.MATRIX_RECOVERY_KEY;

  const clientJs = findMatrixClientModule();
  if (!clientJs) throw new Error("missing dist/matrix/client.js (run npm run build)");
  const { createMatrixClient } = await import(pathToFileURL(clientJs).href);
  try {
    const { logger } = await import("matrix-js-sdk/lib/logger.js");
    logger.setLevel("error");
  } catch {
    // keep going if logger import shape changes
  }
  return createMatrixClient({
    homeserverUrl: session.homeserver,
    userId: session.user_id,
    accessToken: session.access_token,
    deviceId: session.device_id,
    enableOAuth: false,
    enableTokenExchange: false,
  });
}

async function sendFrame(client, lane, frame) {
  const myDevice = client.getDeviceId?.() || process.env.MATRIX_DEVICE_ID;
  const env = { hf: 1, lane, frame, from: myDevice };
  const raw = JSON.stringify(env);
  if (raw.length > MAX_EVENT) {
    throw new Error(`frame ${frame.id} too large (${raw.length} > ${MAX_EVENT})`);
  }
  const peer = await resolvePeerDevice(myDevice);
  const txn = `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`;
  const url = `${hsBase()}/_matrix/client/v3/sendToDevice/${encodeURIComponent(EVENT_TYPE)}/${txn}`;
  const res = await pinnedFetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: {
        [userId]: {
          [peer]: env,
        },
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`sendToDevice ${res.status} ${text.slice(0, 200)}`);
  log("sent", lane, frame.id, frame.type || frame.req || "", "to", peer);
  return { peer };
}

function consumeFile(path) {
  try {
    unlinkSync(path);
  } catch {
    // already gone
  }
}

function persistDirtyResult(frame, { queue = false } = {}) {
  const id = frame.id || "unknown";
  const body = frame.body && typeof frame.body === "object" ? frame.body : {};
  let blob = null;
  if (body.blob_b64) {
    blob = body.blob_b64;
    delete body.blob_b64;
    frame.body = body;
  }
  if (queue) {
    ensureDir(join(DIRTY_LOCAL, "outbox"));
    saveJson(join(DIRTY_LOCAL, "outbox", `${id}.json`), frame);
  }
  try {
    saveJson(join(DIRTY_LOCAL, "from_clean.txt"), frame);
  } catch {
    writeFileSync(join(DIRTY_LOCAL, "from_clean.txt"), JSON.stringify(frame, null, 2));
  }
  log("got", id, "ok", frame.body?.ok ?? frame.ok);
  return blob;
}

function writeDirtyResult(frame) {
  persistDirtyResult(frame, { queue: true });
}

let rtcHandler = null;
let rtcMod = null;
let doctorRunning = false;

function rpcTimeoutMs(frame) {
  const t = String(frame.type || "").toLowerCase();
  const body = frame.body && typeof frame.body === "object" ? frame.body : {};
  if (t === "screenshot") return 15000;
  if (t === "read" || t === "pull" || t === "write") return 20000;
  return ((Number(body.timeout) || 12) + 3) * 1000;
}

function jsonRes(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function runDoctorFromBoard() {
  if (doctorRunning) return Promise.resolve({ ok: false, error: "doctor already running", verdict: "RED" });
  doctorRunning = true;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(HERE, "hop-doctor.mjs")], {
      cwd: HERE,
      env: { ...process.env, HF_SIDE: "dirty" },
      windowsHide: true,
    });
    let out = "";
    child.stdout?.on("data", (c) => {
      out += String(c);
    });
    child.stderr?.on("data", (c) => {
      out += String(c);
    });
    child.on("exit", (code) => {
      doctorRunning = false;
      resolve({ ok: code === 0, raw: out, ...parseDoctorStdout(out) });
    });
    child.on("error", (e) => {
      doctorRunning = false;
      resolve({
        ok: false,
        error: String(e.message || e),
        verdict: "RED",
        failing: ["doctor"],
        culprit: "doctor",
        next: "",
        raw: out,
      });
    });
  });
}

async function runBoardControl(action) {
  if (action === "restart") {
    setTimeout(() => process.exit(7), hopRestartDelayMs());
    return { ok: true, action: "restart" };
  }
  if (action === "doctor") {
    return runDoctorFromBoard();
  }
  if (action === "recycle") {
    if (!rtcMod?.recycleRtcNow) return { ok: false, error: "rtc module down" };
    return rtcMod.recycleRtcNow();
  }
  if (action === "ping") {
    if (!rtcMod?.isRtcUp?.()) return { ok: false, error: "rtc down" };
    const result = await rtcMod.rtcCall({ id: `board${Date.now().toString(16)}`, type: "ping", body: {} }, 20000);
    persistDirtyResult(result, { queue: false });
    return result;
  }
  return { ok: false, error: "unknown" };
}

function startDirtyHttp() {
  const port = rpcPort();
  const bind = rpcBind();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const kind = httpPageKind(req.method, url.pathname);
    if (kind === "board") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderHopBoardHtml());
      return;
    }
    if (kind === "status") {
      const snap = rtcMod?.rtcSnapshot?.() || {};
      jsonRes(
        res,
        200,
        shapeHopStatus({
          rtc: Boolean(rtcMod?.isRtcUp?.()),
          pid: process.pid,
          side: sideNow(),
          ...snap,
        }),
      );
      return;
    }
    if (kind === "control") {
      readJsonBody(req)
        .then(async (body) => {
          const action = parseHopControl(body);
          if (!action) {
            jsonRes(res, 400, { ok: false, error: "bad action" });
            return;
          }
          const result = await runBoardControl(action);
          jsonRes(res, result.ok === false && action !== "doctor" ? 503 : 200, result);
        })
        .catch((e) => jsonRes(res, 400, { ok: false, error: String(e.message || e) }));
      return;
    }
    if (kind === "ask") {
      readJsonBody(req)
        .then(async (task) => {
          const timeout = Number(req.headers["x-timeout"] || url.searchParams.get("timeout") || rpcTimeoutMs(task));
          if (!rtcMod?.isRtcUp?.()) {
            jsonRes(res, 503, { ok: false, error: "rtc down" });
            return;
          }
          const result = await rtcMod.rtcCall(task, timeout);
          const blob = persistDirtyResult(result, { queue: false });
          if (blob && result.body && typeof result.body === "object") {
            result.body.blob_b64 = blob;
          }
          jsonRes(res, 200, result);
        })
        .catch((e) => {
          const msg = String(e.message || e);
          jsonRes(res, /JSON/i.test(msg) ? 400 : 500, { ok: false, error: /JSON/i.test(msg) ? "bad json" : msg });
        });
      return;
    }
    res.writeHead(404);
    res.end("no");
  });
  server.listen(port, bind, () => log("rpc http", `${bind}:${port}`));
  server.on("error", (e) => {
    log("rpc http", e.message || e);
    const code = hopListenBusyExitCode(e);
    if (code != null) process.exit(code);
  });
}

async function handleEnvelope(env, client, seen) {
  if (!env?.lane || !env.frame) return;
  if (typeof env.from === "string" && env.from.trim()) {
    incomingPeer = env.from.trim();
  }
  const frame = env.frame;
  if (env.lane === "rtc") {
    rtcHandler?.(frame);
    return;
  }
  const fid = String(frame.id || "");
  if (!fid) return;
  const side = sideNow();
  if (side === "clean" && env.lane === "d2c") {
    if (seen.frames.has(`d2c:${fid}`)) return;
    seen.frames.add(`d2c:${fid}`);
    const one = await runCleanJob(frame);
    const result = {
      id: fid,
      type: "result",
      ok: Boolean(one.ok),
      body: { id: fid, ...one },
      req: frame.type,
    };
    await sendFrame(client, "c2d", result);
    seen.frames.add(`c2d:${fid}`);
    saveSeen(seen);
    log("done d2c", fid, frame.type || "", one.ok);
  }
  if (side === "dirty" && env.lane === "c2d") {
    if (seen.frames.has(`c2d:${fid}`)) return;
    writeDirtyResult(frame);
    seen.frames.add(`c2d:${fid}`);
    saveSeen(seen);
  }
}

async function handleToDevice(event, client, seen) {
  const typ = event.getType?.() || event.type;
  if (typ !== EVENT_TYPE) return;
  const content = event.getContent?.() || event.content || {};
  const env = parseEnvelope(content);
  if (!env) return;
  await handleEnvelope(env, client, seen);
}

async function pumpOutgoing(client, seen, cleanRoot) {
  if (sideNow() === "dirty") {
    const inbox = join(DIRTY_LOCAL, "mxinbox");
    ensureDir(inbox);
    for (const path of listFrames(inbox)) {
      const frame = loadJson(path, null);
      if (!frame?.id) continue;
      const key = `d2c:${frame.id}`;
      if (seen.frames.has(key)) continue;
      if (rtcMod?.isRtcUp?.()) {
        const result = await rtcMod.rtcCall(frame, rpcTimeoutMs(frame));
        writeDirtyResult(result);
        seen.frames.add(key);
        saveSeen(seen);
        consumeFile(path);
        continue;
      }
      await sendFrame(client, "d2c", frame);
      seen.frames.add(key);
      saveSeen(seen);
      consumeFile(path);
    }
    return;
  }
  if (!cleanRoot) return;
  const folder = join(cleanRoot, "pipe", "c2d");
  for (const path of listFrames(folder)) {
    const frame = loadJson(path, null);
    if (!frame?.id) continue;
    const key = `c2d:${frame.id}`;
    if (seen.frames.has(key)) continue;
    await sendFrame(client, "c2d", frame);
    seen.frames.add(key);
    saveSeen(seen);
  }
}

async function loadSessionForever() {
  for (;;) {
    const session = loadJson(sessionPath, null);
    if (session?.access_token) {
      if (!session.user_id) session.user_id = sessionUserId(session);
      if (!session.user_id) {
        log("session has no user_id, wait 5s", sessionPath);
        await sleep(5000);
        continue;
      }
      userId = session.user_id;
      return session;
    }
    log("no session, wait 5s", sessionPath);
    await sleep(5000);
  }
}

async function bootForever(session) {
  for (;;) {
    try {
      return await bootClient(session);
    } catch (e) {
      log("boot retry", formatErrorChain(e));
      await sleep(8000);
      const fresh = loadJson(sessionPath, session);
      if (fresh?.access_token) Object.assign(session, fresh);
    }
  }
}

function watchSync(client) {
  let lastOk = Date.now();
  client.on("sync", (state) => {
    if (state === "SYNCING" || state === "PREPARED" || state === "CATCHUP") lastOk = Date.now();
    if (state !== "SYNCING") log("sync", state);
  });
  const deadMs = Number(process.env.HF_SYNC_DEAD_MS || 120000);
  setInterval(() => {
    if (
      !shouldExitOnSyncDead({
        rtcUp: Boolean(rtcMod?.isRtcUp?.()),
        lastOkMs: lastOk,
        nowMs: Date.now(),
        deadMs,
      })
    ) {
      return;
    }
    log("sync dead", deadMs, "exit for watchdog");
    process.exit(7);
  }, 10000);
}

async function daemon() {
  const side = sideNow();
  if (side !== "dirty" && side !== "clean") {
    throw new Error("set HF_SIDE=dirty|clean");
  }
  claimThisHop();
  const tempCfg = { ...readHotfolderTempConfig(), root: DIRTY_LOCAL };
  const sweepTick = () => {
    try {
      const n = sweepAllTemp(tempCfg);
      if (n) log("temp sweep", n);
    } catch (e) {
      log("temp sweep", e.message || e);
    }
  };
  sweepTick();
  setInterval(sweepTick, tempCfg.sweepMs);
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (shouldRecycleAfterClockJump(lastTick, now)) {
      log("clock jump", now - lastTick, "exit for watchdog");
      process.exit(7);
    }
    lastTick = now;
  }, 5000);
  const session = await loadSessionForever();
  const cleanRoot = side === "clean" ? detectCleanRoot() : null;
  if (side === "clean") log("CLEAN ROOT", cleanRoot || "(none, ping/shell in-process)");
  if (side === "dirty") {
    ensureDir(join(DIRTY_LOCAL, "mxinbox", "sent"));
    ensureDir(join(DIRTY_LOCAL, "outbox"));
    log("DIRTY local", DIRTY_LOCAL);
    startDirtyHttp();
  }
  log("session", session.user_id, session.device_id, "to-device", EVENT_TYPE);
  const client = await bootForever(session);
  watchSync(client);
  const seen = loadSeen();
  log("crypto device", client.getDeviceId());
  try {
    const peer = await resolvePeerDevice(client.getDeviceId());
    log("peer device", peer);
  } catch (e) {
    log("peer", formatErrorChain(e));
  }

  const onToDevice = (event) => {
    handleToDevice(event, client, seen).catch((e) => log("in", formatErrorChain(e)));
  };
  client.on("toDeviceEvent", onToDevice);
  client.on("Event.decrypted", (event) => {
    if (event.getType?.() === EVENT_TYPE) onToDevice(event);
  });

  log("daemon up");
  try {
    const rtc = await import(pathToFileURL(join(HERE, "rtc-pipe.mjs")).href);
    rtcMod = rtc;
    rtcHandler = rtc.handleRtcSignal;
    rtc.startRtc({
      side,
      sendSignal: (frame) => sendFrame(client, "rtc", frame),
      log,
      onRpc: side === "clean" ? (task) => runCleanJob(task) : null,
    }).catch((e) => log("rtc", formatErrorChain(e)));
  } catch (e) {
    log("rtc disabled", formatErrorChain(e));
  }
  while (true) {
    try {
      await pumpOutgoing(client, seen, cleanRoot);
    } catch (e) {
      log("out", formatErrorChain(e));
    }
    await sleep(POLL_MS);
  }
}

async function sendPing() {
  process.env.HF_SIDE = process.env.HF_SIDE || "dirty";
  const session = loadJson(sessionPath, null);
  if (!session?.access_token) throw new Error("no session");
  if (!session.user_id) session.user_id = sessionUserId(session);
  if (!session.user_id) throw new Error("session has no user_id");
  userId = session.user_id;
  const client = await bootClient(session);
  const id = Math.random().toString(16).slice(2, 12);
  await sendFrame(client, "d2c", { id, type: "ping", body: {} });
  log("ping", id);
  client.stopClient();
}

const cmdName = (process.argv[2] || "").toLowerCase();
const rest = process.argv[3];
if (cmdName === "ping") {
  await sendPing();
} else if (cmdName === "dirty" || cmdName === "clean" || cmdName === "daemon") {
  if (cmdName === "dirty" || cmdName === "clean") process.env.HF_SIDE = cmdName;
  if (rest === "dirty" || rest === "clean") process.env.HF_SIDE = rest;
  await daemon();
} else {
  console.error("Usage: node index.mjs dirty|clean|ping");
  process.exit(2);
}
