import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  applyCursorEgressConfig,
  firewallSpec,
  mergeCursorSettings,
  revertCursorEgressConfig,
  shortcutArgs,
} from "../src/cursor-proxy-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("merge keeps comments and only proxy keys", () => {
  const raw = `{
  // keep me
  "editor.fontSize": 14
}
`;
  const merged = mergeCursorSettings(raw, 18766);
  assert.match(merged, /keep me/);
  assert.match(merged, /"editor.fontSize": 14/);
  assert.match(merged, /"http.proxy": "http:\/\/127.0.0.1:18766"/);
  assert.match(merged, /"http.proxySupport": "override"/);
  assert.match(merged, /"cursor.general.disableHttp2": true/);
});

test("apply refuses a running Cursor and revert strips hop keys", () => {
  assert.deepEqual(shortcutArgs(18766), ["--proxy-server=http://127.0.0.1:18766"]);
  assert.throws(
    () => applyCursorEgressConfig({ cursorRunning: () => true, cursorExe: "C:\\\\Cursor.exe" }),
    /close Cursor/,
  );
  let stored = `{
  "editor.fontSize": 14
}
`;
  const applied = applyCursorEgressConfig({
    cursorRunning: () => false,
    cursorExe: "C:\\\\Cursor.exe",
    port: 18766,
    readSettings: () => stored,
    writeSettings: (next) => {
      stored = next;
    },
  });
  assert.match(stored, /http.proxy/);
  assert.equal(applied.shortcut.args.includes("--proxy-server=http://127.0.0.1:18766"), true);
  const v4 = applied.firewall.find((rule) => rule.name === "HFPipe-Cursor-block-out-v4");
  assert.deepEqual(v4.remote, ["0.0.0.0-126.255.255.255", "128.0.0.0-255.255.255.255"]);
  const reverted = revertCursorEgressConfig({
    cursorExe: "C:\\\\Cursor.exe",
    readSettings: () => stored,
    writeSettings: (next) => {
      stored = next;
    },
  });
  assert.doesNotMatch(stored, /http.proxy/);
  assert.match(stored, /editor.fontSize/);
  assert.ok(reverted.firewallNames.includes("HFPipe-Cursor-block-out-v4"));
  assert.ok(firewallSpec("C:\\\\Cursor.exe").some((rule) => rule.ipv6 && rule.action === "block"));
});

test("install-watchdog applies Cursor proxy once, task-host does not rewrite settings", () => {
  const watchdog = readFileSync(join(here, "../src/install-watchdog.ps1"), "utf8");
  const host = readFileSync(join(here, "../src/task-host.ps1"), "utf8");
  assert.match(watchdog, /cursor-egress-apply/);
  assert.doesNotMatch(host, /settings\.json/);
  assert.doesNotMatch(host, /cursor-egress-apply/);
});
