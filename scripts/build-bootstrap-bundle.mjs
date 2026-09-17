import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { packRelease } from "../src/release-transfer.mjs";
import { verifyRelease } from "../src/release-runtime.mjs";

const runtimeRoot = process.argv[2];
const archivePath = process.argv[3];
if (!runtimeRoot || !archivePath) {
  console.error("usage: node scripts/build-bootstrap-bundle.mjs <runtime-root> <archive.zip>");
  process.exit(1);
}

const state = JSON.parse(readFileSync(join(runtimeRoot, "state.json"), "utf8"));
if (!state.current) throw new Error("runtime has no current release");
verifyRelease(join(runtimeRoot, "releases", state.current), {
  publicKey: readFileSync(join(runtimeRoot, "release-public.pem"), "utf8"),
});
const stage = join(runtimeRoot, "outgoing", `bootstrap-${state.current}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "releases"), { recursive: true });

for (const name of [
  "bootstrap.mjs",
  "release-runtime.mjs",
  "release-public.pem",
  "supervisor-host.ps1",
  "install-watchdog.ps1",
  "install-watchdog.cmd",
  "start-clean.cmd",
  "start-dirty.cmd",
]) {
  const source = join(runtimeRoot, name);
  if (!existsSync(source)) throw new Error(`bootstrap file missing ${name}`);
  cpSync(source, join(stage, name));
}
cpSync(
  join(runtimeRoot, "releases", state.current),
  join(stage, "releases", state.current),
  { recursive: true },
);
writeFileSync(
  join(stage, "state.json"),
  `${JSON.stringify({ current: state.current, previous: null, bad: [], failures: {} }, null, 2)}\n`,
);

console.log(JSON.stringify({ buildId: state.current, ...packRelease(stage, archivePath) }));
