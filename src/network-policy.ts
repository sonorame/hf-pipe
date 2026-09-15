import { createRequire } from "node:module";
import dns from "node:dns";
import net from "node:net";
import { mapKeysUploadResponse } from "./hop-client-mode.js";

const require = createRequire(import.meta.url);

/** Node lookup order. Official: dns.setDefaultResultOrder. Not Agent family: 4. */
export const DNS_RESULT_ORDER = "ipv4first" as const;

/** RFC 8305 via net.socket.connect. Official default is true unless --no-network-family-autoselection. */
export const AUTO_SELECT_FAMILY = true;

export const AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS = 500;

/** Static A records when OS getaddrinfo / local DNS are dead. Filled from HF_DNS_PIN. */
export const PINNED_A: Record<string, string> = {};

type UndiciMod = {
  Agent: new (opts: { connect?: { lookup?: typeof dns.lookup } }) => unknown;
  setGlobalDispatcher: (dispatcher: unknown) => void;
  fetch: (input: unknown, init?: unknown) => Promise<Response>;
};

let pinsInstalled = false;
let dispatcher: unknown;
const origLookup = dns.lookup.bind(dns);
const origPromisesLookup = dns.promises.lookup.bind(dns.promises);

function normalizeHost(hostname: string): string {
  return String(hostname || "").trim().replace(/\.$/, "").toLowerCase();
}

function pinnedIp(hostname: string): string | undefined {
  return PINNED_A[normalizeHost(hostname)];
}

export function loadDnsPinsFromEnv(raw = process.env.HF_DNS_PIN || ""): void {
  for (const part of String(raw).split(/[,;\s]+/)) {
    if (!part) continue;
    const eq = part.lastIndexOf("=");
    if (eq < 1) continue;
    const host = normalizeHost(part.slice(0, eq));
    const ip = part.slice(eq + 1).trim();
    if (host && net.isIP(ip) === 4) PINNED_A[host] = ip;
  }
}

function loadUndici(): UndiciMod {
  return require("node:undici") as UndiciMod;
}

export function pinnedLookup(
  hostname: string,
  options: any,
  callback?: any,
): void {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  const ip = pinnedIp(hostname);
  const familyWanted = options && typeof options === "object" ? options.family : undefined;
  if (ip && familyWanted !== 6) {
    if (options && options.all) {
      callback(null, [{ address: ip, family: 4 }]);
    } else {
      callback(null, ip, 4);
    }
    return;
  }
  origLookup(hostname, options, callback);
}

function installPinnedLookup(): void {
  if (pinsInstalled) return;
  pinsInstalled = true;

  dns.lookup = pinnedLookup as typeof dns.lookup;

  dns.promises.lookup = ((hostname: string, options?: any) => {
    const opts = options && typeof options === "object" ? options : {};
    const ip = pinnedIp(hostname);
    if (ip && opts.family !== 6) {
      if (opts.all) {
        return Promise.resolve([{ address: ip, family: 4 }]);
      }
      return Promise.resolve({ address: ip, family: 4 });
    }
    return origPromisesLookup(hostname, options as any);
  }) as typeof dns.promises.lookup;

  try {
    const undici = loadUndici();
    dispatcher = new undici.Agent({
      connect: {
        lookup: pinnedLookup as typeof dns.lookup,
      },
    });
    undici.setGlobalDispatcher(dispatcher);
  } catch {
    dispatcher = undefined;
  }
  const pins = Object.entries(PINNED_A);
  if (pins.length) {
    console.error(new Date().toISOString(), "hf net pin", pins.map(([h, ip]) => `${h} ${ip}`).join(", "));
  }
}

export async function pinnedFetch(input: any, init?: any): Promise<Response> {
  applyNodeNetworkPolicy();
  const url = typeof input === "string" ? input : String(input?.url || input || "");
  let res: Response;
  try {
    const undici = loadUndici();
    res = await undici.fetch(input, { ...(init || {}), dispatcher });
  } catch {
    res = await fetch(input, init);
  }
  if (res.status !== 400 || !url.includes("/keys/upload")) return res;
  const body = await res.text();
  const mapped = mapKeysUploadResponse(url, res.status, body);
  return new Response(mapped.body, {
    status: mapped.status,
    headers: { "Content-Type": "application/json" },
  });
}

export function pinHost(hostname: string, ip?: string): void {
  const key = normalizeHost(hostname);
  if (!key || net.isIP(key)) return;
  if (ip && net.isIP(ip) === 4) {
    PINNED_A[key] = ip;
    return;
  }
  if (ip) return;
  const hs = String(process.env.MATRIX_HOMESERVER_URL || "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0];
  const fromHs = hs ? PINNED_A[normalizeHost(hs)] : undefined;
  if (fromHs) PINNED_A[key] = fromHs;
}

export function applyNodeNetworkPolicy(): void {
  dns.setDefaultResultOrder(DNS_RESULT_ORDER);
  net.setDefaultAutoSelectFamily(AUTO_SELECT_FAMILY);
  if (net.getDefaultAutoSelectFamilyAttemptTimeout() < AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS) {
    net.setDefaultAutoSelectFamilyAttemptTimeout(AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS);
  }
  loadDnsPinsFromEnv();
  installPinnedLookup();
}
