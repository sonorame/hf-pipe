import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCleanContextSnapshot,
  buildLabCommand,
  defaultShellCwd,
  formatCleanContext,
  parseHostAliasKeys,
  resolveCleanLayout,
} from "../src/clean-context.mjs";
import { runCleanJob } from "../src/clean-jobs.mjs";
import { HOP_JOBS } from "../src/hop-surface.mjs";

const yaml = `
ssh:
  user: lab
  host_aliases:
    alpha: alpha.example.com
    beta: beta.example.com
`;

const layout = {
  project: "C:\\workspace",
  lab: "C:\\tools\\lab.py",
  labConfig: "C:\\tools\\config.yaml",
};

test("parseHostAliasKeys reads only alias names", () => {
  assert.deepEqual(parseHostAliasKeys(yaml), ["alpha", "beta"]);
});

test("resolveCleanLayout reads env", () => {
  const got = resolveCleanLayout({
    HF_CLEAN_PROJECT: "C:\\workspace",
    HF_LAB_SCRIPT: "C:\\tools\\lab.py",
  });
  assert.equal(got.project, "C:\\workspace");
  assert.equal(got.lab, "C:\\tools\\lab.py");
  assert.match(got.labConfig, /config\.yaml$/);
});

test("formatCleanContext is a host snapshot", () => {
  const text = formatCleanContext({
    host: "remote-1",
    user: "operator",
    project: layout.project,
    lab: layout.lab,
    projectExists: true,
    labExists: true,
    features: ["one", "two"],
    sshAliases: ["alpha", "beta"],
  });
  assert.match(text, /project .* ok/);
  assert.match(text, /features one two/);
  assert.match(text, /ssh_aliases alpha beta/);
  assert.match(text, /clean_lab/);
  assert.equal(text.includes("kilo today"), false);
});

test("formatCleanContext omits kilo block when facet was not requested", () => {
  const text = formatCleanContext({
    host: "remote-1",
    user: "operator",
    project: layout.project,
    lab: layout.lab,
    projectExists: true,
    labExists: true,
    features: ["one"],
    sshAliases: ["alpha"],
  });
  assert.equal(text.includes("kilo today"), false);
  assert.equal(text.includes("kilo thread"), false);
});

test("buildLabCommand uses HF_LAB_SCRIPT", () => {
  const got = buildLabCommand("ssh alpha -- hostname", layout);
  assert.equal(got.ok, true);
  assert.equal(got.cwd, layout.project);
  assert.equal(got.cmd, `python "${layout.lab}" ssh alpha -- hostname`);
});

test("buildLabCommand rejects empty args", () => {
  assert.equal(buildLabCommand("  ", layout).ok, false);
});

test("defaultShellCwd uses project when caller omitted cwd", () => {
  assert.equal(defaultShellCwd(undefined, true, layout), layout.project);
  assert.equal(defaultShellCwd("D:\\tmp", true, layout), "D:\\tmp");
  assert.equal(defaultShellCwd(undefined, false, layout), undefined);
});

const hostIo = {
  layout,
  existsSync: (p) =>
    p === layout.project ||
    p === layout.lab ||
    String(p).endsWith("features") ||
    p === layout.labConfig,
  readdirSync: () => [{ isDirectory: () => true, name: "feature-a" }],
  readFileSync: () => yaml,
  hostname: () => "remote-1",
  username: () => "operator",
};

test("buildCleanContextSnapshot uses injected fs", () => {
  const snap = buildCleanContextSnapshot(hostIo);
  assert.equal(snap.ok, true);
  assert.deepEqual(snap.features, ["feature-a"]);
  assert.deepEqual(snap.sshAliases, ["alpha", "beta"]);
  assert.match(snap.text, /host remote-1/);
});

test("empty context body does not open kilo", () => {
  let called = 0;
  const snap = buildCleanContextSnapshot({
    ...hostIo,
    body: {},
    kiloQueryFn: () => {
      called += 1;
      return [];
    },
  });
  assert.equal(called, 0);
  assert.equal(snap.text.includes("ASSET-AUTH"), false);
  assert.equal(/kilo /m.test(snap.text), false);
  assert.match(snap.text, /host remote-1/);
});

const NOW = Date.parse("2026-09-21T10:00:00+04:00");
const TODAY_SESSION = {
  id: "sess-today",
  title: "ASSET-AUTH: mTLS и relay",
  agent: "kimi",
  model: "Kimi-CLUSTER",
  time_created: Date.parse("2026-09-21T09:02:00+04:00"),
  time_updated: Date.parse("2026-09-21T09:22:00+04:00"),
};

