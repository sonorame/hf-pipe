import assert from "node:assert/strict";
import dns from "node:dns";
import net from "node:net";
import test from "node:test";
import {
  applyNodeNetworkPolicy,
  PINNED_A,
  pinnedFetch,
  pinHost,
} from "../src/network-policy.js";

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
