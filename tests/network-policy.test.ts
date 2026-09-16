import assert from "node:assert/strict";
import dns from "node:dns";
import net from "node:net";
import test from "node:test";
import {
  applyNodeNetworkPolicy,
  CONNECT_TIMEOUT_MS,
  hopDispatcherReady,
  hopRetryAgentOptions,
  hopUndiciAgentOptions,
  createHopDispatcher,
  loadDnsPinsFromEnv,
  loadUndici,
  PINNED_A,
  pinnedFetch,
  pinHost,
  pinnedLookup,
} from "../src/network-policy.js";

test("DNS pins come from HF_DNS_PIN, not a baked-in lab host", () => {
  assert.equal(Object.prototype.hasOwnProperty.call(PINNED_A, "mtx-1.zala-soft.com"), false);
  const prev = process.env.HF_DNS_PIN;
  process.env.HF_DNS_PIN = "pin.example=10.1.2.3";
  try {
    loadDnsPinsFromEnv();
    assert.equal(PINNED_A["pin.example"], "10.1.2.3");
  } finally {
    delete PINNED_A["pin.example"];
    if (prev == null) delete process.env.HF_DNS_PIN;
    else process.env.HF_DNS_PIN = prev;
  }
});

test("process policy prefers IPv4 lookup order and keeps Happy Eyeballs", () => {
  const prevOrder = dns.getDefaultResultOrder();
  const prevFamily = net.getDefaultAutoSelectFamily();
  const prevTimeout = net.getDefaultAutoSelectFamilyAttemptTimeout();
  try {
    applyNodeNetworkPolicy();
    assert.equal(dns.getDefaultResultOrder(), "ipv4first");
    assert.equal(net.getDefaultAutoSelectFamily(), true);
    assert.ok(net.getDefaultAutoSelectFamilyAttemptTimeout() >= 250);
  } finally {
    dns.setDefaultResultOrder(prevOrder);
    net.setDefaultAutoSelectFamily(prevFamily);
    net.setDefaultAutoSelectFamilyAttemptTimeout(prevTimeout);
  }
});

test("pinned A answers lookup when getaddrinfo cannot resolve the name", async () => {
  applyNodeNetworkPolicy();
  PINNED_A["hf-pin.invalid"] = "10.20.30.40";
  try {
    const looked = await dns.promises.lookup("hf-pin.invalid");
    assert.equal(looked.address, "10.20.30.40");
    assert.equal(looked.family, 4);
  } finally {
    delete PINNED_A["hf-pin.invalid"];
  }
});

test("undici connect waits longer than the default 10s so a slow mtx-1 handshake can finish", () => {
  assert.ok(CONNECT_TIMEOUT_MS > 10_000);
  const opts = hopUndiciAgentOptions(pinnedLookup);
  assert.equal(opts.connectTimeout, CONNECT_TIMEOUT_MS);
  assert.equal(opts.connect.timeout, CONNECT_TIMEOUT_MS);
  assert.equal(opts.connect.lookup, pinnedLookup);
  assert.equal("family" in opts.connect, false);
});

test("undici agent reuses one TCP and keep-alive longer than hop sync poll", () => {
  const opts = hopUndiciAgentOptions(pinnedLookup);
  assert.equal(opts.connections, 1);
  assert.ok(opts.keepAliveTimeout > 10_000);
  assert.ok(opts.keepAliveMaxTimeout >= opts.keepAliveTimeout);
});

test("loadUndici loads the npm undici package with Agent and fetch", () => {
  const undici = loadUndici();
  assert.equal(typeof undici.Agent, "function");
  assert.equal(typeof undici.RetryAgent, "function");
  assert.equal(typeof undici.fetch, "function");
  assert.equal(typeof undici.setGlobalDispatcher, "function");
});

test("hop retry policy retries connect ETIMEDOUT on POST for minutes", () => {
  const opts = hopRetryAgentOptions();
  assert.equal(opts.errorCodes.includes("ETIMEDOUT"), true);
  assert.equal(opts.errorCodes.includes("UND_ERR_CONNECT_TIMEOUT"), true);
  assert.equal(opts.methods.includes("POST"), true);
  assert.ok(opts.maxRetries * CONNECT_TIMEOUT_MS >= 60_000);
});

test("createHopDispatcher is a RetryAgent so connect ETIMEDOUT is retried", () => {
  const undici = loadUndici();
  assert.equal(typeof undici.RetryAgent, "function");
  const dispatcher = createHopDispatcher();
  assert.equal(dispatcher instanceof undici.RetryAgent, true);
});

test("RetryAgent with hop retry options retries POST after ETIMEDOUT", async () => {
  const undici = loadUndici();
  let attempts = 0;
  class FailThenOk extends undici.Dispatcher {
    dispatch(opts, handler) {
      attempts += 1;
      queueMicrotask(() => {
        if (attempts === 1) {
          const err = Object.assign(new Error("connect ETIMEDOUT 127.0.0.1:443"), {
            code: "ETIMEDOUT",
          });
          handler.onResponseError({}, err);
          return;
        }
        handler.onRequestStart?.({}, {});
        handler.onResponseStart({}, 200, { "content-type": "text/plain" }, "OK");
        handler.onResponseData?.({}, Buffer.from("ok"));
        handler.onResponseEnd({}, {});
      });
      return true;
    }
    close() {
      return Promise.resolve();
    }
    destroy() {
      return Promise.resolve();
    }
  }
  const retry = new undici.RetryAgent(new FailThenOk(), {
    ...hopRetryAgentOptions(),
    minTimeout: 1,
    maxTimeout: 10,
    maxRetries: 3,
  });
  const res = await retry.request({
    origin: "http://hf-retry.test",
    path: "/_matrix/client/v3/login",
    method: "POST",
    body: "{}",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(attempts, 2);
  await res.body.dump();
});

test("applyNodeNetworkPolicy installs the undici dispatcher instead of the 10s default fetch", () => {
  applyNodeNetworkPolicy();
  assert.equal(hopDispatcherReady(), true);
  const undici = loadUndici();
  assert.equal(typeof undici.Agent, "function");
});

test("pinnedFetch reaches a pinned hostname without OS DNS", async () => {
  applyNodeNetworkPolicy();
  const http = await import("node:http");
  const server = http.createServer((req, res) => {
    res.end("pin-ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  pinHost("hf-local-pin.test", "127.0.0.1");
  try {
    const res = await pinnedFetch(`http://hf-local-pin.test:${port}/`);
    assert.equal(res.ok, true);
    assert.equal(await res.text(), "pin-ok");
  } finally {
    delete PINNED_A["hf-local-pin.test"];
    await new Promise((resolve) => server.close(resolve));
  }
});
