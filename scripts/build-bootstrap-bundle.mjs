import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { packRelease } from "../src/release-transfer.mjs";
import { buildReleaseManifest, verifyRelease } from "../src/release-runtime.mjs";
import { ensureReleaseKeyPair, loadPrivateKey } from "../src/release-key.mjs";

export function buildBootstrapBundle(options) {
const runtimeRoot = options.runtimeRoot;
const archivePath = options.archivePath;

if (!runtimeRoot) throw new Error("runtimeRoot is required");
if (!options.privateKey) throw new Error("A bootstrap bundle must be signed with the current release key");

const state = JSON.parse(readFileSync(join(runtimeRoot, "state.json"), "utf8"));
if (!state.current) throw new Error("runtime has no current release");
const releaseManifest = verifyRelease(join(runtimeRoot, "releases", state.current), {
  publicKey: readFileSync(join(runtimeRoot, "release-public.pem"), "utf8"),
});
const stage = join(runtimeRoot, "outgoing", `bootstrap-${state.current}`);
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "releases"), { recursive: true });

for (const name of [
  "bootstrap.mjs",
  "operational-board.mjs",
  "start-hop.vbs",
  "protocol-version.mjs",
  "release-runtime.mjs",
  "tray-status.mjs",
  "release-public.pem",
  "process-job.ps1",
  "task-host.ps1",
  "supervisor-host.ps1",
  "tray-viewer.ps1",
  "install-watchdog.ps1",
  "install-watchdog.cmd",
  "start-clean.cmd",
  "start-dirty.cmd",
  "cursor-egress.ps1",
  "cursor-egress-apply.mjs",
  "cursor-proxy-config.mjs",
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

if (options.nodePath) cpSync(options.nodePath, join(stage, "node.exe"));
if (options.privateKey) {
  buildReleaseManifest(stage, {buildId: state.current, protocolVersion: releaseManifest.protocolVersion, privateKey: options.privateKey, entrypoint: "bootstrap.mjs"});
  verifyRelease(stage, {publicKey: readFileSync(join(runtimeRoot,"release-public.pem"),"utf8")});
}
return {buildId: state.current, stage, ...(archivePath ? packRelease(stage, archivePath) : {})};
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (!process.argv[2] || !process.argv[3]) throw new Error("usage: node scripts/build-bootstrap-bundle.mjs <runtime-root> <archive.zip>");
  const keys = ensureReleaseKeyPair(process.env.HF_RELEASE_KEY_DIR || join(homedir(), ".hf-pipe", "keys"));
  console.log(JSON.stringify(buildBootstrapBundle({runtimeRoot:process.argv[2],archivePath:process.argv[3],privateKey:loadPrivateKey(keys.privatePath)})));
}
