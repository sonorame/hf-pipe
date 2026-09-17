import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

function start() {
  const child = spawn(process.execPath, [ENTRY, side], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("exit", (code, signal) => {
    console.error(new Date().toISOString(), "node exited", code ?? signal, "- restart in 4s");
    setTimeout(start, 4000);
  });
}

start();
