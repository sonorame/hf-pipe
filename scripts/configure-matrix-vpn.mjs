import { lookup } from "node:dns/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { matrixVpnConfig } from "../src/matrix-vpn-profile.mjs";

const state = process.argv[2];
if (!state) throw new Error("State directory is required");
const envPath = join(state, "vpn.env");
const text = readFileSync(envPath, "utf8");
const homeserver = text.match(/^MATRIX_HOMESERVER_URL=(.+)$/m)?.[1].trim();
const host = new URL(homeserver).hostname;
// Resolve before enabling TUN; Matrix and its TURN service must keep using the physical network.
const { address } = await lookup(host, { family: 4 });
writeFileSync(envPath, text.replace(/^HF_DNS_PIN=.*\r?\n?/gm, "").trimEnd() + `\nHF_DNS_PIN=${host}=${address}\n`);
for (const testTransport of [false, true]) {
  const config = matrixVpnConfig({ homeserver, matrixIpv4: address, testTransport });
  config.log.output = join(state, testTransport ? "frontend-test.log" : "tun.log");
  writeFileSync(join(state, testTransport ? "frontend-test.json" : "tun.json"), JSON.stringify(config, null, 2));
}
console.log(`Matrix bootstrap pinned: ${host} → ${address}`);
