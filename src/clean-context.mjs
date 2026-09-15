import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import os from "os";

const DEFAULT_PROJECT = "C:\\Users\\Kirill\\Desktop\\projects\\SA";
const DEFAULT_LAB = "C:\\Users\\Kirill\\Desktop\\projects\\cursor_skills_rules\\lab\\lab.py";

export function resolveCleanLayout(env = process.env) {
  const project = String(env.HF_CLEAN_PROJECT || DEFAULT_PROJECT).trim();
  const lab = String(env.HF_LAB_SCRIPT || DEFAULT_LAB).trim();
  const labConfig =
    String(env.HF_LAB_CONFIG || "").trim() || (lab ? join(dirname(lab), "config.yaml") : "");
  return { project, lab, labConfig };
}

export function parseHostAliasKeys(yamlText) {
  const m = String(yamlText || "").match(/host_aliases:\s*\r?\n((?:[ \t]+[^\n]*\r?\n?)*)/);
  if (!m) return [];
  const keys = [];
  for (const line of m[1].split(/\r?\n/)) {
    const hit = line.match(/^\s+([A-Za-z0-9_.-]+)\s*:/);
    if (hit) keys.push(hit[1]);
  }
  return keys;
}

export function formatCleanContext(snap) {
  const projectMark = snap.projectExists ? "ok" : snap.project ? "MISSING" : "unset";
  const labMark = snap.labExists ? "ok" : snap.lab ? "MISSING" : "unset";
  const features = (snap.features || []).join(" ") || "(none)";
  const aliases = (snap.sshAliases || []).join(" ") || "(none)";
  return [
    `host ${snap.host || "?"}`,
    `user ${snap.user || "?"}`,
    `project ${snap.project || "(HF_CLEAN_PROJECT unset)"} ${projectMark}`,
    `lab ${snap.lab || "(HF_LAB_SCRIPT unset)"} ${labMark}`,
    `features ${features}`,
    `ssh_aliases ${aliases}`,
    "hop dirty-mcp -> webrtc -> clean host",
    "files: clean_read / clean_grep / clean_glob / clean_write",
    "helper: clean_lab if HF_LAB_SCRIPT is set",
  ].join("\n");
}

export function buildLabCommand(args, layout = resolveCleanLayout()) {
  const trimmed = String(args || "").trim();
  if (!trimmed) return { ok: false, error: "lab args empty" };
  if (!layout.lab) return { ok: false, error: "HF_LAB_SCRIPT is not set" };
  return { ok: true, cmd: `python "${layout.lab}" ${trimmed}`, cwd: layout.project || undefined };
}

export function defaultShellCwd(cwd, projectExists, layout = resolveCleanLayout()) {
  if (cwd) return cwd;
  const exists =
    projectExists == null ? Boolean(layout.project && existsSync(layout.project)) : projectExists;
  if (exists && layout.project) return layout.project;
  return undefined;
}

export function buildCleanContextSnapshot(io = {}) {
  const layout = io.layout || resolveCleanLayout(io.env || process.env);
  const exists = io.existsSync || existsSync;
  const readDir = io.readdirSync || readdirSync;
  const readFile = io.readFileSync || readFileSync;
  const hostname = io.hostname || (() => os.hostname());
  const username = io.username || (() => os.userInfo().username);
  const projectExists = Boolean(layout.project) && exists(layout.project);
  const labExists = Boolean(layout.lab) && exists(layout.lab);
  const featuresDir = layout.project ? join(layout.project, "features") : "";
  let features = [];
  if (projectExists && featuresDir && exists(featuresDir)) {
    try {
      features = readDir(featuresDir, { withFileTypes: true })
        .filter((ent) => ent.isDirectory() && !String(ent.name).startsWith("_"))
        .map((ent) => ent.name)
        .sort();
    } catch {
      features = [];
    }
  }
  let sshAliases = [];
  if (layout.labConfig && exists(layout.labConfig)) {
    try {
      sshAliases = parseHostAliasKeys(readFile(layout.labConfig, "utf8"));
    } catch {
      sshAliases = [];
    }
  }
  const snap = {
    host: hostname(),
    user: username(),
    project: layout.project,
    lab: layout.lab,
    projectExists,
    labExists,
    features,
    sshAliases,
  };
  return { ok: true, ...snap, text: formatCleanContext(snap) };
}
