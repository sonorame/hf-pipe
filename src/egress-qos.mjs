export function createQosQueue() {
  const rpc = [];
  const stream = [];
  let flushing = false;
  const waiters = [];
  return {
    pushRpc(job) {
      rpc.push(job);
    },
    pushStream(job) {
      stream.push(job);
    },
    async flush() {
      if (flushing) {
        await new Promise((resolve) => waiters.push(resolve));
        return this.flush();
      }
      flushing = true;
      try {
        while (rpc.length || stream.length) {
          const job = rpc.length ? rpc.shift() : stream.shift();
          await job();
        }
      } finally {
        flushing = false;
        const queued = waiters.splice(0);
        for (const resolve of queued) resolve();
      }
    },
  };
}
