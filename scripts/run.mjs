import { fork } from "node:child_process";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/config.mjs";
import { renderOperationalBoardHtml } from "../src/operational-board.mjs";
import { createSupervisorRecovery } from "../src/supervisor-recovery.mjs";

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

const status = {
  bootstrap: { side, pid: process.pid, startedAt: new Date().toISOString(), current: "dev" },
  report: null,
  lastExit: null,
};
const server = http.createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", req.url === "/status" ? "application/json; charset=utf-8" : "text/html; charset=utf-8");
  res.end(req.url === "/status" ? JSON.stringify({ ...status, reportAgeMs: status.reportReceivedAt ? Date.now() - status.reportReceivedAt : null }) : renderOperationalBoardHtml());
});
server.on("error", (error) => { console.error(error.message); process.exit(2); });

function start() {
  const recovery = createSupervisorRecovery();
  const child = fork(join(ROOT, "src", "index.mjs"), [side], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  child.on("message", (message) => {
    if (message?.kind === "supervisor-health") {
      recovery.report(Date.now(), message.phase);
      status.report = message;
      status.reportReceivedAt = Date.now();
    }
  });
  const watchdog = setInterval(() => {
    const decision = recovery.check(Date.now(), status.report?.local);
    if (decision.reason) { console.error(decision.reason); child.kill(); }
  }, 1000);
  child.on("exit", (code, signal) => {
    clearInterval(watchdog);
    status.report = null;
    status.lastExit = { code, signal, at: new Date().toISOString() };
    if (once) process.exit(code ?? (signal ? 1 : 0));
    if (code === 2) process.exit(2);
    console.error(new Date().toISOString(), "node exited", code ?? signal, "- restart in 4s");
    setTimeout(start, 4000);
  });
}

server.listen(Number(process.env.HF_SUPERVISOR_PORT || 18764), "127.0.0.1", start);
