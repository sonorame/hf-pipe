import assert from "node:assert/strict";
import test from "node:test";
import { createMatrixSdkClientOptions } from "../src/matrix/sdk-client-opts.js";
import { pinnedFetch } from "../src/network-policy.js";

test("SDK client options use pinnedFetch so Matrix HTTP bypasses dead getaddrinfo", () => {
  const opts = createMatrixSdkClientOptions({
    baseUrl: "https://mtx-1.zala-soft.com",
    userId: "@kirill:mtx-1.zala-soft.com",
    deviceId: "DEVICE1",
    cryptoCallbacks: {},
  });

  assert.equal(opts.baseUrl, "https://mtx-1.zala-soft.com");
  assert.equal(opts.userId, "@kirill:mtx-1.zala-soft.com");
  assert.equal(opts.deviceId, "DEVICE1");
  assert.equal(typeof opts.fetchFn, "function");
  assert.equal(opts.fetchFn, pinnedFetch);
});

test("SDK client options omit deviceId when it is empty", () => {
  const opts = createMatrixSdkClientOptions({
    baseUrl: "https://example.org",
    userId: "@a:example.org",
    cryptoCallbacks: {},
  });

  assert.equal("deviceId" in opts, false);
  assert.equal(opts.fetchFn, pinnedFetch);
});
