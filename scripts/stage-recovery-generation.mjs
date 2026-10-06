import { existsSync, readFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const [side, baseRoot, buildId, expectedHash, source] = process.argv.slice(2);
if (!["dirty", "clean"].includes(side) || !/^[a-f0-9]{16}$/.test(buildId || "") || !/^[a-f0-9]{64}$/.test(expectedHash || "") || !baseRoot || !source) {
  throw new Error("usage: stage-recovery-generation <side> <base-generation> <build-id> <archive-sha256> <archive-path-or-mxc>");
}
const home = join(homedir(), ".hf-pipe");
const incoming = join(home, "incoming");
mkdirSync(incoming, { recursive: true });
const authority = readFileSync(join(baseRoot, "release-public.pem"), "utf8");
const state = JSON.parse(readFileSync(join(baseRoot, "state.json"), "utf8"));
const release = join(baseRoot, "releases", state.current);
let archive = source;
if (source.startsWith("mxc://")) {
  archive = join(incoming, `bootstrap-${buildId}.zip`);
  const digest = () => createHash("sha256").update(readFileSync(archive)).digest("hex");
  if (!existsSync(archive) || digest() !== expectedHash) {
    const config = await import(pathToFileURL(join(release, "src", "config.mjs")));
    config.loadEnvFile();
    const session = JSON.parse(readFileSync(config.sessionFile(), "utf8"));
    const network = await import(pathToFileURL(join(release, "dist", "network-policy.js")));
    network.applyNodeNetworkPolicy();
    const transfer = await import(pathToFileURL(join(release, "src", "release-transfer.mjs")));
    await transfer.downloadReleaseMedia({ homeserver: session.homeserver, accessToken: session.access_token, mxc: source, archivePath: archive, expectedSha256: expectedHash, fetchFn: network.pinnedFetch });
  }
}
if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== expectedHash) throw new Error("Archive hash mismatch");
const generations = join(home, "runtime-generations");
mkdirSync(generations, { recursive: true });
const target = join(generations, buildId);
const verifier = await import(pathToFileURL(join(baseRoot, "release-runtime.mjs")));
function verify(root) {
  const outer = verifier.verifyRelease(root, { publicKey: authority, expectedProtocolVersion: 3 });
  if (outer.buildId !== buildId || outer.entrypoint !== "bootstrap.mjs") throw new Error("Unexpected bootstrap identity");
  if (readFileSync(join(root, "release-public.pem"), "utf8").trim() !== authority.trim()) throw new Error("Trust rotation rejected");
  const inner = verifier.verifyRelease(join(root, "releases", buildId), { publicKey: authority, expectedProtocolVersion: 3 });
  if (inner.buildId !== buildId) throw new Error("Unexpected release identity");
}
if (!existsSync(target)) {
  const stage = join(generations, `.staging-${buildId}-${process.pid}`);
  mkdirSync(stage);
  const extract = `import pathlib,sys,zipfile,stat
root=pathlib.Path(sys.argv[2]).resolve()
with zipfile.ZipFile(sys.argv[1]) as z:
 for f in z.infolist():
  p=(root/f.filename).resolve()
  if not p.is_relative_to(root) or ':' in f.filename or '\\\\' in f.filename or stat.S_ISLNK(f.external_attr>>16): raise RuntimeError('Unsafe archive entry')
 z.extractall(root)
`;
  const result = spawnSync("py", ["-3", "-c", extract, archive, stage], { encoding: "utf8", windowsHide: true, timeout: 120_000 });
  if (result.status !== 0) throw new Error(`Extraction failed: ${result.stderr || result.error?.message || result.status}`);
  verify(stage);
  renameSync(stage, target);
}
verify(target);
const receipt = { side, buildId, protocolVersion: 3, root: target, previousRoot: baseRoot, archiveHash: expectedHash, verifiedAt: new Date().toISOString() };
writeFileSync(join(incoming, `prepared-${buildId}.json`), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
