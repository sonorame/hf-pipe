import {
  cpSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildReleaseManifest, promoteRelease, verifyRelease } from "../src/release-runtime.mjs";
import { loadPrivateKey } from "../src/release-key.mjs";

const runtimeRoot = process.argv[2];
if (!runtimeRoot) {
  console.error("usage: node scripts/stage-bad-release.mjs <runtime-root>");
  process.exit(1);
}

const state = JSON.parse(readFileSync(join(runtimeRoot, "state.json"), "utf8"));
const source = join(runtimeRoot, "releases", state.current);
const sourceManifest = JSON.parse(readFileSync(join(source, "release-manifest.json"), "utf8"));
const buildId = `bad-${Date.now()}`;
const staging = join(runtimeRoot, "releases", `.staging-${buildId}`);
const releaseDir = join(runtimeRoot, "releases", buildId);
rmSync(staging, { recursive: true, force: true });
cpSync(source, staging, { recursive: true });
rmSync(join(staging, "release-manifest.json"), { force: true });
writeFileSync(
  join(staging, "src", "index.mjs"),
  `throw new Error("acceptance bad release ${buildId}");\n`,
);
const privatePath =
  process.env.HF_RELEASE_PRIVATE_KEY ||
  join(homedir(), ".hf-pipe", "keys", "release-private.dpapi");
buildReleaseManifest(staging, {
  buildId,
  protocolVersion: sourceManifest.protocolVersion,
  privateKey: loadPrivateKey(privatePath),
});
verifyRelease(staging, {
  publicKey: readFileSync(join(runtimeRoot, "release-public.pem"), "utf8"),
  expectedProtocolVersion: sourceManifest.protocolVersion,
});
renameSync(staging, releaseDir);
promoteRelease(runtimeRoot, buildId);
console.log(JSON.stringify({ buildId, previous: state.current, releaseDir }));
