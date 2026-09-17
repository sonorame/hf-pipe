import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { protectSessionRefreshToken, refreshSession } from "../src/session-auth.mjs";

test("refresh token is DPAPI protected and removed from session json", { skip: process.platform !== "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-refresh-"));
  const session = protectSessionRefreshToken({ refresh_token: "refresh-secret" }, dir);
  assert.equal(session.refresh_token, undefined);
  assert.equal(session.refresh_token_dpapi, "matrix-refresh.dpapi");
  assert.notEqual(readFileSync(join(dir, "matrix-refresh.dpapi"), "utf8"), "refresh-secret");
});

test("expired access token refreshes through the configured OIDC endpoint", async () => {
  const calls = [];
  const session = {
    token_endpoint: "https://issuer/token",
    client_id: "client-1",
    access_token: "old",
    refresh_token: "refresh-secret",
  };
  const next = await refreshSession(session, {
    loadRefreshToken: () => "refresh-secret",
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ access_token: "new", refresh_token: "next-refresh", expires_in: 3600 }),
        { status: 200 },
      );
    },
    protectRefreshToken: () => "matrix-refresh.dpapi",
  });
  assert.equal(next.access_token, "new");
  assert.equal(next.refresh_token, undefined);
  assert.equal(next.refresh_token_dpapi, "matrix-refresh.dpapi");
  assert.match(calls[0].init.body, /grant_type=refresh_token/);
});
