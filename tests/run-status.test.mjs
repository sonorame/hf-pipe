import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("development supervisor exposes the clean process status for the existing tray", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hf-run-status-"));
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../scripts/run.mjs", import.meta.url)), "clean", "--once"], {
    env: { ...process.env, HF_ENV_FILE: "", HF_RUNTIME_ROOT: dir, HF_SECRETS_DIR: join(dir, "secrets"), MATRIX_SESSION_FILE: join(dir, "secrets/session.json"), HF_LOCAL_DIR: join(dir, "local"), HF_SUPERVISOR_PORT: String(port), HF_PROTOCOL_VERSION: "3" },
    stdio: "ignore", windowsHide: true,
  });
  t.after(() => {
    child.kill();
    try {
      const pid = Number(readFileSync(join(dir, "run/hf-clean.pid"), "utf8"));
      if (pid > 0) process.kill(pid);
    } catch {}
    assert.ok(dir.startsWith(join(tmpdir(), "hf-run-status-")));
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  let status;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(500) });
      status = await response.json();
      if (status.report) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(status?.bootstrap?.side, "clean", "tray must have a local clean status endpoint");
  assert.equal(status.report.protocolVersion, 3);
  assert.ok(status.report.pid > 0);
  const details = await fetch(`http://127.0.0.1:${port}/`);
  assert.match(await details.text(), /<html/i);
});
