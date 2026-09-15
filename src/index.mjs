import { mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, existsSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import http from "http";
import { applyNodeNetworkPolicy, pinnedFetch } from "./dist/network-policy.js";
import { shouldRecycleAfterClockJump } from "./dist/watchdog-clock.js";
import { runCleanJob } from "./clean-jobs.mjs";
import { parseShotQuery, screensHeader, normalizeScreens } from "./view-shot.mjs";

applyNodeNetworkPolicy();

const HERE = dirname(fileURLToPath(import.meta.url));
const EVENT_TYPE = process.env.HF_EVENT_TYPE || "org.hf.pipe";
const SEQ_WIDTH = 8;
const MAX_EVENT = 55_000;
const POLL_MS = 700;
const USER_ID = "@kirill:mtx-1.zala-soft.com";

const secrets = join(process.env.USERPROFILE || "", ".cursor", "secrets");
const sessionPath = process.env.MATRIX_SESSION_FILE || join(secrets, "matrix-session.json");

function sideNow() {
  return (process.env.HF_SIDE || "dirty").toLowerCase();
}

function getDataDir() {
  return process.env.MATRIX_DATA_DIR || join(secrets, sideNow() === "clean" ? "matrix-e2ee-clean" : "matrix-e2ee-store");
}

function getSeenPath() {
  return join(getDataDir(), "hf-seen.json");
}

const CLEAN_ROOTS = [
  process.env.HOT_ROOT,
  join(process.env.USERPROFILE || "", "bin", "hotfolder", "mxroot"),
  "Z:\\malykh_kirill\\folderhot",
  "\\\\edsizhfs0004.five.loc\\malykh_kirill\\folderhot",
  "\\\\edsizhfs0001\\Share13\\malykh_kirill\\folderhot",
].filter(Boolean);

const DIRTY_LOCAL = join(process.env.USERPROFILE || "", "bin", "hotfolder", "local");

const origErr = console.error.bind(console);
console.error = (...args) => {
  const s = args.map((a) => (typeof a === "string" ? a : a?.message || String(a))).join(" ");
  if (/One time key|signed_curve25519:.*already exists/i.test(s)) return;
  origErr(...args);
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function writePid() {
  try {
    writeFileSync(join(HERE, "hf.pid"), String(process.pid));
  } catch {
    // ignore
  }
}

function clearPid() {
  try {
    unlinkSync(join(HERE, "hf.pid"));
  } catch {
    // ignore
  }
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

function nameOf(device) {
  return String(device.display_name || "").toLowerCase();
}

async function resolvePeerDevice(myDevice) {
  if (process.env.HF_PEER_DEVICE) return process.env.HF_PEER_DEVICE;
  if (peerCache.id && Date.now() - peerCache.at < 15000) return peerCache.id;
  const res = await pinnedFetch(`${hsBase()}/_matrix/client/v3/devices`, {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`devices ${res.status} ${text.slice(0, 180)}`);
  const devices = JSON.parse(text).devices || [];
  const others = devices.filter((d) => d.device_id && d.device_id !== myDevice);
  const side = sideNow();
  const pred =
    side === "dirty"
      ? (d) => nameOf(d).includes("hf-matrix")
      : (d) => nameOf(d).includes("hf-dirty") || nameOf(d).includes("cursor mcp");
  const hits = others.filter(pred).sort((a, b) => (b.last_seen_ts || 0) - (a.last_seen_ts || 0));
  const id = hits[0]?.device_id;
  if (!id) throw new Error("no peer hf device (clean must be hf-matrix, dirty Cursor MCP or hf-dirty)");
  peerCache = { id, at: Date.now() };
  return id;
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

  const clientJs = [
    join(HERE, "dist", "matrix", "client.js"),
    join(process.env.USERPROFILE || "", "Desktop", "hf-matrix-pack", "dist", "matrix", "client.js"),
  ].find((p) => existsSync(p));
  if (!clientJs) throw new Error("missing dist/matrix/client.js");
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
  const env = { hf: 1, lane, frame };
  const raw = JSON.stringify(env);
  if (raw.length > MAX_EVENT) {
    throw new Error(`frame ${frame.id} too large (${raw.length} > ${MAX_EVENT})`);
  }
  const myDevice = client.getDeviceId?.() || process.env.MATRIX_DEVICE_ID;
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
        [USER_ID]: {
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

function persistDirtyResult(frame) {
  ensureDir(join(DIRTY_LOCAL, "outbox"));
  const id = frame.id || "unknown";
  const body = frame.body && typeof frame.body === "object" ? frame.body : {};
  let blob = null;
  if (body.blob_b64) {
    blob = body.blob_b64;
    const mime = String(body.mime || "");
    const ext = mime.includes("png") ? ".png" : mime.includes("jpeg") ? ".jpg" : ".bin";
    const shotDir = join(DIRTY_LOCAL, "shots");
    ensureDir(shotDir);
    const shotPath = join(shotDir, `${id}${ext}`);
    writeFileSync(shotPath, Buffer.from(blob, "base64"));
    body.saved = shotPath;
    delete body.blob_b64;
    frame.body = body;
    log("blob", id, shotPath, body.bytes || "");
  }
  saveJson(join(DIRTY_LOCAL, "outbox", `${id}.json`), frame);
  try {
    saveJson(join(DIRTY_LOCAL, "from_clean.txt"), frame);
  } catch {
    writeFileSync(join(DIRTY_LOCAL, "from_clean.txt"), JSON.stringify(frame, null, 2));
  }
  log("got", id, "ok", frame.body?.ok ?? frame.ok);
  return blob;
}

function writeDirtyResult(frame) {
  persistDirtyResult(frame);
}

let rtcHandler = null;
let rtcMod = null;

function rpcTimeoutMs(frame) {
  const t = String(frame.type || "").toLowerCase();
  const body = frame.body && typeof frame.body === "object" ? frame.body : {};
  if (t === "screenshot") return 15000;
  if (t === "read" || t === "pull" || t === "write") return 20000;
  if (t === "mouse" || t === "pointer" || t === "click" || t === "key" || t === "keyboard" || t === "type" || t === "hotkey" || t === "input") {
    return 8000;
  }
  return ((Number(body.timeout) || 12) + 3) * 1000;
}

function startDirtyHttp() {
  const port = Number(process.env.HF_RPC_PORT || 18765);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/view")) {
      try {
        const html = readFileSync(join(HERE, "hf-view.html"), "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e.message || e));
      }
      return;
    }
    if (req.method === "GET" && url.pathname === "/shot") {
      (async () => {
        if (!rtcMod?.isRtcUp?.()) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "rtc down" }));
          return;
        }
        const shot = parseShotQuery(url.href);
        const task = {
          id: Math.random().toString(16).slice(2, 10),
          type: "screenshot",
          body: { fmt: "jpeg", maxw: shot.maxw, quality: shot.quality, display: shot.display },
        };
        const result = await rtcMod.rtcCall(task, 12000);
        const body = result.body && typeof result.body === "object" ? result.body : {};
        if (!body.blob_b64) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: body.error || "no image" }));
          return;
        }
        const buf = Buffer.from(body.blob_b64, "base64");
        res.writeHead(200, {
          "Content-Type": body.mime || "image/jpeg",
          "Cache-Control": "no-store",
          "X-Geom": `${body.left || 0},${body.top || 0},${body.width || 0},${body.height || 0}`,
          "X-Bytes": String(buf.length),
          "X-Display": String(body.display ?? shot.display),
          "X-Screens": screensHeader(normalizeScreens(body.screens)),
        });
        res.end(buf);
      })().catch((e) => {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        }
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ rtc: Boolean(rtcMod?.isRtcUp?.()), pid: process.pid, side: sideNow() }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/ask") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        (async () => {
          let task;
          try {
            task = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "bad json" }));
            return;
          }
          const timeout = Number(req.headers["x-timeout"] || url.searchParams.get("timeout") || rpcTimeoutMs(task));
          if (!rtcMod?.isRtcUp?.()) {
            res.writeHead(503, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "rtc down" }));
            return;
          }
          const result = await rtcMod.rtcCall(task, timeout);
          const blob = persistDirtyResult(result);
          if (blob && result.body && typeof result.body === "object") {
            result.body.blob_b64 = blob;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        })().catch((e) => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
        });
      });
      return;
    }
    res.writeHead(404);
    res.end("no");
  });
  server.listen(port, "127.0.0.1", () => log("rpc http", `127.0.0.1:${port}`));
  server.on("error", (e) => log("rpc http", e.message || e));
}

