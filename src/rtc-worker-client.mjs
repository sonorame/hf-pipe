import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";

export function createRtcWorkerClient(options) {
  let child = options.child;
  let snapshot = {};
  let ready = false;
  const pending = new Map();
  const timeoutDefault = Number(options.timeoutMs || 20_000);

  const rejectPending = (reason) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    pending.clear();
  };

  const onMessage = (message) => {
    if (message?.kind === "status") {
      snapshot = message.snapshot || {};
      ready = message.up === true && snapshot.dc === "open";
      snapshot = { ...snapshot, rtc: ready };
      options.onStatus?.(snapshot);
      return;
    }
    if (message?.kind === "signal") {
      Promise.resolve(options.onSignal?.(message.frame)).catch((error) =>
        options.log?.("rtc worker signal", error.message || error),
      );
      return;
    }
    if (message?.kind === "call-result") {
      const waiter = pending.get(message.requestId);
      if (!waiter) return;
      pending.delete(message.requestId);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error));
      else waiter.resolve(message.result);
      return;
    }
    if (message?.kind === "rpc-request") {
      Promise.resolve(options.onRpc?.(message.frame))
        .then((result) => child.send({ kind: "rpc-result", requestId: message.requestId, result }))
        .catch((error) =>
          child.send({ kind: "rpc-result", requestId: message.requestId, error: error.message || String(error) }),
        );
    }
  };

  child.on("message", onMessage);
  child.on("exit", () => {
    snapshot = {};
    ready = false;
    rejectPending("rtc worker exited");
  });

  return {
    isRtcUp: () => ready,
    rtcSnapshot: () => ({ ...snapshot }),
    handleRtcSignal(frame) {
      child.send({ kind: "signal", frame });
    },
    recycleRtcNow() {
      child.send({ kind: "recycle" });
      return { ok: true, action: "recycle" };
    },
    rtcCall(frame, timeoutMs = timeoutDefault) {
      const requestId = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`rtc call timeout ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        child.send({ kind: "call", requestId, frame, timeoutMs });
      });
    },
    close() {
      ready = false;
      snapshot = {};
      rejectPending("rtc worker closed");
      child.kill();
    },
  };
}

export function spawnRtcWorker(options) {
  let client = null;
  let stopped = false;
  let snapshot = {};

  const start = () => {
    if (stopped) return;
    const child = fork(options.entry, [options.side], {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      windowsHide: true,
    });
    client = createRtcWorkerClient({
      child,
      onSignal: options.onSignal,
      onRpc: options.onRpc,
      onStatus: (next) => {
        snapshot = next;
        options.onStatus?.(next);
      },
      log: options.log,
    });
    child.on("exit", (code, signal) => {
      snapshot = {};
      options.log?.("rtc worker exited", code ?? signal);
      if (!stopped) setTimeout(start, 4000);
    });
  };
  start();

  return {
    isRtcUp: () => client?.isRtcUp() === true,
    rtcSnapshot: () => ({ ...snapshot }),
    handleRtcSignal: (frame) => client?.handleRtcSignal(frame),
    rtcCall: (frame, timeout) => {
      if (!client) return Promise.reject(new Error("rtc worker unavailable"));
      return client.rtcCall(frame, timeout);
    },
    recycleRtcNow: () => client?.recycleRtcNow() || { ok: false, error: "rtc worker unavailable" },
    close() {
      stopped = true;
      client?.close();
    },
  };
}
