import { randomUUID } from "node:crypto";
import {
  handleRtcSignal,
  isRtcUp,
  recycleRtcNow,
  rtcCall,
  rtcSnapshot,
  startRtc,
} from "./rtc-pipe.mjs";

const side = String(process.argv[2] || process.env.HF_SIDE || "").toLowerCase();
if (!["dirty", "clean"].includes(side)) throw new Error("rtc-worker side must be dirty or clean");

const rpcWaiters = new Map();
process.on("disconnect", () => process.exit(7));

function send(message) {
  process.send?.(message);
}

async function parentRpc(frame) {
  const requestId = randomUUID();
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      rpcWaiters.delete(requestId);
      reject(new Error("supervisor rpc timeout"));
    }, 120_000);
    rpcWaiters.set(requestId, { resolve, reject, timer });
    send({ kind: "rpc-request", requestId, frame });
  });
}

process.on("message", (message) => {
  if (message?.kind === "signal") {
    handleRtcSignal(message.frame);
    return;
  }
  if (message?.kind === "recycle") {
    recycleRtcNow().catch((error) => console.error(error));
    return;
  }
  if (message?.kind === "call") {
    rtcCall(message.frame, message.timeoutMs)
      .then((result) => send({ kind: "call-result", requestId: message.requestId, result }))
      .catch((error) =>
        send({ kind: "call-result", requestId: message.requestId, error: error.message || String(error) }),
      );
    return;
  }
  if (message?.kind === "rpc-result") {
    const waiter = rpcWaiters.get(message.requestId);
    if (!waiter) return;
    rpcWaiters.delete(message.requestId);
    clearTimeout(waiter.timer);
    if (message.error) waiter.reject(new Error(message.error));
    else waiter.resolve(message.result);
  }
});

await startRtc({
  side,
  sendSignal: (frame) => send({ kind: "signal", frame }),
  log: (...args) => console.error(new Date().toISOString(), ...args),
  onRpc: side === "clean" ? parentRpc : null,
});

setInterval(() => send({ kind: "status", up: isRtcUp(), snapshot: rtcSnapshot() }), 1000);
send({ kind: "status", up: isRtcUp(), snapshot: rtcSnapshot() });
