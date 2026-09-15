import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/config.mjs";

loadEnvFile();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2).filter((a) => a !== "--once");
const once = process.argv.includes("--once");
const side = (args[0] || process.env.HF_SIDE || "").toLowerCase();

if (side !== "dirty" && side !== "clean") {
  console.error("Usage: node scripts/run.mjs dirty|clean [--once]");
  process.exit(2);
}

process.env.HF_SIDE = side;
if (!process.env.HF_TEMP_KEEP_MS) process.env.HF_TEMP_KEEP_MS = "0";
if (!process.env.HF_TEMP_SWEEP_MS) process.env.HF_TEMP_SWEEP_MS = "30000";

function start() {
  const child = spawn(process.execPath, [join(ROOT, "src", "index.mjs"), side], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (once) process.exit(code ?? (signal ? 1 : 0));
    console.error(new Date().toISOString(), "node exited", code ?? signal, "- restart in 4s");
    setTimeout(start, 4000);
  });
}

start();
