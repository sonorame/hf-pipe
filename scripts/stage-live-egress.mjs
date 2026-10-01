import { cpSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildRelease } from "./build-release.mjs";
import { verifyRelease } from "../src/release-runtime.mjs";

const live = join(homedir(), ".cursor", "matrix-mcp-e2ee");
const temp = join(homedir(), ".hf-pipe", "staging-egress");
const keyDir = join(homedir(), ".hf-pipe", "keys");
const publicKey = readFileSync(join(live, "release-public.pem"), "utf8");
const before = JSON.parse(readFileSync(join(live, "state.json"), "utf8"));
if (before.current !== "25cd3b3724999afd") {
  throw new Error(`unexpected live current ${before.current}`);
}

const result = buildRelease({
  runtimeRoot: temp,
  keyDir,
  protocolVersion: 2,
  activate: false,
});
verifyRelease(result.releaseDir, { publicKey, expectedProtocolVersion: 2 });
const dest = join(live, "releases", result.buildId);
if (existsSync(dest)) throw new Error(`live already has ${result.buildId}`);
cpSync(result.releaseDir, dest, { recursive: true });
verifyRelease(dest, { publicKey, expectedProtocolVersion: 2 });
const after = JSON.parse(readFileSync(join(live, "state.json"), "utf8"));
if (after.current !== before.current) throw new Error("current flipped during stage");
if (!existsSync(join(dest, "src", "egress-proxy.mjs"))) throw new Error("egress missing in staged tree");
console.log(
  JSON.stringify({
    ok: true,
    buildId: result.buildId,
    liveCurrent: after.current,
    dest,
  }),
);
