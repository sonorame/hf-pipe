import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dst = process.argv[2];
if (!dst) {
  console.error("usage: node scripts/sync-live-dirty.mjs <live-dir>");
  process.exit(1);
}

function cp(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

const hopDist = [
  "secrets-path",
  "hop-board",
  "hop-log",
  "rtc-retry",
  "doctor",
  "hop-heartbeat",
  "hop-instance",
  "hop-up-state",
  "hop-client-mode",
  "network-policy",
  "peer-device",
  "error-chain",
  "watchdog-clock",
];
for (const name of hopDist) {
  for (const ext of [".js", ".d.ts", ".js.map"]) {
    const from = join(root, "dist", name + ext);
    if (existsSync(from)) cp(from, join(dst, "dist", name + ext));
  }
}
for (const name of ["client", "sdk-client-opts"]) {
  for (const ext of [".js", ".d.ts", ".js.map"]) {
    const from = join(root, "dist", "matrix", name + ext);
    if (existsSync(from)) cp(from, join(dst, "dist", "matrix", name + ext));
  }
}

const tsHop = [
  "secrets-path.ts",
  "hop-board.ts",
  "hop-log.ts",
  "rtc-retry.ts",
  "doctor.ts",
  "hop-heartbeat.ts",
  "hop-instance.ts",
  "hop-up-state.ts",
  "hop-client-mode.ts",
  "network-policy.ts",
  "peer-device.ts",
  "error-chain.ts",
  "watchdog-clock.ts",
];
for (const f of tsHop) cp(join(root, "src", f), join(dst, "src", f));
cp(join(root, "src", "matrix", "client.ts"), join(dst, "src", "matrix", "client.ts"));
cp(join(root, "src", "matrix", "sdk-client-opts.ts"), join(dst, "src", "matrix", "sdk-client-opts.ts"));

function copyRewrite(name) {
  const text = readFileSync(join(root, "src", name), "utf8").replaceAll("../dist/", "./dist/");
  writeFileSync(join(dst, name), text);
}
for (const n of ["index.mjs", "rtc-pipe.mjs", "config.mjs", "hop-doctor.mjs", "login.mjs", "hop-surface.mjs"]) {
  copyRewrite(n);
}
for (const n of ["keep-loop.mjs", "keep.js", "install-watchdog.cmd", "install-watchdog.ps1", "ensure-hop-dist.mjs"]) {
  cp(join(root, "src", n), join(dst, n));
}
console.log("synced", dst);
