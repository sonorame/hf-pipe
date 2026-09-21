import { existsSync } from "fs";
import { execFileSync } from "child_process";
import { homedir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export const KILO_LAST_N = 8;
export const KILO_TZ = "Europe/Moscow";
export const KILO_QUERY_TIMEOUT_MS = 8000;
const HERE = dirname(fileURLToPath(import.meta.url));
const QUERY_PY = join(HERE, "kilo-query.py");
const MAX_THREAD_PARTS = 24;
const MAX_TEXT = 800;

export function resolveKiloDbPath(env = process.env, home = homedir) {
  const fromEnv = String(env.HF_KILO_DB || "").trim();
  if (fromEnv) return fromEnv;
  return join(home(), ".local", "share", "kilo", "kilo.db");
}

export function dayKey(ms, timeZone = KILO_TZ) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Number(ms) || 0));
}

export function formatStamp(ms, timeZone = KILO_TZ) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(Number(ms) || 0));
}

export function partText(row) {
  let data = row?.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return "";
    }
  }
  if (!data || data.type !== "text") return "";
  return String(data.text || "").trim();
}

export function pickKiloSessions(sessions, now, lastN = KILO_LAST_N, timeZone = KILO_TZ) {
  const today = dayKey(now, timeZone);
  const sorted = [...(sessions || [])].sort(
    (a, b) => Number(b.time_updated || 0) - Number(a.time_updated || 0),
  );
  return sorted.filter(
    (session, index) => index < lastN || dayKey(session.time_updated, timeZone) === today,
  );
}

function lastTextFor(sessionId, parts) {
  let last = "";
  for (const row of parts || []) {
    if (String(row.session_id) !== String(sessionId)) continue;
    const text = partText(row);
    if (text) last = text;
  }
  return last;
}

function oneLine(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function sessionModel(raw) {
  const s = String(raw || "").trim();
  if (s.startsWith("{")) {
    try {
      const parsed = JSON.parse(s);
      return String(parsed.id || parsed.model || "").trim() || s;
    } catch {
      return s;
    }
  }
  return s;
}

export function probeKilo({ queryFn, now = Date.now(), lastN = KILO_LAST_N, timeZone = KILO_TZ }) {
  const sessions = queryFn("sessions") || [];
  const selected = pickKiloSessions(sessions, now, lastN, timeZone);
  const missing = selected.filter((session) => !String(session.last_text || session.lastText || "").trim());
  const parts = missing.length ? queryFn("parts", { ids: missing.map((s) => s.id) }) || [] : [];
  return {
    lastN,
    sessions: selected.map((session) => ({
      id: String(session.id || ""),
      title: String(session.title || ""),
      updated: Number(session.time_updated) || 0,
      agent: String(session.agent || ""),
      model: sessionModel(session.model),
      lastText: String(session.last_text || session.lastText || lastTextFor(session.id, parts) || ""),
    })),
  };
}

export function probeKiloThread({ queryFn, kiloId, timeZone = KILO_TZ }) {
  const rows = queryFn("thread", { kiloId }) || [];
  const thread = [];
  for (const row of rows) {
    const text = partText(row);
    if (!text) continue;
    thread.push({ time: Number(row.time_created) || 0, text });
    if (thread.length >= MAX_THREAD_PARTS) break;
  }
  return { kiloId: String(kiloId || ""), lastN: KILO_LAST_N, thread, timeZone };
}

export function formatKiloFacet(kilo) {
  if (!kilo) return [];
  if (kilo.error) return [`kilo error ${kilo.error}`];
  if (kilo.thread) {
    const lines = [`kilo thread ${kilo.kiloId}`];
    if (!kilo.thread.length) lines.push("(none)");
    for (const part of kilo.thread) {
      lines.push(`${formatStamp(part.time)} ${oneLine(part.text).slice(0, MAX_TEXT)}`);
    }
    return lines;
  }
  const lines = [`kilo today+${kilo.lastN ?? KILO_LAST_N}`];
  if (!(kilo.sessions || []).length) lines.push("(none)");
  for (const session of kilo.sessions || []) {
    lines.push(`${formatStamp(session.updated)} ${session.title}`.trim());
    lines.push(`  id=${session.id} model=${session.model || "-"}`);
    if (session.lastText) lines.push(`  last: ${oneLine(session.lastText).slice(0, 200)}`);
  }
  return lines;
}

export function kiloPythonSpawn(env = process.env, platform = process.platform) {
  const fromEnv = String(env.HF_PYTHON || "").trim();
  if (fromEnv) return { cmd: fromEnv, prefix: [] };
  if (platform === "win32") return { cmd: "py", prefix: ["-3"] };
  return { cmd: "python3", prefix: [] };
}

export function makePythonKiloQueryFn(dbPath, execFile = execFileSync, io = {}) {
  const path = String(dbPath || "");
  const spawn = kiloPythonSpawn(io.env || process.env, io.platform || process.platform);
  return (kind, extra = {}) => {
    if (!path || !existsSync(path)) throw new Error(`missing ${path || "kilo.db"}`);
    const args = [...spawn.prefix, QUERY_PY, path, kind];
    if (kind === "thread") args.push(String(extra.kiloId || ""));
    else if (kind === "parts") args.push(JSON.stringify(extra.ids || []));
    const stdout = execFile(spawn.cmd, args, {
      encoding: "utf8",
      timeout: KILO_QUERY_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 400_000,
    });
    return JSON.parse(String(stdout || "[]"));
  };
}

export function resolveKiloFacet(io = {}) {
  const body = io.body && typeof io.body === "object" ? io.body : {};
  const kiloId = String(body.kiloId || "").trim();
  const kiloKey = String(body.kilo || "").trim();
  if (!kiloId && !kiloKey) return undefined;
  try {
    const queryFn = io.kiloQueryFn || makePythonKiloQueryFn(resolveKiloDbPath(io.env || process.env));
    if (kiloId) return probeKiloThread({ queryFn, kiloId });
    return probeKilo({ queryFn, now: io.now || Date.now() });
  } catch (err) {
    return { error: String(err.message || err) };
  }
}
