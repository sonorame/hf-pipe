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

test("Codex inference, authentication and extension download hosts allowed", () => {
  for (const host of ["chatgpt.com", "auth.openai.com", "api.openai.com", "cdn.oaistatic.com", "files.oaiusercontent.com", "marketplace.visualstudio.com", "openai.gallerycdn.vsassets.io"]) {
    assert.equal(hostAllowed(host), true, host);
  }
});

test("Codex lookalike domains and IP destinations remain denied", () => {
  for (const host of ["evilopenai.com", "chatgpt.com.example.org", "127.0.0.1", "10.5.20.126", "marketplace.visualstudio.com.evil.org"]) {
    assert.equal(hostAllowed(host), false, host);
  }
});
