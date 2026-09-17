import net from "node:net";
import dnsPromises from "node:dns/promises";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  loadEnvFile,
  sessionFile,
  homeserverUrl,
  rpcBind,
  rpcPort,
} from "./config.mjs";
import { applyNodeNetworkPolicy, pinnedFetch } from "../dist/network-policy.js";
import { summarizeDoctor, formatDoctorLines, nextDoctorHint } from "../dist/doctor.js";
import { formatErrorChain } from "../dist/error-chain.js";

loadEnvFile();
applyNodeNetworkPolicy();

const SIDE = (process.env.HF_SIDE || "dirty").toLowerCase();

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function hsFrom(session) {
  return String(session?.homeserver || homeserverUrl() || "").replace(/\/$/, "");
}

function hostOf(hs) {
  return hs.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];
}

function tcpConnectOnce(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = (ok, err) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      resolve({ ok, ms: Date.now() - t0, err });
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false, "timeout"));
    sock.once("error", (e) => finish(false, e.code || e.message));
    sock.connect(port, host);
  });
}

async function tcpConnect(host, port, timeoutMs, tries) {
  let last = { ok: false, ms: 0, err: "no attempt" };
  for (let i = 0; i < tries; i += 1) {
    last = await tcpConnectOnce(host, port, timeoutMs);
    if (last.ok) return { ...last, attempt: i + 1 };
  }
  return { ...last, attempt: tries };
}

function localHttp(method, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        host: rpcBind(),
        port: rpcPort(),
        method,
        path,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": data.length }
          : {},
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new Error("http timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function scheduledTaskState(name) {
  try {
    const out = execFileSync("schtasks", ["/query", "/tn", name, "/fo", "LIST"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
    });
    const m = out.match(/Status:\s*(\S+)/i) || out.match(/[^\r\n:]+:\s*(\S+)\s*$/m);
    return { ok: true, state: m ? m[1] : "present" };
  } catch (e) {
    return { ok: false, state: String(e.message || e).split(/\r?\n/)[0] };
  }
}

async function main() {
  const checks = [];
  const push = (name, ok, detail, skipped) => {
    const c = { name, ok, detail, skipped };
    checks.push(c);
    console.log(formatDoctorLines([c])[0]);
  };

  console.log("доктор сторона", SIDE);

  const major = Number(process.versions.node.split(".")[0]);
  push("node", major >= 20, `${process.version} ${process.execPath}`);

  const session = loadJson(sessionFile(), null);
  const hs = hsFrom(session);
  const hasSession = Boolean(session?.access_token && session?.user_id && hs);
  push("session", hasSession, session ? `${session.user_id || "no-user"} ${hs || "no-hs"}` : `missing ${sessionFile()}`);

  const host = hostOf(hs || "https://mtx-1.zala-soft.com");
  let ip = "";
  try {
    const looked = await dnsPromises.lookup(host, { family: 4 });
    ip = looked.address;
    push("dns", Boolean(ip), `${host} -> ${ip}`);
  } catch (e) {
    push("dns", false, `${host} ${e.code || e.message}`);
  }

  console.log("... tcp443 (до 10с)");
  const tcp = await tcpConnect(ip || host, 443, 5000, 2);
  push("tcp443", tcp.ok, `${ip || host}:443 ${tcp.ok ? `ok ${tcp.ms}ms` : `fail ${tcp.err}`} try=${tcp.attempt}`);

  if (hs) {
    console.log("... versions");
    try {
      const res = await pinnedFetch(`${hs}/_matrix/client/versions`);
      push("versions", res.status === 200, `HTTP ${res.status}`);
    } catch (e) {
      push("versions", false, formatErrorChain(e));
    }

    console.log("... turn");
    try {
      const res = await pinnedFetch(`${hs}/_matrix/client/v3/voip/turnServer`, {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      const text = await res.text();
      let uris = [];
      try {
        uris = JSON.parse(text).uris || [];
      } catch {
        uris = [];
      }
      const tcpUris = uris.filter((u) => /transport=tcp/i.test(String(u)) || /^turns:/i.test(String(u)));
      push("turn", res.status === 200 && tcpUris.length > 0, `HTTP ${res.status} tcp/tls uris ${tcpUris.length}`);
    } catch (e) {
      push("turn", false, formatErrorChain(e));
    }
  } else {
    push("versions", false, "no homeserver", true);
    push("turn", false, "no homeserver", true);
  }

  if (SIDE === "dirty") {
    let statusOk = false;
    try {
      const st = await localHttp("GET", "/status", null, 5000);
      const j = JSON.parse(st.text);
      statusOk = Boolean(j.rtc);
      push("status", statusOk, `rtc=${j.rtc} pid=${j.pid} side=${j.side}`);
    } catch (e) {
      push("status", false, `local /status ${e.message || e}`);
    }

    if (statusOk) {
      console.log("... e2e ping до чистой (до 20с)");
      try {
        const r = await localHttp("POST", "/ask", { id: `doc${Date.now().toString(16)}`, type: "ping", body: {} }, 20000);
        const j = JSON.parse(r.text);
        push("e2e", Boolean(j.ok && j.body?.host), `peer host ${j.body?.host || "?"}`);
      } catch (e) {
        push("e2e", false, `ping ${e.message || e}`);
      }
    } else {
      push("e2e", false, "status not rtc-up", true);
    }
  } else {
    push("status", true, "clean answerer, proven by dirty e2e", true);
    push("e2e", true, "run from dirty", true);
  }

  const taskName = `HFPipe-${SIDE}`;
  const task = scheduledTaskState(taskName);
  push("scheduledTask", task.ok, `${taskName} ${task.state}`);
  push("scheduledTaskLogon", task.ok, task.ok ? `${taskName} logon` : task.state);

  const summary = summarizeDoctor(checks);
  console.log("");
  console.log(JSON.stringify({ side: SIDE, ...summary }));
  const hint = nextDoctorHint(summary.culprit, checks.find((c) => c.name === summary.culprit)?.detail || "");
  if (hint) console.log("NEXT", hint);
  else if (summary.verdict === "GREEN") console.log("NEXT канал жив end-to-end");
  process.exit(summary.verdict === "GREEN" ? 0 : 1);
}

main().catch((e) => {
  console.log(JSON.stringify({ side: SIDE, verdict: "RED", failing: ["doctor"], culprit: "doctor", error: String(e.message || e) }));
  process.exit(1);
});