function kiloQueryFrom(sessions, parts) {
  return (kind) => {
    if (kind === "sessions") return sessions;
    if (kind === "parts") return parts;
    if (kind === "thread") return parts;
    return [];
  };
}

test("context kilo=today lists session title and last text", () => {
  const snap = buildCleanContextSnapshot({
    ...hostIo,
    body: { kilo: "today" },
    now: NOW,
    kiloQueryFn: kiloQueryFrom(
      [TODAY_SESSION],
      [
        {
          session_id: "sess-today",
          time_created: Date.parse("2026-09-21T09:22:00+04:00"),
          data: JSON.stringify({ type: "text", text: "продолжи" }),
        },
      ],
    ),
  });
  assert.equal(snap.ok, true);
  assert.match(snap.text, /ASSET-AUTH: mTLS и relay/);
  assert.match(snap.text, /sess-today/);
  assert.match(snap.text, /продолжи/);
  assert.match(snap.text, /Kimi-CLUSTER/);
  assert.match(snap.text, /host remote-1/);
});

test("context kilo keeps today sessions beyond last N", () => {
  const old = [];
  for (let i = 0; i < 12; i += 1) {
    old.push({
      id: `old-${i}`,
      title: `old ${i}`,
      model: "x",
      time_updated: Date.parse("2026-09-20T12:00:00+04:00") - i * 60_000,
    });
  }
  const snap = buildCleanContextSnapshot({
    ...hostIo,
    body: { kilo: "today" },
    now: NOW,
    kiloQueryFn: kiloQueryFrom([TODAY_SESSION, ...old], []),
  });
  assert.match(snap.text, /sess-today/);
  assert.match(snap.text, /old-0/);
  assert.match(snap.text, /old-6/);
  assert.equal(snap.text.includes("old-11"), false);
});

test("context kiloId prints text parts", () => {
  const snap = buildCleanContextSnapshot({
    ...hostIo,
    body: { kiloId: "sess-today" },
    kiloQueryFn: kiloQueryFrom(
      [],
      [
        {
          session_id: "sess-today",
          time_created: Date.parse("2026-09-21T09:02:00+04:00"),
          data: JSON.stringify({ type: "step-start" }),
        },
        {
          session_id: "sess-today",
          time_created: Date.parse("2026-09-21T09:22:00+04:00"),
          data: JSON.stringify({ type: "text", text: "продолжи" }),
        },
      ],
    ),
  });
  assert.equal(snap.ok, true);
  assert.match(snap.text, /kilo thread sess-today/);
  assert.match(snap.text, /продолжи/);
  assert.equal(snap.text.includes("step-start"), false);
});

test("kilo db miss keeps host ok", () => {
  const snap = buildCleanContextSnapshot({
    ...hostIo,
    body: { kilo: "today" },
    kiloQueryFn: () => {
      throw new Error("missing C:\\no-such-kilo.db");
    },
  });
  assert.equal(snap.ok, true);
  assert.match(snap.text, /host remote-1/);
  assert.match(snap.text, /kilo error missing C:\\no-such-kilo.db/);
});

test("context job is still context, not a new hop type", () => {
  assert.equal(HOP_JOBS.includes("context"), true);
  assert.equal(HOP_JOBS.includes("kilo"), false);
});

test("runCleanJob context forwards body and survives missing db", async () => {
  const prev = process.env.HF_KILO_DB;
  process.env.HF_KILO_DB = "C:\\no-such-kilo.db";
  try {
    const one = await runCleanJob({ type: "context", body: { kilo: "today" } });
    assert.equal(one.ok, true);
    assert.match(one.text, /kilo error missing C:\\no-such-kilo.db/);
  } finally {
    if (prev == null) delete process.env.HF_KILO_DB;
    else process.env.HF_KILO_DB = prev;
  }
});

test("dirty MCP puts kilo fields on context rpc body", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const mcp = readFileSync(join(here, "../src/hf-clean-mcp.mjs"), "utf8");
  assert.match(mcp, /kiloId/);
  assert.match(mcp, /rpcAsk\("context", body/);
  const jobs = readFileSync(join(here, "../src/clean-jobs.mjs"), "utf8");
  assert.match(jobs, /buildCleanContextSnapshot\(\{\s*body\s*\}\)/);
});
