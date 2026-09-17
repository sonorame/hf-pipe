import { buildRelease } from "./build-release.mjs";

const dst = process.argv[2];
if (!dst) {
  console.error("usage: node scripts/sync-live-dirty.mjs <live-dir>");
  process.exit(1);
}
const result = buildRelease({ runtimeRoot: dst, activate: true });
console.log("activated", result.buildId, result.releaseDir);
