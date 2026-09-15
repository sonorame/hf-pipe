import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import net from "node:net";
import { loadEnvFile, homeserverUrl } from "./config.mjs";
import { applyNodeNetworkPolicy } from "../dist/network-policy.js";

loadEnvFile();
applyNodeNetworkPolicy();

function dumpErr(label, err) {
  const rows = [];
  let cur = err;
  let depth = 0;
  while (cur && depth < 6) {
    rows.push({
      depth,
      name: cur.name,
      message: cur.message,
      code: cur.code,
      errno: cur.errno,
      syscall: cur.syscall,
      hostname: cur.hostname,
      address: cur.address,
      port: cur.port,
    });
    cur = cur.cause;
    depth += 1;
  }
  console.log(label, JSON.stringify(rows, null, 2));
}

async function main() {
  const hs = homeserverUrl();
  if (!hs) {
    console.error("Set MATRIX_HOMESERVER_URL");
    process.exit(1);
  }
  const host = hs.replace(/^https?:\/\//i, "").split("/")[0].split(":")[0];
  const url = `${hs}/_matrix/client/versions`;
  console.log("node", process.version, process.execPath);
  console.log("homeserver", hs);
  console.log("dnsOrder", dns.getDefaultResultOrder());
  console.log("autoFamily", net.getDefaultAutoSelectFamily());
  console.log("autoFamilyTimeout", net.getDefaultAutoSelectFamilyAttemptTimeout());
  console.log("HTTP_PROXY", process.env.HTTP_PROXY || process.env.http_proxy || "");
  console.log("HTTPS_PROXY", process.env.HTTPS_PROXY || process.env.https_proxy || "");
  console.log("NODE_OPTIONS", process.env.NODE_OPTIONS || "");

  try {
    const looked = await dnsPromises.lookup(host, { all: true });
    console.log("lookup", looked);
  } catch (e) {
    dumpErr("lookup FAIL", e);
  }

  try {
    console.log("resolve4", await dnsPromises.resolve4(host));
  } catch (e) {
    dumpErr("resolve4 FAIL", e);
  }

  try {
    console.log("resolve6", await dnsPromises.resolve6(host));
  } catch (e) {
    dumpErr("resolve6 FAIL", e);
  }

  try {
    const res = await fetch(url);
    console.log("fetch plain", res.status);
  } catch (e) {
    dumpErr("fetch plain FAIL", e);
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      mode: "cors",
      redirect: "follow",
      referrer: "",
      referrerPolicy: "no-referrer",
      cache: "no-cache",
      credentials: "omit",
    });
    console.log("fetch sdk-opts", res.status);
  } catch (e) {
    dumpErr("fetch sdk-opts FAIL", e);
  }
}

main().catch((e) => {
  dumpErr("fatal", e);
  process.exit(1);
});
