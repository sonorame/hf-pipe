import http from "node:http";
import { createSoakTracker, shouldContinueSoak } from "../src/soak-policy.mjs";

const durationMs = Number(process.env.HF_SOAK_MS || 60 * 60 * 1000);
const intervalMs = Number(process.env.HF_SOAK_INTERVAL_MS || 5000);
const tracker = createSoakTracker({ maxOutageMs: 180_000 });
const endAt = Date.now() + durationMs;
let pings = 0;
let pingFailures = 0;
let lastPingAt = 0;
let lastLogAt = 0;
let lastRtc = null;

function request(method, port, path, body, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": data.length }
          : undefined,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode || 500) >= 400) reject(new Error(`${method} ${path} ${res.statusCode} ${text}`));
          else resolve(JSON.parse(text));
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`${method} ${path} timeout`)));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

while (shouldContinueSoak(Date.now(), endAt, tracker.summary())) {
  const board = await request("GET", 18764, "/status");
  const local = board.report?.local || {};
  const peer = board.report?.peer || {};
  const state = {
    rtc: Boolean(local.rtc),
    buildId: local.buildId || board.bootstrap?.current,
    peerBuildId: peer.buildId,
    matrixSyncAgeMs: local.matrixSyncAgeMs,
    peerReceivedAt: peer.receivedAt,
  };
  if (state.rtc && Date.now() - lastPingAt >= 15_000) {
    try {
      const ping = await request("POST", 18765, "/ask", {
        id: `soak-${Date.now()}`,
        type: "ping",
        body: {},
      });
      if (!ping.ok || !ping.body?.host) throw new Error("end-to-end soak ping failed");
      pings += 1;
      lastPingAt = Date.now();
    } catch (error) {
      pingFailures += 1;
      state.rtc = false;
      state.failure = error.message || String(error);
      console.log(JSON.stringify({ at: new Date().toISOString(), event: "ping-failed", ...state }));
    }
  }
  tracker.observe(state);
  if (lastRtc !== state.rtc || Date.now() - lastLogAt >= 60_000) {
    console.log(JSON.stringify({ at: new Date().toISOString(), ...state, pings }));
    lastRtc = state.rtc;
    lastLogAt = Date.now();
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

console.log(JSON.stringify({ ok: true, pings, pingFailures, ...tracker.summary() }));
