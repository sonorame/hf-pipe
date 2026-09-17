import { fork, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { recordReleaseFailure, verifyRelease } from "./release-runtime.mjs";

function runtimeRoot() {
  return process.env.HF_RUNTIME_ROOT || join(homedir(), ".hf-pipe", "runtime");
}

function readState(root) {
  return JSON.parse(readFileSync(join(root, "state.json"), "utf8"));
}

function failureReason(code, signal, stderr) {
  const detail = String(stderr || "").trim().split(/\r?\n/).at(-1);
  return `release exited before booted: ${code ?? signal ?? "unknown"}${detail ? ` ${detail}` : ""}`;
}

function boardHtml() {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>hf-pipe status</title><style>
body{margin:0;background:#111;color:#eee;font:14px Segoe UI,Arial;padding:24px}main{max-width:1000px;margin:auto}
h1{font-size:22px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.card{background:#1c1c1c;border:1px solid #333;border-radius:12px;padding:16px}.up{color:#77db8a}.down{color:#ef806f}
pre{white-space:pre-wrap;word-break:break-word;color:#ccc}a{color:#8ab4f8}</style></head><body><main>
<h1>hf-pipe</h1><div class="grid"><section class="card"><h2 id="channel">Загрузка...</h2><pre id="local"></pre></section>
<section class="card"><h2>Clean</h2><pre id="peer"></pre></section></div><section class="card"><h2>Операции</h2><pre id="ops"></pre></section>
<script>async function tick(){try{const s=await fetch('/status').then(r=>r.json());const l=s.report?.local||{};
const up=!!l.rtc;channel.textContent=up?'Канал жив':'Канал не собран';channel.className=up?'up':'down';
local.textContent=JSON.stringify({bootstrap:s.bootstrap,local:l,lastExit:s.lastExit},null,2);
peer.textContent=JSON.stringify(s.report?.peer||null,null,2);
ops.textContent=JSON.stringify(l.traffic?.recent||[],null,2)}catch(e){channel.textContent='Supervisor недоступен';channel.className='down'}}
tick();setInterval(tick,2000)</script></main></body></html>`;
}

function showToast(text) {
  if (process.platform !== "win32") return;
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "Add-Type -AssemblyName System.Drawing;",
    "$n=New-Object System.Windows.Forms.NotifyIcon;",
    "$n.Icon=[System.Drawing.SystemIcons]::Information;",
    "$n.Visible=$true;",
    "$n.ShowBalloonTip(6000,'hf-pipe',$env:HF_TOAST,[System.Windows.Forms.ToolTipIcon]::Info);",
    "Start-Sleep -Seconds 7;$n.Dispose()",
  ].join("");
  spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script], {
    env: { ...process.env, HF_TOAST: text },
    windowsHide: true,
    detached: true,
    stdio: "ignore",
  }).unref();
}

export async function runBootstrap(side, options = {}) {
  const root = options.runtimeRoot || runtimeRoot();
  const once = options.once ?? process.env.HF_BOOTSTRAP_ONCE === "1";
  const threshold = Number(process.env.HF_STARTUP_FAILURE_THRESHOLD || 2);
  const protocolVersion = Number(process.env.HF_PROTOCOL_VERSION || 2);
  const publicPath =
    options.publicKeyPath || process.env.HF_RELEASE_PUBLIC_KEY || join(root, "release-public.pem");
  const publicKey = readFileSync(publicPath, "utf8");
  const logDir = join(root, "logs");
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(join(logDir, `bootstrap-${side}.log`), { flags: "a" });
  const status = {
    bootstrap: { side, pid: process.pid, startedAt: new Date().toISOString(), current: null },
    report: null,
    lastExit: null,
  };
  let notifiedRtc = null;
  let notifyTimer = null;
  if (side === "dirty" && !once) {
    const port = Number(process.env.HF_SUPERVISOR_PORT || 18764);
    http
      .createServer((req, res) => {
        if (req.url === "/status") {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(status));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(boardHtml());
      })
      .listen(port, "127.0.0.1");
  }

  return await new Promise((resolve) => {
    const start = () => {
      let state;
      let releaseId;
      let releaseDir;
      try {
        state = readState(root);
        releaseId = String(state.current || "");
        if (!releaseId) throw new Error("no current release");
        releaseDir = join(root, "releases", releaseId);
        status.bootstrap.current = releaseId;
        const manifest = verifyRelease(releaseDir, {
          publicKey,
          expectedProtocolVersion: protocolVersion,
        });
        log.write(`${new Date().toISOString()} start ${releaseId} ${manifest.buildId}\n`);
      } catch (error) {
        if (releaseId) {
          recordReleaseFailure(root, releaseId, {
            threshold,
            reason: `release verify failed: ${error.message || error}`,
          });
        }
        log.write(`${new Date().toISOString()} verify failed ${error.message || error}\n`);
        if (once) {
          log.end();
          resolve(1);
        } else {
          setTimeout(start, 4000);
        }
        return;
      }

      let booted = false;
      let stderr = "";
      const child = fork(join(releaseDir, "src", "index.mjs"), [side], {
        cwd: releaseDir,
        env: {
          ...process.env,
          HF_SIDE: side,
          HF_BUILD_ID: releaseId,
          HF_PROTOCOL_VERSION: String(protocolVersion),
          HF_RUNTIME_ROOT: root,
        },
        windowsHide: true,
        silent: true,
      });
      child.stdout?.pipe(log, { end: false });
      child.stderr?.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-4000);
        log.write(chunk);
      });
      child.on("message", (message) => {
        if (message?.kind === "supervisor-health" && message.phase === "booted") {
          booted = true;
          log.write(`${new Date().toISOString()} booted ${releaseId}\n`);
        }
        if (message?.kind === "supervisor-health" && message.phase === "running") {
          status.report = message;
          const rtc = Boolean(message.local?.rtc);
          if (rtc !== notifiedRtc && side === "dirty") {
            clearTimeout(notifyTimer);
            notifyTimer = setTimeout(() => {
              if (Boolean(status.report?.local?.rtc) !== rtc) return;
              notifiedRtc = rtc;
              showToast(rtc ? "Канал clean-dirty восстановлен." : "Канал clean-dirty недоступен. Supervisor восстанавливает.");
            }, 15_000);
          }
        }
      });
      const startupTimer = setTimeout(() => {
        if (!booted) child.kill();
      }, Number(process.env.HF_STARTUP_BOOT_MS || 15_000));
      child.on("exit", (code, signal) => {
        clearTimeout(startupTimer);
        if (!booted) {
          recordReleaseFailure(root, releaseId, {
            threshold,
            reason: failureReason(code, signal, stderr),
          });
        }
        log.write(`${new Date().toISOString()} exit ${releaseId} ${code ?? signal}\n`);
        status.lastExit = {
          at: new Date().toISOString(),
          releaseId,
          code: code ?? null,
          signal: signal ?? null,
          booted,
        };
        if (once) {
          log.end();
          resolve(booted && code === 0 ? 0 : 1);
        } else {
          setTimeout(start, 4000);
        }
      });
      child.on("error", (error) => {
        stderr = `${stderr}\n${error.message || error}`;
      });
    };
    start();
  });
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`).href) {
  const side = String(process.argv[2] || process.env.HF_SIDE || "").toLowerCase();
  if (!["dirty", "clean"].includes(side)) {
    console.error("Usage: node bootstrap.mjs dirty|clean");
    process.exit(1);
  }
  const code = await runBootstrap(side);
  process.exit(code);
}
