import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const IMPORT_RE = /from\s+["'](\.\.?\/dist\/[^"']+\.js)["']/g;

const STUBS = {
  "hop-board.js": `export const HOP_BOARD_ACTIONS = ["ping", "recycle", "restart", "doctor"];
export function hopRestartDelayMs() { return 250; }
export function parseDoctorStdout(text) {
  const lines = String(text || "").split(/\\r?\\n/);
  let verdict = "RED";
  let failing = [];
  let culprit = null;
  let next = "";
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("{") && t.endsWith("}")) {
      try {
        const j = JSON.parse(t);
        if (j.verdict === "GREEN" || j.verdict === "RED") {
          verdict = j.verdict;
          failing = Array.isArray(j.failing) ? j.failing.map((x) => String(x)) : [];
          culprit = j.culprit == null ? null : String(j.culprit);
        }
      } catch {}
    }
    if (t.startsWith("NEXT ")) next = t.slice(5);
  }
  return { verdict, failing, culprit, next };
}
export function parseHopControl(input) {
  if (!input || typeof input !== "object") return null;
  const action = String(input.action || "").trim().toLowerCase();
  return HOP_BOARD_ACTIONS.includes(action) ? action : null;
}
export function shapeHopStatus(s = {}) {
  const dc = String(s.dc || "none");
  const connection = String(s.connection || "none");
  const ice = String(s.ice || "none");
  const signaling = String(s.signaling || "none");
  const rtc = Boolean(s.rtc);
  return {
    rtc,
    pid: Number(s.pid) || 0,
    side: String(s.side || "dirty"),
    dc,
    connection,
    ice,
    signaling,
    gen: Number(s.gen) || 0,
    epoch: s.epoch == null || s.epoch === "" ? null : String(s.epoch),
    pongAgeMs: Number.isFinite(Number(s.pongAgeMs)) ? Number(s.pongAgeMs) : null,
    peerHost: s.peerHost == null || s.peerHost === "" ? null : String(s.peerHost),
    caption: rtc ? "Канал жив." : "Трубы нет. Демон сам собирает.",
    dcText: dc,
    connectionText: connection,
    iceText: ice,
    signalingText: signaling,
  };
}
export function renderHopBoardHtml() {
  return "<!DOCTYPE html><title>Hop</title><p>Hop</p>";
}
`,
  "hop-log.js": `const lines = [];
let seq = 0;
export function pushHopLog(kind, detail = {}, level = "info") {
  const line = { id: ++seq, t: Date.now(), level, text: String(kind || "") };
  lines.push(line);
  if (lines.length > 80) lines.splice(0, lines.length - 80);
  return line;
}
export function readHopLogAfter(afterId = 0) {
  const after = Number(afterId) || 0;
  return lines.filter((l) => l.id > after);
}
export function resetHopLog() {
  seq = 0;
  lines.length = 0;
}
`,
};

function packRoot(root) {
  if (existsSync(join(root, "package.json"))) return root;
  const parent = join(root, "..");
  if (existsSync(join(parent, "package.json"))) return parent;
  return root;
}

function entryFiles(root) {
  const files = [];
  const pack = packRoot(root);
  for (const rel of ["index.mjs", "rtc-pipe.mjs", join("src", "index.mjs"), join("src", "rtc-pipe.mjs")]) {
    const p = join(pack, rel);
    if (existsSync(p) && !files.includes(p)) files.push(p);
  }
  return { pack, files };
}

function importsFrom(file) {
  const text = readFileSync(file, "utf8");
  const out = [];
  IMPORT_RE.lastIndex = 0;
  let m;
  while ((m = IMPORT_RE.exec(text))) out.push(m[1]);
  return out;
}

export function missingDistModules(root) {
  const { files } = entryFiles(root);
  const missing = new Set();
  for (const file of files) {
    const dir = dirname(file);
    for (const spec of importsFrom(file)) {
      const abs = join(dir, spec);
      if (!existsSync(abs)) missing.add(spec.split("/").pop());
    }
  }
  return [...missing];
}

function runTsc(pack) {
  const tsc = join(pack, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tsc)) return false;
  const r = spawnSync(process.execPath, [tsc, "-p", pack], {
    cwd: pack,
    windowsHide: true,
    encoding: "utf8",
    timeout: 60000,
  });
  return r.status === 0;
}

function writeStub(pack, name) {
  const body = STUBS[name];
  if (!body) return false;
  const dest = join(pack, "dist", name);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, body);
  return true;
}

export function ensureHopDist(root) {
  const { pack } = entryFiles(root);
  const missingBefore = missingDistModules(pack);
  const wrote = [];
  const built = [];
  if (!missingBefore.length) {
    return { missingBefore, wrote, built };
  }
  if (runTsc(pack)) built.push("tsc");
  for (const name of missingDistModules(pack)) {
    if (writeStub(pack, name)) wrote.push(name);
  }
  return { missingBefore, wrote, built };
}

const thisFile = fileURLToPath(import.meta.url);
function ranAsCli() {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === thisFile;
  } catch {
    return false;
  }
}
if (ranAsCli()) {
  const result = ensureHopDist(process.cwd());
  console.log(JSON.stringify(result));
}