async function handleEnvelope(env, client, seen) {
  if (!env?.lane || !env.frame) return;
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
        try {
          renameSync(path, join(inbox, "sent", path.split(/[/\\]/).pop()));
        } catch {
          ensureDir(join(inbox, "sent"));
          try {
            renameSync(path, join(inbox, "sent", path.split(/[/\\]/).pop()));
          } catch {
            // leave for retry
          }
        }
        continue;
      }
      await sendFrame(client, "d2c", frame);
      seen.frames.add(key);
      saveSeen(seen);
      try {
        renameSync(path, join(inbox, "sent", path.split(/[/\\]/).pop()));
      } catch {
        ensureDir(join(inbox, "sent"));
        try {
          renameSync(path, join(inbox, "sent", path.split(/[/\\]/).pop()));
        } catch {
          // leave for retry
        }
      }
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
      if (!session.user_id) session.user_id = USER_ID;
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
      log("boot retry", e.message || e);
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
    if (Date.now() - lastOk <= deadMs) return;
    log("sync dead", deadMs, "exit for watchdog");
    process.exit(7);
  }, 10000);
}

async function daemon() {
  const side = sideNow();
  if (side !== "dirty" && side !== "clean") {
    throw new Error("set HF_SIDE=dirty|clean");
  }
  writePid();
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
    log("peer", e.message || e);
  }

  const onToDevice = (event) => {
    handleToDevice(event, client, seen).catch((e) => log("in", e.message || e));
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
    }).catch((e) => log("rtc", e.message || e));
  } catch (e) {
    log("rtc disabled", e.message || e);
  }
  while (true) {
    try {
      await pumpOutgoing(client, seen, cleanRoot);
    } catch (e) {
      log("out", e.message || e);
    }
    await sleep(POLL_MS);
  }
}

async function sendPing() {
  process.env.HF_SIDE = process.env.HF_SIDE || "dirty";
  const session = loadJson(sessionPath, null);
  if (!session?.access_token) throw new Error("no session");
  if (!session.user_id) session.user_id = USER_ID;
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
