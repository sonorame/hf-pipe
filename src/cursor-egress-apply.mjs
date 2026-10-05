import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  applyCursorEgressConfig,
  egressPort,
  revertCursorEgressConfig,
} from "./cursor-proxy-config.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export function defaultCursorExe() {
  const home = process.env.USERPROFILE || homedir();
  const cands = [
    process.env.HF_CURSOR_EXE,
    join(home, "AppData", "Local", "Programs", "cursor", "Cursor.exe"),
    join(home, "AppData", "Local", "Programs", "Cursor", "Cursor.exe"),
  ].filter(Boolean);
  return cands.find((path) => existsSync(path)) || cands[1];
}

export function defaultSettingsPath() {
  const home = process.env.USERPROFILE || homedir();
  return (
    process.env.HF_CURSOR_SETTINGS ||
    join(home, "AppData", "Roaming", "Cursor", "User", "settings.json")
  );
}

export function cursorIsRunning() {
  const result = spawnSync("tasklist", ["/FI", "IMAGENAME eq Cursor.exe", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return /Cursor\.exe/i.test(String(result.stdout || ""));
}

function runFirewall(mode, cursorExe) {
  const script = join(here, "cursor-egress.ps1");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Mode", mode, "-CursorExe", cursorExe],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || "firewall failed").trim() || "firewall failed");
  }
}

function writeShortcut(spec) {
  const desktop = join(process.env.USERPROFILE || homedir(), "Desktop", spec.name);
  const ps = `
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut(${JSON.stringify(desktop)})
$s.TargetPath = ${JSON.stringify(spec.target)}
$s.Arguments = ${JSON.stringify(spec.args)}
$s.WorkingDirectory = ${JSON.stringify(dirname(spec.target))}
$s.Save()
`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || "shortcut failed").trim());
}

function removeShortcut(name) {
  const desktop = join(process.env.USERPROFILE || homedir(), "Desktop", name);
  spawnSync("powershell.exe", ["-NoProfile", "-Command", `Remove-Item -LiteralPath ${JSON.stringify(desktop)} -Force -ErrorAction SilentlyContinue`], {
    windowsHide: true,
  });
}

const mode = process.argv[2] || "--install";
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const cursorExe = defaultCursorExe();
  const settingsPath = defaultSettingsPath();
  const io = {
    cursorExe,
    cursorRunning: cursorIsRunning,
    readSettings: () => (existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : ""),
    writeSettings: (text) => {
      writeFileSync(settingsPath, text);
    },
    port: egressPort(),
  };
  if (mode === "--uninstall") {
    const reverted = revertCursorEgressConfig(io);
    runFirewall("uninstall", cursorExe);
    removeShortcut(reverted.shortcutName);
    console.log("ok cursor egress removed");
  } else {
    const applied = applyCursorEgressConfig(io);
    writeShortcut(applied.shortcut);
    runFirewall("install", cursorExe);
    console.log("ok cursor egress", applied.port);
  }
}
