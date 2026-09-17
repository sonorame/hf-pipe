import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import http from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = existsSync(join(HERE, "index.mjs")) ? HERE : join(HERE, "..");
const PID_PATH = existsSync(join(ROOT, "index.mjs")) ? join(ROOT, "hf.pid") : join(ROOT, "src", "hf.pid");
const START_DIRTY = existsSync(join(ROOT, "start-dirty.cmd"))
  ? join(ROOT, "start-dirty.cmd")
  : join(ROOT, "src", "start-dirty.cmd");
const DOCTOR = existsSync(join(ROOT, "hop-doctor.mjs"))
  ? join(ROOT, "hop-doctor.mjs")
  : join(ROOT, "src", "hop-doctor.mjs");
const DIST = existsSync(join(HERE, "dist", "hop-up-state.js"))
  ? join(HERE, "dist", "hop-up-state.js")
  : join(ROOT, "dist", "hop-up-state.js");

const { classifyHopLaunch } = await import(pathToFileURL(DIST).href);

const WAIT_MS = 45_000;
const STEP_MS = 2_000;
const WEDGE_MS = 15_000;

function log(...args) {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readPid() {
  try {
    const n = Number(String(readFileSync(PID_PATH, "utf8")).trim());
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function commandLineOf(pid) {
  try {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 8000 },
    );
    const s = String(out || "").trim();
    return s || null;
  } catch {
    return null;
  }
}

function getStatus() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: 18765, path: "/status", timeout: 2000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve({ reachable: true, rtc: Boolean(j.rtc), pid: j.pid });
        } catch (e) {
          resolve({ reachable: false, error: String(e.message || e) });
        }
      });
    });
    req.on("error", (e) => resolve({ reachable: false, error: e.code || e.message }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ reachable: false, error: "timeout" });
    });
  });
}

function clearPid() {
  try {
    unlinkSync(PID_PATH);
    log("снял stale hf.pid");
  } catch {
    // ignore
  }
}

function startDirty() {
  log("запускаю start-dirty.cmd (окно hf-dirty оставь открытым)");
  spawn("cmd.exe", ["/c", "start", "hf-dirty", "cmd.exe", "/c", START_DIRTY], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  }).unref();
}

function killPid(pid) {
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/F"], { windowsHide: true, timeout: 8000 });
    log("убил pid", pid);
  } catch (e) {
    log("не убил pid", pid, e.message || e);
  }
}

function snapshot() {
  const pidFilePid = readPid();
  const alive = pidFilePid ? pidAlive(pidFilePid) : false;
  return Promise.resolve().then(async () => {
    const rpc = await getStatus();
    return {
      rpc,
      pidFilePid,
      pidAlive: alive,
      commandLine: alive && pidFilePid ? commandLineOf(pidFilePid) : null,
    };
  });
}

function describe(snap) {
  if (snap.rpc.reachable) return `rpc pid=${snap.rpc.pid} rtc=${snap.rpc.rtc}`;
  const cmd = snap.commandLine ? snap.commandLine.slice(0, 80) : "нет cmdline";
  return `нет :18765 (${snap.rpc.error || "?"}) hf.pid=${snap.pidFilePid || "-"} alive=${snap.pidAlive} ${cmd}`;
}

async function main() {
  console.log("hop-up грязная. Ориентир: 127.0.0.1:18765/status, не голый pid.");
  const t0 = Date.now();
  let started = false;
  let lastAction = "";

  for (;;) {
    const snap = await snapshot();
    const plan = classifyHopLaunch(snap, "dirty");
    const elapsed = Date.now() - t0;
    let action = plan.action;
    if (action === "wait-rpc" && elapsed >= WEDGE_MS) {
      log("hop процесс есть, :18765 молчит 15с - считаю зависшим");
      if (snap.pidFilePid) killPid(snap.pidFilePid);
      clearPid();
      action = "start";
    }
    if (action !== lastAction) {
      log(action, describe(snap));
      lastAction = action;
    } else {
      log("жду", `${Math.round(elapsed / 1000)}с / 45с`, describe(snap));
    }

    if (action === "doctor") break;
    if (action === "clear-and-start") {
      clearPid();
      if (!started) {
        startDirty();
        started = true;
      }
    } else if (action === "start") {
      if (!started) {
        startDirty();
        started = true;
      }
    }

    if (elapsed >= WAIT_MS) {
      log("лимит 45с, гоню доктора как есть");
      break;
    }
    await sleep(STEP_MS);
  }

  console.log("");
  const doctor = spawn(process.execPath, [DOCTOR], {
    cwd: ROOT,
    env: { ...process.env, HF_SIDE: "dirty" },
    stdio: "inherit",
  });
  const code = await new Promise((resolve) => doctor.on("exit", (c) => resolve(c ?? 1)));
  process.exit(code);
}

main().catch((e) => {
  console.error("hop-up FAIL", e.message || e);
  process.exit(1);
});
