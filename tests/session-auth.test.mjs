import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadSessionRefreshToken, protectSessionRefreshToken, refreshSession, sessionNeedsRefresh } from "../src/session-auth.mjs";

test("Matrix session refresh is due before the access token expires", () => {
  assert.equal(sessionNeedsRefresh({ expires_at: 1_060_001 }, 1_000_000), false);
  assert.equal(sessionNeedsRefresh({ expires_at: 1_060_000 }, 1_000_000), true);
  assert.equal(sessionNeedsRefresh({ expires_at: 999_999 }, 1_000_000), true);
  assert.equal(sessionNeedsRefresh({}, 1_000_000), false);
});

test("Android Matrix session survives a process restart without Windows DPAPI", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-android-session-"));
  t.after(() => {
    assert.ok(dir.startsWith(join(tmpdir(), "hf-android-session-")));
    rmSync(dir, { recursive: true, force: true });
  });
  const authUrl = new URL("../src/session-auth.mjs", import.meta.url).href;
  const setup = `
    import assert from 'node:assert/strict';
    import { readFileSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    Object.defineProperty(process, 'platform', { value: 'android' });
    const { protectSessionRefreshToken, loadSessionRefreshToken } = await import(${JSON.stringify(authUrl)});
    const dir = process.argv[1];
    const path = join(dir, 'matrix-session.json');
  `;
  for (const operation of [
    `writeFileSync(path, JSON.stringify(protectSessionRefreshToken({ access_token: 'access-1', refresh_token: 'refresh-1' }, dir)), { mode: 0o600 });`,
    `const session = JSON.parse(readFileSync(path, 'utf8'));
     assert.equal(session.access_token, 'access-1');
     assert.equal(loadSessionRefreshToken(session, dir), 'refresh-1');`,
  ]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", setup + operation, dir], {
      encoding: "utf8", windowsHide: true,
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
  }
});

test("refresh token is DPAPI protected and removed from session json", { skip: process.platform !== "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-refresh-"));
  const session = protectSessionRefreshToken({ refresh_token: "refresh-secret" }, dir);
  assert.equal(session.refresh_token, undefined);
  assert.equal(session.refresh_token_dpapi, "matrix-refresh.dpapi");
  assert.notEqual(readFileSync(join(dir, "matrix-refresh.dpapi"), "utf8"), "refresh-secret");
});

test("Android session refresh rotates tokens and remains readable after restart", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-android-refresh-"));
  t.after(() => {
    assert.ok(dir.startsWith(join(tmpdir(), "hf-android-refresh-")));
    rmSync(dir, { recursive: true, force: true });
  });
  const authUrl = new URL("../src/session-auth.mjs", import.meta.url).href;
  const setup = `
    import assert from 'node:assert/strict';
    import { readFileSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    Object.defineProperty(process, 'platform', { value: 'android' });
    const { protectSessionRefreshToken, loadSessionRefreshToken, refreshSession } = await import(${JSON.stringify(authUrl)});
    const dir = process.argv[1];
    const path = join(dir, 'matrix-session.json');
  `;
  for (const operation of [
    `const session = protectSessionRefreshToken({ token_endpoint: 'https://issuer/token', client_id: 'phone', access_token: 'expired', refresh_token: 'refresh-1' }, dir);
     const next = await refreshSession(session, { secretsDir: dir, fetchFn: async (url, init) => {
       assert.equal(url, 'https://issuer/token');
       assert.equal(new URLSearchParams(init.body).get('refresh_token'), 'refresh-1');
       return new Response(JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }));
     }});
     writeFileSync(path, JSON.stringify(next), { mode: 0o600 });`,
    `const session = JSON.parse(readFileSync(path, 'utf8'));
     assert.equal(session.access_token, 'access-2');
     assert.equal(loadSessionRefreshToken(session, dir), 'refresh-2');`,
  ]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", setup + operation, dir], {
      encoding: "utf8", windowsHide: true,
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
  }
});

test("expired access token refreshes through the configured OIDC endpoint", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-oidc-refresh-"));
  t.after(() => {
    assert.ok(dir.startsWith(join(tmpdir(), "hf-oidc-refresh-")));
    rmSync(dir, { recursive: true, force: true });
  });
  const calls = [];
  const session = {
    token_endpoint: "https://issuer/token",
    client_id: "client-1",
    access_token: "old",
    refresh_token: "refresh-secret",
  };
  const next = await refreshSession(session, {
    secretsDir: dir,
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ access_token: "new", refresh_token: "next-refresh", expires_in: 3600 }),
        { status: 200 },
      );
    },
  });
  assert.equal(next.access_token, "new");
  assert.equal(loadSessionRefreshToken(next, dir), "next-refresh");
  assert.match(calls[0].init.body, /grant_type=refresh_token/);
});
