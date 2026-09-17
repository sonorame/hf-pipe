import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, openSync, fstatSync, ftruncateSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = existsSync(join(HERE, "package.json")) ? HERE : join(HERE, "..");
const ENTRY = existsSync(join(HERE, "index.mjs"))
  ? join(HERE, "index.mjs")
  : join(ROOT, "src", "index.mjs");

const side = (process.argv[2] || process.env.HF_SIDE || "").toLowerCase();
if (side !== "dirty" && side !== "clean") {
  console.error("Usage: node keep-loop.mjs dirty|clean");
  process.exit(1);
}

process.env.HF_SIDE = side;
if (!process.env.HF_TEMP_KEEP_MS) process.env.HF_TEMP_KEEP_MS = "0";
if (!process.env.HF_TEMP_SWEEP_MS) process.env.HF_TEMP_SWEEP_MS = "30000";

const logDir = join(homedir(), ".hf-pipe", "logs");
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, `${side}.log`);
const fd = openSync(logFile, "a");
try {
  if (fstatSync(fd).size > 1_000_000) ftruncateSync(fd, 0);
} catch {
  // keep going
}
const logStream = createWriteStream(logFile, { fd });
logStream.write(`${new Date().toISOString()} keep-loop ${side} start\n`);

const ENSURE = existsSync(join(HERE, "ensure-hop-dist.mjs"))
  ? join(HERE, "ensure-hop-dist.mjs")
  : join(ROOT, "src", "ensure-hop-dist.mjs");
try {
  const { ensureHopDist } = await import(pathToFileURL(ENSURE).href);
  const dist = ensureHopDist(ROOT);
  if ((dist.wrote && dist.wrote.length) || (dist.built && dist.built.length)) {
    logStream.write(`${new Date().toISOString()} ensure dist ${JSON.stringify(dist)}\n`);
  }
} catch (e) {
  logStream.write(`${new Date().toISOString()} ensure dist fail ${e && e.message ? e.message : e}\n`);
}

function start() {
  const child = spawn(process.execPath, [ENTRY, side], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", logStream, logStream],
    windowsHide: true,
  });
  child.on("exit", (code, signal) => {
    const line = `${new Date().toISOString()} node exited ${code ?? signal} - restart in 4s\n`;
    try {
      logStream.write(line);
    } catch {
      // ignore
    }
    console.error(line.trim());
    setTimeout(start, 4000);
  });
}

start();
