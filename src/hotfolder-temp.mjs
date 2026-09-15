import { readdirSync, statSync, unlinkSync, existsSync } from "fs";
import { join, relative } from "path";
import { tmpdir } from "os";

export const QUEUE_LIVE_MS = 20_000;
export const DEFAULT_SWEEP_MS = 30_000;

function slash(rel) {
  return String(rel || "").replace(/\//g, "\\");
}

export function readHotfolderTempConfig(env = process.env) {
  const keepRaw = Number(env.HF_TEMP_KEEP_MS ?? 0);
  const keepMs = Number.isFinite(keepRaw) && keepRaw > 0 ? keepRaw : 0;
  const sweepRaw = Number(env.HF_TEMP_SWEEP_MS ?? DEFAULT_SWEEP_MS);
  const sweepMs = Number.isFinite(sweepRaw) && sweepRaw >= 5000 ? sweepRaw : DEFAULT_SWEEP_MS;
  const override = String(env.HF_TEMP_ROOT || env.HF_LOCAL_DIR || "").trim();
  const home = env.HOME || env.USERPROFILE || "";
  const root = override || join(home, ".hf-pipe", "local");
  return { keepMs, sweepMs, root };
}

export function isOsTempJunk(name) {
  return /^(cap-|hf-in-)/i.test(String(name || ""));
}

function keepFile(rel) {
  const name = slash(rel).split("\\").pop();
  return name === "from_clean.txt" || name === "dirty.pid" || (name && name.endsWith(".pid"));
}

function entryKind(rel) {
  const p = slash(rel).toLowerCase();
  if (p.startsWith("shots\\") || p.startsWith("work\\") || p.startsWith("inbox\\")) return "drop";
  if (p.startsWith("mxinbox\\sent\\") || p.includes("\\sent\\")) return "drop";
  if (p.startsWith("outbox\\") || p.startsWith("mxinbox\\")) return "queue";
  return "other";
}

export function listSweepDeletes(entries, nowMs, cfg = {}) {
  const keepMs = Math.max(0, Number(cfg.keepMs) || 0);
  const out = [];
  for (const entry of entries) {
    const rel = slash(entry.rel);
    if (keepFile(rel)) continue;
    const kind = entryKind(rel);
    if (kind === "other") continue;
    const need = kind === "queue" ? Math.max(keepMs, QUEUE_LIVE_MS) : keepMs;
    if (nowMs - Number(entry.mtimeMs) >= need) out.push(entry.rel);
  }
  return out;
}

function walkFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents = [];
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      try {
        const st = statSync(full);
        out.push({ full, rel: slash(relative(root, full)), mtimeMs: st.mtimeMs });
      } catch {
        // skip
      }
    }
  }
  return out;
}

export function sweepHotfolderTemp(root, nowMs, cfg, unlink = unlinkSync) {
  if (!root || !existsSync(root)) return 0;
  const entries = walkFiles(root);
  const want = new Set(listSweepDeletes(entries, nowMs, cfg).map(slash));
  let n = 0;
  for (const entry of entries) {
    if (!want.has(slash(entry.rel))) continue;
    try {
      unlink(entry.full);
      n += 1;
    } catch {
      // busy
    }
  }
  return n;
}

export function sweepOsTempJunk(nowMs, cfg, io = {}) {
  const dir = io.dir || tmpdir();
  const read = io.readdirSync || readdirSync;
  const stat = io.statSync || statSync;
  const unlink = io.unlinkSync || unlinkSync;
  const need = Math.max(Number(cfg?.keepMs) || 0, QUEUE_LIVE_MS);
  let n = 0;
  let names = [];
  try {
    names = read(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!isOsTempJunk(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = stat(full);
    } catch {
      continue;
    }
    if (nowMs - st.mtimeMs < need) continue;
    try {
      unlink(full);
      n += 1;
    } catch {
      // busy
    }
  }
  return n;
}

export function sweepAllTemp(cfg = readHotfolderTempConfig(), nowMs = Date.now()) {
  return sweepHotfolderTemp(cfg.root, nowMs, cfg) + sweepOsTempJunk(nowMs, cfg);
}
