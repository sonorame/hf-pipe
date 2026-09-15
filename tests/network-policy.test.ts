import assert from "node:assert/strict";
import dns from "node:dns";
import net from "node:net";
import test from "node:test";
import {
  applyNodeNetworkPolicy,
  PINNED_A,
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
