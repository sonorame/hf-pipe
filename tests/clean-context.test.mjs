import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCleanContextSnapshot,
  buildLabCommand,
  defaultShellCwd,
  formatCleanContext,
  parseHostAliasKeys,
  resolveCleanLayout,
} from "../src/clean-context.mjs";

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

test("buildCleanContextSnapshot uses injected fs", () => {
  const snap = buildCleanContextSnapshot({
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
  });
  assert.equal(snap.ok, true);
  assert.deepEqual(snap.features, ["feature-a"]);
  assert.deepEqual(snap.sshAliases, ["alpha", "beta"]);
  assert.match(snap.text, /host remote-1/);
});
