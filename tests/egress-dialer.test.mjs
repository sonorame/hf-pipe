import assert from "node:assert/strict";
import test from "node:test";
import { hostAllowed } from "../src/egress-dialer.mjs";

test("cursor cloud hosts allowed", () => {
  assert.equal(hostAllowed("api2.cursor.sh"), true);
  assert.equal(hostAllowed("www.cursor.com"), true);
  assert.equal(hostAllowed("marketplace.cursorapi.com"), true);
  assert.equal(hostAllowed("cursor.com"), true);
});

test("unrelated hosts denied", () => {
  assert.equal(hostAllowed("example.com"), false);
  assert.equal(hostAllowed("facebook.com"), false);
  assert.equal(hostAllowed(""), false);
});
