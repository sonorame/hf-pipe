import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [baseRoot, receiptPath] = process.argv.slice(2);
if (!baseRoot || !receiptPath) throw new Error("usage: upload-recovery-candidate <base-generation> <candidate-receipt>");
const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
const state = JSON.parse(readFileSync(join(baseRoot, "state.json"), "utf8"));
const release = join(baseRoot, "releases", state.current);
const config = await import(pathToFileURL(join(release, "src", "config.mjs")));
config.loadEnvFile();
const session = JSON.parse(readFileSync(config.sessionFile(), "utf8"));
const network = await import(pathToFileURL(join(release, "dist", "network-policy.js")));
network.applyNodeNetworkPolicy();
const transfer = await import(pathToFileURL(join(release, "src", "release-transfer.mjs")));
const media = await transfer.uploadReleaseMedia({ homeserver: session.homeserver, accessToken: session.access_token, archivePath: receipt.archive, fetchFn: network.pinnedFetch });
const result = { ...receipt, ...media };
writeFileSync(receiptPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ buildId: receipt.buildId, ...media }));
